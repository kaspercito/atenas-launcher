'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadManifest, computeDiff, applyDiff, STATE_FILE } = require('./src/lib/sync');
const { pingServer } = require('./src/lib/ping');
const { javaMajorFor, ensureJava } = require('./src/lib/java');
const { ensureLoader } = require('./src/lib/loaders');
const { launchGame } = require('./src/lib/launch');
const { Account } = require('./src/lib/auth');
const { fetchJson } = require('./src/lib/net');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'launcher.config.json'), 'utf8'));

let win = null;
let busy = false; // actualizando o jugando
let lastNotifiedVersion = null;

// ───────────────────────── almacenamiento ─────────────────────────
const dataDir = () => app.getPath('userData');
const instancesDir = () => path.join(dataDir(), 'instances');
const runtimeDir = () => path.join(dataDir(), 'runtime');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const authFile = () => path.join(dataDir(), 'auth.json');
const packsCacheFile = () => path.join(dataDir(), 'packs-cache.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const getSettings = () => ({
  ramMb: 4096, selectedPack: null, jvmOptimized: true, minimizeOnPlay: true, fx: true, notify: true, theme: 'violet',
  seenNews: {}, playtime: {}, lastPlayed: {},
  ...readJson(settingsFile(), {}),
});
const setSettings = (patch) => { const s = { ...getSettings(), ...patch }; writeJson(settingsFile(), s); return s; };

// El token de sesión se guarda cifrado con el almacén seguro del sistema (DPAPI en Windows)
const authStore = {
  load() {
    const raw = readJson(authFile(), null);
    if (!raw) return null;
    try {
      if (raw.kind === 'offline') return { kind: 'offline', name: raw.name, uuid: raw.uuid };
      const token = raw.enc && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(raw.enc, 'base64'))
        : raw.plain;
      return { kind: 'microsoft', refreshToken: token, name: raw.name, uuid: raw.uuid };
    } catch { return null; }
  },
  save({ kind, refreshToken, name, uuid }) {
    const out = { kind, name, uuid };
    if (refreshToken) {
      if (safeStorage.isEncryptionAvailable()) out.enc = safeStorage.encryptString(refreshToken).toString('base64');
      else out.plain = refreshToken;
    }
    writeJson(authFile(), out);
  },
  clear() { try { fs.unlinkSync(authFile()); } catch {} },
};
const account = new Account(authStore);

// ───────────────────────── packs ─────────────────────────
function safePackId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(id) || id === '.' || id === '..') {
    throw new Error('Id de pack inválido');
  }
  return id;
}
const instanceDir = (id) => path.join(instancesDir(), safePackId(id));
const cachedManifestFile = (id) => path.join(instanceDir(id), '.atenas-manifest.json');

async function getPacks() {
  if (Array.isArray(config.packs) && config.packs.length) return { packs: config.packs, offline: false };
  try {
    const idx = await fetchJson(config.packsIndexUrl);
    const packs = (idx.packs || []).filter((p) => p && p.id && p.manifestUrl);
    writeJson(packsCacheFile(), { packs });
    return { packs, offline: false };
  } catch (err) {
    const cache = readJson(packsCacheFile(), null);
    if (cache) return { packs: cache.packs, offline: true };
    throw new Error('No se pudo cargar la lista de modpacks. Revisa tu conexión.');
  }
}

async function findPack(id) {
  const { packs } = await getPacks();
  const pack = packs.find((p) => p.id === id);
  if (!pack) throw new Error('Pack no encontrado: ' + id);
  safePackId(pack.id);
  return pack;
}

const names = (list) => list.map((f) => (f.path.startsWith('mods/') ? path.posix.basename(f.path) : f.path));

const prettyMod = (p) => path.posix.basename(p).replace(/\.jar$/i, '').replace(/[_]+/g, ' ');

