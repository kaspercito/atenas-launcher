'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const mf = require('./lib/modsfile');
const modrinth = require('./lib/modrinth');
const gitlib = require('./lib/git');
const cf = require('./lib/curseforge');
const { syncPack } = require('../tools/pack-sync');

let win = null;
let busy = false;
const snapshots = new Map();   // packDir -> { txt, cf }: estado cuando lo abriste (para "Descartar")
const infoCache = new Map();   // slug/id -> { title, icon, ... }

const settingsFile = () => path.join(app.getPath('userData'), 'admin-settings.json');
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const getSettings = () => readJson(settingsFile(), {});
const saveSettings = (patch) => {
  const s = { ...getSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  return s;
};

// API key de CurseForge: cifrada con el almacén del sistema (DPAPI en Windows) cuando se puede
function getCfKey() {
  const s = getSettings();
  try {
    if (s.cfKeyEnc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(s.cfKeyEnc, 'base64'));
  } catch { /* clave ilegible: se pedirá otra vez */ }
  return s.cfKeyPlain || null;
}
function setCfKey(key) {
  if (safeStorage.isEncryptionAvailable()) saveSettings({ cfKeyEnc: safeStorage.encryptString(key).toString('base64'), cfKeyPlain: null });
  else saveSettings({ cfKeyPlain: key, cfKeyEnc: null });
}
function cfHttp() {
  const key = getCfKey();
  if (!key) throw new Error('Falta tu API key de CurseForge (pestaña Añadir mods → CurseForge).');
  const http = cf.makeHttp(key);
  const orig = http.json;
  // Si CurseForge rechaza la key guardada, se borra para poder pegar otra (antes quedaba atascada)
  http.json = async (...a) => {
    try { return await orig(...a); } catch (e) {
      if ((e.authFailed === 401 || e.authFailed === 403) && !/bloque/i.test(e.message)) {
        saveSettings({ cfKeyEnc: null, cfKeyPlain: null });
        e.message += ' Borré la key guardada: ve a Añadir mods → CurseForge y pega una nueva.';
      }
      throw e;
    }
  };
  return http;
}

const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...a) => {
    try { return { ok: true, data: await fn(...a) }; }
    catch (err) { return { ok: false, message: err.message || String(err) }; }
  });
}

// ───────── packs ─────────
const isPackDir = (d) => fs.existsSync(path.join(d, 'pack.json')) && fs.existsSync(path.join(d, 'mods.txt'));

function listPacks(repoDir) {
  if (!repoDir || !fs.existsSync(repoDir)) return [];
  if (isPackDir(repoDir)) return [{ id: path.basename(repoDir), dir: repoDir }];
  return fs.readdirSync(repoDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && isPackDir(path.join(repoDir, d.name)))
    .map((d) => ({ id: d.name, dir: path.join(repoDir, d.name) }));
}

function currentPackDir() {
  const s = getSettings();
  const pack = listPacks(s.repoDir).find((p) => p.id === s.packId);
  if (!pack) throw new Error('Elige primero la carpeta de tus modpacks.');
  return pack.dir;
}

function guessRepoDir() {
  const cands = [
    path.join(__dirname, '..', '..', 'atenas-packs'),
    path.join(app.getPath('home'), 'atenas-packs'),
    path.join(app.getPath('documents'), 'atenas-packs'),
  ];
  return cands.find((c) => listPacks(c).length) || null;
}

async function infoFor(keys) {
  const need = [...new Set(keys.map((k) => String(k).toLowerCase()))].filter((k) => !infoCache.has(k));
  if (need.length) {
    try {
      const got = await modrinth.projects(need);
      for (const k of need) infoCache.set(k, got[k] || got[Object.keys(got).find((x) => x.toLowerCase() === k)] || null);
      for (const [k, v] of Object.entries(got)) infoCache.set(k.toLowerCase(), v);
    } catch { /* sin internet: se muestra el slug */ }
  }
  return (k) => infoCache.get(String(k).toLowerCase()) || null;
}

