const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexer', {
  gateway: {
    status: () => ipcRenderer.invoke('gateway:status')
  },

  chat: {
    send: ({ id, model, messages }) => ipcRenderer.send('chat:send', { id, model, messages }),
    onEvent: (callback) => ipcRenderer.on('chat:event', (_event, payload) => callback(payload)),
    stop: (id) => ipcRenderer.send('chat:stop', id)
  },

  store: {
    listChats: () => ipcRenderer.invoke('store:listChats'),
    saveChat: (chat) => ipcRenderer.invoke('store:saveChat', chat),
    deleteChat: (id) => ipcRenderer.invoke('store:deleteChat', id),
    getSettings: () => ipcRenderer.invoke('store:getSettings'),
    setSettings: (settings) => ipcRenderer.invoke('store:setSettings', settings),
    getSkills: () => ipcRenderer.invoke('store:getSkills'),
    setSkills: (skills) => ipcRenderer.invoke('store:setSkills', skills),
    getRoutines: () => ipcRenderer.invoke('store:getRoutines'),
    setRoutines: (routines) => ipcRenderer.invoke('store:setRoutines', routines)
  },

  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    addStart: () => ipcRenderer.invoke('accounts:addStart'),
    addComplete: ({ session, code }) => ipcRenderer.invoke('accounts:addComplete', { session, code }),
    restartDaemon: () => ipcRenderer.invoke('accounts:restartDaemon')
  },

  sys: {
    openExternal: (url) => ipcRenderer.send('sys:openExternal', url),
    exportChat: (chat) => ipcRenderer.invoke('sys:exportChat', chat),
    onCommand: (callback) => ipcRenderer.on('app:command', (_event, command) => callback(command))
  }
});
