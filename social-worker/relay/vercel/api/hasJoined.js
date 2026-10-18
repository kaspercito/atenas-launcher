// Relay de hasJoined para Atenas como funcion de Vercel (plan gratis, sin servidor propio).
// Variable de entorno obligatoria en Vercel: RELAY_KEY (16+ caracteres). MOJANG_URL solo para pruebas.
const crypto = require('node:crypto');
const MOJANG = process.env.MOJANG_URL || 'https://sessionserver.mojang.com/session/minecraft/hasJoined';
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  const KEY = process.env.RELAY_KEY || '';
  const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(body); };
  if (KEY.length < 16) return send(500, '{"error":"falta RELAY_KEY"}');
  if (req.method !== 'GET') return send(405, '{"error":"method"}');
  if (!same(String(req.headers['x-relay-key'] || ''), KEY)) return send(403, '{"error":"forbidden"}');
  const u = new URL(req.url, 'http://x');
  const user = u.searchParams.get('username') || '', sid = u.searchParams.get('serverId') || '';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(user) || !/^[0-9a-f]{16,64}$/.test(sid)) return send(400, '{"error":"bad_params"}');
  try {
    const r = await fetch(MOJANG + '?username=' + encodeURIComponent(user) + '&serverId=' + sid, { headers: { accept: 'application/json', 'user-agent': 'AtenasRelay/1.0' }, signal: AbortSignal.timeout(4000) });
    const text = r.status === 204 ? '' : await r.text();
    res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(text);
  } catch (e) { send(502, '{"error":"mojang_unreachable"}'); }
};
