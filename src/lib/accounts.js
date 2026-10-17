'use strict';
/**
 * Lista de cuentas guardadas en el launcher (para poder cambiar de una a otra sin volver a iniciar sesión).
 * Cada entrada es lo mismo que se guarda de la cuenta activa: { kind, name, uuid, enc|plain } (el token va cifrado).
 * Funciones puras: main.js se encarga de leer y escribir el archivo.
 */
const MAX_ACCOUNTS = 12;

const kindOf = (a) => (a && a.kind === 'offline' ? 'offline' : 'microsoft');
const idOf = (a) => `${kindOf(a)}:${String(a.uuid).toLowerCase()}`;
const valid = (a) => !!a && typeof a === 'object' && typeof a.name === 'string' && a.name !== '' && typeof a.uuid === 'string' && a.uuid !== ''
  && (a.kind === 'offline' || a.kind === 'microsoft');

/** Deja solo entradas válidas, sin repetidas (gana la primera) y con un máximo. */
function clean(list) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!valid(a)) continue;
    const id = idOf(a);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(a);
    if (out.length >= MAX_ACCOUNTS) break;
  }
  return out;
}

/** Pone la cuenta al principio (la más reciente); si ya estaba, se reemplaza con los datos nuevos (token renovado). */
function upsert(list, raw) {
  if (!valid(raw)) return clean(list);
  const id = idOf(raw);
  return clean([{ ...raw }, ...clean(list).filter((a) => idOf(a) !== id)]);
}

function remove(list, id) {
  return clean(list).filter((a) => idOf(a) !== id);
}

/** Lo que ve la interfaz: nunca incluye tokens. */
function view(list, activeId) {
  return clean(list).map((a) => ({ id: idOf(a), kind: kindOf(a), name: a.name, uuid: a.uuid, active: idOf(a) === activeId }));
}

module.exports = { MAX_ACCOUNTS, idOf, kindOf, valid, clean, upsert, remove, view };
