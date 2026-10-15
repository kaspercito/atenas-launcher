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
    v.querySelectorAll(':is(.mod-card,.fr-row,.card,.news>*,.pack-tab,.stat)').forEach((n, i) => n.style.setProperty('--i', Math.min(i, 14)));
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    setTimeout(() => v.classList.remove('enter'), 1100);
    if (b.dataset.view === 'friends') startFriends(); else stopFriends();
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
    } catch {}
  }
  $('optTray').addEventListener('change', (e) => api.setSettings({ closeToTray: e.target.checked }));
  $('optRpc').addEventListener('change', (e) => api.setSettings({ discordRpc: e.target.checked }));
  $('optRpcNick').addEventListener('change', (e) => api.setSettings({ discordShowNick: e.target.checked }));
  $('optShare').addEventListener('change', (e) => api.setSettings({ sharePresence: e.target.checked }));

  // ───── amigos ─────
  let timer = null;
  async function loadFriends() {
    try {
      const d = await call(api.friends);
      const order = { playing: 0, server: 0, online: 1, offline: 2 };
      const list = d.friends.slice().sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
      // DOM puro: la CSP del launcher no permite estilos/handlers en línea ni imágenes externas
      $('frList').replaceChildren(...list.map((f, i) => {
        const row = document.createElement('div'); row.className = 'fr-row'; row.dataset.s = f.status; row.style.setProperty('--i', Math.min(i, 14));
        const av = document.createElement('div'); av.className = 'fr-head'; av.textContent = f.name[0].toUpperCase();
        const info = document.createElement('div'); info.className = 'fr-info';
        const n = document.createElement('strong'); n.textContent = f.name;
        const w = document.createElement('span'); w.textContent = f.where;
        info.append(n, w);
        const dot = document.createElement('i'); dot.className = 'fr-dot';
        const x = document.createElement('button'); x.className = 'icon-mini fr-x'; x.dataset.name = f.name; x.title = 'Quitar'; x.textContent = '×';
        row.append(av, info, dot, x); return row;
      }));
      $('frEmpty').hidden = list.length > 0;
      const on = list.filter((f) => f.status !== 'offline').length;
      $('friendsDot').hidden = on === 0;
      $('frSub').textContent = list.length ? `${on} de ${list.length} conectados` : 'Añade el nick de Minecraft de tus amigos y mira quién está conectado.';
      $('frNote').textContent = d.presence ? '' : 'Ahora solo se detecta quién está dentro del servidor (el ping muestra hasta 12 jugadores). Para ver "Jugando…" activa el servicio de presencia (GUIA-NUEVAS-FUNCIONES.md).';
    } catch (e) { toast(e.message, true); }
  }
  function startFriends() { loadFriends(); clearInterval(timer); timer = setInterval(() => !document.hidden && loadFriends(), 45000); }
  function stopFriends() { clearInterval(timer); timer = null; }
  $('frForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('frName').value.trim(); if (!name) return;
    try { await call(api.addFriend, name); $('frName').value = ''; loadFriends(); } catch (e) { toast(e.message, true); }
  });
  $('frList').addEventListener('click', async (ev) => {
    const b = ev.target.closest('.fr-x'); if (!b) return;
    await call(api.removeFriend, b.dataset.name).catch((e) => toast(e.message, true));
    loadFriends();
  });
})();
