'use strict';
// Pruebas sin red: crear/borrar packs, índice packs.json, importar carpeta y .mrpack (con Modrinth simulado).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('../lib/packs');
const mrpack = require('../lib/mrpack');
const mf = require('../lib/modsfile');
const { buildManifest } = require('../../tools/generate-manifest');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-packs-'));
const RAW = 'https://raw.githubusercontent.com/kaspercito/atenas-packs/main';

// ───── utilidades ─────
assert.strictEqual(P.slugify('Mi Pack Épico: NeoForge 1.21!'), 'mi-pack-epico-neoforge-1-21');
assert.strictEqual(P.slugify('   '), '');
assert.ok(P.cmpVer('1.21.1', '1.20.1') > 0 && P.cmpVer('1.20', '1.20.0') === 0 && P.cmpVer('1.9', '1.12.2') < 0);

// compatibilidad loader / Minecraft
assert.throws(() => P.checkCompat('neoforge', '1.19.2'), /NeoForge no existe para Minecraft 1.19.2/);
assert.throws(() => P.checkCompat('fabric', '1.8.9'), /Fabric no existe/);
assert.throws(() => P.checkCompat('forge-x', '1.20.1'), /Loader no válido/);
assert.throws(() => P.checkCompat('forge', '1.20.1.2.3'), /debe verse como/);
P.checkCompat('neoforge', '1.20.1'); P.checkCompat('neoforge', '1.21.1'); P.checkCompat('quilt', '1.20.4');

// RAM por defecto: Fabric ligero, NeoForge moderno más grande
assert.deepStrictEqual(P.defaultRam('fabric', '1.21'), { min: '2G', max: '4G' });
assert.deepStrictEqual(P.defaultRam('neoforge', '1.21.1'), { min: '4G', max: '6G' });

// validateSpec
const base = { name: 'Mi NeoForge', minecraft: '1.21.1', loader: { type: 'neoforge', version: '21.1.172' } };
const ok = P.validateSpec(base, []);
assert.strictEqual(ok.id, 'mi-neoforge');
assert.deepStrictEqual(ok.ram, { min: '4G', max: '6G' });
assert.throws(() => P.validateSpec({ ...base, name: '' }), /nombre/);
assert.throws(() => P.validateSpec({ ...base, loader: { type: 'neoforge' } }), /versión exacta/);
assert.throws(() => P.validateSpec(base, ['mi-neoforge']), /Ya existe/);
assert.throws(() => P.validateSpec({ ...base, id: '../x' }), /identificador/);
assert.throws(() => P.validateSpec({ ...base, server: 'a b' }), /servidor/);
assert.throws(() => P.validateSpec({ ...base, ram: { min: '8G', max: '4G' } }), /mínima/);
P.validateSpec({ name: 'Fab', minecraft: '1.20.1', loader: { type: 'fabric' } }); // fabric sin versión: OK

// ───── crear packs y construir el índice ─────
const root = tmp();
fs.mkdirSync(path.join(root, 'atenas-smp', 'files', 'mods'), { recursive: true });
fs.writeFileSync(path.join(root, 'atenas-smp', 'pack.json'), JSON.stringify({ id: 'atenas-smp', name: 'Atenas SMP', baseUrl: `${RAW}/atenas-smp`, minecraft: '1.20.1', loader: { type: 'forge', version: '47.3.0' } }));
fs.writeFileSync(path.join(root, 'atenas-smp', 'mods.txt'), 'jei\n');
fs.writeFileSync(path.join(root, 'atenas-smp', 'manifest.json'), '{}');
fs.writeFileSync(path.join(root, 'packs.json'), JSON.stringify({ packs: [{ id: 'atenas-smp', name: 'viejo', description: 'Supervivencia con mods.', manifestUrl: `${RAW}/atenas-smp/manifest.json` }] }));

assert.strictEqual(P.guessRawRoot({ root }), RAW);
assert.strictEqual(P.guessRawRoot({ indexUrl: `${RAW}/packs.json` }), RAW);

const made = P.createPack(root, { ...base, description: 'Pack tecnológico', server: 'play.atenas.live', ram: { min: '4G', max: '8G' } }, { rawRoot: RAW });
assert.strictEqual(made.id, 'mi-neoforge');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'mi-neoforge', 'pack.json'), 'utf8'));
assert.deepStrictEqual(meta.loader, { type: 'neoforge', version: '21.1.172' });
assert.strictEqual(meta.baseUrl, `${RAW}/mi-neoforge`);
assert.strictEqual(meta.server, 'play.atenas.live');
assert.deepStrictEqual(meta.ram, { min: '4G', max: '8G' });
assert.ok(P.isPackDir(path.join(root, 'mi-neoforge')));
// el mods.txt nuevo es válido para el editor y no crea secciones falsas
assert.deepStrictEqual(mf.listMods(fs.readFileSync(path.join(root, 'mi-neoforge', 'mods.txt'), 'utf8')), []);
assert.deepStrictEqual(mf.listSections(fs.readFileSync(path.join(root, 'mi-neoforge', 'mods.txt'), 'utf8')), []);
assert.throws(() => P.createPack(root, base, { rawRoot: RAW }), /Ya existe/);

