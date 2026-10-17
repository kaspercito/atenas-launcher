'use strict';
// Cliente del servicio social (social-worker/): amigos con solicitudes, chat y presencia.
// El launcher y el cliente de Minecraft de la misma PC comparten una clave secreta (social.json) para ser "la misma persona".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cleanName = (n) => { const s = String(n || '').trim(); if (!NAME.test(s)) throw new Error('Nombre de Minecraft no válido (3-16 letras, números o _).'); return s; };

const base = (url) => String(url || '').replace(/\/$/, '');

const MOJANG_JOIN = 'https://sessionserver.mojang.com/session/minecraft/join';
const RETRY_UNVERIFIED_MS = 30 * 60 * 1000; // una cuenta sin conexión no se vuelve a intentar verificar hasta pasado este tiempo

/** Lee (o crea la primera vez) la clave de esta instalación. Se guarda en <root>/social.json junto con la URL, para que el cliente de Minecraft la encuentre. */
function loadIdentity(file, url) {
  let id = null;
  try { id = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* primera vez */ }
  if (!id || typeof id.token !== 'string' || id.token.length < 16) id = { token: crypto.randomBytes(24).toString('hex') };
  const next = { token: id.token, url: base(url) };
  if (!id.url || id.url !== next.url || !fs.existsSync(file)) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(next, null, 2)); } catch { /* sin permisos: se sigue en memoria */ }
  }
  return next;
}

class SocialError extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * api = createSocial({ url, file, getName, getAuth })
 *   getName(): nick de la cuenta activa (o null si no hay sesión)
 *   getAuth(): { accessToken, uuid } de la sesión de Microsoft activa, o null si la cuenta es sin conexión.
 *
 * Verificación premium: con una cuenta de Microsoft, antes de la primera llamada se hace /auth/challenge → joinServer en Mojang →
 * /auth/verify, y el servicio comprueba con Mojang que la cuenta es de verdad tuya (así nadie puede hacerse pasar por ti ni usar
 * tus cosméticos privados). Es transparente: si algo falla, el servicio sigue funcionando como cuenta sin verificar.
 */
