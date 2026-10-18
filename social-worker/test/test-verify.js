'use strict';
// Verificación de cuentas premium con Mojang y cosméticos privados. Ejecutar: node social-worker/test/test-verify.js
const assert = require('assert');
const { makeD1 } = require('./d1shim');
const mojang = require('./mojang-mock');

globalThis.ATENAS_HASJOINED_WAITS = [0]; // los tests no esperan reintentos salvo el que los prueba

(async () => {
  const worker = (await import('../worker.mjs')).default;
  const env = { DB: makeD1(), ADMIN_KEY: 'clave-de-prueba-larga-123' };
  const tok = (c) => c.repeat(32);
  const call = async (who, path, body, token) => {
    const res = await worker.fetch(new Request('https://x.test' + path, { method: 'POST', headers: { 'x-name': who, 'x-token': token || tok(who[0].toLowerCase()), 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }), env);
    return { status: res.status, ...(await res.json()) };
  };
  const row = (n) => ({ ...env.DB.raw.prepare('SELECT verified, uuid FROM users WHERE name = ?').get(n) });
  const getOf = async (viewer, names) => (await call(viewer, '/cosmetics/get', { names })).players;
  let n = 0; const ok = (m) => console.log('  ok', ++n, m);

  // ---- migración: una base vieja (users sin las columnas nuevas) se actualiza sola y sin perder datos
  const old = makeD1();
  old.raw.exec("CREATE TABLE users (name TEXT PRIMARY KEY, display TEXT NOT NULL, token TEXT NOT NULL, launcher_ts INTEGER NOT NULL DEFAULT 0, game_ts INTEGER NOT NULL DEFAULT 0, l_playing INTEGER NOT NULL DEFAULT 0, pack TEXT NOT NULL DEFAULT '', server TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)");
  old.raw.exec("INSERT INTO users (name, display, token, created) VALUES ('viejo', 'Viejo', 'h', 1)");
  const workerOld = (await import('../worker.mjs?base-antigua')).default; // otra copia del módulo: el Worker recuerda que ya migró su (única) base
  const resOld = await workerOld.fetch(new Request('https://x.test/sync', { method: 'POST', headers: { 'x-name': 'Viejo', 'x-token': 'v'.repeat(32) }, body: '{}' }), { DB: old });
  assert.strictEqual((await resOld.json()).verified, false);
  assert.deepStrictEqual({ ...old.raw.prepare('SELECT verified, uuid FROM users WHERE name = ?').get('viejo') }, { verified: 0, uuid: '' }); ok('una base antigua gana las columnas verified/uuid sin perder usuarios');

  // ---- cuentas sin verificar (sin conexión): todo funciona menos lo privado
  await call('Kaspercitoo', '/sync');
  assert.strictEqual(row('kaspercitoo').verified, 0); ok('un nick nuevo empieza sin verificar');
  assert.strictEqual((await call('Kaspercitoo', '/sync')).verified, false); ok('/sync dice verified: false');
  let r = await call('Kaspercitoo', '/cosmetics/set', { cape: 'atenas', pet: 'catalina' });
  assert.deepStrictEqual(r.denied, [{ type: 'pet', id: 'catalina' }]); ok('sin verificar, ni siquiera el nick dueño de Catalina puede elegirla');
  assert.strictEqual((await getOf('Bob', ['kaspercitoo'])).kaspercitoo.cape, 'atenas'); ok('lo público sí lo puede usar y mostrar');
  env.DB.raw.prepare("UPDATE cosmetics SET data = ? WHERE name = 'kaspercitoo'").run(JSON.stringify({ cape: 'atenas', wings: 'none', hat: 'none', pet: 'catalina' }));
  assert.strictEqual((await getOf('Bob', ['kaspercitoo'])).kaspercitoo.pet, 'none'); ok('aunque la fila ya tuviera a Catalina, sin verificar no se muestra');
  assert.strictEqual((await call('Kaspercitoo', '/friends/add', { to: 'Bob' })).result, 'sent'); ok('amigos y chat siguen funcionando sin verificar');

  // ---- verificación correcta
  const v = await mojang.verifyPremium(call, 'Kaspercitoo');
  assert.strictEqual(v.ok, true); assert.strictEqual(v.verified, true); assert.strictEqual(v.uuid, mojang.uuidOf('kaspercitoo')); ok('premium: challenge + joinServer + verify = verificado');
  assert.deepStrictEqual(row('kaspercitoo'), { verified: 1, uuid: mojang.uuidOf('kaspercitoo') }); ok('queda guardado verified = 1 y el uuid de Mojang');
  assert.strictEqual((await call('Kaspercitoo', '/sync')).verified, true); ok('/sync dice verified: true');
  r = await call('Kaspercitoo', '/cosmetics/set', { pet: 'catalina' });
  assert.deepStrictEqual(r.denied, []); ok('verificado + en la lista: puede elegir a Catalina');
  assert.strictEqual((await getOf('Bob', ['kaspercitoo'])).kaspercitoo.pet, 'catalina'); ok('y todos la ven');
  assert.strictEqual((await call('Kaspercitoo', '/auth/verify', {})).error, 'no_challenge'); ok('el desafío es de un solo uso (no se puede repetir)');

  // ---- suplantación
  let imp = await call('Kaspercitoo', '/sync', {}, tok('m'));
  assert.strictEqual(imp.error, 'verify_required'); assert.strictEqual(imp.status, 403); ok('otra instalación con el nick verificado queda fuera (verify_required)');
  assert.strictEqual((await call('Kaspercitoo', '/cosmetics/set', { pet: 'none' }, tok('m'))).error, 'verify_required'); ok('y no puede cambiarle los cosméticos');
  assert.strictEqual((await call('Kaspercitoo', '/auth/verify', {}, tok('m'))).error, 'no_challenge'); ok('verificar sin haber pedido desafío falla');
  const c = await call('Kaspercitoo', '/auth/challenge', {}, tok('m'));
  assert.strictEqual(c.ok, true);
  assert.strictEqual((await call('Kaspercitoo', '/auth/verify', {}, tok('m'))).error, 'not_verified'); ok('el impostor pide desafío pero no puede hacer joinServer: Mojang no lo confirma');
  // el impostor intenta usar el desafío del dueño real
  const cv = await call('Kaspercitoo', '/auth/challenge', {}); mojang.join('Kaspercitoo', mojang.uuidOf('kaspercitoo'), cv.serverId);
  assert.notStrictEqual(c.serverId, cv.serverId); ok('cada instalación recibe su propio serverId');
  assert.strictEqual((await call('Kaspercitoo', '/auth/verify', {}, tok('m'))).error, 'not_verified'); ok('el serverId del dueño no le sirve al impostor (está ligado a quien lo pidió)');
  assert.strictEqual((await call('Kaspercitoo', '/auth/verify', {})).ok, true); ok('y el dueño completa su propia verificación sin problema');

  // ---- otra PC del mismo dueño: se verifica y ambas conviven
  assert.strictEqual((await mojang.verifyPremium((w, p, b) => call(w, p, b, tok('p')), 'Kaspercitoo')).ok, true); ok('el dueño verifica una segunda PC');
  assert.strictEqual((await call('Kaspercitoo', '/sync', {}, tok('p'))).ok, true); assert.strictEqual((await call('Kaspercitoo', '/sync')).ok, true); ok('la primera PC sigue entrando (sin vaivén)');
  assert.strictEqual((await call('Kaspercitoo', '/sync', {}, tok('m'))).error, 'verify_required'); ok('el impostor sigue fuera');

  // ---- el impostor llegó primero con el nick de otro jugador
  await call('Alice', '/sync', {}, tok('m')); // Mallory se registra como "Alice" sin conexión
  assert.strictEqual((await call('Alice', '/sync', {}, tok('m'))).ok, true);
  assert.strictEqual((await mojang.verifyPremium((w, p, b) => call(w, p, b, tok('a')), 'Alice')).ok, true); ok('la dueña real de "Alice" se verifica');
  assert.strictEqual((await call('Alice', '/sync', {}, tok('m'))).error, 'verify_required'); ok('al verificarse, quien tenía el nick antes sin ser dueño queda fuera');
  assert.strictEqual((await call('Alice', '/sync', {}, tok('a'))).ok, true); ok('la dueña sigue entrando');

  // ---- casos raros
  await call('Bob', '/sync');
  const cb = await call('Bob', '/auth/challenge', {}); mojang.join('SoyOtro', mojang.uuidOf('otro'), cb.serverId);
  assert.strictEqual((await call('Bob', '/auth/verify', {})).error, 'not_verified'); ok('si el serverId lo registró otro nick, no vale');
  const cb2 = await call('Bob', '/auth/challenge', {}); mojang.join('Bob', mojang.uuidOf('bob'), cb2.serverId);
  mojang.setDown(true);
  r = await call('Bob', '/auth/verify', {});
  assert.strictEqual(r.error, 'mojang_down'); assert.strictEqual(r.status, 503); assert.strictEqual(row('bob').verified, 0); ok('si Mojang no responde: 503 y no se verifica a nadie');
  mojang.setDown(false);
  assert.strictEqual((await call('Bob', '/auth/verify', {})).verified, true); ok('cuando Mojang vuelve, reintentar con el mismo desafío funciona');
  // ---- Mojang tarda en ver el joinServer recién hecho: el Worker reintenta en vez de rechazar al primer 204
  await call('Gina', '/sync');
  globalThis.ATENAS_HASJOINED_WAITS = [0, 400, 600, 900];
  mojang.setPropagation(700);
  assert.strictEqual((await mojang.verifyPremium(call, 'Gina')).verified, true); ok('si Mojang tarda ~0,7 s en ver el join, el Worker reintenta y verifica');
  await call('Hugo', '/sync');
  mojang.setPropagation(8000);
  assert.strictEqual((await mojang.verifyPremium(call, 'Hugo')).error, 'not_verified'); ok('si Mojang nunca lo ve, tras los reintentos sigue siendo not_verified');
  mojang.setPropagation(0);
  globalThis.ATENAS_HASJOINED_WAITS = [0];
  await call('Frank', '/sync');
  const cf = await call('Frank', '/auth/challenge', {}); mojang.join('Frank', mojang.uuidOf('frank'), cf.serverId);
  env.DB.raw.prepare("UPDATE auth_challenges SET exp = 1 WHERE name = 'frank'").run();
  assert.strictEqual((await call('Frank', '/auth/verify', {})).error, 'no_challenge'); ok('un desafío caducado no se acepta');
  assert.strictEqual(row('frank').verified, 0); ok('Frank sigue sin verificar');

  // ---- límite de desafíos y de instalaciones
  for (let i = 0; i < 8; i++) assert.strictEqual((await call('Carol', '/auth/challenge', {}, 'k'.repeat(30) + String(10 + i))).ok, true);
  assert.strictEqual((await call('Carol', '/auth/challenge', {}, 'k'.repeat(30) + '99')).status, 429); ok('un nick no puede acumular desafíos sin límite');
  for (let i = 0; i < 6; i++) {
    const t = 'z'.repeat(30) + String(10 + i);
    assert.strictEqual((await mojang.verifyPremium((w, p, b) => call(w, p, b, t), 'Dave')).ok, true);
    await new Promise((res) => setTimeout(res, 3));
  }
  assert.strictEqual(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE name = 'dave'").get().n, 5); ok('una cuenta verificada guarda como máximo 5 instalaciones (se suelta la más vieja)');
  assert.strictEqual((await call('Dave', '/sync', {}, 'z'.repeat(30) + '10')).error, 'verify_required'); ok('la instalación más vieja tendrá que verificarse otra vez');

  // ---- el nick pasa a otra cuenta de Mojang (renombrada/liberada): la anterior pierde el control
  assert.strictEqual((await mojang.verifyPremium((w, p, b) => call(w, p, b, tok('q')), 'Dave', mojang.uuidOf('otro-dave'))).ok, true);
  assert.strictEqual(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE name = 'dave'").get().n, 1); ok('si el uuid de Mojang cambia, el nuevo dueño reemplaza a los anteriores');

  // ---- validaciones
  assert.strictEqual((await call('x', '/auth/challenge', {})).status, 400); ok('nick inválido rechazado en /auth/*');
  const noTok = await worker.fetch(new Request('https://x.test/auth/challenge', { method: 'POST', headers: { 'x-name': 'Eve_01' }, body: '{}' }), env);
  assert.strictEqual(noTok.status, 401); ok('sin token no hay desafío');

  console.log('verificación Mojang: todo bien (' + n + ' comprobaciones)');
})().catch((e) => { console.error(e); process.exit(1); });
