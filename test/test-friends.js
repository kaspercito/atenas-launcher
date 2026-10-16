'use strict';
// Pruebas de amigos: lista de estados, reloj desfasado, y el servicio de presencia (docs/presence-worker.js) de punta a punta
// con un KV falso y un servidor HTTP local que habla con las funciones reales del launcher.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { cleanName, getPresence, putPresence, buildFriendList, ageOf, FRESH_MS } = require('../src/lib/friends');

// ---- Worker cargado desde el archivo real (es un módulo ES: se adapta a CommonJS) ----
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'presence-worker.js'), 'utf8').replace('export default', 'module.exports =');
const worker = (() => { const m = { exports: {} }; new Function('module', 'Response', 'Request', 'URL', src)(m, Response, Request, URL); return m.exports; })();

function fakeKv() {
  const db = new Map(); const stat = { puts: 0, deletes: 0 };
  return {
    stat, db,
    async get(k, type) { const v = db.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v, opts) { stat.puts++; db.set(k, v); assert.ok(opts && opts.expirationTtl >= 60, 'KV exige un TTL de al menos 60 s'); },
    async delete(k) { stat.deletes++; db.delete(k); },
  };
}

(async () => {
  // ---- nombres ----
  assert.strictEqual(cleanName('  Kasper_1 '), 'Kasper_1');
  assert.throws(() => cleanName('ab'));
  assert.throws(() => cleanName('nombre con espacio'));
  console.log('ok 1: nombres');

  // ---- estados ----
  const NOW = 1_000_000_000_000;
  const pres = {
    ana: { pack: 'Atenas SMP', playing: true, age: 20000 },
    luis: { pack: '', playing: false, age: 60000 },
    pepe: { pack: '', playing: false, age: FRESH_MS + 1000 },          // aviso viejo → desconectado
    tito: { pack: 'X', playing: true, ts: NOW - 5000 },                // Worker antiguo (solo ts)
    omar: { pack: 'X', playing: true, ts: NOW - 99_999_999 },
  };
  const list = buildFriendList(['Ana', 'Luis', 'Pepe', 'Tito', 'Omar', 'Zoe', 'Kai'], pres, new Set(['kai', 'ana']), NOW);
  const st = Object.fromEntries(list.map((f) => [f.name, f.status]));
  assert.deepStrictEqual(st, { Ana: 'server', Luis: 'online', Pepe: 'offline', Tito: 'playing', Omar: 'offline', Zoe: 'offline', Kai: 'server' });
  assert.strictEqual(list.find((f) => f.name === 'Tito').where, 'Jugando X');
  assert.strictEqual(ageOf({ age: 5, ts: 1 }, NOW), 5, '"age" manda sobre "ts"');
  // reloj del PC adelantado 1 hora: con "age" no importa
  const skew = buildFriendList(['Ana'], { ana: { playing: true, pack: 'P', age: 1000 } }, new Set(), NOW + 3_600_000);
  assert.strictEqual(skew[0].status, 'playing');
  console.log('ok 2: estados (servidor, jugando, launcher, caducado, reloj desfasado)');

  // ---- Worker + cliente de punta a punta ----
  const env = { PRESENCE: fakeKv() };
  const srv = http.createServer(async (rq, rs) => {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request('http://x' + rq.url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body }), env);
    rs.writeHead(r.status, Object.fromEntries(r.headers)); rs.end(Buffer.from(await r.arrayBuffer()));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port;

  try {
    assert.strictEqual(await putPresence(url, { name: 'Ana', pack: 'Atenas SMP', playing: false }), true);
    let got = await getPresence(url, ['Ana', 'Nadie']);
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.data.ana.pack, 'Atenas SMP');
    assert.strictEqual(typeof got.data.ana.age, 'number');
    assert.ok(!('nadie' in got.data));
    assert.ok(!('ts' in got.data.ana), 'el Worker no expone su reloj, solo la antigüedad');
    console.log('ok 3: avisar y consultar presencia');

    // ahorro de escrituras (KV gratis = 1000/día)
    const before = env.PRESENCE.stat.puts;
    for (let i = 0; i < 20; i++) await putPresence(url, { name: 'Ana', pack: 'Atenas SMP', playing: false });
    assert.strictEqual(env.PRESENCE.stat.puts, before, 'avisos iguales no deben escribir');
    await putPresence(url, { name: 'Ana', pack: 'Atenas SMP', playing: true });
    assert.strictEqual(env.PRESENCE.stat.puts, before + 1, 'un cambio de estado sí escribe');
    // pasados 200 s se renueva
    const rec = JSON.parse(env.PRESENCE.db.get('ana')); rec.ts -= 201000; env.PRESENCE.db.set('ana', JSON.stringify(rec));
    await putPresence(url, { name: 'Ana', pack: 'Atenas SMP', playing: true });
    assert.strictEqual(env.PRESENCE.stat.puts, before + 2, 'se renueva pasado el tiempo');
    console.log('ok 4: no malgasta escrituras del KV');

    // salir
    assert.strictEqual(await putPresence(url, { name: 'Ana', offline: true }), true);
    got = await getPresence(url, ['Ana']);
    assert.deepStrictEqual(got.data, {});
    console.log('ok 5: al salir desaparece al instante');

    // entradas inválidas
    assert.strictEqual(await putPresence(url, { name: 'x' }), false);
    assert.strictEqual(await putPresence(url, { name: 'Ana', pack: 'a'.repeat(5000) }), false, 'cuerpo enorme rechazado');
    const raw = await fetch(url + '/presence', { method: 'POST', body: 'no es json' });
    assert.strictEqual(raw.status, 400);
    assert.strictEqual((await fetch(url + '/presence', { method: 'DELETE' })).status, 405);
    console.log('ok 6: entradas inválidas rechazadas');

    // límite de 50 nombres y sin duplicados
    const many = Array.from({ length: 80 }, (_, i) => 'user' + String(i).padStart(3, '0'));
    for (const n of many) env.PRESENCE.db.set(n, JSON.stringify({ pack: '', playing: false, ts: Date.now() }));
    got = await getPresence(url, many.concat(many));
    assert.strictEqual(Object.keys(got.data).length, 50);
    console.log('ok 7: máximo 50 nombres por consulta');
  } finally { srv.close(); }

  // ---- fallos: servicio caído / mal configurado ----
  assert.deepStrictEqual(await getPresence('', ['Ana']), { ok: false, configured: false, data: {} });
  assert.strictEqual((await getPresence('http://127.0.0.1:1', ['Ana'])).ok, false, 'caído → ok=false (no "todos desconectados")');
  assert.strictEqual(await putPresence('http://127.0.0.1:1', { name: 'Ana' }), false);
  const noKv = await worker.fetch(new Request('http://x/presence?names=ana'), {});
  assert.strictEqual(noKv.status, 500, 'sin KV enlazado avisa claro');
  console.log('ok 8: servicio caído o sin KV');

  console.log('\nOK friends');
})().catch((e) => { console.error(e); process.exit(1); });
