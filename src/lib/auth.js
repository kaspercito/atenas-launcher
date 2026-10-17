'use strict';
const crypto = require('crypto');
const { Auth } = require('msmc');

/** UUID de jugador sin conexión, igual que el que calculan los servidores vanilla (OfflinePlayer:<nombre>). */
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/**
 * Cuentas: Microsoft (premium, login oficial + renovación silenciosa) o sin conexión (no premium,
 * solo un nombre; funciona en servidores con online-mode=false y en un solo jugador).
 * `store` es { load(), save(obj), clear() } (lo implementa main.js).
 */
class Account {
  constructor(store) {
    this.store = store;
    this.mc = null; // objeto Minecraft de msmc
  }

  get info() {
    const saved = this.store.load();
    return saved && saved.name
      ? { name: saved.name, uuid: saved.uuid, kind: saved.kind === 'offline' ? 'offline' : 'microsoft' }
      : null;
  }

  loginOffline(name) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) {
      throw new Error('El nombre debe tener de 3 a 16 caracteres: letras, números o guion bajo');
    }
    this.mc = null;
    const uuid = offlineUuid(name);
    this.store.save({ kind: 'offline', name, uuid });
    return { name, uuid, kind: 'offline' };
  }

  /** Ventana oficial de Microsoft. Devuelve el objeto Minecraft de msmc y los datos de la cuenta (sin guardar nada). */
  async _microsoft(windowOptions) {
    const auth = new Auth('select_account');
    let xbox;
    try {
      xbox = await auth.launch('electron', { width: 520, height: 680, resizable: false, ...windowOptions });
    } catch (err) {
      throw new Error(String(err).includes('closed') ? 'Cerraste la ventana de inicio de sesión' : 'Error de inicio de sesión: ' + err);
    }
    const mc = await xbox.getMinecraft();
    const p = mc.profile;
    if (!p) throw new Error('Esta cuenta de Microsoft no tiene Minecraft Java Edition');
    return { mc, entry: { kind: 'microsoft', refreshToken: xbox.save(), name: p.name, uuid: p.id } };
  }

  async login() {
    const { mc, entry } = await this._microsoft();
    this.mc = mc;
    this.store.save(entry);
    return { name: entry.name, uuid: entry.uuid, kind: 'microsoft' };
  }

  /**
   * Inicia sesión con otra cuenta de Microsoft SIN cambiar la cuenta activa (para añadirla desde el juego).
   * Devuelve { kind, refreshToken, name, uuid }; quien llama la guarda en la lista de cuentas.
   */
  async addMicrosoft(windowOptions) {
    return (await this._microsoft(windowOptions)).entry;
  }

  /** Devuelve el objeto de autorización para MCLC, renovando el token si hace falta. */
  async getMclc() {
    const saved = this.store.load();
    if (saved && saved.kind === 'offline') {
      return {
        access_token: saved.uuid,
        client_token: saved.uuid,
        uuid: saved.uuid,
        name: saved.name,
        user_properties: '{}',
        meta: { type: 'mojang', demo: false },
      };
    }
    if (this.mc && this.mc.validate()) return this.mc.mclc();
    if (!saved || !saved.refreshToken) {
      const e = new Error('NEED_LOGIN');
      e.code = 'NEED_LOGIN';
      throw e;
    }
    try {
      const auth = new Auth('select_account');
      const xbox = await auth.refresh(saved.refreshToken);
      this.mc = await xbox.getMinecraft();
      this.store.save({ ...saved, refreshToken: xbox.save() });
      return this.mc.mclc();
    } catch (err) {
      const e = new Error('NEED_LOGIN');
      e.code = 'NEED_LOGIN';
      throw e;
    }
  }

  logout() {
    this.mc = null;
    this.store.clear();
  }
}

module.exports = { Account, offlineUuid, NAME_RE };
