/**
 * Typed client for the FocusLock background service HTTP API.
 *
 * The UI never makes blocking decisions or stores rules — it is a control
 * surface over the service, which remains the single source of truth. In dev,
 * Vite proxies `/api/*` to the service on 127.0.0.1:47615 (see vite.config.ts).
 */

import type {
  DailyStats,
  EngineState,
  ManagedTarget,
  Rule,
  Target,
} from '@focuslock/core';

const BASE = import.meta.env.DEV ? '/api' : 'http://127.0.0.1:47615';

export interface BrowserGuardStatus {
  exe: string;
  label: string;
  protected: boolean;
  secondsUntilClose?: number;
}

export interface ServiceStatus {
  running: boolean;
  version?: string;
  integrityOk: boolean;
  protectedTargets: number;
  activeModeId: string | null;
  activeSession: EngineState['activeSession'];
  breaksRemaining: number;
  guardian?: { enforce: boolean; browsers: BrowserGuardStatus[] };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => request<ServiceStatus>('GET', '/health'),
  state: () => request<EngineState>('GET', '/state'),
  stats: () => request<DailyStats>('GET', '/stats'),
  addTarget: (target: Omit<Target, 'id'>, rule: Rule) =>
    request<ManagedTarget>('POST', '/targets', { target, rule }),
  updateTargetRule: (id: string, rule: Rule) =>
    request<{ ok: boolean }>('PUT', `/targets/${encodeURIComponent(id)}`, { rule }),
  removeTarget: (id: string) =>
    request<{ ok: boolean }>('DELETE', `/targets/${encodeURIComponent(id)}`),
  addCategory: (categoryId: string, rule: Rule) =>
    request<ManagedTarget[]>('POST', '/categories', { categoryId, rule }),
  startBreak: (targetId: string) =>
    request<{ ok: boolean; reason?: string }>('POST', '/breaks/start', { targetId }),
  endBreak: () => request<{ ok: boolean }>('POST', '/breaks/end'),
  activateMode: (modeId: string | null) =>
    request<{ ok: boolean }>('POST', '/modes/activate', { modeId }),
  startSession: (name: string, durationMs: number, locked: boolean, targetIds: string[] = []) =>
    request<EngineState['activeSession']>('POST', '/sessions/start', {
      name,
      durationMs,
      locked,
      targetIds,
    }),
  endSession: () => request<{ ok: boolean; reason?: string }>('POST', '/sessions/end'),
  updateSettings: (patch: {
    resetTime?: string;
    timezoneOffsetMinutes?: number;
    enforceExtension?: boolean;
  }) => request('PUT', '/settings', patch),
};
