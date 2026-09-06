/**
 * App Guardian — enforces app/executable block rules by closing blocked apps.
 *
 * The browser extension enforces web rules; nothing on the OS enforces app
 * rules, so this does. Every few seconds it lists running processes and, for
 * any process the engine says is currently blocked, force-closes it. This is
 * what makes "block Terraria" actually block Terraria.
 *
 * SAFETY — the single most important property of this module: it will ONLY ever
 * close a process that matches a user-defined app/executable target. It decides
 * via the engine's `evaluateSafely`, which returns a non-null `targetId` only
 * when a managed target governed the request. We additionally require that
 * targetId to be non-null before killing. So even if config integrity fails
 * (where the web check fails *closed* and blocks everything), this guardian
 * never starts killing unrelated processes like explorer.exe or the service
 * itself — its blast radius is limited to apps the user explicitly listed.
 *
 * Unlike the extension guardian there is no grace period: a blocked app has no
 * "install something to become compliant" remedy, so it is closed promptly on
 * detection, the way a commitment device should behave.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Decision } from '@focuslock/core';

const execFileP = promisify(execFile);

export interface AppGuardianOptions {
  /** Ask the engine whether a running process (by image name) is blocked. */
  evaluate: (processName: string) => Decision;
  /** Record that a blocked app was closed (for statistics). Called once per new block. */
  onBlocked?: (processName: string, decision: Decision) => void;
  pollMs?: number;
  /** Injectable for tests; default lists/kills real processes. */
  listProcesses?: () => Promise<string[]>;
  killProcess?: (processName: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface BlockedApp {
  name: string;
  reason: string;
}

export class AppGuardian {
  private timer: NodeJS.Timeout | null = null;
  private prevBlocked = new Set<string>();
  private lastStatus: BlockedApp[] = [];

  private readonly pollMs: number;
  private readonly listProcesses: () => Promise<string[]>;
  private readonly killProcess: (name: string) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(private opts: AppGuardianOptions) {
    this.pollMs = opts.pollMs ?? 3_000;
    this.listProcesses = opts.listProcesses ?? defaultListProcesses;
    this.killProcess = opts.killProcess ?? defaultKillProcess;
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`app guardian tick error: ${String(err)}`));
    }, this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): BlockedApp[] {
    return this.lastStatus;
  }

  /** One monitoring pass. Exposed for tests. */
  async tick(): Promise<void> {
    const names = await this.listProcesses();
    const nowBlocked = new Set<string>();
    const statuses: BlockedApp[] = [];

    for (const name of names) {
      const decision = this.opts.evaluate(name);
      // Kill ONLY when a managed target governed this process (targetId set)
      // AND it resolved to blocked. This is the safety gate that keeps the
      // guardian from ever touching unmanaged/system processes.
      if (decision.allowed || decision.targetId == null) continue;

      const key = name.toLowerCase();
      nowBlocked.add(key);
      statuses.push({ name, reason: decision.reason });

      if (!this.prevBlocked.has(key)) {
        this.log(`closing ${name} — blocked (${decision.reason})`);
        this.opts.onBlocked?.(name, decision);
      }
      await this.killProcess(name).catch((err) => this.log(`kill ${name} failed: ${String(err)}`));
    }

    this.prevBlocked = nowBlocked;
    this.lastStatus = statuses;
  }
}

/** List the distinct image names of currently-running processes. */
async function defaultListProcesses(): Promise<string[]> {
  const names = new Set<string>();
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true });
      for (const line of stdout.split(/\r?\n/)) {
        // Each line: "Image Name","PID","Session","Session#","Mem Usage"
        const m = /^"([^"]+)"/.exec(line.trim());
        if (m && m[1]) names.add(m[1]);
      }
    } else {
      const { stdout } = await execFileP('ps', ['-A', '-o', 'comm=']);
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Use the basename so "/Applications/Foo.app/.../Foo" -> "Foo".
        names.add(trimmed.split('/').pop() ?? trimmed);
      }
    }
  } catch {
    /* if we can't list processes, enforce nothing this cycle */
  }
  return [...names];
}

/** Force-close every process with the given image name. */
async function defaultKillProcess(name: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileP('taskkill', ['/F', '/IM', name], { windowsHide: true });
  } else {
    // Match on the process/command name (strip a trailing .exe if one slipped in).
    await execFileP('pkill', ['-f', name.replace(/\.exe$/i, '')]);
  }
}
