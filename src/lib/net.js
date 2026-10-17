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
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.json();
}

/**
 * Descarga url -> dest (vía archivo .part), verificando sha256 si se indica.
 * onBytes(n) se llama con los bytes recibidos en cada trozo.
 */
async function downloadFile(url, dest, { sha256, onBytes, retries = 3, headers } = {}) {
  assertHttp(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let counted = 0;
    // Si la descarga se queda sin recibir datos 30 s (internet caído a medias) se corta y se reintenta, en vez de colgarse para siempre.
    const ctl = new AbortController();
    let stall = setTimeout(() => ctl.abort(), 30000);
    const kick = () => { clearTimeout(stall); stall = setTimeout(() => ctl.abort(), 30000); };
    try {
      const res = await fetch(url, { signal: ctl.signal, headers });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const hash = crypto.createHash('sha256');
      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => {
        kick();
        hash.update(chunk);
        counted += chunk.length;
        if (onBytes) onBytes(chunk.length);
      });
      await pipeline(source, fs.createWriteStream(tmp), { signal: ctl.signal });
      clearTimeout(stall);
      const got = hash.digest('hex');
      if (sha256 && got.toLowerCase() !== sha256.toLowerCase()) {
        throw new Error(`Hash incorrecto (esperado ${sha256.slice(0, 10)}…, recibido ${got.slice(0, 10)}…)`);
      }
      fs.renameSync(tmp, dest);
      return got;
    } catch (err) {
      clearTimeout(stall);
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

/** Lee una pagina como texto (para paginas HTML). Con un User-Agent normal: algunos sitios rechazan el de Node. */
async function fetchText(url, { headers, timeoutMs = 15000 } = {}) {
  assertHttp(url);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtenasClient', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.text();
}

module.exports = { fetchJson, fetchText, downloadFile, sha256File };
