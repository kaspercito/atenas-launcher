'use strict';
// Instalador propio de Atenas Client: interfaz a medida que descarga el instalador oficial del último
// release de GitHub, lo ejecuta en silencio (/S) y abre el launcher. Sin permisos de administrador.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'kaspercito/atenas-launcher';
const NAMES = ['Atenas Client', 'Atenas Launcher'];
const LOG = path.join(os.tmpdir(), 'atenas-installer.log');
const log = (m) => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {} };

// Carpetas donde puede haber quedado instalado: lo que registró Windows (desinstalador) + las rutas habituales.
function installDirs() {
  const dirs = [];
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', hive + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Atenas', '/d'],
        { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
      for (const m of out.matchAll(/InstallLocation\s+REG_SZ\s+(.+)/g)) dirs.push(m[1].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const n of NAMES) dirs.push(path.join(base, n));
  }
  return [...new Set(dirs)];
}
function findInstalled() {
  for (const d of installDirs()) for (const n of NAMES) { const f = path.join(d, n + '.exe'); if (fs.existsSync(f)) return f; }
  // Respaldo: si la carpeta tiene otro nombre (instalaciones viejas), busca Atenas*.exe un nivel dentro de Programs.
  try {
    const prog = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs');
    if (prog) for (const d of fs.readdirSync(prog)) {
      if (!/atenas/i.test(d)) continue;
      for (const f of fs.readdirSync(path.join(prog, d))) if (/^atenas.*\.exe$/i.test(f) && !/unins|uninstall/i.test(f)) return path.join(prog, d, f);
    }
  } catch {}
  return null;
}
// ¿Sigue corriendo algún instalador de Atenas? (NSIS puede relanzarse y el proceso original sale con código 0 antes de copiar los archivos)
function setupRunning() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return /Atenas-Client-Setup/i.test(out);
  } catch { return false; }
}
// El antivirus o Windows pueden tardar unos segundos en soltar los archivos: espera antes de dar error.
async function waitInstalled(ms = 45000) {
  const end = Date.now() + ms; const hardEnd = Date.now() + 180000;
  for (;;) {
    const f = findInstalled(); if (f) return f;
    const now = Date.now();
    if (now > hardEnd || (now > end && !setupRunning())) return null;
    await new Promise((r) => setTimeout(r, 750));
  }
}
let installedPath = null;
const installedExe = () => installedPath || findInstalled() || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Atenas Client', 'Atenas Client.exe');
let win = null;
let busy = false;

