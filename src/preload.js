'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexer', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  save: (type, value) => ipcRenderer.invoke('store:save', type, value),
  startChat: (request) => ipcRenderer.invoke('chat:start', request),
  stopChat: (requestId) => ipcRenderer.invoke('chat:stop', requestId),
  ensureGateway: () => ipcRenderer.invoke('gateway:ensure'),
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  startAuth: () => ipcRenderer.invoke('accounts:auth-start'),
  submitAuthCode: (code) => ipcRenderer.invoke('accounts:auth-code', code),
  exportConversation: (markdown, name) => ipcRenderer.invoke('export:conversation', markdown, name),
  exportAll: (markdown) => ipcRenderer.invoke('export:all', markdown),
  clearData: () => ipcRenderer.invoke('data:clear'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  onChatEvent: (callback) => ipcRenderer.on('chat:event', (_event, payload) => callback(payload)),
  onGatewayStatus: (callback) => ipcRenderer.on('gateway:status', (_event, payload) => callback(payload)),
  onAuthEvent: (callback) => ipcRenderer.on('auth:event', (_event, payload) => callback(payload)),
  onMenuAction: (callback) => ipcRenderer.on('menu:action', (_event, payload) => callback(payload))
});
