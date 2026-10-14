'use strict';
const { execFile } = require('child_process');

function git(args, cwd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') return reject(new Error('Git no está instalado (o no está en el PATH). Instálalo desde git-scm.com.'));
          const e = new Error((stderr || stdout || err.message).trim());
          e.stderr = stderr;
          return reject(e);
        }
        resolve(stdout.trim());
      });
  });
}

async function root(dir) {
  try { return await git(['rev-parse', '--show-toplevel'], dir, 15000); } catch { return null; }
}

/**
 * Sube los cambios de la carpeta del pack (y de las rutas extra, p. ej. packs.json).
 * Devuelve { committed, pushed }.
 */
async function commitAndPush(dir, message, log, extra = [], { skipDir = false } = {}) {
  const top = await root(dir);
  if (!top) throw new Error('La carpeta del pack no es un repositorio de git. Clona atenas-packs desde GitHub y elige esa carpeta.');
  // skipDir: se usa al borrar un pack (la carpeta ya no existe, solo se suben las rutas indicadas)
  const paths = skipDir ? extra : [dir, ...extra];
  await git(['add', '-A', '--', ...paths], top);
  const pending = await git(['status', '--porcelain', '--', ...paths], top);
  let committed = false;
  if (pending) {
    log('git commit…');
    await git(['commit', '-m', message, '--', ...paths], top);
    committed = true;
  } else {
    log('No hay cambios nuevos que subir.');
  }
  log('git push…');
  try {
    await git(['push'], top, 300000);
  } catch (err) {
    if (/rejected|non-fast-forward|fetch first/i.test(err.message)) {
      log('El remoto tiene cambios nuevos: combinando (pull --rebase)…');
      await git(['pull', '--rebase', '--autostash'], top, 300000);
      await git(['push'], top, 300000);
    } else if (/no upstream|has no upstream/i.test(err.message)) {
      await git(['push', '-u', 'origin', 'HEAD'], top, 300000);
    } else {
      throw new Error('No se pudo hacer push: ' + err.message);
    }
  }
  return { committed, pushed: true };
}

/** "https://github.com/o/r.git" o "git@github.com:o/r.git" -> { owner, repo } */
function parseGithubRemote(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** URL base pública (raw.githubusercontent.com/…/rama) del repositorio de la carpeta, o null. */
async function remoteRaw(dir) {
  try {
    const top = await root(dir);
    if (!top) return null;
    const gh = parseGithubRemote(await git(['remote', 'get-url', 'origin'], top, 15000));
    if (!gh) return null;
    let branch = 'main';
    try { const b = await git(['rev-parse', '--abbrev-ref', 'HEAD'], top, 15000); if (b && b !== 'HEAD') branch = b; } catch { /* repo sin commits */ }
    return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}`;
  } catch { return null; }
}

async function dirtyCount(dir) {
  const top = await root(dir);
  if (!top) return null;
  const out = await git(['status', '--porcelain', '--', dir], top, 20000);
  return out ? out.split('\n').length : 0;
}

module.exports = { root, commitAndPush, dirtyCount, remoteRaw, parseGithubRemote };
