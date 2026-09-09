/**
 * Break Notifier — warns the user before an active break ends.
 *
 * Breaks are timed and enforced by the service, not the UI, and the UI window is
 * usually closed while the user is off on their break. So the warning has to come
 * from here: once per break, when the remaining time first drops to the warning
 * threshold (default 30s), we fire a native OS notification that appears wherever
 * the user currently is.
 *
 * Fires exactly once per break: the break's `startedAt` identifies it, so a break
 * that is ended and a *new* one started later each get their own warning, but a
 * single break never double-warns across polls.
 */

import type { Notifier } from './notify.js';

export interface ActiveBreakLike {
  startedAt: number;
  endsAt: number;
}

export interface BreakNotifierOptions {
  /** The currently active break, or null. Read fresh each tick. */
  getActiveBreak: () => ActiveBreakLike | null;
  /** Show a notification to the user. */
  notify: Notifier;
  /** How much time remaining triggers the warning. Default 30_000ms. */
  thresholdMs?: number;
  /** Poll interval. Default 1_000ms. */
  pollMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  log?: (message: string) => void;
}

export class BreakNotifier {
  private timer: NodeJS.Timeout | null = null;
  /** `startedAt` of the break we've already warned about, or null. */
  private warnedFor: number | null = null;

  private readonly thresholdMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(private opts: BreakNotifierOptions) {
    this.thresholdMs = opts.thresholdMs ?? 30_000;
    this.pollMs = opts.pollMs ?? 1_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log(`break notifier tick error: ${String(err)}`);
      }
    }, this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One monitoring pass. Exposed for tests. */
  tick(): void {
    const active = this.opts.getActiveBreak();
    // No break running (ended, expired, or never started) — reset so the next
    // break gets its own warning.
    if (!active) {
      this.warnedFor = null;
      return;
    }

    const remaining = active.endsAt - this.now();
    // Already over: treated like no active break.
    if (remaining <= 0) {
      this.warnedFor = null;
      return;
    }

    if (remaining <= this.thresholdMs && this.warnedFor !== active.startedAt) {
      this.warnedFor = active.startedAt;
      const seconds = Math.max(1, Math.round(this.thresholdMs / 1000));
      this.log(`break ending soon — notifying (${seconds}s left)`);
      this.opts.notify('FocusLock', `Your break ends in ${seconds} seconds.`);
    }
  }
}
