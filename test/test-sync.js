'use strict';
// Prueba de extremo a extremo de la sincronización: pack -> manifest -> servidor local -> instancia.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { buildManifest } = require('../tools/generate-manifest');
const { computeDiff, applyDiff, validateManifest, safeJoin, readState } = require('../src/lib/sync');

const tmpBase = process.env.ATENAS_TEST_TMP || os.tmpdir();
const root = fs.mkdtempSync(path.join(tmpBase, 'atenas-test-'));
const packDir = path.join(root, 'pack');
const instDir = path.join(root, 'instance');

function put(rel, content) {
  const f = path.join(packDir, 'files', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
function rebuild(note) {
  const { manifest, outPath, summary } = buildManifest(packDir, { baseUrl, note });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  return { manifest, summary };
}

let baseUrl;
const server = http.createServer((req, res) => {
  const file = path.join(packDir, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(packDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
    id: 'test', name: 'Test Pack', minecraft: '1.20.1', loader: { type: 'fabric', version: '0.15.11' },
  }));
  put('mods/a.jar', 'mod A v1');
  put('mods/b.jar', 'mod B v1');
  put('mods/c d.jar', 'mod con espacio');
  put('config/foo.toml', 'x=1');
  put('options.txt', 'fov=70');

  // 1) Instalación limpia
  let { manifest } = rebuild();
  assert.strictEqual(manifest.packVersion, '1.0.0');
  let diff = await computeDiff(manifest, instDir);
  assert.strictEqual(diff.add.length, 5, 'instalación limpia: 5 archivos a añadir');
  assert.strictEqual(diff.installed, false);
  const events = [];
  await applyDiff(manifest, instDir, diff, { onProgress: (p) => events.push(p) });
  assert.strictEqual(fs.readFileSync(path.join(instDir, 'mods/a.jar'), 'utf8'), 'mod A v1');
  assert.strictEqual(fs.readFileSync(path.join(instDir, 'mods/c d.jar'), 'utf8'), 'mod con espacio');
  const last = events[events.length - 1];
  assert.strictEqual(last.filesDone, 5);
  assert.ok(last.doneBytes <= last.totalBytes, 'la barra no pasa de 100%');
  console.log('ok 1: instalación limpia');

  // 2) Sin cambios -> no hay actualización
  diff = await computeDiff(manifest, instDir);
  assert.strictEqual(diff.hasChanges, false);
  assert.strictEqual(diff.localVersion, '1.0.0');
  console.log('ok 2: sin cambios no avisa');

  // 3) El jugador toca su options.txt -> NO se pisa (policy once)
  fs.writeFileSync(path.join(instDir, 'options.txt'), 'fov=110');
  put('options.txt', 'fov=90'); // el autor cambia el suyo, pero es "once"
  // 4) El autor añade un mod, quita otro y actualiza otro
  put('mods/new.jar', 'mod NEW');
  fs.unlinkSync(path.join(packDir, 'files/mods/b.jar'));
  put('mods/a.jar', 'mod A v2');
  const r = rebuild('Nota de prueba');
  manifest = r.manifest;
  assert.strictEqual(manifest.packVersion, '1.0.1', 'sube la versión automáticamente');
  assert.ok(manifest.changelog.includes('Nota de prueba'));
  assert.ok(manifest.changelog.includes('Añadido: new.jar'));
  assert.ok(manifest.changelog.includes('Quitado: b.jar'));
  assert.ok(manifest.changelog.includes('Actualizado: a.jar'));

  diff = await computeDiff(manifest, instDir);
  assert.deepStrictEqual(diff.add.map((f) => f.path), ['mods/new.jar']);
  assert.deepStrictEqual(diff.change.map((f) => f.path), ['mods/a.jar']);
  assert.deepStrictEqual(diff.remove.map((f) => f.path), ['mods/b.jar']);
  assert.ok(diff.hasChanges);
  console.log('ok 3: detecta +1 -1 ~1 y changelog');

  await applyDiff(manifest, instDir, diff);
  assert.strictEqual(fs.readFileSync(path.join(instDir, 'mods/a.jar'), 'utf8'), 'mod A v2');
  assert.ok(!fs.existsSync(path.join(instDir, 'mods/b.jar')), 'mod quitado desaparece');
  assert.strictEqual(fs.readFileSync(path.join(instDir, 'options.txt'), 'utf8'), 'fov=110', 'options.txt del jugador intacto');
  assert.strictEqual(readState(instDir).packVersion, '1.0.1');
  console.log('ok 4: update aplicado, config del jugador respetada');

  // 5) Mod puesto a mano por el jugador en mods/ -> se limpia (pack consistente)
  fs.writeFileSync(path.join(instDir, 'mods/extra.jar'), 'intruso');
  diff = await computeDiff(manifest, instDir);
  assert.deepStrictEqual(diff.remove.map((f) => f.path), ['mods/extra.jar']);
  await applyDiff(manifest, instDir, diff);
  assert.ok(!fs.existsSync(path.join(instDir, 'mods/extra.jar')));
  console.log('ok 5: mods ajenos se limpian');

  // 6) Archivo corrupto en disco -> se detecta y repara
  fs.writeFileSync(path.join(instDir, 'mods/new.jar'), 'corrupto');
  diff = await computeDiff(manifest, instDir);
  assert.deepStrictEqual(diff.change.map((f) => f.path), ['mods/new.jar']);
  await applyDiff(manifest, instDir, diff);
  assert.strictEqual(fs.readFileSync(path.join(instDir, 'mods/new.jar'), 'utf8'), 'mod NEW');
  console.log('ok 6: archivo corrupto se repara');

  // 7) Seguridad: rutas maliciosas en el manifest
  assert.throws(() => safeJoin(instDir, '../../etc/passwd'));
  assert.throws(() => safeJoin(instDir, '/etc/passwd'));
  const evil = JSON.parse(JSON.stringify(manifest));
  evil.files.push({ path: '../evil.txt', url: baseUrl + '/pack.json', sha256: 'a'.repeat(64) });
  await assert.rejects(() => computeDiff(evil, instDir));
  assert.throws(() => validateManifest({ minecraft: '1.20.1', packVersion: '1', files: [{ path: 'x', url: 'u', sha256: 'zz' }] }));
  console.log('ok 7: rutas maliciosas y manifest inválido rechazados');

  // 8) Hash incorrecto en descarga -> falla y no deja el archivo
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files.push({ path: 'mods/bad.jar', url: `${baseUrl}/files/mods/new.jar`, sha256: 'b'.repeat(64), size: 7 });
  diff = await computeDiff(bad, instDir);
  await assert.rejects(() => applyDiff(bad, instDir, diff), /Hash incorrecto|No se pudo descargar/);
  assert.ok(!fs.existsSync(path.join(instDir, 'mods/bad.jar')));
  console.log('ok 8: descarga con hash malo se rechaza');

  console.log('\nTODAS LAS PRUEBAS PASARON');
})().catch((e) => { console.error('FALLÓ:', e); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
