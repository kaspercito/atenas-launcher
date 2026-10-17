'use strict';
(() => {
  const api = window.atenas;
  const $ = (id) => document.getElementById(id);
  const call = async (fn, ...a) => { const r = await fn(...a); if (!r.ok) throw new Error(r.message || r.error); return r.data; };
  const toast = (text, error) => {
    const t = document.createElement('div'); t.className = 'toast' + (error ? ' error' : ''); t.textContent = text;
    $('toasts').append(t); setTimeout(() => t.remove(), 6000);
  };

  // ───── animación de entrada escalonada al cambiar de pestaña ─────
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
    const v = $('view-' + b.dataset.view); if (!v) return;
    v.querySelectorAll(':is(.mod-card,.card,.news>*,.stat,.side-card,.server-card)').forEach((n, i) => n.style.setProperty('--i', Math.min(i, 14)));
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    setTimeout(() => v.classList.remove('enter'), 1100);
    if (b.dataset.view === 'settings') loadExtraSettings();
  }));

  // ───── aviso de actualización del launcher ─────
  const banner = $('updBanner');
  let dismissed = false;
  function onUpdate(u) {
    const txt = { checking: '', latest: 'Tienes la última versión', error: 'No se pudo comprobar: ' + (u.error || ''), dev: 'Solo funciona en la versión instalada', idle: '' }[u.state];
    if ($('updState')) $('updState').textContent = txt || (u.state === 'downloading' ? `Descargando ${u.percent}%` : u.state === 'ready' ? 'Lista para instalar' : 'Buscando…');
    if (u.state === 'downloading' || u.state === 'ready') {
      if (u.win) { banner.hidden = true; return; } // la ventana de actualización ya está abierta
      if (dismissed && u.state === 'downloading') return;
      banner.hidden = false;
      $('updText').textContent = u.state === 'ready' ? `Atenas Client ${u.version} está lista` : `Descargando la versión ${u.version}…`;
      $('updBarWrap').hidden = u.state === 'ready';
      $('updFill').style.transform = `scaleX(${(u.percent || 0) / 100})`;
      $('updInstall').hidden = u.state !== 'ready';
    }
  }
  api.onAppUpdate(onUpdate);
  api.updateStatus().then((r) => r.ok && onUpdate(r.data));
  $('updClose').addEventListener('click', () => { dismissed = true; banner.hidden = true; });
  $('updInstall').addEventListener('click', () => api.updateInstall());
  $('btnCheckUpd').addEventListener('click', async () => {
    $('updState').textContent = 'Buscando…'; dismissed = false;
    try { onUpdate(await call(api.updateCheck)); } catch (e) { toast(e.message, true); }
  });

  // ───── ajustes extra (Discord, presencia) ─────
  async function loadExtraSettings() {
    try {
      const init = await call(api.init);
      $('optTray').checked = init.settings.closeToTray !== false;
      $('optRpc').checked = init.settings.discordRpc !== false;
      $('optRpcNick').checked = init.settings.discordShowNick !== false;
      $('optShare').checked = init.settings.sharePresence !== false;
      $('optNotifyFr').checked = init.settings.notifyFriends !== false;
      $('optNotifyChat').checked = init.settings.notifyChat !== false;
    } catch {}
  }
  $('optTray').addEventListener('change', (e) => api.setSettings({ closeToTray: e.target.checked }));
  $('optRpc').addEventListener('change', (e) => api.setSettings({ discordRpc: e.target.checked }));
  $('optRpcNick').addEventListener('change', (e) => api.setSettings({ discordShowNick: e.target.checked }));
  $('optShare').addEventListener('change', (e) => api.setSettings({ sharePresence: e.target.checked }));
  $('optNotifyFr').addEventListener('change', (e) => api.setSettings({ notifyFriends: e.target.checked }));
  $('optNotifyChat').addEventListener('change', (e) => api.setSettings({ notifyChat: e.target.checked }));

})();
