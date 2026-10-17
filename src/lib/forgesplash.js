'use strict';
/**
 * Apaga la pantalla de carga propia de Forge 1.8.9 ("Minecraft Forge: cargando mods" con sus barras de progreso).
 * Forge la controla con <instancia>/config/splash.properties (enabled=true/false). La carga que se ve al abrir el
 * cliente es solo la de Atenas, que ademas tapa la pantalla roja de Mojang hasta que el menu principal esta listo.
 */
const fs = require('fs');
const path = require('path');

/** Contenido nuevo del archivo con enabled=false, conservando el resto de ajustes que ya hubiera. */
function patchSplash(text) {
  const src = String(text || '');
  if (/^\s*enabled\s*=/im.test(src)) return src.replace(/^(\s*)enabled\s*=.*$/im, '$1enabled=false');
  return `${src}${src && !src.endsWith('\n') ? '\n' : ''}enabled=false\n`;
}

/** Solo Minecraft 1.12 o anterior usa este archivo (desde 1.13 Forge cambio de sistema). */
const isLegacy = (mc) => { const m = /^1\.(\d+)/.exec(String(mc || '')); return !!m && Number(m[1]) <= 12; };

/** Escribe config/splash.properties con la pantalla de Forge apagada. Devuelve true si cambio algo. */
function disableForgeSplash(instanceDir, mcVersion) {
  if (!isLegacy(mcVersion)) return false;
  const file = path.join(instanceDir, 'config', 'splash.properties');
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch { /* aun no existe */ }
  const next = patchSplash(cur);
  if (next === cur) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

module.exports = { patchSplash, disableForgeSplash, isLegacy };
