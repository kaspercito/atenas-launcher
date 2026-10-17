'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loading', {
  onState: (cb) => ipcRenderer.on('load:state', (_e, s) => cb(s)),
  close: () => ipcRenderer.send('load:close'),
});