async function loadPack() {
  const dir = currentPackDir();
  const meta = readJson(path.join(dir, 'pack.json'), {});
  const text = fs.readFileSync(path.join(dir, 'mods.txt'), 'utf8');
  const cfEntries = cf.readEntries(dir);
  const cfLock = cf.readLock(dir);
  const cfNow = JSON.stringify(cfEntries);
  if (!snapshots.has(dir)) snapshots.set(dir, { txt: text, cf: cfNow });
  const lock = readJson(path.join(dir, 'mods.lock.json'), { mods: {} });
  const lockMods = Object.entries(lock.mods || {}).map(([pid, m]) => ({ pid, ...m }));
  const entries = mf.listMods(text);
  const slugs = new Set(entries.map((e) => e.slug.toLowerCase()));

  const info = await infoFor([...entries.map((e) => e.slug), ...lockMods.filter((m) => !m.explicit).flatMap((m) => [m.slug, m.pid])]);

  const mods = entries.map((e) => {
    const l = lockMods.find((m) => m.explicit && String(m.slug).toLowerCase() === e.slug.toLowerCase());
    const i = info(e.slug);
    let status = 'ok';
    if (!l) status = 'new';
    else if (e.pin && e.pin !== l.version) status = 'changed';
    return {
      slug: e.slug, pin: e.pin, section: e.section || '', status,
      version: l ? l.version : null, filename: l ? l.filename : null,
      title: i ? i.title : e.slug, icon: i ? i.icon : null, description: i ? i.description : '',
    };
  });
  const removed = lockMods.filter((m) => m.explicit && !slugs.has(String(m.slug).toLowerCase()))
    .map((m) => ({ slug: m.slug, version: m.version, filename: m.filename, title: (info(m.slug) || {}).title || m.slug }));
  const deps = lockMods.filter((m) => !m.explicit).map((m) => {
    const i = info(m.slug) || info(m.pid);
    return { slug: i ? i.slug : m.slug, title: i ? i.title : m.slug, version: m.version, filename: m.filename, icon: i ? i.icon : null };
  });
  // ── mods de CurseForge ──
  const cfLockMods = Object.entries(cfLock.mods || {}).map(([id, m]) => ({ id: Number(id), ...m }));
  for (const e of cfEntries) {
    const l = cfLockMods.find((m) => m.explicit && m.id === e.modId);
    mods.push({ source: 'curseforge', slug: e.slug, modId: e.modId, pin: null, section: e.section || '', status: l ? 'ok' : 'new',
      version: l ? l.filename : null, filename: l ? l.filename : null, title: e.title || e.slug, icon: e.icon || null, description: '' });
  }
  for (const m of cfLockMods) {
    if (m.explicit && !cfEntries.some((e) => e.modId === m.id)) removed.push({ source: 'curseforge', slug: m.slug, filename: m.filename, title: m.title });
    if (!m.explicit) deps.push({ slug: m.slug, title: m.title, version: null, filename: m.filename, icon: null, source: 'curseforge' });
  }
  const lockFiles = new Set([...lockMods, ...cfLockMods].map((m) => m.filename));
  const modsDir = path.join(dir, 'files', 'mods');
  const manual = fs.existsSync(modsDir)
    ? fs.readdirSync(modsDir).filter((f) => /\.jar$/i.test(f) && !lockFiles.has(f)).map((f) => ({ filename: f, size: fs.statSync(path.join(modsDir, f)).size }))
    : [];

  const pending = mods.filter((m) => m.status !== 'ok').length + removed.length;
  return {
    meta: { id: meta.id, name: meta.name, minecraft: meta.minecraft, loader: meta.loader, server: meta.server },
    mods, removed, deps, manual, pending,
    sections: [...new Set([...mf.listSections(text), ...cfEntries.map((e) => e.section).filter(Boolean)])],
    changed: text !== snapshots.get(dir).txt || cfNow !== snapshots.get(dir).cf,
    cfKey: !!getCfKey(),
    git: await gitlib.root(dir) !== null,
  };
}

function mutateTxt(fn) {
  const dir = currentPackDir();
  const file = path.join(dir, 'mods.txt');
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after);
}

// ───────── IPC ─────────
handle('app:init', async () => {
  let s = getSettings();
  if (!s.repoDir || !fs.existsSync(s.repoDir)) {
    const g = guessRepoDir();
    if (g) s = saveSettings({ repoDir: g });
  }
  const packs = listPacks(s.repoDir);
  if (packs.length && !packs.some((p) => p.id === s.packId)) s = saveSettings({ packId: packs[0].id });
  return { repoDir: s.repoDir || null, packs: packs.map((p) => p.id), packId: s.packId || null, version: app.getVersion() };
});

