'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Notification, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadManifest, computeDiff, applyDiff, STATE_FILE } = require('./src/lib/sync');
const { pingServer } = require('./src/lib/ping');
const { javaMajorFor, ensureJava } = require('./src/lib/java');
const { ensureLoader } = require('./src/lib/loaders');
const { launchGame } = require('./src/lib/launch');
const { Account, offlineUuid } = require('./src/lib/auth');
const accountReq = require('./src/lib/accountreq');
const accountsLib = require('./src/lib/accounts');
const { fetchJson, fetchText, downloadFile } = require('./src/lib/net');
const paths = require('./src/lib/paths');
const clientLib = require('./src/lib/client');
const optifine = require('./src/lib/optifine');
const { disableForgeSplash } = require('./src/lib/forgesplash');
const { createUpdater } = require('./src/lib/updater');
const { createUpdateWindow } = require('./src/lib/updatewin');
const { createLoadingWindow } = require('./src/lib/loadingwin');
const { DiscordRpc } = require('./src/lib/discord');
const { packKind, KIND_LABEL, gameProps } = require('./src/lib/packkind');
const { createSocial, mergeServer, diffSnapshots } = require('./src/lib/social');
const { createToaster } = require('./src/lib/toastwin');

// Todo vive en %USERPROFILE%\.atenasclient (ver src/lib/paths.js). Lo que había en %APPDATA%\Atenas Launcher se mueve solo la primera vez.
const P = paths.ensure(paths.layout());
const OLD_DATA_DIR = path.join(app.getPath('appData'), 'Atenas Launcher');
app.setPath('userData', P.root);
app.setPath('sessionData', P.electron);
app.setPath('logs', P.logs);
const migrated = paths.migrate(OLD_DATA_DIR, P, (m) => { try { fs.appendFileSync(path.join(P.logs, 'migracion.log'), `[${new Date().toISOString()}] ${m}\n`); } catch {} });

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'launcher.config.json'), 'utf8'));

let win = null;
let busy = false; // actualizando o jugando
let lastNotifiedVersion = null;
let updater = null;
let loadWin = null; // ventana de carga de Atenas (tapa la de Forge mientras cargan los mods)
let tray = null;
let quitting = false;
let rpc = null;
let leaving = false;
let playing = null; // { pack, startedAt } mientras Minecraft está abierto
const serverByPack = {};

// ───────────────────────── almacenamiento ─────────────────────────
const dataDir = () => P.root;
const instancesDir = () => P.instances;
const runtimeDir = () => P.runtime;
const settingsFile = () => P.settings;
const authFile = () => P.auth;
const packsCacheFile = () => P.packsCache;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const getSettings = () => ({
  ramMb: 4096, selectedPack: null, jvmOptimized: true, minimizeOnPlay: true, optifine: true, fx: true, notify: true, theme: 'atenas', themeV: 2,
  fullscreen: false, extraJvm: '', autoStart: false, hud: true, closeToTray: true, discordRpc: true, discordShowNick: true, sharePresence: true, friends: [], friendsMigrated: false, notifyChat: true,
  seenNews: {}, playtime: {}, lastPlayed: {},
  ...(() => { const saved = readJson(settingsFile(), {}); return saved.themeV === 2 ? saved : { ...saved, theme: 'atenas', themeV: 2 }; })(), // una vez: todos pasan al tema nuevo del logo
});
// Argumentos JVM extra del jugador: solo banderas simples, sin agentes ni tocar la RAM (eso va aparte).
const BLOCKED_JVM = /^-(javaagent|agentlib|agentpath|Xmx|Xms|Xbootclasspath)/i;
const cleanJvm = (s) => String(s || '').slice(0, 400).split(/\s+/).filter((t) => /^-(D[\w.\-]+(=[\w.:+\-\/]*)?|X[\w:=.+\-]+|XX:[+\-]?[\w.]+(=[\w.+\-\/]+)?)$/.test(t) && !BLOCKED_JVM.test(t)).slice(0, 20);
const setSettings = (patch) => { const s = { ...getSettings(), ...patch }; writeJson(settingsFile(), s); return s; };

// El token de sesión se guarda cifrado con el almacén seguro del sistema (DPAPI en Windows)
function sealEntry({ kind, refreshToken, name, uuid }) {
  const out = { kind, name, uuid };
  if (refreshToken) {
    if (safeStorage.isEncryptionAvailable()) out.enc = safeStorage.encryptString(refreshToken).toString('base64');
    else out.plain = refreshToken;
  }
  return out;
}
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
  save(entry) {
    const out = sealEntry(entry);
    writeJson(authFile(), out);
    rememberAccount(out);
  },
  clear() { try { fs.unlinkSync(authFile()); } catch {} },
};
const account = new Account(authStore);

