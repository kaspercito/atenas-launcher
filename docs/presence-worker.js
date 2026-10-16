// Servicio de presencia para el menú de amigos (Cloudflare Workers, plan gratis). Guía paso a paso: presence/LEEME.md
// 1) dash.cloudflare.com → Workers & Pages → Create → Hello World → pega este código → Deploy.
// 2) Storage & Databases → KV → crea un namespace "PRESENCE" y enlázalo al Worker (Settings → Bindings → Add → KV namespace → variable "PRESENCE").
// 3) Copia la URL del Worker (https://xxxx.workers.dev) en launcher.config.json → "presenceUrl".
//
// Límites del plan gratis de KV: 1000 escrituras/día. Por eso NO se escribe en cada aviso: solo cuando cambia el estado
// (entrar a jugar, cerrar el juego…) o cada ~200 s para renovar. Las lecturas (100 000/día) no son problema.
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const WRITE_AFTER_MS = 200000; // un estado igual no se reescribe hasta pasado este tiempo
const TTL_S = 900;             // el registro caduca solo si el launcher deja de avisar (se cerró sin avisar)
const MAX_BODY = 1024;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/presence') return new Response('ok', { headers: cors });
    if (!env.PRESENCE) return json({ error: 'Falta enlazar el KV "PRESENCE" al Worker' }, 500);

    if (req.method === 'POST') {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ error: 'too big' }, 413);
      let b = null;
      try { b = JSON.parse(raw); } catch {}
      if (!b || typeof b !== 'object' || !NAME.test(b.name || '')) return json({ error: 'bad' }, 400);
      const key = b.name.toLowerCase();
      if (b.offline === true) { await env.PRESENCE.delete(key); return json({ ok: true }); }
      const next = { pack: String(b.pack || '').slice(0, 60), playing: b.playing === true };
      const now = Date.now();
      let prev = null;
      try { prev = await env.PRESENCE.get(key, 'json'); } catch {}
      if (prev && prev.pack === next.pack && prev.playing === next.playing && now - prev.ts < WRITE_AFTER_MS) return json({ ok: true, skipped: true });
      await env.PRESENCE.put(key, JSON.stringify({ ...next, ts: now }), { expirationTtl: TTL_S });
      return json({ ok: true });
    }

    if (req.method !== 'GET') return json({ error: 'method' }, 405);
    const names = [...new Set((url.searchParams.get('names') || '').split(',').filter((n) => NAME.test(n)).map((n) => n.toLowerCase()))].slice(0, 50);
    const now = Date.now();
    const out = {};
    await Promise.all(names.map(async (n) => {
      let v = null;
      try { v = await env.PRESENCE.get(n, 'json'); } catch {}
      // "age" lo calcula el Worker: así no importa si el reloj del PC de un amigo está adelantado o atrasado
      if (v && typeof v.ts === 'number') out[n] = { pack: v.pack || '', playing: v.playing === true, age: Math.max(0, now - v.ts) };
    }));
    return json(out);
  },
};
