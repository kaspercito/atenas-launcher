'use strict';
// Mojang de mentira para probar la verificación premium sin internet.
// join(nick, uuid, serverId)  = lo que hace el cliente con joinServer (solo el dueño de la cuenta puede hacerlo en la realidad)
// registerAccount(nick, uuid, accessToken) = cuentas premium que "existen" en Mojang (para probar el /join que hace el launcher)
// verifyPremium(call, nick, uuid) = flujo completo: /auth/challenge -> join -> /auth/verify
const joined = new Map();
let down = false;
let blockDirect = false; // simula que Mojang devuelve 403 a las IPs de Cloudflare (hasJoined directo desde el Worker)
let relayDown = false;
const RELAY_KEY = 'clave-relay-de-prueba';
let propagationMs = 0; // retraso con que Mojang "ve" un join recién hecho (como pasa en la realidad)
const accounts = new Map(); // accessToken -> { name, uuid }
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const isRelay = url.hostname === 'relay.test';
  if (url.hostname !== 'sessionserver.mojang.com' && !isRelay) return realFetch(input, init);
  if (isRelay) { // el relay de la VM: reenvía a Mojang desde una IP que no está bloqueada
    if (relayDown) throw new Error('relay caído (simulado)');
    const hdr = new Headers((init && init.headers) || {});
    if (hdr.get('x-relay-key') !== RELAY_KEY) return new Response('{"error":"forbidden"}', { status: 403 });
    url.hostname = 'sessionserver.mojang.com'; url.pathname = '/session/minecraft/hasJoined';
  } else if (blockDirect && url.pathname.includes('hasJoined')) {
    return new Response("<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.0 Transitional//EN'><html>blocked</html>", { status: 403 });
  }
  if (down) throw new Error('mojang caído (simulado)');
  if (url.pathname === '/session/minecraft/join') {
    let b = {};
    try { b = JSON.parse(init && init.body ? String(init.body) : '{}'); } catch { /* cuerpo raro */ }
    const acct = accounts.get(b.accessToken);
    if (!acct || acct.uuid !== b.selectedProfile || !b.serverId) return new Response(JSON.stringify({ error: 'ForbiddenOperationException' }), { status: 403 });
    joined.set(b.serverId, { name: acct.name, uuid: acct.uuid, at: Date.now() + propagationMs });
    return new Response(null, { status: 204 });
  }
  const sid = url.searchParams.get('serverId');
  const user = String(url.searchParams.get('username') || '').toLowerCase();
  const j = joined.get(sid);
  if (!j || j.at > Date.now() || j.name.toLowerCase() !== user) return new Response(null, { status: 204 });
  joined.delete(sid); // en Mojang el registro también se gasta
  return new Response(JSON.stringify({ id: j.uuid, name: j.name, properties: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const join = (name, uuid, serverId) => joined.set(serverId, { name, uuid, at: Date.now() + propagationMs });
const setPropagation = (ms) => { propagationMs = ms; };
const setDown = (v) => { down = !!v; };
const setBlockDirect = (v) => { blockDirect = !!v; };
const setRelayDown = (v) => { relayDown = !!v; };
const registerAccount = (name, uuid, accessToken) => accounts.set(accessToken, { name, uuid });
const uuidOf = (n) => Buffer.from(String(n).toLowerCase().padEnd(16, '_')).toString('hex').slice(0, 32);

async function verifyPremium(call, nick, uuid = uuidOf(nick)) {
  const c = await call(nick, '/auth/challenge', {});
  if (!c.ok) return c;
  join(nick, uuid, c.serverId);
  return call(nick, '/auth/verify', {});
}

module.exports = { RELAY_KEY, setBlockDirect, setRelayDown, join, setDown, setPropagation, registerAccount, verifyPremium, uuidOf };
