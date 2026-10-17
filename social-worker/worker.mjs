// Atenas Social: amigos con solicitudes, chat y presencia (Cloudflare Workers + D1, plan gratis).
// Lo usan el launcher y el cliente de Minecraft. Guía: social-worker/LEEME.md
//
// Identidad: el primer dispositivo que usa un nick se queda con él (token secreto por instalación, se guarda como hash).
// El launcher y el cliente de la misma PC comparten el token (archivo ~/.atenasclient/social.json), así que son "la misma persona".
// Todas las llamadas son POST con cabeceras x-name y x-token y cuerpo JSON (salvo GET / que es solo un "estoy vivo").

const NAME = /^[A-Za-z0-9_]{3,16}$/;
const MAX_BODY = 4096;
const MAX_MSG = 300;
const MAX_FRIENDS = 50;
const MAX_PENDING = 30;
const FRESH_MS = 120000;          // un aviso de presencia cuenta como "conectado" durante este tiempo
const REWRITE_MS = 40000;         // la presencia igual no se reescribe hasta pasado este tiempo (cuida las escrituras gratis de D1)
const MSG_COOLDOWN_MS = 500;
const KEEP_MSGS = 200;            // mensajes que se guardan por conversación
const STALE_CLAIM_MS = 30 * 86400000; // un nick sin actividad en 30 días puede reclamarlo otra instalación

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (code, message, status = 400) => new HttpError(status, code, message);

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, display TEXT NOT NULL, token TEXT NOT NULL, launcher_ts INTEGER NOT NULL DEFAULT 0, game_ts INTEGER NOT NULL DEFAULT 0, l_playing INTEGER NOT NULL DEFAULT 0, pack TEXT NOT NULL DEFAULT \'\', server TEXT NOT NULL DEFAULT \'\', created INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, state TEXT NOT NULL, requester TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (a, b))',
  'CREATE INDEX IF NOT EXISTS friends_b ON friends (b)',
  'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS msg_pair ON messages (sender, recipient, id)',
  'CREATE INDEX IF NOT EXISTS msg_unread ON messages (recipient, read)',
  'CREATE TABLE IF NOT EXISTS cosmetics (name TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL)',
];
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const lower = (s) => String(s || '').toLowerCase();

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Identifica (o registra la primera vez) a quien llama. Devuelve la fila del usuario. */
async function authenticate(req, db, now) {
  const display = String(req.headers.get('x-name') || '').trim();
  const token = String(req.headers.get('x-token') || '');
  if (!NAME.test(display)) throw bad('bad_name', 'Nombre de Minecraft no válido.');
  if (token.length < 16 || token.length > 128) throw bad('bad_token', 'Falta el token de esta instalación.', 401);
  const key = lower(display);
  const hash = await sha256(token);
  const row = await db.prepare('SELECT * FROM users WHERE name = ?').bind(key).first();
  if (!row) {
    await db.prepare('INSERT INTO users (name, display, token, created) VALUES (?, ?, ?, ?)').bind(key, display, hash, now).run();
    return { name: key, display, token: hash, launcher_ts: 0, game_ts: 0, l_playing: 0, pack: '', server: '', created: now };
  }
  if (!sameHash(row.token, hash)) {
    const last = Math.max(row.launcher_ts, row.game_ts, row.created);
    if (now - last > STALE_CLAIM_MS) {
      await db.prepare('UPDATE users SET token = ?, display = ? WHERE name = ?').bind(hash, display, key).run();
      return { ...row, token: hash, display };
    }
    throw bad('nick_taken', `El nick ${row.display} ya está registrado desde otra instalación de Atenas. Si es tuyo, abre el launcher y el cliente en la misma PC (comparten la clave).`, 403);
  }
  if (row.display !== display) { await db.prepare('UPDATE users SET display = ? WHERE name = ?').bind(display, key).run(); row.display = display; }
  return row;
}

