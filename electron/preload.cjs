const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  getPlatform: () => ipcRenderer.invoke("app:platform"),
  getHardwareProfile: () => ipcRenderer.invoke("app:hardware-profile"),
  startBackend: () => ipcRenderer.invoke("backend:start"),
  stopBackend: () => ipcRenderer.invoke("backend:stop"),
  getBackendStatus: () => ipcRenderer.invoke("backend:get-status"),
  getDesktopToken: () => ipcRenderer.invoke("backend:get-desktop-token"),
  selectMediaFile: () => ipcRenderer.invoke("file:select-media"),
  saveSubtitleFile: (options) => ipcRenderer.invoke("file:save-subtitle", options),
  onBackendStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("backend:status", handler);
    return () => ipcRenderer.removeListener("backend:status", handler);
  },
  setOverlayVisible: (visible) => ipcRenderer.invoke("overlay:set-visible", visible),
  setOverlayInteractive: (interactive) => ipcRenderer.invoke("overlay:set-interactive", interactive),
  setOverlayBounds: (bounds) => ipcRenderer.invoke("overlay:set-bounds", bounds),
  updateOverlay: (payload) => ipcRenderer.send("overlay:update", payload),
  onOverlayPayload: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("overlay:payload", handler);
    return () => ipcRenderer.removeListener("overlay:payload", handler);
  },
  onOverlayPosition: (listener) => {
    const handler = (_event, bounds) => listener(bounds);
    ipcRenderer.on("overlay:position", handler);
    return () => ipcRenderer.removeListener("overlay:position", handler);
  },
});
