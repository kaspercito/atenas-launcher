'use strict';
// Cliente del servicio social (social-worker/): amigos con solicitudes, chat y presencia.
// El launcher y el cliente de Minecraft de la misma PC comparten una clave secreta (social.json) para ser "la misma persona".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cleanName = (n) => { const s = String(n || '').trim(); if (!NAME.test(s)) throw new Error('Nombre de Minecraft no válido (3-16 letras, números o _).'); return s; };

const base = (url) => String(url || '').replace(/\/$/, '');

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
 * api = createSocial({ url, file, getName })
 *   getName(): nick de la cuenta activa (o null si no hay sesión)
 */
function createSocial({ url, file, getName, timeoutMs = 8000 }) {
  const identity = loadIdentity(file, url);
  const configured = !!base(url);

  async function call(route, body = {}) {
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

  return {
    configured, identity,
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
