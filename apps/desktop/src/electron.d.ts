/** Shape of the bridge exposed by electron/preload.cjs (undefined in a browser). */
export interface FocusLockBridge {
  isElectron: true;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
}

declare global {
  interface Window {
    focuslock?: FocusLockBridge;
  }
}

export {};
