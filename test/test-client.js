'use strict';
// Pruebas sin internet (servidor local falso): Forge 1.8.9, jar del cliente, releases de GitHub y --server/--port.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { installerCoords, isLegacyForge } = require('../src/lib/loaders');
const { installLegacyForge, mavenPath, normalizeBase, readInstallProfile } = require('../src/lib/legacyforge');
const client = require('../src/lib/client');
const { quickPlayFor, loaderJvmArgs } = require('../src/lib/launch');
const { javaMajorFor } = require('../src/lib/java');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `atenas-${n}-`));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // ── coordenadas de Forge 1.8.9 ──
  const c = installerCoords('forge', '1.8.9', '11.15.1.2318');
  assert.strictEqual(c.id, '1.8.9-forge1.8.9-11.15.1.2318-1.8.9');
  assert.strictEqual(c.url, 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.8.9-11.15.1.2318-1.8.9/forge-1.8.9-11.15.1.2318-1.8.9-installer.jar');
  assert.strictEqual(installerCoords('forge', '1.8.9', '1.8.9-11.15.1.2318-1.8.9').id, c.id, 'versión ya completa');
  assert.ok(isLegacyForge('forge', '1.8.9') && isLegacyForge('forge', '1.7.10') && !isLegacyForge('forge', '1.12.2') && !isLegacyForge('forge', '1.20.1') && !isLegacyForge('neoforge', '1.8.9'));
  assert.strictEqual(javaMajorFor('1.8.9'), 8);
  assert.strictEqual(mavenPath('net.minecraft:launchwrapper:1.12'), 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar');
  assert.strictEqual(mavenPath('a.b:c:1.0:natives@zip'), 'a/b/c/1.0/c-1.0-natives.zip');
  assert.strictEqual(normalizeBase('http://files.minecraftforge.net/maven/'), 'https://maven.minecraftforge.net/');

  // ── --server/--port en versiones viejas, quickPlay en 1.20+ ──
  assert.strictEqual(quickPlayFor({ minecraft: '1.8.9', server: 'arefy.net' }), null); // por defecto NO entra directo: sale en Multijugador con ★
  assert.deepStrictEqual(quickPlayFor({ minecraft: '1.8.9', server: 'arefy.net', autoJoin: true }), { type: 'legacy', identifier: 'arefy.net' });
  assert.deepStrictEqual(quickPlayFor({ minecraft: '1.20.1', server: 'x.y:25570', autoJoin: true }), { type: 'multiplayer', identifier: 'x.y:25570' });
  assert.strictEqual(quickPlayFor({ minecraft: '1.8.9' }), null);

  // ── servidor falso: librerías Maven y API de releases ──
  const files = new Map();      // ruta -> Buffer
  let apiMode = 'ok';           // ok | 404 | down
  let releaseBody;
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u.startsWith('/api/')) {
      if (apiMode === 'down') { res.statusCode = 503; return res.end('no'); }
      if (apiMode === '404') { res.statusCode = 404; return res.end('{}'); }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(releaseBody()));
    }
    const buf = files.get(u);
    if (!buf) { res.statusCode = 404; return res.end('nope'); }
    res.end(buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── Forge clásico: instalador falso con el formato real (install + versionInfo) ──
  const forgeName = 'net.minecraftforge:forge:1.8.9-11.15.1.2318-1.8.9';
  const versionId = '1.8.9-forge1.8.9-11.15.1.2318-1.8.9';
  const versionInfo = {
    id: versionId, inheritsFrom: '1.8.9', jar: '1.8.9', mainClass: 'net.minecraft.launchwrapper.Launch',
    minecraftArguments: '--username ${auth_player_name} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --versionType Forge',
    libraries: [
      { name: forgeName, url: 'http://files.minecraftforge.net/maven/' },
      { name: 'net.minecraft:launchwrapper:1.12' },                                        // sin url -> mirrors de respaldo
      { name: 'org.ow2.asm:asm-all:5.0.3', url: `${base}/forgemaven/`, clientreq: true },   // con url propia
      { name: 'lzma:lzma:0.0.1', url: `${base}/forgemaven/`, clientreq: true },
      { name: 'only.server:lib:1.0', serverreq: true },                                    // solo servidor: opcional, no existe en ningún sitio
    ],
  };
  files.set('/mirror/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar', Buffer.from('launchwrapper'));
  files.set('/forgemaven/org/ow2/asm/asm-all/5.0.3/asm-all-5.0.3.jar', Buffer.from('asm'));
  files.set('/forgemaven/lzma/lzma/0.0.1/lzma-0.0.1.jar', Buffer.from('lzma'));

  const zip = new AdmZip();
  zip.addFile('install_profile.json', Buffer.from(JSON.stringify({
    install: { profileName: 'Forge', target: versionId, path: forgeName, version: versionId, filePath: 'forge-1.8.9-11.15.1.2318-1.8.9-universal.jar', minecraft: '1.8.9' },
    versionInfo,
  })));
  zip.addFile('forge-1.8.9-11.15.1.2318-1.8.9-universal.jar', Buffer.from('FORGE-UNIVERSAL'));
  const installerJar = path.join(tmp('inst'), 'installer.jar');
  zip.writeZip(installerJar);

  const inst = tmp('forge');
  const logs = [];
  const id = await installLegacyForge(installerJar, inst, (l) => logs.push(l), { fallbacks: [`${base}/mirror/`] });
  assert.strictEqual(id, versionId);
  const vjson = JSON.parse(fs.readFileSync(path.join(inst, 'versions', id, `${id}.json`), 'utf8'));
  assert.strictEqual(vjson.mainClass, 'net.minecraft.launchwrapper.Launch');
  assert.ok(vjson.minecraftArguments.includes('FMLTweaker'));
  const L = (rel) => path.join(inst, 'libraries', rel);
  assert.strictEqual(fs.readFileSync(L('net/minecraftforge/forge/1.8.9-11.15.1.2318-1.8.9/forge-1.8.9-11.15.1.2318-1.8.9.jar'), 'utf8'), 'FORGE-UNIVERSAL');
  assert.ok(fs.existsSync(L('net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar')), 'launchwrapper desde el mirror');
  assert.ok(fs.existsSync(L('org/ow2/asm/asm-all/5.0.3/asm-all-5.0.3.jar')), 'asm desde su url');
  assert.ok(fs.existsSync(L('lzma/lzma/0.0.1/lzma-0.0.1.jar')));
  assert.ok(!fs.existsSync(L('only/server/lib/1.0/lib-1.0.jar')), 'la librería solo-servidor no es obligatoria');
  assert.deepStrictEqual(loaderJvmArgs(inst, id), [], 'Forge 1.8.9 no trae argumentos JVM propios');

  // Una librería obligatoria que no existe en ningún lado => error claro y SIN json de versión (se reintenta entero)
  const bad = new AdmZip();
  bad.addFile('install_profile.json', Buffer.from(JSON.stringify({
    install: { path: forgeName, filePath: 'u.jar' },
    versionInfo: { ...versionInfo, libraries: [{ name: forgeName }, { name: 'falta:total:9.9', clientreq: true }] },
  })));
  bad.addFile('u.jar', Buffer.from('x'));
  const badJar = path.join(tmp('inst'), 'bad.jar'); bad.writeZip(badJar);
  const inst2 = tmp('forge-bad');
  await assert.rejects(() => installLegacyForge(badJar, inst2, () => {}, { fallbacks: [`${base}/mirror/`] }), /falta:total:9\.9/);
  assert.ok(!fs.existsSync(path.join(inst2, 'versions')), 'no se deja una versión a medias');

  // Instalador moderno (con processors) => NOT_LEGACY para caer al instalador oficial
  const modern = new AdmZip();
  modern.addFile('install_profile.json', Buffer.from(JSON.stringify({ processors: [], data: {}, libraries: [] })));
  const modernJar = path.join(tmp('inst'), 'modern.jar'); modern.writeZip(modernJar);
  await assert.rejects(async () => readInstallProfile(new AdmZip(modernJar)), (e) => e.code === 'NOT_LEGACY');

  // ── cliente: jar de la Release ──
  const jarV1 = Buffer.from('JAR-V1-' + 'x'.repeat(5000));
  const jarV2 = Buffer.from('JAR-V2-' + 'y'.repeat(7000));
  files.set('/dl/v1/AtenasClient-1.0.0.jar', jarV1);
  files.set('/dl/v2/AtenasClient-1.0.1.jar', jarV2);
  let current = { tag: 'v1.0.0', jar: jarV1, path: '/dl/v1/AtenasClient-1.0.0.jar', name: 'AtenasClient-1.0.0.jar', digest: true, extraAssets: true };
  releaseBody = () => ({
    tag_name: current.tag, body: 'Novedades: cosméticos nuevos',
    assets: [
      ...(current.extraAssets ? [{ name: current.name.replace('.jar', '-sources.jar'), browser_download_url: base + '/nada', size: 1 }] : []),
      { name: current.name, browser_download_url: base + current.path, size: current.jar.length, ...(current.digest ? { digest: 'sha256:' + sha(current.jar) } : {}) },
    ],
  });
  const opts = (extra = {}) => ({ repo: 'kaspercito/atenas-client', apiBase: base + '/api', ttlMs: 0, cacheFile: path.join(tmp('cache'), 'rel.json'), ...extra });
  const cacheFile = path.join(tmp('cache'), 'rel.json');
  const game = tmp('game');

  let rel = await client.getLatest(opts({ cacheFile }));
  assert.strictEqual(rel.version, '1.0.0');
  assert.strictEqual(rel.name, 'AtenasClient-1.0.0.jar', 'ignora el -sources.jar');
  assert.strictEqual(rel.sha256, sha(jarV1));
  assert.strictEqual(client.needs(rel, client.readMeta(game)), 'install');
  let bytes = 0;
  await client.installClient(rel, game, { onBytes: (n) => { bytes += n; } });
  assert.strictEqual(bytes, jarV1.length);
  assert.deepStrictEqual(fs.readdirSync(path.join(game, 'mods')).sort(), ['AtenasClient-1.0.0.jar']);
  assert.strictEqual(client.needs(rel, client.readMeta(game)), null, 'al día');

  // Hay otra versión: se actualiza y se borra la vieja; los demás mods no se tocan
  fs.writeFileSync(path.join(game, 'mods', 'otro-mod.jar'), 'x');
  current = { tag: 'v1.0.1', jar: jarV2, path: '/dl/v2/AtenasClient-1.0.1.jar', name: 'AtenasClient-1.0.1.jar', digest: false };
  rel = await client.getLatest(opts({ cacheFile }));
  assert.strictEqual(rel.sha256, null, 'sin digest: se valida por tamaño');
  assert.strictEqual(client.needs(rel, client.readMeta(game)), 'update');
  await client.installClient(rel, game);
  assert.deepStrictEqual(fs.readdirSync(path.join(game, 'mods')).sort(), ['AtenasClient-1.0.1.jar', 'otro-mod.jar']);
  assert.strictEqual(client.readMeta(game).tag, 'v1.0.1');

  // Si falta el jar en disco, cuenta como "sin instalar"
  fs.unlinkSync(path.join(game, 'mods', 'AtenasClient-1.0.1.jar'));
  assert.strictEqual(client.readMeta(game), null);

  // Descarga corrupta (hash distinto) => error y nada a medias
  current = { tag: 'v1.0.2', jar: jarV2, path: '/dl/v1/AtenasClient-1.0.0.jar', name: 'AtenasClient-1.0.2.jar', digest: true };
  rel = await client.getLatest(opts({ cacheFile }));
  const game2 = tmp('game2');
  await assert.rejects(() => client.installClient(rel, game2), /Hash incorrecto/);
  assert.deepStrictEqual(fs.readdirSync(path.join(game2, 'mods')), [], 'sin restos .download/.part');

  // Sin internet: usa la copia guardada y lo marca
  apiMode = 'down';
  rel = await client.getLatest(opts({ cacheFile }));
  assert.strictEqual(rel.offline, true);
  assert.strictEqual(rel.tag, 'v1.0.2');
  await assert.rejects(() => client.getLatest(opts()), (e) => e.code === 'NO_CONNECTION');
  // Repo sin releases todavía
  apiMode = '404';
  await assert.rejects(() => client.getLatest(opts()), (e) => e.code === 'NO_RELEASE' && /git tag v1\.0\.0/.test(e.message));
  await assert.rejects(() => client.getLatest(opts({ repo: 'sin barra' })), (e) => e.code === 'NO_RELEASE');
  apiMode = 'ok';
  // Release sin jar adjunto (la compilación falló)
  releaseBody = () => ({ tag_name: 'v9', assets: [{ name: 'otra-cosa.zip', browser_download_url: base + '/x', size: 1 }] });
  await assert.rejects(() => client.getLatest(opts()), (e) => e.code === 'NO_RELEASE' && /no incluye AtenasClient/.test(e.message));

  // ── jar local de prueba (carpeta client-local): gana a GitHub, sin red ──
  const local = tmp('local');
  assert.strictEqual(await client.findLocal(local), null);
  fs.writeFileSync(path.join(local, 'AtenasClient-1.0.0.jar'), 'viejo');
  fs.writeFileSync(path.join(local, 'AtenasClient-1.0.10.jar'), 'nuevo');
  fs.writeFileSync(path.join(local, 'AtenasClient-1.0.10-sources.jar'), 'no');
  apiMode = 'down';
  const lrel = await client.getLatest(opts({ localDir: local }));
  assert.strictEqual(lrel.name, 'AtenasClient-1.0.10.jar', '1.0.10 > 1.0.2 (orden numérico)');
  assert.strictEqual(lrel.source, 'local');
  const game3 = tmp('game3');
  await client.installClient(lrel, game3);
  assert.strictEqual(fs.readFileSync(path.join(game3, 'mods', 'AtenasClient-1.0.10.jar'), 'utf8'), 'nuevo');

  // ── manifest del perfil integrado ──
  const m = client.buildManifest({ id: 'atenas-client', name: 'Atenas Client 1.8.9', minecraft: '1.8.9', forge: '11.15.1.2318', server: 'arefy.net' }, rel);
  assert.strictEqual(m.java, 8);
  assert.deepStrictEqual(m.loader, { type: 'forge', version: '11.15.1.2318' });
  assert.deepStrictEqual(m.managed, [], 'no se administra la carpeta mods: los mods del jugador se respetan');
  assert.strictEqual(m.server, 'arefy.net');

  server.close();
  console.log('test-client: OK');
})().catch((e) => { console.error(e); process.exit(1); });
