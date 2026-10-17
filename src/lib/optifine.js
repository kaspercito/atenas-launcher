'use strict';
/**
 * OptiFine 1.8.9 en el perfil Atenas Client.
 *
 * OptiFine es de pago-opcional y su licencia NO permite redistribuirlo, asi que el launcher no lo trae:
 * el jugador lo baja de optifine.net (boton en Ajustes), lo elige una vez y el launcher lo copia a
 * <instancia>/mods antes de jugar. Se guarda una copia en <datos>/optifine para reinstalarlo si hace falta.
 */
const fs = require('fs');
const path = require('path');

const DOWNLOAD_URL = 'https://optifine.net/downloads';
const ORIGIN = 'https://optifine.net/';
// OptiFine_1.8.9_HD_U_M5.jar (tambien _L5, _I7...). Solo 1.8.9. Se aceptan los nombres que deja el navegador:
// con espacios en vez de _, con " (1)" al final (descarga repetida) o con el prefijo preview_ de las versiones de prueba.
const OF_RE = /^(?:preview_)?OptiFine[_ ]1\.8\.9[_ ]HD[_ ]U[_ ][A-Za-z]\d+(?:_pre\d+)?(?: \(\d+\))?\.jar$/;
// Cualquier jar que parezca de OptiFine: dos a la vez en mods/ hacen que Forge falle, asi que se limpian todos.
const ANY_OF_RE = /^(?:preview_)?optifine.*\.jar$/i;

const isOptiFineName = (name) => OF_RE.test(String(name || ''));
/** Nombre limpio con el que se guarda y se instala: sin espacios ni " (1)". */
const canonicalName = (name) => String(name || '').replace(/ \(\d+\)(?=\.jar$)/, '').replace(/ /g, '_');

/** Nombres de los archivos dentro de un .jar/.zip (lee solo el directorio central). Devuelve null si no se puede leer. */
function zipEntryNames(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return names.length ? names : null;
    const nl = buf.readUInt16LE(off + 28); const xl = buf.readUInt16LE(off + 30); const cl = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nl));
    off += 46 + nl + xl + cl;
  }
  return names;
}

function findStored(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter(isOptiFineName); } catch { return null; }
  if (!files.length) return null;
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

/** Busca un OptiFine 1.8.9 ya descargado en las carpetas dadas (Descargas, Escritorio, mods...). Devuelve la ruta o null. */
function scan(dirs) {
  for (const d of dirs || []) {
    let files;
    try { files = fs.readdirSync(d).filter(isOptiFineName); } catch { continue; }
    if (files.length) { files.sort(); return path.join(d, files[files.length - 1]); }
  }
  return null;
}

/** Copia un jar elegido por el jugador a la carpeta de OptiFine del launcher. Valida nombre y que sea un zip. */
function importJar(srcPath, dir) {
  const name = path.basename(String(srcPath || ''));
  if (!isOptiFineName(name)) {
    const e = new Error('Ese archivo no parece OptiFine 1.8.9. Debe llamarse como OptiFine_1.8.9_HD_U_M5.jar (baja la versión 1.8.9 en optifine.net).');
    e.code = 'BAD_OPTIFINE';
    throw e;
  }
  const head = Buffer.alloc(4);
  const fd = fs.openSync(srcPath, 'r');
  try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (head[0] !== 0x50 || head[1] !== 0x4b) { // "PK": un jar es un zip
    const e = new Error('El archivo está dañado (no es un .jar válido). Vuelve a descargarlo.');
    e.code = 'BAD_OPTIFINE';
    throw e;
  }
  const entries = zipEntryNames(srcPath);
  if (!entries) {
    const e = new Error('El archivo está dañado (no se puede leer el .jar). Vuelve a descargarlo.');
    e.code = 'BAD_OPTIFINE';
    throw e;
  }
  if (!entries.some((n) => /^(?:net\/)?optifine\//i.test(n))) {
    const e = new Error('Ese .jar no trae los archivos de OptiFine. Baja \"OptiFine 1.8.9\" (el .jar, no el instalador de otro programa) desde optifine.net.');
    e.code = 'BAD_OPTIFINE';
    throw e;
  }
  const clean = canonicalName(name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (isOptiFineName(f) && f !== clean) fs.unlinkSync(path.join(dir, f));
  fs.copyFileSync(srcPath, path.join(dir, clean));
  return clean;
}

/** Si OptiFine esta activado y aun no hay .jar guardado, busca uno ya descargado (Descargas, Escritorio...) y lo guarda. Devuelve su nombre o null. */
function autoImport({ enabled, storedDir, scanDirs }) {
  if (!enabled || findStored(storedDir)) return null;
  const found = scan(scanDirs);
  if (!found) return null;
  try { return importJar(found, storedDir); } catch { return null; }
}

/** Deja en <instancia>/mods exactamente el OptiFine guardado (o ninguno si enabled=false). Devuelve el nombre puesto o null. */
function syncToInstance({ enabled, storedDir, instanceDir }) {
  const modsDir = path.join(instanceDir, 'mods');
  let installed = [];
  try { installed = fs.readdirSync(modsDir).filter((f) => ANY_OF_RE.test(f)); } catch { /* aun no hay mods */ }
  const stored = enabled ? findStored(storedDir) : null;
  const keep = stored ? path.basename(stored) : null;
  for (const f of installed) if (f !== keep) { try { fs.unlinkSync(path.join(modsDir, f)); } catch { /* en uso */ } }
  if (!stored) return null;
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, keep);
  if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(stored).size) fs.copyFileSync(stored, dest);
  return keep;
}

