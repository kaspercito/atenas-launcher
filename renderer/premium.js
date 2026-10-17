'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const bg = document.querySelector('.bg');
  if (bg) for (const c of ['gridfx', 'aurora']) { const d = document.createElement('div'); d.className = c; bg.prepend(d); }

  // foco de luz y parallax (solo estilos, no toca el contenido)
  const SEL = '.stat,.card,.mod-card,.server-card,.choice,.chip';
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest(SEL);
    if (t) { const r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); }
    if (raf || !bg) return;
    raf = requestAnimationFrame(() => { raf = 0; bg.style.setProperty('--px', ((e.clientX / innerWidth - .5) * 30) + 'px'); bg.style.setProperty('--py', ((e.clientY / innerHeight - .5) * 30) + 'px'); });
  }, { passive: true });

  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn,.chip,.pack-tab');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, d = document.createElement('span');
    d.className = 'rip';
    d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(d); setTimeout(() => d.remove(), 650);
  });

  // paleta de acciones: usa los botones que ya existen
  const go = (v) => () => document.querySelector(`.nav-btn[data-view="${v}"]`)?.click();
  const press = (id) => () => $(id)?.click();
  const acts = [
    ['Jugar / instalar', 'Enter', press('btnPlay')], ['Ir a Inicio', '1', go('home')], ['Ir a Mods', '2', go('mods')],
    ['Ir a Novedades', '3', go('news')], ['Ir a Amigos y chat', '4', go('friends')], ['Ir a Ajustes', '5', go('settings')],
    ['Elegir modpack', 'M', press('packSelect')],
    ['Copiar IP del servidor', '', press('scIp')], ['Abrir carpeta del juego', '', press('btnFolder')],
    ['Abrir capturas', '', press('qShots')], ['Reparar instalación', '', press('qRepair')], ['Ver registro del juego', '', press('btnLog')],
    ['Cambiar tema de color', '', () => { const t = [...document.querySelectorAll('.theme')]; const i = t.findIndex((x) => x.getAttribute('aria-checked') === 'true'); t[(i + 1) % t.length]?.click(); }],
    ['Buscar un mod', '/', () => { go('mods')(); setTimeout(() => $('modSearch')?.focus(), 80); }],
  ];
  let pal = null;
  const close = () => { pal?.remove(); pal = null; };
  const open = () => {
    if (pal) return close();
    pal = document.createElement('div'); pal.className = 'pal';
    pal.innerHTML = '<div class="pal-box"><input placeholder="¿Qué quieres hacer?" aria-label="Buscar acción" spellcheck="false"><ul></ul></div>';
    const inp = pal.querySelector('input'), ul = pal.querySelector('ul');
    let list = acts, sel = 0;
    const draw = () => {
      ul.replaceChildren(...list.map((a, i) => { const li = document.createElement('li'); li.setAttribute('aria-selected', i === sel); li.textContent = a[0]; if (a[1]) { const s = document.createElement('small'); s.textContent = a[1]; li.append(s); } li.onclick = () => { close(); a[2](); }; return li; }));
    };
    inp.addEventListener('input', () => { const q = inp.value.toLowerCase(); list = acts.filter((a) => a[0].toLowerCase().includes(q)); sel = 0; draw(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, list.length); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = (sel - 1 + list.length) % Math.max(1, list.length); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && list[sel]) { const f = list[sel][2]; close(); f(); }
      else if (e.key === 'Escape') close();
    });
    pal.addEventListener('pointerdown', (e) => { if (e.target === pal) close(); });
    document.body.append(pal); draw(); inp.focus();
  };
  const tb = document.querySelector('.rail');
  if (tb) { const k = document.createElement('button'); k.className = 'kpill'; k.innerHTML = 'Buscar <i class="kbd">Ctrl K</i>'; k.onclick = open; tb.insertBefore(k, tb.querySelector('.account')); }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return open(); }
    if (pal || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const i = '12345'.indexOf(e.key);
    if (i >= 0) go(['home', 'mods', 'news', 'friends', 'settings'][i])();
    if (e.key.toLowerCase() === 'm') press('packSelect')();
    if (e.key === '/') { e.preventDefault(); go('mods')(); setTimeout(() => $('modSearch')?.focus(), 80); }
  });
  document.querySelectorAll('.nav-btn').forEach((b, i) => { const k = document.createElement('i'); k.className = 'kbd'; k.textContent = i + 1; b.appendChild(k); });
})();
