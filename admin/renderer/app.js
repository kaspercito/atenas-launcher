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

  const LOADER = {
    neoforge: { label: 'NeoForge', tag: 'Moderno · 1.20.1 en adelante' },
    forge: { label: 'Forge', tag: 'Clásico · casi todas las versiones' },
    fabric: { label: 'Fabric', tag: 'Ligero y rápido · 1.14+' },
    quilt: { label: 'Quilt', tag: 'Compatible con mods de Fabric' },
  };
  const loaderLabel = (t) => (LOADER[t] && LOADER[t].label) || t || 'vanilla';
  const packLabel = (p) => `${p.name} · ${loaderLabel(p.loader)} ${p.minecraft}${p.published ? '' : ' · borrador'}${p.hidden ? ' · oculto' : ''}`;
  function fillPackSelect(packs, id) {
    S.packs = packs; S.packId = id;
    $('packSel').replaceChildren(...packs.map((p) => el('option', { value: p.id, text: packLabel(p) })));
    if (id) $('packSel').value = id;
  }
  async function loadMcVersions() {
    if (S.mcVersions) return S.mcVersions;
    try { S.mcVersions = await call(api.mcVersions()); } catch { S.mcVersions = []; }
    $('mcList').replaceChildren(...S.mcVersions.map((v) => el('option', { value: v })));
    return S.mcVersions;
  }

  function icon(m) {
    if (m.icon && /^https:\/\/(cdn\.modrinth\.com|media\.forgecdn\.net)\//.test(m.icon)) return el('img', { class: 'ico', src: m.icon, alt: '', loading: 'lazy' });
    return el('div', { class: 'ico', text: (m.title || m.slug || '?').charAt(0).toUpperCase() });
  }

  function modal(title, bodyNodes, buttons) {
    return new Promise((resolve) => {
      const d = $('dialog');
      d.className = 'dialog';
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
      el('div', { text: `Minecraft ${p.meta.minecraft || '?'} · ${loaderLabel(l.type)} ${l.version || ''}` }),
      p.meta.server ? el('div', { text: 'Servidor: ' + p.meta.server }) : null,
      el('div', { text: p.meta.hidden ? 'Launcher: oculto' : p.meta.published ? 'Launcher: visible ✔' : 'Launcher: borrador (publícalo)' }),
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
    if (S.onLog) S.onLog(line);
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

  // ───────── ajustes del pack ─────────
  const gbOf = (v) => { const m = /^(\d+(?:\.\d+)?)\s*([GgMm])$/.exec(String(v || '')); return m ? (/g/i.test(m[2]) ? Number(m[1]) : Number(m[1]) / 1024) : ''; };
  const memOf = (gb) => { gb = Number(gb); return Number.isInteger(gb) ? `${gb}G` : `${Math.round(gb * 1024)}M`; };
  let cfgOriginal = null;

  function fillSettings(c) {
    cfgOriginal = c;
    $('sName').value = c.name;
    $('sDesc').value = c.description || '';
    $('sListed').checked = c.listed !== false;
    $('sMc').value = c.minecraft;
    $('sLoader').value = c.loader.type;
    $('sLv').value = c.loader.version;
    $('sRamMin').value = gbOf(c.ram.min);
    $('sRamMax').value = gbOf(c.ram.max);
    $('sServer').value = c.server;
    $('lvChips').replaceChildren();
    $('lvList').replaceChildren();
    ramChips();
  }
  function ramChips() {
    $('ramChips').replaceChildren(...[4, 6, 8, 10, 12].map((g) => el('button', {
      type: 'button', text: `${g} GB`, class: Number($('sRamMax').value) === g ? 'on' : '',
      onclick: () => { $('sRamMax').value = g; if (Number($('sRamMin').value) > g || !$('sRamMin').value) $('sRamMin').value = Math.min(g, Math.max(2, g - 2)); ramChips(); },
    })));
  }
  async function loadSettings() { fillSettings(await call(api.getConfig())); }
  async function findLoaderVersions() {
    const type = $('sLoader').value, mc = $('sMc').value.trim();
    if (!mc) { toast('Escribe primero la versión de Minecraft', 'error'); return; }
    $('lvBtn').disabled = true;
    try {
      const list = await call(api.loaderVersions(type, mc));
      $('lvList').replaceChildren(...list.map((v) => el('option', { value: v.version })));
      $('lvChips').replaceChildren(...list.map((v) => el('button', {
        type: 'button', text: v.label ? `${v.version} · ${v.label}` : v.version,
        class: $('sLv').value === v.version ? 'on' : '',
        onclick: () => { $('sLv').value = v.version; $('lvChips').querySelectorAll('button').forEach((b) => b.classList.remove('on')); },
      })));
      if (!list.length) toast(`No encontré versiones de ${type} para Minecraft ${mc}. Puedes escribirla a mano.`, 'error', 7000);
    } finally { $('lvBtn').disabled = false; }
  }
  async function saveSettings() {
    const payload = {
      name: $('sName').value, minecraft: $('sMc').value, description: $('sDesc').value, listed: $('sListed').checked,
      loader: { type: $('sLoader').value, version: $('sLv').value },
      ram: { min: memOf($('sRamMin').value), max: memOf($('sRamMax').value) },
      server: $('sServer').value,
    };
    const risky = cfgOriginal && (cfgOriginal.minecraft !== payload.minecraft.trim() || cfgOriginal.loader.type !== payload.loader.type);
    if (risky && !confirm('Cambiar la versión de Minecraft o el loader puede dejar mods incompatibles.\n\n¿Guardar de todos modos? (luego usa «Vista previa» en Publicar)')) return;
    $('sSave').disabled = true;
    try {
      const r = await call(api.saveConfig(payload));
      fillSettings(r.config);
      setPack(r.pack);
      toast('Ajustes guardados ✔ — ahora pulsa Publicar para que lleguen a tus amigos', 'ok', 7000);
    } finally { $('sSave').disabled = false; }
  }

  // ───────── nuevo modpack (asistente) ─────────
  async function newPackWizard() {
    const st = { source: 'empty', folder: null, mr: null, idTouched: false, ramTouched: false, busy: false, loader: 'neoforge' };
    loadMcVersions();

    const nameI = el('input', { type: 'text', placeholder: 'Ej. Mi NeoForge', maxlength: 60, autocomplete: 'off' });
    const idI = el('input', { type: 'text', placeholder: 'se genera solo', autocomplete: 'off' });
    const descI = el('input', { type: 'text', placeholder: 'Una línea que verán tus amigos (opcional)', maxlength: 300, autocomplete: 'off' });
    const mcI = el('input', { type: 'text', list: 'mcList', placeholder: '1.21.1', autocomplete: 'off' });
    const lvI = el('input', { type: 'text', placeholder: '21.1.172', autocomplete: 'off' });
    const ramMinI = el('input', { type: 'number', min: 1, max: 64, step: 0.5 });
    const ramMaxI = el('input', { type: 'number', min: 1, max: 64, step: 0.5 });
    const serverI = el('input', { type: 'text', placeholder: 'atenasmc.live (opcional)', autocomplete: 'off' });
    const lvChips = el('div', { class: 'chips' });
    const lvBtn = el('button', { class: 'ghost', type: 'button', text: '🔎 Ver versiones' });
    const srcBox = el('div', { class: 'srcbox' });
    const status = el('p', { class: 'sub wstatus', text: '' });

    const loaderBtns = Object.keys(LOADER).map((k) => el('button', { type: 'button', class: `lcard ld-${k}`, 'data-l': k, onclick: () => setLoader(k) },
      el('b', { text: LOADER[k].label }), el('small', { text: LOADER[k].tag })));
    function setLoader(k) {
      st.loader = k;
      loaderBtns.forEach((b) => b.classList.toggle('on', b.dataset.l === k));
      lvChips.replaceChildren();
      lvI.placeholder = k === 'neoforge' ? '21.1.172' : k === 'forge' ? '47.3.0' : 'última estable (automático)';
      suggestRam();
    }
    function suggestRam() {
      if (st.ramTouched) return;
      const modern = Number((mcI.value.split('.')[1]) || 0) >= 20 || Number(mcI.value.split('.')[0]) >= 26;
      const light = st.loader === 'fabric' || st.loader === 'quilt';
      const [mn, mx] = light ? [2, 4] : modern ? [4, 6] : [3, 5];
      ramMinI.value = mn; ramMaxI.value = mx;
    }
    ramMinI.oninput = ramMaxI.oninput = () => { st.ramTouched = true; };
    mcI.oninput = suggestRam;
    nameI.oninput = () => {
      if (st.idTouched) return;
      idI.value = nameI.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    };
    idI.oninput = () => { st.idTouched = true; };
    lvBtn.onclick = () => guarded(async () => {
      const mc = mcI.value.trim();
      if (!mc) { toast('Escribe primero la versión de Minecraft', 'error'); return; }
      lvBtn.disabled = true;
      try {
        const list = await call(api.loaderVersions(st.loader, mc));
        lvChips.replaceChildren(...list.map((v) => el('button', { type: 'button', text: v.label ? `${v.version} · ${v.label}` : v.version, onclick: () => { lvI.value = v.version; lvChips.querySelectorAll('button').forEach((b) => b.classList.remove('on')); } })));
        if (list.length && !lvI.value) lvI.value = list[0].version;
        if (!list.length) toast(`No encontré versiones de ${loaderLabel(st.loader)} para Minecraft ${mc}. Puedes escribirla a mano.`, 'error', 7000);
      } finally { lvBtn.disabled = false; }
    });

    const srcSeg = el('div', { class: 'seg' },
      ...[['empty', 'Empezar vacío'], ['folder', 'Importar carpeta'], ['mrpack', 'Importar .mrpack']].map(([k, t]) => el('button', { type: 'button', 'data-s': k, class: k === 'empty' ? 'on' : '', text: t, onclick: () => setSource(k) })));
    function setSource(k) {
      st.source = k;
      srcSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === k));
      renderSource();
    }
    function renderSource() {
      srcBox.replaceChildren();
      if (st.source === 'empty') {
        srcBox.append(el('p', { class: 'hint', text: 'Empiezas sin mods. Los añades desde «Añadir mods» (Modrinth o CurseForge) o arrastrando tus .jar.' }));
      } else if (st.source === 'folder') {
        srcBox.append(
          el('div', { class: 'row nopush' },
            el('button', { type: 'button', class: 'ghost', text: '📂 Elegir carpeta de la instancia…', onclick: () => guarded(async () => { const p = await call(api.pickFolder()); if (p) { st.folder = p; renderSource(); } }) }),
            el('span', { class: 'desc', text: st.folder || 'Ninguna elegida' })),
          el('p', { class: 'hint', text: 'Sirve para una instancia de CurseForge, Prism, Modrinth App o tu .minecraft. Se copian los .jar de mods y las carpetas de configuración (config, kubejs, defaultconfigs…). No se copian mundos, capturas ni options.txt.' }));
      } else {
        const m = st.mr;
        srcBox.append(
          el('div', { class: 'row nopush' },
            el('button', { type: 'button', class: 'ghost', text: '📦 Elegir archivo .mrpack…', onclick: () => guarded(async () => {
              const r = await call(api.pickMrpack());
              if (!r) return;
              st.mr = r;
              const i = r.info;
              if (!nameI.value.trim()) { nameI.value = i.name; nameI.oninput(); }
              if (!descI.value.trim() && i.summary) descI.value = i.summary.slice(0, 300);
              mcI.value = i.minecraft; lvI.value = i.loader.version; setLoader(i.loader.type); lvI.value = i.loader.version;
              renderSource();
            }) }),
            el('span', { class: 'desc', text: m ? m.path : 'Ninguno elegido' })),
          m ? el('div', { class: 'item' }, el('div', { class: 'ico', text: 'M' }),
            el('div', { class: 'grow' }, el('div', { class: 'name', text: m.info.name }),
              el('div', { class: 'desc', text: `Minecraft ${m.info.minecraft} · ${loaderLabel(m.info.loader.type)} ${m.info.loader.version} · ${m.info.mods} mods · ${m.info.overrides} archivos de configuración` }))) : null,
          el('p', { class: 'hint', text: 'Los mods que estén en Modrinth quedan en tu lista con su versión fijada (se descargan al publicar); los demás se guardan como .jar propios. Los .zip de CurseForge no son compatibles: exporta como .mrpack o importa la carpeta.' }));
      }
    }

    const body = [
      el('p', { class: 'sub', text: 'Cada modpack tiene su propio Minecraft, loader, mods y RAM. Aparece en el launcher de tus amigos cuando lo publicas.' }),
      el('label', { class: 'lbl', text: 'Punto de partida' }), srcSeg, srcBox,
      el('div', { class: 'grid2' }, el('div', {}, el('label', { class: 'lbl', text: 'Nombre' }), nameI), el('div', {}, el('label', { class: 'lbl', text: 'Id (nombre de carpeta)' }), idI)),
      el('label', { class: 'lbl', text: 'Descripción' }), descI,
      el('label', { class: 'lbl', text: 'Loader' }), el('div', { class: 'loaders' }, ...loaderBtns),
      el('div', { class: 'grid2' },
        el('div', {}, el('label', { class: 'lbl', text: 'Versión de Minecraft' }), mcI),
        el('div', {}, el('label', { class: 'lbl', text: 'Versión del loader' }), el('div', { class: 'row nopush' }, lvI, lvBtn))),
      lvChips,
      el('div', { class: 'grid2' }, el('div', {}, el('label', { class: 'lbl', text: 'RAM mínima (GB)' }), ramMinI), el('div', {}, el('label', { class: 'lbl', text: 'RAM máxima (GB)' }), ramMaxI)),
      el('label', { class: 'lbl', text: 'Servidor (opcional · entra directo al abrir el juego)' }), serverI,
      status,
    ];

    return new Promise((resolve) => {
      const d = $('dialog');
      d.className = 'dialog wide';
      const cancel = el('button', { class: 'ghost', type: 'button', text: 'Cancelar' });
      const go = el('button', { class: 'primary', type: 'button', text: 'Crear modpack' });
      const close = (v) => { S.onLog = null; $('modal').hidden = true; d.className = 'dialog'; resolve(v); };
      cancel.onclick = () => { if (!st.busy) close(null); };
      go.onclick = async () => {
        if (st.busy) return;
        const gb = (v) => (Number.isInteger(Number(v)) ? `${Number(v)}G` : `${Math.round(Number(v) * 1024)}M`);
        const spec = {
          name: nameI.value, id: idI.value, description: descI.value, minecraft: mcI.value,
          loader: { type: st.loader, version: lvI.value }, ram: { min: gb(ramMinI.value), max: gb(ramMaxI.value) }, server: serverI.value,
        };
        const source = { type: st.source, path: st.source === 'folder' ? st.folder : st.source === 'mrpack' && st.mr ? st.mr.path : null };
        if (st.source === 'folder' && !source.path) { toast('Elige la carpeta de la instancia o cambia a «Empezar vacío».', 'error'); return; }
        if (st.source === 'mrpack' && !source.path) { toast('Elige el archivo .mrpack o cambia a «Empezar vacío».', 'error'); return; }
        st.busy = true;
        go.disabled = cancel.disabled = true;
        go.replaceChildren(el('span', { class: 'spin' }), ' Creando…');
        S.onLog = (l) => { const t = String(l).trim(); if (t) status.textContent = t; };
        try {
          const r = await call(api.createPack({ spec, source }));
          close(r);
          fillPackSelect(r.packs, r.id);
          hits = [];
          await refresh();
          const rep = r.report;
          if (rep && 'pinned' in rep) toast(`Importado: ${rep.pinned} mods de Modrinth fijados, ${rep.downloaded} archivos descargados y ${rep.overrides} de configuración.`, 'ok', 9000);
          else if (rep) toast(`Importados ${rep.mods} mods (.jar) y ${rep.files} archivos de configuración.`, 'ok', 9000);
          (rep ? rep.skipped : []).slice(0, 6).forEach((t) => toast('Omitido: ' + t, 'error', 10000));
          toast(`Modpack «${spec.name}» creado. Cuando esté listo pulsa Vista previa y Publicar: así aparece en el launcher.`, 'ok', 9000);
          show(source.type === 'mrpack' ? 'publish' : source.type === 'folder' ? 'files' : 'add');
        } catch (e) {
          st.busy = false; go.disabled = cancel.disabled = false; go.textContent = 'Crear modpack'; status.textContent = '';
          fail(e);
        }
      };
      d.replaceChildren(el('h2', { text: 'Nuevo modpack' }), ...body, el('div', { class: 'row' }, cancel, go));
      setLoader('neoforge'); renderSource();
      mcI.value = '1.21.1'; suggestRam();
      $('modal').hidden = false;
      $('modal').onclick = (e) => { if (e.target === $('modal') && !st.busy) close(null); };
      nameI.focus();
    });
  }

  async function deletePackFlow() {
    const id = S.packId;
    const p = S.packs.find((x) => x.id === id);
    if (!p) return;
    const typed = el('input', { type: 'text', placeholder: id, autocomplete: 'off' });
    const push = el('input', { type: 'checkbox' });
    push.checked = !!(S.pack && S.pack.git);
    const r = await modal(`Eliminar «${p.name}»`, [
      el('p', { class: 'sub', text: `Se borra la carpeta del modpack con todos sus mods y configuraciones, y se quita de la lista del launcher. Escribe el id «${id}» para confirmar.` }),
      typed,
      el('label', { class: 'check' }, push, ' Subir el borrado a GitHub ahora'),
    ], [{ label: 'Cancelar', value: () => null }, { label: 'Eliminar para siempre', primary: true, value: () => (typed.value.trim() === id ? { push: push.checked } : false) }]);
    if (r === null || r === undefined) return;
    if (r === false) { toast('El id no coincide: no se borró nada.', 'error'); return; }
    const out = await call(api.deletePack(id, r));
    fillPackSelect(out.packs, out.packId);
    hits = [];
    if (out.packId) await refresh(); else { S.pack = null; await loadAll(); }
    show('mods');
    toast(`Modpack «${p.name}» eliminado${out.pushed ? ' y subido a GitHub' : ' (solo en tu PC)'}.`, 'ok', 8000);
  }

  // ───────── navegación y eventos ─────────
  function show(view) {
    S.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + view));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'add' && !hits.length) guarded(() => doSearch(true));
    if (view === 'settings') { guarded(loadSettings); loadMcVersions(); }
  }

  async function loadAll() {
    const init = await call(api.init());
    S.repoDir = init.repoDir;
    fillPackSelect(init.packs, init.packId);
    if (!init.packs.length) {
      $('modList').replaceChildren(el('div', { class: 'empty' }, 'No encuentro tus modpacks. ', el('button', { class: 'primary', text: 'Elegir carpeta atenas-packs', onclick: chooseRepo }), ' ', el('button', { class: 'ghost', text: '＋ Crear mi primer modpack', onclick: () => guarded(newPackWizard) })));
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
    $('newPackBtn').onclick = () => guarded(newPackWizard);
    $('delPackBtn').onclick = () => guarded(deletePackFlow);
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
    $('lvBtn').onclick = () => guarded(findLoaderVersions);
    $('sSave').onclick = () => guarded(saveSettings);
    $('sReset').onclick = () => guarded(loadSettings);
    $('sRamMax').oninput = ramChips;
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