handle('repo:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige la carpeta atenas-packs (o la de un modpack)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const packs = listPacks(r.filePaths[0]);
  if (!packs.length) throw new Error('Esa carpeta no contiene ningún modpack (busco carpetas con pack.json y mods.txt).');
  saveSettings({ repoDir: r.filePaths[0], packId: packs[0].id });
  return { repoDir: r.filePaths[0], packs: packs.map((p) => p.id), packId: packs[0].id };
});
handle('pack:select', async (id) => { saveSettings({ packId: id }); return true; });
handle('pack:load', loadPack);
handle('pack:openFolder', async () => { await shell.openPath(currentPackDir()); return true; });

handle('mods:add', async ({ source, slug, pin, section, modId, title, icon }) => {
  if (source === 'curseforge') {
    const dir = currentPackDir();
    const entries = cf.readEntries(dir);
    if (!Number.isInteger(modId)) throw new Error('Mod de CurseForge no válido');
    if (entries.some((e) => e.modId === modId)) throw new Error(`"${title || slug}" ya está en la lista`);
    entries.push({ slug, modId, title: title || slug, icon: icon || null, section: section || '' });
    cf.writeEntries(dir, entries);
    // si ya estaba en mods.txt (y Modrinth no lo encontraba), se pasa a CurseForge sin duplicar
    try { mutateTxt((t) => mf.removeMod(t, slug)); } catch { /* no estaba */ }
    return loadPack();
  }
  mutateTxt((t) => mf.addMod(t, { slug: String(slug).trim(), pin: pin || null, section: section || null }));
  return loadPack();
});
handle('mods:remove', async (slug, source) => {
  if (source === 'curseforge') {
    const dir = currentPackDir();
    cf.writeEntries(dir, cf.readEntries(dir).filter((e) => e.slug !== slug));
  } else mutateTxt((t) => mf.removeMod(t, slug));
  return loadPack();
});
handle('mods:pin', async (slug, pin) => { mutateTxt((t) => mf.setPin(t, slug, pin || null)); return loadPack(); });
handle('mods:move', async (slug, section) => { mutateTxt((t) => mf.moveMod(t, slug, section || null)); return loadPack(); });
handle('mods:discard', async () => {
  const dir = currentPackDir();
  if (snapshots.has(dir)) {
    const snap = snapshots.get(dir);
    fs.writeFileSync(path.join(dir, 'mods.txt'), snap.txt);
    cf.writeEntries(dir, JSON.parse(snap.cf));
  }
  return loadPack();
});

handle('mr:search', async (q, offset) => {
  const meta = readJson(path.join(currentPackDir(), 'pack.json'), {});
  return modrinth.search(q, { mc: meta.minecraft, loader: meta.loader && meta.loader.type, offset: offset || 0 });
});
handle('mr:versions', async (slug) => {
  const meta = readJson(path.join(currentPackDir(), 'pack.json'), {});
  return modrinth.versions(slug, { mc: meta.minecraft, loader: meta.loader && meta.loader.type });
});

handle('cf:status', async () => ({ hasKey: !!getCfKey() }));
handle('cf:setKey', async (raw) => {
  const key = cf.cleanKey(raw);
  if (key.length < 20) throw new Error('Esa API key no parece válida (muy corta). Copia la clave completa de console.curseforge.com → API keys.');
  const probe = cf.makeHttp(key);
  try {
    const r = await probe.json('/games/432');    // 401/403 -> lanza con el motivo real
    if (!r) throw new Error('CurseForge no respondió como se esperaba.');
  } catch (err) {
    if (err.authFailed && err.authFailed !== 'x') {
      const shape = key.startsWith('$2') ? '' : ' Ojo: las keys de CurseForge suelen empezar por $2a$10$… y tienen unos 60 caracteres; la tuya empieza distinto, revisa que copiaste la «API key» y no otro dato.';
      err.message += shape;
    }
    throw err;
  }
  setCfKey(key);
  return { hasKey: true };
});
handle('cf:clearKey', async () => { saveSettings({ cfKeyEnc: null, cfKeyPlain: null }); return { hasKey: false }; });
handle('cf:search', async (q, offset) => {
  const meta = readJson(path.join(currentPackDir(), 'pack.json'), {});
  return cf.search(cfHttp(), q, { mc: meta.minecraft, loader: meta.loader && meta.loader.type, offset: offset || 0 });
});

