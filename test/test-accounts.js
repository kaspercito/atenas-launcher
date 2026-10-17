'use strict';
const assert = require('assert');
const A = require('../src/lib/accounts');

const ms = (n, u) => ({ kind: 'microsoft', name: n, uuid: u, enc: 'x' + n });
const off = (n, u) => ({ kind: 'offline', name: n, uuid: u });

let l = [];
l = A.upsert(l, ms('Ana', 'AAAA'));
l = A.upsert(l, off('kasper', 'bbbb'));
assert.deepStrictEqual(l.map((a) => a.name), ['kasper', 'Ana'], 'la más reciente va primero');

// volver a iniciar la misma cuenta no la duplica y actualiza el token
l = A.upsert(l, { ...ms('Ana', 'aaaa'), enc: 'nuevo' });
assert.strictEqual(l.length, 2);
assert.strictEqual(l[0].enc, 'nuevo');
assert.strictEqual(l[0].name, 'Ana');

// la misma uuid pero de otro tipo son cuentas distintas
l = A.upsert(l, off('Ana', 'aaaa'));
assert.strictEqual(l.length, 3);

// entradas inválidas se ignoran
assert.strictEqual(A.upsert(l, { kind: 'otro', name: 'x', uuid: 'y' }).length, 3);
assert.strictEqual(A.clean([null, 5, { name: '', uuid: 'z', kind: 'offline' }]).length, 0);
assert.strictEqual(A.clean('nada').length, 0);

// quitar
const id = A.idOf(off('kasper', 'bbbb'));
assert.deepStrictEqual(A.remove(l, id).map((a) => a.name), ['Ana', 'Ana']);

// la vista no filtra tokens y marca la activa
const v = A.view(l, A.idOf(ms('Ana', 'AAAA')));
assert.ok(v.every((x) => !('enc' in x) && !('plain' in x)));
assert.strictEqual(v.filter((x) => x.active).length, 1);
assert.strictEqual(v.find((x) => x.active).kind, 'microsoft');

// máximo
let big = [];
for (let i = 0; i < 30; i++) big = A.upsert(big, off('j' + i, 'u' + i));
assert.strictEqual(big.length, A.MAX_ACCOUNTS);
assert.strictEqual(big[0].name, 'j29');
console.log('accounts: ok');
