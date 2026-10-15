'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, Notification, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadManifest, computeDiff, applyDiff, STATE_FILE } = require('./src/lib/sync');
const { pingServer } = require('./src/lib/ping');
const { javaMajorFor, ensureJava } = require('./src/lib/java');
const { ensureLoader } = require('./src/lib/loaders');
const { launchGame } = require('./src/lib/launch');
const { Account } = require('./src/lib/auth');
const { fetchJson } = require('./src/lib/net');
const { createUpdater } = require('./src/lib/updater');
const { DiscordRpc } = require('./src/lib/discord');
const { cleanName, getPresence, putPresence } = require('./src/lib/friends');

// Los datos (modpacks, mundos, ajustes) siguen en la carpeta original aunque cambie el nombre visible del programa
app.setPath('userData', path.join(app.getPath('appData'), 'Atenas Launcher'));

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'launcher.config.json'), 'utf8'));

let win = null;
let busy = false; // actualizando o jugando
let lastNotifiedVersion = null;
let updater = null;
let tray = null;
let quitting = false;
let rpc = null;
let playing = null; // { pack, startedAt } mientras Minecraft está abierto
const serverByPack = {};

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
  ramMb: 4096, selectedPack: null, jvmOptimized: true, minimizeOnPlay: true, fx: true, notify: true, theme: 'cyber',
  fullscreen: false, extraJvm: '', autoStart: false, hud: true, closeToTray: true, discordRpc: true, sharePresence: true, friends: [],
  seenNews: {}, playtime: {}, lastPlayed: {},
  ...readJson(settingsFile(), {}),
});
// Argumentos JVM extra del jugador: solo banderas simples, sin agentes ni tocar la RAM (eso va aparte).
const BLOCKED_JVM = /^-(javaagent|agentlib|agentpath|Xmx|Xms|Xbootclasspath)/i;
const cleanJvm = (s) => String(s || '').slice(0, 400).split(/\s+/).filter((t) => /^-(D[\w.\-]+(=[\w.:+\-\/]*)?|X[\w:=.+\-]+|XX:[+\-]?[\w.]+(=[\w.+\-\/]+)?)$/.test(t) && !BLOCKED_JVM.test(t)).slice(0, 20);
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
  const summary = summarize(pack, manifest, diff, offline);
  if (summary.server) serverByPack[pack.id] = summary.server;
  return { summary, manifest, diff, pack };
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
    extraJvm: cleanJvm(getSettings().extraJvm),
    fullscreen: getSettings().fullscreen === true,
    hooks: {
      onLog: gameLog,
      onStarted: () => {
        startedAt = Date.now();
        playing = { pack: manifest.name || pack.name || pack.id, startedAt };
        setActivity();
        send('game:state', { state: 'running', message: 'Minecraft en ejecución' });
        if (getSettings().minimizeOnPlay && win && !win.isDestroyed()) win.minimize();
      },
      onProgress: (p) => send('game:state', { state: 'preparing', message: `Descargando ${p.type || 'archivos'}… ${p.task}/${p.total}` }),
    },
  });
  playing = null; setActivity();
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
  for (const k of ['jvmOptimized', 'minimizeOnPlay', 'fx', 'notify', 'fullscreen', 'autoStart', 'hud', 'closeToTray', 'discordRpc', 'sharePresence']) if (typeof patch[k] === 'boolean') allowed[k] = patch[k];
  if (typeof patch.extraJvm === 'string') allowed.extraJvm = cleanJvm(patch.extraJvm).join(' ');
  if (['cyber', 'nova', 'violet', 'ocean', 'emerald', 'ember'].includes(patch.theme)) allowed.theme = patch.theme;
  if ('autoStart' in allowed && app.isPackaged) app.setLoginItemSettings({ openAtLogin: allowed.autoStart });
  if (patch.seenNews && typeof patch.seenNews === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(patch.seenNews).slice(-200)) if (v === true && k.length < 100) clean[k] = true;
    allowed.seenNews = clean;
  }
  const out = setSettings(allowed);
  if ('discordRpc' in allowed) { if (allowed.discordRpc) { rpc && rpc.start(); setActivity(); } else rpc && rpc.stop(); }
  return out;
});

// ───────────────────────── Discord, amigos y actualizaciones del launcher ─────────────────────────
function setActivity() {
  if (!rpc || getSettings().discordRpc === false) return;
  if (playing) rpc.set({ details: `Jugando ${playing.pack}`, state: 'En Atenas Client', startedAt: playing.startedAt });
  else rpc.set({ details: 'En el launcher', state: 'Preparando la aventura', startedAt: launcherStartedAt });
}
const launcherStartedAt = Date.now();

handle('app:updateStatus', async () => (updater ? updater.status() : { state: 'idle', packaged: false }));
handle('app:updateCheck', async () => updater.check());
handle('app:updateInstall', async () => { updater.install(); return true; });

