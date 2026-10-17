'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { patchSplash, disableForgeSplash, isLegacy } = require('../src/lib/forgesplash');

assert.strictEqual(patchSplash(''), 'enabled=false\n');
assert.strictEqual(patchSplash('enabled=true\nrotate=false\n'), 'enabled=false\nrotate=false\n');
assert.strictEqual(patchSplash('# Splash\nrotate=true'), '# Splash\nrotate=true\nenabled=false\n');
assert.strictEqual(patchSplash('enabled=false\n'), 'enabled=false\n');
assert.ok(isLegacy('1.8.9') && isLegacy('1.12.2') && !isLegacy('1.20.1') && !isLegacy(''));

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-splash-'));
assert.strictEqual(disableForgeSplash(d, '1.8.9'), true);
assert.strictEqual(fs.readFileSync(path.join(d, 'config', 'splash.properties'), 'utf8'), 'enabled=false\n');
assert.strictEqual(disableForgeSplash(d, '1.8.9'), false);   // ya estaba apagada
assert.strictEqual(disableForgeSplash(d, '1.20.1'), false);  // no aplica
console.log('test-forgesplash OK');