// ───────────────────────── varias cuentas ─────────────────────────
// La cuenta activa vive en auth.json (como siempre); además se guarda una lista en accounts.json para cambiar de cuenta sin volver a iniciar sesión.
const accountsFile = () => path.join(path.dirname(authFile()), 'accounts.json');
const readAccounts = () => accountsLib.clean(readJson(accountsFile(), []));
function rememberAccount(raw) { try { writeJson(accountsFile(), accountsLib.upsert(readAccounts(), raw)); } catch {} }
const activeId = () => { const a = account.info; return a ? accountsLib.idOf(a) : null; };
rememberAccount(readJson(authFile(), null)); // cuenta que ya estaba iniciada antes de esta versión
/** Deja `entry` como cuenta activa (copia sus datos a auth.json) y la sube al principio de la lista. */
function activateAccount(entry) {
  writeJson(authFile(), { ...entry });
  account.mc = null;
  rememberAccount(entry);
}

// ───────────────────────── packs ─────────────────────────
function safePackId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(id) || id === '.' || id === '..') {
    throw new Error('Id de pack inválido');
  }
  return id;
}
const instanceDir = (id) => path.join(instancesDir(), safePackId(id));
const cachedManifestFile = (id) => path.join(instanceDir(id), '.atenas-manifest.json');

// Perfil integrado: Atenas Client 1.8.9 (el mod de Forge). No depende del repo de packs: su "manifest" se arma con la última Release del cliente.
function builtinPacks() {
  const c = config.clientPack;
  if (!c || c.enabled === false || !c.id) return [];
  return [{
    id: c.id, name: c.name || 'Atenas Client 1.8.9', description: c.description || '', builtin: true,
    minecraft: c.minecraft || '1.8.9', forge: c.forge || '11.15.1.2318', server: c.server || '', repo: c.repo,
  }];
}
const withBuiltin = (packs) => [...packs, ...builtinPacks().filter((b) => !packs.some((p) => p.id === b.id))];
const clientReleaseCache = () => P.clientRelease;
const clientLocalDir = () => P.clientLocal;
const getClientRelease = (pack) => clientLib.getLatest({ repo: pack.repo, cacheFile: clientReleaseCache(), localDir: clientLocalDir() });

