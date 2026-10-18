'use strict';
/**
 * Carpetas compartidas con la .minecraft normal, para no reconfigurar todo en cada instancia.
 *  - Carpetas (resourcepacks, screenshots, logs, config): se enlazan con una "junction" (en Windows no pide permisos de administrador)
 *    o un symlink (Linux/Mac). Lo que ya había en la instancia se MEZCLA con la carpeta compartida sin pisar nada y luego se enlaza.
 *  - servers.dat (la lista de servidores): Minecraft lo reescribe cambiando el archivo, así que un enlace no sirve. Se sincroniza:
 *    antes de jugar gana el más nuevo y al cerrar el juego se copia de vuelta a .minecraft.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIRS = { resourcepacks: 'resourcepacks', screenshots: 'screenshots', logs: 'logs', config: 'config' };
const DEFAULTS = { resourcepacks: true, screenshots: true, logs: true, servers: true, config: false };

function minecraftDir() {
  if (process.env.ATENAS_MC_DIR) return process.env.ATENAS_MC_DIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
  return path.join(os.homedir(), '.minecraft');
}

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };

function removeLink(p) {
  try { fs.unlinkSync(p); return; } catch { /* en Windows una junction a veces pide rmdir */ }
  fs.rmdirSync(p);
}

/** Enlaza instanceDir/name -> mcDir/name. Devuelve un texto para el log, o '' si no hubo nada que hacer. */
function linkDir(instanceDir, mcDir, name) {
  const inst = path.join(instanceDir, name);
  const target = path.join(mcDir, name);
  fs.mkdirSync(target, { recursive: true });
  const st = lstat(inst);
  if (st && st.isSymbolicLink()) {
    if (same(inst, target)) return '';
    removeLink(inst); // apuntaba a otra parte
  } else if (st && st.isDirectory()) {
    fs.cpSync(inst, target, { recursive: true, force: false, errorOnExist: false }); // mezcla sin pisar lo que ya hay en .minecraft
    fs.rmSync(inst, { recursive: true, force: true });
  } else if (st) {
    return `${name}: hay un archivo con ese nombre en la instancia, no se enlazó`;
  }
  fs.mkdirSync(path.dirname(inst), { recursive: true });
  fs.symlinkSync(target, inst, process.platform === 'win32' ? 'junction' : 'dir');
  return `${name}: ahora usa la de .minecraft`;
}

/** Quita el enlace y deja una carpeta normal con una copia de lo compartido (así no se pierde nada al apagar la opción). */
function unlinkDir(instanceDir, name) {
  const inst = path.join(instanceDir, name);
  const st = lstat(inst);
  if (!st || !st.isSymbolicLink()) return '';
  let target = '';
  try { target = fs.realpathSync(inst); } catch { /* destino borrado */ }
  removeLink(inst);
  fs.mkdirSync(inst, { recursive: true });
  if (target) fs.cpSync(target, inst, { recursive: true, force: false, errorOnExist: false });
  return `${name}: vuelve a ser propia de la instancia (con una copia de lo compartido)`;
}

const mtime = (p) => { const s = lstat(p); return s && s.isFile() ? s.mtimeMs : 0; };

/** Copia el más nuevo sobre el más viejo. dir: 'toInstance' (antes de jugar) o 'toMinecraft' (al cerrar). */
function syncFile(instanceDir, mcDir, file, dir) {
  const a = path.join(mcDir, file), b = path.join(instanceDir, file);
  const ma = mtime(a), mb = mtime(b);
  if (dir === 'toInstance') {
    if (ma > mb) { fs.mkdirSync(instanceDir, { recursive: true }); fs.copyFileSync(a, b); return `${file}: copiado desde .minecraft`; }
  } else if (mb > ma) { fs.mkdirSync(mcDir, { recursive: true }); fs.copyFileSync(b, a); return `${file}: guardado también en .minecraft`; }
  return '';
}

/** Antes de abrir el juego. Nunca lanza: un fallo aquí no debe impedir jugar. */
function apply(instanceDir, opts = {}, log = () => {}) {
  const on = { ...DEFAULTS, ...opts };
  const mcDir = minecraftDir();
  for (const [key, name] of Object.entries(DIRS)) {
    try {
      const msg = on[key] ? linkDir(instanceDir, mcDir, name) : unlinkDir(instanceDir, name);
      if (msg) log(`[Atenas] Carpetas compartidas · ${msg}`);
    } catch (e) { log(`[Atenas] Carpetas compartidas · ${name}: no se pudo (${e.code || e.message}); se usa la de la instancia`); }
  }
  try { if (on.servers) { const m = syncFile(instanceDir, mcDir, 'servers.dat', 'toInstance'); if (m) log(`[Atenas] Carpetas compartidas · ${m}`); } } catch (e) { log(`[Atenas] servers.dat: ${e.message}`); }
}

/** Al cerrar el juego: la lista de servidores vuelve a .minecraft. */
function finish(instanceDir, opts = {}, log = () => {}) {
  if (!{ ...DEFAULTS, ...opts }.servers) return;
  try { const m = syncFile(instanceDir, minecraftDir(), 'servers.dat', 'toMinecraft'); if (m) log(`[Atenas] Carpetas compartidas · ${m}`); } catch (e) { log(`[Atenas] servers.dat: ${e.message}`); }
}

module.exports = { minecraftDir, apply, finish, linkDir, unlinkDir, syncFile, DEFAULTS };