/** Guarda la presencia solo si cambió o si el último aviso ya es viejo. */
async function applyPresence(db, me, p, now) {
  if (!p || typeof p !== 'object') return;
  const source = p.source === 'game' ? 'game' : 'launcher';
  const pack = String(p.pack || '').slice(0, 60);
  const server = String(p.server || '').slice(0, 80);
  const playing = p.playing === true ? 1 : 0;
  if (source === 'launcher') {
    if (p.offline === true) {
      if (me.launcher_ts !== 0 || me.l_playing) await db.prepare('UPDATE users SET launcher_ts = 0, l_playing = 0 WHERE name = ?').bind(me.name).run();
      return;
    }
    const same = me.l_playing === playing && (!playing || me.pack === pack);
    if (same && now - me.launcher_ts < REWRITE_MS) return;
    if (playing) await db.prepare('UPDATE users SET launcher_ts = ?, l_playing = 1, pack = ? WHERE name = ?').bind(now, pack, me.name).run();
    else await db.prepare('UPDATE users SET launcher_ts = ?, l_playing = 0 WHERE name = ?').bind(now, me.name).run();
    return;
  }
  if (p.offline === true) {
    if (me.game_ts !== 0) await db.prepare('UPDATE users SET game_ts = 0, server = \'\' WHERE name = ?').bind(me.name).run();
    return;
  }
  const same = me.server === server && now - me.game_ts < REWRITE_MS;
  if (same) return;
  await db.prepare('UPDATE users SET game_ts = ?, server = ?, pack = CASE WHEN ? != \'\' THEN ? ELSE pack END WHERE name = ?').bind(now, server, pack, pack, me.name).run();
}

function presenceOf(u, now) {
  const game = u.game_ts > 0 && now - u.game_ts < FRESH_MS;
  const launcher = u.launcher_ts > 0 && now - u.launcher_ts < FRESH_MS;
  if (game) return { state: 'playing', pack: u.pack || 'Atenas Client', server: u.server || '' };
  if (launcher && u.l_playing) return { state: 'playing', pack: u.pack || '', server: '' };
  if (launcher) return { state: 'online', pack: '', server: '' };
  return { state: 'offline', pack: '', server: '' };
}

async function snapshot(db, me, now) {
  const rows = (await db.prepare(
    'SELECT f.a AS a, f.b AS b, f.state AS state, f.requester AS requester, f.ts AS fts, u.display AS display, u.launcher_ts AS launcher_ts, u.game_ts AS game_ts, u.l_playing AS l_playing, u.pack AS pack, u.server AS server ' +
    'FROM friends f JOIN users u ON u.name = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END WHERE f.a = ?1 OR f.b = ?1'
  ).bind(me.name).all()).results || [];
  const unreadRows = (await db.prepare('SELECT sender, COUNT(*) AS n, MAX(id) AS last FROM messages WHERE recipient = ? AND read = 0 GROUP BY sender').bind(me.name).all()).results || [];
  const unread = {};
  for (const r of unreadRows) unread[r.sender] = { n: r.n, last: r.last };
  const previews = {};
  if (unreadRows.length) {
    const recent = (await db.prepare('SELECT id, sender, body, ts FROM messages WHERE recipient = ? AND read = 0 ORDER BY id DESC LIMIT 30').bind(me.name).all()).results || [];
    for (const m of recent) if (!previews[m.sender]) previews[m.sender] = { id: m.id, body: m.body.slice(0, 80), ts: m.ts };
  }
  const friends = [], incoming = [], outgoing = [];
  for (const r of rows) {
    const other = r.a === me.name ? r.b : r.a;
    const info = { name: r.display, key: other, ts: r.fts };
    if (r.state === 'accepted') {
      const p = presenceOf(r, now);
      friends.push({ ...info, ...p, unread: (unread[other] || {}).n || 0, preview: previews[other] || null });
    } else if (r.requester === me.name) outgoing.push(info);
    else incoming.push(info);
  }
  const order = { playing: 0, online: 1, offline: 2 };
  friends.sort((x, y) => order[x.state] - order[y.state] || x.name.localeCompare(y.name));
  incoming.sort((x, y) => y.ts - x.ts);
  outgoing.sort((x, y) => y.ts - x.ts);
  const totalUnread = Object.values(unread).reduce((s, v) => s + v.n, 0);
  return { ok: true, me: me.display, now, friends, incoming, outgoing, unread: totalUnread };
}

async function userExists(db, key) { return db.prepare('SELECT name, display FROM users WHERE name = ?').bind(key).first(); }
async function friendRow(db, x, y) { const [a, b] = pair(x, y); return db.prepare('SELECT * FROM friends WHERE a = ? AND b = ?').bind(a, b).first(); }

