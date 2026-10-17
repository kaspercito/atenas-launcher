'use strict';
// Prueba la librería social del launcher (src/lib/social.js) contra el Worker real (social-worker/worker.mjs)
// usando un servidor HTTP local y una base SQLite en memoria.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createSocial, loadIdentity, mergeServer, diffSnapshots, cleanName } = require('../src/lib/social');
const { makeD1 } = require('../social-worker/test/d1shim');

(async () => {
  const worker = (await import('../social-worker/worker.mjs')).default;
  const env = { DB: makeD1() };
  const srv = http.createServer(async (rq, rs) => {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const r = await worker.fetch(new Request('http://x' + rq.url, { method: rq.method, headers: rq.headers, body: rq.method === 'GET' ? undefined : Buffer.concat(chunks) }), env);
    rs.writeHead(r.status, Object.fromEntries(r.headers)); rs.end(Buffer.from(await r.arrayBuffer()));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-social-'));

  try {
    assert.strictEqual(cleanName(' Kasper_1 '), 'Kasper_1');
    assert.throws(() => cleanName('ab'));
    console.log('ok 1: nombres');

    // identidad compartida con el cliente de Minecraft
    const f = path.join(tmp, 'social.json');
    const id1 = loadIdentity(f, url + '/');
    const id2 = loadIdentity(f, url);
    assert.strictEqual(id1.token, id2.token); assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).url, url);
    assert.ok(id1.token.length >= 32);
    console.log('ok 2: la clave y la URL se guardan en social.json y no cambian');

    let nameA = 'Ana', nameB = 'Beto';
    const A = createSocial({ url, file: path.join(tmp, 'a.json'), getName: () => nameA });
    const B = createSocial({ url, file: path.join(tmp, 'b.json'), getName: () => nameB });
    await A.sync({ source: 'launcher' }); await B.sync({ source: 'launcher' });
    await A.add('Beto');
    let sb = await B.sync({ source: 'launcher' });
    assert.deepStrictEqual(sb.incoming.map((r) => r.name), ['Ana']);
    await B.accept('Ana');
    const sa = await A.sync({ source: 'launcher', playing: true, pack: 'Atenas SMP' });
    assert.deepStrictEqual(sa.friends.map((x) => [x.name, x.state]), [['Beto', 'online']]);
    sb = await B.sync({ source: 'launcher' });
    assert.deepStrictEqual(sb.friends.map((x) => [x.name, x.state, x.pack]), [['Ana', 'playing', 'Atenas SMP']]);
    console.log('ok 3: solicitud → aceptar → amigos con estado');

    await A.send('Beto', 'hola');
    const prev = await B.sync();
    assert.strictEqual(prev.friends[0].unread, 1);
    const hist = await B.history('Ana');
    assert.deepStrictEqual(hist.messages.map((m) => [m.mine, m.body]), [[false, 'hola']]);
    assert.strictEqual((await B.sync()).unread, 0);
    console.log('ok 4: chat y no leídos');

    // errores claros
    await assert.rejects(() => A.add('Beto'), (e) => e.code === 'already' && /Ya eres amigo/.test(e.message));
    await assert.rejects(() => A.add('x'), /no válido/);
    await assert.rejects(() => A.add('Nadie_zz'), (e) => e.code === 'not_found');
    nameA = null;
    await assert.rejects(() => A.sync(), (e) => e.code === 'no_account');
    nameA = 'Ana';
    const off = createSocial({ url: 'http://127.0.0.1:1', file: path.join(tmp, 'c.json'), getName: () => 'Ana', timeoutMs: 800 });
    await assert.rejects(() => off.sync(), (e) => e.code === 'offline');
    const none = createSocial({ url: '', file: path.join(tmp, 'd.json'), getName: () => 'Ana' });
    assert.strictEqual(none.configured, false);
    await assert.rejects(() => none.sync(), (e) => e.code === 'not_configured');
    const thief = createSocial({ url, file: path.join(tmp, 'e.json'), getName: () => 'Ana' });
    await assert.rejects(() => thief.sync(), (e) => e.code === 'nick_taken');
    console.log('ok 5: errores (ya amigos, nick inválido, sin cuenta, sin internet, sin configurar, nick ajeno)');

    // diferencias entre dos fotos: lo que dispara avisos
    const base = { friends: [{ key: 'ana', name: 'Ana', state: 'offline', unread: 0, preview: null }], incoming: [], outgoing: [{ key: 'luis', name: 'Luis' }] };
    const next = {
      friends: [{ key: 'ana', name: 'Ana', state: 'online', unread: 1, preview: { id: 5, body: 'hey' } }, { key: 'luis', name: 'Luis', state: 'offline', unread: 0, preview: null }],
      incoming: [{ key: 'zoe', name: 'Zoe' }], outgoing: [],
    };
    const d = diffSnapshots(base, next);
    assert.deepStrictEqual([d.requests.map((x) => x.name), d.messages.map((x) => x.name), d.came.map((x) => x.name), d.accepted.map((x) => x.name)], [['Zoe'], ['Ana'], ['Ana'], ['Luis']]);
    assert.deepStrictEqual(diffSnapshots(next, next), { requests: [], messages: [], came: [], accepted: [] });
    assert.deepStrictEqual(diffSnapshots(null, next), { requests: [], messages: [], came: [], accepted: [] });
    console.log('ok 6: detecta solicitudes, mensajes, conexiones y aceptaciones nuevas');

    const merged = mergeServer([{ name: 'Ana', state: 'offline', server: '', pack: '' }, { name: 'Zoe', state: 'online', server: '', pack: '' }], new Set(['ana']));
    assert.strictEqual(merged[0].state, 'playing'); assert.strictEqual(merged[1].state, 'online');
    console.log('ok 7: amigos vistos en el servidor se marcan jugando');
  } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('\nOK social');
})().catch((e) => { console.error(e); process.exit(1); });
