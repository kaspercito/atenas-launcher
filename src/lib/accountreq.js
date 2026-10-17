'use strict';
/**
 * Pedidos de cuenta que el juego (Atenas Client) le hace al launcher mientras se juega.
 * El juego escribe config/account-request.json y el launcher contesta en config/account-result.json.
 * Solo se usan funciones puras aquí: main.js lee/borra los archivos y ejecuta la acción.
 *
 *   { id, action, target?, name?, at }
 *   action: 'add-microsoft' (abre el inicio de sesión de Microsoft y guarda la cuenta, sin cambiar la activa)
 *           'add-offline'   (guarda un nick sin conexión en la lista)
 *           'remove'        (quita una cuenta guardada; si era la activa, pasa a la siguiente)
 */
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/; // igual que auth.js

const ACTIONS = ['add-microsoft', 'add-offline', 'remove'];
const MAX_AGE_MS = 2 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;

/** Devuelve el pedido limpio o null si no es válido / es viejo. Nunca lanza. */
function parse(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '');
  if (!ACTIONS.includes(action)) return null;
  const at = Number(raw.at) || 0;
  if (!at || Math.abs(now - at) > MAX_AGE_MS) return null;
  const req = { id: String(raw.id || '').slice(0, 64), action, at };
  if (action === 'remove') {
    if (!ID_RE.test(String(raw.target || ''))) return null;
    req.target = String(raw.target);
  }
  if (action === 'add-offline') {
    if (!NAME_RE.test(String(raw.name || ''))) return null;
    req.name = String(raw.name);
  }
  return req;
}

/** Respuesta para el juego. */
function result(req, ok, message) {
  return { id: req ? req.id : '', ok: !!ok, message: String(message || '').slice(0, 200), at: Date.now() };
}

module.exports = { ACTIONS, MAX_AGE_MS, parse, result };
