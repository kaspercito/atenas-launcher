'use strict';
(() => {
  const api = window.atenas;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    account: null,
    adding: false,
    settings: {},
    totalRamMb: 8192,
    packs: [],
    summaries: {},
    selected: null,
    busy: false,
    playing: false,
    view: 'home',
    appVersion: '',
    seenNews: {},
    links: {},
    lastError: '',
  };

  // ───────── utilidades ─────────
  async function call(fn, ...args) {
    const r = await fn(...args);
    if (!r.ok) {
      const e = new Error(r.message || r.error);
      e.code = r.error;
      throw e;
    }
    return r.data;
  }

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec ? `${sec} s` : '0 h';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { toast('No se pudo copiar', 'error'); }
  }

  function toast(text, kind = 'info', ms = 6000) {
    const t = el('div', { class: `toast ${kind === 'error' ? 'error' : ''}`, role: 'status', text });
    $('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  function listText(items, max = 8) {
    const shown = items.slice(0, max).join(', ');
    return items.length > max ? `${shown} y ${items.length - max} más` : shown;
  }

  function countUp(node, to) {
    if (reduceMotion || !Number.isFinite(to)) { node.textContent = String(to); return; }
    const from = Number(node.dataset.v || 0);
    node.dataset.v = String(to);
    const t0 = performance.now();
    const dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ───────── vistas ─────────
  function showView(name) {
    state.view = name;
    const tv = document.getElementById('tbView'); if (tv) tv.textContent = ({ home: 'Inicio', mods: 'Mods', news: 'Novedades', friends: 'Amigos', settings: 'Ajustes' })[name] || '';
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('.nav-btn').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
    if (name === 'mods') renderMods();
    if (name === 'news') { renderNews(); markNewsSeen(); }
    if (name === 'settings') loadSettingsView();
    document.dispatchEvent(new CustomEvent('atenas:view', { detail: name }));
  }
  window.atenasShowView = showView;

  // ───────── cuenta ─────────
  // Cara del jugador; si no se encuentra la skin (no premium, sin internet o servicio caído) se muestra la cara de Steve
  function setFace(av, name) {
    av.textContent = String(name || '?').slice(0, 1).toUpperCase();
    const show = (src, onFail) => {
      const img = new Image();
      img.alt = '';
      img.onload = () => av.replaceChildren(img);
      if (onFail) img.onerror = onFail;
      img.src = src;
    };
    show('https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/64', () => show('steve.png'));
  }

  function renderAccount() {
    const a = state.account;
    $('accName').textContent = a ? a.name : 'Sin sesión';
    $('accKind').textContent = a ? (a.kind === 'offline' ? 'No premium' : 'Microsoft') : '';
    if (a) setFace($('avatar'), a.name); else $('avatar').textContent = '?';
    const adding = !!a && state.adding;
    const gateOpen = !a || adding;
    $('gate').hidden = !gateOpen;
    $('gateCancel').hidden = !adding;
    $('gateTitle').textContent = adding ? 'Añadir cuenta' : 'Bienvenido a Atenas';
    $('gateLead').textContent = adding ? 'Inicia sesión con otra cuenta. La actual sigue guardada y puedes volver a ella cuando quieras.' : 'Elige cómo quieres jugar.';
    if (gateOpen) $('offlineName').focus();
  }

  function showGateError(msg) {
    $('gateError').textContent = msg || '';
    $('gateError').hidden = !msg;
  }

  async function loginMicrosoft() {
    showGateError('');
    $('btnMicrosoft').disabled = true;
    try {
      state.account = await call(api.login);
      state.adding = false;
      renderAccount();
      refreshSelected();
    } catch (e) {
      showGateError(e.message);
    } finally {
      $('btnMicrosoft').disabled = false;
    }
  }

  async function loginOffline(ev) {
    ev.preventDefault();
    showGateError('');
    try {
      state.account = await call(api.loginOffline, $('offlineName').value);
      state.adding = false;
      $('offlineName').value = '';
      renderAccount();
      refreshSelected();
    } catch (e) {
      showGateError(e.message);
    }
  }

  // ───────── menú de la cuenta (cambiar, añadir, cerrar sesión) ─────────
  const accMenuOpen = () => !$('accMenu').hidden;
  function closeAccMenu() {
    $('accMenu').hidden = true;
    $('account').setAttribute('aria-expanded', 'false');
  }
  function placeAccMenu() {
    const r = $('account').getBoundingClientRect();
    const m = $('accMenu');
    m.style.top = Math.round(r.bottom + 8) + 'px';
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
  }
  function renderAccList(list) {
    const others = (list || []).filter((x) => !x.active);
    $('amOthersSep').hidden = $('amOthersLabel').hidden = $('amList').hidden = !others.length;
    $('amList').replaceChildren(...others.map((x) => {
      const row = document.createElement('div');
      row.className = 'am-row';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'am-acc';
      pick.setAttribute('role', 'menuitem');
      const av = document.createElement('div');
      av.className = 'avatar';
      setFace(av, x.name);
      const who = document.createElement('div');
      who.className = 'am-who';
      const n = document.createElement('strong');
      n.textContent = x.name;
      const k = document.createElement('span');
      k.textContent = x.kind === 'offline' ? 'No premium' : 'Microsoft';
      who.append(n, k);
      pick.append(av, who);
      pick.addEventListener('click', () => switchToAccount(x.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'am-del';
      del.title = 'Quitar de la lista';
      del.setAttribute('aria-label', 'Quitar ' + x.name + ' de la lista');
      del.textContent = '×';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try { renderAccList((await call(api.accounts.remove, x.id)).list); } catch (e) { toast(e.message, 'error'); }
      });
      row.append(pick, del);
      return row;
    }));
  }
  async function openAccMenu() {
    const a = state.account;
    if (!a) return;
    $('amName').textContent = a.name;
    $('amKind').textContent = a.kind === 'offline' ? 'No premium' : 'Microsoft';
    setFace($('amAvatar'), a.name);
    renderAccList([]);
    placeAccMenu();
    $('accMenu').hidden = false;
    $('account').setAttribute('aria-expanded', 'true');
    try { renderAccList((await call(api.accounts.list)).list); } catch { /* sin lista: solo se ven las acciones */ }
  }
  async function switchToAccount(id) {
    closeAccMenu();
    try {
      const d = await call(api.accounts.switchTo, id);
      state.account = d.active;
      renderAccount();
      refreshSelected();
      toast('Ahora juegas como ' + d.active.name);
    } catch (e) { toast(e.message, 'error'); }
  }
  function startAddAccount() {
    closeAccMenu();
    showGateError('');
    state.adding = true;
    renderAccount();
  }
  function cancelAddAccount() {
    state.adding = false;
    showGateError('');
    renderAccount();
  }
  async function signOut() {
    closeAccMenu();
    try {
      const next = await call(api.logout);
      state.account = next;
      state.adding = false;
      showView('home');
      renderAccount();
      if (next) { refreshSelected(); toast('Sesión cerrada. Ahora juegas como ' + next.name); }
    } catch (e) { toast(e.message, 'error'); }
  }

  // ───────── packs ─────────
  const hueOf = (id) => { if (/atenas/i.test(String(id))) return 268; let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const statusInfo = (s) => !s ? { key: 'loading', text: 'Comprobando…' } : s.offline ? { key: 'offline', text: 'Sin internet' } : s.status === 'update' ? { key: 'update', text: 'Actualización' } : s.status === 'not-installed' ? { key: 'new', text: 'Sin instalar' } : { key: 'ok', text: 'Al día' };


  const artOf = (p, s) => window.AtenasArt.cover({
    id: p.id, name: (s && s.name) || p.name, minecraft: (s && s.minecraft) || p.minecraft,
    loader: (s && s.loader) || (p.loader && p.loader.type) || '', image: (s && s.image) || p.image,
  });

  // Fila de versiones en Inicio: una tarjeta con ilustración por modpack
  function renderVersions() {
    const row = $('verRow');
    if (!row) return;
    row.replaceChildren();
    $('verCount').textContent = state.packs.length ? `${state.packs.length} disponible${state.packs.length === 1 ? '' : 's'}` : '';
    state.packs.forEach((p) => {
      const s = state.summaries[p.id];
      const st = statusInfo(s);
      const name = (s && s.name) || p.name || p.id;
      const art = el('div', { class: 'ver-art' }, el('span', { class: 'ver-status', 'data-k': st.key, text: st.text }));
      art.style.setProperty('--art', `url("${artOf(p, s)}")`);
      const card = el('button', {
        class: 'ver-card', type: 'button', 'aria-pressed': String(p.id === state.selected), title: name,
        onclick: () => selectPack(p.id),
      }, art, el('div', { class: 'ver-body' },
        el('b', { text: name }),
        el('span', { class: 'muted', text: `Minecraft ${(s && s.minecraft) || p.minecraft || '—'}` + (s && s.modCount ? ` · ${s.modCount} mods` : '') })));
      row.append(card);
    });
  }

  function renderPacks() {
    const cur = state.packs.find((p) => p.id === state.selected);
    const s = state.summaries[state.selected];
    $('psName').textContent = (s && s.name) || (cur && cur.name) || 'Elegir versión';
    const ico = $('psIco');
    ico.style.setProperty('--h', String(hueOf(state.selected || 'a')));
    if (cur) {
      // el icono es la ilustración del propio pack (la misma de su tarjeta), no una letra
      ico.textContent = '';
      ico.style.setProperty('--ico', `url("${artOf(cur, s)}")`);
      ico.classList.add('has-art');
    } else {
      ico.textContent = modInitial('A');
      ico.classList.remove('has-art');
    }
    const flag = $('psFlag');
    const upd = state.packs.some((p) => (state.summaries[p.id] || {}).status === 'update');
    flag.hidden = !upd;
    flag.title = 'Hay una actualización disponible';
    $('packSelect').disabled = state.packs.length === 0;
    $('packSelect').dataset.single = state.packs.length === 1 ? '1' : '';
    renderVersions();
    if (!$('picker').hidden) renderPicker();
  }

  // Selector tipo galería: una tarjeta por modpack con su estado, versión y tiempo jugado
  function renderPicker() {
    const grid = $('pickerGrid');
    grid.replaceChildren();
    $('picker').dataset.few = state.packs.length <= 2 ? String(state.packs.length) : '';
    state.packs.forEach((p, i) => {
      const s = state.summaries[p.id];
      const st = statusInfo(s);
      const name = (s && s.name) || p.name || p.id;
      const desc = (s && s.description) || p.description || '';
      const loader = s ? String(s.loader || 'vanilla').split(' ')[0] : '';
      const tags = [];
      tags.push(el('span', { class: 'pk-tag', text: 'Minecraft ' + ((s && s.minecraft) || p.minecraft || '—') }));
      if (loader) tags.push(el('span', { class: 'pk-tag', text: loader.charAt(0).toUpperCase() + loader.slice(1) }));
      if (s && s.modCount) tags.push(el('span', { class: 'pk-tag', text: `${s.modCount} mods` }));
      const played = (state.settings.playtime || {})[p.id];
      const cover = el('div', { class: 'pk-cover' },
        el('span', { class: 'pk-status', 'data-k': st.key, text: st.text }),
        p.id === state.selected ? el('span', { class: 'pk-check', 'aria-hidden': 'true', text: '✓' }) : null);
      cover.style.setProperty('--h', String(hueOf(p.id)));
      cover.style.setProperty('--art', `url("${artOf(p, s)}")`);
      const card = el('button', {
        class: 'pk-card', type: 'button', 'aria-pressed': String(p.id === state.selected),
        onclick: () => { closePicker(); selectPack(p.id); },
      },
        cover,
        el('div', { class: 'pk-body' },
          el('h4', { text: name }),
          el('p', { class: 'pk-desc', text: desc || 'Modpack de Atenas.' }),
          el('div', { class: 'pk-tags' }, ...tags),
          el('div', { class: 'pk-foot' },
            el('span', { class: 'muted', text: played ? 'Jugado ' + fmtTime(played) : (p.server || (s && s.server) ? 'Con servidor propio' : 'Sin jugar aún') }),
            el('span', { class: 'pk-cta', text: p.id === state.selected ? 'Elegido' : 'Elegir' }))));
      card.style.setProperty('--i', String(Math.min(i, 8)));
      grid.append(card);
    });
  }
  function openPicker() {
    if (!state.packs.length) return;
    renderPicker();
    $('picker').hidden = false;
    const sel = $('pickerGrid').querySelector('[aria-pressed="true"]') || $('pickerGrid').firstElementChild;
    if (sel) sel.focus();
  }
  function closePicker() { $('picker').hidden = true; $('packSelect').focus(); }

  async function selectPack(id) {
    if (state.busy || id === state.selected) return;
    state.selected = id;
    await call(api.setSettings, { selectedPack: id }).catch(() => {});
    renderPacks();
    await refreshSelected();
  }

  async function refreshSelected(force = true) {
    const id = state.selected;
    if (!id) return;
    if (force) setStatusLoading();
    try {
      state.summaries[id] = await call(api.checkPack, id);
    } catch (e) {
      showEmpty({
        title: e.code === 'NO_MANIFEST' ? 'Modpack sin publicar' : e.code === 'NO_RELEASE' ? 'Cliente sin publicar' : e.code === 'NO_CONNECTION' ? 'Sin conexión' : 'No se pudo cargar el modpack',
        text: e.message,
        retry: true,
      });
      if (state.view === 'mods') renderMods();
      if (state.view === 'news') renderNews();
      return;
    }
    state.lastError = '';
    renderPacks();
    renderSelected();
    updateNewsDot();
    if (state.view === 'mods') renderMods();
    if (state.view === 'news') renderNews();
  }

  function showEmpty({ loading = false, title = '', text = '', retry = false }) {
    state.lastError = loading ? '' : text;
    $('hero').hidden = true;
    $('changes').hidden = true;
    $('dock').hidden = true;
    $('empty').hidden = false;
    $('spinner').classList.toggle('off', !loading);
    $('emptyIco').hidden = loading;
    $('emptyTitle').hidden = !title;
    $('emptyTitle').textContent = title;
    $('emptyText').textContent = text;
    $('emptyActions').hidden = !retry;
    stopServerPoll();
  }

  function setStatusLoading() {
    const st = $('packStatus');
    st.textContent = 'Buscando actualizaciones…';
    st.dataset.state = 'not-installed';
  }

  function renderSelected() {
    const s = state.summaries[state.selected];
    if (!s) return;
    $('empty').hidden = true;
    $('hero').hidden = false;
    $('dock').hidden = false;

    { const pk = state.packs.find((x) => x.id === s.packId) || { id: s.packId }; $('packArt').style.setProperty('--art', `url("${artOf(pk, s)}")`); $('artBadge').textContent = `Minecraft ${s.minecraft}`; }
    $('packMeta').textContent = s.server ? `Servidor · ${s.server}` : 'Modpack';
    $('packName').textContent = s.name;
    $('packDesc').textContent = s.description;
    $('packDesc').hidden = !s.description;

    $('stMc').textContent = s.minecraft;
    const loaderName = String(s.loader || 'vanilla').split(' ')[0];
    $('stLoader').textContent = loaderName.charAt(0).toUpperCase() + loaderName.slice(1);
    $('stLoader').title = s.loader;
    countUp($('stMods'), s.modCount);
    $('stPlay').textContent = fmtTime((state.settings.playtime || {})[s.packId]);
    $('qIp').hidden = !s.server;
    $('qDiscord').hidden = !state.links.discord;
    $('qWeb').hidden = !state.links.web;
    setupServerCard(s);

    const st = $('packStatus');
    st.dataset.state = s.offline ? 'offline' : s.status;
    st.textContent =
      s.offline ? `Sin internet · se jugará con la versión ${s.localVersion}` :
      s.status === 'not-installed' ? `Sin instalar · versión ${s.remoteVersion}` :
      s.status === 'update' ? `Actualización disponible · ${s.localVersion} → ${s.remoteVersion}` :
      `Al día · versión ${s.localVersion}`;

    renderChanges(s);

    const needs = s.status === 'update';
    const play = $('btnPlay');
    play.dataset.mode = needs ? 'update' : '';
    $('playLabel').textContent = s.status === 'not-installed' ? 'Instalar y jugar' : needs ? 'Actualizar y jugar' : 'Jugar';
    const withOf = s.packId === 'atenas-client' && state.settings.optifine !== false;
    const base = s.packId === 'atenas-client' ? `Atenas Client ${s.minecraft}${withOf ? ' con OptiFine' : ''}` : (s.server ? 'Entra directo al servidor' : '');
    $('playSub').textContent = (s.status === 'not-installed' || needs) ? `Descarga ${fmtBytes(s.bytes)}${base ? ' · ' + base : ''}` : base;
    const upd = $('btnUpdate');
    upd.hidden = !needs;
    upd.title = `Descarga ${fmtBytes(s.bytes)} sin abrir el juego`;

    const note = $('note');
    const offlineAcc = state.account && state.account.kind === 'offline';
    note.hidden = !(offlineAcc && s.server);
    note.textContent = offlineAcc && s.server
      ? 'Con cuenta sin conexión solo puedes entrar a servidores que permitan cuentas no premium.'
      : '';
    setBusy(state.busy);
  }

  function renderChanges(s) {
    const box = $('changes');
    box.replaceChildren();
    box.className = 'changes';
    const hasDiff = s.add.length + s.change.length + s.remove.length > 0;
    if (s.status === 'update' && hasDiff) {
      box.classList.add('is-update');
      box.append(el('h3', { text: `Qué cambia en la versión ${s.remoteVersion}` }));
      if (s.add.length) box.append(el('div', { class: 'chg add' }, el('b', { text: `Nuevos (${s.add.length})` }), el('span', { text: listText(s.add) })));
      if (s.change.length) box.append(el('div', { class: 'chg chg-mod' }, el('b', { text: `Actualizados (${s.change.length})` }), el('span', { text: listText(s.change) })));
      if (s.remove.length) box.append(el('div', { class: 'chg del' }, el('b', { text: `Quitados (${s.remove.length})` }), el('span', { text: listText(s.remove) })));
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  // ───────── estado del servidor ─────────
  let serverTimer = null;
  let serverFor = null;
  function stopServerPoll() { clearInterval(serverTimer); serverTimer = null; serverFor = null; $('serverCard').hidden = true; }

  function setupServerCard(s) {
    const card = $('serverCard');
    if (!s.server) { stopServerPoll(); return; }
    card.hidden = false;
    $('scTitle').textContent = 'Servidor';
    $('scIpText').textContent = s.server;
    if (serverFor === s.server) return;
    serverFor = s.server;
    clearInterval(serverTimer);
    refreshServer();
    serverTimer = setInterval(() => { if (state.view === 'home' && !state.playing && !document.hidden) refreshServer(); }, 30000);
  }

  async function refreshServer() {
    const s = state.summaries[state.selected];
    if (!s || !s.server) return;
    const dot = $('scState');
    const btn = $('scRefresh');
    dot.dataset.state = 'loading';
    btn.classList.add('spin');
    let r = null;
    try { r = await call(api.serverStatus, s.server); } catch { r = { online: false }; }
    btn.classList.remove('spin');
    if (serverFor !== s.server) return;
    dot.dataset.state = r.online ? 'online' : 'offline';
    $('scMotd').textContent = r.online ? (r.motd || r.version || 'Servidor en línea') : 'Servidor apagado o sin respuesta';
    $('scPlayers').textContent = r.online ? `${r.players.online}/${r.players.max}` : '—';
    $('scPing').textContent = r.online ? `${r.latency} ms` : '—';
    $('scBar').style.width = r.online && r.players.max ? `${Math.min(100, Math.round((r.players.online / r.players.max) * 100))}%` : '0%';
    const names = $('scNames');
    names.replaceChildren();
    if (r.online) for (const n of r.players.names) names.append(el('span', { text: n }));
  }

  // ───────── mods ─────────
  function modInitial(name) {
    const m = /[A-Za-z0-9]/.exec(name);
    return m ? m[0].toUpperCase() : '·';
  }

  function renderMods() {
    const s = state.summaries[state.selected];
    const grid = $('modsGrid');
    grid.replaceChildren();
    if (!s) {
      $('modsSub').textContent = state.lastError || 'Todavía no hay datos del modpack.';
      $('modsEmpty').hidden = true;
      return;
    }
    const q = $('modSearch').value.trim().toLowerCase();
    const mods = (s.mods || []).filter((m) => !q || m.name.toLowerCase().includes(q));
    $('modsSub').textContent = `${s.name} · ${s.modCount} mods`;
    $('modsEmpty').hidden = mods.length > 0;
    const frag = document.createDocumentFragment();
    mods.forEach((m, i) => {
      const card = el('div', { class: 'mod-card' },
        el('div', { class: 'mod-ico', text: modInitial(m.name) }),
        el('div', { class: 'mod-name', title: m.name },
          el('span', { text: m.name }),
          el('span', { class: 'mod-size', text: fmtBytes(m.size) })),
      );
      // retraso escalonado sin estilos en línea (CSP): solo los primeros
      if (i < 24) card.style.animationDelay = `${i * 18}ms`;
      frag.append(card);
    });
    grid.append(frag);
  }

  // ───────── novedades ─────────
  function newsKey(s) { return `${s.packId}@${s.remoteVersion}`; }
  function updateNewsDot() {
    const s = state.summaries[state.selected];
    $('newsDot').hidden = !s || !s.changelog || state.seenNews[newsKey(s)] === true;
  }
  function markNewsSeen() {
    const s = state.summaries[state.selected];
    if (!s) return;
    state.seenNews[newsKey(s)] = true;
    call(api.setSettings, { seenNews: state.seenNews }).catch(() => {});
    updateNewsDot();
  }
  function renderNews() {
    const s = state.summaries[state.selected];
    const body = $('newsBody');
    body.replaceChildren();
    if (!s) { body.append(el('p', { class: 'empty-line', text: state.lastError || 'Sin datos todavía.' })); return; }
    $('newsSub').textContent = s.name;
    const card = el('div', { class: 'news-card' },
      el('h4', {}, el('span', { text: `Versión ${s.remoteVersion}` }), el('span', { class: s.status === 'update' ? 'tag new' : 'tag', text: s.status === 'update' ? 'Nueva' : 'Actual' })),
      el('p', { text: s.changelog || 'Sin notas para esta versión.' }),
    );
    body.append(card);
  }

  // ───────── jugar / actualizar ─────────
  function setBusy(b) {
    state.busy = b;
    $('btnPlay').disabled = b;
    $('btnUpdate').disabled = b;
  }

  function showProgress(text, ratio) {
    $('progress').hidden = false;
    const bar = document.querySelector('.bar');
    if (ratio == null) {
      bar.classList.add('indeterminate');
      $('barFill').style.width = '';
      $('progressPct').textContent = '';
    } else {
      bar.classList.remove('indeterminate');
      const pct = Math.round(Math.min(1, ratio) * 100);
      $('barFill').style.width = `${pct}%`;
      $('progressPct').textContent = `${pct}%`;
    }
    $('progressText').textContent = text;
  }
  const hideProgress = () => { $('progress').hidden = true; };

  async function doUpdateOnly() {
    if (state.busy) return;
    setBusy(true);
    showProgress('Preparando descarga…', null);
    try {
      state.summaries[state.selected] = await call(api.updatePack, state.selected);
      toast('Mods actualizados');
    } catch (e) {
      toast(e.message, 'error', 9000);
    } finally {
      hideProgress();
      setBusy(false);
      renderPacks();
      renderSelected();
      updateNewsDot();
    }
  }

  async function doPlay() {
    if (state.busy) return;
    if (!state.account) { renderAccount(); return; }
    clearLog();
    setBusy(true);
    showProgress('Iniciando…', null);
    try {
      await call(api.play, state.selected);
    } catch (e) {
      setBusy(false);
      hideProgress();
      if (e.code === 'NEED_LOGIN') {
        state.account = null;
        renderAccount();
        showGateError('Tu sesión caducó. Vuelve a iniciar sesión.');
      } else {
        toast(e.message, 'error', 9000);
      }
    }
  }

  function onGameState(ev) {
    switch (ev.state) {
      case 'preparing':
      case 'updating':
        showProgress(ev.message, null);
        break;
      case 'running':
        state.playing = true;
        fx.setPaused(true);
        showProgress('Minecraft se está ejecutando', null);
        break;
      case 'closed':
        state.playing = false;
        if (ev.playtime) state.settings.playtime = ev.playtime;
        fx.setPaused(false);
        hideProgress();
        setBusy(false);
        if (ev.code && ev.code !== 0) toast(ev.message, 'error', 9000);
        refreshSelected(false);
        break;
      case 'error':
        state.playing = false;
        fx.setPaused(false);
        hideProgress();
        setBusy(false);
        toast(ev.message, 'error', 12000);
        appendLog('ERROR: ' + ev.message);
        break;
    }
  }

  let lastProgressPaint = 0;
  function onProgress(p) {
    if (p.packId !== state.selected && !state.busy) return;
    const now = performance.now();
    if (now - lastProgressPaint < 80 && p.filesDone < p.filesTotal) return; // no saturar el DOM
    lastProgressPaint = now;
    const ratio = p.totalBytes > 0 ? p.doneBytes / p.totalBytes : null;
    showProgress(`${p.filesDone}/${p.filesTotal} archivos · ${fmtBytes(p.doneBytes)} de ${fmtBytes(p.totalBytes)}`, ratio);
  }

  // ───────── registro ─────────
  const logLines = [];
  let logTimer = null;
  function appendLog(line) {
    logLines.push(line);
    if (logLines.length > 500) logLines.shift();
    if ($('logModal').hidden || logTimer) return;
    logTimer = setTimeout(() => { logTimer = null; paintLog(); }, 200);
  }
  function paintLog() {
    const pre = $('log');
    pre.textContent = logLines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  }
  function clearLog() {
    logLines.length = 0;
    $('log').textContent = $('logModal').hidden ? '' : LOG_EMPTY;
  }
  const LOG_EMPTY = 'El registro aparecerá aquí cuando juegues.';
  function openLog() {
    $('logModal').hidden = false;
    $('btnLog').setAttribute('aria-expanded', 'true');
    if (logLines.length) paintLog(); else $('log').textContent = LOG_EMPTY;
  }
  function closeLog() {
    $('logModal').hidden = true;
    $('btnLog').setAttribute('aria-expanded', 'false');
  }
  function toggleLog() { if ($('logModal').hidden) openLog(); else closeLog(); }

  // ───────── ajustes ─────────
  function loadSettingsView() {
    const max = Math.max(2048, Math.min(16384, Math.floor((state.totalRamMb - 1536) / 512) * 512));
    const range = $('ramRange');
    range.max = String(max);
    refreshRam();
    const sh = { resourcepacks: true, screenshots: true, logs: true, saves: true, servers: true, options: true, config: false, ...(state.settings.shareFolders || {}) };
    $('shResourcepacks').checked = sh.resourcepacks; $('shScreenshots').checked = sh.screenshots; $('shSaves').checked = sh.saves; $('shOptions').checked = sh.options; $('shServers').checked = sh.servers; $('shLogs').checked = sh.logs; $('shConfig').checked = sh.config;
    $('optJvm').checked = state.settings.jvmOptimized !== false;
    $('optMin').checked = state.settings.minimizeOnPlay !== false;
    $('optFx').checked = state.settings.fx !== false;
    $('optNotify').checked = state.settings.notify !== false;
    $('optOptifine').checked = state.settings.optifine !== false;
    $('optFullscreen').checked = state.settings.fullscreen === true;
    $('optAutoStart').checked = state.settings.autoStart === true;
    $('optHud').checked = state.settings.hud !== false;
    $('extraJvm').value = state.settings.extraJvm || '';
    document.querySelectorAll('.theme').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === (state.settings.theme || 'atenas'))));
    $('appVersion').textContent = `Atenas Client ${state.appVersion}`;
  }
  // La RAM es por modpack: si el jugador no la tocó, se usa la que puso el creador en el pack.json.
  async function refreshRam() {
    const id = state.selected;
    const range = $('ramRange');
    const info = id ? await call(api.ramInfo, id).catch(() => null) : null;
    const packMb = info && info.packMb, userMb = info && info.userMb;
    const max = Number(range.max) || 8192;
    range.value = String(Math.min(userMb || packMb || 4096, max));
    updateRamLabel();
    const pk = (state.packs.find((p) => p.id === id) || {}).name || 'este modpack';
    const gb = (mb) => (mb / 1024).toFixed(1).replace('.0', '') + ' GB';
    $('ramHint').textContent = `Tu PC tiene ${(state.totalRamMb / 1024).toFixed(0)} GB. ` + (userMb
      ? `Para ${pk} elegiste ${gb(userMb)}` + (packMb ? ` (el modpack recomienda ${gb(packMb)}).` : '.')
      : packMb ? `${pk} usa los ${gb(packMb)} que definió su creador; muévelo solo si quieres otra cantidad.` : `${pk} no define RAM; se usan ${gb(4096)}.`);
    $('ramReset').hidden = !userMb || !packMb;
  }
  function updateRamLabel() {
    $('ramValue').textContent = `${(Number($('ramRange').value) / 1024).toFixed(1)} GB`;
  }
  async function patchSettings(patch) {
    state.settings = await call(api.setSettings, patch).catch(() => state.settings);
  }
  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme || 'atenas';
    document.documentElement.dataset.hud = state.settings.hud === false ? 'off' : 'on';
    fx.refreshColors();
  }
  function applyFx() {
    const on = state.settings.fx !== false;
    document.body.classList.toggle('no-fx', !on);
    fx.setEnabled(on);
  }

  // ───────── partículas (ligeras, se pausan solas) ─────────
  const fx = (() => {
    const cv = $('fx');
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, parts = [], raf = 0, enabled = true, paused = false;
    let COLORS = ['167,139,250', '236,72,153', '34,211,238'];
    function refreshColors() {
      const cs = getComputedStyle(document.documentElement);
      const pick = (n) => cs.getPropertyValue(n).replace(/\s/g, '');
      const c = [pick('--acc-hi'), pick('--acc-3'), pick('--acc')].filter(Boolean);
      if (c.length) COLORS = c;
      parts.forEach((p) => { p.c = COLORS[(Math.random() * COLORS.length) | 0]; });
    }

    function resize() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
      const n = Math.round(Math.min(46, Math.max(18, (w * h) / 32000)));
      parts = Array.from({ length: n }, () => spawn(true));
    }
    function spawn(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 10,
        s: 2 + Math.random() * 4,
        v: 0.12 + Math.random() * 0.4,
        d: (Math.random() - 0.5) * 0.2,
        a: 0.12 + Math.random() * 0.4,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        r: Math.random() * Math.PI,
        rv: (Math.random() - 0.5) * 0.01,
      };
    }
    function frame() {
      raf = 0;
      if (!enabled || paused || document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.v; p.x += p.d; p.r += p.rv;
        if (p.y < -12) Object.assign(p, spawn(false), { x: Math.random() * w });
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = `rgba(${p.c},${p.a})`;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf && enabled && !paused && !reduceMotion && !document.hidden) raf = requestAnimationFrame(frame); }
    window.addEventListener('resize', () => { resize(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
    resize();
    start();
    return {
      setPaused(p) { paused = p; if (p) ctx.clearRect(0, 0, w, h); else start(); },
      refreshColors,
      setEnabled(e) { enabled = e; if (!e) ctx.clearRect(0, 0, w, h); else start(); },
    };
  })();

  // ───────── arranque ─────────
  async function boot() {
    $('btnMicrosoft').addEventListener('click', loginMicrosoft);
    $('offlineForm').addEventListener('submit', loginOffline);
    $('btnPlay').addEventListener('click', doPlay);
    $('btnUpdate').addEventListener('click', doUpdateOnly);
    $('btnLog').addEventListener('click', toggleLog);
    $('btnSwitch').addEventListener('click', startAddAccount);
    $('btnRetry').addEventListener('click', () => (state.packs.length ? refreshSelected() : loadPacks()));
    $('btnToSettings').addEventListener('click', () => showView('settings'));
    $('qIp').addEventListener('click', () => { const s = state.summaries[state.selected]; if (s && s.server) copyText(s.server, 'IP copiada'); });
    $('scIp').addEventListener('click', () => { const s = state.summaries[state.selected]; if (s && s.server) copyText(s.server, 'IP copiada'); });
    $('scRefresh').addEventListener('click', refreshServer);
    $('qShots').addEventListener('click', () => state.selected && call(api.openFolder, state.selected, 'screenshots').catch((e) => toast(e.message, 'error')));
    $('qRepair').addEventListener('click', repairPack);
    $('btnRepair2').addEventListener('click', () => { showView('home'); repairPack(); });
    $('btnFolder2').addEventListener('click', () => state.selected && call(api.openFolder, state.selected).catch((e) => toast(e.message, 'error')));
    $('qDiscord').addEventListener('click', () => call(api.openLink, 'discord').catch((e) => toast(e.message, 'error')));
    $('qWeb').addEventListener('click', () => call(api.openLink, 'web').catch((e) => toast(e.message, 'error')));
    $('optNotify').addEventListener('change', (e) => patchSettings({ notify: e.target.checked }));
    document.querySelectorAll('.theme').forEach((b) => b.addEventListener('click', async () => {
      await patchSettings({ theme: b.dataset.theme });
      applyTheme();
      document.querySelectorAll('.theme').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    $('account').addEventListener('click', () => { if (accMenuOpen()) closeAccMenu(); else openAccMenu(); });
    $('account').setAttribute('aria-haspopup', 'menu');
    $('account').setAttribute('aria-expanded', 'false');
    $('amAdd').addEventListener('click', startAddAccount);
    $('amSettings').addEventListener('click', () => { closeAccMenu(); showView('settings'); });
    $('amLogout').addEventListener('click', signOut);
    $('gateCancel').addEventListener('click', cancelAddAccount);
    document.addEventListener('pointerdown', (e) => { if (accMenuOpen() && !e.target.closest('#accMenu, #account')) closeAccMenu(); });
    window.addEventListener('resize', () => { if (accMenuOpen()) placeAccMenu(); });
    $('logClose').addEventListener('click', closeLog);
    $('logClear').addEventListener('click', clearLog);
    $('logCopy').addEventListener('click', () => { if (logLines.length) copyText(logLines.join('\n'), 'Registro copiado'); else toast('Todavía no hay nada que copiar'); });
    $('logModal').addEventListener('pointerdown', (e) => { if (e.target === $('logModal')) closeLog(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (accMenuOpen()) closeAccMenu();
      else if (!$('logModal').hidden) closeLog();
      else if (state.adding) cancelAddAccount();
    });
    $('btnFolder').addEventListener('click', () => state.selected && call(api.openFolder, state.selected).catch((e) => toast(e.message, 'error')));
    $('modSearch').addEventListener('input', renderMods);
    $('ramRange').addEventListener('input', updateRamLabel);
    $('ramRange').addEventListener('change', async () => { if (state.selected) await patchSettings({ ramPack: { id: state.selected, mb: Number($('ramRange').value) } }); refreshRam(); });
    $('ramReset').addEventListener('click', async () => { await patchSettings({ ramPack: { id: state.selected, mb: null } }); refreshRam(); toast('Vuelve a usar la RAM del modpack'); });
    for (const [id, k] of [['shResourcepacks', 'resourcepacks'], ['shScreenshots', 'screenshots'], ['shSaves', 'saves'], ['shOptions', 'options'], ['shServers', 'servers'], ['shLogs', 'logs'], ['shConfig', 'config']]) $(id).addEventListener('change', (e) => patchSettings({ shareFolders: { [k]: e.target.checked } }));
    $('optJvm').addEventListener('change', (e) => patchSettings({ jvmOptimized: e.target.checked }));
    $('optMin').addEventListener('change', (e) => patchSettings({ minimizeOnPlay: e.target.checked }));
    $('optFx').addEventListener('change', async (e) => { await patchSettings({ fx: e.target.checked }); applyFx(); });
    $('optOptifine').addEventListener('change', async (e) => { await patchSettings({ optifine: e.target.checked }); renderSelected(); });
    $('optFullscreen').addEventListener('change', (e) => patchSettings({ fullscreen: e.target.checked }));
    $('optAutoStart').addEventListener('change', (e) => patchSettings({ autoStart: e.target.checked }));
    $('optHud').addEventListener('change', async (e) => { await patchSettings({ hud: e.target.checked }); applyTheme(); });
    $('extraJvm').addEventListener('change', async (e) => { await patchSettings({ extraJvm: e.target.value }); e.target.value = state.settings.extraJvm || ''; toast('Argumentos guardados'); });
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('packSelect').addEventListener('click', openPicker);
    $('pickerClose').addEventListener('click', closePicker);
    $('picker').addEventListener('pointerdown', (e) => { if (e.target === $('picker')) closePicker(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('picker').hidden) closePicker(); });
    $('hfOpen').addEventListener('click', () => showView('friends'));
    $('winMin').addEventListener('click', () => api.win.minimize());
    $('winMax').addEventListener('click', () => api.win.maximize());
    $('winClose').addEventListener('click', () => api.win.close());

    api.onGameState(onGameState);
    // el juego agregó o quitó una cuenta (pantalla Cuentas del cliente): se actualiza el nombre de arriba y la lista
    api.onAccountChanged((d) => {
      state.account = d.active || null;
      state.adding = false;
      renderAccount();
      if (state.account) refreshSelected();
      if (accMenuOpen()) closeAccMenu();
    });
    api.onGameLog(appendLog);
    api.onProgress(onProgress);
    api.onUpdateAvailable((s) => {
      state.summaries[s.packId] = s;
      renderPacks();
      if (s.packId === state.selected && !state.busy) renderSelected();
      updateNewsDot();
      toast(`Hay una actualización de mods en ${s.name} (versión ${s.remoteVersion})`);
    });

    const init = await call(api.init);
    state.account = init.account;
    state.settings = init.settings;
    state.seenNews = init.settings.seenNews || {};
    state.links = init.links || {};
    state.totalRamMb = init.totalRamMb;
    state.appVersion = init.version;
    $('tbTitle').textContent = init.launcherName || 'Atenas Client';
    applyFx();
    renderAccount();

    applyTheme();
    await loadPacks();
  }

  async function loadPacks() {
    showEmpty({ loading: true, text: 'Cargando modpacks…' });
    try {
      const { packs, offline } = await call(api.listPacks);
      state.packs = packs;
      if (offline) toast('Sin internet: se muestran los packs guardados');
    } catch (e) {
      showEmpty({ title: 'No se pudo cargar la lista', text: e.message, retry: true });
      return;
    }
    if (!state.packs.length) {
      showEmpty({ title: 'Aún no hay modpacks', text: 'Pídele al administrador que publique uno.', retry: true });
      return;
    }
    state.selected = state.packs.some((p) => p.id === state.settings.selectedPack)
      ? state.settings.selectedPack
      : state.packs[0].id;
    renderPacks();
    const firstTime = !state.packs.some((p) => p.id === state.settings.selectedPack) && state.packs.length > 1 && !!state.account;
    await refreshSelected();
    for (const p of state.packs) {
      if (p.id === state.selected) continue;
      call(api.checkPack, p.id).then((s) => { state.summaries[p.id] = s; renderPacks(); }).catch(() => {});
    }
    if (firstTime) openPicker();
  }

  async function repairPack() {
    if (state.busy || !state.selected) return;
    setBusy(true);
    showProgress('Verificando archivos…', null);
    try {
      state.summaries[state.selected] = await call(api.repairPack, state.selected);
      toast('Instalación verificada y reparada');
    } catch (e) {
      toast(e.message, 'error', 9000);
    } finally {
      hideProgress();
      setBusy(false);
      renderPacks();
      renderSelected();
    }
  }

  boot().catch((e) => {
    showEmpty({ title: 'No se pudo iniciar', text: e.message, retry: true });
  });
})();
