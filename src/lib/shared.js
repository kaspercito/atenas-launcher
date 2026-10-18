'use strict';
/**
 * Carpetas compartidas con la .minecraft normal, para no reconfigurar todo en cada instancia.
 *  - Carpetas (resourcepacks, screenshots, logs, saves, config): se enlazan con una "junction" (en Windows no pide permisos de administrador)
 *    o un symlink (Linux/Mac). Lo que ya había en la instancia se MEZCLA con la carpeta compartida sin pisar nada y luego se enlaza.
 *  - Archivos (servers.dat = lista de servidores, options.txt = ajustes del juego): Minecraft los reescribe cambiando el archivo, así que
 *    un enlace no sirve. Se usa SIEMPRE el de .minecraft: antes de jugar se copia a la instancia y al cerrar el juego vuelve a .minecraft.
 *    Antes de reemplazar un archivo distinto se deja una copia "<archivo>.atenas-bak". options.txt no se sincroniza entre versiones con
 *    formato de teclas distinto (1.12 o menor guarda números; 1.13 o mayor guarda nombres): mezclarlas dejaría los controles rotos.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIRS = { resourcepacks: 'resourcepacks', screenshots: 'screenshots', logs: 'logs', saves: 'saves', config: 'config' };
const FILES = { servers: 'servers.dat', options: 'options.txt' };
const DEFAULTS = { resourcepacks: true, screenshots: true, logs: true, saves: true, servers: true, options: true, config: false };

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

/** 'legacy' (1.12 o menor: teclas como números), 'modern' (1.13 o mayor: teclas con nombre) o '' si no se sabe. */
function optionsFormat(file) {
  try {
    const t = fs.readFileSync(file, 'utf8');
    if (/^key_key\.attack:-?\d+\s*$/m.test(t)) return 'legacy';
    if (/^key_key\.attack:key\./m.test(t)) return 'modern';
  } catch { /* sin archivo */ }
  return '';
}
const formatOfVersion = (mc) => {
  const minor = Number((/^1\.(\d+)/.exec(mc || '') || [])[1]);
  return Number.isFinite(minor) ? (minor <= 12 ? 'legacy' : 'modern') : '';
};

/** Copia from -> to solo si el contenido cambia; si había un archivo distinto en destino, deja <archivo>.atenas-bak. */
function copyFile(from, to) {
  const f = lstat(from);
  if (!f || !f.isFile()) return false;
  const t = lstat(to);
  if (t && t.isFile()) {
    if (fs.readFileSync(from).equals(fs.readFileSync(to))) return false;
    try { fs.copyFileSync(to, to + '.atenas-bak'); } catch { /* la copia de seguridad es opcional */ }
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/**
 * Usa el archivo de .minecraft. dir: 'toInstance' (antes de jugar: .minecraft -> instancia) o 'toMinecraft' (al cerrar: instancia -> .minecraft).
 * ctx.minecraft (p. ej. "1.20.1") sirve para no mezclar formatos distintos de options.txt.
 */
function syncFile(instanceDir, mcDir, file, dir, ctx = {}) {
  const a = path.join(mcDir, file), b = path.join(instanceDir, file);
  if (file === 'options.txt') {
    const fa = optionsFormat(a), fb = optionsFormat(b), fv = formatOfVersion(ctx.minecraft);
    const mine = fv || fb; // el formato que habla esta instancia
    if (mine && fa && mine !== fa) return `${file}: no se sincroniza (el de .minecraft es de otra versión de Minecraft y mezclarlos rompería los controles)`;
  }
  if (dir === 'toInstance') return copyFile(a, b) ? `${file}: ahora usa el de .minecraft` : '';
  return copyFile(b, a) ? `${file}: guardado en .minecraft` : '';
}

/** Antes de abrir el juego. Nunca lanza: un fallo aquí no debe impedir jugar. */
function apply(instanceDir, opts = {}, log = () => {}, ctx = {}) {
  const on = { ...DEFAULTS, ...opts };
  const mcDir = minecraftDir();
  for (const [key, name] of Object.entries(DIRS)) {
    try {
      const msg = on[key] ? linkDir(instanceDir, mcDir, name) : unlinkDir(instanceDir, name);
      if (msg) log(`[Atenas] Carpetas compartidas · ${msg}`);
    } catch (e) { log(`[Atenas] Carpetas compartidas · ${name}: no se pudo (${e.code || e.message}); se usa la de la instancia`); }
  }
  for (const [key, file] of Object.entries(FILES)) {
    try { if (on[key]) { const m = syncFile(instanceDir, mcDir, file, 'toInstance', ctx); if (m) log(`[Atenas] Carpetas compartidas · ${m}`); } } catch (e) { log(`[Atenas] ${file}: ${e.message}`); }
  }
}

/** Al cerrar el juego: la lista de servidores y los ajustes vuelven a .minecraft. */
function finish(instanceDir, opts = {}, log = () => {}, ctx = {}) {
  const on = { ...DEFAULTS, ...opts };
  for (const [key, file] of Object.entries(FILES)) {
    try { if (on[key]) { const m = syncFile(instanceDir, minecraftDir(), file, 'toMinecraft', ctx); if (m) log(`[Atenas] Carpetas compartidas · ${m}`); } } catch (e) { log(`[Atenas] ${file}: ${e.message}`); }
  }
}

module.exports = { minecraftDir, apply, finish, linkDir, unlinkDir, syncFile, DEFAULTS };
