import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronDemo", {
  onHelperStatus(callback) {
    ipcRenderer.on("helper-status", (_event, status) => callback(status));
  }
});
