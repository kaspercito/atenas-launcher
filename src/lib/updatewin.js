'use strict';
// Ventana propia de actualización (renderer/update.html). La alimenta el actualizador con onState().
// - Aparece sola cuando hay una versión nueva descargándose o lista.
// - "Más tarde" la cierra y no vuelve a molestar con esa versión (se instala igualmente al cerrar el launcher).
// - ATENAS_UPDATE_PREVIEW=1 npm start  → simula una actualización para ver el diseño sin publicar nada.
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

function createUpdateWindow({ root, install, retry }) {
  let win = null;
  let last = null;
  let dismissed = null; // versión que el usuario dejó para más tarde
  let previewTimer = null;

  const alive = () => win && !win.isDestroyed();
  const push = () => { if (alive() && last) win.webContents.send('upd:state', last); };

  function open() {
    if (alive()) { win.show(); return; }
    win = new BrowserWindow({
      width: 520, height: 532, frame: false, transparent: true, resizable: false, maximizable: false,
      center: true, show: false, backgroundColor: '#00000000', title: 'Actualización · Atenas Client',
      icon: path.join(root, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, '..', 'update-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(path.join(root, 'renderer', 'update.html'));
    win.once('ready-to-show', () => { if (alive()) { win.show(); push(); } });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { win = null; });
  }

  function close() { if (alive()) win.close(); }

  function onState(st) {
    last = st;
    if ((st.state === 'downloading' || st.state === 'ready') && !alive() && dismissed !== st.version) open();
    push();
  }

  ipcMain.handle('upd:get', () => last);
  ipcMain.on('upd:install', () => { if (previewTimer !== null) { close(); return; } install(); });
  ipcMain.on('upd:later', () => { if (last) dismissed = last.version; close(); });
  ipcMain.on('upd:retry', () => { if (previewTimer !== null) return preview(); retry(); });

  function preview() {
    clearInterval(previewTimer);
    const total = 108 * 1048576; let t = 0;
    const cur = require('electron').app.getVersion();
    previewTimer = setInterval(() => {
      t += 1;
      const pct = Math.min(100, t * 2);
      if (pct >= 100) { clearInterval(previewTimer); previewTimer = 0; onState({ state: 'ready', version: '9.9.9', current: cur, percent: 100, error: null }); return; }
      onState({ state: 'downloading', version: '9.9.9', current: cur, percent: pct, speed: 2.6 * 1048576, transferred: total * pct / 100, total, error: null });
    }, 250);
  }

  return { onState, preview, isOpen: alive };
}
module.exports = { createUpdateWindow };
