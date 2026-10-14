'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('admin', {
  init: inv('app:init'),
  chooseRepo: inv('repo:choose'),
  selectPack: inv('pack:select'),
  loadPack: inv('pack:load'),
  openFolder: inv('pack:openFolder'),
  addMod: inv('mods:add'),
  removeMod: inv('mods:remove'),
  pinMod: inv('mods:pin'),
  moveMod: inv('mods:move'),
  discard: inv('mods:discard'),
  search: inv('mr:search'),
  versions: inv('mr:versions'),
  cfStatus: inv('cf:status'),
  cfSetKey: inv('cf:setKey'),
  cfClearKey: inv('cf:clearKey'),
  cfSearch: inv('cf:search'),
  importJars: inv('jar:import'),
  pickJars: inv('jar:pick'),
  deleteJar: inv('jar:delete'),
  getConfig: inv('pack:getConfig'),
  saveConfig: inv('pack:saveConfig'),
  loaderVersions: inv('loader:versions'),
  preview: inv('pack:preview'),
  publish: inv('pack:publish'),
  pathsFor: (files) => Array.from(files).map((f) => webUtils.getPathForFile(f)),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
});
