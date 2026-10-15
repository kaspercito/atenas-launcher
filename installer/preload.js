'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inst', {
  install: () => ipcRenderer.invoke('install'),
  launch: () => ipcRenderer.send('launch'),
  close: () => ipcRenderer.send('close'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
