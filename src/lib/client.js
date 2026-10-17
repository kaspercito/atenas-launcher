'use strict';
/**
 * Atenas Client 1.8.9 (el mod de Forge) dentro del launcher.
 *
 * El jar sale de la última Release de GitHub del repo del cliente (el workflow de ese repo lo publica al subir un tag v*).
 * Se instala en <instancia>/mods, se actualiza solo y se puede probar sin publicar nada:
 * deja un AtenasClient-X.Y.Z.jar en la carpeta "client-local" de los datos del launcher y se usa ese.
 */
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile, sha256File } = require('./net');

const JAR_RE = /^AtenasClient-\d+(?:\.\d+)*\.jar$/;     // no confundir con AtenasClient-1.0.0-sources.jar
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const META = '.atenas-client.json';

const memo = new Map(); // repo -> { at, release }

function codeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const versionOf = (name) => (/^AtenasClient-(\d+(?:\.\d+)*)\.jar$/.exec(name) || [])[1] || '';
const cmpVer = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** Jar de prueba local (el más nuevo de la carpeta), o null. */
async function findLocal(localDir) {
  if (!localDir) return null;
  let files;
  try { files = fs.readdirSync(localDir).filter((f) => JAR_RE.test(f)); } catch { return null; }
  if (!files.length) return null;
  files.sort((a, b) => cmpVer(versionOf(a), versionOf(b)));
  const name = files[files.length - 1];
  const full = path.join(localDir, name);
  const st = fs.statSync(full);
  return {
    source: 'local', tag: `local-${versionOf(name)}`, version: `${versionOf(name)} (local)`, name,
    localPath: full, size: st.size, sha256: await sha256File(full),
    body: 'Jar local de prueba (carpeta client-local).',
  };
}

function parseRelease(r) {
  const asset = (r.assets || []).find((a) => JAR_RE.test(a.name));
  if (!asset) {
    throw codeErr('NO_RELEASE', `La última release del cliente (${r.tag_name}) no incluye AtenasClient-X.Y.Z.jar. Revisa la pestaña Actions del repo: la compilación debe terminar bien.`);
  }
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '');
  return {
    source: 'github',
    tag: r.tag_name,
    version: String(r.tag_name).replace(/^v/i, ''),
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size || 0,
    sha256: digest ? digest[1].toLowerCase() : null,
    body: String(r.body || '').trim(),
  };
}

/**
 * Última versión del cliente: jar local de prueba > Release de GitHub > copia guardada (sin internet).
 * Lanza NO_RELEASE (aún no hay release) o NO_CONNECTION (sin internet y sin copia guardada).
 */
async function getLatest({ repo, cacheFile, localDir, ttlMs = 60000, apiBase = 'https://api.github.com' } = {}) {
  const local = await findLocal(localDir);
  if (local) return local;

  if (!REPO_RE.test(repo || '')) throw codeErr('NO_RELEASE', 'Falta configurar el repo del cliente en launcher.config.json (clientPack.repo, con el formato usuario/repositorio).');
  const hit = memo.get(repo);
  if (hit && Date.now() - hit.at < ttlMs) return hit.release;

  let release;
  try {
    release = parseRelease(await fetchJson(`${apiBase}/repos/${repo}/releases/latest`));
  } catch (err) {
    if (err.code === 'NO_RELEASE') throw err;
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* sin copia */ }
    if (cached && cached.repo === repo && cached.release) return { ...cached.release, offline: true };
    if (/HTTP 404/.test(err.message)) {
      throw codeErr('NO_RELEASE', `Todavía no hay una versión publicada del cliente en github.com/${repo}/releases. Sube el tag (git tag v1.0.0 && git push origin v1.0.0) y espera a que termine la compilación.`);
    }
    throw codeErr('NO_CONNECTION', 'No se pudo consultar la versión del cliente en GitHub. Revisa tu internet y pulsa Reintentar.');
  }
  memo.set(repo, { at: Date.now(), release });
  if (cacheFile) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ repo, release })); } catch { /* la copia es opcional */ }
  }
  return release;
}

function readMeta(instanceDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(instanceDir, META), 'utf8'));
    if (m && m.file && m.tag && fs.existsSync(path.join(instanceDir, 'mods', m.file))) return m;
  } catch { /* sin instalar */ }
  return null;
}

/** 'install' (no está), 'update' (hay otra versión) o null (al día). */
function needs(release, meta) {
  if (!meta) return 'install';
  return meta.tag === release.tag && meta.file === release.name ? null : 'update';
}

/** Descarga (o copia) el jar a <instancia>/mods, quitando versiones anteriores. */
async function installClient(release, instanceDir, { onBytes } = {}) {
  const modsDir = path.join(instanceDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const finalPath = path.join(modsDir, release.name);
  const tmp = finalPath + '.download';
  try {
    if (release.source === 'local') {
      fs.copyFileSync(release.localPath, tmp);
      if (onBytes) onBytes(release.size);
    } else {
      await downloadFile(release.url, tmp, { sha256: release.sha256 || undefined, onBytes });
      if (release.size && fs.statSync(tmp).size !== release.size) throw new Error('Descarga incompleta del cliente (el tamaño no coincide)');
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ya no está */ }
    throw e;
  }
  for (const f of fs.readdirSync(modsDir)) {
    if (/^AtenasClient-.*\.jar$/i.test(f) && f !== release.name) { try { fs.unlinkSync(path.join(modsDir, f)); } catch { /* en uso */ } }
  }
  fs.renameSync(tmp, finalPath);
  fs.writeFileSync(path.join(instanceDir, META), JSON.stringify({ tag: release.tag, version: release.version, file: release.name, installedAt: new Date().toISOString() }));
  return { tag: release.tag, file: release.name };
}

/** "Manifest" del perfil integrado (no hay nada que sincronizar: solo el jar del cliente). */
function buildManifest(pack, release) {
  return {
    id: pack.id,
    name: pack.name || 'Atenas Client',
    packVersion: release.version,
    changelog: release.body ? release.body.slice(0, 1500) : `Atenas Client ${release.version}`,
    minecraft: pack.minecraft || '1.8.9',
    loader: { type: 'forge', version: pack.forge || '11.15.1.2318' },
    java: 8,
    ram: pack.ram || null,
    server: pack.server || null,
    managed: [],
    files: [{ path: `mods/${release.name}`, url: release.url || '', sha256: release.sha256 || '', size: release.size || 0 }],
  };
}

module.exports = { getLatest, readMeta, needs, installClient, buildManifest, findLocal, JAR_RE, META };