async function getPacks() {
  if (Array.isArray(config.packs) && config.packs.length) return { packs: withBuiltin(config.packs), offline: false };
  try {
    const idx = await fetchJson(config.packsIndexUrl);
    const packs = (idx.packs || []).filter((p) => p && p.id && p.manifestUrl);
    writeJson(packsCacheFile(), { packs });
    return { packs: withBuiltin(packs), offline: false };
  } catch (err) {
    const cache = readJson(packsCacheFile(), null);
    if (cache) return { packs: withBuiltin(cache.packs), offline: true };
    const own = builtinPacks();
    if (own.length) return { packs: own, offline: true };
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
    image: pack.image || manifest.image || '',
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

// Perfil integrado: no hay manifest en GitHub; lo único "sincronizable" es el jar del cliente.
async function checkClientPack(pack) {
  const dir = instanceDir(pack.id);
  const release = await getClientRelease(pack);
  const manifest = clientLib.buildManifest(pack, release);
  const meta = clientLib.readMeta(dir);
  const what = release.offline && meta ? null : clientLib.needs(release, meta); // sin internet y ya instalado: se juega con lo que hay
  const file = { path: `mods/${release.name}`, size: release.size };
  const diff = {
    add: what === 'install' ? [file] : [],
    change: what === 'update' ? [file] : [],
    remove: [],
    bytes: what ? release.size : 0,
    hasChanges: what === 'update',
    installed: !!meta,
    localVersion: meta ? meta.version : null,
  };
  if (release.offline && meta) manifest.packVersion = meta.version;
  const summary = summarize(pack, manifest, diff, !!release.offline && !!meta);
  if (summary.server) serverByPack[pack.id] = summary.server;
  return { summary, manifest, diff, pack, release };
}

async function checkPack(packId) {
  const pack = await findPack(packId);
  if (pack.builtin) return checkClientPack(pack);
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

async function runUpdate(pack, manifest, diff, release) {
  const dir = instanceDir(pack.id);
  if (pack.builtin) {
    let doneBytes = 0;
    const totalBytes = release.size || 0;
    const emit = (filesDone) => send('pack:progress', { packId: pack.id, doneBytes: Math.max(0, doneBytes), totalBytes, filesDone, filesTotal: 1, file: release.name });
    emit(0);
    await clientLib.installClient(release, dir, { onBytes: (n) => { doneBytes += n; emit(0); } });
    emit(1);
    writeJson(cachedManifestFile(pack.id), manifest);
    return;
  }
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
    const { manifest, diff, pack, release } = await checkPack(packId);
    if (diff.hasChanges || !diff.installed) await runUpdate(pack, manifest, diff, release);
    const { summary } = await checkPack(packId);
    return summary;
  } finally {
    busy = false;
  }
});

handle('pack:play', async (packId) => {
  if (busy) throw new Error('Ya hay una operación en curso');
  busy = true; // se marca antes de esperar el login para que dos clics seguidos no lancen el juego dos veces
  let mclcAuth;
  try { mclcAuth = await account.getMclc(); } // lanza NEED_LOGIN si no hay sesión
  catch (e) { busy = false; throw e; }
  runSession(packId, mclcAuth).catch((err) => {
    send('game:state', { state: 'error', message: err.message || String(err) });
  }).finally(() => { busy = false; });
  return true;
});

// ── Cambio de cuenta desde el juego ──
// El menú del cliente puede pedir "entrar con la cuenta X" escribiendo config/switch-request.json y cerrando el juego.
// Las cuentas sin conexión se cambian dentro del juego sin reiniciar; las de Microsoft necesitan su token, que solo
// el launcher puede descifrar, así que aquí se activa esa cuenta y se vuelve a abrir el mismo modpack.
const switchRequestFile = () => path.join(path.dirname(authFile()), 'switch-request.json');
function takeSwitchRequest(since) {
  const f = switchRequestFile();
  const req = readJson(f, null);
  if (!req) return null;
  try { fs.unlinkSync(f); } catch {}
  const at = Number(req.at) || 0;
  if (!at || at < since - 2000 || Date.now() - at > 10 * 60 * 1000) return null; // vieja: de otra sesión
  const entry = readAccounts().find((a) => accountsLib.idOf(a) === String(req.id));
  if (!entry) return null;
  if (activeId() !== accountsLib.idOf(entry)) { activateAccount(entry); afterAccountChange(); }
  return entry;
}

async function runSession(packId, mclcAuth) {
  for (let i = 0; i < 4; i++) { // tope: nunca un bucle infinito de reinicios
    const since = Date.now();
    try { fs.unlinkSync(switchRequestFile()); } catch {} // una petición que quedó de antes no cuenta
    await play(packId, mclcAuth);
    const next = takeSwitchRequest(since);
    if (!next) return;
    send('game:state', { state: 'preparing', message: `Entrando como ${next.name}…` });
    try { mclcAuth = await account.getMclc(); }
    catch { send('game:state', { state: 'error', message: `No se pudo entrar como ${next.name}: vuelve a iniciar sesión con esa cuenta en el launcher.` }); return; }
  }
}

async function play(packId, mclcAuth) {
  send('game:state', { state: 'preparing', message: 'Comprobando mods…' });
  const { manifest, diff, pack, summary, release } = await checkPack(packId);
  if (!summary.offline && (diff.hasChanges || !diff.installed)) {
    send('game:state', { state: 'updating', message: pack.builtin ? 'Descargando Atenas Client…' : 'Actualizando mods…' });
    await runUpdate(pack, manifest, diff, release);
  }
  const dir = instanceDir(pack.id);
  if (pack.builtin) {
    try { // OptiFine: si está activado y falta, se baja solo de optifine.net; si lo apagó, se quita
      await ensureOptifine((m) => send('game:state', { state: 'preparing', message: m }));
      const auto = optifine.autoImport({ enabled: getSettings().optifine !== false, storedDir: P.optifine, scanDirs: optifineScanDirs() });
      if (auto) gameLog(`OptiFine encontrado en tus descargas y guardado: ${auto}`);
      const put = optifine.syncToInstance({ enabled: getSettings().optifine !== false, storedDir: P.optifine, instanceDir: dir });
      if (put) gameLog(`OptiFine: ${put}`);
      else if (getSettings().optifine !== false) gameLog('OptiFine está activado pero falta el .jar (Ajustes > OptiFine): se abre sin OptiFine.');
    } catch (e) { gameLog(`OptiFine no se pudo preparar: ${e.message}`); }
  }

  send('game:state', { state: 'preparing', message: 'Preparando Java…' });
  const major = manifest.java || javaMajorFor(manifest.minecraft);
  const javaPath = await ensureJava(major, runtimeDir(), gameLog, (bytes) => {
    send('game:state', { state: 'preparing', message: `Descargando Java ${major}… ${(bytes / 1048576).toFixed(0)} MB` });
  });

  send('game:state', { state: 'preparing', message: 'Preparando ' + (manifest.loader?.type || 'Minecraft') + '…' });
  const customId = await ensureLoader(manifest, dir, javaPath, gameLog);

  try { if (disableForgeSplash(dir, manifest.minecraft)) gameLog('Pantalla de carga de Forge desactivada (solo se ve la de Atenas).'); } catch (e) { gameLog(`No se pudo desactivar la carga de Forge: ${e.message}`); }
  send('game:state', { state: 'preparing', message: 'Descargando archivos de Minecraft…' });
  if (loadWin) loadWin.show({ text: 'Preparando el juego', builtin: !!pack.builtin, pack: pack.name || manifest.name || pack.id });
  let startedAt = 0;
  let code;
  try {
  code = await launchGame({
    manifest,
    instanceDir: dir,
    mclcAuth,
    javaPath,
    customId,
    ramMb: getSettings().ramMb,
    optimizedJvm: getSettings().jvmOptimized,
    extraJvm: [...cleanJvm(getSettings().extraJvm), '-Datenas.home=' + P.root, ...gameProps(manifest)],
    fullscreen: getSettings().fullscreen === true,
    hooks: {
      onLog: (line) => { gameLog(line); if (loadWin) loadWin.feed(line); },
      onStarted: () => {
        startedAt = Date.now();
        playing = { pack: manifest.name || pack.name || pack.id, startedAt, kind: packKind({ ...pack, ...manifest }) };
        setActivity();
        send('game:state', { state: 'running', message: 'Minecraft en ejecución' });
        if (getSettings().minimizeOnPlay && win && !win.isDestroyed()) win.minimize();
      },
      onProgress: (p) => {
        send('game:state', { state: 'preparing', message: `Descargando ${p.type || 'archivos'}… ${p.task}/${p.total}` });
        if (loadWin && p.total) loadWin.stage(`Descargando ${p.type || 'archivos'}…`, Math.min(7, Math.round((p.task / p.total) * 7)));
      },
    },
  });
  } finally { if (loadWin) loadWin.close(); playing = null; setActivity(); if (win && !win.isDestroyed() && win.isMinimized()) win.restore(); }
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
    try { fs.unlinkSync(path.join(instanceDir(pack.id), clientLib.META)); } catch {} // fuerza a bajar el cliente otra vez
    const { manifest, diff, release } = await checkPack(packId);
    await runUpdate(pack, manifest, diff, release);
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

let msLoginBusy = false; // una sola ventana de Microsoft a la vez (desde el launcher o desde el juego)
handle('auth:login', async () => {
  if (msLoginBusy) throw new Error('Ya hay una ventana de inicio de sesión abierta');
  msLoginBusy = true;
  try { const r = await account.login(); lastSnap = null; lastSocialError = null; setActivity(); return r; } finally { msLoginBusy = false; }
});
handle('auth:offline', async (name) => { const r = account.loginOffline(name); lastSnap = null; lastSocialError = null; setActivity(); return r; });
const waitLeave = () => Promise.race([leavePresence(), new Promise((r) => setTimeout(r, 1500))]);
function afterAccountChange() { lastPoll = null; lastSnap = null; lastSocialError = null; send('social:update', socialPayload()); setActivity(); }
const accountsPayload = () => ({ active: account.info, list: accountsLib.view(readAccounts(), activeId()) });

// Cerrar sesión: quita la cuenta activa de la lista y, si quedan otras guardadas, entra con la más reciente.
handle('auth:logout', async () => {
  await waitLeave();
  const cur = activeId();
  account.logout();
  if (cur) writeJson(accountsFile(), accountsLib.remove(readAccounts(), cur));
  const next = readAccounts()[0];
  if (next) activateAccount(next);
  afterAccountChange();
  return account.info;
});
handle('accounts:list', async () => accountsPayload());
handle('accounts:switch', async (id) => {
  if (playing) throw new Error('Cierra Minecraft antes de cambiar de cuenta');
  if (busy) throw new Error('Espera a que termine la actualización para cambiar de cuenta');
  const entry = readAccounts().find((a) => accountsLib.idOf(a) === String(id));
  if (!entry) throw new Error('Esa cuenta ya no está guardada');
  if (activeId() === accountsLib.idOf(entry)) return accountsPayload();
  await waitLeave();
  activateAccount(entry);
  afterAccountChange();
  return accountsPayload();
});
// Quitar una cuenta guardada que no es la activa (la activa se quita con "Cerrar sesión").
handle('accounts:remove', async (id) => {
  id = String(id);
  if (id === activeId()) throw new Error('Para quitar la cuenta activa usa "Cerrar sesión"');
  writeJson(accountsFile(), accountsLib.remove(readAccounts(), id));
  return accountsPayload();
});
// ── Pedidos de cuenta desde el juego (agregar premium, guardar un nick, quitar / cerrar sesión) ──
// El juego escribe config/account-request.json; aquí se atiende y se contesta en config/account-result.json.
// Sirve mientras Minecraft está abierto: el launcher sigue vivo y es el único que toca accounts.json y los tokens.
const accountRequestFile = () => path.join(path.dirname(authFile()), 'account-request.json');
const accountResultFile = () => path.join(path.dirname(authFile()), 'account-result.json');
let accountReqBusy = false;

/** Quita una cuenta guardada. Si era la activa del launcher, entra con la más reciente que quede (o queda sin sesión). */
async function removeSavedAccount(id) {
  const entry = readAccounts().find((a) => accountsLib.idOf(a) === id);
  if (!entry) throw new Error('Esa cuenta ya no está guardada');
  if (id === activeId()) {
    await waitLeave();
    account.logout();
    writeJson(accountsFile(), accountsLib.remove(readAccounts(), id));
    const next = readAccounts()[0];
    if (next) activateAccount(next);
    afterAccountChange();
  } else {
    writeJson(accountsFile(), accountsLib.remove(readAccounts(), id));
  }
  send('account:changed', { active: account.info });
  return entry;
}

async function runAccountRequest(req) {
  if (req.action === 'add-microsoft') {
    if (msLoginBusy) throw new Error('Ya hay una ventana de inicio de sesión abierta en el launcher');
    msLoginBusy = true;
    try {
      // alwaysOnTop: si el juego está a pantalla completa, la ventana de Microsoft no debe quedar escondida detrás
      const entry = await account.addMicrosoft({ alwaysOnTop: true });
      rememberAccount(sealEntry(entry));
      return `Cuenta ${entry.name} agregada`;
    } finally { msLoginBusy = false; }
  }
  if (req.action === 'add-offline') {
    rememberAccount({ kind: 'offline', name: req.name, uuid: offlineUuid(req.name) });
    return `Cuenta ${req.name} guardada`;
  }
  if (req.action === 'remove') {
    const entry = await removeSavedAccount(req.target);
    return `Cuenta ${entry.name} quitada`;
  }
  throw new Error('Pedido desconocido');
}

async function pollAccountRequest() {
  if (accountReqBusy) return;
  const f = accountRequestFile();
  if (!fs.existsSync(f)) return;
  accountReqBusy = true;
  try {
    const raw = readJson(f, null);
    try { fs.unlinkSync(f); } catch {}
    const req = accountReq.parse(raw);
    if (!req) return; // vacío, a medio escribir o viejo: se ignora
    let out;
    try { out = accountReq.result(req, true, await runAccountRequest(req)); }
    catch (e) { out = accountReq.result(req, false, (e && e.message) || String(e)); }
    writeJson(accountResultFile(), out);
  } finally { accountReqBusy = false; }
}
function startAccountRequests() {
  try { fs.unlinkSync(accountRequestFile()); } catch {} // lo que quedó de una sesión anterior no cuenta
  const t = setInterval(() => { pollAccountRequest().catch(() => {}); }, 700);
  if (t.unref) t.unref();
}
/** Baja OptiFine solo si esta activado y aun no hay uno guardado ni uno ya descargado por el jugador. Nunca tumba el juego: si falla, se juega sin OptiFine. */
async function ensureOptifine(onStatus) {
  if (getSettings().optifine === false) return null;
  if (optifine.status(P.optifine, optifineScanDirs()).available || optifine.scan(optifineScanDirs())) return null;
  try {
    const name = await optifine.autoDownload({ storedDir: P.optifine, fetchText, downloadFile, tmpDir: path.join(P.root, 'tmp'), onStatus });
    gameLog(`OptiFine descargado: ${name}`);
    return name;
  } catch (e) {
    gameLog(`OptiFine no se pudo descargar solo (${e.message}). Puedes elegirlo a mano en Ajustes > OptiFine.`);
    return null;
  }
}
const optifineScanDirs = () => {
  const dirs = [];
  for (const k of ['downloads', 'desktop', 'documents']) { try { dirs.push(app.getPath(k)); } catch { /* sin esa carpeta */ } }
  try { dirs.push(path.join(app.getPath('appData'), '.minecraft', 'mods')); } catch { /* opcional */ }
  return dirs;
};
handle('optifine:status', async () => optifine.status(P.optifine, optifineScanDirs()));
handle('optifine:useFound', async () => {
  const f = optifine.scan(optifineScanDirs());
  if (!f) throw new Error('No encontré OptiFine 1.8.9 en Descargas, Escritorio ni Documentos.');
  optifine.importJar(f, P.optifine);
  return optifine.status(P.optifine);
});
handle('optifine:download', async () => { await shell.openExternal(optifine.DOWNLOAD_URL); return true; });
handle('optifine:auto', async () => {
  await optifine.autoDownload({ storedDir: P.optifine, fetchText, downloadFile, tmpDir: path.join(P.root, 'tmp') });
  return optifine.status(P.optifine);
});
handle('optifine:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige OptiFine 1.8.9 (.jar)', properties: ['openFile'], filters: [{ name: 'OptiFine', extensions: ['jar'] }],
    defaultPath: app.getPath('downloads'),
  });
  if (r.canceled || !r.filePaths[0]) return optifine.status(P.optifine);
  optifine.importJar(r.filePaths[0], P.optifine);
  return optifine.status(P.optifine);
});

