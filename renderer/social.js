'use strict';
// Amigos, solicitudes y chat del launcher. Habla con el proceso principal (src/lib/social.js → servicio en Cloudflare).
// Todo el DOM se arma con textContent: los nicks y mensajes vienen de otras personas y nunca se interpretan como HTML.
(() => {
  const api = window.atenas;
  const $ = (id) => document.getElementById(id);
  const S = { data: null, selected: null, lastId: 0, msgs: [], timer: null, viewing: false, loadingChat: false, confirm: null };

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const call = async (fn, ...a) => { const r = await fn(...a); if (!r.ok) { const e = new Error(r.message || r.error); e.code = r.error; throw e; } return r.data; };
  const toast = (text, error, onClick) => {
    const t = el('div', 'toast' + (error ? ' error' : '') + (onClick ? ' clickable' : ''), text);
    if (onClick) t.addEventListener('click', () => { onClick(); t.remove(); });
    $('toasts').append(t); setTimeout(() => t.remove(), 6500);
  };
  const key = (n) => String(n || '').toLowerCase();

  // ───── piezas ─────
  function face(name, size) {
    const box = el('div', 'fr-face' + (size ? ' ' + size : ''), (name || '?')[0].toUpperCase());
    const img = new Image(); img.alt = ''; img.loading = 'lazy';
    img.addEventListener('load', () => { box.classList.add('has-face'); });
    img.addEventListener('error', () => img.remove());
    img.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/64';
    box.append(img);
    return box;
  }
  const stateText = (f) => f.state === 'playing'
    ? (f.server ? `Jugando en ${f.server}` : f.pack ? `Jugando ${f.pack}` : 'Jugando Minecraft')
    : f.state === 'online' ? 'En el launcher' : 'Desconectado';
  const ago = (ts) => {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'ahora'; if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (ts) => {
    const d = new Date(ts), t = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, t)) return 'Hoy';
    const y = new Date(t); y.setDate(t.getDate() - 1);
    return same(d, y) ? 'Ayer' : d.toLocaleDateString('es', { day: 'numeric', month: 'long' });
  };
  const sendRoute = (fn, ...a) => call(fn, ...a);

  // ───── lista de amigos ─────
  function actionBtn(label, cls, onClick) {
    const b = el('button', 'fr-btn ' + cls, label); b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }
  async function act(fn, name, okMsg) {
    try {
      const d = await call(fn, name);
      applyState(d.state);
      if (okMsg) toast(okMsg);
      return d;
    } catch (e) { toast(e.message, true); }
  }

  function section(title, count, cls) {
    const h = el('div', 'fr-sec ' + (cls || ''));
    h.append(el('span', null, title), el('b', null, String(count)));
    return h;
  }

  function friendRow(f) {
    const row = el('div', 'fr-row2');
    row.dataset.s = f.state; row.dataset.key = f.key;
    if (S.selected === f.key) row.classList.add('active');
    row.tabIndex = 0; row.setAttribute('role', 'button');
    const info = el('div', 'fr-info2');
    info.append(el('strong', null, f.name), el('span', null, f.unread && f.preview ? f.preview.body : stateText(f)));
    if (f.unread && f.preview) info.classList.add('has-unread');
    const dot = el('i', 'fr-dot2');
    row.append(face(f.name), info);
    if (f.unread) row.append(el('b', 'unread', f.unread > 9 ? '9+' : String(f.unread)));
    else row.append(dot);
    row.addEventListener('click', () => openChat(f.key));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(f.key); } });
    return row;
  }

  function renderList() {
    const d = S.data;
    const box = $('frScroll');
    const frag = document.createDocumentFragment();
    if (!d || !['ok', 'stale'].includes(d.status)) { box.replaceChildren(); return; }
    if (d.incoming.length) {
      frag.append(section('Solicitudes recibidas', d.incoming.length, 'req'));
      for (const r of d.incoming) {
        const row = el('div', 'fr-req');
        const info = el('div', 'fr-info2');
        info.append(el('strong', null, r.name), el('span', null, 'Quiere ser tu amigo · ' + ago(r.ts)));
        const btns = el('div', 'fr-actions');
        btns.append(
          actionBtn('Aceptar', 'yes', () => act(api.social.accept, r.name, `${r.name} y tú ahora son amigos`)),
          actionBtn('Rechazar', 'no', () => act(api.social.remove, r.name)),
        );
        row.append(face(r.name), info, btns);
        frag.append(row);
      }
    }
    const playing = d.friends.filter((f) => f.state === 'playing');
    const online = d.friends.filter((f) => f.state === 'online');
    const offline = d.friends.filter((f) => f.state === 'offline');
    if (playing.length) { frag.append(section('Jugando ahora', playing.length)); playing.forEach((f) => frag.append(friendRow(f))); }
    if (online.length) { frag.append(section('En el launcher', online.length)); online.forEach((f) => frag.append(friendRow(f))); }
    if (offline.length) { frag.append(section('Desconectados', offline.length)); offline.forEach((f) => frag.append(friendRow(f))); }
    if (d.outgoing.length) {
      frag.append(section('Solicitudes enviadas', d.outgoing.length));
      for (const r of d.outgoing) {
        const row = el('div', 'fr-req sent');
        const info = el('div', 'fr-info2');
        info.append(el('strong', null, r.name), el('span', null, 'Esperando que acepte · ' + ago(r.ts)));
        row.append(face(r.name), info, el('div', 'fr-actions').appendChild(actionBtn('Cancelar', 'no', () => act(api.social.remove, r.name))).parentNode);
        frag.append(row);
      }
    }
    if (!d.friends.length && !d.incoming.length && !d.outgoing.length) {
      const e = el('div', 'fr-none');
      e.append(el('b', null, 'Todavía no tienes amigos'), el('span', null, 'Escribe el nick de un amigo arriba y envíale una solicitud. Cuando la acepte podrán chatear y verse en línea.'));
      frag.append(e);
    }
    box.replaceChildren(frag);
  }

  function renderBanner() {
    const d = S.data, b = $('frBanner');
    const msg = !d ? '' :
      d.status === 'unconfigured' ? 'El servicio de amigos todavía no está activado. El administrador debe seguir social-worker/LEEME.md y poner la URL en launcher.config.json.' :
      d.status === 'noaccount' ? 'Inicia sesión para usar amigos y chat.' :
      d.status === 'error' ? (d.error && d.error.message) || 'No se pudo conectar con el servicio de amigos.' :
      d.status === 'stale' ? 'Sin conexión con el servicio: se muestra lo último que se vio.' : '';
    b.hidden = !msg;
    b.textContent = msg;
    b.dataset.kind = d && d.status === 'stale' ? 'warn' : 'bad';
    const usable = d && ['ok', 'stale'].includes(d.status);
    $('frForm').classList.toggle('disabled', !usable);
    $('frName').disabled = !usable;
  }

  function renderSub() {
    const d = S.data;
    if (!d || !['ok', 'stale'].includes(d.status)) { $('frSub').textContent = d && d.status === 'loading' ? 'Conectando…' : 'Sin conexión'; return; }
    const on = d.friends.filter((f) => f.state !== 'offline').length;
    $('frSub').textContent = d.friends.length ? `${on} de ${d.friends.length} conectados` : 'Sin amigos todavía';
  }

  function renderBadge() {
    const d = S.data;
    const n = d && ['ok', 'stale'].includes(d.status) ? d.incoming.length + d.unread : 0;
    const b = $('friendsBadge');
    b.hidden = n === 0;
    b.textContent = n > 9 ? '9+' : String(n);
  }

  function renderHome() {
    const d = S.data, list = $('hfList');
    list.replaceChildren();
    const usable = d && ['ok', 'stale'].includes(d.status);
    const cnt = $('hfCount');
    if (!usable) {
      cnt.hidden = true; $('hfReqs').hidden = true;
      list.append(el('p', 'hf-empty', d && d.status === 'noaccount' ? 'Inicia sesión para ver a tus amigos.' : d && d.status === 'unconfigured' ? 'Amigos aún no está activado.' : 'Conectando con tus amigos…'));
      return;
    }
    const live = d.friends.filter((f) => f.state !== 'offline');
    cnt.hidden = false; cnt.textContent = `${live.length} en línea`;
    const rq = $('hfReqs');
    rq.hidden = !d.incoming.length;
    rq.textContent = d.incoming.length === 1 ? '1 solicitud' : `${d.incoming.length} solicitudes`;
    if (!d.friends.length) { list.append(el('p', 'hf-empty', 'Agrega amigos para ver aquí quién está jugando.')); return; }
    if (!live.length) { list.append(el('p', 'hf-empty', 'Nadie conectado ahora mismo.')); return; }
    for (const f of live.slice(0, 6)) {
      const row = el('button', 'hf-row'); row.type = 'button'; row.dataset.s = f.state;
      const info = el('div', 'fr-info2'); info.append(el('strong', null, f.name), el('span', null, stateText(f)));
      row.append(face(f.name, 'sm'), info);
      if (f.unread) row.append(el('b', 'unread', String(f.unread)));
      row.addEventListener('click', () => { window.atenasShowView('friends'); openChat(f.key); });
      list.append(row);
    }
    if (live.length > 6) list.append(el('p', 'hf-more', `y ${live.length - 6} más`));
  }

  function renderAll() { renderBanner(); renderSub(); renderBadge(); renderHome(); if (S.viewing) renderList(); renderChatHead(); }

  function applyState(d) {
    if (!d) return;
    S.data = d;
    // si el amigo abierto ya no es amigo, se cierra el chat
    if (S.selected && ['ok', 'stale'].includes(d.status) && !d.friends.some((f) => f.key === S.selected)) closeChat();
    renderAll();
    const f = currentFriend();
    if (f && f.unread > 0 && S.viewing) pollChat();
  }

  // ───── chat ─────
  const currentFriend = () => (S.data && S.data.friends ? S.data.friends.find((f) => f.key === S.selected) : null);

  function renderChatHead() {
    const f = currentFriend();
    $('chatEmpty').hidden = !!S.selected && !!f;
    $('chatMain').hidden = !S.selected || !f;
    if (!f) return;
    if ($('chatName').textContent !== f.name) { $('chatName').textContent = f.name; $('chatFace').replaceChildren(face(f.name)); }
    $('chatState').textContent = stateText(f);
    $('chatState').dataset.s = f.state;
  }

  function paintMessages(stickBottom) {
    const log = $('chatLog');
    const frag = document.createDocumentFragment();
    let lastDay = '', prev = null;
    for (const m of S.msgs) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) { frag.append(el('div', 'chat-day', day)); lastDay = day; prev = null; }
      const group = prev && prev.mine === m.mine && m.ts - prev.ts < 180000;
      const b = el('div', 'bubble ' + (m.mine ? 'mine' : 'theirs') + (group ? ' grouped' : '') + (m.pending ? ' pending' : '') + (m.failed ? ' failed' : ''));
      b.append(el('span', 'b-text', m.body), el('time', 'b-time', m.failed ? 'No enviado' : hhmm(m.ts)));
      frag.append(b);
      prev = m;
    }
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren(frag);
    if (stickBottom || near) log.scrollTop = log.scrollHeight;
  }

  async function openChat(k) {
    if (S.selected === k) { $('chatInput').focus(); return; }
    S.selected = k; S.msgs = []; S.lastId = 0;
    $('chatLog').replaceChildren(el('div', 'chat-loading', 'Cargando mensajes…'));
    $('chatName').textContent = '';
    renderAll();
    $('chatInput').focus();
    try {
      const msgs = await call(api.social.history, k, 0);
      if (S.selected !== k) return;
      S.msgs = msgs; S.lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
      paintMessages(true);
      api.social.sync().then((r) => r.ok && applyState(r.data));
    } catch (e) { $('chatLog').replaceChildren(el('div', 'chat-loading', e.message)); }
    startPoll();
  }
  function closeChat() { S.selected = null; S.msgs = []; S.lastId = 0; stopPoll(); renderAll(); }

  async function pollChat() {
    const k = S.selected;
    if (!k || S.loadingChat || !S.viewing) return;
    S.loadingChat = true;
    try {
      const fresh = await call(api.social.history, k, S.lastId);
      if (S.selected !== k || !fresh.length) return;
      // los mensajes propios enviados hace un instante ya están en pantalla (optimistas): se reemplazan
      S.msgs = S.msgs.filter((m) => !m.pending).concat(fresh.filter((m) => !S.msgs.some((x) => x.id === m.id)));
      S.lastId = S.msgs.reduce((mx, m) => (m.id && m.id > mx ? m.id : mx), S.lastId);
      paintMessages(false);
      if (fresh.some((m) => !m.mine)) api.social.sync().then((r) => r.ok && applyState(r.data));
    } catch { /* se reintenta en el próximo ciclo */ } finally { S.loadingChat = false; }
  }
  function startPoll() { stopPoll(); S.timer = setInterval(() => { if (!document.hidden) pollChat(); }, 2500); }
  function stopPoll() { clearInterval(S.timer); S.timer = null; }

  async function sendMessage(ev) {
    ev.preventDefault();
    const input = $('chatInput'), text = input.value.trim(), k = S.selected;
    if (!text || !k) return;
    input.value = '';
    const temp = { id: 0, mine: true, body: text, ts: Date.now(), pending: true };
    S.msgs.push(temp); paintMessages(true);
    try {
      const m = await call(api.social.send, k, text);
      if (S.selected === k) {
        const i = S.msgs.indexOf(temp);
        if (i >= 0) S.msgs[i] = { id: m.id, mine: true, body: m.body, ts: m.ts };
        S.lastId = Math.max(S.lastId, m.id || 0);
        paintMessages(true);
      }
    } catch (e) {
      temp.pending = false; temp.failed = true; paintMessages(true);
      toast(e.message, true);
    }
  }

  // ───── eventos ─────
  async function refresh() { try { applyState(await call(api.social.sync)); } catch (e) { applyState({ status: 'error', error: { message: e.message }, friends: [], incoming: [], outgoing: [], unread: 0 }); } }

  function onEvents(d) {
    if (!d) return;
    for (const r of d.requests) toast(`${r.name} te envió una solicitud de amistad`, false, () => window.atenasShowView('friends'));
    for (const f of d.accepted) toast(`${f.name} aceptó tu solicitud`);
    for (const f of d.messages) {
      const viewingThis = S.viewing && S.selected === f.key && document.hasFocus();
      if (!viewingThis) toast(`${f.name}: ${f.preview.body}`, false, () => { window.atenasShowView('friends'); openChat(f.key); });
    }
  }

  document.addEventListener('atenas:view', (e) => {
    S.viewing = e.detail === 'friends';
    if (S.viewing) { renderList(); refresh(); if (S.selected) { startPoll(); pollChat(); } }
    else stopPoll();
  });

  $('frForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('frName').value.trim();
    if (!name) return;
    try {
      const d = await sendRoute(api.social.add, name);
      $('frName').value = '';
      applyState(d.state);
      toast(d.result.result === 'accepted' ? `Ahora eres amigo de ${d.result.name}` : `Solicitud enviada a ${d.result.name}`);
    } catch (e) { toast(e.message, true); }
  });
  $('chatForm').addEventListener('submit', sendMessage);
  $('chatRemove').addEventListener('click', () => {
    const f = currentFriend(); if (!f) return;
    const b = $('chatRemove');
    if (S.confirm !== f.key) { S.confirm = f.key; b.classList.add('arm'); b.title = 'Pulsa otra vez para confirmar'; toast(`Pulsa otra vez para quitar a ${f.name} (se borra también la conversación)`); setTimeout(() => { S.confirm = null; b.classList.remove('arm'); b.title = 'Quitar de mis amigos'; }, 4000); return; }
    S.confirm = null; b.classList.remove('arm');
    act(api.social.remove, f.name, `${f.name} ya no está en tu lista`);
  });

  $('hfReqs').addEventListener('click', () => window.atenasShowView('friends'));
  api.social.onUpdate((d) => applyState(d));
  api.social.onEvents(onEvents);
  api.social.onOpen(() => window.atenasShowView('friends'));
  $('frBanner').addEventListener('click', () => refresh());
  call(api.social.state).then((d) => { applyState(d); refresh(); }).catch(() => {});
  setInterval(() => { if (S.viewing && !document.hidden) renderList(); }, 60000); // refresca los "hace X min"
})();
