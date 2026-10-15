'use strict';
/**
 * Soporte de CurseForge para el Admin.
 *   curseforge.json       lo que TÚ pides  { entries: [{ slug, modId, title, icon, section }] }
 *   curseforge.lock.json  lo que se resolvió { mods: { modId: { slug, title, filename, fileId, url, explicit } } }
 * Los .jar se descargan a files/mods y su URL se anota en pack.json -> "sources" (igual que Modrinth),
 * así los jars no hace falta subirlos a GitHub. Si el autor desactivó las descargas de terceros,
 * CurseForge no entrega URL: ese mod NO se automatiza (se respeta la decisión del autor).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.curseforge.com/v1';
const GAME = 432;      // Minecraft
const CLASS_MODS = 6;
const LOADERS = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const UA = 'Atenas-Client/1.0 (atenas-admin)';
const GI_BEGIN = '# >>> curseforge-sync (no editar)';
const GI_END = '# <<< curseforge-sync';

function makeHttp(key) {
  return {
    async json(p, body) {
      let res;
      try {
        res = await fetch(API + p, {
          method: body ? 'POST' : 'GET',
          headers: { 'x-api-key': key, Accept: 'application/json', 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch { throw new Error('No se pudo conectar con CurseForge. Revisa tu internet.'); }
      if (res.status === 401 || res.status === 403) {
        let body = '';
        try { body = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 160); } catch { /* sin cuerpo */ }
        const e = new Error(/cloudflare|<html|just a moment/i.test(body)
          ? `CurseForge bloqueó la petición (HTTP ${res.status}, filtro anti-bots; no es un problema de tu key). Espera unos minutos y reintenta.`
          : `CurseForge rechazó la API key (HTTP ${res.status}${body ? ': ' + body : ''}).`);
        e.authFailed = res.status;
        throw e;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`CurseForge respondió HTTP ${res.status}`);
      return res.json();
    },
    async bytes(url) {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

const slim = (m) => ({
  source: 'curseforge',
  modId: m.id,
  slug: m.slug,
  title: m.name,
  description: m.summary || '',
  icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
  downloads: m.downloadCount || 0,
  author: (m.authors && m.authors[0] && m.authors[0].name) || null,
  // false = el autor no permite que otros launchers descarguen el mod
  allowed: m.allowModDistribution !== false,
  url: m.links && m.links.websiteUrl || null,
});

const loaderNum = (loader) => {
  const n = LOADERS[String(loader || '').toLowerCase()];
  if (!n) throw new Error(`CurseForge no soporta el loader "${loader}"`);
  return n;
};

async function search(http, q, { mc, loader, offset = 0 }) {
  const qs = new URLSearchParams({ gameId: GAME, classId: CLASS_MODS, pageSize: 20, index: offset, sortField: q ? 1 : 2, sortOrder: 'desc' });
  if (q) qs.set('searchFilter', q);
  if (mc) qs.set('gameVersion', mc);
  if (loader) qs.set('modLoaderType', loaderNum(loader));
  const r = await http.json(`/mods/search?${qs}`);
  return { hits: ((r && r.data) || []).map(slim), total: r && r.pagination ? r.pagination.totalCount : 0 };
}

async function modBySlug(http, slug) {
  const r = await http.json(`/mods/search?gameId=${GAME}&classId=${CLASS_MODS}&slug=${encodeURIComponent(slug)}`);
  const m = r && r.data && r.data.find((x) => x.slug === slug);
  return m ? slim(m) : null;
}

async function modsByIds(http, ids) {
  if (!ids.length) return {};
  const r = await http.json('/mods', { modIds: ids, filterPcOnly: true });
  return Object.fromEntries(((r && r.data) || []).map((m) => [m.id, slim(m)]));
}

const RANK = { 1: 0, 2: 1, 3: 2 }; // release, beta, alpha
function pickFile(files) {
  const ok = (files || []).filter((f) => f.isAvailable !== false);
  return ok.sort((a, b) => ((RANK[a.releaseType] ?? 3) - (RANK[b.releaseType] ?? 3)) || (new Date(b.fileDate) - new Date(a.fileDate)))[0] || null;
}

async function bestFile(http, modId, { mc, loader }) {
  const qs = new URLSearchParams({ gameVersion: mc, modLoaderType: loaderNum(loader), pageSize: 50 });
  const r = await http.json(`/mods/${modId}/files?${qs}`);
  return pickFile(r && r.data);
}

/** Resuelve lo pedido + dependencias obligatorias. alreadyHave(slug) evita duplicar mods que ya vienen de Modrinth. */
async function resolve(http, entries, { mc, loader, alreadyHave = () => false, log = () => {} }) {
  const resolved = new Map();   // modId -> { mod, file, explicit }
  const problems = [];
  const queue = entries.map((e) => ({ modId: e.modId, mod: e, explicit: true }));
  const seen = new Set();
  while (queue.length) {
    const it = queue.shift();
    if (seen.has(it.modId)) continue;
    seen.add(it.modId);
    let mod = it.mod;
    if (!mod) { mod = (await modsByIds(http, [it.modId]))[it.modId] || { modId: it.modId, slug: String(it.modId), title: 'mod ' + it.modId }; }
    if (!it.explicit && alreadyHave(mod.slug)) { log(`  = ${mod.title}: dependencia que ya tienes, se omite`); continue; }
    const file = await bestFile(http, it.modId, { mc, loader });
    if (!file) { problems.push(`${mod.title}: sin versión para ${loader} ${mc} en CurseForge`); continue; }
    if (!file.downloadUrl) {
      problems.push(`${mod.title}: el autor no permite descargarlo fuera de CurseForge${mod.url ? ' (' + mod.url + ')' : ''}. Elige otro mod o pídele permiso.`);
      continue;
    }
    resolved.set(it.modId, { mod, file, explicit: it.explicit });
    for (const d of file.dependencies || []) if (d.relationType === 3 && !seen.has(d.modId)) queue.push({ modId: d.modId, explicit: false });
  }
  return { resolved, problems };
}

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const paths = (dir) => ({ entries: path.join(dir, 'curseforge.json'), lock: path.join(dir, 'curseforge.lock.json') });

const readEntries = (dir) => readJson(paths(dir).entries, { entries: [] }).entries || [];
function writeEntries(dir, entries) { fs.writeFileSync(paths(dir).entries, JSON.stringify({ entries }, null, 2) + '\n'); }
const readLock = (dir) => readJson(paths(dir).lock, { mods: {} });

function updateGitignore(dir, filenames) {
  const gi = path.join(dir, '.gitignore');
  let cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cur = cur.replace(new RegExp(`${esc(GI_BEGIN)}[\\s\\S]*?${esc(GI_END)}\\n?`), '');
  const block = filenames.length ? `${GI_BEGIN}\n${filenames.map((f) => `files/mods/${f}`).sort().join('\n')}\n${GI_END}\n` : '';
  fs.writeFileSync(gi, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + block);
}

/** Sincroniza los mods de CurseForge del pack. dry=true no escribe ni descarga. Devuelve { problems, added, removed }. */
async function syncCurseforge(dir, { http, dry = false, log = console.log, alreadyHave } = {}) {
  const entries = readEntries(dir);
  const lock = readLock(dir);
  const meta = readJson(path.join(dir, 'pack.json'), {});
  const loader = meta.loader && meta.loader.type;
  const out = { problems: [], added: [], removed: [], kept: 0 };
  if (!entries.length && !Object.keys(lock.mods || {}).length) return out;

  log(`Resolviendo ${entries.length} mods de CurseForge…`);
  const { resolved, problems } = entries.length
    ? await resolve(http, entries, { mc: meta.minecraft, loader, alreadyHave, log })
    : { resolved: new Map(), problems: [] };
  out.problems = problems;

  const modsDir = path.join(dir, 'files', 'mods');
  const newLock = { mods: {} };
  const sources = { ...(meta.sources || {}) };
  const wanted = new Set();
  if (!dry) fs.mkdirSync(modsDir, { recursive: true });

  for (const [modId, r] of resolved) {
    const filename = path.basename(r.file.fileName);
    wanted.add(filename);
    newLock.mods[modId] = { slug: r.mod.slug, title: r.mod.title, filename, fileId: r.file.id, url: r.file.downloadUrl, explicit: r.explicit };
    sources[`mods/${filename}`] = r.file.downloadUrl;
    const dest = path.join(modsDir, filename);
    const want = (r.file.hashes || []).find((h) => h.algo === 1);
    if (fs.existsSync(dest) && (!want || sha1(fs.readFileSync(dest)) === want.value.toLowerCase())) { out.kept++; continue; }
    if (dry) { log(`  + ${filename}`); continue; }
    const buf = await http.bytes(r.file.downloadUrl);
    if (want && sha1(buf) !== want.value.toLowerCase()) throw new Error(`El hash no coincide al descargar ${filename}`);
    fs.writeFileSync(dest, buf);
    out.added.push(filename);
    log(`  + ${filename}${r.explicit ? '' : ' (dependencia)'}`);
  }

  // quitar lo que esta herramienta bajó antes y ya no se pide
  // (si hubo problemas, no se borra nada: un fallo de red no debe vaciar tu pack)
  if (!problems.length) {
    for (const m of Object.values(lock.mods || {})) {
      if (wanted.has(m.filename)) continue;
      delete sources[`mods/${m.filename}`];
      const f = path.join(modsDir, m.filename);
      if (fs.existsSync(f)) { if (!dry) fs.unlinkSync(f); out.removed.push(m.filename); log(`  - ${m.filename}`); }
    }
  }

  if (!dry && !problems.length) {
    meta.sources = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(meta, null, 2) + '\n');
    fs.writeFileSync(paths(dir).lock, JSON.stringify(newLock, null, 2) + '\n');
    updateGitignore(dir, [...wanted]);
  }
  if (problems.length) { log('\nCurseForge — no se pudieron añadir:'); problems.forEach((p) => log('  ! ' + p)); }
  return out;
}

/** Limpia lo que suele colarse al copiar: espacios, saltos de línea, comillas, 'x-api-key:'. */
const cleanKey = (k) => String(k || '').replace(/^\s*x-api-key\s*[:=]\s*/i, '').replace(/[\s"'`]+/g, '');

module.exports = { cleanKey, makeHttp, search, modBySlug, modsByIds, bestFile, pickFile, resolve, syncCurseforge, readEntries, writeEntries, readLock, loaderNum };
