'use strict';
// Tipo de pack (pvp / smp / mods / cube): decide el icono que se ve en Discord, en el launcher y en el juego.
// Mismas reglas que renderer/packart.js, para que el icono sea el mismo en todos lados.
function packKind(p) {
  p = p || {};
  const t = `${p.id || ''} ${p.name || ''}`.toLowerCase();
  const loader = String(p.loader || '').toLowerCase();
  if (/pvp|client|cliente|arena|bedwars|duel/.test(t) || /^1\.8(\.|$)/.test(p.minecraft || '')) return 'pvp';
  if (/smp|survival|supervivencia|vanilla|server|servidor/.test(t) && !/forge|fabric/.test(loader)) return 'smp';
  if (/forge|fabric|quilt|neoforge/.test(loader)) return 'mods';
  return 'cube';
}
const KIND_LABEL = { pvp: 'PvP', smp: 'Supervivencia', mods: 'Modpack', cube: 'Minecraft' };

/** Propiedades -D que lee el mod de Atenas dentro del juego (servidor destacado con ★, icono del pack). */
function gameProps(manifest) {
  const m = manifest || {};
  const clean = (v) => String(v == null ? '' : v).replace(/[\r\n"]/g, ' ').trim().slice(0, 120);
  const out = [];
  if (m.server) out.push('-Datenas.server=' + clean(m.server));
  if (m.serverName || m.name) out.push('-Datenas.servername=' + clean(m.serverName || m.name));
  if (m.name) out.push('-Datenas.pack=' + clean(m.name));
  out.push('-Datenas.kind=' + packKind(m));
  return out;
}
module.exports = { packKind, KIND_LABEL, gameProps };
