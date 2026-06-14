const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronDemo", {
  onDemoState(callback) {
    ipcRenderer.on("demo-state", (_event, state) => callback(state));
  },
  onDemoLog(callback) {
    ipcRenderer.on("demo-log", (_event, entry) => callback(entry));
  },
  command(command, payload) {
    return ipcRenderer.invoke("demo-command", command, payload);
  },
  state() {
    return ipcRenderer.invoke("demo-state");
  }
});
