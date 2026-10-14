'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

function assertHttp(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('URL no permitida: ' + url);
  }
}

async function fetchJson(url) {
  assertHttp(url);
  // Evita caché del CDN de GitHub para que las actualizaciones aparezcan rápido
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(url + sep + 't=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.json();
}

/**
 * Descarga url -> dest (vía archivo .part), verificando sha256 si se indica.
 * onBytes(n) se llama con los bytes recibidos en cada trozo.
 */
async function downloadFile(url, dest, { sha256, onBytes, retries = 3 } = {}) {
  assertHttp(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let counted = 0;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = crypto.createHash('sha256');
      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => {
        hash.update(chunk);
        counted += chunk.length;
        if (onBytes) onBytes(chunk.length);
      });
      await pipeline(source, fs.createWriteStream(tmp));
      const got = hash.digest('hex');
      if (sha256 && got.toLowerCase() !== sha256.toLowerCase()) {
        throw new Error(`Hash incorrecto (esperado ${sha256.slice(0, 10)}…, recibido ${got.slice(0, 10)}…)`);
      }
      fs.renameSync(tmp, dest);
      return got;
    } catch (err) {
      lastErr = err;
      // deshacer el progreso contado para que la barra no pase de 100%
      if (onBytes && counted) onBytes(-counted);
      try { fs.unlinkSync(tmp); } catch {}
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`No se pudo descargar ${url}: ${lastErr.message}`);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

module.exports = { fetchJson, downloadFile, sha256File };
