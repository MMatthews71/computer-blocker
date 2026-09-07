/**
 * ProtectionService — the enforcement brain.
 *
 * Holds the authoritative EngineState in memory, applies mutations, persists
 * them, records statistics, and answers access checks by deferring to
 * `@focuslock/core`. The HTTP layer is a thin shell over this class; all rule
 * logic lives in core, all state transitions live here.
 *
 * Fail-closed posture: if the persisted config fails its integrity check, the
 * service enters a locked-down safe mode where every governed request is
 * blocked until a trusted config is restored.
 */

import {
  createInitialState,
  evaluateSafely,
  startBreak as startBreakPure,
  endBreakEarly as endBreakEarlyPure,
  expandCategory,
  isCategoryId,
  summarize,
  resetDayKey,
  parseHhMm,
  type AccessRequest,
  type Decision,
  type EngineState,
  type FocusSession,
  type ManagedTarget,
  type Rule,
  type Target,
  type DailyStats,
} from '@focuslock/core';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';

/**
 * Build stamp for the running service. Bump this whenever the service or the
 * rule engine changes behaviour. The desktop app compares it against the
 * version it expects and transparently restarts an outdated service (the
 * service outlives the UI, so a stale one could otherwise keep running with old
 * logic — e.g. not understanding a newer target type).
 */
export const SERVICE_VERSION = '0.3.0-locked';

export interface ServiceStatus {
  running: true;
  version: string;
  integrityOk: boolean;
  protectedTargets: number;
  activeModeId: string | null;
  activeSession: FocusSession | null;
  breaksRemaining: number;
}

export class ProtectionService {
  private state: EngineState;
  private integrityOk = true;

  constructor(private store: Store, now = Date.now()) {
    const loaded = store.loadState();
    if (!loaded) {
      this.state = createInitialState(now);
      this.store.saveState(this.state);
    } else {
      this.state = loaded.state;
      this.integrityOk = !loaded.integrityFailed;
    }
  }

  // ---- Reads -------------------------------------------------------------

  getState(): EngineState {
    return this.state;
  }

  getStatus(): ServiceStatus {
    return {
      running: true,
      version: SERVICE_VERSION,
      integrityOk: this.integrityOk,
      protectedTargets: this.state.managedTargets.length,
      activeModeId: this.state.activeModeId,
      activeSession: this.state.activeSession,
      breaksRemaining: this.state.breaks.tokensRemaining,
    };
  }

  /**
   * The one question the whole product answers. Records a blocked attempt for
   * statistics whenever the answer is "no".
   */
  check(request: AccessRequest, now = Date.now()): Decision {
    // Fail closed on integrity failure. A tampered config cannot be trusted —
    // and crucially, an attacker may have *removed* rules, so enforcing only
    // the surviving rules would be a fail-open hole. Instead we refuse to trust
    // the config at all and block everything until the app pushes a freshly
    // signed config (which re-establishes trust; see `persist`).
    if (!this.integrityOk) {
      const decision = this.failClosedDecision(request, now);
      this.recordBlockedAttempt(request, decision, now);
      return decision;
    }
    const decision = evaluateSafely(this.state, request, now);
    if (!decision.allowed) this.recordBlockedAttempt(request, decision, now);
    return decision;
  }

  /**
   * Evaluate a running app by process/image name, WITHOUT recording a blocked
   * attempt. Used by the app guardian, which polls constantly and records its
   * own stat once per new block. Deliberately uses `evaluateSafely` rather than
   * {@link check}: it must NOT fail closed on integrity failure, because the app
   * guardian only ever acts on a non-null `targetId` (an explicitly-managed app
   * target) — never on unrelated system processes.
   */
  evaluateApp(processName: string, now = Date.now()): Decision {
    return evaluateSafely(this.state, { kind: 'app', value: processName }, now);
  }

  /** Record that the app guardian closed a blocked app (for statistics). */
  recordAppBlocked(processName: string, decision: Decision, now = Date.now()): void {
    this.recordBlockedAttempt({ kind: 'app', value: processName }, decision, now);
  }

  getStats(now = Date.now()): DailyStats {
    const dayStart = this.currentResetDayStart(now);
    return summarize(this.store.statEventsSince(dayStart));
  }

  // ---- Mutations ---------------------------------------------------------

  addTarget(target: Omit<Target, 'id'>, rule: Rule): ManagedTarget {
    const managed: ManagedTarget = { target: { ...target, id: randomUUID() }, rule };
    this.state = {
      ...this.state,
      managedTargets: [...this.state.managedTargets, managed],
    };
    this.persist();
    return managed;
  }

  /**
   * Change a target's rule.
   *
   * Commitment lock: a target may be made STRICTER or switched between blocking
   * rules (permanent-block / daily-break / scheduled), but it may NOT be changed
   * to `always-allowed`. Un-blocking by editing the rule would be a trivial way
   * to defeat the "added targets can't be removed" guarantee, so it is refused.
   */
  updateTargetRule(targetId: string, rule: Rule): { ok: boolean; reason?: string } {
    const idx = this.state.managedTargets.findIndex((m) => m.target.id === targetId);
    if (idx === -1) return { ok: false, reason: 'not-found' };
    const current = this.state.managedTargets[idx]!;
    // Allow a no-op on an already-allowed target (keeps idempotent PUTs working),
    // but never let a blocking rule be downgraded to always-allowed.
    if (rule.type === 'always-allowed' && current.rule.type !== 'always-allowed') {
      return { ok: false, reason: 'locked-no-unblock' };
    }
    const next = [...this.state.managedTargets];
    next[idx] = { ...current, rule };
    this.state = { ...this.state, managedTargets: next };
    this.persist();
    return { ok: true };
  }

