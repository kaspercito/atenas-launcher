'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const of = require('../src/lib/optifine');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-of-'));
const stored = path.join(tmp, 'optifine');
const inst = path.join(tmp, 'inst');
// zip minimo (sin comprimir) con las entradas dadas: lo justo para probar la lectura del directorio central
function makeZip(names) {
  const locals = []; const centrals = []; let off = 0;
  for (const n of names) {
    const nb = Buffer.from(n);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(nb.length, 26);
    const local = Buffer.concat([lh, nb]);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([ch, nb])); locals.push(local); off += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const fakeJar = (p) => fs.writeFileSync(p, makeZip(['optifine/OptiFineForgeTweaker.class', 'net/optifine/Config.class', 'META-INF/MANIFEST.MF']));

assert.ok(of.isOptiFineName('OptiFine_1.8.9_HD_U_M5.jar'));
assert.ok(of.isOptiFineName('OptiFine_1.8.9_HD_U_L5.jar'));
assert.ok(!of.isOptiFineName('OptiFine_1.12.2_HD_U_G5.jar'), 'solo 1.8.9');
assert.ok(!of.isOptiFineName('../OptiFine_1.8.9_HD_U_M5.jar'), 'sin rutas');
assert.ok(!of.isOptiFineName('AtenasClient-1.0.0.jar'));
// nombres que deja el navegador
assert.ok(of.isOptiFineName('OptiFine_1.8.9_HD_U_M5 (1).jar'), 'descarga repetida');
assert.ok(of.isOptiFineName('OptiFine 1.8.9 HD U M5.jar'), 'con espacios');
assert.ok(of.isOptiFineName('preview_OptiFine_1.8.9_HD_U_M6_pre1.jar'), 'preview');
assert.strictEqual(of.canonicalName('OptiFine_1.8.9_HD_U_M5 (1).jar'), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(of.canonicalName('OptiFine 1.8.9 HD U M5.jar'), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(of.status(stored).available, false);

const src = path.join(tmp, 'OptiFine_1.8.9_HD_U_M5.jar');
fakeJar(src);
assert.strictEqual(of.importJar(src, stored), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(of.status(stored).file, 'OptiFine_1.8.9_HD_U_M5.jar');
assert.throws(() => of.importJar(path.join(tmp, 'otro.jar'), stored), /no parece OptiFine/);
const bad = path.join(tmp, 'OptiFine_1.8.9_HD_U_M6.jar');
fs.writeFileSync(bad, 'texto');
assert.throws(() => of.importJar(bad, stored), /dañado/);
// un zip valido pero que no es OptiFine
const notOf = path.join(tmp, 'OptiFine_1.8.9_HD_U_M7.jar');
fs.writeFileSync(notOf, makeZip(['com/otro/Mod.class']));
assert.throws(() => of.importJar(notOf, stored), /no trae los archivos de OptiFine/);
// nombre sucio -> se guarda con el nombre limpio
const dirty = path.join(tmp, 'OptiFine_1.8.9_HD_U_M5 (1).jar');
fakeJar(dirty);
assert.strictEqual(of.importJar(dirty, stored), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(fs.readdirSync(stored).length, 1);

// instalar, quitar la copia vieja y apagar
fs.mkdirSync(path.join(inst, 'mods'), { recursive: true });
fakeJar(path.join(inst, 'mods', 'OptiFine_1.8.9_HD_U_L5.jar'));
fs.writeFileSync(path.join(inst, 'mods', 'AtenasClient-1.0.0.jar'), 'cliente');
assert.strictEqual(of.syncToInstance({ enabled: true, storedDir: stored, instanceDir: inst }), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.deepStrictEqual(fs.readdirSync(path.join(inst, 'mods')).sort(), ['AtenasClient-1.0.0.jar', 'OptiFine_1.8.9_HD_U_M5.jar']);
// un OptiFine suelto con nombre sucio tambien se limpia (dos a la vez rompen Forge)
fakeJar(path.join(inst, 'mods', 'OptiFine_1.8.9_HD_U_M5 (1).jar'));
assert.strictEqual(of.syncToInstance({ enabled: true, storedDir: stored, instanceDir: inst }), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.deepStrictEqual(fs.readdirSync(path.join(inst, 'mods')).sort(), ['AtenasClient-1.0.0.jar', 'OptiFine_1.8.9_HD_U_M5.jar']);
assert.strictEqual(of.syncToInstance({ enabled: false, storedDir: stored, instanceDir: inst }), null);
assert.deepStrictEqual(fs.readdirSync(path.join(inst, 'mods')), ['AtenasClient-1.0.0.jar'], 'apagar no toca el cliente');

// busqueda automatica en carpetas
const dl = path.join(tmp, 'Downloads');
fs.mkdirSync(dl);
assert.strictEqual(of.scan([dl, path.join(tmp, 'noexiste')]), null);
fakeJar(path.join(dl, 'OptiFine_1.8.9_HD_U_M5.jar'));
fs.writeFileSync(path.join(dl, 'otra-cosa.jar'), 'x');
assert.strictEqual(path.basename(of.scan([dl])), 'OptiFine_1.8.9_HD_U_M5.jar');
const empty = path.join(tmp, 'vacio');
assert.strictEqual(of.status(empty, [dl]).found, 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(of.status(stored, [dl]).found, null, 'si ya está guardado no ofrece otro');

// importacion automatica desde Descargas
const stored2 = path.join(tmp, 'optifine2');
assert.strictEqual(of.autoImport({ enabled: true, storedDir: stored2, scanDirs: [dl] }), 'OptiFine_1.8.9_HD_U_M5.jar');
assert.strictEqual(of.autoImport({ enabled: true, storedDir: stored2, scanDirs: [dl] }), null, 'ya guardado: no repite');
assert.strictEqual(of.autoImport({ enabled: false, storedDir: path.join(tmp, 'o3'), scanDirs: [dl] }), null, 'apagado: no hace nada');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-optifine OK');

// ───────── descarga automatica (con paginas y descargas falsas) ─────────
(async () => {
  const html = `<a href="http://optifine.net/adloadx?f=OptiFine_1.8.9_HD_U_L5.jar">x</a>
    <a href="http://optifine.net/adloadx?f=OptiFine_1.8.9_HD_U_M5.jar">x</a>
    <a href="http://optifine.net/adloadx?f=preview_OptiFine_1.8.9_HD_U_M6_pre1.jar">x</a>
    <a href="http://optifine.net/adloadx?f=OptiFine_1.12.2_HD_U_G5.jar">x</a>`;
  assert.strictEqual(of.pickLatest(html), 'OptiFine_1.8.9_HD_U_M5.jar', 'toma la mas nueva, sin preview ni otras versiones');
  assert.strictEqual(of.pickLatest('<html>nada</html>'), null);
  assert.strictEqual(of.pickDirectLink("<a href='downloadx?f=OptiFine_1.8.9_HD_U_M5.jar&amp;x=abc123'>Download</a>", 'https://optifine.net/adloadx?f=a.jar'),
    'https://optifine.net/downloadx?f=OptiFine_1.8.9_HD_U_M5.jar&x=abc123');
  assert.strictEqual(of.pickDirectLink('<p>sin enlace</p>'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-ofauto-'));
  const seen = [];
  const fetchText = async (u) => { seen.push(u); return u.includes('adloadx') ? "<a href='downloadx?f=OptiFine_1.8.9_HD_U_M5.jar&x=tok'>d</a>" : html; };
  const downloadFile = async (u, dest) => { seen.push(u); fakeJar(dest); };
  const name = await of.autoDownload({ storedDir: path.join(dir, 'of'), fetchText, downloadFile, tmpDir: path.join(dir, 'tmp') });
  assert.strictEqual(name, 'OptiFine_1.8.9_HD_U_M5.jar');
  assert.ok(of.status(path.join(dir, 'of')).available, 'queda guardado');
  assert.ok(seen.some((u) => u.endsWith('x=tok')), 'usa el enlace con token');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'tmp')), [], 'no deja temporales');

  // pagina de error en vez de un jar -> se rechaza
  await assert.rejects(of.autoDownload({ storedDir: path.join(dir, 'of2'), fetchText,
    downloadFile: async (u, dest) => fs.writeFileSync(dest, '<html>error</html>'), tmpDir: path.join(dir, 'tmp') }), /OptiFine|dañado|válido/i);
  // optifine.net cambia / cae -> error claro, sin tumbar nada
  await assert.rejects(of.autoDownload({ storedDir: path.join(dir, 'of3'), fetchText: async () => '<html></html>', downloadFile, tmpDir: path.join(dir, 'tmp') }), (e) => e.code === 'OPTIFINE_DOWNLOAD');
  await assert.rejects(of.autoDownload({ storedDir: path.join(dir, 'of4'), fetchText: async () => { throw new Error('sin internet'); }, downloadFile, tmpDir: path.join(dir, 'tmp') }), (e) => e.code === 'OPTIFINE_DOWNLOAD');
  console.log('optifine auto-descarga: OK');
})().catch((e) => { console.error(e); process.exit(1); });