// ───────── descarga automatica desde optifine.net ─────────
// No se redistribuye nada: el launcher hace en el PC del jugador lo mismo que haria el jugador (abrir optifine.net, pulsar
// el enlace de la 1.8.9 y bajar el .jar). Esas paginas pueden cambiar; si algo falla se avisa y queda el metodo manual.

/** Orden de versiones de OptiFine: M5 > L5 > I7 (letra, luego numero). */
function versionKey(name) {
  const m = /_HD_U_([A-Za-z])(\d+)/.exec(name);
  return m ? m[1].toUpperCase().charCodeAt(0) * 1000 + Number(m[2]) : -1;
}

/** De la pagina de descargas, el nombre del OptiFine 1.8.9 estable mas nuevo (sin "preview_"). null si no hay. */
function pickLatest(html) {
  const names = new Set();
  const re = /adloadx\?f=([^"'&\s<>]+?\.jar)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const n = decodeURIComponent(m[1]);
    if (isOptiFineName(n) && !/^preview_/i.test(n)) names.add(n);
  }
  const list = [...names].sort((a, b) => versionKey(b) - versionKey(a));
  return list[0] || null;
}

/** Del paso intermedio (adloadx), el enlace real de descarga (lleva un token que cambia). null si no esta. */
function pickDirectLink(html, baseUrl) {
  const m = /href\s*=\s*['"]([^'"]*downloadx\?f=[^'"]+)['"]/i.exec(String(html || ''));
  if (!m) return null;
  try { return new URL(m[1].replace(/&amp;/g, '&'), baseUrl || ORIGIN).toString(); } catch { return null; }
}

/**
 * Descarga OptiFine 1.8.9 y lo guarda en storedDir. Devuelve el nombre del .jar.
 * fetchText(url) y downloadFile(url, dest, opts) se inyectan (en el launcher vienen de net.js; en los tests son falsos).
 */
async function autoDownload({ storedDir, fetchText, downloadFile, tmpDir, onStatus }) {
  const say = (t) => { if (onStatus) onStatus(t); };
  const fail = (msg) => { const e = new Error(msg); e.code = 'OPTIFINE_DOWNLOAD'; throw e; };
  say('Buscando OptiFine 1.8.9…');
  let name;
  try { name = pickLatest(await fetchText(DOWNLOAD_URL)); } catch (e) { fail('No pude abrir optifine.net: ' + e.message); }
  if (!name) fail('No encontré OptiFine 1.8.9 en optifine.net (la página cambió).');
  const stepUrl = ORIGIN + 'adloadx?f=' + encodeURIComponent(name);
  let direct;
  try { direct = pickDirectLink(await fetchText(stepUrl), stepUrl); } catch (e) { fail('No pude preparar la descarga: ' + e.message); }
  if (!direct) fail('optifine.net no dio el enlace de descarga (la página cambió).');
  say('Descargando ' + name + '…');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, name);
  try {
    try { await downloadFile(direct, tmp, { retries: 2, headers: { Referer: stepUrl, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtenasClient' } }); }
    catch (e) { fail(e.message); }
    return importJar(tmp, storedDir); // comprueba que de verdad sea OptiFine (no una pagina de error)
  } finally { try { fs.unlinkSync(tmp); } catch { /* ya no esta */ } }
}

function status(storedDir, scanDirs) {
  const f = findStored(storedDir);
  const found = !f && scanDirs ? scan(scanDirs) : null;
  return { available: !!f, file: f ? path.basename(f) : null, found: found ? path.basename(found) : null, downloadUrl: DOWNLOAD_URL };
}

module.exports = { DOWNLOAD_URL, pickLatest, pickDirectLink, autoDownload, isOptiFineName, canonicalName, zipEntryNames, findStored, scan, importJar, autoImport, syncToInstance, status };
