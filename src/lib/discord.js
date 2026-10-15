'use strict';
// Discord Rich Presence mínimo por IPC (sin dependencias). Si Discord no está abierto, reintenta solo.
const net = require('net');
const os = require('os');
const path = require('path');

const frame = (op, data) => { const j = Buffer.from(JSON.stringify(data)); const b = Buffer.alloc(8 + j.length); b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8); return b; };
const pipePath = (i) => process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir(), `discord-ipc-${i}`);

class DiscordRpc {
  constructor(clientId) { this.id = clientId; this.sock = null; this.ready = false; this.activity = null; this.enabled = false; this.timer = null; this.buf = Buffer.alloc(0); }
  start() { if (!/^\d{15,25}$/.test(String(this.id || ''))) return; this.enabled = true; this._connect(0); }
  stop() { this.enabled = false; clearTimeout(this.timer); this.ready = false; try { this.sock?.destroy(); } catch {} this.sock = null; }
  _retry() { this.ready = false; if (!this.enabled) return; clearTimeout(this.timer); this.timer = setTimeout(() => this._connect(0), 15000); this.timer.unref?.(); }
  _connect(i) {
    if (!this.enabled || i > 9) return this._retry();
    const s = net.createConnection(pipePath(i));
    let opened = false;
    s.on('connect', () => { opened = true; this.sock = s; this.buf = Buffer.alloc(0); s.write(frame(0, { v: 1, client_id: this.id })); });
    s.on('data', (d) => this._onData(d));
    s.on('error', () => { if (!opened) this._connect(i + 1); });
    s.on('close', () => { if (opened) { this.sock = null; this._retry(); } });
  }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null; try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8')); } catch {}
      this.buf = this.buf.subarray(8 + len);
      if (msg && msg.evt === 'READY') { this.ready = true; this._send(); }
    }
  }
  _send() {
    if (!this.ready || !this.sock) return;
    const args = { pid: process.pid, activity: this.activity || undefined };
    this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args, nonce: String(Date.now()) }));
  }
  // activity: { details, state, startedAt (ms), largeText }
  set(a) {
    this.activity = a ? {
      details: String(a.details || '').slice(0, 128), state: a.state ? String(a.state).slice(0, 128) : undefined,
      timestamps: a.startedAt ? { start: Math.floor(a.startedAt / 1000) } : undefined,
      assets: { large_image: 'icon', large_text: a.largeText || 'Atenas Launcher' },
    } : null;
    this._send();
  }
}
module.exports = { DiscordRpc };
