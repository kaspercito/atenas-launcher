'use strict';
const net = require('net');
const dns = require('dns').promises;

const writeVarInt = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};

/** Lee un VarInt; devuelve { value, size } o null si faltan bytes. */
function readVarInt(buf, offset = 0) {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= buf.length) return null;
    const b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
    if (!(b & 0x80)) return { value, size };
    if (size > 5) throw new Error('VarInt demasiado largo');
  }
}

const packet = (id, payload = Buffer.alloc(0)) => {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
};

/** Convierte el MOTD (texto o JSON de chat) en texto plano. */
function flattenMotd(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  let t = typeof d.text === 'string' ? d.text : '';
  if (Array.isArray(d.extra)) t += d.extra.map(flattenMotd).join('');
  return t.replace(/§./g, '');
}

function parseAddress(address) {
  const m = /^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/.exec(String(address || '').trim());
  if (!m) throw new Error('Dirección de servidor no válida');
  const port = m[2] ? Number(m[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) throw new Error('Puerto no válido');
  return { host: m[1], port };
}

async function resolveTarget(address) {
  const { host, port } = parseAddress(address);
  if (port) return { host, port, name: host };
  try {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv && srv.length) return { host: srv[0].name, port: srv[0].port, name: host };
  } catch { /* sin registro SRV: puerto por defecto */ }
  return { host, port: 25565, name: host };
}

/**
 * Consulta el estado de un servidor de Minecraft Java.
 * Devuelve { online, motd, players:{online,max,names}, version, latency }.
 */
async function pingServer(address, { timeoutMs = 5000, target } = {}) {
  const t = target || await resolveTarget(address);
  return new Promise((resolve) => {
    const sock = net.connect({ host: t.host, port: t.port });
    let buf = Buffer.alloc(0);
    let sentAt = 0;
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(res);
    };
    sock.setTimeout(timeoutMs, () => finish({ online: false }));
    sock.on('error', () => finish({ online: false }));
    sock.on('close', () => finish({ online: false }));

    sock.on('connect', () => {
      const host = Buffer.from(t.name, 'utf8');
      const port = Buffer.alloc(2);
      port.writeUInt16BE(t.port);
      sock.write(Buffer.concat([
        packet(0x00, Buffer.concat([writeVarInt(765), writeVarInt(host.length), host, port, writeVarInt(1)])),
        packet(0x00),
      ]));
      sentAt = Date.now();
    });

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarInt(buf);
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarInt(buf, len.size);
        const strLen = readVarInt(buf, len.size + id.size);
        if (!strLen) return;
        const start = len.size + id.size + strLen.size;
        if (buf.length < start + strLen.value) return;
        const json = JSON.parse(buf.subarray(start, start + strLen.value).toString('utf8'));
        const names = ((json.players && json.players.sample) || []).map((p) => String(p.name)).filter(Boolean).slice(0, 12);
        finish({
          online: true,
          motd: flattenMotd(json.description).trim(),
          players: { online: (json.players && json.players.online) || 0, max: (json.players && json.players.max) || 0, names },
          version: (json.version && json.version.name) || '',
          latency: Date.now() - sentAt,
        });
      } catch {
        finish({ online: false });
      }
    });
  });
}

module.exports = { pingServer, parseAddress, flattenMotd, readVarInt, writeVarInt };