function createWindow() {
  win = new BrowserWindow({
    width: 620, height: 420, frame: false, transparent: true, resizable: false, center: true, show: false,
    backgroundColor: '#00000000', title: 'Atenas Client', icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// El launcher se queda en la bandeja al cerrar la ventana: si sigue abierto, el instalador no puede reemplazar sus archivos.
// Sin /T para no matar Minecraft si alguien está jugando.
function closeLauncher() {
  for (const n of NAMES) { try { execFileSync('taskkill', ['/IM', n + '.exe', '/F'], { windowsHide: true, timeout: 8000, stdio: 'ignore' }); } catch {} }
}
const send = (p) => { if (win && !win.isDestroyed()) win.webContents.send('progress', p); };
const mb = (n) => (n / 1048576).toFixed(1);

async function latestSetup() {
  let apiErr = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'atenas-installer', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) throw new Error('Todavía no hay una versión publicada en GitHub.');
    if (!r.ok) throw Object.assign(new Error(`GitHub respondió con error ${r.status}.`), { retryable: true });
    const rel = await r.json();
    const asset = (rel.assets || []).find((a) => /^Atenas-Client-Setup-.*\.exe$/.test(a.name));
    if (!asset) throw new Error('No se encontró el instalador en la última versión de GitHub.');
    return { asset, version: rel.tag_name };
  } catch (e) { if (!e.retryable && e.name !== 'TimeoutError' && e.name !== 'TypeError') throw e; apiErr = e; }
  // La API falló (límite de peticiones, red compartida…): se lee latest.yml, que publica electron-builder en cada release.
  log('API de GitHub falló (' + apiErr.message + '), usando latest.yml');
  try {
    const base = `https://github.com/${REPO}/releases/latest/download/`;
    const y = await fetch(base + 'latest.yml', { headers: { 'User-Agent': 'atenas-installer' }, signal: AbortSignal.timeout(15000) });
    if (!y.ok) throw new Error('HTTP ' + y.status);
    const txt = await y.text();
    const file = /^path:\s*(\S+)/m.exec(txt)?.[1];
    const sha512 = /^sha512:\s*(\S+)/m.exec(txt)?.[1];
    const version = /^version:\s*(\S+)/m.exec(txt)?.[1];
    if (!file || !/^Atenas-Client-Setup-[\w.\-]+\.exe$/.test(file)) throw new Error('latest.yml inválido');
    return { asset: { name: file, browser_download_url: base + file, size: 0, sha512 }, version };
  } catch (e) {
    throw new Error('No se pudo consultar GitHub. Revisa tu internet y reintenta. (' + (apiErr.message || e.message) + ')');
  }
}

// Errores de red que merecen reintento (corte, timeout, DNS, reset…).
const isNetErr = (e) => !!e && (['TimeoutError', 'AbortError', 'TypeError'].includes(e.name) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|terminated|aborted|timeout/i.test(String(e.code || '') + ' ' + String(e.message || '')));

// Descarga con timeout por INACTIVIDAD: solo se aborta si pasan 30 s sin recibir ni un byte.
// (Antes había un límite fijo de 30 s para toda la descarga, y el instalador pesa decenas de MB:
//  con internet lento se cortaba siempre con "The operation was aborted due to timeout".)
async function download(asset, dest, onProgress) {
  const ctl = new AbortController();
  let stall = setTimeout(() => ctl.abort(), 30000);
  const kick = () => { clearTimeout(stall); stall = setTimeout(() => ctl.abort(), 30000); };
  try {
    const res = await fetch(asset.browser_download_url, { signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error('No se pudo descargar (error ' + res.status + '). Revisa tu internet.');
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    let got = 0; let last = 0;
    const h256 = crypto.createHash('sha256');
    const h512 = crypto.createHash('sha512');
    const src = Readable.fromWeb(res.body);
    src.on('data', (c) => {
      kick(); got += c.length; h256.update(c); h512.update(c);
      if (Date.now() - last > 80) { last = Date.now(); onProgress(got, total); }
    });
    await pipeline(src, fs.createWriteStream(dest));
    return { sha256: h256.digest('hex'), sha512: h512.digest('base64') };
  } finally { clearTimeout(stall); }
}

ipcMain.handle('install', async () => {
  if (busy) return;
  busy = true;
  try {
    send({ phase: 'work', pct: 3, text: 'Buscando la última versión…' });
    const { asset } = await latestSetup();
    const dest = path.join(os.tmpdir(), asset.name);

    // Hasta 3 intentos: en conexiones lentas o inestables la descarga puede cortarse a mitad.
    let dl = null;
    for (let attempt = 1; attempt <= 3 && !dl; attempt++) {
      try {
        dl = await download(asset, dest, (got, total) => send({ phase: 'work', pct: 5 + (total ? (got / total) * 65 : 0), text: `Descargando… ${mb(got)} / ${mb(total)} MB` }));
      } catch (e) {
        log(`Descarga fallida (intento ${attempt}/3): ${e && e.name}: ${e && e.message}`);
        if (!isNetErr(e) || attempt === 3) throw e;
        send({ phase: 'work', pct: 5, text: `Conexión lenta, reintentando (${attempt + 1}/3)…` });
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') && asset.digest.slice(7).toLowerCase() !== dl.sha256) {
      throw new Error('El archivo descargado está dañado. Inténtalo otra vez.');
    }
    if (asset.sha512 && asset.sha512 !== dl.sha512) throw new Error('El archivo descargado está dañado. Inténtalo otra vez.');

    // instalación silenciosa: no informa de su avance, así que la barra avanza sola hasta que termina
    send({ phase: 'work', pct: 72, text: 'Instalando Atenas Client…' });
    let pct = 72;
    const tick = setInterval(() => { pct += (97 - pct) * 0.06; send({ phase: 'work', pct, text: 'Instalando Atenas Client…' }); }, 250);
    closeLauncher();
    await new Promise((r) => setTimeout(r, 800));
    log('Ejecutando ' + dest + ' /S');
    const code = await new Promise((resolve, reject) => {
      const p = spawn(dest, ['/S'], { windowsHide: true });
      p.on('error', reject); p.on('exit', resolve);
    }).finally(() => clearInterval(tick));
    log('Instalador terminó con código ' + code);
    send({ phase: 'work', pct: 98, text: 'Comprobando la instalación…' });
    installedPath = await waitInstalled();
    log('Ejecutable encontrado: ' + installedPath + ' | rutas revisadas: ' + installDirs().join(' ; '));
    if (installedPath) { try { fs.unlinkSync(dest); } catch {} }
    if (!installedPath) {
      try { const prog = path.join(process.env.LOCALAPPDATA || '', 'Programs'); log('Contenido de ' + prog + ': ' + fs.readdirSync(prog).join(' | ')); } catch (e) { log('No se pudo listar Programs: ' + e.message); }
      log('Instalador sigue corriendo: ' + setupRunning() + ' | archivo del instalador existe: ' + fs.existsSync(dest));
      if (code !== 0) throw new Error('La instalación falló (código ' + code + '). Cierra el launcher si está abierto y reintenta.');
      throw new Error('El instalador terminó pero no se encontró Atenas Client. Puede que tu antivirus lo haya bloqueado o lo esté escaneando: espera un minuto, o desactívalo un momento, y pulsa Reintentar. Si sigue igual, mándale a kaspercito este archivo: ' + LOG);
    }
    send({ phase: 'done', pct: 100, text: '¡Todo listo!' });
  } catch (err) {
    log('ERROR: ' + (err && err.stack || err));
    const msg = isNetErr(err) && !/GitHub|descargar|dañado/.test(err.message || '')
      ? 'La descarga se cortó o tu internet está muy lento. Revisa tu conexión y pulsa Reintentar.'
      : (err.message || String(err));
    send({ phase: 'error', text: msg });
  } finally { busy = false; }
});

ipcMain.on('launch', () => {
  try { spawn(installedExe(), [], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  app.quit();
});
ipcMain.on('close', () => app.quit());

if (!app.requestSingleInstanceLock()) app.quit();
else { app.whenReady().then(createWindow); app.on('window-all-closed', () => app.quit()); }
