// Atenas Social: amigos con solicitudes, chat y presencia (Cloudflare Workers + D1, plan gratis).
// Lo usan el launcher y el cliente de Minecraft. Guía: social-worker/LEEME.md
//
// Identidad: el primer dispositivo que usa un nick se queda con él (token secreto por instalación, se guarda como hash).
// El launcher y el cliente de la misma PC comparten el token (archivo ~/.atenasclient/social.json), así que son "la misma persona".
import { ADMIN_HTML } from './admin-page.mjs';

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
const MOJANG_HAS_JOINED = 'https://sessionserver.mojang.com/session/minecraft/hasJoined';
const CHALLENGE_MS = 60000;       // tiempo que vale un desafío de verificación
const HAS_JOINED_WAITS = [0, 400, 800, 1200, 1600]; // ms de espera antes de cada intento a Mojang (hasJoined tarda en verse tras joinServer). Los clientes esperan hasta 25 s esta llamada.
// Relay opcional (social-worker/relay/): Mojang bloquea (403) las IPs de Cloudflare Workers, asi que el hasJoined se hace desde una maquina
// normal (tu VM de Azure). Se activa con los secretos MOJANG_RELAY_URL y MOJANG_RELAY_KEY; sin ellos se habla directo con Mojang como antes.
const RELAY = { url: '', key: '' };
const MAX_CHALLENGES = 8;         // desafíos vivos a la vez por nick
const MAX_TOKENS = 5;             // instalaciones (PC) que una cuenta verificada puede tener enlazadas

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
  // Catálogo de cosméticos administrado desde /admin: reglas de exclusividad (incorporados) y cosméticos personalizados (con textura).
  'CREATE TABLE IF NOT EXISTS cosmetic_defs (key TEXT PRIMARY KEY, type TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, glow INTEGER NOT NULL DEFAULT 0, base TEXT NOT NULL DEFAULT \'\', frames INTEGER NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT \'global\', custom INTEGER NOT NULL DEFAULT 0, ver INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS cosmetic_grants (key TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (key, name))',
  'CREATE TABLE IF NOT EXISTS cosmetic_assets (key TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, kind))',
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  // Verificación con Mojang: desafíos de un solo uso (ligados a la instalación que los pidió) y las instalaciones enlazadas a una cuenta verificada.
  'CREATE TABLE IF NOT EXISTS auth_challenges (name TEXT NOT NULL, th TEXT NOT NULL, sid TEXT NOT NULL, exp INTEGER NOT NULL, PRIMARY KEY (name, th))',
  'CREATE TABLE IF NOT EXISTS auth_tokens (name TEXT NOT NULL, th TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (name, th))',
];
let schemaReady = null;
/** Agrega una columna a una tabla que ya existía (CREATE TABLE IF NOT EXISTS no toca las tablas viejas). */
async function addColumn(db, table, col, def) {
  const cols = (await db.prepare('PRAGMA table_info(' + table + ')').all()).results || [];
  if (!cols.some((c) => c.name === col)) await db.prepare('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + def).run();
}
async function migrate(db) {
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  // verified = 1 solo si el dueño demostró con Mojang que la cuenta premium es suya. Las cuentas sin conexión quedan en 0.
  await addColumn(db, 'users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn(db, 'users', 'uuid', "TEXT NOT NULL DEFAULT ''");
}
/** Reglas que existen desde el principio (una sola vez: si luego las borras desde /admin, no vuelven). Catalina es solo de kaspercitoo. */
const SEED_VERSION = 'seed_v1';
async function seed(db) {
  const done = await db.prepare('SELECT v FROM meta WHERE k = ?').bind(SEED_VERSION).first();
  if (done) return;
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO cosmetic_defs (key, type, id, name, scope, custom, ts) VALUES (?, ?, ?, ?, ?, 0, ?)').bind('pet:catalina', 'pet', 'catalina', 'Catalina', 'private', now),
    db.prepare('INSERT OR IGNORE INTO cosmetic_grants (key, name) VALUES (?, ?)').bind('pet:catalina', 'kaspercitoo'),
    db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind('cat_rev', String(now)),
    db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(SEED_VERSION, String(now)),
  ]);
}
function ensureSchema(db) {
  if (!schemaReady) schemaReady = migrate(db).then(() => seed(db)).catch((e) => { schemaReady = null; throw e; });
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

/**
 * Identifica (o registra la primera vez) a quien llama. Devuelve la fila del usuario.
 * - Nick SIN verificar (cuentas sin conexión o premium que aún no se verificaron): la identidad es el nick, como siempre.
 *   Sirve para amigos y chat, pero NO da acceso a cosméticos privados.
 * - Nick VERIFICADO con Mojang (verified = 1): solo entran las instalaciones que lo demostraron (auth_tokens). Otra PC debe
 *   verificarse otra vez (el cliente lo hace solo con su sesión de Minecraft). `allowUnbound` es para /auth/*, que es justo eso.
 */
async function authenticate(req, db, now, allowUnbound = false) {
  const display = String(req.headers.get('x-name') || '').trim();
  const token = String(req.headers.get('x-token') || '');
  if (!NAME.test(display)) throw bad('bad_name', 'Nombre de Minecraft no válido.');
  if (token.length < 16 || token.length > 128) throw bad('bad_token', 'Falta el token de esta instalación.', 401);
  const key = lower(display);
  const hash = await sha256(token);
  const row = await db.prepare('SELECT * FROM users WHERE name = ?').bind(key).first();
  if (!row) {
    await db.prepare('INSERT INTO users (name, display, token, created) VALUES (?, ?, ?, ?)').bind(key, display, hash, now).run();
    return { name: key, display, token: hash, launcher_ts: 0, game_ts: 0, l_playing: 0, pack: '', server: '', created: now, verified: 0, uuid: '', th: hash };
  }
  row.th = hash;
  if (row.verified && !allowUnbound) {
    const bound = await db.prepare('SELECT 1 AS x FROM auth_tokens WHERE name = ? AND th = ?').bind(key, hash).first();
    if (!bound) throw bad('verify_required', 'Este nick es de una cuenta premium verificada. Entra con tu cuenta de Microsoft para usarlo.', 403);
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
      friends.push({ ...info, ...p, seen: Math.max(r.launcher_ts || 0, r.game_ts || 0), unread: (unread[other] || {}).n || 0, preview: previews[other] || null });
    } else if (r.requester === me.name) outgoing.push(info);
    else incoming.push(info);
  }
  const order = { playing: 0, online: 1, offline: 2 };
  friends.sort((x, y) => order[x.state] - order[y.state] || x.name.localeCompare(y.name));
  incoming.sort((x, y) => y.ts - x.ts);
  outgoing.sort((x, y) => y.ts - x.ts);
  const totalUnread = Object.values(unread).reduce((s, v) => s + v.n, 0);
  return { ok: true, me: me.display, now, verified: !!me.verified, friends, incoming, outgoing, unread: totalUnread };
}

