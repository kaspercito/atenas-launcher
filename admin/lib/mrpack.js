'use strict';
/**
 * Importa un modpack de Modrinth (.mrpack) como un pack nuevo de Atenas.
 *
 *  - Lee modrinth.index.json: versión de Minecraft, loader y lista de archivos.
 *  - Los mods que existen en Modrinth pasan a mods.txt con su versión fijada (slug@versión):
 *    así quedan editables desde el admin y se descargan al publicar, sin subir los .jar a GitHub.
 *  - Lo que no está en Modrinth (o no se puede fijar) se descarga y se guarda como .jar propio.
 *  - Las carpetas overrides/ y client-overrides/ (configs, kubejs, etc.) se copian a files/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const mf = require('./modsfile');
const { MAX_FILE } = require('./packs');

const API = 'https://api.modrinth.com/v2';
const UA = 'Atenas-Admin/1.1 (mrpack-import)';
const LOADER_KEYS = { neoforge: 'neoforge', forge: 'forge', 'fabric-loader': 'fabric', 'quilt-loader': 'quilt' };
// El formato .mrpack solo permite estos orígenes de descarga
const DOWNLOAD_HOSTS = /^https:\/\/(cdn\.modrinth\.com|github\.com|raw\.githubusercontent\.com|gitlab\.com)\//;
const SKIP_OVERRIDE = new Set(['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt']);

const defaultHttp = {
  async json(url, body) {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Modrinth respondió HTTP ${res.status}`);
    return res.json();
  },
  async bytes(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

const hash = (alg, buf) => crypto.createHash(alg).update(buf).digest('hex');

/** Lee y valida modrinth.index.json. No descarga nada. */
function readIndex(file) {
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('Ese archivo no es un .mrpack válido (no se pudo abrir como zip).'); }
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('Ese archivo no tiene modrinth.index.json: ¿es un .mrpack de Modrinth? (Los .zip de CurseForge no se pueden importar así.)');
  let idx;
  try { idx = JSON.parse(zip.readAsText(entry)); } catch { throw new Error('El modrinth.index.json del paquete está dañado.'); }
  if (idx.game && idx.game !== 'minecraft') throw new Error('Este paquete no es de Minecraft.');
  const deps = idx.dependencies || {};
  const mc = deps.minecraft;
  const key = Object.keys(LOADER_KEYS).find((k) => deps[k]);
  if (!mc) throw new Error('El paquete no indica la versión de Minecraft.');
  if (!key) throw new Error('El paquete no usa un loader soportado (NeoForge, Forge, Fabric o Quilt).');
  const files = (idx.files || []).map((f) => ({
    path: String(f.path || '').replace(/\\/g, '/'),
    sha1: f.hashes && f.hashes.sha1,
    sha512: f.hashes && f.hashes.sha512,
    downloads: Array.isArray(f.downloads) ? f.downloads : [],
    size: f.fileSize || 0,
    clientOnlyOff: !!(f.env && f.env.client === 'unsupported'), // mod solo de servidor
  }));
  return {
    zip,
    name: idx.name || path.basename(file, path.extname(file)),
    summary: idx.summary || '',
    versionId: idx.versionId || '',
    minecraft: mc,
    loader: { type: LOADER_KEYS[key], version: String(deps[key]) },
    files,
    overrides: zip.getEntries().filter((e) => !e.isDirectory && /^(client-)?overrides\//.test(e.entryName)).length,
  };
}

/** Datos que el asistente necesita para rellenar el formulario. */
function inspect(file) {
  const p = readIndex(file);
  const mods = p.files.filter((f) => /^mods\/[^/]+\.jar$/i.test(f.path) && !f.clientOnlyOff);
  return { name: p.name, summary: p.summary, versionId: p.versionId, minecraft: p.minecraft, loader: p.loader, mods: mods.length, overrides: p.overrides };
}

