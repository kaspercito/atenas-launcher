'use strict';
// Carpetas compartidas con .minecraft. Ejecutar: node test/test-shared.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/lib/shared');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-shared-'));
const mc = path.join(root, '.minecraft'), inst = path.join(root, 'instances', 'pack1');
process.env.ATENAS_MC_DIR = mc;
const w = (p, t = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
let n = 0; const ok = (m) => console.log('  ok', ++n, m);

w(path.join(mc, 'resourcepacks', 'mio.zip'), 'A');
w(path.join(inst, 'resourcepacks', 'del-pack.zip'), 'B');
w(path.join(inst, 'screenshots', 'a.png'), 'S');
const logs = [];
S.apply(inst, {}, (l) => logs.push(l));
assert.ok(fs.lstatSync(path.join(inst, 'resourcepacks')).isSymbolicLink()); ok('resourcepacks queda enlazada');
assert.strictEqual(fs.readFileSync(path.join(mc, 'resourcepacks', 'del-pack.zip'), 'utf8'), 'B'); ok('lo que había en la instancia se mezcla en .minecraft');
assert.strictEqual(fs.readFileSync(path.join(inst, 'resourcepacks', 'mio.zip'), 'utf8'), 'A'); ok('la instancia ve lo que ya había en .minecraft');
assert.ok(fs.existsSync(path.join(mc, 'screenshots', 'a.png'))); ok('screenshots también se mezcla');
assert.ok(!fs.lstatSync(path.join(inst, 'config'), { throwIfNoEntry: false })); ok('config no se enlaza por defecto');

w(path.join(inst, 'resourcepacks', 'nuevo.zip'), 'N');
assert.ok(fs.existsSync(path.join(mc, 'resourcepacks', 'nuevo.zip'))); ok('un archivo nuevo en la instancia aparece en .minecraft');
S.apply(inst, {}, () => {}); ok('aplicar dos veces no rompe nada');

// no pisa lo existente
w(path.join(mc, 'logs', 'latest.log'), 'MC');
w(path.join(inst, 'config', 'mod.toml'), 'PACK'); // config sin enlazar
S.apply(inst, { config: true }, () => {});
assert.ok(fs.lstatSync(path.join(inst, 'config')).isSymbolicLink()); ok('config se enlaza si se activa');
assert.strictEqual(fs.readFileSync(path.join(mc, 'config', 'mod.toml'), 'utf8'), 'PACK'); ok('la config del pack pasa a la compartida si no existía');

// apagar la opción deja una carpeta propia con copia
S.apply(inst, { resourcepacks: false }, () => {});
assert.ok(fs.lstatSync(path.join(inst, 'resourcepacks')).isDirectory() && !fs.lstatSync(path.join(inst, 'resourcepacks')).isSymbolicLink()); ok('al apagarla vuelve a ser carpeta normal');
assert.ok(fs.existsSync(path.join(inst, 'resourcepacks', 'mio.zip')) && fs.existsSync(path.join(mc, 'resourcepacks', 'mio.zip'))); ok('con copia, y .minecraft no pierde nada');

// servers.dat
w(path.join(mc, 'servers.dat'), 'v1'); fs.utimesSync(path.join(mc, 'servers.dat'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
S.apply(inst, {}, () => {});
assert.strictEqual(fs.readFileSync(path.join(inst, 'servers.dat'), 'utf8'), 'v1'); ok('servers.dat se copia a la instancia antes de jugar');
w(path.join(inst, 'servers.dat'), 'v2'); // el juego añadió un servidor
S.finish(inst, {}, () => {});
assert.strictEqual(fs.readFileSync(path.join(mc, 'servers.dat'), 'utf8'), 'v2'); ok('al cerrar, la lista nueva vuelve a .minecraft');
S.apply(inst, { servers: false }, () => {}); S.finish(inst, { servers: false }, () => {});

// ---- mundos (saves): se enlazan y se mezclan igual que el resto
w(path.join(mc, 'saves', 'MiMundo', 'level.dat'), 'M');
w(path.join(inst, 'saves', 'DelPack', 'level.dat'), 'P');
S.apply(inst, {}, () => {});
assert.ok(fs.lstatSync(path.join(inst, 'saves')).isSymbolicLink()); ok('saves queda enlazada');
assert.ok(fs.existsSync(path.join(inst, 'saves', 'MiMundo', 'level.dat')) && fs.existsSync(path.join(mc, 'saves', 'DelPack', 'level.dat'))); ok('los mundos de .minecraft y los del pack se ven juntos y no se pierde ninguno');
S.apply(inst, { saves: false }, () => {});
assert.ok(!fs.lstatSync(path.join(inst, 'saves')).isSymbolicLink() && fs.existsSync(path.join(inst, 'saves', 'MiMundo', 'level.dat'))); ok('apagar saves deja carpeta propia con copia');
S.apply(inst, {}, () => {});

// ---- servers.dat: gana SIEMPRE el de .minecraft (aunque el de la instancia sea más nuevo), con copia de seguridad
w(path.join(mc, 'servers.dat'), 'MC-OFICIAL'); fs.utimesSync(path.join(mc, 'servers.dat'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));
w(path.join(inst, 'servers.dat'), 'INSTANCIA-NUEVA');
S.apply(inst, {}, () => {});
assert.strictEqual(fs.readFileSync(path.join(inst, 'servers.dat'), 'utf8'), 'MC-OFICIAL'); ok('servers.dat: se usa el de .minecraft aunque el de la instancia sea más nuevo');
assert.strictEqual(fs.readFileSync(path.join(inst, 'servers.dat.atenas-bak'), 'utf8'), 'INSTANCIA-NUEVA'); ok('el que se reemplazó queda como .atenas-bak');
w(path.join(inst, 'servers.dat'), 'MC-OFICIAL+nuevo'); S.finish(inst, {}, () => {});
assert.strictEqual(fs.readFileSync(path.join(mc, 'servers.dat'), 'utf8'), 'MC-OFICIAL+nuevo'); ok('al cerrar, lo nuevo vuelve a .minecraft');

// ---- options.txt
const LEG = 'key_key.attack:-100\nfov:0.5\n', MOD = 'version:3465\nkey_key.attack:key.mouse.left\nfov:0.5\n';
fs.rmSync(path.join(inst, 'options.txt'), { force: true }); fs.rmSync(path.join(mc, 'options.txt'), { force: true });
w(path.join(mc, 'options.txt'), MOD);
S.apply(inst, {}, () => {}, { minecraft: '1.20.1' });
assert.strictEqual(fs.readFileSync(path.join(inst, 'options.txt'), 'utf8'), MOD); ok('options.txt: una instancia 1.20.1 usa el de .minecraft (mismo formato)');
w(path.join(inst, 'options.txt'), MOD.replace('0.5', '1.0')); S.finish(inst, {}, () => {}, { minecraft: '1.20.1' });
assert.ok(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8').includes('fov:1.0')); ok('options.txt: el cambio hecho jugando vuelve a .minecraft');
// instancia 1.8.9 (formato viejo) NO debe tocar el options.txt moderno
fs.rmSync(path.join(inst, 'options.txt'), { force: true });
const logsO = []; S.apply(inst, {}, (l) => logsO.push(l), { minecraft: '1.8.9' });
assert.ok(!fs.existsSync(path.join(inst, 'options.txt'))); ok('1.8.9 no recibe el options.txt de una 1.20.1');
assert.ok(logsO.some((l) => /options\.txt: no se sincroniza/.test(l))); ok('y lo dice en el registro');
w(path.join(inst, 'options.txt'), LEG); const before = fs.readFileSync(path.join(mc, 'options.txt'), 'utf8');
S.finish(inst, {}, () => {}, { minecraft: '1.8.9' });
assert.strictEqual(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8'), before); ok('1.8.9 al cerrar no pisa el options.txt moderno de .minecraft');
// sin options.txt en .minecraft: la instancia lo crea y se guarda
fs.rmSync(path.join(mc, 'options.txt'), { force: true }); S.finish(inst, {}, () => {}, { minecraft: '1.8.9' });
assert.strictEqual(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8'), LEG); ok('si .minecraft no tenía options.txt se crea con el de la instancia');
// apagar la opción no toca nada
w(path.join(inst, 'options.txt'), 'solo-instancia'); S.apply(inst, { options: false }, () => {}, { minecraft: '1.8.9' }); S.finish(inst, { options: false }, () => {}, { minecraft: '1.8.9' });
assert.strictEqual(fs.readFileSync(path.join(inst, 'options.txt'), 'utf8'), 'solo-instancia'); assert.strictEqual(fs.readFileSync(path.join(mc, 'options.txt'), 'utf8'), LEG); ok('con la opción apagada no se copia nada');
fs.rmSync(root, { recursive: true, force: true });
console.log(`carpetas compartidas: todo bien (${n} comprobaciones)`);
