'use strict';
(function () {
  // Consejos del cliente de Atenas: SOLO se muestran cuando se esta cargando Atenas Client.
  const CLIENT_TIPS = [
    'Tip: abre el menú del cliente con Shift derecho.',
    'Tip: en el menú Principal puedes elegir tus cosméticos y activar los mods.',
    'Tip: mueve cada contador del HUD con el Editor HUD.',
    'Tip: la mira se puede personalizar y ves los cambios al instante.',
    'Tip: mantén C para usar el zoom.',
    'Tip: Shift+Tab abre Amigos y chat, también desde el menú principal.',
    'Tip: puedes cambiar de cuenta desde el menú principal del cliente.',
  ];
  // Para cualquier otro modpack: nada del cliente, solo cosas que valen para todos.
  const PACK_TIPS = [
    'Tip: si el juego va lento, ajusta la RAM en Ajustes del launcher.',
    'Tip: la primera vez que abres un modpack tarda más: está preparando sus archivos.',
    'Tip: el launcher actualiza los mods del modpack solo antes de jugar.',
    'Tip: en la pestaña Amigos ves quién está conectado.',
    'Tip: si algo falla, "Reparar" en el modpack vuelve a bajar sus archivos.',
  ];
  const $ = (id) => document.getElementById(id);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let mode = null;
  function setMode(builtin, pack) {
    const m = builtin ? 'client' : 'pack:' + pack;
    if (m === mode) return;
    mode = m;
    if (builtin) { $('title').textContent = 'ATENAS'; $('eyebrow').textContent = 'C  L  I  E  N  T'; }
    else { $('title').textContent = String(pack || 'Minecraft').toUpperCase(); $('eyebrow').textContent = 'A T E N A S   L A U N C H E R'; }
    $('tip').textContent = pick(builtin ? CLIENT_TIPS : PACK_TIPS);
  }
  setMode(true, '');
  const hide = () => window.loading.close();
  $('x').addEventListener('click', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.loading.onState((s) => {
    setMode(s.builtin !== false, s.pack);
    const p = Math.max(0, Math.min(100, Number(s.pct) || 0));
    $('val').setAttribute('stroke-dasharray', p + ' 100');
    $('fill').style.width = p + '%';
    $('pct').textContent = p + '%';
    if (s.text) $('status').textContent = s.text;
  });
})();
