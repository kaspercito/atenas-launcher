'use strict';
/**
 * Instalador de Forge "clásico" (1.7.10 – 1.12.2, p. ej. Forge 1.8.9) hecho por nosotros.
 *
 * Esos instaladores no traen procesadores: dentro del .jar hay un install_profile.json con
 *   - install.path / install.filePath  -> el jar "universal" de Forge (se copia a libraries/)
 *   - versionInfo                      -> el json de la versión (se copia a versions/<id>/<id>.json)
 * y el resto son librerías que hay que bajar. Así no dependemos de las opciones de línea de comandos
 * del instalador antiguo (que no siempre aceptan una carpeta de destino).
 */
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./net');

const FORGE_MAVEN = 'https://maven.minecraftforge.net/';
const MOJANG_LIBS = 'https://libraries.minecraft.net/';
const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2/';

/** group:artifact:version[:classifier][@ext] -> ruta relativa tipo Maven. */
function mavenPath(name) {
  let ext = 'jar';
  let n = String(name);
  const at = n.indexOf('@');
  if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [g, a, v, c] = n.split(':');
  if (!g || !a || !v) throw new Error('Librería con nombre inválido: ' + name);
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

/** Las URLs antiguas de Forge (http://files.minecraftforge.net/maven/) ya no sirven: ahora es maven.minecraftforge.net. */
function normalizeBase(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (/^https?:\/\/files\.minecraftforge\.net\/maven\/?/i.test(u)) return FORGE_MAVEN;
  return u.endsWith('/') ? u : u + '/';
}

/** Dónde intentar bajar una librería, en orden. */
function candidateUrls(lib, rel, fallbacks = [MOJANG_LIBS, FORGE_MAVEN, MAVEN_CENTRAL]) {
  const urls = [];
  const base = normalizeBase(lib.url);
  if (base) urls.push(base + rel);
  for (const f of fallbacks) urls.push(f + rel);
  return [...new Set(urls)];
}

function readInstallProfile(zip) {
  const entry = zip.getEntry('install_profile.json');
  if (!entry) { const e = new Error('El instalador no trae install_profile.json'); e.code = 'NOT_LEGACY'; throw e; }
  let profile;
  try { profile = JSON.parse(zip.readAsText(entry)); }
  catch { const e = new Error('install_profile.json ilegible'); e.code = 'NOT_LEGACY'; throw e; }

  // Formato moderno (1.13+): lleva procesadores; ese se instala con el instalador oficial.
  if (Array.isArray(profile.processors) || profile.data) { const e = new Error('Instalador moderno'); e.code = 'NOT_LEGACY'; throw e; }

  let versionInfo = profile.versionInfo;
  if (!versionInfo) {
    const v = zip.getEntry('version.json');
    if (v) { try { versionInfo = JSON.parse(zip.readAsText(v)); } catch { /* se avisa abajo */ } }
  }
  if (!versionInfo || !versionInfo.id || !Array.isArray(versionInfo.libraries)) {
    const e = new Error('El instalador no trae la información de versión'); e.code = 'NOT_LEGACY'; throw e;
  }
  return { install: profile.install || {}, versionInfo };
}

/** Una librería es opcional si solo la necesita el servidor. */
function isOptional(lib) {
  if (lib.clientreq === false) return true;
  return lib.serverreq === true && lib.clientreq === undefined;
}

/**
 * Instala Forge clásico en instanceDir a partir del .jar del instalador ya descargado.
 * Devuelve el id de versión creado (el que hay que lanzar).
 */
async function installLegacyForge(installerJar, instanceDir, log = () => {}, { fallbacks } = {}) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(installerJar);
  const { install, versionInfo } = readInstallProfile(zip);
  const id = versionInfo.id;
  const forgeName = install.path || (versionInfo.libraries.find((l) => /^net\.minecraftforge:forge:/.test(l.name)) || {}).name;
  if (!forgeName) throw new Error('No se encontró el jar de Forge dentro del instalador');

  const libsDir = path.join(instanceDir, 'libraries');

  // 1) jar universal de Forge
  const universalRel = mavenPath(forgeName);
  const universalDest = path.join(libsDir, universalRel);
  const universalEntry =
    (install.filePath && zip.getEntry(install.filePath)) ||
    zip.getEntries().find((e) => /-universal\.jar$/i.test(e.entryName) && !e.isDirectory);
  if (!universalEntry) throw new Error('El instalador no trae el jar universal de Forge');
  fs.mkdirSync(path.dirname(universalDest), { recursive: true });
  fs.writeFileSync(universalDest, universalEntry.getData());

  // 2) librerías
  const libs = versionInfo.libraries.filter((l) => l && l.name && l.name !== forgeName);
  log(`Descargando librerías de Forge (${libs.length})…`);
  const failed = [];
  let idx = 0;
  async function worker() {
    for (;;) {
      const lib = libs[idx++];
      if (!lib) return;
      let rel;
      try { rel = mavenPath(lib.name); } catch (e) { if (!isOptional(lib)) failed.push(lib.name); continue; }
      const dest = path.join(libsDir, rel);
      try { if (fs.statSync(dest).size > 0) continue; } catch { /* no existe: se descarga */ }
      let ok = false;
      for (const url of candidateUrls(lib, rel, fallbacks)) {
        try { await downloadFile(url, dest, { retries: 2 }); ok = true; break; } catch { /* siguiente origen */ }
      }
      if (!ok && !isOptional(lib)) failed.push(lib.name);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, libs.length || 1) }, worker));
  if (failed.length) {
    throw new Error('No se pudieron descargar librerías de Forge: ' + failed.slice(0, 4).join(', ') + (failed.length > 4 ? '…' : '') + '. Revisa tu internet y vuelve a intentarlo.');
  }

  // 3) json de la versión (al final: si algo falló antes, la próxima vez se reintenta todo)
  const dir = path.join(instanceDir, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(versionInfo, null, 2));
  return id;
}

module.exports = { installLegacyForge, mavenPath, normalizeBase, candidateUrls, readInstallProfile };
