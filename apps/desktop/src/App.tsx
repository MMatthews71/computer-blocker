import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailyStats, EngineState, ManagedTarget, RuleType } from '@focuslock/core';
import { api, type ServiceStatus } from './api.ts';
import { StatCard } from './components/StatCard.tsx';
import { BreakTokens } from './components/BreakTokens.tsx';
import { TargetRow } from './components/TargetRow.tsx';
import { AddTarget } from './components/AddTarget.tsx';

const RULE_LABEL: Record<RuleType, string> = {
  'permanent-block': 'Permanent block',
  'daily-break': 'Daily breaks',
  scheduled: 'Scheduled',
  'always-allowed': 'Always allowed',
};

export function App() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [health, engineState, dailyStats] = await Promise.all([
        api.health(),
        api.state(),
        api.stats(),
      ]);
      setStatus(health);
      setState(engineState);
      setStats(dailyStats);
      setError(null);
    } catch {
      setError('The FocusLock service is not running. Start it to manage protection.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const counts = useMemo(() => deriveCounts(state), [state]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Header status={status} />

      {error && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      <GuardianBanner status={status} />

      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Blocked apps" value={counts.apps} />
        <StatCard label="Blocked websites" value={counts.sites} />
        <StatCard label="Blocked attempts" value={stats?.blockedAttempts ?? 0} />
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-medium text-slate-300">Today's breaks</h2>
          <BreakTokens
            remaining={state?.breaks.tokensRemaining ?? 0}
            total={state?.breaks.tokensPerDay ?? 2}
            active={state?.breaks.activeBreak ?? null}
            onEnd={async () => {
              await api.endBreak();
              refresh();
            }}
          />
        </div>
        <div className="card">
          <h2 className="mb-1 text-sm font-medium text-slate-300">Browser protection</h2>
          <p className="mb-4 text-xs text-slate-500">
            Close any supported browser that runs without the FocusLock extension.
          </p>
          <Toggle
            on={status?.guardian?.enforce ?? true}
            label={status?.guardian?.enforce ?? true ? 'Enforcing' : 'Off'}
            onChange={async (on) => {
              await api.updateSettings({ enforceExtension: on });
              refresh();
            }}
          />
        </div>
      </section>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-300">Targets</h2>
          <span className="text-xs text-slate-500">{state?.managedTargets.length ?? 0} total</span>
        </div>

        <AddTarget
          onAdd={async (target, rule) => {
            await api.addTarget(target, rule);
            refresh();
          }}
        />

        <div className="mt-5 divide-y divide-ink-600">
          {(state?.managedTargets ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No targets yet. Add a website, app, or category above.
            </p>
          )}
          {(state?.managedTargets ?? []).map((mt: ManagedTarget) => (
            <TargetRow
              key={mt.target.id}
              managed={mt}
              ruleLabel={RULE_LABEL[mt.rule.type]}
              onRemove={async () => {
                await api.removeTarget(mt.target.id);
                refresh();
              }}
              onChangeRule={async (rule) => {
                await api.updateTargetRule(mt.target.id, rule);
                refresh();
              }}
              onStartBreak={async () => {
                await api.startBreak(mt.target.id);
                refresh();
              }}
            />
          ))}
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-slate-600">
        FocusLock · everything runs locally · the service is the source of truth
        {window.focuslock?.isElectron && (
          <> · desktop app (Electron {window.focuslock.versions.electron})</>
        )}
      </footer>
    </div>
  );
}

function Header({ status }: { status: ServiceStatus | null }) {
  const ok = status?.running && status.integrityOk;
  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">FocusLock</h1>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            ok ? 'bg-emerald-400' : status?.running ? 'bg-amber-400' : 'bg-rose-500'
          }`}
        />
        <span className="text-slate-400">
          {!status?.running
            ? 'Service offline'
            : status.integrityOk
              ? 'Protection active'
              : 'Safe mode (integrity)'}
        </span>
      </div>
    </header>
  );
}

function GuardianBanner({ status }: { status: ServiceStatus | null }) {
  const unprotected = (status?.guardian?.browsers ?? []).filter((b) => !b.protected);
  if (!status?.guardian?.enforce || unprotected.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      {unprotected.map((b) => (
        <div key={b.exe} className="flex flex-wrap items-center gap-x-2">
          <strong>{b.label}</strong> is open without the FocusLock extension.
          {typeof b.secondsUntilClose === 'number' && b.secondsUntilClose > 0 ? (
            <span>
              It will close in{' '}
              <span className="font-semibold tabular-nums">
                {formatCountdown(b.secondsUntilClose)}
              </span>
              . Install the extension to keep it open.
            </span>
          ) : (
            <span>Install the FocusLock extension to keep it open.</span>
          )}
        </div>
      ))}
      <div className="mt-2 text-xs text-rose-200/80">
        In {unprotected[0]?.label ?? 'the browser'}: open the extensions page, enable Developer
        mode, choose “Load unpacked”, and select the <code>apps\extension</code> folder.
      </div>
    </div>
  );
}

function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex items-center gap-3"
      aria-pressed={on}
    >
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          on ? 'bg-accent-strong' : 'bg-ink-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
            on ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="text-sm text-slate-300">{label}</span>
    </button>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function deriveCounts(state: EngineState | null): { apps: number; sites: number } {
  let apps = 0;
  let sites = 0;
  for (const mt of state?.managedTargets ?? []) {
    if (mt.rule.type === 'always-allowed') continue;
    if (mt.target.kind === 'app' || mt.target.kind === 'executable') apps += 1;
    else sites += 1;
  }
  return { apps, sites };
}