// jars propios (mods que no están en Modrinth): se copian a files/mods y se suben con git
handle('jar:import', async (paths) => {
  const dir = path.join(currentPackDir(), 'files', 'mods');
  fs.mkdirSync(dir, { recursive: true });
  const done = [], skipped = [];
  for (const p of paths || []) {
    if (!/\.jar$/i.test(p) || !fs.existsSync(p)) { skipped.push(path.basename(p) + ' (no es un .jar)'); continue; }
    const size = fs.statSync(p).size;
    if (size > 95 * 1048576) { skipped.push(path.basename(p) + ' (pesa más de 95 MB: GitHub no lo acepta)'); continue; }
    fs.copyFileSync(p, path.join(dir, path.basename(p)));
    done.push(path.basename(p));
  }
  return { done, skipped, pack: await loadPack() };
});
handle('jar:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige uno o varios .jar', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods', extensions: ['jar'] }] });
  return r.canceled ? [] : r.filePaths;
});
handle('jar:delete', async (filename) => {
  const base = path.basename(String(filename));
  const p = await loadPack();
  if (!p.manual.some((m) => m.filename === base)) throw new Error('Solo puedes borrar aquí los mods subidos a mano.');
  fs.unlinkSync(path.join(currentPackDir(), 'files', 'mods', base));
  return loadPack();
});

// ───────── ajustes del pack (pack.json): Minecraft, Forge/loader, RAM, servidor ─────────
const LOADERS = ['forge', 'neoforge', 'fabric', 'quilt'];
const memMb = (v) => { const m = /^(\d+)\s*([GgMm])$/.exec(String(v || '').trim()); return m ? (/g/i.test(m[2]) ? Number(m[1]) * 1024 : Number(m[1])) : null; };

