'use strict';
(() => {
  const api = window.admin;
  const $ = (id) => document.getElementById(id);
  const S = { pack: null, packs: [], packId: null, repoDir: null, q: '', src: 'modrinth', offset: 0, total: 0, busy: false, view: 'mods' };

  // ───────── utilidades ─────────
  async function call(p) {
    const r = await p;
    if (!r.ok) throw new Error(r.message);
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
  function toast(text, kind = '', ms = 5000) {
    const t = el('div', { class: `toast ${kind}`, text });
    $('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }
  const fail = (e) => toast(e.message || String(e), 'error', 8000);
  const fmtMb = (n) => (n / 1048576).toFixed(1) + ' MB';
  const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  const norm = (s) => String(s || '').toLowerCase();

  function icon(m) {
    if (m.icon && /^https:\/\/(cdn\.modrinth\.com|media\.forgecdn\.net)\//.test(m.icon)) return el('img', { class: 'ico', src: m.icon, alt: '', loading: 'lazy' });
    return el('div', { class: 'ico', text: (m.title || m.slug || '?').charAt(0).toUpperCase() });
  }

  function modal(title, bodyNodes, buttons) {
    return new Promise((resolve) => {
      const d = $('dialog');
      d.replaceChildren(el('h2', { text: title }), ...bodyNodes);
      const close = (v) => { $('modal').hidden = true; resolve(v); };
      d.append(el('div', { class: 'row' }, ...buttons.map((b) =>
        el('button', { class: b.primary ? 'primary' : 'ghost', text: b.label, onclick: () => close(b.value && b.value()) }))));
      $('modal').hidden = false;
      $('modal').onclick = (e) => { if (e.target === $('modal')) close(null); };
    });
  }

  async function guarded(fn) {
    try { return await fn(); } catch (e) { fail(e); }
  }

  // ───────── datos ─────────
  function setPack(p) {
    S.pack = p;
    renderAll();
  }
  async function refresh() { setPack(await call(api.loadPack())); }

  // ───────── render ─────────
  function renderAll() {
    const p = S.pack;
    if (!p) return;
    $('cMods').textContent = p.mods.length;
    $('cManual').textContent = p.manual.length;
    const l = p.meta.loader || {};
    $('meta').replaceChildren(
      el('div', {}, el('b', { text: p.meta.name || S.packId })),
      el('div', { text: `Minecraft ${p.meta.minecraft || '?'} · ${l.type || 'vanilla'} ${l.version || ''}` }),
      p.meta.server ? el('div', { text: 'Servidor: ' + p.meta.server }) : null,
      el('div', { text: p.git ? 'Git: conectado ✔' : 'Git: no es un repositorio ✖' }),
    );
    $('modsSub').textContent = `${p.mods.length} mods tuyos` + (p.deps.length ? ` + ${p.deps.length} dependencias automáticas` : '') + (p.manual.length ? ` + ${p.manual.length} .jar propios` : '');
    renderMods();
    renderManual();
    renderChanges();
    const n = p.pending;
    $('bar').hidden = !(n || p.changed);
    $('barTxt').textContent = n ? `${n} cambio${n === 1 ? '' : 's'} sin publicar` : 'Tienes ediciones sin publicar';
  }

  function modRow(m) {
    const badges = [];
    if (m.status === 'new') badges.push(el('span', { class: 'badge new', text: 'nuevo' }));
    if (m.status === 'changed') badges.push(el('span', { class: 'badge changed', text: 'cambia de versión' }));
    if (m.source === 'curseforge') badges.push(el('span', { class: 'badge cf', text: 'CurseForge' }));
    if (m.pin) badges.push(el('span', { class: 'badge pin', text: '📌 ' + m.pin }));
    return el('div', { class: `item ${m.status === 'ok' ? '' : m.status}` },
      icon(m),
      el('div', { class: 'grow' }, el('div', { class: 'name', text: m.title }), el('div', { class: 'desc', text: m.version ? `${m.slug} · ${m.version}` : m.slug })),
      ...badges,
      m.source ? null : el('button', { class: 'ghost sm', title: 'Fijar versión', text: '📌', onclick: () => pinDialog(m) }),
      !m.source && m.status === 'new' ? el('button', { class: 'ghost sm', title: 'Buscar en CurseForge', text: '🔎 CF', onclick: () => searchOnCf(m.title || m.slug) }) : null,
      el('button', { class: 'ghost sm danger', title: 'Quitar del modpack', text: '🗑', onclick: () => guarded(async () => { setPack(await call(api.removeMod(m.slug, m.source))); toast(`Quitado: ${m.title}`); }) }),
    );
  }

  function renderMods() {
    const f = norm($('filter').value);
    const p = S.pack;
    const box = $('modList');
    box.replaceChildren();
    const match = (m) => !f || norm(m.title).includes(f) || norm(m.slug).includes(f);
    const groups = new Map();
    for (const m of p.mods.filter(match)) {
      const k = m.section || 'Sin sección';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const [name, mods] of groups) {
      box.append(el('div', { class: 'sec', text: `${name} · ${mods.length}` }));
      for (const m of mods) box.append(modRow(m));
    }
    for (const r of p.removed.filter((r) => !f || norm(r.title).includes(f))) {
      if (!box.querySelector('.rm-sec')) box.append(el('div', { class: 'sec rm-sec', text: 'Se quitarán al publicar' }));
      box.append(el('div', { class: 'item removed' }, el('div', { class: 'ico', text: '✖' }),
        el('div', { class: 'grow' }, el('div', { class: 'name', text: r.title }), el('div', { class: 'desc', text: r.filename })),
        el('span', { class: 'badge rm', text: 'quitar' })));
    }
    if (!box.children.length) box.append(el('div', { class: 'empty', text: f ? 'Ningún mod coincide.' : 'Aún no hay mods. Ve a "Añadir mods".' }));

    const dep = $('depBox');
    dep.replaceChildren();
    if (p.deps.length && !f) {
      dep.append(el('div', { class: 'sec', text: `Dependencias automáticas · ${p.deps.length}` }));
      const wrap = el('div', { class: 'list' });
      for (const d of p.deps) wrap.append(el('div', { class: 'item' }, icon(d), el('div', { class: 'grow' }, el('div', { class: 'name', text: d.title }), el('div', { class: 'desc', text: d.filename })), el('span', { class: 'badge', text: 'auto' })));
      dep.append(wrap);
    }
  }

  function renderManual() {
    const box = $('manualList');
    box.replaceChildren();
    if (!S.pack.manual.length) { box.append(el('div', { class: 'empty', text: 'No hay .jar propios todavía.' })); return; }
    for (const m of S.pack.manual) {
      box.append(el('div', { class: 'item' }, el('div', { class: 'ico', text: 'J' }),
        el('div', { class: 'grow' }, el('div', { class: 'name', text: m.filename }), el('div', { class: 'desc', text: fmtMb(m.size) })),
        el('button', { class: 'ghost sm danger', text: '🗑', title: 'Borrar', onclick: () => guarded(async () => { setPack(await call(api.deleteJar(m.filename))); toast('Borrado ' + m.filename); }) })));
    }
  }

  function renderChanges() {
    const p = S.pack;
    const box = $('changes');
    box.replaceChildren();
    const add = p.mods.filter((m) => m.status === 'new');
    const chg = p.mods.filter((m) => m.status === 'changed');
    const rm = p.removed;
    const row = (cls, txt, t) => el('div', { class: 'chg' }, el('span', { class: `badge ${cls}`, text: txt }), el('span', { text: t }));
    add.forEach((m) => box.append(row('new', 'añadir', m.title)));
    chg.forEach((m) => box.append(row('changed', 'versión', `${m.title} → ${m.pin}`)));
    rm.forEach((m) => box.append(row('rm', 'quitar', m.title)));
    if (!add.length && !chg.length && !rm.length) box.append(el('div', { class: 'desc', text: 'Nada pendiente. Aun así puedes publicar para buscar versiones nuevas de los mods.' }));
  }

  // ───────── diálogos ─────────
  async function versionSelect(slug) {
    const sel = el('select', {}, el('option', { value: '', text: 'Última versión compatible (recomendado)' }));
    sel.disabled = true;
    call(api.versions(slug)).then((vs) => {
      for (const v of vs.slice(0, 40)) sel.append(el('option', { value: v.number, text: `${v.number}${v.type !== 'release' ? ' (' + v.type + ')' : ''}` }));
      sel.disabled = false;
    }).catch((e) => sel.append(el('option', { value: '', text: 'No se pudieron cargar versiones: ' + e.message })));
    return sel;
  }

  async function pinDialog(m) {
    const sel = await versionSelect(m.slug);
    const v = await modal(`Versión de ${m.title}`, [el('p', { class: 'sub', text: 'Fijar una versión evita que se actualice sola.' }), sel],
      [{ label: 'Cancelar', value: () => null }, { label: 'Guardar', primary: true, value: () => sel.value || '' }]);
    if (v === null || v === undefined) return;
    guarded(async () => { setPack(await call(api.pinMod(m.slug, v))); toast(v ? `Fijado en ${v}` : 'Vuelve a la última versión', 'ok'); });
  }

  async function addDialog(hit) {
    const sections = S.pack.sections;
    const secSel = el('select', {}, ...sections.map((s) => el('option', { value: s, text: s })), el('option', { value: '', text: 'Sin sección' }), el('option', { value: '__new', text: '+ Nueva sección…' }));
    const newSec = el('input', { type: 'text', placeholder: 'Nombre de la sección', hidden: true, class: 'mt' });
    secSel.onchange = () => { newSec.hidden = secSel.value !== '__new'; if (!newSec.hidden) newSec.focus(); };
    const isCf = hit.source === 'curseforge';
    const verSel = isCf ? null : await versionSelect(hit.slug);
    const r = await modal(`Añadir ${hit.title}`, [
      el('label', { class: 'lbl', text: 'Sección' }), secSel, newSec,
      ...(isCf ? [el('p', { class: 'sub', text: 'Se usará la última versión compatible de CurseForge, con sus dependencias obligatorias.' })]
        : [el('label', { class: 'lbl', text: 'Versión' }), verSel]),
    ], [{ label: 'Cancelar', value: () => null }, { label: 'Añadir', primary: true, value: () => ({ section: secSel.value === '__new' ? newSec.value.trim() : secSel.value, pin: verSel ? verSel.value : '' }) }]);
    if (!r) return;
    const payload = isCf ? { source: 'curseforge', slug: hit.slug, modId: hit.modId, title: hit.title, icon: hit.icon, section: r.section } : { slug: hit.slug, ...r };
    guarded(async () => { setPack(await call(api.addMod(payload))); toast(`Añadido: ${hit.title}`, 'ok'); renderResults(); });
  }

  // ───────── búsqueda ─────────
  let hits = [];
  function renderResults() {
    const box = $('results');
    box.replaceChildren();
    const have = new Set(S.pack.mods.map((m) => norm(m.slug)));
    for (const h of hits) {
      const has = have.has(norm(h.slug));
      box.append(el('div', { class: 'card' }, icon(h),
        el('div', { class: 'grow' }, el('div', { class: 'name', text: h.title }),
          el('div', { class: 'desc', text: h.description || '' }),
          el('div', { class: 'act' },
            el('button', { class: has || h.allowed === false ? 'ghost sm' : 'primary sm', text: has ? '✔ Ya añadido' : h.allowed === false ? '⛔ El autor no permite launchers' : '＋ Añadir', disabled: has || h.allowed === false, onclick: () => addDialog(h) }),
            el('span', { class: 'badge', text: '⬇ ' + fmtNum(h.downloads) }),
            el('a', { href: h.source === 'curseforge' ? (h.url || 'https://www.curseforge.com/minecraft/mc-mods/' + encodeURIComponent(h.slug)) : `https://modrinth.com/mod/${encodeURIComponent(h.slug)}`, target: '_blank', rel: 'noreferrer', class: 'desc', text: h.slug })))));
    }
    $('moreBtn').hidden = hits.length >= S.total;
    if (!hits.length) box.append(el('div', { class: 'empty', text: 'Sin resultados.' }));
  }
  async function doSearch(reset) {
    if (reset) { S.offset = 0; hits = []; }
    if (S.src === 'curseforge' && !S.pack.cfKey) { $('cfKeyBox').hidden = false; $('cfChangeRow').hidden = true; hits = []; renderResults(); $('moreBtn').hidden = true; return; }
    $('cfKeyBox').hidden = true;
    $('cfChangeRow').hidden = S.src !== 'curseforge';
    const r = await call(S.src === 'curseforge' ? api.cfSearch(S.q, S.offset) : api.search(S.q, S.offset));
    hits = hits.concat(r.hits);
    S.total = r.total;
    S.offset = hits.length;
    renderResults();
  }

  function setSrc(src) {
    S.src = src; hits = [];
    document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    guarded(() => doSearch(true));
  }
  function searchOnCf(text) {
    $('q').value = text; S.q = text;
    S.src = 'curseforge'; hits = [];
    document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.src === 'curseforge'));
    show('add');
  }

  // ───────── jars ─────────
  async function importPaths(paths) {
    if (!paths.length) return;
    const r = await call(api.importJars(paths));
    setPack(r.pack);
    if (r.done.length) toast(`Añadidos ${r.done.length} .jar`, 'ok');
    r.skipped.forEach((s) => toast('Omitido: ' + s, 'error', 8000));
  }

  // ───────── publicar ─────────
  function log(line) {
    const pre = $('log');
    pre.append(document.createTextNode(line + '\n'));
    pre.scrollTop = pre.scrollHeight;
  }
  function showProblems(list) {
    $('problems').replaceChildren(...list.map((t) => el('div', { class: 'prob', text: t })));
  }
  function setBusy(b, btn, label) {
    S.busy = b;
    for (const id of ['previewBtn', 'publishBtn', 'discardBtn']) $(id).disabled = b;
    if (btn) { if (b) { btn.dataset.t = btn.textContent; btn.replaceChildren(el('span', { class: 'spin' }), ` ${label}`); } else btn.textContent = btn.dataset.t; }
  }
  async function runPreview() {
    $('log').textContent = ''; showProblems([]);
    setBusy(true, $('previewBtn'), 'Revisando…');
    try {
      const r = await call(api.preview());
      setPack(r.pack);
      showProblems(r.problems);
      log(r.problems.length ? '\n⚠ Hay problemas (ver abajo).' : '\n✔ Todo en orden. Puedes publicar.');
    } catch (e) { fail(e); } finally { setBusy(false, $('previewBtn')); }
  }
  async function runPublish() {
    if (!S.pack.git && $('doPush').checked) { toast('La carpeta no es un repositorio de git: desmarca "Subir a GitHub" o clona atenas-packs.', 'error', 9000); return; }
    $('log').textContent = ''; showProblems([]);
    setBusy(true, $('publishBtn'), 'Publicando…');
    try {
      const r = await call(api.publish($('note').value.trim(), { push: $('doPush').checked }));
      setPack(r.pack);
      if (r.blocked) { showProblems(r.problems); toast('No se publicó: hay problemas que corregir.', 'error', 8000); }
      else { $('note').value = ''; toast(r.pushed ? `Publicado v${r.version || ''} ✔` : 'Listo (sin subir)', 'ok', 8000); }
    } catch (e) { log('\n✖ ' + e.message); fail(e); } finally { setBusy(false, $('publishBtn')); }
  }

  // ───────── navegación y eventos ─────────
  function show(view) {
    S.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + view));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'add' && !hits.length) guarded(() => doSearch(true));
  }

  async function loadAll() {
    const init = await call(api.init());
    S.packs = init.packs; S.packId = init.packId; S.repoDir = init.repoDir;
    $('packSel').replaceChildren(...init.packs.map((id) => el('option', { value: id, text: id })));
    if (init.packId) $('packSel').value = init.packId;
    if (!init.packs.length) {
      $('modList').replaceChildren(el('div', { class: 'empty' }, 'No encuentro tus modpacks. ', el('button', { class: 'primary', text: 'Elegir carpeta atenas-packs', onclick: chooseRepo })));
      return;
    }
    await refresh();
  }
  async function chooseRepo() {
    const r = await call(api.chooseRepo());
    if (r) { hits = []; await loadAll(); toast('Carpeta cargada', 'ok'); }
  }

  function init() {
    document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
    $('repoBtn').onclick = () => guarded(chooseRepo);
    $('packSel').onchange = () => guarded(async () => { await call(api.selectPack($('packSel').value)); hits = []; await refresh(); });
    $('filter').oninput = () => S.pack && renderMods();
    $('searchForm').onsubmit = (e) => { e.preventDefault(); S.q = $('q').value.trim(); guarded(() => doSearch(true)); };
    document.querySelectorAll('#srcSeg button').forEach((b) => b.addEventListener('click', () => setSrc(b.dataset.src)));
    $('cfKeyForm').onsubmit = (e) => {
      e.preventDefault();
      guarded(async () => { await call(api.cfSetKey($('cfKey').value)); $('cfKey').value = ''; await refresh(); toast('CurseForge conectado ✔', 'ok'); await doSearch(true); });
    };
    $('cfChangeBtn').onclick = () => guarded(async () => { await call(api.cfClearKey()); await refresh(); $('cfChangeRow').hidden = true; await doSearch(true); });
    $('moreBtn').onclick = () => guarded(() => doSearch(false));
    $('pickBtn').onclick = () => guarded(async () => importPaths(await call(api.pickJars())));
    $('previewBtn').onclick = runPreview;
    $('publishBtn').onclick = runPublish;
    $('clearLog').onclick = () => { $('log').textContent = ''; showProblems([]); };
    $('goPublish').onclick = () => show('publish');
    $('discardBtn').onclick = () => guarded(async () => {
      const ok = await modal('¿Descartar cambios?', [el('p', { class: 'sub', text: 'Se restaura la lista de mods como estaba al abrir (o al publicar la última vez).' })],
        [{ label: 'Cancelar', value: () => false }, { label: 'Descartar', primary: true, value: () => true }]);
      if (ok) { setPack(await call(api.discard())); toast('Cambios descartados'); }
    });
    api.onLog(log);

    // arrastrar y soltar: en toda la ventana, pero el destino es "Mis .jar"
    const drop = $('drop');
    for (const ev of ['dragover', 'dragenter']) window.addEventListener(ev, (e) => { e.preventDefault(); if (S.view === 'files') drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); });
    window.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      if (S.view !== 'files') show('files');
      guarded(() => importPaths(api.pathsFor(files)));
    });
    guarded(loadAll);
  }
  init();
})();