handle('settings:set', async (patch) => {
  const allowed = {};
  if (Number.isFinite(patch.ramMb)) allowed.ramMb = Math.min(Math.max(1024, Math.round(patch.ramMb)), Math.max(1024, Math.floor(require('os').totalmem() / 1048576)));
  if (typeof patch.selectedPack === 'string' || patch.selectedPack === null) allowed.selectedPack = patch.selectedPack;
  for (const k of ['jvmOptimized', 'minimizeOnPlay', 'optifine', 'fx', 'notify', 'fullscreen', 'autoStart', 'hud', 'closeToTray', 'discordRpc', 'discordShowNick', 'sharePresence', 'notifyFriends', 'notifyChat']) if (typeof patch[k] === 'boolean') allowed[k] = patch[k];
  if (typeof patch.extraJvm === 'string') allowed.extraJvm = cleanJvm(patch.extraJvm).join(' ');
  if (['cyber', 'nova', 'violet', 'ocean', 'emerald', 'ember'].includes(patch.theme)) allowed.theme = patch.theme;
  if ('autoStart' in allowed && app.isPackaged) app.setLoginItemSettings({ openAtLogin: allowed.autoStart });
  if (patch.seenNews && typeof patch.seenNews === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(patch.seenNews).slice(-200)) if (v === true && k.length < 100) clean[k] = true;
    allowed.seenNews = clean;
  }
  const out = setSettings(allowed);
  if ('sharePresence' in allowed) beatSoon();
  if ('discordRpc' in allowed) { if (allowed.discordRpc) { rpc && rpc.start(); setActivity(); } else rpc && rpc.stop(); }
  else if ('discordShowNick' in allowed) setActivity();
  return out;
});

