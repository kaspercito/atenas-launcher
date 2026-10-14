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

/** Sube los cambios de la carpeta del pack. Devuelve { committed, pushed }. */
async function commitAndPush(dir, message, log) {
  const top = await root(dir);
  if (!top) throw new Error('La carpeta del pack no es un repositorio de git. Clona atenas-packs desde GitHub y elige esa carpeta.');
  await git(['add', '-A', '--', dir], top);
  const pending = await git(['status', '--porcelain', '--', dir], top);
  let committed = false;
  if (pending) {
    log('git commit…');
    await git(['commit', '-m', message, '--', dir], top);
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

async function dirtyCount(dir) {
  const top = await root(dir);
  if (!top) return null;
  const out = await git(['status', '--porcelain', '--', dir], top, 20000);
  return out ? out.split('\n').length : 0;
}

module.exports = { root, commitAndPush, dirtyCount };
