// Servicio OPCIONAL de presencia para el menú de amigos (Cloudflare Workers, plan gratis).
// 1) dash.cloudflare.com → Workers & Pages → Create → pega este código.
// 2) Crea un KV namespace "PRESENCE" y enlázalo al Worker con ese nombre (Settings → Bindings).
// 3) Copia la URL del Worker en launcher.config.json → "presenceUrl".
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/presence') return new Response('ok', { headers: cors });
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!NAME.test(b.name || '')) return new Response('bad', { status: 400, headers: cors });
      const val = JSON.stringify({ pack: String(b.pack || '').slice(0, 60), playing: !!b.playing, ts: Date.now() });
      await env.PRESENCE.put(b.name.toLowerCase(), val, { expirationTtl: 120 }); // caduca solo si el launcher se cierra
      return new Response('ok', { headers: cors });
    }
    const names = (url.searchParams.get('names') || '').split(',').filter((n) => NAME.test(n)).slice(0, 50);
    const out = {};
    await Promise.all(names.map(async (n) => { const v = await env.PRESENCE.get(n.toLowerCase()); if (v) out[n.toLowerCase()] = JSON.parse(v); }));
    return new Response(JSON.stringify(out), { headers: { ...cors, 'content-type': 'application/json' } });
  },
};
