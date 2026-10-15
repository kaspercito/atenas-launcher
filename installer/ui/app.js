'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of ['s-start', 's-prog', 's-done', 's-err']) $(s).hidden = s !== id; };
const start = () => { show('s-prog'); $('fill').style.transform = 'scaleX(0)'; $('pct').textContent = '0%'; window.inst.install(); };
$('go').addEventListener('click', start);
$('retry').addEventListener('click', start);
$('open').addEventListener('click', () => window.inst.launch());
$('x').addEventListener('click', () => window.inst.close());
window.inst.onProgress((p) => {
  if (p.phase === 'error') { $('errTxt').textContent = p.text; return show('s-err'); }
  if (p.phase === 'done') { $('fill').style.transform = 'scaleX(1)'; $('pct').textContent = '100%'; return setTimeout(() => show('s-done'), 450); }
  $('fill').style.transform = `scaleX(${Math.min(p.pct, 100) / 100})`;
  $('pct').textContent = Math.round(p.pct) + '%';
  $('txt').textContent = p.text;
});
