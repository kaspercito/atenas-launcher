'use strict';
// Exclusividad de cosméticos, catálogo personalizado y panel /admin. Ejecutar: node social-worker/test/test-cosmetics-admin.js
const assert = require('assert');
const zlib = require('zlib');
const { makeD1 } = require('./d1shim');
const { verifyPremium } = require('./mojang-mock');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgba = [200, 80, 255, 255]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = rgba[0]; raw[o + 1] = rgba[1]; raw[o + 2] = rgba[2]; raw[o + 3] = rgba[3]; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const worker = (await import('../worker.mjs')).default;
  const env = { DB: makeD1(), ADMIN_KEY: 'clave-de-prueba-larga-123' };
  const tok = (n) => n.toLowerCase().padEnd(32, 'x');
  const call = async (who, path, body) => {
    const res = await worker.fetch(new Request('https://x.test' + path, { method: 'POST', headers: { 'x-name': who, 'x-token': tok(who), 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  const admin = async (path, body, key = env.ADMIN_KEY, e = env) => {
    const res = await worker.fetch(new Request('https://x.test' + path, { method: 'POST', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }), e);
    return { status: res.status, ...(await res.json()) };
  };
  let n = 0; const ok = (m) => console.log('  ok', ++n, m);
  const getOf = async (viewer, names) => (await call(viewer, '/cosmetics/get', { names })).players;

  for (const who of ['Kaspercitoo', 'Alice', 'Bob']) await call(who, '/sync');
  // Los cosméticos privados exigen cuenta premium verificada con Mojang: aquí los tres lo son (lo no verificado se prueba en test-verify.js).
  for (const who of ['Kaspercitoo', 'Alice', 'Bob']) assert.strictEqual((await verifyPremium(call, who)).verified, true);

  // ---- Catalina: exclusiva desde el primer arranque
  let r = await call('Alice', '/cosmetics/set', { cape: 'atenas', pet: 'catalina' });
  assert.deepStrictEqual(r.denied, [{ type: 'pet', id: 'catalina' }]); ok('Alice NO puede guardar a Catalina');
  assert.strictEqual((await getOf('Bob', ['alice'])).alice.pet, 'none'); assert.strictEqual((await getOf('Bob', ['alice'])).alice.cape, 'atenas'); ok('lo demás de Alice se conserva');
  r = await call('Kaspercitoo', '/cosmetics/set', { pet: 'catalina', wings: 'dragon' });
  assert.deepStrictEqual(r.denied, []); ok('kaspercitoo sí');
  assert.strictEqual((await getOf('Alice', ['kaspercitoo'])).kaspercitoo.pet, 'catalina'); ok('todos ven a Catalina en kaspercitoo');
  assert.strictEqual((await call('KASPERCITOO', '/cosmetics/set', { hat: 'gorra' })).denied.length, 0); ok('mayúsculas del nick no importan');
  assert.strictEqual((await getOf('Bob', ['kaspercitoo'])).kaspercitoo.pet, 'catalina'); ok('un cambio parcial no borra a Catalina');
  // un registro viejo (de antes de la regla) con Catalina en otra persona NO se entrega
  env.DB.raw.prepare("INSERT INTO cosmetics (name, data, ts) VALUES ('bob', ?, 1) ON CONFLICT(name) DO UPDATE SET data = excluded.data").run(JSON.stringify({ cape: 'none', wings: 'none', hat: 'none', pet: 'catalina' }));
  assert.strictEqual((await getOf('Alice', ['bob'])).bob.pet, 'none'); ok('datos viejos con Catalina en otro nick se filtran al leer');
  r = await call('Bob', '/cosmetics/set', { hat: 'halo' });
  assert.deepStrictEqual(r.denied, [{ type: 'pet', id: 'catalina' }]); ok('y al guardar cualquier cosa se limpia');

  // ---- catálogo
  let cat = await call('Alice', '/cosmetics/catalog', {});
  const cl = cat.items.find((i) => i.id === 'catalina');
  assert.ok(cl && cl.scope === 'private' && !cl.custom && cl.owners.includes('kaspercitoo')); ok('el catálogo publica la regla de Catalina');
  const rev0 = cat.rev;
  assert.strictEqual((await call('Alice', '/cosmetics/catalog', { rev: rev0 })).unchanged, true); ok('catálogo sin cambios = respuesta mínima');

  // ---- panel: acceso
  const page = await worker.fetch(new Request('https://x.test/admin'), env);
  assert.strictEqual(page.status, 200); assert.ok((page.headers.get('content-type') || '').includes('text/html')); ok('GET /admin sirve la página');
  assert.strictEqual((await admin('/admin/list', {}, 'x', { DB: env.DB })).error, 'admin_disabled'); ok('sin ADMIN_KEY el panel está apagado');
  assert.strictEqual((await admin('/admin/list', {}, 'mala')).error, 'bad_key'); ok('clave mala rechazada');
  assert.strictEqual((await admin('/admin/list', {})).ok, true); ok('clave buena entra');
  for (let i = 0; i < 10; i++) await admin('/admin/list', {}, 'mala');
  assert.strictEqual((await admin('/admin/list', {}, 'mala')).status, 429); ok('freno tras demasiados intentos');
  assert.strictEqual((await admin('/admin/list', {})).status, 429); ok('el freno también corta a la clave buena (anti fuerza bruta)');
  env.DB.raw.prepare("DELETE FROM meta WHERE k = 'admin_fail'").run();
  assert.strictEqual((await admin('/admin/list', {})).ok, true); ok('el freno se libera');
  // un POST normal a /admin con token de jugador no sirve
  assert.strictEqual((await call('Alice', '/admin/save', {})).error, 'bad_key'); ok('un jugador no puede usar /admin');

  // ---- panel: regla sobre un cosmético incorporado
  r = await admin('/admin/save', { type: 'wings', id: 'dragon', custom: false, scope: 'private', owners: ['Alice'], name: 'Dragón' });
  assert.ok(r.ok); ok('regla: alas "dragon" solo de Alice');
  assert.strictEqual((await call('Bob', '/cosmetics/set', { wings: 'dragon' })).denied.length, 1); ok('Bob no puede');
  assert.strictEqual((await call('Alice', '/cosmetics/set', { wings: 'dragon' })).denied.length, 0); ok('Alice sí');
  assert.strictEqual((await getOf('Bob', ['kaspercitoo'])).kaspercitoo.wings, 'none'); ok('kaspercitoo tenía "dragon" antes de la regla: ahora no se entrega');
  const rev1 = (await call('Alice', '/cosmetics/catalog', { rev: rev0 }));
  assert.ok(!rev1.unchanged && rev1.rev !== rev0); ok('cambiar una regla cambia la revisión');
  r = await admin('/admin/save', { type: 'wings', id: 'dragon', custom: false, scope: 'global' });
  assert.ok(r.removed); assert.strictEqual((await call('Bob', '/cosmetics/set', { wings: 'dragon' })).denied.length, 0); ok('volver a global quita la regla');

  // ---- panel: cosmético personalizado
  const tex = png(64, 64), icon = png(32, 32, [10, 200, 90, 255]);
  const base = { type: 'hat', id: 'x_gorro_azul', name: 'Gorro azul', custom: true, base: 'gorra', color: 0xff2447b8, glow: false, scope: 'private', owners: ['bob', 'Alice'], tex_b64: tex.toString('base64'), icon_b64: icon.toString('base64') };
  r = await admin('/admin/save', base);
  assert.ok(r.ok && r.ver === 1); ok('crea cosmético personalizado privado (ver 1)');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'gorro' })).error, 'bad_id'); ok('los id nuevos deben empezar por x_');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'x_a', tex_b64: Buffer.from('no soy png').toString('base64') })).error, 'bad_png'); ok('una textura que no es PNG se rechaza');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'x_a', icon_b64: png(16, 16).toString('base64') })).error, 'bad_png'); ok('el icono debe ser 32x32');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'x_b', tex_b64: undefined })).error, 'no_tex'); ok('sin textura no se crea');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'x_c', base: '' })).error, 'bad_base'); ok('sin modelo base no se crea');
  assert.strictEqual((await admin('/admin/save', { ...base, id: 'x_c', type: 'pelo' })).error, 'bad_type'); ok('tipo inválido');
  assert.strictEqual((await admin('/admin/save', { type: 'hat', id: 'gorra', custom: true, name: 'x', base: 'gorra', tex_b64: base.tex_b64, icon_b64: base.icon_b64 })).error, 'bad_id'); ok('no se puede pisar un id del mod');
  assert.strictEqual((await call('Kaspercitoo', '/cosmetics/set', { hat: 'x_gorro_azul' })).denied.length, 1); ok('kaspercitoo no está en la lista');
  assert.strictEqual((await call('Bob', '/cosmetics/set', { hat: 'x_gorro_azul' })).denied.length, 0); ok('Bob sí');
  cat = await call('Alice', '/cosmetics/catalog', {});
  const it = cat.items.find((i) => i.id === 'x_gorro_azul');
  assert.deepStrictEqual({ base: it.base, custom: it.custom, scope: it.scope, ver: it.ver, owners: it.owners.sort(), color: it.color }, { base: 'gorra', custom: true, scope: 'private', ver: 1, owners: ['alice', 'bob'], color: 0xff2447b8 }); ok('el catálogo lo describe bien');
  let a = await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:x_gorro_azul&kind=tex&v=1'), env);
  assert.strictEqual(a.status, 200); assert.strictEqual(a.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await a.arrayBuffer()).equals(tex)); ok('la textura se descarga idéntica');
  a = await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:x_gorro_azul&kind=icon'), env);
  assert.ok(Buffer.from(await a.arrayBuffer()).equals(icon)); ok('el icono también');
  assert.strictEqual((await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:x_nada&kind=tex'), env)).status, 404); ok('asset inexistente = 404');
  assert.strictEqual((await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:gorra%27--&kind=tex'), env)).status, 400); ok('clave rara = 400');
  assert.strictEqual((await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:gorra&kind=tex'), env)).status, 400); ok('solo se sirven assets de cosméticos x_');

  // editar sin tocar la textura: conserva assets, no sube la versión de la textura
  r = await admin('/admin/save', { ...base, tex_b64: undefined, icon_b64: undefined, name: 'Gorro Azul II', owners: ['bob'] });
  assert.ok(r.ok && r.ver === 1); ok('editar nombre/dueños conserva textura y versión');
  assert.strictEqual((await call('Alice', '/cosmetics/set', { hat: 'x_gorro_azul' })).denied.length, 1); ok('Alice ya no está en la lista');
  assert.strictEqual((await getOf('Alice', ['alice'])).alice.hat, 'none'); ok('y su registro antiguo deja de entregarse');
  // reemplazar textura
  const tex2 = png(64, 64, [1, 2, 3, 255]);
  r = await admin('/admin/save', { ...base, owners: ['bob'], tex_b64: tex2.toString('base64'), icon_b64: undefined });
  assert.strictEqual(r.ver, 2); ok('cambiar la textura sube la versión (los clientes la vuelven a bajar)');
  a = await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:x_gorro_azul&kind=tex&v=2'), env);
  assert.ok(Buffer.from(await a.arrayBuffer()).equals(tex2)); ok('sirve la nueva');
  // global
  r = await admin('/admin/save', { ...base, id: 'x_global', name: 'Para todos', scope: 'global', owners: [] });
  assert.ok(r.ok); assert.strictEqual((await call('Kaspercitoo', '/cosmetics/set', { hat: 'x_global' })).denied.length, 0); ok('global: cualquiera lo puede llevar');
  assert.strictEqual((await getOf('Alice', ['kaspercitoo'])).kaspercitoo.hat, 'x_global'); ok('y todos lo ven');

  // listar / jugadores / borrar
  const list = await admin('/admin/list', {});
  assert.ok(list.items.some((i) => i.key === 'pet:catalina') && list.items.some((i) => i.key === 'hat:x_global')); ok('el panel lista reglas y cosméticos');
  const pl = await admin('/admin/players', { q: 'kasp' });
  assert.deepStrictEqual(pl.players.map((p) => p.name), ['Kaspercitoo']); ok('buscar jugadores por texto');
  r = await admin('/admin/delete', { key: 'hat:x_global' });
  assert.ok(r.ok); assert.strictEqual((await worker.fetch(new Request('https://x.test/cosmetics/asset?key=hat:x_global&kind=tex'), env)).status, 404); ok('borrar quita el cosmético y sus archivos');
  assert.strictEqual((await admin('/admin/delete', { key: 'hat:../x' })).error, 'bad_key'); ok('borrar valida la clave');

  // ---- la regla de Catalina se puede editar y NO vuelve sola al reiniciar el Worker
  r = await admin('/admin/save', { type: 'pet', id: 'catalina', custom: false, scope: 'private', owners: ['kaspercitoo', 'alice'] });
  assert.ok(r.ok); assert.strictEqual((await call('Alice', '/cosmetics/set', { pet: 'catalina' })).denied.length, 0); ok('se puede compartir a Catalina con otra persona');
  await admin('/admin/delete', { key: 'pet:catalina' });
  const worker2 = (await import('../worker.mjs?otra-instancia')).default; // simula un reinicio en frío del Worker
  const res = await worker2.fetch(new Request('https://x.test/cosmetics/catalog', { method: 'POST', headers: { 'x-name': 'Alice', 'x-token': tok('Alice') }, body: '{}' }), env);
  const c2 = await res.json();
  assert.ok(!c2.items.some((i) => i.id === 'catalina')); ok('si borras la regla, un reinicio no la resucita');

  console.log('cosméticos/admin: todo bien (' + n + ' comprobaciones)');
})().catch((e) => { console.error(e); process.exit(1); });