const routes = {
  async '/sync'(db, me, body, now) {
    await applyPresence(db, me, body.presence, now);
    // el propio estado se ve ya reflejado en lo que devuelve
    return snapshot(db, me, now);
  },

  /** Cosméticos (capa, alas, sombrero) que elige cada jugador. Los ven todos los que usan el mod de Atenas. */
  async '/cosmetics/set'(db, me, body, now) {
    const clean = (v) => (/^[a-z0-9_]{1,24}$/.test(String(v || '')) ? String(v) : 'none');
    const data = JSON.stringify({ cape: clean(body.cape), wings: clean(body.wings), hat: clean(body.hat) });
    await db.prepare('INSERT INTO cosmetics (name, data, ts) VALUES (?1, ?2, ?3) ON CONFLICT(name) DO UPDATE SET data = ?2, ts = ?3').bind(me.name, data, now).run();
    return { ok: true };
  },

  /** Cosméticos de hasta 40 jugadores a la vez (los que tienes cerca). */
  async '/cosmetics/get'(db, me, body) {
    const names = [...new Set((Array.isArray(body.names) ? body.names : []).map(lower).filter((n) => NAME.test(n)))].slice(0, 40);
    const players = {};
    if (!names.length) return { ok: true, players };
    const rows = (await db.prepare(`SELECT name, data FROM cosmetics WHERE name IN (${names.map(() => '?').join(',')})`).bind(...names).all()).results || [];
    for (const r of rows) { try { players[r.name] = JSON.parse(r.data); } catch { /* fila dañada: se ignora */ } }
    return { ok: true, players };
  },

  async '/friends/add'(db, me, body, now) {
    const to = String(body.to || '').trim();
    if (!NAME.test(to)) throw bad('bad_name', 'Nombre de Minecraft no válido (3-16 letras, números o _).');
    const key = lower(to);
    if (key === me.name) throw bad('self', 'Ese eres tú: envía la solicitud a otra persona.');
    const target = await userExists(db, key);
    if (!target) throw bad('not_found', `${to} todavía no usa Atenas Client. Pídele que abra el launcher o el cliente una vez y vuelve a intentarlo.`, 404);
    const cur = await friendRow(db, me.name, key);
    if (cur) {
      if (cur.state === 'accepted') throw bad('already', `Ya eres amigo de ${target.display}.`, 409);
      if (cur.requester === me.name) throw bad('pending', `Ya le enviaste una solicitud a ${target.display}.`, 409);
      // me había pedido amistad primero: se aceptan mutuamente
      await db.prepare('UPDATE friends SET state = \'accepted\', ts = ? WHERE a = ? AND b = ?').bind(now, cur.a, cur.b).run();
      return { ok: true, result: 'accepted', name: target.display };
    }
    const mine = (await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE (a = ?1 OR b = ?1) AND state = \'accepted\'').bind(me.name).first()).n;
    if (mine >= MAX_FRIENDS) throw bad('limit', `Máximo ${MAX_FRIENDS} amigos.`);
    const out = (await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE requester = ? AND state = \'pending\'').bind(me.name).first()).n;
    if (out >= MAX_PENDING) throw bad('limit', 'Tienes demasiadas solicitudes pendientes. Espera a que respondan o cancela alguna.');
    const [a, b] = pair(me.name, key);
    await db.prepare('INSERT INTO friends (a, b, state, requester, ts) VALUES (?, ?, \'pending\', ?, ?)').bind(a, b, me.name, now).run();
    return { ok: true, result: 'sent', name: target.display };
  },

  async '/friends/accept'(db, me, body, now) {
    const key = lower(body.name);
    const cur = NAME.test(key) ? await friendRow(db, me.name, key) : null;
    if (!cur || cur.state !== 'pending' || cur.requester !== key) throw bad('not_found', 'Esa solicitud ya no existe.', 404);
    const mine = (await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE (a = ?1 OR b = ?1) AND state = \'accepted\'').bind(me.name).first()).n;
    if (mine >= MAX_FRIENDS) throw bad('limit', `Máximo ${MAX_FRIENDS} amigos.`);
    await db.prepare('UPDATE friends SET state = \'accepted\', ts = ? WHERE a = ? AND b = ?').bind(now, cur.a, cur.b).run();
    return { ok: true };
  },

  /** Rechazar una solicitud recibida, cancelar una enviada o borrar a un amigo: todo es quitar la fila. */
  async '/friends/remove'(db, me, body) {
    const key = lower(body.name);
    const cur = NAME.test(key) ? await friendRow(db, me.name, key) : null;
    if (!cur) return { ok: true };
    await db.batch([
      db.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(cur.a, cur.b),
      ...(cur.state === 'accepted' ? [db.prepare('DELETE FROM messages WHERE (sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1)').bind(me.name, key)] : []),
    ]);
    return { ok: true };
  },

  async '/chat/send'(db, me, body, now) {
    const key = lower(body.to);
    const text = String(body.body || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_MSG);
    if (!text) throw bad('empty', 'Escribe algo primero.');
    const cur = NAME.test(key) ? await friendRow(db, me.name, key) : null;
    if (!cur || cur.state !== 'accepted') throw bad('not_friends', 'Solo puedes escribirle a tus amigos.', 403);
    const last = await db.prepare('SELECT ts FROM messages WHERE sender = ? ORDER BY id DESC LIMIT 1').bind(me.name).first();
    if (last && now - last.ts < MSG_COOLDOWN_MS) throw bad('slow', 'Vas muy rápido, espera un momento.', 429);
    const r = await db.prepare('INSERT INTO messages (sender, recipient, body, ts) VALUES (?, ?, ?, ?)').bind(me.name, key, text, now).run();
    const id = (r.meta && r.meta.last_row_id) || 0;
    await db.prepare(
      'DELETE FROM messages WHERE ((sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1)) AND id < COALESCE((SELECT MIN(id) FROM (SELECT id FROM messages WHERE (sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1) ORDER BY id DESC LIMIT ' + KEEP_MSGS + ')), 0)'
    ).bind(me.name, key).run();
    return { ok: true, message: { id, from: me.display, mine: true, body: text, ts: now } };
  },

  /** Mensajes de una conversación. "after" = id del último que ya tienes (0 = los últimos 60). Marca como leídos los recibidos. */
  async '/chat/history'(db, me, body) {
    const key = lower(body.with);
    const cur = NAME.test(key) ? await friendRow(db, me.name, key) : null;
    if (!cur || cur.state !== 'accepted') throw bad('not_friends', 'Solo puedes chatear con tus amigos.', 403);
    const after = Math.max(0, Math.floor(Number(body.after) || 0));
    const q = after
      ? db.prepare('SELECT id, sender, body, ts FROM messages WHERE ((sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1)) AND id > ?3 ORDER BY id ASC LIMIT 100').bind(me.name, key, after)
      : db.prepare('SELECT id, sender, body, ts FROM (SELECT id, sender, body, ts FROM messages WHERE (sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1) ORDER BY id DESC LIMIT 60) ORDER BY id ASC').bind(me.name, key);
    const rows = (await q.all()).results || [];
    await db.prepare('UPDATE messages SET read = 1 WHERE recipient = ? AND sender = ? AND read = 0').bind(me.name, key).run();
    return { ok: true, messages: rows.map((m) => ({ id: m.id, mine: m.sender === me.name, body: m.body, ts: m.ts })) };
  },
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'GET') return json({ name: 'atenas-social', v: 2, ok: true });
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const handler = routes[url.pathname];
    if (!handler) return json({ ok: false, error: 'not_found', message: 'Ruta desconocida' }, 404);
    if (!env.DB) return json({ ok: false, error: 'no_db', message: 'Falta enlazar la base de datos D1 "DB" al Worker (mira social-worker/LEEME.md).' }, 500);
    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY) throw bad('too_big', 'Mensaje demasiado grande.', 413);
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { throw bad('bad_json', 'JSON no válido.'); } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      await ensureSchema(env.DB);
      const now = Date.now();
      const me = await authenticate(req, env.DB, now);
      return json(await handler(env.DB, me, body, now));
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
      return json({ ok: false, error: 'server', message: 'Error del servicio: ' + (e && e.message ? e.message : e) }, 500);
    }
  },
};

export const _internals = { FRESH_MS, KEEP_MSGS, MSG_COOLDOWN_MS };
