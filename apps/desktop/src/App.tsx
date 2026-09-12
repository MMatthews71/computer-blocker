import { useCallback, useEffect, useState } from 'react';
import type { EngineState, ManagedTarget } from '@focuslock/core';
import { api } from './api.ts';
import { BreakTokens } from './components/BreakTokens.tsx';
import { TargetRow } from './components/TargetRow.tsx';
import { AddTarget } from './components/AddTarget.tsx';

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

  const paused = state?.pausedUntil != null && Date.now() < state.pausedUntil;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {error && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      <div className="mb-8 flex items-center justify-between gap-4">
        <span
          className={`inline-flex items-center gap-2 text-sm font-medium ${
            paused ? 'text-amber-300' : 'text-emerald-300'
          }`}
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              paused ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          {paused ? 'Paused — nothing is blocked' : 'Protection active'}
        </span>
        <button
          className={paused ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={async () => {
            if (paused) await api.resume();
            else await api.pause();
            refresh();
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

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
    </div>
  );
}
