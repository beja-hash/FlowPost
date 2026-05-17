const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flowPostAgentBrowser", {
  finish: () => ipcRenderer.send("agent:browser-finish"),
});
