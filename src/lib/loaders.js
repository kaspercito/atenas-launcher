'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fetchJson, downloadFile } = require('./net');

function versionsDir(instanceDir) {
  return path.join(instanceDir, 'versions');
}

function profileExists(instanceDir, id) {
  return fs.existsSync(path.join(versionsDir(instanceDir), id, `${id}.json`));
}

function writeProfile(instanceDir, profile) {
  const dir = path.join(versionsDir(instanceDir), profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
  return profile.id;
}

/** Fabric y Quilt publican el "perfil" de versión listo para usar. */
async function ensureProfileLoader(type, mc, version, instanceDir, log) {
  const meta = type === 'fabric'
    ? 'https://meta.fabricmc.net/v2/versions/loader'
    : 'https://meta.quiltmc.org/v3/versions/loader';

  let v = version;
  if (!v) {
    const list = await fetchJson(`${meta}/${mc}`);
    const first = list.find((e) => (e.loader.stable ?? true)) || list[0];
    if (!first) throw new Error(`No hay ${type} para Minecraft ${mc}`);
    v = first.loader.version;
  }
  const prefix = type === 'fabric' ? 'fabric-loader' : 'quilt-loader';
  const expectedId = `${prefix}-${v}-${mc}`;
  if (profileExists(instanceDir, expectedId)) return expectedId;

  log(`Instalando ${type} ${v}…`);
  const profile = await fetchJson(`${meta}/${mc}/${v}/profile/json`);
  return writeProfile(instanceDir, profile);
}

/**
 * Id de versión que deja el instalador y URL del instalador de Forge / NeoForge.
 * NeoForge 1.20.1 (47.x) se publica como "forge" dentro de net.neoforged; desde 1.20.2 el artefacto se llama "neoforge".
 */
function installerCoords(type, mc, version) {
  if (type === 'forge') {
    return { id: `${mc}-forge-${version}`, url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${version}/forge-${mc}-${version}-installer.jar` };
  }
  if (mc === '1.20.1') {
    const full = `${mc}-${version}`;
    return { id: `${mc}-forge-${version}`, url: `https://maven.neoforged.net/releases/net/neoforged/forge/${full}/forge-${full}-installer.jar` };
  }
  return { id: `neoforge-${version}`, url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar` };
}

function runInstaller(javaPath, jar, instanceDir, log, flag = '--installClient') {
  return new Promise((resolve, reject) => {
    const child = execFile(javaPath, ['-jar', jar, flag, instanceDir], {
      cwd: instanceDir, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error('El instalador falló: ' + (stderr || err.message).slice(-400)));
      resolve();
    });
    child.stdout?.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).slice(-1).forEach((l) => log(l)));
  });
}

/** Forge / NeoForge: se ejecuta su instalador oficial en modo cliente. */
async function ensureInstallerLoader(type, mc, version, instanceDir, javaPath, log) {
  if (!version) throw new Error(`Para ${type} indica la versión exacta en loader.version`);
  const { id: expectedId, url } = installerCoords(type, mc, version);
  if (profileExists(instanceDir, expectedId)) return expectedId;

  log(`Descargando instalador de ${type} ${version}…`);
  const jar = path.join(instanceDir, `.installer-${type}-${version}.jar`);
  await downloadFile(url, jar);

  // El instalador espera que exista un launcher_profiles.json
  const profiles = path.join(instanceDir, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }));

  const before = new Set(fs.existsSync(versionsDir(instanceDir)) ? fs.readdirSync(versionsDir(instanceDir)) : []);
  log(`Instalando ${type} (puede tardar unos minutos)…`);
  try {
    await runInstaller(javaPath, jar, instanceDir, log);
  } catch (e) {
    // Algunos instaladores de NeoForge usan la opción con guion (--install-client)
    if (type !== 'neoforge' || !/not a recognized option|unrecognized|unknown option/i.test(e.message)) throw e;
    log('Reintentando con --install-client…');
    await runInstaller(javaPath, jar, instanceDir, log, '--install-client');
  }
  fs.rmSync(jar, { force: true });

  if (profileExists(instanceDir, expectedId)) return expectedId;
  // Si el id cambió de formato, usar la carpeta nueva que apareció
  const after = fs.readdirSync(versionsDir(instanceDir)).filter((d) => !before.has(d) && profileExists(instanceDir, d));
  if (after.length) return after[0];
  throw new Error(`No se encontró la versión de ${type} tras instalar`);
}

/**
 * Prepara el loader indicado en manifest.loader y devuelve el id de versión
 * personalizado a lanzar (o null si es Minecraft vanilla).
 */
async function ensureLoader(manifest, instanceDir, javaPath, log = () => {}) {
  const l = manifest.loader;
  if (!l || !l.type || l.type === 'vanilla') return null;
  switch (l.type) {
    case 'fabric':
    case 'quilt':
      return ensureProfileLoader(l.type, manifest.minecraft, l.version, instanceDir, log);
    case 'forge':
    case 'neoforge':
      return ensureInstallerLoader(l.type, manifest.minecraft, l.version, instanceDir, javaPath, log);
    default:
      throw new Error('Loader no soportado: ' + l.type);
  }
}

module.exports = { ensureLoader, installerCoords };
