'use strict';
const API = 'https://api.modrinth.com/v2';
const UA = 'Atenas-Launcher/1.0 (atenas-admin)';

async function getJson(url) {
  let res;
  try { res = await fetch(url, { headers: { 'User-Agent': UA } }); }
  catch { throw new Error('No se pudo conectar con Modrinth. Revisa tu internet.'); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Modrinth respondió HTTP ${res.status}`);
  return res.json();
}

const slim = (p) => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  icon: p.icon_url || null,
  downloads: p.downloads || 0,
  author: p.author || null,
});

async function search(query, { mc, loader, offset = 0, limit = 20 }) {
  const facets = [['project_type:mod']];
  if (loader) facets.push([`categories:${loader}`]);
  if (mc) facets.push([`versions:${mc}`]);
  const url = `${API}/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=${limit}&offset=${offset}&index=${query ? 'relevance' : 'downloads'}`;
  const r = await getJson(url);
  return { hits: (r && r.hits || []).map((h) => slim({ ...h, icon_url: h.icon_url })), total: r ? r.total_hits : 0 };
}

/** Info (nombre, icono) de varios slugs de golpe. */
async function projects(slugs) {
  if (!slugs.length) return {};
  const out = {};
  for (let i = 0; i < slugs.length; i += 50) {
    const chunk = slugs.slice(i, i + 50);
    const r = await getJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const p of r || []) {
      const s = slim(p);
      out[p.slug.toLowerCase()] = s;
      out[p.id] = s;
    }
  }
  return out;
}

async function versions(slug, { mc, loader }) {
  const qs = `loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const r = await getJson(`${API}/project/${encodeURIComponent(slug)}/version?${qs}`);
  if (r === null) throw new Error(`"${slug}" no existe en Modrinth`);
  return r.map((v) => ({ number: v.version_number, type: v.version_type, date: v.date_published, file: (v.files.find((f) => f.primary) || v.files[0] || {}).filename }));
}

module.exports = { search, projects, versions };
