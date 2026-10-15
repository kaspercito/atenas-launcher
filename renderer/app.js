'use strict';
(() => {
  const api = window.atenas;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    account: null,
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
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('.nav-btn').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
    if (name === 'mods') renderMods();
    if (name === 'news') { renderNews(); markNewsSeen(); }
    if (name === 'settings') loadSettingsView();
  }

  // ───────── cuenta ─────────
  function renderAccount() {
    const a = state.account;
    $('accName').textContent = a ? a.name : 'Sin sesión';
    $('accKind').textContent = a ? (a.kind === 'offline' ? 'No premium' : 'Microsoft') : '';
    $('avatar').textContent = a ? a.name.slice(0, 1).toUpperCase() : '?';
    $('gate').hidden = !!a;
    if (!a) $('offlineName').focus();
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
      renderAccount();
      refreshSelected();
    } catch (e) {
      showGateError(e.message);
    }
  }

  async function switchAccount() {
    await call(api.logout);
    state.account = null;
    showView('home');
    renderAccount();
  }

  // ───────── packs ─────────
  function renderPacks() {
    const nav = $('packs');
    nav.replaceChildren();
    for (const p of state.packs) {
      const s = state.summaries[p.id];
      const tab = el('button', {
        class: 'pack-tab',
        role: 'tab',
        'aria-selected': String(p.id === state.selected),
        onclick: () => selectPack(p.id),
      }, el('span', { text: (s && s.name) || p.name || p.id }));
      if (s && s.status === 'update') tab.append(el('i', { class: 'badge', title: 'Hay una actualización' }));
      nav.append(tab);
    }
  }

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
        title: e.code === 'NO_MANIFEST' ? 'Modpack sin publicar' : e.code === 'NO_CONNECTION' ? 'Sin conexión' : 'No se pudo cargar el modpack',
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
    $('playSub').textContent = s.status === 'not-installed' ? `Descarga ${fmtBytes(s.bytes)}` : needs ? `Descarga ${fmtBytes(s.bytes)}` : (s.server ? 'Entra directo al servidor' : '');
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
    if ($('log').hidden || logTimer) return;
    logTimer = setTimeout(() => { logTimer = null; paintLog(); }, 200);
  }
  function paintLog() {
    const pre = $('log');
    pre.textContent = logLines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  }
  function clearLog() {
    logLines.length = 0;
    $('log').textContent = '';
  }
  function toggleLog() {
    const pre = $('log');
    pre.hidden = !pre.hidden;
    $('btnLog').setAttribute('aria-expanded', String(!pre.hidden));
    if (!pre.hidden) {
      if (logLines.length) paintLog();
      else pre.textContent = 'El registro aparecerá aquí cuando juegues.';
    }
  }

  // ───────── ajustes ─────────
  function loadSettingsView() {
    const max = Math.max(2048, Math.min(16384, Math.floor((state.totalRamMb - 1536) / 512) * 512));
    const range = $('ramRange');
    range.max = String(max);
    range.value = String(Math.min(state.settings.ramMb || 4096, max));
    updateRamLabel();
    $('ramHint').textContent = `Tu PC tiene ${(state.totalRamMb / 1024).toFixed(0)} GB. Para este tipo de modpack, 6 a 8 GB va muy bien; más no siempre es mejor.`;
    $('optJvm').checked = state.settings.jvmOptimized !== false;
    $('optMin').checked = state.settings.minimizeOnPlay !== false;
    $('optFx').checked = state.settings.fx !== false;
    $('optNotify').checked = state.settings.notify !== false;
    $('optFullscreen').checked = state.settings.fullscreen === true;
    $('optAutoStart').checked = state.settings.autoStart === true;
    $('optHud').checked = state.settings.hud !== false;
    $('extraJvm').value = state.settings.extraJvm || '';
    document.querySelectorAll('.theme').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === (state.settings.theme || 'cyber'))));
    $('appVersion').textContent = `Atenas Client ${state.appVersion}`;
  }
  function updateRamLabel() {
    $('ramValue').textContent = `${(Number($('ramRange').value) / 1024).toFixed(1)} GB`;
  }
  async function patchSettings(patch) {
    state.settings = await call(api.setSettings, patch).catch(() => state.settings);
  }
  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme || 'cyber';
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
    $('btnSwitch').addEventListener('click', switchAccount);
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
    $('account').addEventListener('click', () => showView('settings'));
    $('btnFolder').addEventListener('click', () => state.selected && call(api.openFolder, state.selected).catch((e) => toast(e.message, 'error')));
    $('modSearch').addEventListener('input', renderMods);
    $('ramRange').addEventListener('input', updateRamLabel);
    $('ramRange').addEventListener('change', () => patchSettings({ ramMb: Number($('ramRange').value) }));
    $('optJvm').addEventListener('change', (e) => patchSettings({ jvmOptimized: e.target.checked }));
    $('optMin').addEventListener('change', (e) => patchSettings({ minimizeOnPlay: e.target.checked }));
    $('optFx').addEventListener('change', async (e) => { await patchSettings({ fx: e.target.checked }); applyFx(); });
    $('optFullscreen').addEventListener('change', (e) => patchSettings({ fullscreen: e.target.checked }));
    $('optAutoStart').addEventListener('change', (e) => patchSettings({ autoStart: e.target.checked }));
    $('optHud').addEventListener('change', async (e) => { await patchSettings({ hud: e.target.checked }); applyTheme(); });
    $('extraJvm').addEventListener('change', async (e) => { await patchSettings({ extraJvm: e.target.value }); e.target.value = state.settings.extraJvm || ''; toast('Argumentos guardados'); });
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('winMin').addEventListener('click', () => api.win.minimize());
    $('winMax').addEventListener('click', () => api.win.maximize());
    $('winClose').addEventListener('click', () => api.win.close());

    api.onGameState(onGameState);
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
    await refreshSelected();
    for (const p of state.packs) {
      if (p.id === state.selected) continue;
      call(api.checkPack, p.id).then((s) => { state.summaries[p.id] = s; renderPacks(); }).catch(() => {});
    }
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
