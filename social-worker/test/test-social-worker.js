'use strict';
// Prueba el Worker de Atenas Social contra una base SQLite en memoria. Ejecutar: node social-worker/test/test-social-worker.js
const assert = require('assert');
const { makeD1 } = require('./d1shim');

(async () => {
  const worker = (await import('../worker.mjs')).default;
  const env = { DB: makeD1() };
  const TOK = { alice: 'a'.repeat(32), bob: 'b'.repeat(32), carol: 'c'.repeat(32) };
  const call = async (who, path, body, token) => {
    const res = await worker.fetch(new Request('https://x.test' + path, { method: 'POST', headers: { 'x-name': who, 'x-token': token || TOK[who.toLowerCase()], 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  let n = 0; const ok = (m) => console.log('  ok', ++n, m);

  // GET de comprobación
  const ping = await worker.fetch(new Request('https://x.test/'), env);
  assert.strictEqual((await ping.json()).name, 'atenas-social'); ok('GET / responde');

  // sin DB
  const noDb = await worker.fetch(new Request('https://x.test/sync', { method: 'POST' }), {});
  assert.strictEqual(noDb.status, 500); ok('sin D1 avisa claro');

  // registro por primer uso + nick ocupado
  assert.strictEqual((await call('Alice', '/sync')).ok, true); ok('Alice se registra');
  const steal = await call('Alice', '/sync', {}, 'z'.repeat(32));
  assert.strictEqual(steal.status, 403); assert.strictEqual(steal.error, 'nick_taken'); ok('otro token no puede usar el nick');
  assert.strictEqual((await call('alice', '/sync')).ok, true); ok('mayúsculas no cambian al dueño');
  assert.strictEqual((await call('x', '/sync')).status, 400); ok('nick inválido rechazado');
  await call('Bob', '/sync'); await call('Carol', '/sync');

  // solicitudes
  const toUnknown = await call('Alice', '/friends/add', { to: 'Nadie_xx' });
  assert.strictEqual(toUnknown.status, 404); ok('no se puede pedir amistad a quien no existe');
  assert.strictEqual((await call('Alice', '/friends/add', { to: 'alice' })).error, 'self'); ok('no puedes agregarte a ti mismo');
  assert.strictEqual((await call('Alice', '/friends/add', { to: 'Bob' })).result, 'sent'); ok('Alice envía solicitud a Bob');
  assert.strictEqual((await call('Alice', '/friends/add', { to: 'Bob' })).error, 'pending'); ok('no se duplica');
  let s = await call('Bob', '/sync');
  assert.deepStrictEqual(s.incoming.map((x) => x.name), ['Alice']); assert.strictEqual(s.friends.length, 0); ok('Bob ve la solicitud entrante');
  s = await call('Alice', '/sync');
  assert.deepStrictEqual(s.outgoing.map((x) => x.name), ['Bob']); ok('Alice ve la saliente');
  assert.strictEqual((await call('Alice', '/chat/send', { to: 'Bob', body: 'hola' })).error, 'not_friends'); ok('sin amistad no hay chat');
  assert.strictEqual((await call('Alice', '/friends/accept', { name: 'Bob' })).status, 404); ok('el que envió no puede aceptar su propia solicitud');
  assert.strictEqual((await call('Bob', '/friends/accept', { name: 'Alice' })).ok, true); ok('Bob acepta');
  s = await call('Alice', '/sync');
  assert.deepStrictEqual(s.friends.map((x) => x.name), ['Bob']); assert.strictEqual(s.outgoing.length, 0); ok('ya son amigos');

  // solicitudes cruzadas se aceptan solas
  await call('Carol', '/friends/add', { to: 'Alice' });
  assert.strictEqual((await call('Alice', '/friends/add', { to: 'Carol' })).result, 'accepted'); ok('solicitud cruzada = amigos al instante');

  // rechazar / cancelar
  await call('Bob', '/friends/remove', { name: 'Carol' }); // no existe: no falla
  await call('Bob', '/friends/add', { to: 'Carol' });
  assert.strictEqual((await call('Carol', '/sync')).incoming.length, 1);
  await call('Carol', '/friends/remove', { name: 'Bob' });
  assert.strictEqual((await call('Carol', '/sync')).incoming.length, 0); ok('rechazar solicitud');
  await call('Bob', '/friends/add', { to: 'Carol' }); await call('Bob', '/friends/remove', { name: 'Carol' });
  assert.strictEqual((await call('Carol', '/sync')).incoming.length, 0); ok('cancelar solicitud enviada');

  // presencia
  s = await call('Bob', '/sync');
  assert.strictEqual(s.friends.find((f) => f.name === 'Alice').state, 'offline'); ok('sin avisos = desconectado');
  await call('Alice', '/sync', { presence: { source: 'launcher' } });
  s = await call('Bob', '/sync');
  assert.strictEqual(s.friends.find((f) => f.name === 'Alice').state, 'online'); ok('launcher abierto = en línea');
  await call('Alice', '/sync', { presence: { source: 'launcher', playing: true, pack: 'Atenas SMP' } });
  let f = (await call('Bob', '/sync')).friends.find((x) => x.name === 'Alice');
  assert.strictEqual(f.state, 'playing'); assert.strictEqual(f.pack, 'Atenas SMP'); ok('jugando desde el launcher');
  await call('Alice', '/sync', { presence: { source: 'game', server: 'arefy.net', pack: 'Atenas Client' } });
  f = (await call('Bob', '/sync')).friends.find((x) => x.name === 'Alice');
  assert.strictEqual(f.server, 'arefy.net'); ok('el cliente informa el servidor');
  await call('Alice', '/sync', { presence: { source: 'game', offline: true } });
  await call('Alice', '/sync', { presence: { source: 'launcher', offline: true } });
  f = (await call('Bob', '/sync')).friends.find((x) => x.name === 'Alice');
  assert.strictEqual(f.state, 'offline'); ok('salir = desconectado');
  // caducidad
  env.DB.raw.prepare('UPDATE users SET launcher_ts = ?, l_playing = 0 WHERE name = ?').run(Date.now() - 600000, 'alice');
  assert.strictEqual((await call('Bob', '/sync')).friends.find((x) => x.name === 'Alice').state, 'offline'); ok('un aviso viejo no cuenta');
  // no reescribe cada vez
  await call('Alice', '/sync', { presence: { source: 'launcher' } });
  const t1 = env.DB.raw.prepare('SELECT launcher_ts t FROM users WHERE name = ?').get('alice').t;
  await new Promise((r) => setTimeout(r, 15));
  await call('Alice', '/sync', { presence: { source: 'launcher' } });
  assert.strictEqual(env.DB.raw.prepare('SELECT launcher_ts t FROM users WHERE name = ?').get('alice').t, t1); ok('presencia igual no se reescribe (cuida D1)');

  // chat
  const m1 = await call('Alice', '/chat/send', { to: 'Bob', body: '  hola Bob  ' });
  assert.strictEqual(m1.message.body, 'hola Bob'); ok('Alice escribe');
  assert.strictEqual((await call('Alice', '/chat/send', { to: 'Bob', body: 'otra' })).error, 'slow'); ok('límite de velocidad');
  await new Promise((r) => setTimeout(r, 520));
  assert.strictEqual((await call('Alice', '/chat/send', { to: 'Bob', body: 'x'.repeat(600) })).message.body.length, 300); ok('mensaje recortado a 300');
  assert.strictEqual((await call('Alice', '/chat/send', { to: 'Bob', body: '   ' })).error, 'empty'); ok('vacío rechazado');
  s = await call('Bob', '/sync');
  const fa = s.friends.find((x) => x.name === 'Alice');
  assert.strictEqual(fa.unread, 2); assert.strictEqual(s.unread, 2); assert.strictEqual(fa.preview.body.length, 80); ok('Bob ve 2 sin leer con vista previa');
  let h = await call('Bob', '/chat/history', { with: 'Alice' });
  assert.strictEqual(h.messages.length, 2); assert.strictEqual(h.messages[0].mine, false); ok('historial correcto');
  assert.strictEqual((await call('Bob', '/sync')).unread, 0); ok('leer limpia los no leídos');
  const last = h.messages[1].id;
  await new Promise((r) => setTimeout(r, 520));
  await call('Bob', '/chat/send', { to: 'Alice', body: 'hola Alice' });
  h = await call('Alice', '/chat/history', { with: 'Bob', after: last });
  assert.deepStrictEqual(h.messages.map((m) => [m.mine, m.body]), [[false, 'hola Alice']]); ok('"after" devuelve solo lo nuevo');
  assert.strictEqual((await call('Carol', '/chat/history', { with: 'Bob' })).status, 403); ok('no se leen chats ajenos');

  // poda
  for (let i = 0; i < 205; i++) env.DB.raw.prepare('INSERT INTO messages (sender, recipient, body, ts, read) VALUES (?,?,?,?,1)').run('alice', 'bob', 'm' + i, Date.now());
  await new Promise((r) => setTimeout(r, 520));
  await call('Alice', '/chat/send', { to: 'Bob', body: 'fin' });
  const cnt = env.DB.raw.prepare("SELECT COUNT(*) c FROM messages WHERE (sender='alice' AND recipient='bob') OR (sender='bob' AND recipient='alice')").get().c;
  assert.ok(cnt <= 200 && cnt >= 199, 'conteo ' + cnt); ok('solo se guardan los últimos 200 mensajes');

  // borrar amigo = borra el chat
  await call('Bob', '/friends/remove', { name: 'Alice' });
  assert.strictEqual(env.DB.raw.prepare("SELECT COUNT(*) c FROM messages WHERE (sender='alice' AND recipient='bob') OR (sender='bob' AND recipient='alice')").get().c, 0);
  assert.strictEqual((await call('Alice', '/sync')).friends.some((x) => x.name === 'Bob'), false); ok('quitar amigo borra la amistad y el chat');

  // nick abandonado se puede reclamar
  env.DB.raw.prepare('UPDATE users SET launcher_ts = 0, game_ts = 0, created = ? WHERE name = ?').run(Date.now() - 40 * 86400000, 'carol');
  assert.strictEqual((await call('Carol', '/sync', {}, 'q'.repeat(32))).ok, true); ok('nick sin uso 30 días se puede reclamar');

  // cosméticos
  await call('Alice', '/sync'); await call('Bob', '/sync');
  assert.strictEqual((await call('Alice', '/cosmetics/set', { cape: 'violeta', wings: 'neon', hat: 'Mal Id!' })).ok, true); ok('Alice guarda sus cosméticos');
  let cs = await call('Bob', '/cosmetics/get', { names: ['ALICE', 'nadie_xx', 'x', 'alice'] });
  assert.deepStrictEqual(cs.players.alice, { cape: 'violeta', wings: 'neon', hat: 'none' }); ok('Bob ve los de Alice (ids raros pasan a "none")');
  assert.strictEqual(cs.players.nadie_xx, undefined); ok('quien no tiene cosméticos no aparece');
  await call('Alice', '/cosmetics/set', { cape: 'oro', wings: 'none', hat: 'corona' });
  cs = await call('Bob', '/cosmetics/get', { names: ['alice'] });
  assert.deepStrictEqual(cs.players.alice, { cape: 'oro', wings: 'none', hat: 'corona' }); ok('cambiar cosméticos reemplaza los anteriores');
  assert.deepStrictEqual((await call('Bob', '/cosmetics/get', { names: 'no-es-lista' })).players, {}); ok('lista inválida no rompe nada');

  console.log('social worker: todo bien (' + n + ' comprobaciones)');
})().catch((e) => { console.error(e); process.exit(1); });

