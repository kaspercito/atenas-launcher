'use strict';
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile, sha256File } = require('./net');

const STATE_FILE = '.atenas-state.json';

/** Une root + rel y garantiza que el resultado quede DENTRO de root (el manifest viene de internet). */
function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) {
    throw new Error('Ruta inválida en el manifest: ' + rel);
  }
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('Ruta fuera de la instancia en el manifest: ' + rel);
  }
  return full;
}

function normRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Manifest inválido');
  if (typeof m.minecraft !== 'string') throw new Error('Manifest: falta "minecraft"');
  if (typeof m.packVersion !== 'string' && typeof m.packVersion !== 'number') {
    throw new Error('Manifest: falta "packVersion"');
  }
  if (!Array.isArray(m.files)) throw new Error('Manifest: "files" debe ser una lista');
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || typeof f.url !== 'string') {
      throw new Error('Manifest: cada archivo necesita "path" y "url"');
    }
    if (!/^[a-f0-9]{64}$/i.test(f.sha256 || '')) {
      throw new Error('Manifest: sha256 inválido en ' + f.path);
    }
    if (f.policy && f.policy !== 'always' && f.policy !== 'once') {
      throw new Error('Manifest: policy inválida en ' + f.path);
    }
  }
  if (m.managed && !Array.isArray(m.managed)) throw new Error('Manifest: "managed" debe ser lista');
  m.packVersion = String(m.packVersion);
  return m;
}

async function loadManifest(url) {
  return validateManifest(await fetchJson(url));
}

function readState(instanceDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(instanceDir, STATE_FILE), 'utf8'));
    return { packVersion: s.packVersion || null, files: s.files || {}, once: s.once || {} };
  } catch {
    return { packVersion: null, files: {}, once: {} };
  }
}

function writeState(instanceDir, state) {
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(path.join(instanceDir, STATE_FILE), JSON.stringify(state, null, 2));
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

async function cachedHash(full, rel, state) {
  const st = fs.statSync(full);
  const c = state.files[rel];
  if (c && c.sha256 && c.size === st.size && c.mtimeMs === Math.floor(st.mtimeMs)) return c.sha256;
  return sha256File(full);
}

/**
 * Compara el manifest remoto con lo que hay en disco.
 * Devuelve { add, change, remove, bytes, hasChanges, installed, localVersion }.
 */
async function computeDiff(manifest, instanceDir) {
  const state = readState(instanceDir);
  const wanted = new Map();
  for (const f of manifest.files) wanted.set(normRel(f.path), f);

  const add = [];
  const change = [];
  const remove = [];

  for (const [rel, f] of wanted) {
    const full = safeJoin(instanceDir, rel);
    const policy = f.policy || 'always';
    const exists = fs.existsSync(full);

    if (policy === 'once') {
      // Configs: se entregan una sola vez; después son del jugador.
      if (!exists && !state.once[rel]) add.push({ ...f, path: rel });
      continue;
    }
    if (!exists) {
      add.push({ ...f, path: rel });
      continue;
    }
    const have = await cachedHash(full, rel, state);
    if (have.toLowerCase() !== f.sha256.toLowerCase()) change.push({ ...f, path: rel });
  }

  // Carpetas administradas: lo que no esté en el manifest se elimina (mods quitados)
  const managed = (manifest.managed || ['mods']).map(normRel);
  const removeSet = new Set();
  for (const dir of managed) {
    const base = safeJoin(instanceDir, dir);
    for (const full of walk(base)) {
      const rel = normRel(path.relative(instanceDir, full));
      if (rel.endsWith('.part')) continue;
      if (!wanted.has(rel)) removeSet.add(rel);
    }
  }
  // Archivos que nosotros instalamos antes y ya no están en el manifest
  for (const rel of Object.keys(state.files)) {
    if (!wanted.has(rel) && fs.existsSync(safeJoin(instanceDir, rel))) removeSet.add(rel);
  }
  for (const rel of removeSet) remove.push({ path: rel });

  const bytes = [...add, ...change].reduce((n, f) => n + (f.size || 0), 0);
  return {
    add,
    change,
    remove,
    bytes,
    hasChanges: add.length + change.length + remove.length > 0,
    installed: state.packVersion !== null,
    localVersion: state.packVersion,
  };
}

/**
 * Aplica el diff: borra lo sobrante y descarga lo nuevo/cambiado (4 en paralelo).
 * onProgress({ doneBytes, totalBytes, filesDone, filesTotal, file })
 */
async function applyDiff(manifest, instanceDir, diff, { onProgress, concurrency = 4 } = {}) {
  fs.mkdirSync(instanceDir, { recursive: true });
  const state = readState(instanceDir);

  for (const r of diff.remove) {
    try { fs.unlinkSync(safeJoin(instanceDir, r.path)); } catch {}
    delete state.files[r.path];
  }

  const queue = [...diff.add, ...diff.change];
  const totalBytes = queue.reduce((n, f) => n + (f.size || 0), 0);
  let doneBytes = 0;
  let filesDone = 0;
  const emit = (file) => onProgress && onProgress({
    doneBytes: Math.max(0, doneBytes), totalBytes, filesDone, filesTotal: queue.length, file,
  });
  emit('');

  let idx = 0;
  let failure = null;
  async function worker() {
    while (!failure) {
      const f = queue[idx++];
      if (!f) return;
      try {
        await downloadFile(f.url, safeJoin(instanceDir, f.path), {
          sha256: f.sha256,
          onBytes: (n) => { doneBytes += n; emit(f.path); },
        });
        filesDone++;
        emit(f.path);
      } catch (err) {
        failure = err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  if (failure) throw failure;

  // Registrar estado: caché de hashes + configs "once" ya entregadas
  for (const f of manifest.files) {
    const rel = normRel(f.path);
    const full = safeJoin(instanceDir, rel);
    if ((f.policy || 'always') === 'once') {
      if (fs.existsSync(full)) state.once[rel] = true;
      continue;
    }
    if (fs.existsSync(full)) {
      const st = fs.statSync(full);
      state.files[rel] = { sha256: f.sha256, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    }
  }
  state.packVersion = manifest.packVersion;
  state.updatedAt = new Date().toISOString();
  writeState(instanceDir, state);
}

module.exports = {
  STATE_FILE, safeJoin, validateManifest, loadManifest,
  computeDiff, applyDiff, readState,
};
