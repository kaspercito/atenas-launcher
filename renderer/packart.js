'use strict';
/**
 * Arte de cada version/modpack: una ilustracion propia (estilo pixel) segun el tipo de pack, con el color derivado de su id.
 * Si el pack trae "image" (URL https o data:) se usa esa en su lugar. Todo se genera en el momento: no hay imagenes que descargar.
 */
(function () {
  const hueOf = (id) => { if (/atenas/i.test(String(id))) return 268; let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const r = (x, y, w, h, f, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" ${extra}/>`;

  function kindOf(p) {
    const t = `${p.id || ''} ${p.name || ''}`.toLowerCase();
    const loader = String(p.loader || '').toLowerCase();
    if (/pvp|client|cliente|arena|bedwars|duel/.test(t) || /^1\.8(\.|$)/.test(p.minecraft || '')) return 'pvp';
    if (/smp|survival|supervivencia|vanilla|server|servidor/.test(t) && !/forge|fabric/.test(loader)) return 'smp';
    if (/forge|fabric|quilt|neoforge/.test(loader)) return 'mods';
    return 'cube';
  }

  function sword(cx, cy, rot, hue) {
    return `<g transform="translate(${cx} ${cy}) rotate(${rot})" shape-rendering="crispEdges">
      ${r(-5, -86, 10, 72, '#e8f1fb')}${r(-5, -86, 4, 72, '#ffffff')}${r(1, -86, 4, 72, '#a9bdd3')}${r(-5, -92, 10, 6, '#cfdceb')}
      ${r(-19, -14, 38, 7, `hsl(${(hue + 40) % 360} 85% 58%)`)}${r(-19, -14, 38, 2, '#fff6', '')}
      ${r(-4, -7, 8, 26, '#6b4423')}${r(-4, -7, 3, 26, '#8a5a30')}${r(-7, 19, 14, 7, `hsl(${(hue + 40) % 360} 85% 58%)`)}</g>`;
  }

  const scenes = {
    pvp(h) {
      let grid = '';
      for (let i = 0; i < 9; i++) grid += `<path d="M${160 + (i - 4) * 14} 120 L${160 + (i - 4) * 70} 180" stroke="hsl(${h} 90% 65% / .35)" stroke-width="1"/>`;
      for (let i = 0; i < 5; i++) grid += `<path d="M0 ${122 + i * i * 3.2} H320" stroke="hsl(${h} 90% 65% / .3)" stroke-width="1"/>`;
      return `${grid}<circle cx="160" cy="84" r="62" fill="hsl(${h} 95% 60% / .18)"/><circle cx="160" cy="84" r="40" fill="hsl(${h} 95% 60% / .16)"/>
        ${sword(160, 118, -42, h)}${sword(160, 118, 42, h)}${r(150, 74, 20, 20, `hsl(${(h + 40) % 360} 90% 62%)`, 'shape-rendering="crispEdges"')}`;
    },
    smp(h) {
      const tree = (x, y, s) => `<g shape-rendering="crispEdges">${r(x + 4 * s, y + 10 * s, 4 * s, 12 * s, '#5b3a1c')}${r(x, y, 12 * s, 8 * s, '#2f8f46')}${r(x + 2 * s, y - 4 * s, 8 * s, 6 * s, '#3bb55a')}</g>`;
      return `${r(236, 20, 26, 26, '#ffd76a', 'shape-rendering="crispEdges"')}${r(240, 24, 18, 18, '#fff1b0', 'shape-rendering="crispEdges"')}
        ${r(40, 36, 44, 8, '#ffffff55')}${r(52, 30, 24, 8, '#ffffff55')}
        <path d="M0 130 L60 98 L120 124 L190 90 L260 120 L320 100 V180 H0Z" fill="hsl(${(h + 120) % 360} 45% 24%)"/>
        <path d="M0 150 L70 124 L140 146 L220 116 L320 148 V180 H0Z" fill="hsl(${(h + 110) % 360} 50% 32%)"/>
        ${tree(40, 128, 2)}${tree(98, 134, 1.5)}${tree(236, 122, 2.2)}${tree(276, 140, 1.5)}${r(0, 160, 320, 20, '#1f6b34')}${r(0, 160, 320, 4, '#3bb55a')}`;
    },
    mods(h) {
      const a = `hsl(${(h + 30) % 360} 30% 62%)`; const b = `hsl(${(h + 30) % 360} 25% 42%)`;
      let sparks = '';
      for (let i = 0; i < 14; i++) sparks += r(70 + ((i * 37) % 190), 30 + ((i * 53) % 70), 3, 3, `hsl(${(h + 20 + i * 9) % 360} 95% 70%)`);
      return `${sparks}<circle cx="160" cy="92" r="64" fill="hsl(${h} 90% 60% / .16)"/>
        <g shape-rendering="crispEdges">${r(88, 70, 144, 24, a)}${r(88, 70, 144, 6, '#fff5')}${r(64, 78, 28, 12, a)}${r(232, 78, 20, 12, b)}
        ${r(120, 94, 80, 22, b)}${r(136, 116, 48, 20, a)}${r(104, 136, 112, 16, b)}${r(104, 136, 112, 4, a)}</g>`;
    },
    cube(h) {
      const c = (l) => `hsl(${h} 70% ${l}%)`;
      return `<circle cx="160" cy="90" r="70" fill="hsl(${h} 90% 60% / .15)"/>
        <path d="M160 36 L220 66 L160 96 L100 66Z" fill="${c(66)}"/><path d="M100 66 L160 96 V160 L100 130Z" fill="${c(46)}"/><path d="M220 66 L160 96 V160 L220 130Z" fill="${c(34)}"/>
        <path d="M130 51 L190 81 M130 81 L130 145 M190 81 V145 M160 96 V160" stroke="#fff3" stroke-width="1.5"/>`;
    },
  };

  function svg(p) {
    const h = hueOf(p.id || p.name || 'a');
    const body = (scenes[kindOf(p)] || scenes.cube)(h);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 55% 11%)"/><stop offset="1" stop-color="hsl(${(h + 30) % 360} 60% 28%)"/></linearGradient>
      <radialGradient id="v" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#0000"/><stop offset="1" stop-color="#000a"/></radialGradient></defs>
      <rect width="320" height="180" fill="url(#s)"/>${body}<rect width="320" height="180" fill="url(#v)"/></svg>`;
  }

  /** URL de la imagen del pack (data URI generada o la que traiga el pack). */
  function cover(p) {
    const img = String(p.image || '');
    if (/^(https:\/\/|data:image\/)/i.test(img)) return img;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg(p));
  }
  window.AtenasArt = { cover, kindOf, hueOf };
})();
