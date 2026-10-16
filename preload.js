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
  setSettings: (patch) => invoke('settings:set', patch),
  openFolder: (id, sub) => invoke('app:openFolder', id, sub),
  repairPack: (id) => invoke('pack:repair', id),
  serverStatus: (addr) => invoke('server:status', addr),
  openLink: (key) => invoke('app:openLink', key),
  updateStatus: () => invoke('app:updateStatus'),
  updateCheck: () => invoke('app:updateCheck'),
  updateInstall: () => invoke('app:updateInstall'),
  friends: () => invoke('friends:list'),
  addFriend: (n) => invoke('friends:add', n),
  removeFriend: (n) => invoke('friends:remove', n),
  onAppUpdate: subscribe('app:update'),
  onFriends: subscribe('friends:summary'),
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
