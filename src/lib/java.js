'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { downloadFile } = require('./net');

const isWin = process.platform === 'win32';

/** Versión de Java que necesita cada versión de Minecraft. */
function javaMajorFor(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc || '');
  if (!m) return 21; // snapshots/versiones nuevas
  const minor = Number(m[1]);
  const patch = Number(m[2] || 0);
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function findBinary(dir, depth = 4) {
  const names = isWin ? ['javaw.exe', 'java.exe'] : ['java'];
  const direct = (d) => names.map((n) => path.join(d, 'bin', n)).find((p) => fs.existsSync(p));
  const here = direct(dir);
  if (here) return here;
  if (depth === 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findBinary(path.join(dir, e.name), depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function systemJavaMajor() {
  return new Promise((resolve) => {
    execFile('java', ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const text = `${stderr || ''}${stdout || ''}`;
      const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
      if (!m) return resolve(null);
      resolve(m[1] === '1' ? Number(m[2]) : Number(m[1])); // "1.8.0" -> 8
    });
  });
}

/**
 * Prueba real: ejecuta `java -version` (con java.exe, no javaw, para que no salga el cuadro de error de Windows).
 * Un JRE a medias (antivirus que borró archivos, descompresión cortada, jvm.cfg faltante) falla aquí.
 */
function smokeTest(bin) {
  return new Promise((resolve) => {
    const exe = isWin ? path.join(path.dirname(bin), 'java.exe') : bin;
    const run = fs.existsSync(exe) ? exe : bin;
    execFile(run, ['-version'], { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
      resolve(!err && /version/i.test(`${stderr || ''}${stdout || ''}`));
    });
  });
}

function adoptiumUrl(major) {
  const osName = isWin ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
}

/**
 * Devuelve la ruta al ejecutable de Java correcto. Si no existe, descarga un JRE de Adoptium
 * a runtimeDir (el amigo no tiene que instalar nada).
 */
async function ensureJava(major, runtimeDir, log = () => {}, onProgress = () => {}) {
  const target = path.join(runtimeDir, `java-${major}`);
  const existing = fs.existsSync(target) ? findBinary(target) : null;
  if (existing) {
    if (await smokeTest(existing)) return existing;
    // Java descargado pero dañado (p. ej. falta lib/jvm.cfg): se borra y se baja de nuevo
    log(`El Java ${major} guardado está dañado o incompleto; se vuelve a descargar…`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  const sys = await systemJavaMajor();
  if (sys === major) {
    log(`Usando Java ${major} del sistema`);
    return 'java';
  }

  log(`Descargando Java ${major} (solo la primera vez)…`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const archive = path.join(runtimeDir, `java-${major}${isWin ? '.zip' : '.tar.gz'}`);
  const tmp = target + '.tmp';
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let total = 0;
      await downloadFile(adoptiumUrl(major), archive, {
        onBytes: (n) => { total += n; onProgress(total); },
      });

      // Se extrae a una carpeta temporal y se renombra al final: si se cierra el launcher a mitad, no queda un Java a medias
      // que la próxima vez se tome por bueno (y el juego no arranque).
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      if (isWin) {
        const AdmZip = require('adm-zip');
        new AdmZip(archive).extractAllTo(tmp, true);
      } else {
        execFileSync('tar', ['-xzf', archive, '-C', tmp]);
      }
      fs.rmSync(archive, { force: true });
      const tmpBin = findBinary(tmp);
      if (!tmpBin) throw new Error(`No se encontró Java ${major} tras descomprimir`);
      if (!isWin) fs.chmodSync(tmpBin, 0o755);
      // se prueba ANTES de darlo por bueno: si falta algo (antivirus, disco lleno, zip corrupto) se reintenta
      if (!(await smokeTest(tmpBin))) throw new Error(`El Java ${major} descargado no arranca (archivos incompletos o bloqueados por el antivirus)`);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(tmp, target);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      log(`Java ${major}: intento ${attempt} falló: ${e.message}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
    }
  }
  if (lastErr) throw new Error(`No se pudo preparar Java ${major}: ${lastErr.message}. Si tienes antivirus, permite la carpeta .atenasclient o instala Java ${major} manualmente.`);

  const bin = findBinary(target);
  if (!isWin) fs.chmodSync(bin, 0o755);
  log(`Java ${major} listo`);
  return bin;
}

module.exports = { javaMajorFor, ensureJava, findBinary, systemJavaMajor, smokeTest };