// ───────────────────────── Discord, amigos y actualizaciones del launcher ─────────────────────────
function setActivity() {
  beatSoon();
  if (!rpc || getSettings().discordRpc === false) return;
  // Burbuja pequeña sobre el logo con la cara del jugador; al pasar el mouse sale su nick.
  const nick = (account.info || {}).name;
  const who = nick && getSettings().discordShowNick !== false
    ? { smallImage: 'https://mc-heads.net/avatar/' + encodeURIComponent(nick) + '/128', smallText: nick }
    : {};
  if (playing) rpc.set({ details: `Jugando ${playing.pack}`, state: KIND_LABEL[playing.kind] || 'En Atenas Client', startedAt: playing.startedAt, largeImage: playing.kind, largeText: playing.pack, ...who });
  else rpc.set({ details: 'En el launcher', state: 'Preparando la aventura', startedAt: launcherStartedAt, ...who });
}
const launcherStartedAt = Date.now();

handle('app:updateStatus', async () => (updater ? updater.status() : { state: 'idle', packaged: false }));
handle('app:updateCheck', async () => updater.check());
handle('app:updateInstall', async () => { updater.install(); return true; });

// ───────────────────────── amigos, solicitudes y chat (servicio social) ─────────────────────────
// El servicio guarda amistades, mensajes y presencia (social-worker/). Cada vuelta de "sync" también avisa tu propio estado.
const social = createSocial({
  url: config.socialUrl || config.presenceUrl || '',
  file: path.join(P.root, 'social.json'),
  getName: () => (account.info || {}).name || null,
  // Sesión de Microsoft para demostrar con Mojang que la cuenta premium es tuya (las cuentas sin conexión no tienen: quedan sin verificar).
  getAuth: async () => {
    const a = account.info;
    if (!a || a.kind === 'offline') return null;
    try { const m = await account.getMclc(); return { accessToken: m.access_token, uuid: m.uuid }; } catch { return null; }
  },
});
let lastSnap = null;       // última respuesta buena
let lastSocialError = null;
let socialBusy = null;
let pingCache = { at: 0, address: '', names: new Set() };

