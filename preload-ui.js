'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['ui:select', 'ui:tab', 'ui:badges', 'ui:event', 'ui:focus', 'ui:viewState', 'git:line', 'git:task', 'git:done', 'ui:translate', 'ui:update']);

contextBridge.exposeInMainWorld('mt', {
  call: (ch, arg) => ipcRenderer.invoke(ch, arg),
  on: (ch, cb) => { if (EVENTS.has(ch)) ipcRenderer.on(ch, (e, d) => cb(d)); },
});