function summarize(pack, manifest, diff, offline) {
  const mods = (manifest.files || [])
    .filter((f) => /^mods\/[^/]+\.jar$/i.test(String(f.path).replace(/\\/g, '/')))
    .map((f) => ({ name: prettyMod(f.path), size: f.size || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let status = 'ready';
  if (!diff.installed) status = 'not-installed';
  else if (diff.hasChanges) status = 'update';
  return {
    packId: pack.id,
    name: manifest.name || pack.name || pack.id,
    description: pack.description || '',
    status,
    offline,
    localVersion: diff.localVersion,
    remoteVersion: manifest.packVersion,
    changelog: manifest.changelog || '',
    minecraft: manifest.minecraft,
    loader: manifest.loader ? `${manifest.loader.type} ${manifest.loader.version || ''}`.trim() : 'vanilla',
    server: manifest.server || null,
    add: names(diff.add),
    change: names(diff.change),
    remove: names(diff.remove),
    bytes: diff.bytes,
    mods,
    modCount: mods.length,
  };
}

async function checkPack(packId) {
  const pack = await findPack(packId);
  const dir = instanceDir(pack.id);
  let manifest;
  let offline = false;
  try {
    manifest = await loadManifest(pack.manifestUrl);
  } catch (err) {
    manifest = readJson(cachedManifestFile(pack.id), null);
    if (!manifest) {
      const m = /^HTTP (\d+)/.exec(err.message || '');
      if (m && m[1] === '404') {
        const e = new Error('Este modpack todavía no está publicado: falta el archivo manifest.json en GitHub. Si eres el administrador, ejecuta "npm run pack" y luego "git push". Si no, avísale.');
        e.code = 'NO_MANIFEST';
        throw e;
      }
      if (m) throw new Error(`GitHub respondió con error ${m[1]} al leer el modpack. Inténtalo en unos minutos.`);
      const e = new Error('No se pudo conectar con GitHub. Revisa tu internet y pulsa Reintentar.');
      e.code = 'NO_CONNECTION';
      throw e;
    }
    offline = true;
  }
  const diff = offline
    ? { add: [], change: [], remove: [], bytes: 0, hasChanges: false, installed: true, localVersion: manifest.packVersion }
    : await computeDiff(manifest, dir);

  // Cambió solo la versión/changelog pero no los archivos: registrar en silencio
  if (!offline && diff.installed && !diff.hasChanges && diff.localVersion !== manifest.packVersion) {
    await applyDiff(manifest, dir, diff);
    writeJson(cachedManifestFile(pack.id), manifest);
    diff.localVersion = manifest.packVersion;
  }
  return { summary: summarize(pack, manifest, diff, offline), manifest, diff, pack };
}

async function runUpdate(pack, manifest, diff) {
  const dir = instanceDir(pack.id);
  await applyDiff(manifest, dir, diff, {
    onProgress: (p) => send('pack:progress', { packId: pack.id, ...p }),
  });
  writeJson(cachedManifestFile(pack.id), manifest);
}

// ───────────────────────── IPC ─────────────────────────
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const gameLog = (line) => send('game:log', line);

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.code || err.message || String(err), message: err.message }; }
  });
}

