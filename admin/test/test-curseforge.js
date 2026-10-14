'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const cf = require('../lib/curseforge');

const jar = (s) => Buffer.from(s);
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const A = jar('aaa'), B = jar('bbb'), C = jar('ccc');

// CurseForge simulado: 100=twilight (dep 200), 300=bloqueado (sin URL), 400=ya la tienes por Modrinth
const files = {
  100: [{ id: 1, fileName: 'twilightforest-1.20.1-4.3.jar', downloadUrl: 'https://cf/a.jar', releaseType: 1, fileDate: '2025-01-01', hashes: [{ algo: 1, value: sha1(A) }], dependencies: [{ modId: 200, relationType: 3 }, { modId: 400, relationType: 3 }, { modId: 999, relationType: 2 }] },
         { id: 2, fileName: 'twilightforest-beta.jar', downloadUrl: 'https://cf/beta.jar', releaseType: 2, fileDate: '2026-01-01', hashes: [], dependencies: [] }],
  200: [{ id: 3, fileName: 'lib-1.0.jar', downloadUrl: 'https://cf/b.jar', releaseType: 1, fileDate: '2025-01-01', hashes: [{ algo: 1, value: sha1(B) }], dependencies: [] }],
  300: [{ id: 4, fileName: 'locked.jar', downloadUrl: null, releaseType: 1, fileDate: '2025-01-01', hashes: [], dependencies: [] }],
  400: [{ id: 5, fileName: 'balm.jar', downloadUrl: 'https://cf/c.jar', releaseType: 1, fileDate: '2025-01-01', hashes: [], dependencies: [] }],
};
const mods = { 200: { id: 200, slug: 'lib', name: 'Lib' }, 400: { id: 400, slug: 'balm', name: 'Balm' } };
const bytes = { 'https://cf/a.jar': A, 'https://cf/b.jar': B, 'https://cf/c.jar': C };
const http = {
  async json(p, body) {
    if (p.startsWith('/mods/search')) return { data: [{ id: 100, slug: 'the-twilight-forest', name: 'Twilight Forest', summary: 's', allowModDistribution: true, logo: { thumbnailUrl: 'https://media.forgecdn.net/x.png' }, downloadCount: 5 }], pagination: { totalCount: 1 } };
    if (p === '/mods') return { data: body.modIds.map((i) => mods[i]).filter(Boolean) };
    const m = /^\/mods\/(\d+)\/files/.exec(p);
    if (m) { assert.ok(/modLoaderType=1/.test(p) && /gameVersion=1.20.1/.test(p)); return { data: files[m[1]] }; }
    throw new Error('ruta inesperada ' + p);
  },
  async bytes(u) { return bytes[u]; },
};

(async () => {
  const r = await cf.search(http, 'twilight', { mc: '1.20.1', loader: 'forge' });
  assert.strictEqual(r.hits[0].slug, 'the-twilight-forest');
  assert.ok(r.hits[0].allowed);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ minecraft: '1.20.1', loader: { type: 'forge' }, sources: { 'mods/otro.jar': 'https://m/otro.jar' } }));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  cf.writeEntries(dir, [{ slug: 'the-twilight-forest', modId: 100, title: 'Twilight Forest', section: 'Dimensiones' }]);

  // vista previa: no escribe nada
  let o = await cf.syncCurseforge(dir, { http, dry: true, log: () => {}, alreadyHave: (s) => s === 'balm' });
  assert.deepStrictEqual(o.problems, []);
  assert.ok(!fs.existsSync(path.join(dir, 'curseforge.lock.json')));

  // sincronización real: release gana a beta, baja la dep obligatoria, omite la opcional y la que ya tienes
  o = await cf.syncCurseforge(dir, { http, log: () => {}, alreadyHave: (s) => s === 'balm' });
  assert.deepStrictEqual(o.added.sort(), ['lib-1.0.jar', 'twilightforest-1.20.1-4.3.jar']);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json')));
  assert.strictEqual(pj.sources['mods/lib-1.0.jar'], 'https://cf/b.jar');
  assert.strictEqual(pj.sources['mods/otro.jar'], 'https://m/otro.jar');   // no pisa lo ajeno
  assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('files/mods/lib-1.0.jar'));
  assert.strictEqual(cf.readLock(dir).mods[200].explicit, false);

  // segunda vez: nada que bajar
  o = await cf.syncCurseforge(dir, { http, log: () => {}, alreadyHave: (s) => s === 'balm' });
  assert.strictEqual(o.added.length, 0); assert.strictEqual(o.kept, 2);

  // mod sin permiso del autor: problema claro, y NO borra lo ya instalado
  cf.writeEntries(dir, [{ slug: 'x', modId: 300, title: 'Bloqueado' }]);
  o = await cf.syncCurseforge(dir, { http, log: () => {} });
  assert.ok(/no permite/.test(o.problems[0]));
  assert.ok(fs.existsSync(path.join(dir, 'files', 'mods', 'lib-1.0.jar')));

  // quitar el mod pedido: se limpia jar, source y lock
  cf.writeEntries(dir, []);
  o = await cf.syncCurseforge(dir, { http, log: () => {} });
  assert.deepStrictEqual(o.removed.sort(), ['lib-1.0.jar', 'twilightforest-1.20.1-4.3.jar']);
  assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'))).sources['mods/lib-1.0.jar']);

  // hash corrupto
  files[200][0].hashes = [{ algo: 1, value: 'deadbeef' }];
  cf.writeEntries(dir, [{ slug: 'lib', modId: 200, title: 'Lib' }]);
  await assert.rejects(cf.syncCurseforge(dir, { http, log: () => {} }), /hash no coincide/);
  // key rechazada: el mensaje trae el estado y el motivo; Cloudflare se distingue de una key mala
  const realFetch = global.fetch;
  global.fetch = async () => ({ status: 403, ok: false, text: async () => '{"error":"Invalid key"}' });
  await assert.rejects(cf.makeHttp('k').json('/games/432'), /HTTP 403: \{"error":"Invalid key"\}/);
  global.fetch = async () => ({ status: 403, ok: false, text: async () => '<html>Just a moment... Cloudflare</html>' });
  await assert.rejects(cf.makeHttp('k').json('/games/432'), /no es un problema de tu key/);
  global.fetch = realFetch;
  assert.strictEqual(cf.cleanKey('  x-api-key: "$2a$10$abc\n def" '), '$2a$10$abcdef');
  console.log('curseforge OK');
})().catch((e) => { console.error(e); process.exit(1); });