async function userExists(db, key) { return db.prepare('SELECT name, display FROM users WHERE name = ?').bind(key).first(); }
async function friendRow(db, x, y) { const [a, b] = pair(x, y); return db.prepare('SELECT * FROM friends WHERE a = ? AND b = ?').bind(a, b).first(); }

// ---------------------------------------------------------------------------------------------------------------------
// Cosméticos: reglas de exclusividad y catálogo personalizado (se administra desde /admin, ver admin-page.mjs)
// ---------------------------------------------------------------------------------------------------------------------
const COS_TYPES = ['cape', 'wings', 'hat', 'pet'];
const COS_ID = /^[a-z0-9_]{1,24}$/;
const MAX_TEX = 1000000;              // bytes de una textura PNG
const MAX_ICON = 60000;               // bytes del icono 32x32
const MAX_CUSTOM = 200;               // cosméticos personalizados en total
const MAX_ADMIN_BODY = 1800000;       // cuerpo de una petición /admin (textura en base64 incluida)

/** Reglas en memoria: clave "tipo:id" -> Set de nicks (minúsculas) que pueden usarlo. Solo están los cosméticos privados. Se recarga al cambiar "cat_rev". */
let rulesCache = { rev: null, rules: new Map() };
async function currentRev(db) {
  const r = await db.prepare('SELECT v FROM meta WHERE k = ?').bind('cat_rev').first();
  return r ? String(r.v) : '0';
}
async function loadRules(db) {
  const rev = await currentRev(db);
  if (rulesCache.rev === rev) return rulesCache;
  const defs = (await db.prepare('SELECT key FROM cosmetic_defs WHERE scope = ?').bind('private').all()).results || [];
  const grants = (await db.prepare('SELECT key, name FROM cosmetic_grants').all()).results || [];
  const rules = new Map(defs.map((d) => [d.key, new Set()]));
  for (const g of grants) { const set = rules.get(g.key); if (set) set.add(g.name); }
  rulesCache = { rev, rules };
  return rulesCache;
}
/** ¿Puede este nick llevar ese cosmético? Lo que no es privado lo puede llevar cualquiera. Un cosmético privado exige estar en la lista Y tener la cuenta premium verificada con Mojang (un nick sin verificar podría ser un impostor). */
const canUse = (rules, type, id, nick, verified) => { const set = rules.get(type + ':' + id); return !set || (!!verified && set.has(lower(nick))); };
async function bumpRev(db) {
  await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('cat_rev', String(Math.max(Date.now(), Number(await currentRev(db)) + 1))).run();
}