// un pack sin publicar NO aparece en el índice (los amigos verían "modpack sin publicar")
let idx = P.writeIndex(root, { rawRoot: RAW });
assert.deepStrictEqual(idx.packs.map((p) => p.id), ['atenas-smp']);
assert.strictEqual(idx.packs[0].description, 'Supervivencia con mods.'); // conserva lo que ya tenías
assert.strictEqual(idx.packs[0].loader.type, 'forge');
assert.strictEqual(idx.packs[0].minecraft, '1.20.1');

// no hay manifest en files/ vacío: el generador lo tolera (git no guarda carpetas vacías)
fs.rmSync(path.join(root, 'mi-neoforge', 'files'), { recursive: true });
const built = buildManifest(path.join(root, 'mi-neoforge'), {});
assert.strictEqual(built.manifest.loader.type, 'neoforge');
assert.strictEqual(built.manifest.files.length, 0);
fs.writeFileSync(built.outPath, JSON.stringify(built.manifest));

// ya publicado: entra al índice, al final, con su URL
idx = P.writeIndex(root, { rawRoot: RAW });
assert.deepStrictEqual(idx.packs.map((p) => p.id), ['atenas-smp', 'mi-neoforge']);
assert.strictEqual(idx.packs[1].manifestUrl, `${RAW}/mi-neoforge/manifest.json`);
assert.strictEqual(idx.packs[1].loader.version, '21.1.172');
assert.strictEqual(idx.changed, true);
assert.strictEqual(P.writeIndex(root, { rawRoot: RAW }).changed, false); // idempotente

// ocultar un pack lo quita del índice sin borrarlo
const mp = path.join(root, 'mi-neoforge', 'pack.json');
fs.writeFileSync(mp, JSON.stringify({ ...JSON.parse(fs.readFileSync(mp, 'utf8')), hidden: true }));
assert.deepStrictEqual(P.writeIndex(root, { rawRoot: RAW }).packs.map((p) => p.id), ['atenas-smp']);
assert.ok(fs.existsSync(path.join(root, 'mi-neoforge')));

// ───── borrar ─────
assert.throws(() => P.deletePack(root, '../'), /inválid|no es un modpack|Ruta/i);
assert.throws(() => P.deletePack(root, 'no-existe'), /no es un modpack/);
P.deletePack(root, 'mi-neoforge');
assert.ok(!fs.existsSync(path.join(root, 'mi-neoforge')));
assert.ok(fs.existsSync(path.join(root, 'atenas-smp')));

// ───── importar una instancia de Minecraft ─────
const inst = tmp();
const mcDir = path.join(inst, 'minecraft'); // estilo Prism: los datos están en /minecraft
fs.mkdirSync(path.join(mcDir, 'mods'), { recursive: true });
fs.mkdirSync(path.join(mcDir, 'config', 'sub'), { recursive: true });
fs.mkdirSync(path.join(mcDir, 'saves', 'Mundo'), { recursive: true });
fs.mkdirSync(path.join(mcDir, 'logs'), { recursive: true });
fs.writeFileSync(path.join(mcDir, 'mods', 'a.jar'), 'jar-a');
fs.writeFileSync(path.join(mcDir, 'mods', 'b.jar.disabled'), 'no');
fs.writeFileSync(path.join(mcDir, 'config', 'x.toml'), 'x=1');
fs.writeFileSync(path.join(mcDir, 'config', 'sub', 'y.json'), '{}');
fs.writeFileSync(path.join(mcDir, 'config', '.DS_Store'), 'x');
fs.writeFileSync(path.join(mcDir, 'saves', 'Mundo', 'level.dat'), 'mundo');
fs.writeFileSync(path.join(mcDir, 'logs', 'latest.log'), 'log');
fs.writeFileSync(path.join(mcDir, 'options.txt'), 'personal');
const made2 = P.createPack(root, { name: 'Importado', minecraft: '1.21.1', loader: { type: 'neoforge', version: '21.1.172' } }, { rawRoot: RAW });
const rep = P.importFolder(made2.dir, inst);
assert.strictEqual(rep.mods, 1);
assert.deepStrictEqual(rep.folders, ['config']);
const files = path.join(made2.dir, 'files');
assert.ok(fs.existsSync(path.join(files, 'mods', 'a.jar')));
assert.ok(!fs.existsSync(path.join(files, 'mods', 'b.jar.disabled')));
assert.ok(fs.existsSync(path.join(files, 'config', 'sub', 'y.json')));
assert.ok(!fs.existsSync(path.join(files, 'config', '.DS_Store')));
assert.ok(!fs.existsSync(path.join(files, 'saves')), 'los mundos no se comparten');
assert.ok(!fs.existsSync(path.join(files, 'logs')));
assert.ok(!fs.existsSync(path.join(files, 'options.txt')));
assert.throws(() => P.importFolder(made2.dir, tmp()), /No encontré/);

