'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout, ensure, migrate } = require('../src/lib/paths');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `atenas-${n}-`));
const w = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

const root = path.join(tmp('home'), '.atenasclient');
const L = ensure(layout(root));
for (const d of [L.config, L.instances, L.runtime, L.cache, L.electron, L.clientLocal, L.logs]) assert.ok(fs.statSync(d).isDirectory(), d);
assert.strictEqual(L.settings, path.join(root, 'config', 'settings.json'));

// carpeta antigua con datos + basura de Electron
const old = tmp('old');
w(path.join(old, 'settings.json'), '{"ramMb":6144}');
w(path.join(old, 'auth.json'), '{"kind":"offline"}');
w(path.join(old, 'instances', 'atenas-smp', 'mods', 'a.jar'), 'jar');
w(path.join(old, 'runtime', 'java-17', 'bin', 'java.exe'), 'j');
w(path.join(old, 'packs-cache.json'), '{}');
w(path.join(old, 'client-local', 'AtenasClient-1.0.0.jar'), 'c');
w(path.join(old, 'updater.log'), 'log');
w(path.join(old, 'Cache', 'data_0'), 'electron');

const moved = migrate(old, L);
assert.deepStrictEqual(moved.sort(), ['auth.json', 'client-local', 'instances', 'packs-cache.json', 'runtime', 'settings.json', 'updater.log']);
assert.strictEqual(fs.readFileSync(L.settings, 'utf8'), '{"ramMb":6144}');
assert.ok(fs.existsSync(path.join(L.instances, 'atenas-smp', 'mods', 'a.jar')));
assert.ok(fs.existsSync(path.join(L.runtime, 'java-17', 'bin', 'java.exe')));
assert.ok(fs.existsSync(path.join(L.clientLocal, 'AtenasClient-1.0.0.jar')));
assert.ok(fs.existsSync(path.join(L.logs, 'updater.log')));
assert.ok(fs.existsSync(path.join(old, 'Cache', 'data_0')), 'no toca lo que no conoce');
assert.ok(!fs.existsSync(path.join(old, 'settings.json')));

// segunda vez: no hace nada aunque vuelva a haber datos viejos
w(path.join(old, 'settings.json'), 'nuevo-viejo');
assert.deepStrictEqual(migrate(old, L), []);
assert.strictEqual(fs.readFileSync(L.settings, 'utf8'), '{"ramMb":6144}');

// no pisa datos que ya existen en la carpeta nueva
const root2 = path.join(tmp('home'), '.atenasclient');
const L2 = ensure(layout(root2));
w(L2.settings, 'ya-existe');
const old2 = tmp('old2');
w(path.join(old2, 'settings.json'), 'viejo');
w(path.join(old2, 'auth.json'), 'cuenta');
assert.deepStrictEqual(migrate(old2, L2), ['auth.json']);
assert.strictEqual(fs.readFileSync(L2.settings, 'utf8'), 'ya-existe');
assert.ok(fs.existsSync(path.join(old2, 'settings.json')), 'el original se conserva si no se movió');

// sin carpeta antigua
assert.deepStrictEqual(migrate(path.join(tmp('x'), 'no-existe'), ensure(layout(path.join(tmp('h'), '.a')))), []);
console.log('test-paths: OK');
