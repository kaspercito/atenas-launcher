'use strict';
/**
 * Gestión de modpacks (crear, borrar, importar, índice packs.json).
 * Sin dependencias de Electron: se puede probar con `node`.
 *
 * Un "repo de packs" tiene esta forma:
 *   atenas-packs/
 *     packs.json              <- índice que lee el launcher (lo mantiene esta librería)
 *     atenas-smp/             <- un modpack (pack.json + mods.txt + files/ + manifest.json)
 *     mi-neoforge/            <- otro modpack, con otro loader
 */
const fs = require('fs');
const path = require('path');

// minMc: primera versión de Minecraft con soporte real de ese loader
const LOADERS = {
  neoforge: { label: 'NeoForge', minMc: '1.20.1' },
  forge: { label: 'Forge', minMc: '1.12.2' },
  fabric: { label: 'Fabric', minMc: '1.14' },
  quilt: { label: 'Quilt', minMc: '1.14' },
};
const MC_RE = /^\d+\.\d+(\.\d+)?$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_FILE = 95 * 1048576; // GitHub rechaza archivos de 100 MB o más

// Carpetas de una instancia de Minecraft que tiene sentido compartir con los jugadores
const IMPORT_DIRS = ['config', 'defaultconfigs', 'kubejs', 'scripts', 'resourcepacks', 'shaderpacks', 'datapacks',
  'global_packs', 'patchouli_books', 'paxi', 'openloader', 'packmenu', 'fancymenu_data', 'customnpcs'];
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

/** Compara "1.20.1" con "1.20" -> número (<0, 0, >0). */
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Lanza un error con motivo claro si el loader no existe para esa versión de Minecraft. */
function checkCompat(type, mc) {
  const l = LOADERS[type];
  if (!l) throw new Error('Loader no válido: ' + type);
  if (!MC_RE.test(String(mc || ''))) throw new Error('La versión de Minecraft debe verse como 1.21.1');
  if (cmpVer(mc, l.minMc) < 0) throw new Error(`${l.label} no existe para Minecraft ${mc} (la primera versión es la ${l.minMc}).`);
}

/** RAM sugerida según el loader y la edad de Minecraft (los packs de Forge/NeoForge modernos piden más). */
function defaultRam(type, mc) {
  if (type === 'fabric' || type === 'quilt') return { min: '2G', max: '4G' };
  return cmpVer(mc, '1.20') >= 0 ? { min: '4G', max: '6G' } : { min: '3G', max: '5G' };
}

const memMb = (v) => { const m = /^(\d+)\s*([GgMm])$/.exec(String(v || '').trim()); return m ? (/g/i.test(m[2]) ? Number(m[1]) * 1024 : Number(m[1])) : null; };

function normRam(ram, type, mc) {
  const d = defaultRam(type, mc);
  const min = String((ram && ram.min) || d.min).trim().toUpperCase();
  const max = String((ram && ram.max) || d.max).trim().toUpperCase();
  if (memMb(min) == null || memMb(max) == null) throw new Error('La RAM debe ser como 4G o 4096M.');
  if (memMb(min) > memMb(max)) throw new Error('La RAM mínima no puede ser mayor que la máxima.');
  if (memMb(max) < 1024) throw new Error('La RAM máxima debe ser al menos 1G.');
  return { min, max };
}

/** Valida y normaliza lo que llega del asistente "Nuevo modpack". */
function validateSpec(spec, existingIds = []) {
  const name = String(spec && spec.name || '').trim();
  if (!name) throw new Error('Ponle un nombre al modpack.');
  if (name.length > 60) throw new Error('El nombre es demasiado largo (máximo 60 caracteres).');
  const id = String(spec.id || slugify(name)).trim().toLowerCase();
  if (!ID_RE.test(id) || id === '.' || id === '..') throw new Error('El identificador solo puede tener letras minúsculas, números, guiones y puntos (ej. mi-neoforge).');
  if (existingIds.map((x) => x.toLowerCase()).includes(id)) throw new Error(`Ya existe un modpack con el id "${id}".`);
  const type = String(spec.loader && spec.loader.type || '').toLowerCase();
  const mc = String(spec.minecraft || '').trim();
  checkCompat(type, mc);
  const lv = String(spec.loader && spec.loader.version || '').trim();
  if ((type === 'forge' || type === 'neoforge') && !lv) throw new Error(`Para ${LOADERS[type].label} tienes que indicar la versión exacta del loader (usa «Ver versiones»).`);
  if (lv && !/^[\w.+-]+$/.test(lv)) throw new Error('La versión del loader tiene caracteres no válidos.');
  const server = String(spec.server || '').trim();
  if (server && !/^[\w.-]+(:\d{1,5})?$/.test(server)) throw new Error('El servidor debe ser una IP o dominio (ej. atenasmc.live o 1.2.3.4:25565).');
  return {
    id, name,
    description: String(spec.description || '').trim().slice(0, 300),
    minecraft: mc,
    loader: lv ? { type, version: lv } : { type },
    ram: normRam(spec.ram, type, mc),
    server,
  };
}

