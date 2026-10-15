'use strict';
// Amigos: lista local + estado. "En el servidor" sale del ping del servidor (jugadores visibles);
// "Jugando <pack>" sale del servicio opcional de presencia (docs/presence-worker.js en Cloudflare, gratis).
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cleanName = (n) => { const s = String(n || '').trim(); if (!NAME.test(s)) throw new Error('Nombre de Minecraft no válido (3-16 letras, números o _).'); return s; };

async function getPresence(url, names) {
  if (!url || !names.length) return {};
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/presence?names=${encodeURIComponent(names.join(','))}`, { signal: AbortSignal.timeout(6000) });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}
async function putPresence(url, body) {
  if (!url) return;
  try { await fetch(`${url.replace(/\/$/, '')}/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) }); } catch {}
}
module.exports = { cleanName, getPresence, putPresence };
