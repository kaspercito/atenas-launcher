'use strict';
// Ventana de carga: tapa la pantalla de Forge/Minecraft mientras cargan los mods y se cierra sola.
//  - Atenas Client (perfil integrado): cuando el cliente avisa "[Atenas] MENU_READY".
//  - Cualquier otro modpack (no tiene el cliente de Atenas, asi que MENU_READY nunca llega): cuando el juego arranca el
//    sonido (ultimo paso antes del menu), o por tiempo. Nunca se queda pegada.
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { createTracker } = require('./loadprogress');

// Por seguridad: pase lo que pase, la ventana nunca tapa el juego para siempre.
const MAX_MS = { builtin: 4 * 60 * 1000, pack: 5 * 60 * 1000 };
// Cuanto esperar despues de que arranca el sonido: el cliente de Atenas avisa solo; en otros packs ya casi esta el menu.
const AFTER_SOUND_MS = { builtin: 15 * 1000, pack: 3500 };
// Si el juego deja de escribir en la consola tanto tiempo estando ya casi listo, se asume que ya esta en el menu.
const QUIET_MS = 45 * 1000;

function createLoadingWindow({ root }) {
  let win = null;
  let tracker = null;
  let timer = null;
  let guard = null;
  let soundTimer = null;
  let lastLine = 0;
  let opts = { builtin: true, pack: 'Atenas Client' };
  let last = { pct: 3, text: 'Preparando el juego', ready: false, builtin: true, pack: 'Atenas Client' };

  const alive = () => win && !win.isDestroyed();
  const push = (extra) => { last = { ...last, ...extra }; if (alive()) win.webContents.send('load:state', last); };

  function stop() {
    clearInterval(timer); timer = null;
    clearTimeout(guard); guard = null;
    clearTimeout(soundTimer); soundTimer = null;
  }

  function close() {
    stop();
    tracker = null;
    if (alive()) win.close();
    win = null;
  }

  /** show(texto) o show({ text, builtin, pack }): builtin=true solo para Atenas Client; `pack` es el nombre que se ve. */
  function show(arg) {
    if (alive()) return;
    const o = typeof arg === 'string' ? { text: arg } : (arg || {});
    opts = { builtin: o.builtin !== false, pack: String(o.pack || (o.builtin === false ? 'Minecraft' : 'Atenas Client')).slice(0, 48) };
    tracker = createTracker();
    lastLine = Date.now();
    last = { ...tracker.state, text: o.text || tracker.state.text, builtin: opts.builtin, pack: opts.pack };
    // Cubre TODA la pantalla con fondo opaco: asi no se ve nada de la ventana de Forge/Minecraft, ni su borde ni su fondo.
    const bd = screen.getPrimaryDisplay().bounds;
    win = new BrowserWindow({
      x: bd.x, y: bd.y, width: bd.width, height: bd.height, frame: false, thickFrame: false, transparent: false, resizable: false, maximizable: false, minimizable: false,
      show: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#07060f', title: 'Cargando · Atenas Client',
      icon: path.join(root, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, '..', 'loading-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(root, 'renderer', 'loading.html'));
    win.once('ready-to-show', () => { if (alive()) { win.setBounds(bd); win.showInactive(); win.setBounds(bd); push({}); } }); // setBounds otra vez: Windows a veces recorta la altura (franja blanca abajo)
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { win = null; stop(); });
    // Cada 400 ms: avanza la barra y se vuelve a poner por encima de Minecraft (su ventana puede robar el primer plano al abrirse).
    timer = setInterval(() => {
      if (tracker) push(tracker.creep());
      // Casi listo y la consola lleva rato en silencio: el juego ya esta en el menu (o colgado, y entonces tampoco hay que taparlo).
      if (alive() && last.pct >= 84 && Date.now() - lastLine > QUIET_MS) { close(); return; }
      if (alive() && !last.ready) { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); }
    }, 400);
    guard = setTimeout(close, opts.builtin ? MAX_MS.builtin : MAX_MS.pack);
  }

  /** Una linea de la consola del juego: avanza la barra y cierra la ventana al llegar al menu. */
  function feed(line) {
    if (!tracker) return;
    lastLine = Date.now();
    const st = tracker.feed(line);
    push(st);
    if (st.ready) { setTimeout(close, 700); return; } // deja ver el 100% un instante
    // El sonido ya arranco: si en un rato no llega MENU_READY (otro modpack, o el menu de Atenas no se abrio), se cierra igual.
    if (st.sound && !soundTimer) {
      soundTimer = setTimeout(() => {
        soundTimer = null;
        if (!alive() || last.ready) return;
        push({ pct: 100, text: 'Listo', ready: true });
        setTimeout(close, 500);
      }, opts.builtin ? AFTER_SOUND_MS.builtin : AFTER_SOUND_MS.pack);
    }
  }

  /** Mensaje de una fase previa al juego (descargas), con progreso opcional. */
  function stage(text, pct) {
    if (!alive() || !tracker) return;
    push(tracker.hint(text, pct));
  }

  ipcMain.on('load:close', () => close());
  return { show, feed, stage, close, isOpen: alive };
}
module.exports = { createLoadingWindow };