async function serverPlayers() {
  const server = serverByPack[getSettings().selectedPack];
  if (!server) return new Set();
  if (pingCache.address === server && Date.now() - pingCache.at < 45000) return pingCache.names;
  const ping = await pingServer(server).catch(() => null);
  pingCache = { at: Date.now(), address: server, names: new Set(((ping && ping.players && ping.players.names) || []).map((n) => n.toLowerCase())) };
  return pingCache.names;
}

function myPresence() {
  if (getSettings().sharePresence === false) return { source: 'launcher', offline: true };
  return { source: 'launcher', playing: !!playing, pack: playing ? playing.pack : '' };
}

function socialPayload() {
  if (!social.configured) return { status: 'unconfigured', friends: [], incoming: [], outgoing: [], unread: 0 };
  if (!(account.info || {}).name) return { status: 'noaccount', friends: [], incoming: [], outgoing: [], unread: 0 };
  if (!lastSnap) return { status: lastSocialError ? 'error' : 'loading', error: lastSocialError, friends: [], incoming: [], outgoing: [], unread: 0 };
  return { status: lastSocialError ? 'stale' : 'ok', error: lastSocialError, me: lastSnap.me, friends: lastSnap.friends, incoming: lastSnap.incoming, outgoing: lastSnap.outgoing, unread: lastSnap.unread };
}

