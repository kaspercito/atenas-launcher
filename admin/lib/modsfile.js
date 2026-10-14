'use strict';
/**
 * Edita mods.txt sin destruir tus comentarios ni tus secciones.
 * Una sección es un comentario tipo:  # ── Rendimiento (cliente) ───────
 */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const MOD_RE = /^(\s*)([A-Za-z0-9._-]+)(?:@([^\s#]+))?\s*(#.*)?$/;
const SECTION_RE = /^#\s*[─\-]+\s*(.+?)\s*[─\-]*\s*$/;

function parse(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = [];
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { lines.push({ kind: 'blank', raw }); continue; }
    if (t.startsWith('#')) {
      const m = SECTION_RE.exec(t);
      if (m && /[\p{L}\p{N}]/u.test(m[1])) section = m[1].trim();
      lines.push({ kind: 'comment', raw, section: m && /[\p{L}\p{N}]/u.test(m[1]) ? m[1].trim() : null });
      continue;
    }
    const m = MOD_RE.exec(raw);
    if (!m) throw new Error(`Línea no válida en mods.txt: "${raw}"`);
    lines.push({ kind: 'mod', raw, slug: m[2], pin: m[3] || null, trailing: m[4] || '', section });
  }
  // el split deja una última línea vacía si el archivo termina en salto de línea
  return { lines, eol };
}

function serialize({ lines, eol }) {
  const out = lines.map((l) => l.raw);
  return out.join(eol);
}

const fmtLine = (slug, pin, trailing = '') => `${slug}${pin ? '@' + pin : ''}${trailing ? '  ' + trailing : ''}`;

function listMods(text) {
  return parse(text).lines.filter((l) => l.kind === 'mod').map((l) => ({ slug: l.slug, pin: l.pin, section: l.section }));
}

function listSections(text) {
  const seen = [];
  for (const l of parse(text).lines) if (l.kind === 'comment' && l.section && !seen.includes(l.section)) seen.push(l.section);
  return seen;
}

function checkSlug(slug) {
  if (!SLUG_RE.test(slug || '')) throw new Error(`"${slug}" no es un slug de Modrinth válido (solo letras, números, . _ -)`);
}
function checkPin(pin) {
  if (pin && !/^[^\s#@]+$/.test(pin)) throw new Error(`Versión no válida: "${pin}"`);
}

function addMod(text, { slug, pin = null, section = null }) {
  checkSlug(slug); checkPin(pin);
  const doc = parse(text);
  if (doc.lines.some((l) => l.kind === 'mod' && l.slug.toLowerCase() === slug.toLowerCase())) {
    throw new Error(`"${slug}" ya está en la lista`);
  }
  const newLine = { kind: 'mod', raw: fmtLine(slug, pin), slug, pin, trailing: '', section };
  let at = -1;
  if (section) {
    doc.lines.forEach((l, i) => { if ((l.kind === 'mod' && l.section === section) || (l.kind === 'comment' && l.section === section)) at = i; });
  }
  if (at >= 0) {
    doc.lines.splice(at + 1, 0, newLine);
  } else {
    while (doc.lines.length && doc.lines[doc.lines.length - 1].kind === 'blank') doc.lines.pop();
    if (section) {
      doc.lines.push({ kind: 'blank', raw: '' });
      const bar = '─'.repeat(Math.max(3, 60 - section.length));
      doc.lines.push({ kind: 'comment', raw: `# ── ${section} ${bar}`, section });
    }
    doc.lines.push(newLine);
    doc.lines.push({ kind: 'blank', raw: '' });
  }
  return serialize(doc);
}

function removeMod(text, slug) {
  const doc = parse(text);
  const n = doc.lines.length;
  doc.lines = doc.lines.filter((l) => !(l.kind === 'mod' && l.slug.toLowerCase() === String(slug).toLowerCase()));
  if (doc.lines.length === n) throw new Error(`"${slug}" no está en la lista`);
  return serialize(doc);
}

function setPin(text, slug, pin) {
  checkPin(pin);
  const doc = parse(text);
  let found = false;
  for (const l of doc.lines) {
    if (l.kind === 'mod' && l.slug.toLowerCase() === String(slug).toLowerCase()) {
      l.pin = pin || null;
      l.raw = fmtLine(l.slug, l.pin, l.trailing);
      found = true;
    }
  }
  if (!found) throw new Error(`"${slug}" no está en la lista`);
  return serialize(doc);
}

function moveMod(text, slug, section) {
  const doc = parse(text);
  const l = doc.lines.find((x) => x.kind === 'mod' && x.slug.toLowerCase() === String(slug).toLowerCase());
  if (!l) throw new Error(`"${slug}" no está en la lista`);
  const pin = l.pin;
  return addMod(removeMod(text, slug), { slug: l.slug, pin, section });
}

module.exports = { parse, serialize, listMods, listSections, addMod, removeMod, setPin, moveMod, SLUG_RE };
