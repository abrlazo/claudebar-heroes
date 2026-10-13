// The floating bubble's OWN preload. Nothing from preload.js (the app's `window.bar`) is exposed here: the bubble page
// can only report that it was pressed / released / right-clicked (no arguments, so nothing can be forged) and listen
// for the badge main draws. Main checks the sender of every one of these channels again.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubble', {
  press: () => ipcRenderer.send('bubble:press'),
  release: () => ipcRenderer.send('bubble:release'),
  menu: () => ipcRenderer.send('bubble:menu'),
  onState: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('bubble:state', listener);
    return () => ipcRenderer.removeListener('bubble:state', listener);
  },
});
