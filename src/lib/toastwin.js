'use strict';
// Notificaciones propias del launcher: tarjetas que suben desde la esquina inferior derecha de la pantalla
// (como Discord / Lunar), sin robar el foco. Una ventana pequeña y transparente por aviso; se apilan solas.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const W = 372, H = 96, GAP = 10, MARGIN = 16, MAX_VISIBLE = 4, LIFE_MS = 7000;

function createToaster({ preload, page, onClick }) {
  const stack = []; // más reciente al final; la última queda abajo del todo

  function layout() {
    const wa = screen.getPrimaryDisplay().workArea;
    let y = wa.y + wa.height - MARGIN;
    for (let i = stack.length - 1; i >= 0; i--) {
      const t = stack[i];
      y -= H;
      if (!t.win.isDestroyed()) t.win.setBounds({ x: wa.x + wa.width - W - MARGIN, y, width: W, height: H }, false);
      y -= GAP;
    }
  }

  function dismiss(t) {
    const i = stack.indexOf(t);
    if (i < 0) return;
    stack.splice(i, 1);
    clearTimeout(t.timer);
    if (!t.win.isDestroyed()) t.win.destroy();
    layout();
  }

  function arm(t) { clearTimeout(t.timer); t.timer = setTimeout(() => dismiss(t), LIFE_MS); }

  /** item: { title, body, name, kind: 'message'|'request'|'friend'|'info', data } */
  function show(item) {
    while (stack.length >= MAX_VISIBLE) dismiss(stack[0]);
    const win = new BrowserWindow({
      width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
      focusable: false, show: false, alwaysOnTop: true, hasShadow: false, fullscreenable: false, thickFrame: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const t = { win, item, timer: null };
    stack.push(t);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    const q = new URLSearchParams({
      title: String(item.title || '').slice(0, 60), body: String(item.body || '').slice(0, 160),
      name: String(item.name || ''), kind: String(item.kind || 'info'), life: String(LIFE_MS),
    });
    win.loadFile(page, { search: q.toString() });
    win.once('ready-to-show', () => { layout(); win.showInactive(); arm(t); });
    win.webContents.ipc.on('toast:click', () => { dismiss(t); try { onClick && onClick(item); } catch {} });
    win.webContents.ipc.on('toast:close', () => dismiss(t));
    win.webContents.ipc.on('toast:hover', (_e, on) => { if (on) clearTimeout(t.timer); else arm(t); });
    win.on('closed', () => dismiss(t));
    return t;
  }

  function closeAll() { for (const t of [...stack]) dismiss(t); }
  return { show, closeAll, count: () => stack.length };
}

module.exports = { createToaster };
