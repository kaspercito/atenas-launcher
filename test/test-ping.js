'use strict';
const assert = require('assert');
const net = require('net');
const { pingServer, parseAddress, flattenMotd, writeVarInt, readVarInt } = require('../src/lib/ping');

function fakeServer(status) {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => {
      let got = Buffer.alloc(0);
      s.on('data', (d) => {
        got = Buffer.concat([got, d]);
        const json = Buffer.from(JSON.stringify(status));
        const body = Buffer.concat([writeVarInt(0), writeVarInt(json.length), json]);
        s.write(Buffer.concat([writeVarInt(body.length), body]));
      });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  assert.strictEqual(readVarInt(writeVarInt(300)).value, 300);
  assert.deepStrictEqual(parseAddress('atenasmc.live'), { host: 'atenasmc.live', port: null });
  assert.strictEqual(parseAddress('a.b:25570').port, 25570);
  assert.throws(() => parseAddress('x y'));
  assert.strictEqual(flattenMotd({ text: '§aHola', extra: [{ text: ' mundo' }] }), 'Hola mundo');

  const srv = await fakeServer({
    version: { name: 'Forge 1.20.1', protocol: 763 },
    players: { max: 20, online: 3, sample: [{ name: 'kasper', id: 'x' }, { name: 'ana', id: 'y' }] },
    description: { text: 'Atenas SMP' },
  });
  const port = srv.address().port;
  const r = await pingServer(`127.0.0.1:${port}`);
  assert.strictEqual(r.online, true);
  assert.strictEqual(r.players.online, 3);
  assert.deepStrictEqual(r.players.names, ['kasper', 'ana']);
  assert.strictEqual(r.motd, 'Atenas SMP');
  srv.close();

  const off = await pingServer('127.0.0.1:1', { timeoutMs: 1500 });
  assert.strictEqual(off.online, false);
  console.log('OK ping');
})().catch((e) => { console.error(e); process.exit(1); });
