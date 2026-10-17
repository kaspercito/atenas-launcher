'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('minecraft-launcher-core');

/**
 * MCLC ignora los argumentos de JVM del json de Forge/NeoForge (1.17+): módulos, --add-opens, -DignoreList...
 * Sin ellos el juego se cae con "module java.base does not opens java.lang.invoke". Los leemos nosotros.
 */
function loaderJvmArgs(instanceDir, customId) {
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(instanceDir, 'versions', customId, `${customId}.json`), 'utf8')); }
  catch { return []; }
  const subs = {
    library_directory: path.join(instanceDir, 'libraries'),
    classpath_separator: path.delimiter,
    version_name: customId,
  };
  const raw = (json.arguments?.jvm || []).filter((a) => typeof a === 'string');
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '-cp' || a === '-classpath') { i++; continue; }              // el classpath lo arma MCLC
    if (/\$\{(natives_directory|launcher_name|launcher_version|classpath)\}/.test(a)) continue;
    const v = a.replace(/\$\{(\w+)\}/g, (m, k) => (k in subs ? subs[k] : m));
    if (/\$\{\w+\}/.test(v)) continue;                                      // placeholder que no sabemos resolver
    out.push(v);
  }
  return out;
}

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

/** --quickPlayMultiplayer existe desde 1.20; antes (1.8.9, 1.12…) se entra con --server/--port. */
function quickPlayFor(manifest) {
  if (!manifest.server) return null;
  const minor = Number((/^1\.(\d+)/.exec(manifest.minecraft || '') || [])[1]);
  return { type: minor && minor < 20 ? 'legacy' : 'multiplayer', identifier: manifest.server };
}

function launchGame({ manifest, instanceDir, mclcAuth, javaPath, customId, ramMb, optimizedJvm = true, extraJvm = [], fullscreen = false, hooks = {} }) {
  const launcher = new Client();
  const packMax = parseMb(manifest.ram?.max, null);
  const maxMb = ramMb || packMax || 4096;
  const minMb = Math.min(parseMb(manifest.ram?.min, 2048), maxMb);
  const ramSource = ramMb ? 'ajuste del jugador en el launcher' : packMax ? 'pack.json del modpack' : 'valor por defecto (el manifest no trae "ram")';
  if (hooks.onLog) hooks.onLog(`[Atenas] RAM: -Xmx${toMem(maxMb)} -Xms${toMem(minMb)} · origen: ${ramSource}` + (ramMb && packMax && ramMb !== packMax ? ` · ojo: el pack pide ${toMem(packMax)}` : ''));

  const opts = {
    authorization: mclcAuth,
    root: instanceDir,
    javaPath,
    version: { number: manifest.minecraft, type: 'release' },
    memory: { max: toMem(maxMb), min: toMem(minMb) },
  };
  const extra = customId ? loaderJvmArgs(instanceDir, customId) : [];
  const jvm = [...(optimizedJvm ? OPTIMIZED_JVM_ARGS : []), ...extra, ...extraJvm];
  if (extraJvm.length && hooks.onLog) hooks.onLog(`[Atenas] Argumentos JVM extra: ${extraJvm.join(' ')}`);
  if (fullscreen) opts.window = { fullscreen: true };
  if (jvm.length) opts.customArgs = jvm;
  if (customId) opts.version.custom = customId;
  const quickPlay = quickPlayFor(manifest);
  if (quickPlay) opts.quickPlay = quickPlay;

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

module.exports = { launchGame, parseMb, loaderJvmArgs, quickPlayFor };
