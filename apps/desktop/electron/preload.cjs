/**
 * Preload script — runs in an isolated context with access to a limited set of
 * Node APIs, and exposes only a tiny, safe surface to the renderer via
 * contextBridge. The UI itself talks to the service over HTTP, so we expose
 * just app metadata here; the bridge is the seam for any future native calls
 * (e.g. "pick an installed app to block") without weakening isolation.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('focuslock', {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