handle('app:init', async () => ({
  launcherName: config.launcherName,
  links: Object.fromEntries(Object.entries(config.links || {}).filter(([, v]) => /^https:\/\//.test(v || ''))),
  version: app.getVersion(),
  account: account.info,
  settings: getSettings(),
  totalRamMb: Math.round(require('os').totalmem() / 1048576),
}));

ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:maximize', () => { if (win) (win.isMaximized() ? win.unmaximize() : win.maximize()); });
ipcMain.on('win:close', () => { if (win) win.close(); });

handle('packs:list', async () => getPacks());

handle('pack:check', async (packId) => {
  const { summary } = await checkPack(packId);
  return summary;
});

handle('pack:update', async (packId) => {
  if (busy) throw new Error('Ya hay una operación en curso');
  busy = true;
  try {
    const { manifest, diff, pack } = await checkPack(packId);
    if (diff.hasChanges || !diff.installed) await runUpdate(pack, manifest, diff);
    const { summary } = await checkPack(packId);
    return summary;
  } finally {
    busy = false;
  }
});

handle('pack:play', async (packId) => {
  if (busy) throw new Error('Ya hay una operación en curso');
  const mclcAuth = await account.getMclc(); // lanza NEED_LOGIN si no hay sesión
  busy = true;
  play(packId, mclcAuth).catch((err) => {
    send('game:state', { state: 'error', message: err.message || String(err) });
  }).finally(() => { busy = false; });
  return true;
});

async function play(packId, mclcAuth) {
  send('game:state', { state: 'preparing', message: 'Comprobando mods…' });
  const { manifest, diff, pack, summary } = await checkPack(packId);
  if (!summary.offline && (diff.hasChanges || !diff.installed)) {
    send('game:state', { state: 'updating', message: 'Actualizando mods…' });
    await runUpdate(pack, manifest, diff);
  }
  const dir = instanceDir(pack.id);

  send('game:state', { state: 'preparing', message: 'Preparando Java…' });
  const major = manifest.java || javaMajorFor(manifest.minecraft);
  const javaPath = await ensureJava(major, runtimeDir(), gameLog, (bytes) => {
    send('game:state', { state: 'preparing', message: `Descargando Java ${major}… ${(bytes / 1048576).toFixed(0)} MB` });
  });

  send('game:state', { state: 'preparing', message: 'Preparando ' + (manifest.loader?.type || 'Minecraft') + '…' });
  const customId = await ensureLoader(manifest, dir, javaPath, gameLog);

  send('game:state', { state: 'preparing', message: 'Descargando archivos de Minecraft…' });
  let startedAt = 0;
  const code = await launchGame({
    manifest,
    instanceDir: dir,
    mclcAuth,
    javaPath,
    customId,
    ramMb: getSettings().ramMb,
    optimizedJvm: getSettings().jvmOptimized,
    hooks: {
      onLog: gameLog,
      onStarted: () => {
        startedAt = Date.now();
        send('game:state', { state: 'running', message: 'Minecraft en ejecución' });
        if (getSettings().minimizeOnPlay && win && !win.isDestroyed()) win.minimize();
      },
      onProgress: (p) => send('game:state', { state: 'preparing', message: `Descargando ${p.type || 'archivos'}… ${p.task}/${p.total}` }),
    },
  });
  if (startedAt) {
    const cur = getSettings();
    setSettings({
      playtime: { ...cur.playtime, [pack.id]: (cur.playtime[pack.id] || 0) + Math.round((Date.now() - startedAt) / 1000) },
      lastPlayed: { ...cur.lastPlayed, [pack.id]: Date.now() },
    });
  }
  if (win && !win.isDestroyed() && win.isMinimized()) win.restore();
  send('game:state', { state: 'closed', playtime: getSettings().playtime, code, message: code === 0 ? 'Juego cerrado' : `Minecraft se cerró con código ${code}` });
}

handle('server:status', async (address) => {
  if (typeof address !== 'string' || address.length > 260) throw new Error('Dirección no válida');
  return pingServer(address);
});

handle('pack:repair', async (packId) => {
  if (busy) throw new Error('Ya hay una operación en curso');
  busy = true;
  try {
    const pack = await findPack(packId);
    try { fs.unlinkSync(path.join(instanceDir(pack.id), STATE_FILE)); } catch {}
    const { manifest, diff } = await checkPack(packId);
    await runUpdate(pack, manifest, diff);
    return (await checkPack(packId)).summary;
  } finally {
    busy = false;
  }
});

handle('app:openLink', async (key) => {
  const url = (config.links || {})[key];
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Enlace no disponible');
  await shell.openExternal(url);
  return true;
});

handle('auth:login', async () => account.login());
handle('auth:offline', async (name) => account.loginOffline(name));
handle('auth:logout', async () => { account.logout(); return true; });
handle('settings:set', async (patch) => {
  const allowed = {};
  if (Number.isFinite(patch.ramMb)) allowed.ramMb = Math.max(1024, Math.round(patch.ramMb));
  if (typeof patch.selectedPack === 'string' || patch.selectedPack === null) allowed.selectedPack = patch.selectedPack;
  for (const k of ['jvmOptimized', 'minimizeOnPlay', 'fx', 'notify']) if (typeof patch[k] === 'boolean') allowed[k] = patch[k];
  if (['violet', 'ocean', 'emerald', 'ember'].includes(patch.theme)) allowed.theme = patch.theme;
  if (patch.seenNews && typeof patch.seenNews === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(patch.seenNews).slice(-200)) if (v === true && k.length < 100) clean[k] = true;
    allowed.seenNews = clean;
  }
  return setSettings(allowed);
});
handle('app:openFolder', async (packId, sub) => {
  const allowedSub = { screenshots: 'screenshots', mods: 'mods' };
  const dir = sub && allowedSub[sub] ? path.join(instanceDir(packId), allowedSub[sub]) : instanceDir(packId);
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});

// ───────────────────────── vigilante de actualizaciones ─────────────────────────
function startWatcher() {
  const every = Math.max(1, Number(config.checkIntervalMinutes) || 5) * 60 * 1000;
  setInterval(async () => {
    if (busy) return;
    const id = getSettings().selectedPack;
    if (!id) return;
    try {
      const { summary } = await checkPack(id);
      if (summary.status === 'update' && lastNotifiedVersion !== summary.remoteVersion) {
        lastNotifiedVersion = summary.remoteVersion;
        send('pack:update-available', summary);
        if (getSettings().notify && win && !win.isFocused() && Notification.isSupported()) {
          new Notification({
            title: 'Atenas Launcher',
            body: `Hay una actualización de mods en ${summary.name} (v${summary.remoteVersion})`,
          }).show();
        }
      }
    } catch { /* sin conexión: se reintenta luego */ }
  }, every);
}

// ───────────────────────── ventana ─────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 920,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#090812',
    title: config.launcherName,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win && win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Los enlaces externos se abren en el navegador, nunca dentro del launcher
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    startWatcher();
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      } catch {}
    }
  });
  app.on('window-all-closed', () => app.quit());
}
