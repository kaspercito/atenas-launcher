'use strict';
const assert = require('assert');
const R = require('../src/lib/accountreq');

const now = 1_000_000_000_000;
const ok = (o) => R.parse({ id: 'r1', at: now, ...o }, now);

// válidos
assert.deepStrictEqual(ok({ action: 'add-microsoft' }), { id: 'r1', action: 'add-microsoft', at: now });
assert.strictEqual(ok({ action: 'add-offline', name: 'kasper_01' }).name, 'kasper_01');
assert.strictEqual(ok({ action: 'remove', target: 'microsoft:abc-123' }).target, 'microsoft:abc-123');

// inválidos
assert.strictEqual(R.parse(null, now), null);
assert.strictEqual(R.parse('x', now), null);
assert.strictEqual(ok({ action: 'borrar-todo' }), null, 'acción desconocida');
assert.strictEqual(ok({ action: 'add-offline', name: 'ab' }), null, 'nick muy corto');
assert.strictEqual(ok({ action: 'add-offline', name: 'a b c' }), null, 'nick con espacios');
assert.strictEqual(ok({ action: 'remove' }), null, 'sin objetivo');
assert.strictEqual(ok({ action: 'remove', target: '../../etc/passwd' }), null, 'objetivo raro');

// viejo o del futuro lejano
assert.strictEqual(R.parse({ id: 'r', action: 'add-microsoft', at: now - R.MAX_AGE_MS - 1 }, now), null);
assert.strictEqual(R.parse({ id: 'r', action: 'add-microsoft', at: now + R.MAX_AGE_MS + 1 }, now), null);
assert.strictEqual(R.parse({ id: 'r', action: 'add-microsoft' }, now), null, 'sin hora');

// respuesta
const r = R.result({ id: 'r1' }, false, 'x'.repeat(500));
assert.strictEqual(r.ok, false);
assert.strictEqual(r.id, 'r1');
assert.ok(r.message.length <= 200);

console.log('accountreq: ok');