function createSocial({ url, file, getName, getAuth, timeoutMs = 8000 }) {
  const identity = loadIdentity(file, url);
  const configured = !!base(url);
  let verifiedFor = '';                    // nick (en minúsculas) verificado en esta sesión
  let failed = { name: '', at: 0 };        // último intento que no se pudo verificar (cuenta sin conexión o sesión caducada)
  let verifying = null;                    // { name, promise }: evita verificar dos veces a la vez

  async function rawCall(route, body = {}) {
    if (!configured) throw new SocialError('not_configured', 'El servicio de amigos todavía no está activado (falta la URL en launcher.config.json).');
    const name = getName();
    if (!name) throw new SocialError('no_account', 'Inicia sesión para usar amigos y chat.');
    let res;
    try {
      res = await fetch(base(url) + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-name': name, 'x-token': identity.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new SocialError('offline', 'No se pudo conectar con el servicio de amigos. Revisa tu internet.'); }
    let j = null;
    try { j = await res.json(); } catch { /* respuesta rara */ }
    if (!j || j.ok === false || !res.ok) throw new SocialError((j && j.error) || 'server', (j && j.message) || `El servicio de amigos respondió con error ${res.status}.`);
    return j;
  }

  /** true = verificada con Mojang; false = no se pudo (cuenta sin conexión, sesión caducada). Lanza si fue un fallo de red/servicio pasajero. */
  async function verifyWithMojang() {
    const auth = getAuth ? await getAuth() : null;
    if (!auth || !auth.accessToken || !auth.uuid) return false; // cuenta sin conexión: no hay nada que demostrar
    const ch = await rawCall('/auth/challenge');
    let res;
    try {
      res = await fetch(MOJANG_JOIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: auth.accessToken, selectedProfile: String(auth.uuid).replace(/-/g, ''), serverId: ch.serverId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new SocialError('offline', 'No se pudo hablar con Mojang.'); }
    if (res.status !== 204 && res.status !== 200) return false; // Mojang rechazó la sesión
    await rawCall('/auth/verify');
    return true;
  }

  /** Verifica a la cuenta activa si aún no lo está. Nunca lanza: si no se logra, el servicio la trata como cuenta sin verificar. */
  async function ensureVerified(force = false) {
    const name = String(getName() || '').toLowerCase();
    if (!name) return false;
    if (!force && verifiedFor === name) return true;
    if (!force && failed.name === name && Date.now() - failed.at < RETRY_UNVERIFIED_MS) return false;
    if (verifying && verifying.name === name) return verifying.promise;
    const promise = (async () => {
      try {
        if (await verifyWithMojang()) { verifiedFor = name; failed = { name: '', at: 0 }; return true; }
        failed = { name, at: Date.now() };
      } catch (e) {
        // sin internet o Mojang/servicio caído: se reintenta en la próxima llamada; si el servicio dijo "no" (not_verified), se espera
        if (e && !['offline', 'mojang_down', 'too_many', 'server', 'no_challenge'].includes(e.code)) failed = { name, at: Date.now() };
      }
      return false;
    })().finally(() => { verifying = null; });
    verifying = { name, promise };
    return promise;
  }

  async function call(route, body = {}) {
    if (!configured) throw new SocialError('not_configured', 'El servicio de amigos todavía no está activado (falta la URL en launcher.config.json).');
    if (!getName()) throw new SocialError('no_account', 'Inicia sesión para usar amigos y chat.');
    await ensureVerified();
    try { return await rawCall(route, body); }
    catch (e) {
      // el nick está verificado por otra instalación y esta aún no: se demuestra con la sesión de Microsoft y se reintenta una vez
      if (!(e instanceof SocialError) || e.code !== 'verify_required') throw e;
      verifiedFor = ''; failed = { name: '', at: 0 };
      if (!(await ensureVerified(true))) throw e;
      return rawCall(route, body);
    }
  }

  return {
    configured, identity,
    ensureVerified,
    isVerified: () => verifiedFor !== '' && verifiedFor === String(getName() || '').toLowerCase(),
    sync: (presence) => call('/sync', { presence }),
    poll: () => call('/poll'),
    add: async (to) => call('/friends/add', { to: cleanName(to) }),
    accept: (name) => call('/friends/accept', { name }),
    remove: (name) => call('/friends/remove', { name }),
    history: (name, after = 0) => call('/chat/history', { with: name, after }),
    send: (to, body) => call('/chat/send', { to, body }),
  };
}

/** Marca como "en el servidor" a los amigos que aparecen en el ping aunque no usen Atenas (el ping lista hasta 12 jugadores). */
function mergeServer(friends, inServer) {
  if (!inServer || !inServer.size) return friends;
  return friends.map((f) => (inServer.has(f.name.toLowerCase()) && f.state !== 'playing' ? { ...f, state: 'playing', server: f.server || '(servidor)', pack: f.pack || '' } : f));
}

/** Qué hay nuevo respecto al estado anterior: solicitudes, mensajes sin leer y amigos que se conectaron. */
function diffSnapshots(prev, next) {
  const out = { requests: [], messages: [], came: [], accepted: [] };
  if (!prev || !next) return out;
  const prevIn = new Set(prev.incoming.map((r) => r.key));
  out.requests = next.incoming.filter((r) => !prevIn.has(r.key));
  const prevFriends = new Map(prev.friends.map((f) => [f.key, f]));
  const prevOut = new Set(prev.outgoing.map((r) => r.key));
  for (const f of next.friends) {
    const p = prevFriends.get(f.key);
    if (!p) { if (prevOut.has(f.key)) out.accepted.push(f); continue; }
    if (p.state === 'offline' && f.state !== 'offline') out.came.push(f);
    if (f.unread > 0 && f.preview && (!p.preview || f.preview.id > p.preview.id)) out.messages.push(f);
  }
  return out;
}

module.exports = { cleanName, createSocial, loadIdentity, mergeServer, diffSnapshots, SocialError };
