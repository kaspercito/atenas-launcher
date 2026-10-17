'use strict';
/**
 * Convierte lo que escribe Minecraft/Forge en la consola en un progreso (0-100) y un texto, para la ventana de carga de Atenas.
 * No hay un "porcentaje real" de Forge 1.8.9, asi que se usan hitos (lineas que siempre salen en ese orden) y, entre hito
 * e hito, la barra avanza despacio sola (creep) para que nunca parezca congelada. Nunca retrocede.
 */
const READY_RE = /\[Atenas\] MENU_READY/;
// Cualquier modpack (sin el cliente de Atenas): el sonido arranca cuando el juego ya abrio su ventana y esta por mostrar el menu.
const SOUND_RE = /Sound engine started|Starting up SoundSystem|SoundSystem started/i;

// [porcentaje, texto, regex]; el orden importa: solo se avanza.
const STAGES = [
  [8,  'Iniciando Java',            /Setting user|Launching wrapped|Loading tweak class/i],
  [20, 'Cargando Forge',            /ForgeModLoader|Forge Mod Loader version|FMLTweaker|Loading tweak class: net\.minecraftforge/i],
  [32, 'Preparando el cliente',     /Mixin|MixinTweaker|SpongePowered/i],
  [44, 'Reconociendo mods',         /identified \d+ mods? to load|Found \d+ mods?|Attempting connection/i],
  [58, 'Cargando mods',             /Constructing|Pre-?Initializ|PreInit|Processing ObjectHolder/i],
  [72, 'Iniciando mods',            /(?<!Pre-)(?<!Post-)Initializ(?:ing|ation)|Reloading ResourceManager|Narrator|OpenAL/i],
  [84, 'Cargando texturas y sonidos', /Post-?Initializ|textures-atlas|Created: \d+x\d+|Loading sounds|Sound engine/i],
  [93, 'Casi listo',                /Starting up SoundSystem|Sound engine started|SoundSystem shutdown|Loaded \d+ (?:sounds|recipes)/i],
];

function createTracker() {
  let pct = 3;
  let text = 'Preparando el juego';
  let cap = 8; // hasta donde puede "creep" mientras no llega el siguiente hito
  let done = false;
  let sound = false; // el motor de sonido ya arranco: el juego esta casi en el menu aunque no haya llegado MENU_READY
  return {
    /** Procesa una linea de la consola. Devuelve el estado actual { pct, text, ready, sound }. */
    feed(line) {
      const s = String(line || '');
      if (READY_RE.test(s)) { done = true; pct = 100; text = 'Listo'; return { pct, text, ready: true, sound }; }
      if (SOUND_RE.test(s)) sound = true;
      for (const [p, t, re] of STAGES) {
        if (p > pct && re.test(s)) { pct = p; text = t; cap = Math.min(97, p + 10); }
      }
      return { pct: Math.round(pct), text, ready: done, sound };
    },
    /** Fase previa al juego (descargas): pone texto y porcentaje solo si todavia no hay un hito del juego. */
    hint(t, p) {
      if (done || pct >= 8) return { pct: Math.round(pct), text, ready: done };
      text = t;
      if (typeof p === 'number' && p > pct) pct = Math.min(7, p);
      return { pct: Math.round(pct), text, ready: done };
    },
    /** Avance lento entre hitos (se llama cada ~400 ms). */
    creep() {
      if (!done && pct < cap) pct = Math.min(cap, pct + 0.35);
      return { pct: Math.round(pct), text, ready: done };
    },
    get state() { return { pct: Math.round(pct), text, ready: done }; },
  };
}

module.exports = { createTracker, READY_RE, SOUND_RE };