// Avisos de amigos: si el launcher está a la vista, la propia interfaz muestra su aviso; si no, sale una tarjeta abajo a la
// derecha de la pantalla. Si estás dentro del juego (cliente de Atenas o pack con el mod social) el aviso sale ahí, arriba a la derecha.
const toaster = createToaster({
  preload: path.join(__dirname, 'src', 'toast-preload.js'),
  page: path.join(__dirname, 'renderer', 'toast.html'),
  onClick: (item) => { showWindow(); send('social:open', item && item.key ? { key: item.key } : null); },
});
const launcherVisible = () => !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused());
const gameShowsToasts = () => !!playing && ['pvp', 'mods'].includes(playing.kind);
function notifySocial(title, body, extra = {}) {
  if (getSettings().notify === false) return;
  if (launcherVisible() || gameShowsToasts()) return;
  try { toaster.show({ title, body, ...extra }); }
  catch {
    try { if (Notification.isSupported()) { const n = new Notification({ title, body }); n.on('click', () => { showWindow(); send('social:open', null); }); n.show(); } } catch {}
  }
}

// Si hay amigos guardados de la versión anterior (solo local), se les envía una solicitud una vez.
async function migrateOldFriends() {
  const s = getSettings();
  if (s.friendsMigrated || !Array.isArray(s.friends) || !s.friends.length) { if (!s.friendsMigrated) setSettings({ friendsMigrated: true }); return; }
  for (const n of s.friends.slice(0, 20)) { try { await social.add(n); } catch { /* aún no usa Atenas o ya es amigo */ } }
  setSettings({ friendsMigrated: true, friends: [] });
}

async function socialSync(announce = true) {
  if (socialBusy) return socialBusy;
  socialBusy = (async () => {
    try {
      if (!social.configured || !(account.info || {}).name) return socialPayload();
      const snap = await social.sync(myPresence());
      const inServer = await serverPlayers();
      snap.friends = mergeServer(snap.friends, inServer);
      const d = diffSnapshots(lastSnap, snap);
      const hadSnap = !!lastSnap;
      lastSnap = snap; lastSocialError = null;
      if (!hadSnap) migrateOldFriends().then(() => socialSync(false)).catch(() => {});
      if (announce && hadSnap) {
        const focused = win && !win.isDestroyed() && win.isFocused() && !win.isMinimized();
        send('social:events', d);
        for (const r of d.requests) notifySocial('Solicitud de amistad', `${r.name} quiere ser tu amigo`, { kind: 'request', name: r.name });
        for (const f of d.accepted) notifySocial('Nuevo amigo', `${f.name} aceptó tu solicitud`, { kind: 'friend', name: f.name });
        if (!focused) {
          if (getSettings().notifyChat !== false) for (const f of d.messages) notifySocial(f.name, f.preview.body, { kind: 'message', name: f.name, key: f.key });
          if (getSettings().notifyFriends !== false && d.came.length) {
            const one = d.came[0];
            notifySocial(d.came.length === 1 ? one.name : 'Amigos conectados', d.came.length === 1 ? (one.state === 'online' ? 'abrió el launcher' : 'está jugando' + (one.pack ? ' ' + one.pack : '')) : `${d.came.map((f) => f.name).slice(0, 3).join(', ')}${d.came.length > 3 ? ' y más' : ''} se conectaron`, { kind: 'friend', name: d.came.length === 1 ? one.name : '' });
          }
        }
      }
    } catch (e) {
      lastSocialError = { code: e.code || 'error', message: e.message };
      if (e.code === 'nick_taken' || e.code === 'bad_name') lastSnap = null;
    } finally { socialBusy = null; }
    const out = socialPayload();
    send('social:update', out);
    return out;
  })();
  return socialBusy;
}

