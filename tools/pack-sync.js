#!/usr/bin/env node
'use strict';
/**
 * Arma y actualiza un modpack desde una lista de mods (Modrinth).
 *
 *   node tools/pack-sync.js <carpeta-del-pack> [--note "texto"] [--dry] [--no-manifest]
 *
 * Lee   <pack>/mods.txt      un mod por línea (slug de Modrinth). Admite:
 *                              # comentarios
 *                              create                 -> última versión compatible
 *                              create@0.5.1.f         -> versión fijada (por su número)
 * Usa   <pack>/pack.json     (minecraft + loader.type)
 * Hace  descarga los jars a  <pack>/files/mods/ (con sus dependencias obligatorias),
 *       escribe las URL en pack.json -> "sources" (los jars NO hace falta subirlos a GitHub),
 *       quita los mods que borraste de mods.txt, y regenera manifest.json.
 *
 * Los jars que pongas a mano en files/mods/ no se tocan.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildManifest } = require('./generate-manifest');

const API = 'https://api.modrinth.com/v2';
const UA = 'Atenas-Client/1.0 (pack-sync)';
const LOCK = 'mods.lock.json';
const GI_BEGIN = '# >>> pack-sync (no editar)';
const GI_END = '# <<< pack-sync';

const defaultHttp = {
  async json(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Modrinth respondió HTTP ${res.status} (${url})`);
    return res.json();
  },
  async bytes(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

function parseModsTxt(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [slug, pin] = line.split('@').map((x) => x.trim());
    if (!/^[A-Za-z0-9._-]+$/.test(slug)) throw new Error(`Línea no válida en mods.txt: "${raw}"`);
    out.push({ slug: slug.toLowerCase(), pin: pin || null });
  }
  return out;
}

const RANK = { release: 0, beta: 1, alpha: 2 };
function pickVersion(versions, pin) {
  if (!versions || !versions.length) return null;
  if (pin) return versions.find((v) => v.version_number === pin) || null;
  return [...versions].sort((a, b) =>
    (RANK[a.version_type] - RANK[b.version_type]) || (new Date(b.date_published) - new Date(a.date_published)))[0];
}

async function resolveAll(entries, { mc, loader, http, log }) {
  const resolved = new Map(); // projectId -> { slug, version, file }
  const missing = [];
  const queue = entries.map((e) => ({ ...e, wanted: true }));
  const seen = new Set();

  while (queue.length) {
    const item = queue.shift();
    const key = item.slug || item.projectId;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = item.slug || item.projectId;
    const qs = `loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
    let versions;
    if (item.versionId) {
      const v = await http.json(`${API}/version/${item.versionId}`);
      versions = v ? [v] : null;
    } else {
      versions = await http.json(`${API}/project/${id}/version?${qs}`);
    }
    const version = pickVersion(versions, item.pin);
    if (!version) {
      missing.push({ slug: id, reason: versions === null ? 'no existe en Modrinth' : `sin versión para ${loader} ${mc}`, wanted: item.wanted });
      continue;
    }
    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file || !/\.jar$/i.test(file.filename)) {
      missing.push({ slug: id, reason: 'no tiene un .jar descargable', wanted: item.wanted });
      continue;
    }
    if (!resolved.has(version.project_id)) {
      resolved.set(version.project_id, { slug: item.slug || version.project_id, version, file, explicit: item.wanted });
    }
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (resolved.has(dep.project_id) || seen.has(dep.project_id)) continue;
      queue.push({ projectId: dep.project_id, versionId: dep.version_id || null, wanted: false });
    }
  }
  return { resolved, missing };
}

const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('hex');

function updateGitignore(packDir, filenames) {
  const gi = path.join(packDir, '.gitignore');
  let cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(GI_BEGIN)}[\\s\\S]*?${esc(GI_END)}\\n?`);
  cur = cur.replace(re, '');
  const block = `${GI_BEGIN}\n${filenames.map((f) => `files/mods/${f}`).sort().join('\n')}\n${GI_END}\n`;
  fs.writeFileSync(gi, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + block);
}

async function syncPack(packDir, { note, dry = false, manifest = true, http = defaultHttp, log = console.log } = {}) {
  const metaPath = path.join(packDir, 'pack.json');
  const modsTxt = path.join(packDir, 'mods.txt');
  if (!fs.existsSync(metaPath)) throw new Error('Falta ' + metaPath);
  if (!fs.existsSync(modsTxt)) throw new Error('Falta ' + modsTxt + ' (una lista con un mod por línea)');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const loader = meta.loader && meta.loader.type;
  if (!meta.minecraft || !loader || loader === 'vanilla') throw new Error('pack.json necesita "minecraft" y "loader.type"');

  const entries = parseModsTxt(fs.readFileSync(modsTxt, 'utf8'));
  log(`Resolviendo ${entries.length} mods para ${loader} ${meta.minecraft}…`);
  const { resolved, missing } = await resolveAll(entries, { mc: meta.minecraft, loader, http, log });

  const modsDir = path.join(packDir, 'files', 'mods');
  const lockPath = path.join(packDir, LOCK);
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { mods: {} };
  const newLock = { mc: meta.minecraft, loader, mods: {} };
  const sources = { ...(meta.sources || {}) };
  for (const k of Object.keys(sources)) if (lock.mods && Object.values(lock.mods).some((m) => `mods/${m.filename}` === k)) delete sources[k];

  const summary = { added: [], updated: [], kept: 0, removed: [], deps: [] };
  const wantedFiles = new Set();
  fs.mkdirSync(modsDir, { recursive: true });

  for (const [pid, r] of resolved) {
    const filename = path.basename(r.file.filename);
    wantedFiles.add(filename);
    newLock.mods[pid] = { slug: r.slug, version: r.version.version_number, filename, explicit: r.explicit };
    sources[`mods/${filename}`] = r.file.url;
    const dest = path.join(modsDir, filename);
    const prev = lock.mods && lock.mods[pid];
    const upToDate = fs.existsSync(dest) && r.file.hashes && r.file.hashes.sha512
      && sha512(fs.readFileSync(dest)) === r.file.hashes.sha512;

    if (upToDate) { summary.kept++; continue; }
    if (dry) { log(`  ${prev ? '~' : '+'} ${filename}`); continue; }

    const buf = await http.bytes(r.file.url);
    if (r.file.hashes && r.file.hashes.sha512 && sha512(buf) !== r.file.hashes.sha512) {
      throw new Error(`El hash no coincide al descargar ${filename}`);
    }
    fs.writeFileSync(dest, buf);
    const label = r.explicit ? filename : `${filename} (dependencia)`;
    (prev ? summary.updated : summary.added).push(label);
    if (!r.explicit) summary.deps.push(filename);
    log(`  ${prev ? '~' : '+'} ${label}`);
  }

  // Quitar lo que esta herramienta instaló antes y ya no se pide (o cambió de archivo)
  for (const m of Object.values(lock.mods || {})) {
    if (wantedFiles.has(m.filename)) continue;
    const f = path.join(modsDir, m.filename);
    if (fs.existsSync(f)) {
      if (!dry) fs.unlinkSync(f);
      summary.removed.push(m.filename);
      log(`  - ${m.filename}`);
    }
  }

  if (!dry) {
    meta.sources = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    fs.writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');
    updateGitignore(packDir, [...wantedFiles]);
  }

  const problems = missing.filter((m) => m.wanted);
  const depProblems = missing.filter((m) => !m.wanted);
  if (problems.length) {
    log('\nNo se pudieron añadir (revisa el nombre en modrinth.com o búscales alternativa):');
    for (const m of problems) log(`  ! ${m.slug}: ${m.reason}`);
  }
  if (depProblems.length) {
    log('\nDependencias obligatorias que no se encontraron:');
    for (const m of depProblems) log(`  ! ${m.slug}: ${m.reason}`);
  }

  let manifestInfo = null;
  if (manifest && !dry) {
    const built = buildManifest(packDir, { note });
    fs.writeFileSync(built.outPath, JSON.stringify(built.manifest, null, 2) + '\n');
    manifestInfo = { version: built.manifest.packVersion, files: built.manifest.files.length };
    log(`\nmanifest.json listo: ${manifestInfo.files} archivos, versión ${manifestInfo.version}`);
  }
  return { summary, missing, manifestInfo };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const packDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--note');
  const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  if (!packDir) {
    console.error('Uso: node tools/pack-sync.js <carpeta-del-pack> [--note "texto"] [--dry] [--no-manifest]');
    process.exit(1);
  }
  syncPack(path.resolve(packDir), {
    note: opt('note'),
    dry: args.includes('--dry'),
    manifest: !args.includes('--no-manifest'),
  }).then(({ missing }) => {
    if (missing.some((m) => m.wanted)) process.exitCode = 2;
  }).catch((err) => { console.error('Error: ' + err.message); process.exit(1); });
}

module.exports = { syncPack, parseModsTxt, pickVersion };
