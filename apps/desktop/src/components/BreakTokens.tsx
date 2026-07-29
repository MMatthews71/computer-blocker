import { useEffect, useState } from 'react';
import type { ActiveBreak } from '@focuslock/core';

/** Visual break-token pool: filled squares = available, hollow = spent. */
export function BreakTokens({
  remaining,
  total,
  active,
  onEnd,
}: {
  remaining: number;
  total: number;
  active: ActiveBreak | null;
  onEnd: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-6 w-6 rounded-md border ${
                i < remaining ? 'border-accent bg-accent/70' : 'border-ink-600 bg-transparent'
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-slate-400">
          {remaining} of {total} available
        </span>
      </div>

      {active && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-accent">Active break</div>
            <Countdown endsAt={active.endsAt} />
          </div>
          <button className="btn btn-ghost" onClick={onEnd}>
            End early
          </button>
        </div>
      )}
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, endsAt - now);
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="text-2xl font-semibold tabular-nums">
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </div>
  );
}
