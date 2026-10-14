#!/usr/bin/env node
'use strict';
/**
 * Genera el manifest.json de un modpack.
 *
 * Estructura de una carpeta de pack:
 *   mi-pack/
 *     pack.json      <- datos del pack (los editas tú)
 *     files/         <- lo que se copia a la instancia de tus amigos (mods/, config/, ...)
 *     manifest.json  <- lo genera este script
 *
 * Uso:  node tools/generate-manifest.js packs/mi-pack [--base-url URL] [--note "texto del cambio"]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const DEFAULT_ONCE = ['options.txt', 'servers.dat'];

function sha256Sync(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && !IGNORED.has(e.name)) out.push(full);
  }
  return out;
}

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + esc + '$');
}

function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || '');
  if (!m) return '1.0.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function encodePath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

function buildManifest(packDir, { baseUrl, note } = {}) {
  const metaPath = path.join(packDir, 'pack.json');
  if (!fs.existsSync(metaPath)) throw new Error('Falta ' + metaPath);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const filesDir = path.join(packDir, 'files');
  if (!fs.existsSync(filesDir)) throw new Error('Falta la carpeta ' + filesDir);

  const base = (baseUrl || meta.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Falta baseUrl (en pack.json o con --base-url)');
  const sources = meta.sources || {};
  const onceRegex = [...DEFAULT_ONCE, ...(meta.once || [])].map(globToRegex);

  const files = walk(filesDir)
    .map((full) => {
      const rel = path.relative(filesDir, full).split(path.sep).join('/');
      const entry = {
        path: rel,
        url: sources[rel] || `${base}/files/${encodePath(rel)}`,
        sha256: sha256Sync(full),
        size: fs.statSync(full).size,
      };
      if (onceRegex.some((r) => r.test(rel))) entry.policy = 'once';
      return entry;
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  // Comparar con el manifest anterior para versión y changelog automáticos
  const outPath = path.join(packDir, 'manifest.json');
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch {}
  const prevMap = new Map((prev?.files || []).map((f) => [f.path, f.sha256]));
  const nowMap = new Map(files.map((f) => [f.path, f.sha256]));
  const added = files.filter((f) => !prevMap.has(f.path)).map((f) => f.path);
  const removed = [...prevMap.keys()].filter((p) => !nowMap.has(p));
  const changed = files.filter((f) => prevMap.has(f.path) && prevMap.get(f.path) !== f.sha256).map((f) => f.path);
  const filesChanged = added.length + removed.length + changed.length > 0;

  let packVersion = meta.packVersion || prev?.packVersion || '1.0.0';
  if (!meta.packVersion && prev && filesChanged) packVersion = bumpPatch(prev.packVersion);

  const lines = [];
  if (note) lines.push(note);
  const short = (p) => path.posix.basename(p);
  if (added.length) lines.push('Añadido: ' + added.map(short).join(', '));
  if (removed.length) lines.push('Quitado: ' + removed.map(short).join(', '));
  if (changed.length) lines.push('Actualizado: ' + changed.map(short).join(', '));
  const changelog = lines.length ? lines.join('\n') : (prev?.changelog || 'Primera versión del pack.');

  const manifest = {
    id: meta.id,
    name: meta.name || meta.id || 'Modpack',
    packVersion,
    changelog,
    minecraft: meta.minecraft,
    loader: meta.loader || null,
    java: meta.java || null,
    ram: meta.ram || null,
    server: meta.server || null,
    managed: meta.managed || ['mods'],
    files,
  };
  return { manifest, outPath, summary: { added, removed, changed, filesChanged } };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const packDir = args.find((a) => !a.startsWith('--'));
  const opt = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!packDir) {
    console.error('Uso: node tools/generate-manifest.js <carpeta-del-pack> [--base-url URL] [--note "texto"]');
    process.exit(1);
  }
  try {
    const { manifest, outPath, summary } = buildManifest(path.resolve(packDir), {
      baseUrl: opt('base-url'),
      note: opt('note'),
    });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`manifest.json generado: ${manifest.files.length} archivos, versión ${manifest.packVersion}`);
    if (summary.added.length) console.log('  + ' + summary.added.join('\n  + '));
    if (summary.removed.length) console.log('  - ' + summary.removed.join('\n  - '));
    if (summary.changed.length) console.log('  ~ ' + summary.changed.join('\n  ~ '));
    if (!summary.filesChanged) console.log('  (sin cambios en archivos)');
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

module.exports = { buildManifest, globToRegex };
