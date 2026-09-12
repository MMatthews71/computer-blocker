/**
 * Service bootstrap.
 *
 * Wires the store, the ProtectionService, and the HTTP API together, then
 * keeps everything alive. In production this process is what the OS supervises
 * (a Windows Service / launchd agent / systemd unit) so that "if the UI closes,
 * the service continues running" and "if the service stops, it restarts".
 *
 * Here we implement the parts that belong in user space:
 *  - a heartbeat / integrity tick,
 *  - graceful shutdown,
 *  - crash isolation so a bad request never takes the enforcer down.
 *
 * The OS-level supervision (auto-start with the OS, restart-on-exit) is
 * configured by the platform installer — see docs/ARCHITECTURE.md.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProtectionService } from './service.js';
import { Store } from './store.js';
import { createApiServer, DEFAULT_PORT } from './server.js';
import { ExtensionGuardian } from './guardian.js';
import { AppGuardian } from './appguard.js';
import { BreakNotifier } from './breaknotify.js';
import { notify } from './notify.js';

export interface BootOptions {
  dataDir?: string;
  port?: number;
}

export function boot(options: BootOptions = {}) {
  const dataDir = options.dataDir ?? join(homedir(), '.focuslock');
  const store = new Store(dataDir, join(dataDir, 'config.key'));
  const service = new ProtectionService(store);

  // The guardian closes supported browsers that run without the extension.
  // Enforcement is PERMANENT — the only thing that suspends it is a global
  // pause (the app guardian is suspended automatically, since it defers to the
  // engine, which allows everything while paused).
  const guardian = new ExtensionGuardian({
    isEnabled: () => !service.isPaused(),
    log,
  });
  guardian.start();

  // The app guardian closes running apps the user has blocked (e.g. Terraria).
  const appGuardian = new AppGuardian({
    evaluate: (name) => service.evaluateApp(name),
    onBlocked: (name, decision) => service.recordAppBlocked(name, decision),
    log,
  });
  appGuardian.start();

  // Warns the user (via a native OS notification, wherever they are) shortly
  // before an active break ends.
  const breakNotifier = new BreakNotifier({
    getActiveBreak: () => service.getState().breaks.activeBreak,
    notify: (title, body) => notify(title, body, log),
    log,
  });
  breakNotifier.start();

  const server = createApiServer(service, { port: options.port ?? DEFAULT_PORT, guardian, appGuardian });

  const status = service.getStatus();
  log(`FocusLock service listening on 127.0.0.1:${options.port ?? DEFAULT_PORT}`);
  log(`Protected targets: ${status.protectedTargets} | integrity: ${status.integrityOk ? 'OK' : 'FAILED (fail-closed)'}`);
  log('Extension enforcement: ON (permanent)');

  // Heartbeat: a cheap liveness signal a supervisor / the UI can observe, and
  // a natural place to re-verify integrity over time.
  const heartbeat = setInterval(() => {
    const s = service.getStatus();
    if (!s.integrityOk) {
      log('integrity check failing — enforcing fail-closed safe mode');
    }
  }, 30_000);
  heartbeat.unref?.();

  // Never let an unexpected error tear down protection.
  process.on('uncaughtException', (err) => log(`uncaught: ${err?.stack ?? err}`));
  process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${String(reason)}`));

  const shutdown = () => {
    log('shutting down…');
    clearInterval(heartbeat);
    guardian.stop();
    appGuardian.stop();
    breakNotifier.stop();
    server.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { service, server, store, guardian };
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[focuslock] ${new Date().toISOString()} ${message}`);
}

// Auto-boot when run directly (not when imported by tests). Use pathToFileURL
// so the comparison is correct on every platform — a naive `'file://' + argv[1]`
// never matches on Windows (backslash paths, and file:// vs file:///), which
// would silently prevent the service from ever starting.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  boot({ port: Number(process.env.FOCUSLOCK_PORT ?? DEFAULT_PORT) });
}