handle('friends:list', async () => {
  const s = getSettings();
  const names = Array.isArray(s.friends) ? s.friends : [];
  const server = serverByPack[s.selectedPack];
  const [ping, pres] = await Promise.all([
    server ? pingServer(server).catch(() => null) : null,
    getPresence(config.presenceUrl, names),
  ]);
  const inServer = new Set(((ping && ping.players && ping.players.names) || []).map((n) => n.toLowerCase()));
  const list = names.map((name) => {
    const p = pres[name.toLowerCase()];
    const fresh = p && Date.now() - p.ts < 150000;
    if (inServer.has(name.toLowerCase())) return { name, status: 'server', where: 'En el servidor' };
    if (fresh && p.playing) return { name, status: 'playing', where: 'Jugando ' + (p.pack || 'Minecraft') };
    if (fresh) return { name, status: 'online', where: 'En el launcher' };
    return { name, status: 'offline', where: 'Desconectado' };
  });
  return { friends: list, presence: !!config.presenceUrl, serverKnown: !!server };
});
handle('friends:add', async (name) => {
  const n = cleanName(name);
  const cur = getSettings().friends || [];
  if (cur.some((f) => f.toLowerCase() === n.toLowerCase())) throw new Error('Ya tienes a ' + n + ' en tu lista.');
  if (cur.length >= 50) throw new Error('Máximo 50 amigos.');
  setSettings({ friends: [...cur, n] });
  return n;
});
handle('friends:remove', async (name) => {
  setSettings({ friends: (getSettings().friends || []).filter((f) => f.toLowerCase() !== String(name).toLowerCase()) });
  return true;
});

function startPresenceHeartbeat() {
  if (!config.presenceUrl) return;
  const beat = () => {
    const name = (account.info || {}).name;
    if (!name || getSettings().sharePresence === false) return;
    putPresence(config.presenceUrl, { name, pack: playing ? playing.pack : '', playing: !!playing });
  };
  setTimeout(beat, 5000);
  setInterval(beat, 60000).unref?.();
}
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
            title: 'Atenas Client',
            body: `Hay una actualización de mods en ${summary.name} (v${summary.remoteVersion})`,
          }).show();
        }
      }
    } catch { /* sin conexión: se reintenta luego */ }
  }, every);
}

// ───────────────────────── ventana ─────────────────────────
// Pantalla de arranque: se muestra mientras carga la ventana principal (mínimo ~1,4 s para que no parpadee).
let splash = null;
function showSplash() {
  try {
    splash = new BrowserWindow({
      width: 440, height: 310, frame: false, transparent: true, resizable: false, show: false,
      alwaysOnTop: true, skipTaskbar: true, center: true, focusable: false,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
    splash.once('ready-to-show', () => splash && !splash.isDestroyed() && splash.show());
    splash.on('closed', () => { splash = null; });
  } catch { splash = null; }
}
function closeSplash() { if (splash && !splash.isDestroyed()) splash.close(); splash = null; }

function createWindow() {
  const startedAt = Date.now();
  showSplash();
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 920,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#050913',
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
  win.once('ready-to-show', () => {
    setTimeout(() => { closeSplash(); if (win && !win.isDestroyed()) win.show(); }, Math.max(0, 1400 - (Date.now() - startedAt)));
  });
  setTimeout(closeSplash, 20000); // por si la ventana principal tarda o falla: la pantalla de arranque nunca se queda colgada
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Los enlaces externos se abren en el navegador, nunca dentro del launcher
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // La X manda el launcher a segundo plano (bandeja) en vez de cerrarlo; se sale desde la bandeja
  win.on('close', (e) => {
    if (quitting || getSettings().closeToTray === false) return;
    e.preventDefault();
    win.hide();
    if (!getSettings().trayHint && Notification.isSupported()) {
      setSettings({ trayHint: true });
      new Notification({ title: 'Atenas Client', body: 'Sigue abierto en segundo plano. Ciérralo del todo desde el icono de la bandeja.' }).show();
    }
  });
  win.on('closed', () => { win = null; closeSplash(); });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 });
    tray = new Tray(img);
    tray.setToolTip(config.launcherName);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir ' + config.launcherName, click: showWindow },
      { type: 'separator' },
      { label: 'Salir del todo', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch { tray = null; }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; }); // también permite que la actualización automática cierre y reinstale
  app.setAppUserModelId('com.atenas.launcher'); // agrupa la barra de tareas y habilita las notificaciones de Windows
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    startWatcher();
    updater = createUpdater({ app, send, logDir: dataDir() });
    updater.init();
    if (config.discordClientId) { rpc = new DiscordRpc(config.discordClientId); if (getSettings().discordRpc !== false) { rpc.start(); setActivity(); } }
    startPresenceHeartbeat();
  });
  app.on('window-all-closed', () => app.quit());
}
