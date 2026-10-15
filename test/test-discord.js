'use strict';
// Prueba el cliente de Discord RPC contra un "Discord" falso (socket Unix en Linux/Mac; en Windows se omite).
const assert = require('assert');
if (process.platform === 'win32') { console.log('test-discord: omitido en Windows'); process.exit(0); }
const net = require('net'); const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-')); process.env.XDG_RUNTIME_DIR = dir;
const { DiscordRpc } = require('../src/lib/discord');
const fr = (op, d) => { const j = Buffer.from(JSON.stringify(d)); const b = Buffer.alloc(8 + j.length); b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8); return b; };
const srv = net.createServer((s) => {
  const got = [];
  s.on('data', (d) => {
    const op = d.readInt32LE(0); const msg = JSON.parse(d.subarray(8, 8 + d.readInt32LE(4)));
    if (op === 0) { assert.strictEqual(msg.client_id, '123456789012345678'); s.write(fr(1, { cmd: 'DISPATCH', evt: 'READY' })); }
    else { assert.strictEqual(msg.cmd, 'SET_ACTIVITY'); assert.strictEqual(msg.args.activity.details, 'Jugando Atenas'); assert.strictEqual(msg.args.activity.assets.small_image, 'https://mc-heads.net/avatar/Miguel/128'); assert.strictEqual(msg.args.activity.assets.small_text, 'Miguel'); assert.strictEqual(msg.args.activity.buttons.length, 1); assert.strictEqual(msg.args.activity.buttons[0].label, 'Descargar'); console.log('test-discord: OK'); s.destroy(); srv.close(); rpc.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
const rpc = new DiscordRpc('123456789012345678');
srv.listen(path.join(dir, 'discord-ipc-0'), () => { rpc.start(); rpc.set({ details: 'Jugando Atenas', startedAt: Date.now(), smallImage: 'https://mc-heads.net/avatar/Miguel/128', smallText: 'Miguel', buttons: [{ label: 'Descargar', url: 'https://example.com/x' }, { label: 'mala', url: 'http://inseguro' }] }); });
setTimeout(() => { console.error('test-discord: TIMEOUT'); process.exit(1); }, 5000).unref();
