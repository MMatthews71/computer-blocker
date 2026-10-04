import { useCallback, useEffect, useState } from 'react';
import type { EngineState, ManagedTarget } from '@focuslock/core';
import { api } from './api.ts';
import { BreakTokens } from './components/BreakTokens.tsx';
import { TargetRow } from './components/TargetRow.tsx';
import { AddTarget } from './components/AddTarget.tsx';

type RemovalStatus = Awaited<ReturnType<typeof api.removalStatus>>;

function formatRemaining(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function RemovalPanel() {
  const [status, setStatus] = useState<RemovalStatus | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.removalStatus());
    } catch {
      /* service down — leave as-is */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  if (!status) return null;

  return (
    <section className="mt-16 border-t border-ink-600 pt-6 text-sm text-slate-500">
      {!status.requested && !open && (
        <button className="text-slate-500 hover:text-slate-300" onClick={() => setOpen(true)}>
          Remove FocusLock
        </button>
      )}

      {!status.requested && open && (
        <div className="space-y-3">
          <p className="text-slate-400">
            Removal uses a <strong className="text-slate-200">7-day cooldown</strong>. Start it now and
            FocusLock keeps blocking for the full 7 days; only then can it be uninstalled. You can cancel
            anytime before that — cancelling keeps you protected.
          </p>
          <div className="flex gap-3">
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api.requestRemoval();
                load();
              }}
            >
              Start 7-day removal
            </button>
            <button className="text-slate-500 hover:text-slate-300" onClick={() => setOpen(false)}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {status.requested && !status.unlocked && (
        <div className="space-y-3">
          <p className="text-amber-300">
            Removal unlocks in <strong>{formatRemaining(status.remainingMs)}</strong>. Until then FocusLock
            stays fully active.
          </p>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api.cancelRemoval();
              load();
            }}
          >
            Cancel removal — keep me protected
          </button>
        </div>
      )}

      {status.requested && status.unlocked && (
        <div className="space-y-3">
          <p className="text-slate-300">
            The cooldown has elapsed. FocusLock can now be uninstalled by running its uninstaller.
          </p>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await api.cancelRemoval();
              load();
            }}
          >
            Changed my mind — keep FocusLock
          </button>
        </div>
      )}
    </section>
  );
}

export function App() {
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const engineState = await api.state();
      setState(engineState);
      setError(null);
    } catch {
      setError('The FocusLock service is not running.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {error && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      <section className="mb-8">
        <BreakTokens
          remaining={state?.breaks.tokensRemaining ?? 0}
          total={state?.breaks.tokensPerDay ?? 2}
          active={state?.breaks.activeBreak ?? null}
          onEnd={async () => {
            await api.endBreak();
            refresh();
          }}
        />
      </section>

      <section>
        <AddTarget
          onAdd={async (target, rule) => {
            await api.addTarget(target, rule);
            refresh();
          }}
        />

        <div className="mt-5 divide-y divide-ink-600">
          {(state?.managedTargets ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">Nothing blocked yet.</p>
          )}
          {(state?.managedTargets ?? []).map((mt: ManagedTarget) => (
            <TargetRow
              key={mt.target.id}
              managed={mt}
              onStartBreak={async () => {
                await api.startBreak(mt.target.id);
                refresh();
              }}
            />
          ))}
        </div>
      </section>

      <RemovalPanel />
    </div>
  );
}
