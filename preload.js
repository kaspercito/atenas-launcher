'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('atenas', {
  init: () => invoke('app:init'),
  listPacks: () => invoke('packs:list'),
  checkPack: (id) => invoke('pack:check', id),
  updatePack: (id) => invoke('pack:update', id),
  play: (id) => invoke('pack:play', id),
  login: () => invoke('auth:login'),
  loginOffline: (name) => invoke('auth:offline', name),
  logout: () => invoke('auth:logout'),
  accounts: {
    list: () => invoke('accounts:list'),
    switchTo: (id) => invoke('accounts:switch', id),
    remove: (id) => invoke('accounts:remove', id),
  },
  setSettings: (patch) => invoke('settings:set', patch),
  ramInfo: (packId) => invoke('ram:info', packId),
  openFolder: (id, sub) => invoke('app:openFolder', id, sub),
  repairPack: (id) => invoke('pack:repair', id),
  serverStatus: (addr) => invoke('server:status', addr),
  openLink: (key) => invoke('app:openLink', key),
  optifine: {
    status: () => invoke('optifine:status'),
    download: () => invoke('optifine:download'),
    auto: () => invoke('optifine:auto'),
    pick: () => invoke('optifine:import'),
    useFound: () => invoke('optifine:useFound'),
  },
  updateStatus: () => invoke('app:updateStatus'),
  updateCheck: () => invoke('app:updateCheck'),
  updateInstall: () => invoke('app:updateInstall'),
  social: {
    state: () => invoke('social:state'),
    sync: () => invoke('social:sync'),
    add: (n) => invoke('social:add', n),
    accept: (n) => invoke('social:accept', n),
    remove: (n) => invoke('social:remove', n),
    history: (n, after) => invoke('social:history', n, after),
    send: (n, body) => invoke('social:send', n, body),
    onUpdate: subscribe('social:update'),
    onEvents: subscribe('social:events'),
    onOpen: subscribe('social:open'),
  },
  onAppUpdate: subscribe('app:update'),
  onAccountChanged: subscribe('account:changed'),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },
  onProgress: subscribe('pack:progress'),
  onUpdateAvailable: subscribe('pack:update-available'),
  onGameState: subscribe('game:state'),
  onGameLog: subscribe('game:log'),
});
