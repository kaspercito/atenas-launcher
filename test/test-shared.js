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
fs.rmSync(root, { recursive: true, force: true });
console.log(`carpetas compartidas: todo bien (${n} comprobaciones)`);
