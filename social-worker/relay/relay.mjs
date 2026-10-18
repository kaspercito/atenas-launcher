// Relay de hasJoined para Atenas. Mojang bloquea (403) las IPs de Cloudflare Workers; esta maquina (tu VM) no.
// Sin dependencias. Node 18+.  Variables: RELAY_KEY (obligatoria, 16+ caracteres), PORT (8787), HOST (127.0.0.1), MOJANG_URL (solo pruebas).
import http from 'node:http';
import crypto from 'node:crypto';

const KEY = process.env.RELAY_KEY || '';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MOJANG = process.env.MOJANG_URL || 'https://sessionserver.mojang.com/session/minecraft/hasJoined';
if (KEY.length < 16) { console.error('Falta RELAY_KEY (minimo 16 caracteres).'); process.exit(1); }

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hits = new Map(); // limite simple: 120 consultas por minuto por IP
const limited = (ip) => { const m = Math.floor(Date.now() / 60000); const h = hits.get(ip); if (!h || h.m !== m) { hits.set(ip, { m, n: 1 }); return false; } return ++h.n > 120; };
setInterval(() => hits.clear(), 300000).unref();

http.createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return send(200, '{"ok":true}');
  if (u.pathname !== '/hasJoined' || req.method !== 'GET') return send(404, '{"error":"not_found"}');
  if (!same(String(req.headers['x-relay-key'] || ''), KEY)) return send(403, '{"error":"forbidden"}');
  if (limited(req.socket.remoteAddress)) return send(429, '{"error":"rate"}');
  const user = u.searchParams.get('username') || '', sid = u.searchParams.get('serverId') || '';
  if (!/^[A-Za-z0-9_]{3,16}$/.test(user) || !/^[0-9a-f]{16,64}$/.test(sid)) return send(400, '{"error":"bad_params"}');
  try {
    const r = await fetch(MOJANG + '?username=' + encodeURIComponent(user) + '&serverId=' + sid, { headers: { accept: 'application/json', 'user-agent': 'AtenasRelay/1.0' }, signal: AbortSignal.timeout(4000) });
    const text = r.status === 204 ? '' : await r.text();
    if (r.status !== 200 && r.status !== 204) console.log(new Date().toISOString(), 'Mojang respondio', r.status);
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(text);
  } catch (e) { console.log(new Date().toISOString(), 'error', e.name); send(502, '{"error":"mojang_unreachable"}'); }
}).listen(PORT, HOST, () => console.log('Relay Atenas escuchando en ' + HOST + ':' + PORT));
