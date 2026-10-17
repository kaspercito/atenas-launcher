'use strict';
/**
 * Carpeta única del launcher: %USERPROFILE%\.atenasclient (o ATENAS_HOME si se define).
 *
 *   .atenasclient/
 *     config/      settings.json, auth.json (ajustes y cuenta)
 *     instances/   una carpeta por modpack/perfil (mods, mundos, options.txt…)
 *     runtime/     Java descargado (java-8, java-17…)
 *     cache/       listas de packs, última release del cliente, caché de Electron
 *     client-local/  jar de prueba del cliente (AtenasClient-X.Y.Z.jar)
 *     optifine/    OptiFine 1.8.9 que baja el propio jugador (no se redistribuye)
 *     logs/        updater.log y registros
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function layout(root = process.env.ATENAS_HOME || path.join(os.homedir(), '.atenasclient')) {
  const cache = path.join(root, 'cache');
  const config = path.join(root, 'config');
  return {
    root,
    config,
    instances: path.join(root, 'instances'),
    runtime: path.join(root, 'runtime'),
    cache,
    electron: path.join(cache, 'electron'),
    clientLocal: path.join(root, 'client-local'),
    optifine: path.join(root, 'optifine'),
    logs: path.join(root, 'logs'),
    settings: path.join(config, 'settings.json'),
    auth: path.join(config, 'auth.json'),
    packsCache: path.join(cache, 'packs-cache.json'),
    clientRelease: path.join(cache, 'client-release.json'),
  };
}

function ensure(L) {
  for (const k of ['root', 'config', 'instances', 'runtime', 'cache', 'electron', 'clientLocal', 'optifine', 'logs']) fs.mkdirSync(L[k], { recursive: true });
  return L;
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); return; } catch (e) { if (!['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e; }
  // otro disco o archivo en uso: copiar y, solo si salió bien, borrar el original
  fs.cpSync(from, to, { recursive: true, errorOnExist: false, force: false });
  fs.rmSync(from, { recursive: true, force: true });
}

/**
 * Trae lo que había en la carpeta antigua (%APPDATA%\Atenas Launcher). Nunca pisa nada que ya exista en la nueva
 * y no toca lo que no conoce. Devuelve la lista de lo movido.
 */
function migrate(oldDir, L, log = () => {}) {
  const marker = path.join(L.config, '.migrado');
  if (!oldDir || fs.existsSync(marker) || !fs.existsSync(oldDir)) return [];
  const plan = [
    ['settings.json', L.settings], ['auth.json', L.auth], ['instances', L.instances], ['runtime', L.runtime],
    ['packs-cache.json', L.packsCache], ['client-release.json', L.clientRelease], ['client-local', L.clientLocal],
    ['updater.log', path.join(L.logs, 'updater.log')],
  ];
  const done = [];
  for (const [rel, dest] of plan) {
    const src = path.join(oldDir, rel);
    if (!fs.existsSync(src)) continue;
    // las carpetas vacías que creó ensure() no cuentan como "ya existe"
    const occupied = fs.existsSync(dest) && !(fs.statSync(dest).isDirectory() && fs.readdirSync(dest).length === 0);
    if (occupied) continue;
    try { if (fs.existsSync(dest)) fs.rmdirSync(dest); move(src, dest); done.push(rel); log(`Migrado ${rel}`); }
    catch (e) { log(`No se pudo migrar ${rel}: ${e.message}`); }
  }
  fs.mkdirSync(L.config, { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ from: oldDir, at: new Date().toISOString(), moved: done }));
  return done;
}

module.exports = { layout, ensure, migrate };
