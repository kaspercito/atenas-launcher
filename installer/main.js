'use strict';
// Instalador propio de Atenas Client: interfaz a medida que descarga el instalador oficial del último
// release de GitHub, lo ejecuta en silencio (/S) y abre el launcher. Sin permisos de administrador.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'kaspercito/atenas-launcher';
const candidates = () => ['Atenas Client', 'Atenas Launcher'].map((d) => path.join(process.env.LOCALAPPDATA || '', 'Programs', d, d + '.exe'));
const installedExe = () => candidates().find((f) => fs.existsSync(f)) || candidates()[0];
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

const send = (p) => { if (win && !win.isDestroyed()) win.webContents.send('progress', p); };
const mb = (n) => (n / 1048576).toFixed(1);

async function latestSetup() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'atenas-installer', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(r.status === 404 ? 'Todavía no hay una versión publicada en GitHub.' : `GitHub respondió con error ${r.status}. Inténtalo en unos minutos.`);
  const rel = await r.json();
  const asset = (rel.assets || []).find((a) => /^Atenas-Client-Setup-.*\.exe$/.test(a.name));
  if (!asset) throw new Error('No se encontró el instalador en la última versión de GitHub.');
  return { asset, version: rel.tag_name };
}

ipcMain.handle('install', async () => {
  if (busy) return;
  busy = true;
  try {
    send({ phase: 'work', pct: 3, text: 'Buscando la última versión…' });
    const { asset } = await latestSetup();
    const dest = path.join(os.tmpdir(), asset.name);

    const res = await fetch(asset.browser_download_url);
    if (!res.ok || !res.body) throw new Error('No se pudo descargar (error ' + res.status + '). Revisa tu internet.');
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    let got = 0; let last = 0;
    const hash = crypto.createHash('sha256');
    const src = Readable.fromWeb(res.body);
    src.on('data', (c) => {
      got += c.length; hash.update(c);
      if (Date.now() - last > 80) { last = Date.now(); send({ phase: 'work', pct: 5 + (total ? (got / total) * 65 : 0), text: `Descargando… ${mb(got)} / ${mb(total)} MB` }); }
    });
    await pipeline(src, fs.createWriteStream(dest));
    if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') && asset.digest.slice(7).toLowerCase() !== hash.digest('hex')) {
      throw new Error('El archivo descargado está dañado. Inténtalo otra vez.');
    }

    // instalación silenciosa: no informa de su avance, así que la barra avanza sola hasta que termina
    send({ phase: 'work', pct: 72, text: 'Instalando Atenas Client…' });
    let pct = 72;
    const tick = setInterval(() => { pct += (97 - pct) * 0.06; send({ phase: 'work', pct, text: 'Instalando Atenas Client…' }); }, 250);
    const code = await new Promise((resolve, reject) => {
      const p = spawn(dest, ['/S'], { windowsHide: true });
      p.on('error', reject); p.on('exit', resolve);
    }).finally(() => clearInterval(tick));
    try { fs.unlinkSync(dest); } catch {}
    if (code !== 0 || !fs.existsSync(installedExe())) throw new Error('La instalación no terminó bien (código ' + code + '). Cierra el launcher si está abierto y reintenta.');
    send({ phase: 'done', pct: 100, text: '¡Todo listo!' });
  } catch (err) {
    send({ phase: 'error', text: err.message || String(err) });
  } finally { busy = false; }
});

ipcMain.on('launch', () => {
  try { spawn(installedExe(), [], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  app.quit();
});
ipcMain.on('close', () => app.quit());

if (!app.requestSingleInstanceLock()) app.quit();
else { app.whenReady().then(createWindow); app.on('window-all-closed', () => app.quit()); }