  /**
   * Removal is DISABLED by design. FocusLock is a commitment device: once a
   * target is on the list you cannot dismantle your own guardrails in a moment
   * of weakness. The only reset is a deliberate, out-of-band wipe of the config
   * file — which requires stopping the service and clears everything at once.
   */
  removeTarget(targetId: string): { ok: boolean; reason?: string } {
    const exists = this.state.managedTargets.some((m) => m.target.id === targetId);
    return { ok: false, reason: exists ? 'locked' : 'not-found' };
  }

  /** Add every known member of a category with the given rule. */
  addCategory(categoryId: string, rule: Rule): ManagedTarget[] {
    if (!isCategoryId(categoryId)) throw new Error(`Unknown category: ${categoryId}`);
    const existing = new Set(
      this.state.managedTargets.map((m) => `${m.target.kind}:${m.target.value.toLowerCase()}`),
    );
    const members = expandCategory(categoryId, () => randomUUID())
      .filter((t) => !existing.has(`${t.kind}:${t.value.toLowerCase()}`))
      .map<ManagedTarget>((target) => ({ target, rule }));
    this.state = {
      ...this.state,
      managedTargets: [...this.state.managedTargets, ...members],
    };
    this.persist();
    return members;
  }

  startBreak(targetId: string, now = Date.now()): { ok: boolean; reason?: string } {
    const result = startBreakPure(this.state.breaks, targetId, now, this.state.settings);
    this.state = { ...this.state, breaks: result.state };
    this.persist();
    if (result.ok) {
      this.store.appendStatEvent({ type: 'break-used', targetId, at: now });
      return { ok: true };
    }
    return { ok: false, reason: result.reason };
  }

  endBreak(now = Date.now()): void {
    this.state = { ...this.state, breaks: endBreakEarlyPure(this.state.breaks, now, this.state.settings) };
    this.persist();
  }

  setActiveMode(modeId: string | null): boolean {
    if (modeId !== null && !this.state.modes.some((m) => m.id === modeId)) return false;
    this.state = { ...this.state, activeModeId: modeId };
    this.persist();
    return true;
  }

  startSession(session: Omit<FocusSession, 'id'>): FocusSession {
    const full: FocusSession = { ...session, id: randomUUID() };
    this.state = { ...this.state, activeSession: full };
    this.persist();
    return full;
  }

  /**
   * End the active focus session. A *locked* session cannot be ended before
   * its scheduled end — this is the commitment device working as intended.
   */
  endSession(now = Date.now()): { ok: boolean; reason?: string } {
    const session = this.state.activeSession;
    if (!session) return { ok: true };
    if (session.locked && now < session.endsAt) {
      return { ok: false, reason: 'session-locked' };
    }
    this.state = { ...this.state, activeSession: null };
    this.persist();
    return { ok: true };
  }

  updateSettings(patch: {
    resetTime?: string;
    timezoneOffsetMinutes?: number;
    enforceExtension?: boolean;
  }): void {
    this.state = {
      ...this.state,
      settings: {
        resetTime: patch.resetTime ?? this.state.settings.resetTime,
        timezoneOffsetMinutes:
          patch.timezoneOffsetMinutes ?? this.state.settings.timezoneOffsetMinutes,
        enforceExtension:
          patch.enforceExtension ?? this.state.settings.enforceExtension ?? true,
      },
    };
    this.persist();
  }

  // ---- Internals ---------------------------------------------------------

  private persist(): void {
    this.store.saveState(this.state);
    // Once we successfully write a config through the app, it is trusted again.
    this.integrityOk = true;
  }

  private recordBlockedAttempt(request: AccessRequest, decision: Decision, now: number): void {
    const label =
      this.state.managedTargets.find((m) => m.target.id === decision.targetId)?.target.label ??
      request.value;
    this.store.appendStatEvent({ type: 'blocked-attempt', targetId: decision.targetId, label, at: now });
  }

  /** A fully-blocked decision used while protection integrity is compromised. */
  private failClosedDecision(_request: AccessRequest, _now: number): Decision {
    return {
      targetId: null,
      allowed: false,
      reason: 'blocked-fail-closed',
      breakAvailable: false,
      breaksRemaining: 0,
      msUntilReset: 0,
      effectiveRule: { type: 'permanent-block' },
    };
  }

  /** Epoch-ms at which the current reset-day began (for stats windowing). */
  private currentResetDayStart(now: number): number {
    const { timezoneOffsetMinutes, resetTime } = this.state.settings;
    const key = resetDayKey(now, timezoneOffsetMinutes, resetTime);
    const dayIndex = Number(key.slice(1)); // "d19722" -> 19722 (local days since epoch)
    const resetMinutes = parseHhMm(resetTime);
    // Convert the local reset boundary back to an absolute UTC timestamp.
    return dayIndex * 86_400_000 + resetMinutes * 60_000 - timezoneOffsetMinutes * 60_000;
  }
}
