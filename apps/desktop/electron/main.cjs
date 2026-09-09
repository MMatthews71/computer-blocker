/**
 * FocusLock desktop — Electron main process.
 *
 * Responsibilities:
 *  1. Make sure the Background Protection Service is running. If it isn't, we
 *     spawn it as a DETACHED child so it keeps running even after this window
 *     closes — upholding the spec's "if the UI closes, the service continues".
 *  2. Create the application window and load the React UI (the Vite dev server
 *     in development, or the built files in production).
 *
 * The renderer talks to the service over loopback HTTP exactly as it does in a
 * browser; Electron just gives it a native, chromeless home.
 */

const { app, BrowserWindow, shell } = require('electron');
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const SERVICE_HOST = '127.0.0.1';
const SERVICE_PORT = Number(process.env.FOCUSLOCK_PORT || 47615);
const DEV_URL = process.env.ELECTRON_START_URL; // set in the electron:dev script

// Must match SERVICE_VERSION in packages/service/src/service.ts. If the running
// service reports a different version, it's stale (the service outlives the UI)
// and we replace it so new engine behaviour — like keyword matching — takes
// effect without the user having to hunt down a background process.
const EXPECTED_SERVICE_VERSION = '0.4.0-browsers';

// Repo root, resolved from apps/desktop/electron -> ../../..
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVICE_ENTRY = path.join(REPO_ROOT, 'packages', 'service', 'dist', 'index.js');
const BUILT_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

/** GET /health and resolve the parsed JSON, or null if the service isn't up. */
function getHealth(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: SERVICE_HOST, port: SERVICE_PORT, path: '/health', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function pingService(timeoutMs = 800) {
  return (await getHealth(timeoutMs)) !== null;
}

/** Ask the running service to exit; resolve true once it's actually gone. */
function shutdownService(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: SERVICE_HOST, port: SERVICE_PORT, path: '/shutdown', method: 'POST', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Last-resort: kill whatever process is listening on the service port. */
function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (new RegExp(`:${port}\\b`).test(line) && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== '0') pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
          log(`freed port ${port} (killed pid ${pid})`);
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { shell: '/bin/bash' });
    }
  } catch (err) {
    log(`freePort(${port}) failed: ${err.message}`);
  }
}

/** Start the service as a detached background process if it isn't already up. */
async function ensureServiceRunning() {
  const health = await getHealth();
  if (health) {
    if (health.version === EXPECTED_SERVICE_VERSION) {
      log(`service already running (v${health.version})`);
      return;
    }
    // A stale service is running — replace it so new behaviour takes effect.
    log(`replacing outdated service (running v${health.version || 'unknown'}, expected v${EXPECTED_SERVICE_VERSION})`);
    const stopped = (await shutdownService()) && (await waitDown());
    if (!stopped) {
      log('graceful shutdown unavailable; freeing the port');
      freePort(SERVICE_PORT);
      await delay(400);
    }
  }
  if (!fs.existsSync(SERVICE_ENTRY)) {
    log(`service build not found at ${SERVICE_ENTRY} — run "npm run build" first`);
    return;
  }
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  log('starting background service…');

  // Send the service's output to a log file (not /dev/null) so that if it ever
  // fails to start, the reason is on disk instead of lost. The window still
  // never appears (detached + windowsHide).
  const dataDir = path.join(require('node:os').homedir(), '.focuslock');
  fs.mkdirSync(dataDir, { recursive: true });
  const logFd = fs.openSync(path.join(dataDir, 'service.log'), 'a');

  const child = spawn(nodeBin, [SERVICE_ENTRY], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, FOCUSLOCK_PORT: String(SERVICE_PORT) },
    windowsHide: true,
  });
  child.on('error', (err) => log(`failed to spawn service: ${err.message}`));
  child.unref(); // let it outlive this process

  // Wait (briefly) for it to come up so the first UI render sees live data.
  for (let i = 0; i < 20; i++) {
    if (await pingService()) {
      log('service is up');
      return;
    }
    await delay(150);
  }
  log('service did not report healthy in time (the UI will keep retrying)');
}

/** Resolve true once the service stops answering (used after /shutdown). */
async function waitDown(attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    if (!(await pingService(400))) return true;
    await delay(150);
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0c10',
    title: 'FocusLock',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the user's browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    loadWithRetry(win, DEV_URL);
  } else if (fs.existsSync(BUILT_INDEX)) {
    win.loadFile(BUILT_INDEX);
  } else {
    win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="font:16px sans-serif;background:#0b0c10;color:#e7e9ee;padding:40px">' +
          '<h2>FocusLock UI not built</h2><p>Run <code>npm run build</code> then relaunch.</p></body>',
        ),
    );
  }

  return win;
}

/** Retry loading the dev server until Vite is ready. */
function loadWithRetry(win, url, attempt = 0) {
  win.loadURL(url).catch(() => {
    if (attempt < 40 && !win.isDestroyed()) {
      setTimeout(() => loadWithRetry(win, url, attempt + 1), 250);
    }
  });
}

app.whenReady().then(() => {
  // Show the window IMMEDIATELY, then bring the service up in the background.
  // The renderer polls /health and fills in once the service answers, so there
  // is no reason to stare at a blank screen while we probe/spawn the service.
  // (Previously this awaited ensureServiceRunning() first, adding seconds of
  // nothing-on-screen to every launch.)
  createWindow();
  ensureServiceRunning().catch((err) => log(`ensureServiceRunning failed: ${err.message}`));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS). The background service
// was started detached, so it deliberately keeps running.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[focuslock-electron] ${message}`);
}
