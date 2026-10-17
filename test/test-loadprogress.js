'use strict';
const assert = require('assert');
const { createTracker } = require('../src/lib/loadprogress');

const t = createTracker();
assert.strictEqual(t.state.pct, 3);
let s = t.feed('[main/INFO]: Setting user: Steve');
assert.ok(s.pct >= 8);
s = t.feed('[Client thread/INFO] [FML]: Forge Mod Loader version 11.15.1.2318 for Minecraft 1.8.9 loading');
assert.strictEqual(s.text, 'Cargando Forge');
s = t.feed('[main/INFO] [FML]: Forge Mod Loader has identified 3 mods to load');
assert.strictEqual(s.text, 'Reconociendo mods');
const before = s.pct;
s = t.feed('[main/INFO]: Setting user: Steve');            // una linea de un hito anterior no hace retroceder
assert.ok(s.pct >= before);
s = t.feed('[FML]: Pre-Initializing atenasclient');
assert.strictEqual(s.text, 'Cargando mods');
s = t.feed('[FML]: Initializing mods');
assert.ok(s.pct > 58);
// el creep avanza despacio pero no pasa del tope del hito actual
for (let i = 0; i < 200; i++) s = t.creep();
assert.ok(s.pct < 100 && !s.ready, 'sin MENU_READY nunca llega al 100');
s = t.feed('[Client thread/INFO]: [Atenas] MENU_READY');
assert.strictEqual(s.pct, 100); assert.strictEqual(s.ready, true);

// Otro modpack (sin el cliente de Atenas): nunca llega MENU_READY, pero el sonido marca que ya casi esta el menu
const g = createTracker();
let gs = g.feed('[main/INFO]: Setting user: Steve');
assert.strictEqual(gs.sound, false);
gs = g.feed('[Render thread/INFO]: Reloading ResourceManager: vanilla');
assert.strictEqual(gs.ready, false);
gs = g.feed('[Sound Library Loader/INFO]: Sound engine started');
assert.strictEqual(gs.sound, true); assert.strictEqual(gs.ready, false);
assert.ok(gs.pct >= 84);
console.log('test-loadprogress OK');
