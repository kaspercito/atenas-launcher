'use strict';
const assert = require('assert');
const mf = require('../lib/modsfile');
const fs = require('fs'), path = require('path');
const real = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'atenas-packs', 'atenas-smp', 'mods.txt'), 'utf8');

// 1) ida y vuelta sin tocar nada
assert.strictEqual(mf.serialize(mf.parse(real)), real);
const mods = mf.listMods(real);
assert.ok(mods.length > 40);
assert.ok(mf.listSections(real).includes('Rendimiento (cliente)'));
assert.strictEqual(mods.find((m) => m.slug === 'embeddium').section, 'Rendimiento (cliente)');

// 2) añadir en sección existente: queda dentro de la sección
let t = mf.addMod(real, { slug: 'sodium-extra', section: 'Rendimiento (cliente)' });
assert.strictEqual(mf.listMods(t).find((m) => m.slug === 'sodium-extra').section, 'Rendimiento (cliente)');
// 3) sección nueva
t = mf.addMod(t, { slug: 'zz-test', pin: '1.0', section: 'Tecnología' });
const c = mf.listMods(t).find((m) => m.slug === 'zz-test');
assert.deepStrictEqual([c.section, c.pin], ['Tecnología', '1.0']);
// 4) duplicado y slug inválido
assert.throws(() => mf.addMod(t, { slug: 'ZZ-TEST' }), /ya está/);
assert.throws(() => mf.addMod(t, { slug: 'a b' }), /no es un slug/);
// 5) pin y quitar
t = mf.setPin(t, 'zz-test', null);
assert.strictEqual(mf.listMods(t).find((m) => m.slug === 'zz-test').pin, null);
t = mf.removeMod(t, 'zz-test'); t = mf.removeMod(t, 'sodium-extra');
assert.strictEqual(mf.listMods(t).length, mods.length);
// 6) mover
t = mf.moveMod(real, 'jei', 'Rendimiento (cliente)');
assert.strictEqual(mf.listMods(t).find((m) => m.slug === 'jei').section, 'Rendimiento (cliente)');
// 7) el parser de pack-sync sigue leyéndolo
const { parseModsTxt } = (() => { try { return require('../../tools/pack-sync'); } catch { return {}; } })();
if (parseModsTxt) assert.strictEqual(parseModsTxt(mf.addMod(real, { slug: 'x-y', section: 'Nueva' })).length, mods.length + 1);
// 8) CRLF se respeta
assert.ok(mf.addMod(real.replace(/\n/g, '\r\n'), { slug: 'zz' }).includes('\r\n'));
console.log('modsfile OK (' + mods.length + ' mods, ' + mf.listSections(real).length + ' secciones)');
