'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const card = $('card');
  // frases del cliente mientras descarga
  const TIPS = [
    'Afilando las espadas…', 'Puliendo tu escudo…', 'Afinando el PvP…', 'Optimizando tus FPS…',
    'Encendiendo la forja de Atenas…', 'Puliendo los cosméticos…', 'Ordenando el Olimpo…', 'Entrenando a los hoplitas…',
  ];
  let tipI = Math.floor(Math.random() * TIPS.length);
  let tipTimer = null;
  let state = 'downloading';
  let last = null;

  const mb = (n) => (n / 1048576).toFixed(n >= 1.048576e8 ? 0 : 1);
  function setRing(pct) {
    const wait = pct < 1;
    $('ring').classList.toggle('wait', wait);
    $('val').setAttribute('stroke-dasharray', wait ? '22 78' : `${Math.max(0, Math.min(100, pct))} 100`);
  }
  function setState(s) { state = s; card.dataset.state = s; }
  function stopTips() { clearInterval(tipTimer); tipTimer = null; }
  function startTips() {
    if (tipTimer) return;
    tipTimer = setInterval(() => { if (state === 'downloading') { tipI = (tipI + 1) % TIPS.length; $('status').textContent = TIPS[tipI]; } }, 2800);
  }
  function buttons(primary, secondary) {
    $('actions').hidden = !primary;
    if (primary) { $('primary').textContent = primary; $('secondary').textContent = secondary; }
  }

  function render(u) {
    if (!u || state === 'installing') return;
    last = u;
    $('cur').textContent = u.current || '—';
    $('next').textContent = u.version || '—';
    if (u.state === 'downloading') {
      setState('downloading'); startTips();
      $('eyebrow').textContent = 'NUEVA VERSIÓN';
      $('title').textContent = 'Descargando actualización';
      if (!$('status').textContent || $('status').textContent === 'Preparando…') $('status').textContent = TIPS[tipI];
      $('meta').hidden = false;
      $('pct').textContent = `${u.percent || 0}%`;
      $('speed').textContent = u.total ? `${(u.speed / 1048576).toFixed(1)} MB/s · ${mb(u.transferred)} / ${mb(u.total)} MB` : '';
      setRing(u.percent || 0);
      buttons(null);
    } else if (u.state === 'ready') {
      stopTips(); setState('ready');
      $('eyebrow').textContent = 'LISTA PARA INSTALAR';
      $('title').textContent = '¡Todo listo!';
      $('status').textContent = 'Reinicia para estrenar la nueva versión. Tus modpacks, mundos y ajustes no se tocan.';
      $('meta').hidden = true;
      setRing(100);
      buttons('Reiniciar y actualizar', 'Más tarde');
    } else if (u.state === 'error') {
      stopTips(); setState('error');
      $('eyebrow').textContent = 'ALGO FALLÓ';
      $('title').textContent = 'No se pudo actualizar';
      $('status').textContent = u.error || 'Error desconocido. Inténtalo de nuevo en unos minutos.';
      $('meta').hidden = true;
      setRing(0); $('ring').classList.remove('wait');
      buttons('Reintentar', 'Cerrar');
    }
  }

  $('primary').addEventListener('click', () => {
    if (state === 'error') { setState('downloading'); $('status').textContent = 'Reintentando…'; return window.upd.retry(); }
    if (state !== 'ready') return;
    setState('installing');
    $('eyebrow').textContent = 'INSTALANDO';
    $('title').textContent = 'Un momento…';
    $('status').textContent = 'Cerrando el launcher y aplicando los cambios. Se abrirá solo.';
    buttons(null);
    window.upd.install();
  });
  $('secondary').addEventListener('click', () => window.upd.later());
  $('x').addEventListener('click', () => window.upd.later());

  window.upd.onState(render);
  window.upd.get().then(render);
})();