// handle() envuelve los errores: aquí devolvemos siempre el estado y, si falló la acción, el mensaje.
const socialAction = (fn) => async (...args) => {
  const r = await fn(...args);        // si falla lanza y handle() lo convierte en error para la interfaz
  await socialSync(false);
  return { result: r, state: socialPayload() };
};
handle('social:state', async () => socialPayload());
handle('social:sync', async () => socialSync());
handle('social:add', socialAction((name) => social.add(name)));
handle('social:accept', socialAction((name) => social.accept(name)));
handle('social:remove', socialAction((name) => social.remove(name)));
handle('social:history', async (name, after) => (await social.history(String(name || ''), Number(after) || 0)).messages);
handle('social:send', async (name, body) => { const r = await social.send(String(name || ''), String(body || '')); return r.message; });

// ───────────────────────── presencia propia ─────────────────────────
// Se avisa en cada "sync" (cada ~12 s). Al cerrar del todo o cerrar sesión se avisa que ya no estás.
async function leavePresence() {
  try { await social.sync({ source: 'launcher', offline: true }); } catch {}
}
const beatSoon = () => { setTimeout(() => socialSync(true), 600); };
// Cada 4 s una consulta mínima (2 lecturas pequeñas en el servidor): si hay mensajes o solicitudes nuevas se baja todo al instante.
let lastPoll = null, pollBusy = false;
async function socialPoll() {
  if (pollBusy || socialBusy || !social.configured || !(account.info || {}).name || getSettings().notify === false && !launcherVisible()) return;
  pollBusy = true;
  try {
    const p = await social.poll();
    const sig = `${p.unread}:${p.last}:${p.incoming}`;
    const changed = lastPoll !== null && sig !== lastPoll;
    lastPoll = sig;
    if (changed) socialSync(true);
  } catch { /* sin conexión: el ciclo normal reintenta */ } finally { pollBusy = false; }
}
function startSocialLoop() {
  setInterval(socialPoll, 4000).unref?.();
  setTimeout(() => socialSync(true), 3000);
  setInterval(() => {
    const visible = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    if (visible || Date.now() - (startSocialLoop.last || 0) > 30000) { startSocialLoop.last = Date.now(); socialSync(true); }
  }, 12000).unref?.();
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
    if (quitting) return;
    e.preventDefault();
    if (getSettings().closeToTray === false) { quitApp(); return; }
    win.hide();
    if (!getSettings().trayHint && Notification.isSupported()) {
      setSettings({ trayHint: true });
      new Notification({ title: 'Atenas Client', body: 'Sigue abierto en segundo plano. Ciérralo del todo desde el icono de la bandeja.' }).show();
    }
  });
  win.on('closed', () => { win = null; closeSplash(); });
}

// Salir del todo: avisa a los amigos de que ya no estás (máx. 1,5 s de espera) y cierra.
async function quitApp() {
  if (leaving) return;
  leaving = true;
  try { await Promise.race([leavePresence(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  quitting = true;
  app.quit();
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
      { label: 'Salir del todo', click: quitApp },
    ]));
    tray.on('click', showWindow);
  } catch { tray = null; }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; try { rpc && rpc.stop(); } catch {} }); // también permite que la actualización automática cierre y reinstale
  app.setAppUserModelId('com.atenas.launcher'); // agrupa la barra de tareas y habilita las notificaciones de Windows
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    startWatcher();
    // ventana propia de actualización (renderer/update.html); ATENAS_UPDATE_PREVIEW=1 npm start la simula en desarrollo
    loadWin = createLoadingWindow({ root: __dirname });
    const updWin = createUpdateWindow({ root: __dirname, install: () => updater.install(), retry: () => updater.check() });
    updater = createUpdater({ app, send: (ch, p) => send(ch, ch === 'app:update' ? { ...p, win: !!updWin.isOpen() } : p), logDir: P.logs, onState: updWin.onState });
    if (!updater.init() && process.env.ATENAS_UPDATE_PREVIEW) updWin.preview();
    if (config.discordClientId) { rpc = new DiscordRpc(config.discordClientId); if (getSettings().discordRpc !== false) { rpc.start(); setActivity(); } }
    startSocialLoop();
    startAccountRequests();
  });
  app.on('window-all-closed', () => app.quit());
}
