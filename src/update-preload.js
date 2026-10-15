'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('upd', {
  get: () => ipcRenderer.invoke('upd:get'),
  onState: (cb) => ipcRenderer.on('upd:state', (_e, s) => cb(s)),
  install: () => ipcRenderer.send('upd:install'),
  later: () => ipcRenderer.send('upd:later'),
  retry: () => ipcRenderer.send('upd:retry'),
});