const isPackDir = (d) => fs.existsSync(path.join(d, 'pack.json')) && fs.existsSync(path.join(d, 'mods.txt'));

function listPackDirs(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && isPackDir(path.join(root, d.name)))
    .map((d) => ({ id: d.name, dir: path.join(root, d.name) }));
}

/** Resumen de un pack para los selectores del admin. */
function packInfo(dir) {
  const m = readJson(path.join(dir, 'pack.json'), {});
  return {
    id: path.basename(dir),
    name: m.name || path.basename(dir),
    description: m.description || '',
    minecraft: m.minecraft || '',
    loader: (m.loader && m.loader.type) || 'vanilla',
    loaderVersion: (m.loader && m.loader.version) || '',
    hidden: m.hidden === true,
    published: fs.existsSync(path.join(dir, 'manifest.json')),
  };
}

/** URL base donde viven los packs (sin la barra final), a partir de lo que ya existe. */
function guessRawRoot({ indexUrl, root } = {}) {
  if (indexUrl && /^https:\/\//.test(indexUrl)) return indexUrl.replace(/\/[^/]*$/, '');
  for (const p of listPackDirs(root)) {
    const b = readJson(path.join(p.dir, 'pack.json'), {}).baseUrl;
    if (b && /^https:\/\//.test(b)) return b.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
  }
  return null;
}

function modsTxtTemplate(spec) {
  const l = LOADERS[spec.loader.type].label;
  const title = `${spec.name} · ${l} ${spec.minecraft}`;
  const bar = '═'.repeat(63);
  return [
    `# ${bar}`,
    `#  ${title}`,
    '#  Un mod por línea (slug de Modrinth). Para fijar versión: slug@version',
    '#  Las dependencias obligatorias se añaden solas.',
    '#  Se administra desde Atenas Admin (pestaña «Añadir mods»).',
    `# ${bar}`,
    '',
  ].join('\n');
}

/** Crea la carpeta del pack con todo lo necesario. No toca packs.json (eso lo hace writeIndex al publicar). */
function createPack(root, spec, { rawRoot } = {}) {
  if (!root || !fs.existsSync(root)) throw new Error('La carpeta de modpacks no existe.');
  const ids = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const s = validateSpec(spec, ids);
  const dir = path.join(root, s.id);
  fs.mkdirSync(path.join(dir, 'files', 'mods'), { recursive: true });
  const meta = {
    id: s.id,
    name: s.name,
    ...(s.description ? { description: s.description } : {}),
    ...(rawRoot ? { baseUrl: `${rawRoot.replace(/\/+$/, '')}/${s.id}` } : {}),
    minecraft: s.minecraft,
    loader: s.loader,
    ram: s.ram,
    ...(s.server ? { server: s.server } : {}),
    managed: ['mods'],
    once: [],
    sources: {},
  };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'mods.txt'), modsTxtTemplate(s));
  return { id: s.id, dir, spec: s, needsBaseUrl: !rawRoot };
}

/**
 * Reconstruye el índice packs.json que lee el launcher.
 * - Solo entran packs publicados (con manifest.json) y no ocultos.
 * - Se respeta el orden y la manifestUrl/description que ya tenías; los nuevos van al final.
 */
function buildIndex(root, { rawRoot, existing } = {}) {
  const old = (existing && Array.isArray(existing.packs) ? existing.packs : []).filter((p) => p && p.id);
  const oldById = new Map(old.map((p) => [p.id, p]));
  const infos = new Map(listPackDirs(root).map((p) => [p.id, { ...packInfo(p.dir), dir: p.dir }]));
  const visible = (i) => i && i.published && !i.hidden;
  const order = [
    ...old.map((p) => p.id).filter((id) => infos.has(id)),
    ...[...infos.keys()].filter((id) => !oldById.has(id)).sort((a, b) => infos.get(a).name.localeCompare(infos.get(b).name)),
  ];
  const packs = [];
  for (const id of order) {
    const i = infos.get(id);
    if (!visible(i)) continue;
    const prev = oldById.get(id) || {};
    const meta = readJson(path.join(i.dir, 'pack.json'), {});
    const base = (meta.baseUrl || (rawRoot ? `${rawRoot.replace(/\/+$/, '')}/${id}` : '')).replace(/\/+$/, '');
    const manifestUrl = prev.manifestUrl || (base ? `${base}/manifest.json` : null);
    if (!manifestUrl) throw new Error(`No sé cuál es la URL pública de «${i.name}»: falta "baseUrl" en su pack.json.`);
    packs.push({
      id,
      name: i.name,
      description: i.description || prev.description || '',
      minecraft: i.minecraft,
      loader: i.loaderVersion ? { type: i.loader, version: i.loaderVersion } : { type: i.loader },
      manifestUrl,
    });
  }
  return { packs };
}