function b64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Comprueba que sea un PNG de verdad y devuelve su tamaño (lee la cabecera IHDR). */
function pngInfo(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// ---- administración (solo con la clave ADMIN_KEY del Worker)
const adminJson = (o, status = 200) => json(o, status);

async function adminAuth(req, env, db, now) {
  const key = env.ADMIN_KEY;
  if (!key || String(key).length < 12) throw bad('admin_disabled', 'El panel está apagado: crea el secreto ADMIN_KEY (mínimo 12 caracteres). Mira social-worker/LEEME.md.', 503);
  // freno a los intentos fallidos: 10 por cada 10 minutos
  const row = await db.prepare('SELECT v FROM meta WHERE k = ?').bind('admin_fail').first();
  let [count, start] = row ? String(row.v).split('|').map(Number) : [0, now];
  if (now - start > 600000) { count = 0; start = now; }
  if (count >= 10) throw bad('too_many', 'Demasiados intentos con clave incorrecta. Espera unos minutos.', 429);
  const given = String(req.headers.get('x-admin-key') || '');
  if (!sameHash(await sha256(given), await sha256(String(key)))) {
    await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('admin_fail', (count + 1) + '|' + start).run();
    throw bad('bad_key', 'Clave de administrador incorrecta.', 401);
  }
  if (count) await db.prepare('DELETE FROM meta WHERE k = ?').bind('admin_fail').run();
}

async function adminItems(db) {
  const defs = (await db.prepare('SELECT * FROM cosmetic_defs ORDER BY type, ts').all()).results || [];
  const grants = (await db.prepare('SELECT key, name FROM cosmetic_grants ORDER BY name').all()).results || [];
  const owners = new Map();
  for (const g of grants) { if (!owners.has(g.key)) owners.set(g.key, []); owners.get(g.key).push(g.name); }
  return defs.map((d) => ({ key: d.key, type: d.type, id: d.id, name: d.name, color: d.color, glow: !!d.glow, base: d.base, frames: d.frames, scope: d.scope, custom: !!d.custom, ver: d.ver, owners: owners.get(d.key) || [] }));
}

const adminRoutes = {
  async '/admin/ping'() { return { ok: true }; },

  async '/admin/list'(db) { return { ok: true, items: await adminItems(db), rev: await currentRev(db) }; },

  /** Nicks que ya usaron Atenas (para elegir a quién dárselo). "q" filtra por texto. */
  async '/admin/players'(db, body) {
    const q = String(body.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
    const rows = (await db.prepare('SELECT display, MAX(launcher_ts, game_ts) AS seen FROM users WHERE name LIKE ? ORDER BY seen DESC LIMIT 200').bind('%' + q + '%').all()).results || [];
    return { ok: true, players: rows.map((r) => ({ name: r.display, seen: r.seen })) };
  },

  /**
   * Crea o actualiza un cosmético. Dos clases:
   *  - custom=false: una REGLA sobre un cosmético que ya viene en el mod (por ejemplo la mascota "catalina"). Sin textura.
   *  - custom=true : un cosmético NUEVO (id "x_...") con su textura PNG; usa el modelo de otro ya incluido ("base").
   * scope: "global" = todos lo ven y lo pueden elegir; "private" = solo los nicks de "owners" lo pueden elegir (y solo en ellos se dibuja).
   */
  async '/admin/save'(db, body, now) {
    const type = String(body.type || '');
    const id = String(body.id || '');
    if (!COS_TYPES.includes(type)) throw bad('bad_type', 'Tipo no válido (cape, wings, hat o pet).');
    if (!COS_ID.test(id)) throw bad('bad_id', 'El id solo admite minúsculas, números y _ (máximo 24).');
    const custom = !!body.custom;
    const scope = body.scope === 'private' ? 'private' : 'global';
    const key = type + ':' + id;
    const owners = [...new Set((Array.isArray(body.owners) ? body.owners : []).map(lower).filter((n) => NAME.test(n)))].slice(0, 100);
    const old = await db.prepare('SELECT * FROM cosmetic_defs WHERE key = ?').bind(key).first();

    if (!custom) {
      // regla sobre un cosmético incorporado: si queda "global" no hay nada que recordar
      if (scope === 'global') { await adminDelete(db, key); return { ok: true, removed: true }; }
      if (old && old.custom) throw bad('exists', 'Ese id ya es un cosmético personalizado.', 409);
      const name = String(body.name || id).slice(0, 32);
      const stmts = [
        db.prepare('INSERT INTO cosmetic_defs (key, type, id, name, scope, custom, ts) VALUES (?1, ?2, ?3, ?4, \'private\', 0, ?5) ON CONFLICT(key) DO UPDATE SET name = ?4, scope = \'private\', ts = ?5').bind(key, type, id, name, now),
        db.prepare('DELETE FROM cosmetic_grants WHERE key = ?').bind(key),
        ...owners.map((n) => db.prepare('INSERT INTO cosmetic_grants (key, name) VALUES (?, ?)').bind(key, n)),
      ];
      await db.batch(stmts);
      await bumpRev(db);
      return { ok: true, key };
    }

    // ---- cosmético personalizado
    if (!id.startsWith('x_')) throw bad('bad_id', 'Los cosméticos nuevos usan un id que empieza por "x_" (así nunca chocan con los del mod).');
    if (old && !old.custom) throw bad('exists', 'Ese id ya es una regla de un cosmético incorporado.', 409);
    const base = String(body.base || '');
    if (!COS_ID.test(base)) throw bad('bad_base', 'Falta el modelo base (el cosmético del mod cuya forma se reutiliza).');
    const name = String(body.name || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 32);
    if (!name) throw bad('bad_name', 'Falta el nombre.');
    const frames = type === 'cape' && Number(body.frames) === 12 ? 12 : 1;
    const color = Math.max(0, Math.min(0xffffffff, Math.floor(Number(body.color) || 0xff8b5cf6))) >>> 0;
    const glow = body.glow ? 1 : 0;
    if (!old) {
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM cosmetic_defs WHERE custom = 1').first()).n;
      if (n >= MAX_CUSTOM) throw bad('too_many', 'Ya hay ' + MAX_CUSTOM + ' cosméticos personalizados.', 409);
    }
    let tex = null, icon = null;
    if (body.tex_b64) {
      let bytes;
      try { bytes = b64ToBytes(body.tex_b64); } catch { throw bad('bad_png', 'La textura no es base64 válido.'); }
      if (bytes.length > MAX_TEX) throw bad('too_big', 'La textura pesa más de ' + Math.round(MAX_TEX / 1000) + ' KB.', 413);
      const info = pngInfo(bytes);
      if (!info || info.w < 8 || info.h < 8 || info.w > 4096 || info.h > 4096 * 2) throw bad('bad_png', 'La textura debe ser un PNG (máximo 4096 px de ancho).');
      tex = String(body.tex_b64).replace(/\s+/g, '');
    }
    if (body.icon_b64) {
      let bytes;
      try { bytes = b64ToBytes(body.icon_b64); } catch { throw bad('bad_png', 'El icono no es base64 válido.'); }
      const info = pngInfo(bytes);
      if (!info || info.w !== 32 || info.h !== 32 || bytes.length > MAX_ICON) throw bad('bad_png', 'El icono debe ser un PNG de 32x32 px.');
      icon = String(body.icon_b64).replace(/\s+/g, '');
    }
    const hasTex = tex || (old && (await db.prepare('SELECT 1 AS x FROM cosmetic_assets WHERE key = ? AND kind = ?').bind(key, 'tex').first()));
    const hasIcon = icon || (old && (await db.prepare('SELECT 1 AS x FROM cosmetic_assets WHERE key = ? AND kind = ?').bind(key, 'icon').first()));
    if (!hasTex) throw bad('no_tex', 'Falta la textura PNG.');
    if (!hasIcon) throw bad('no_icon', 'Falta el icono 32x32.');
    const ver = (old ? old.ver : 0) + (tex || icon ? 1 : 0);
    const stmts = [
      db.prepare('INSERT INTO cosmetic_defs (key, type, id, name, color, glow, base, frames, scope, custom, ver, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11) ON CONFLICT(key) DO UPDATE SET name = ?4, color = ?5, glow = ?6, base = ?7, frames = ?8, scope = ?9, ver = ?10, ts = ?11').bind(key, type, id, name, color, glow, base, frames, scope, ver, now),
      db.prepare('DELETE FROM cosmetic_grants WHERE key = ?').bind(key),
      ...owners.map((n) => db.prepare('INSERT INTO cosmetic_grants (key, name) VALUES (?, ?)').bind(key, n)),
    ];
    if (tex) stmts.push(db.prepare('INSERT INTO cosmetic_assets (key, kind, data) VALUES (?1, \'tex\', ?2) ON CONFLICT(key, kind) DO UPDATE SET data = ?2').bind(key, tex));
    if (icon) stmts.push(db.prepare('INSERT INTO cosmetic_assets (key, kind, data) VALUES (?1, \'icon\', ?2) ON CONFLICT(key, kind) DO UPDATE SET data = ?2').bind(key, icon));
    await db.batch(stmts);
    await bumpRev(db);
    return { ok: true, key, ver };
  },

  async '/admin/delete'(db, body) {
    const key = String(body.key || '');
    if (!/^(cape|wings|hat|pet):[a-z0-9_]{1,24}$/.test(key)) throw bad('bad_key', 'Clave no válida.');
    await adminDelete(db, key);
    return { ok: true };
  },
};

async function adminDelete(db, key) {
  await db.batch([
    db.prepare('DELETE FROM cosmetic_defs WHERE key = ?').bind(key),
    db.prepare('DELETE FROM cosmetic_grants WHERE key = ?').bind(key),
    db.prepare('DELETE FROM cosmetic_assets WHERE key = ?').bind(key),
  ]);
  await bumpRev(db);
}

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

const routes = {
  /**
   * Verificación de cuenta premium, paso 1. El Worker da un serverId de un solo uso (válido 60 s y ligado a la instalación
   * que lo pidió). El cliente lo registra en Mojang con SU token de sesión (joinServer): solo el dueño de la cuenta puede hacerlo.
   */
  async '/auth/challenge'(db, me, body, now) {
    await db.prepare('DELETE FROM auth_challenges WHERE exp < ?').bind(now).run();
    const others = (await db.prepare('SELECT COUNT(*) AS n FROM auth_challenges WHERE name = ? AND th != ?').bind(me.name, me.th).first()).n;
    if (others >= MAX_CHALLENGES) throw bad('too_many', 'Demasiados intentos de verificación seguidos. Espera un minuto.', 429);
    const sid = randomHex(16);
    await db.prepare('INSERT INTO auth_challenges (name, th, sid, exp) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(name, th) DO UPDATE SET sid = ?3, exp = ?4').bind(me.name, me.th, sid, now + CHALLENGE_MS).run();
    return { ok: true, serverId: sid, expires: now + CHALLENGE_MS };
  },

  /**
   * Paso 2: el Worker le pregunta a Mojang (hasJoined) si ese nick acaba de registrar ese serverId. Si sí, la cuenta es
   * premium de verdad y de esta persona: queda verified = 1 y esta instalación queda enlazada. La primera vez que un nick se
   * verifica se sueltan las instalaciones que lo usaban antes (alguien pudo haberlo reclamado sin ser el dueño).
   */
  async '/auth/verify'(db, me, body, now) {
    const ch = await db.prepare('SELECT sid, exp FROM auth_challenges WHERE name = ? AND th = ?').bind(me.name, me.th).first();
    if (!ch || ch.exp < now) throw bad('no_challenge', 'La verificación caducó. Inténtalo otra vez.');
    // Mojang a veces tarda unos cientos de ms en "ver" el joinServer que el cliente acaba de hacer: si el primer hasJoined
    // dice 204/403 se reintenta unas veces antes de dar la cuenta por no verificada.
    const waits = globalThis.ATENAS_HASJOINED_WAITS || HAS_JOINED_WAITS;
    const qs = '?username=' + encodeURIComponent(me.display) + '&serverId=' + encodeURIComponent(ch.sid);
    const direct = MOJANG_HAS_JOINED + qs;
    let res = null;
    const trace = []; // diagnóstico: qué respondió Mojang en cada intento (204 = no ve el joinServer, 403 = nos bloquea, 429 = límite)
    // Pregunta a Mojang por el relay (si hay) y, si el relay no contesta o Mojang lo bloquea, directo desde el Worker.
    const ask = async () => {
      if (RELAY.url) {
        const t0 = Date.now();
        try {
          const r = await fetch(RELAY.url + '/hasJoined' + qs, { headers: { accept: 'application/json', 'x-relay-key': RELAY.key }, signal: AbortSignal.timeout(5000) });
          trace.push('relay:' + r.status + '@' + (Date.now() - t0) + 'ms');
          if (r.status === 200 || r.status === 204) return r;
        } catch (e) { trace.push('relay:' + String((e && e.name) || e) + '@' + (Date.now() - t0) + 'ms'); }
      }
      const t1 = Date.now();
      const r = await fetch(direct, { headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'AtenasSocial/1.0' }, signal: AbortSignal.timeout(4000) });
      trace.push(r.status + '@' + (Date.now() - t1) + 'ms');
      return r;
    };
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
      try { res = await ask(); }
      catch (e) { throw bad('mojang_down', 'No se pudo hablar con Mojang (' + String((e && e.name) || e) + '). Inténtalo en un momento. [' + trace.join(', ') + ']', 503); }
      if (res.status !== 204 && res.status !== 403) break; // 200 (o un error real): no hace falta reintentar
    }
    if (res.status === 204 || res.status === 403) {
      let snip = '';
      if (res.status === 403) { try { snip = ' body=' + (await res.text()).slice(0, 120); } catch { /* sin cuerpo */ } }
      throw bad('not_verified', 'Mojang no confirmó esta cuenta (cuenta sin conexión o sesión caducada). [' + (RELAY.url ? 'relay' : 'worker→mojang') + ': ' + trace.join(', ') + snip + ']', 401);
    }
    if (!res.ok) throw bad('mojang_down', 'Mojang respondió con error ' + res.status + '. Inténtalo en un momento.', 503);
    let prof = null;
    try { prof = await res.json(); } catch { /* respuesta rara */ }
    const uuid = lower(prof && prof.id);
    if (!/^[0-9a-f]{32}$/.test(uuid) || lower(prof.name) !== me.name) throw bad('not_verified', 'Mojang no confirmó esta cuenta.', 401);
    const newOwner = !me.verified || (me.uuid && me.uuid !== uuid); // primera vez, o el nick pasó a otra cuenta de Mojang
    await db.batch([
      db.prepare('DELETE FROM auth_challenges WHERE name = ? AND th = ?').bind(me.name, me.th),
      ...(newOwner ? [db.prepare('DELETE FROM auth_tokens WHERE name = ?').bind(me.name)] : []),
      db.prepare('INSERT INTO auth_tokens (name, th, ts) VALUES (?1, ?2, ?3) ON CONFLICT(name, th) DO UPDATE SET ts = ?3').bind(me.name, me.th, now),
      db.prepare('DELETE FROM auth_tokens WHERE name = ?1 AND th NOT IN (SELECT th FROM auth_tokens WHERE name = ?1 ORDER BY ts DESC LIMIT ' + MAX_TOKENS + ')').bind(me.name),
      db.prepare('UPDATE users SET verified = 1, uuid = ?, display = ? WHERE name = ?').bind(uuid, me.display, me.name),
    ]);
    return { ok: true, verified: true, uuid };
  },

  async '/sync'(db, me, body, now) {
    await applyPresence(db, me, body.presence, now);
    // el propio estado se ve ya reflejado en lo que devuelve
    return snapshot(db, me, now);
  },

  /**
   * Consulta liviana (2 lecturas pequeñas) para enterarse rápido de mensajes o solicitudes nuevas sin bajar todo el estado.
   * El launcher y el juego la llaman cada pocos segundos y solo piden /sync completo cuando algo cambió.
   */
  async '/poll'(db, me, body, now) {
    const m = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last FROM messages WHERE recipient = ? AND read = 0').bind(me.name).first();
    const r = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE (a = ?1 OR b = ?1) AND state = \'pending\' AND requester != ?1').bind(me.name).first();
    return { ok: true, now, unread: m.n, last: m.last, incoming: r.n };
  },

  /**
   * Cosméticos (capa, alas, sombrero, mascota) que elige cada jugador. Los ven todos los que usan el mod de Atenas.
   * Un campo que NO viene en la petición conserva su valor anterior: así un cliente viejo (que aún no manda "pet")
   * no borra la mascota que elegiste desde uno nuevo.
   */
  async '/cosmetics/set'(db, me, body, now) {
    const valid = (v) => /^[a-z0-9_]{1,24}$/.test(String(v || ''));
    const clean = (v) => (valid(v) ? String(v) : 'none');
    const prev = await db.prepare('SELECT data FROM cosmetics WHERE name = ?').bind(me.name).first();
    let old = {};
    if (prev) { try { old = JSON.parse(prev.data) || {}; } catch { old = {}; } }
    const { rules } = await loadRules(db);
    const denied = [];
    // Un cosmético privado solo se guarda si el nick está en su lista; si no, queda en "none" y se avisa (el cliente lo quita).
    const pick = (k) => {
      let v = body[k] === undefined ? clean(old[k]) : clean(body[k]);
      if (v !== 'none' && !canUse(rules, k, v, me.name, me.verified)) { denied.push({ type: k, id: v }); v = 'none'; }
      return v;
    };
    const data = JSON.stringify({ cape: pick('cape'), wings: pick('wings'), hat: pick('hat'), pet: pick('pet') });
    await db.prepare('INSERT INTO cosmetics (name, data, ts) VALUES (?1, ?2, ?3) ON CONFLICT(name) DO UPDATE SET data = ?2, ts = ?3').bind(me.name, data, now).run();
    return { ok: true, denied };
  },

  /** Cosméticos de hasta 80 jugadores a la vez (los que tienes cerca). D1 admite 100 parámetros por consulta. Lo que un jugador no tiene permiso de llevar NO se entrega. */
  async '/cosmetics/get'(db, me, body) {
    const names = [...new Set((Array.isArray(body.names) ? body.names : []).map(lower).filter((n) => NAME.test(n)))].slice(0, 80);
    const players = {};
    if (!names.length) return { ok: true, players };
    const rows = (await db.prepare(`SELECT c.name AS name, c.data AS data, COALESCE(u.verified, 0) AS verified FROM cosmetics c LEFT JOIN users u ON u.name = c.name WHERE c.name IN (${names.map(() => '?').join(',')})`).bind(...names).all()).results || [];
    const { rules } = await loadRules(db);
    for (const r of rows) {
      let d;
      try { d = JSON.parse(r.data); } catch { continue; /* fila dañada: se ignora */ }
      if (!d || typeof d !== 'object') continue;
      for (const k of COS_TYPES) if (d[k] && d[k] !== 'none' && !canUse(rules, k, d[k], r.name, r.verified)) d[k] = 'none';
      players[r.name] = d;
    }
    return { ok: true, players };
  },

  /**
   * Catálogo para los clientes: los cosméticos personalizados y las reglas de exclusividad de los incorporados.
   * "rev" = lo último que ya tiene el cliente; si no cambió contesta {unchanged:true} (una sola lectura).
   */
  async '/cosmetics/catalog'(db, me, body) {
    const rev = await currentRev(db);
    if (String(body.rev || '') === rev) return { ok: true, rev, unchanged: true };
    const items = (await adminItems(db)).map((d) => ({
      type: d.type, id: d.id, name: d.name, color: d.color, glow: d.glow, base: d.base, frames: d.frames,
      scope: d.scope, custom: d.custom, ver: d.ver, owners: d.scope === 'private' ? d.owners : undefined,
    }));
    return { ok: true, rev, items };
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
    RELAY.url = String(env.MOJANG_RELAY_URL || '').trim().replace(/\/+$/, '');
    RELAY.key = String(env.MOJANG_RELAY_KEY || '');
    const url = new URL(req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
      if (url.pathname === '/cosmetics/asset') return asset(url, env);
      return json({ name: 'atenas-social', v: 5, ok: true });
    }
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const isAdmin = url.pathname.startsWith('/admin/');
    const handler = isAdmin ? adminRoutes[url.pathname] : routes[url.pathname];
    if (!handler) return json({ ok: false, error: 'not_found', message: 'Ruta desconocida' }, 404);
    if (!env.DB) return json({ ok: false, error: 'no_db', message: 'Falta enlazar la base de datos D1 "DB" al Worker (mira social-worker/LEEME.md).' }, 500);
    try {
      const raw = await req.text();
      if (raw.length > (isAdmin ? MAX_ADMIN_BODY : MAX_BODY)) throw bad('too_big', 'Mensaje demasiado grande.', 413);
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { throw bad('bad_json', 'JSON no válido.'); } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      await ensureSchema(env.DB);
      const now = Date.now();
      if (isAdmin) {
        await adminAuth(req, env, env.DB, now);
        return adminJson(await handler(env.DB, body, now));
      }
      const me = await authenticate(req, env.DB, now, url.pathname.startsWith('/auth/'));
      return json(await handler(env.DB, me, body, now));
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
      return json({ ok: false, error: 'server', message: 'Error del servicio: ' + (e && e.message ? e.message : e) }, 500);
    }
  },
};

/** Textura o icono de un cosmético personalizado (público: hace falta para dibujarlo en quien lo lleva). "v" solo cambia la URL para que el caché se renueve. */
async function asset(url, env) {
  const key = url.searchParams.get('key') || '';
  const kind = url.searchParams.get('kind') === 'icon' ? 'icon' : 'tex';
  if (!env.DB) return json({ ok: false, error: 'no_db' }, 500);
  if (!/^(cape|wings|hat|pet):x_[a-z0-9_]{1,22}$/.test(key)) return json({ ok: false, error: 'bad_key' }, 400);
  try {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare('SELECT data FROM cosmetic_assets WHERE key = ? AND kind = ?').bind(key, kind).first();
    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    return new Response(b64ToBytes(row.data), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch (e) {
    return json({ ok: false, error: 'server' }, 500);
  }
}

export const _internals = { FRESH_MS, KEEP_MSGS, MSG_COOLDOWN_MS };
