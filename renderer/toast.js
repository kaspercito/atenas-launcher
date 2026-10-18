'use strict';
(() => {
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const kind = q.get('kind') || 'info', name = q.get('name') || '';
  const card = $('card');
  card.style.setProperty('--life', (Number(q.get('life')) || 7000) + 'ms');
  card.style.setProperty('--c', kind === 'friend' ? 'var(--ok)' : kind === 'info' ? 'var(--info)' : kind === 'request' ? 'var(--pink)' : 'var(--acc)');
  $('title').textContent = q.get('title') || 'Atenas Client';
  $('body').textContent = q.get('body') || '';
  $('hint').textContent = kind === 'message' ? 'Clic para responder' : kind === 'request' ? 'Clic para ver la solicitud' : '';
  $('ini').textContent = (name || q.get('title') || 'A')[0].toUpperCase();
  if (name) {
    const img = new Image(); img.alt = '';
    img.addEventListener('load', () => $('face').append(img));
    img.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/96';
  }
  card.addEventListener('click', () => window.toast.click());
  $('x').addEventListener('click', (e) => { e.stopPropagation(); card.classList.add('out'); setTimeout(() => window.toast.close(), 250); });
  card.addEventListener('mouseenter', () => window.toast.hover(true));
  card.addEventListener('mouseleave', () => window.toast.hover(false));
})();
