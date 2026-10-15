'use strict';
// Actualizaciones del PROPIO launcher (electron-updater + GitHub Releases).
// Se comprueba cada 30 min, se informa a la interfaz en cada paso (y a la ventana de actualización propia
// mediante onState) y los errores quedan en updater.log. La instalación es SILENCIOSA: no sale el asistente de Windows.
const fs = require('fs');
const path = require('path');

function createUpdater({ app, send, logDir, intervalMin = 30, onState }) {
  const st = { state: 'idle', version: null, percent: 0, error: null, speed: 0, transferred: 0, total: 0 };
  const push = (patch) => {
    Object.assign(st, patch);
    // primero la ventana de actualización (para que la interfaz principal sepa si ya está abierta) y luego el aviso
    try { if (onState) onState({ ...st, current: app.getVersion() }); } catch {}
    send('app:update', { ...st });
  };
  const log = (m) => { try { fs.appendFileSync(path.join(logDir, 'updater.log'), `[${new Date().toISOString()}] ${m}\n`); } catch {} };
  let au = null;

  function init() {
    if (!app.isPackaged) return false; // en desarrollo (npm start) no hay nada que actualizar
    try { ({ autoUpdater: au } = require('electron-updater')); } catch (e) { log('electron-updater no disponible: ' + e.message); return false; }
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.logger = { info: log, warn: log, error: log, debug: () => {} };
    au.on('checking-for-update', () => push({ state: 'checking', error: null }));
    au.on('update-available', (i) => push({ state: 'downloading', version: i.version, percent: 0, speed: 0, transferred: 0, total: 0, error: null }));
    au.on('update-not-available', () => push({ state: 'latest', error: null }));
    au.on('download-progress', (p) => push({ state: 'downloading', percent: Math.round(p.percent || 0), speed: p.bytesPerSecond || 0, transferred: p.transferred || 0, total: p.total || 0 }));
    au.on('update-downloaded', (i) => push({ state: 'ready', version: i.version, percent: 100 }));
    au.on('error', (e) => { log('error: ' + (e && e.message)); push({ state: 'error', error: String((e && e.message) || e).slice(0, 200) }); });
    const tick = () => { if (st.state !== 'ready' && st.state !== 'downloading') au.checkForUpdates().catch((e) => log('check: ' + e.message)); };
    setTimeout(tick, 4000);
    setInterval(tick, Math.max(5, intervalMin) * 60 * 1000).unref?.();
    return true;
  }
  return {
    init,
    status: () => ({ ...st, packaged: app.isPackaged }),
    check: async () => { if (!au) return { ...st, state: 'dev' }; try { await au.checkForUpdates(); } catch (e) { push({ state: 'error', error: e.message.slice(0, 200) }); } return { ...st }; },
    // isSilent = true → instala sin asistente; isForceRunAfter = true → vuelve a abrir el launcher al terminar
    install: () => { if (au && st.state === 'ready') au.quitAndInstall(true, true); },
  };
}
module.exports = { createUpdater };
