const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flowPostAgent", {
  getState: () => ipcRenderer.invoke("agent:get-state"),
  pair: (payload) => ipcRenderer.invoke("agent:pair", payload),
  disconnect: () => ipcRenderer.invoke("agent:disconnect"),
  deleteProfiles: () => ipcRenderer.invoke("agent:delete-profiles"),
  openProfiles: () => ipcRenderer.invoke("agent:open-profiles"),
  onState: (callback) =>
    ipcRenderer.on("agent:state", (_event, state) => callback(state)),
  onLog: (callback) =>
    ipcRenderer.on("agent:log", (_event, log) => callback(log)),
});
