'use strict';
// Amigos: lista local + estado. "En el servidor" sale del ping del servidor (jugadores visibles);
// "Jugando <pack>" / "En el launcher" sale del servicio de presencia (docs/presence-worker.js en Cloudflare, gratis).
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cleanName = (n) => { const s = String(n || '').trim(); if (!NAME.test(s)) throw new Error('Nombre de Minecraft no válido (3-16 letras, números o _).'); return s; };

const HEARTBEAT_MS = 90000;  // cada cuánto avisa el launcher que sigue abierto
const FRESH_MS = 330000;     // un amigo cuenta como conectado si su último aviso es más reciente que esto (el Worker solo reescribe cada ~200 s)

const base = (url) => String(url || '').replace(/\/$/, '');

/** { ok, data }: ok = false si el servicio no respondió (así la interfaz no marca a todos "desconectado" por error). */
async function getPresence(url, names) {
  if (!url) return { ok: false, configured: false, data: {} };
  if (!names.length) return { ok: true, configured: true, data: {} };
  try {
    const r = await fetch(`${base(url)}/presence?names=${encodeURIComponent(names.join(','))}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { ok: false, configured: true, data: {} };
    const j = await r.json();
    return j && typeof j === 'object' && !Array.isArray(j) ? { ok: true, configured: true, data: j } : { ok: false, configured: true, data: {} };
  } catch { return { ok: false, configured: true, data: {} }; }
}

/** Devuelve true si el servicio aceptó el aviso. body: { name, pack, playing } o { name, offline: true }. */
async function putPresence(url, body) {
  if (!url) return false;
  try {
    const r = await fetch(`${base(url)}/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch { return false; }
}

/** Antigüedad del aviso en ms. Usa "age" (la calcula el Worker, no depende del reloj del PC); "ts" solo por compatibilidad con Workers antiguos. */
function ageOf(p, now) {
  if (p && typeof p.age === 'number') return p.age;
  if (p && typeof p.ts === 'number') return now - p.ts;
  return Infinity;
}

/** Une presencia + jugadores del servidor en la lista que ve la interfaz. */
function buildFriendList(names, presence, inServer, now = Date.now()) {
  return names.map((name) => {
    const key = name.toLowerCase();
    const p = presence[key];
    const fresh = !!p && ageOf(p, now) < FRESH_MS;
    if (inServer.has(key)) return { name, status: 'server', where: 'En el servidor', pack: fresh ? p.pack || '' : '' };
    if (fresh && p.playing) return { name, status: 'playing', where: 'Jugando ' + (p.pack || 'Minecraft'), pack: p.pack || '' };
    if (fresh) return { name, status: 'online', where: 'En el launcher', pack: '' };
    return { name, status: 'offline', where: 'Desconectado', pack: '' };
  });
}

module.exports = { cleanName, getPresence, putPresence, buildFriendList, ageOf, HEARTBEAT_MS, FRESH_MS };