// ───── importar .mrpack (Modrinth simulado) ─────
const sha1 = (s) => require('crypto').createHash('sha1').update(s).digest('hex');
const sha512 = (s) => require('crypto').createHash('sha512').update(s).digest('hex');
const jarSodium = Buffer.from('sodium-bytes');
const jarOdd = Buffer.from('odd-bytes');
const zip = new AdmZip();
zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
  formatVersion: 1, game: 'minecraft', versionId: '2.0.1', name: 'Super Tech', summary: 'Un pack técnico',
  dependencies: { minecraft: '1.21.1', neoforge: '21.1.172' },
  files: [
    { path: 'mods/sodium.jar', hashes: { sha1: sha1('S'), sha512: sha512('S') }, downloads: ['https://cdn.modrinth.com/x/sodium.jar'], fileSize: 1 },
    { path: 'mods/serveronly.jar', hashes: { sha1: sha1('V'), sha512: sha512('V') }, downloads: ['https://cdn.modrinth.com/x/v.jar'], env: { client: 'unsupported', server: 'required' }, fileSize: 1 },
    { path: 'mods/odd.jar', hashes: { sha1: sha1('O'), sha512: sha512(jarOdd) }, downloads: ['https://github.com/o/odd.jar'], fileSize: 9 },
    { path: 'shaderpacks/bsl.zip', hashes: { sha1: sha1('Z'), sha512: sha512(jarOdd) }, downloads: ['https://evil.example.com/bsl.zip'], fileSize: 9 },
  ],
})));
zip.addFile('overrides/config/sodium.json', Buffer.from('{"a":1}'));
zip.addFile('overrides/options.txt', Buffer.from('personal'));
zip.addFile('client-overrides/config/extra.toml', Buffer.from('e=1'));
zip.addFile('overrides/../../escape.txt', Buffer.from('mal'));
const mrFile = path.join(tmp(), 'super.mrpack');
zip.writeZip(mrFile);

const info = mrpack.inspect(mrFile);
assert.deepStrictEqual(info.loader, { type: 'neoforge', version: '21.1.172' });
assert.strictEqual(info.minecraft, '1.21.1');
assert.strictEqual(info.mods, 2); // el mod solo de servidor no cuenta
assert.throws(() => mrpack.inspect(path.join(inst, 'minecraft', 'config', 'x.toml')), /mrpack válido/);

const calls = [];
const fakeHttp = {
  async json(url, body) {
    calls.push(url);
    if (url.endsWith('/version_files')) return { [sha1('S')]: { project_id: 'AANobbMI', version_number: 'mc1.21.1-0.6.0-neoforge' } };
    if (url.includes('/projects?ids=')) return [{ id: 'AANobbMI', slug: 'sodium' }];
    throw new Error('url inesperada ' + url);
  },
  async bytes(url) {
    if (url === 'https://github.com/o/odd.jar') return jarOdd;
    throw new Error('no debería descargar ' + url);
  },
};
const made3 = P.createPack(root, { name: 'Super Tech', minecraft: info.minecraft, loader: info.loader }, { rawRoot: RAW });
mrpack.importInto(made3.dir, mrFile, { http: fakeHttp }).then((r) => {
  assert.strictEqual(r.pinned, 1);
  assert.strictEqual(r.downloaded, 1); // odd.jar (GitHub permitido)
  assert.ok(r.skipped.some((s) => s.startsWith('shaderpacks/bsl.zip')), 'host no permitido se rechaza');
  const txt = fs.readFileSync(path.join(made3.dir, 'mods.txt'), 'utf8');
  assert.deepStrictEqual(mf.listMods(txt), [{ slug: 'sodium', pin: 'mc1.21.1-0.6.0-neoforge', section: 'Importados' }]);
  const f3 = path.join(made3.dir, 'files');
  assert.strictEqual(fs.readFileSync(path.join(f3, 'mods', 'odd.jar')).toString(), 'odd-bytes');
  assert.ok(!fs.existsSync(path.join(f3, 'mods', 'serveronly.jar')));
  assert.strictEqual(fs.readFileSync(path.join(f3, 'config', 'sodium.json'), 'utf8'), '{"a":1}');
  assert.ok(fs.existsSync(path.join(f3, 'config', 'extra.toml')), 'client-overrides se copia');
  assert.ok(!fs.existsSync(path.join(f3, 'options.txt')), 'options.txt es personal');
  assert.ok(!fs.existsSync(path.join(path.dirname(f3), '..', 'escape.txt')) && !fs.existsSync(path.join(tmp(), 'escape.txt')));
  assert.strictEqual(calls.length, 2);
  console.log('OK packs + mrpack');
}).catch((e) => { console.error(e); process.exit(1); });
