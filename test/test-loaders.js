'use strict';
// Pruebas sin red: URLs/ids de instaladores, Java por versión y argumentos JVM de NeoForge.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installerCoords } = require('../src/lib/loaders');
const { javaMajorFor } = require('../src/lib/java');
const { loaderJvmArgs } = require('../src/lib/launch');

// Forge
assert.deepStrictEqual(installerCoords('forge', '1.20.1', '47.3.0'), {
  id: '1.20.1-forge-47.3.0',
  url: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-installer.jar',
});
// NeoForge moderno (1.20.2+)
assert.deepStrictEqual(installerCoords('neoforge', '1.21.1', '21.1.172'), {
  id: 'neoforge-21.1.172',
  url: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.172/neoforge-21.1.172-installer.jar',
});
assert.strictEqual(installerCoords('neoforge', '1.20.4', '20.4.237').id, 'neoforge-20.4.237');
// NeoForge para 1.20.1: artefacto "forge" de net.neoforged
assert.deepStrictEqual(installerCoords('neoforge', '1.20.1', '47.1.106'), {
  id: '1.20.1-forge-47.1.106',
  url: 'https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar',
});

// Java requerido
for (const [mc, java] of [['1.16.5', 8], ['1.18.2', 17], ['1.20.1', 17], ['1.20.4', 17], ['1.20.6', 21], ['1.21', 21], ['1.21.1', 21], ['1.21.4', 21]]) {
  assert.strictEqual(javaMajorFor(mc), java, `Java para ${mc}`);
}

// Argumentos JVM de un perfil NeoForge (los lee el launcher porque MCLC los ignora)
const inst = fs.mkdtempSync(path.join(os.tmpdir(), 'atenas-neo-'));
const id = 'neoforge-21.1.172';
fs.mkdirSync(path.join(inst, 'versions', id), { recursive: true });
fs.writeFileSync(path.join(inst, 'versions', id, `${id}.json`), JSON.stringify({
  id, arguments: { jvm: [
    '-Djava.net.preferIPv6Addresses=system',
    '-DignoreList=bootstraplauncher,securejarhandler,fml_loader-,${version_name}.jar',
    '-DlibraryDirectory=${library_directory}',
    '-p', '${library_directory}/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar${classpath_separator}${library_directory}/cpw/mods/securejarhandler/3.0.8/securejarhandler-3.0.8.jar',
    '--add-modules', 'ALL-MODULE-PATH',
    '--add-opens', 'java.base/java.util.jar=cpw.mods.securejarhandler',
    '-cp', '${classpath}',
    '-Djava.library.path=${natives_directory}',
  ] },
}));
const args = loaderJvmArgs(inst, id);
const lib = path.join(inst, 'libraries');
assert.ok(args.includes(`-DlibraryDirectory=${lib}`), 'libraryDirectory');
assert.ok(args.some((a) => a.includes(`fml_loader-,${id}.jar`)), 'ignoreList con version_name');
const p = args.indexOf('-p');
assert.ok(p >= 0 && args[p + 1].includes(path.delimiter) && args[p + 1].startsWith(lib), 'module path');
assert.ok(args.includes('--add-modules') && args.includes('ALL-MODULE-PATH'), 'add-modules');
assert.ok(!args.some((a) => a.includes('${')), 'sin placeholders sin resolver');
assert.ok(!args.includes('-cp') && !args.some((a) => a.includes('natives')), 'sin classpath ni natives');
fs.rmSync(inst, { recursive: true, force: true });

console.log('test-loaders: OK');