/** Escribe packs.json solo si cambió. Devuelve { file, packs, changed }. */
function writeIndex(root, { rawRoot } = {}) {
  const file = path.join(root, 'packs.json');
  const existing = readJson(file, null);
  const next = buildIndex(root, { rawRoot, existing });
  const text = JSON.stringify(next, null, 2) + '\n';
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const changed = before !== text;
  if (changed) fs.writeFileSync(file, text);
  return { file, packs: next.packs, changed };
}

/** Borra la carpeta de un pack (solo si de verdad es un pack dentro de root). */
function deletePack(root, id) {
  if (!ID_RE.test(String(id || '')) && !/^[A-Za-z0-9._-]{1,64}$/.test(String(id || ''))) throw new Error('Id de pack inválido');
  const base = path.resolve(root);
  const dir = path.resolve(base, id);
  if (path.dirname(dir) !== base) throw new Error('Ruta de pack inválida');
  if (!isPackDir(dir)) throw new Error('Esa carpeta no es un modpack.');
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

function copyTree(src, dest, report, relBase) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORED.has(e.name) || e.isSymbolicLink()) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    const rel = `${relBase}/${e.name}`;
    if (e.isDirectory()) { copyTree(s, d, report, rel); continue; }
    if (!e.isFile()) continue;
    const size = fs.statSync(s).size;
    if (size > MAX_FILE) { report.skipped.push(`${rel} (pesa ${(size / 1048576).toFixed(0)} MB: GitHub no lo acepta)`); continue; }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    report.files++;
    report.bytes += size;
  }
}

/**
 * Copia a files/ lo compartible de una instancia de Minecraft (la carpeta que tiene mods/ y config/):
 * los .jar de mods/ y las carpetas de configuración. Ignora mundos, registros, capturas, options.txt…
 */
function importFolder(packDir, srcDir) {
  if (!isPackDir(packDir)) throw new Error('El destino no es un modpack.');
  if (!srcDir || !fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) throw new Error('La carpeta elegida no existe.');
  let src = srcDir;
  // Instancias de Prism/CurseForge/Modrinth App: los datos están en "minecraft" o ".minecraft"
  if (!fs.existsSync(path.join(src, 'mods'))) {
    for (const sub of ['minecraft', '.minecraft']) if (fs.existsSync(path.join(src, sub, 'mods'))) { src = path.join(src, sub); break; }
  }
  const filesDir = path.join(packDir, 'files');
  const report = { mods: 0, files: 0, bytes: 0, skipped: [], folders: [] };

  const modsSrc = path.join(src, 'mods');
  if (fs.existsSync(modsSrc)) {
    fs.mkdirSync(path.join(filesDir, 'mods'), { recursive: true });
    for (const e of fs.readdirSync(modsSrc, { withFileTypes: true })) {
      if (!e.isFile() || !/\.jar$/i.test(e.name)) continue;
      const size = fs.statSync(path.join(modsSrc, e.name)).size;
      if (size > MAX_FILE) { report.skipped.push(`mods/${e.name} (pesa ${(size / 1048576).toFixed(0)} MB: GitHub no lo acepta)`); continue; }
      fs.copyFileSync(path.join(modsSrc, e.name), path.join(filesDir, 'mods', e.name));
      report.mods++;
      report.bytes += size;
    }
  }
  for (const d of IMPORT_DIRS) {
    const s = path.join(src, d);
    if (!fs.existsSync(s) || !fs.statSync(s).isDirectory()) continue;
    const before = report.files;
    copyTree(s, path.join(filesDir, d), report, d);
    if (report.files > before) report.folders.push(d);
  }
  if (!report.mods && !report.folders.length) throw new Error('No encontré una carpeta mods/ ni config/ ahí dentro. Elige la carpeta de la instancia (la que contiene mods).');
  return report;
}

module.exports = {
  LOADERS, MC_RE, MAX_FILE, cmpVer, slugify, checkCompat, defaultRam, memMb, validateSpec,
  isPackDir, listPackDirs, packInfo, guessRawRoot, createPack, buildIndex, writeIndex, deletePack, importFolder,
};