/** Extrae overrides/ y client-overrides/ dentro de files/ sin salirse de esa carpeta. */
function extractOverrides(parsed, filesDir, report) {
  const base = path.resolve(filesDir);
  // client-overrides va después para que pise a overrides (como hace Modrinth)
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const e of parsed.zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = e.entryName.slice(prefix.length);
      if (!rel || SKIP_OVERRIDE.has(rel)) continue;
      const dest = path.resolve(base, rel);
      if (dest !== base && !dest.startsWith(base + path.sep)) { report.skipped.push(`${rel} (ruta no permitida)`); continue; }
      if (e.header.size > MAX_FILE) { report.skipped.push(`${rel} (muy grande para GitHub)`); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
      report.overrides++;
    }
  }
}

/** sha1 -> { slug, version_number } usando la API de Modrinth. */
async function lookup(hashes, http) {
  const byHash = new Map();
  for (let i = 0; i < hashes.length; i += 150) {
    const chunk = hashes.slice(i, i + 150);
    const res = await http.json(`${API}/version_files`, { hashes: chunk, algorithm: 'sha1' });
    for (const [h, v] of Object.entries(res || {})) byHash.set(h, v);
  }
  const ids = [...new Set([...byHash.values()].map((v) => v.project_id))];
  const slugOf = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const projects = await http.json(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const p of projects || []) slugOf.set(p.id, p.slug);
  }
  const out = new Map();
  for (const [h, v] of byHash) out.set(h, { slug: slugOf.get(v.project_id) || v.project_id, version: v.version_number });
  return out;
}

async function download(f, http) {
  const url = f.downloads.find((u) => DOWNLOAD_HOSTS.test(u));
  if (!url) throw new Error('sin enlace de descarga permitido');
  const buf = await http.bytes(url);
  if (f.sha512 && hash('sha512', buf) !== f.sha512) throw new Error('el hash no coincide');
  if (buf.length > MAX_FILE) throw new Error('pesa demasiado para GitHub');
  return buf;
}

/**
 * Aplica el .mrpack sobre un pack ya creado (pack.json + mods.txt vacíos).
 * Devuelve { overrides, pinned, downloaded, skipped[] }.
 */
async function importInto(packDir, file, { http = defaultHttp, log = () => {} } = {}) {
  const parsed = readIndex(file);
  const filesDir = path.join(packDir, 'files');
  const report = { overrides: 0, pinned: 0, downloaded: 0, skipped: [] };
  fs.mkdirSync(filesDir, { recursive: true });

  log(`Copiando configuraciones (${parsed.overrides} archivos)…`);
  extractOverrides(parsed, filesDir, report);

  const wanted = parsed.files.filter((f) => f.path && !f.clientOnlyOff);
  const isMod = (f) => /^mods\/[^/]+\.jar$/i.test(f.path);
  const mods = wanted.filter(isMod);
  const others = wanted.filter((f) => !isMod(f));

  let found = new Map();
  if (mods.length) {
    log(`Buscando ${mods.length} mods en Modrinth…`);
    try { found = await lookup(mods.map((m) => m.sha1).filter(Boolean), http); }
    catch (e) { log(`  ! No pude consultar Modrinth (${e.message}). Los mods se descargarán uno a uno.`); }
  }

  const modsTxt = path.join(packDir, 'mods.txt');
  let txt = fs.readFileSync(modsTxt, 'utf8');
  const manual = [];
  for (const m of mods) {
    const hit = found.get(m.sha1);
    if (hit && mf.SLUG_RE.test(hit.slug) && /^[^\s#@]+$/.test(hit.version || '')) {
      try { txt = mf.addMod(txt, { slug: hit.slug, pin: hit.version, section: 'Importados' }); report.pinned++; continue; }
      catch { continue; } // ya estaba (el mismo mod dos veces)
    }
    manual.push(m);
  }
  fs.writeFileSync(modsTxt, txt);

  for (const f of [...manual, ...others]) {
    const dest = path.resolve(filesDir, f.path);
    if (!dest.startsWith(path.resolve(filesDir) + path.sep)) { report.skipped.push(`${f.path} (ruta no permitida)`); continue; }
    try {
      log(`Descargando ${path.basename(f.path)}…`);
      const buf = await download(f, http);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      report.downloaded++;
    } catch (e) {
      report.skipped.push(`${f.path} (${e.message})`);
    }
  }
  return report;
}

module.exports = { inspect, readIndex, importInto, lookup };