function readConfig() {
  const m = readJson(path.join(currentPackDir(), 'pack.json'), {});
  return {
    name: m.name || '',
    minecraft: m.minecraft || '',
    loader: { type: (m.loader && m.loader.type) || 'forge', version: (m.loader && m.loader.version) || '' },
    ram: { min: (m.ram && m.ram.min) || '2G', max: (m.ram && m.ram.max) || '4G' },
    server: m.server || '',
  };
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'AtenasAdmin' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

handle('pack:getConfig', async () => readConfig());

handle('pack:saveConfig', async (c) => {
  const file = path.join(currentPackDir(), 'pack.json');
  const meta = readJson(file, null);
  if (!meta) throw new Error('No pude leer pack.json');
  const mc = String(c.minecraft || '').trim();
  if (!/^\d+\.\d+(\.\d+)?$/.test(mc)) throw new Error('La versión de Minecraft debe verse como 1.20.1');
  const type = String(c.loader && c.loader.type || '').toLowerCase();
  if (!LOADERS.includes(type)) throw new Error('Loader no válido: ' + type);
  const lv = String(c.loader && c.loader.version || '').trim();
  if ((type === 'forge' || type === 'neoforge') && !lv) throw new Error(`Para ${type} tienes que indicar la versión exacta (ej. 47.3.0).`);
  const min = String(c.ram && c.ram.min || '').trim().toUpperCase();
  const max = String(c.ram && c.ram.max || '').trim().toUpperCase();
  if (memMb(min) == null || memMb(max) == null) throw new Error('La RAM debe ser como 4G o 4096M.');
  if (memMb(min) > memMb(max)) throw new Error('La RAM mínima no puede ser mayor que la máxima.');
  if (memMb(max) < 1024) throw new Error('La RAM máxima debe ser al menos 1G.');

  meta.minecraft = mc;
  meta.loader = lv ? { type, version: lv } : { type };
  meta.ram = { min, max };
  const name = String(c.name || '').trim();
  if (name) meta.name = name;
  const server = String(c.server || '').trim();
  if (server) meta.server = server; else delete meta.server;
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
  return { config: readConfig(), pack: await loadPack() };
});

// Sugerencias de versión del loader para el Minecraft indicado (si falla, se escribe a mano)
handle('loader:versions', async (type, mc) => {
  mc = String(mc || '').trim();
  if (type === 'forge') {
    const j = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const out = [];
    const rec = j.promos && j.promos[`${mc}-recommended`];
    const lat = j.promos && j.promos[`${mc}-latest`];
    if (rec) out.push({ version: rec, label: 'recomendada' });
    if (lat && lat !== rec) out.push({ version: lat, label: 'última' });
    return out;
  }
  if (type === 'fabric' || type === 'quilt') {
    const base = type === 'fabric' ? 'https://meta.fabricmc.net/v2/versions/loader' : 'https://meta.quiltmc.org/v3/versions/loader';
    const list = await getJson(`${base}/${encodeURIComponent(mc)}`);
    return list.slice(0, 8).map((e) => ({ version: e.loader.version, label: e.loader.stable === false ? 'beta' : 'estable' }));
  }
  if (type === 'neoforge') {
    const [, minor, patch] = mc.split('.');
    const prefix = `${minor}.${patch || 0}.`;
    const j = await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    const vs = (j.versions || []).filter((v) => v.startsWith(prefix) && !/-/.test(v)).slice(-8).reverse();
    return vs.map((v, i) => ({ version: v, label: i === 0 ? 'última' : '' }));
  }
  return [];
});

// ───────── sincronizar y publicar ─────────
// Mods de CurseForge: se sincronizan antes que los de Modrinth. Devuelve la lista de problemas.
async function runCf(dir, dry, log) {
  const hasWork = cf.readEntries(dir).length || Object.keys(cf.readLock(dir).mods || {}).length;
  if (!hasWork) return [];
  const modrinthSlugs = new Set(Object.values(readJson(path.join(dir, 'mods.lock.json'), { mods: {} }).mods || {}).map((m) => String(m.slug).toLowerCase()));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const have = new Set([...modrinthSlugs].map(norm));
  const r = await cf.syncCurseforge(dir, { http: cfHttp(), dry, log, alreadyHave: (slug) => have.has(norm(slug)) });
  return r.problems;
}

function problemsOf(res, lines = []) {
  const out = [];
  for (const m of (res && res.missing) || []) {
    if (m.wanted !== false) out.push(`${m.slug}: ${m.reason || 'no se pudo añadir'}`);
  }
  for (const m of (res && res.unresolvedDeps) || []) {
    out.push(`Falta la dependencia ${m.modId} (la pide ${(m.requiredBy || []).join(', ')})${m.hints && m.hints.length ? ' → quizá: ' + m.hints.join(' | ') : ''}`);
  }
  // respaldo: si tu pack-sync no devuelve los datos, los avisos "  ! algo" del registro cuentan igual
  if (!out.length) for (const l of lines) if (/^\s+! /.test(l)) out.push(l.replace(/^\s+! /, ''));
  return out;
}

handle('pack:preview', async () => {
  if (busy) throw new Error('Ya hay una operación en curso');
  busy = true;
  try {
    const lines = [];
    const dir = currentPackDir();
    const log = (l) => { lines.push(String(l)); send('log', l); };
    const cfProblems = await runCf(dir, true, log);
    lines.length = 0;   // desde aquí solo cuentan los avisos de Modrinth
    const res = (await syncPack(dir, { dry: true, log })) || {};
    return { problems: [...cfProblems, ...problemsOf(res, lines)], pack: await loadPack() };
  } finally { busy = false; }
});

handle('pack:publish', async (note, { push = true } = {}) => {
  if (busy) throw new Error('Ya hay una operación en curso');
  busy = true;
  try {
    const dir = currentPackDir();
    const lines = [];
    const log = (l) => { lines.push(String(l)); send('log', l); };
    log('▶ Descargando mods y comprobando dependencias…');
    const cfProblems = await runCf(dir, false, log);
    if (cfProblems.length) {
      log('\n✖ No se sube nada: corrige esto primero.');
      return { blocked: true, problems: cfProblems, pack: await loadPack() };
    }
    const res = (await syncPack(dir, { note: note || undefined, log })) || {};
    const problems = problemsOf(res, lines);
    if (problems.length) {
      log('\n✖ No se sube nada: corrige esto primero.');
      return { blocked: true, problems, pack: await loadPack() };
    }
    let pushed = false;
    if (push) {
      const name = (readJson(path.join(dir, 'pack.json'), {}).name) || path.basename(dir);
      const msg = `${name}: ${note || 'actualización de mods'}${res.manifestInfo ? ` (v${res.manifestInfo.version})` : ''}`;
      log('\n▶ Subiendo a GitHub…');
      ({ pushed } = await gitlib.commitAndPush(dir, msg, log));
    }
    snapshots.set(dir, { txt: fs.readFileSync(path.join(dir, 'mods.txt'), 'utf8'), cf: JSON.stringify(cf.readEntries(dir)) });
    log(pushed ? '\n✔ Publicado. Tus amigos recibirán el aviso de actualización en unos minutos.' : '\n✔ Listo (sin subir a GitHub).');
    return { blocked: false, pushed, version: res.manifestInfo && res.manifestInfo.version, summary: res.summary, pack: await loadPack() };
  } finally { busy = false; }
});

// ───────── ventana ─────────
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b0a14', title: 'Atenas Admin', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
