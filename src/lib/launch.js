'use strict';
const { Client } = require('minecraft-launcher-core');

function toMem(mb) {
  mb = Math.max(512, Math.round(mb));
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

/** "4G" / "2048M" / 4096 -> MB */
function parseMb(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'number') return v;
  const m = /^(\d+)\s*([GgMm])/.exec(String(v));
  if (!m) return fallback;
  return /g/i.test(m[2]) ? Number(m[1]) * 1024 : Number(m[1]);
}

/**
 * Lanza Minecraft. Devuelve una promesa que se resuelve cuando el juego se cierra.
 * hooks: { onLog(line), onStarted(), onProgress(p) }
 */
/** Argumentos de G1GC pensados para cliente con mods: menos pausas al cargar chunks. */
const OPTIMIZED_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=130',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=25',
  '-XX:G1MaxNewSizePercent=45',
  '-XX:G1HeapRegionSize=16M',
  '-XX:G1ReservePercent=20',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:SurvivorRatio=32',
  '-XX:MaxTenuringThreshold=1',
  '-XX:+PerfDisableSharedMem',
];

function launchGame({ manifest, instanceDir, mclcAuth, javaPath, customId, ramMb, optimizedJvm = true, hooks = {} }) {
  const launcher = new Client();
  const maxMb = ramMb || parseMb(manifest.ram?.max, 4096);
  const minMb = Math.min(parseMb(manifest.ram?.min, 2048), maxMb);

  const opts = {
    authorization: mclcAuth,
    root: instanceDir,
    javaPath,
    version: { number: manifest.minecraft, type: 'release' },
    memory: { max: toMem(maxMb), min: toMem(minMb) },
  };
  if (optimizedJvm) opts.customArgs = OPTIMIZED_JVM_ARGS;
  if (customId) opts.version.custom = customId;
  if (manifest.server) {
    opts.quickPlay = { type: 'multiplayer', identifier: manifest.server };
  }

  return new Promise((resolve, reject) => {
    let started = false;
    const log = (e) => hooks.onLog && hooks.onLog(String(e).trimEnd());
    launcher.on('debug', log);
    launcher.on('data', (e) => {
      log(e);
      if (!started && /Setting user|LWJGL|Loading/i.test(String(e))) {
        started = true;
        hooks.onStarted && hooks.onStarted();
      }
    });
    launcher.on('progress', (p) => hooks.onProgress && hooks.onProgress(p));
    launcher.on('close', (code) => resolve(code));
    launcher.launch(opts).then((proc) => {
      if (!proc) reject(new Error('No se pudo iniciar Minecraft (revisa el registro)'));
    }).catch(reject);
  });
}

module.exports = { launchGame, parseMb };
