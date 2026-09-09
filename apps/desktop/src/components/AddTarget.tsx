import { useState } from 'react';
import type { Rule, Target } from '@focuslock/core';

export function AddTarget({
  onAdd,
}: {
  onAdd: (target: Omit<Target, 'id'>, rule: Rule) => void;
}) {
  const [kind, setKind] = useState<'domain' | 'keyword' | 'app'>('domain');
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Daily breaks is the only blocking strategy: blocked by default, with a
    // limited number of timed breaks per day.
    onAdd({ kind, value: trimmed, label: prettyLabel(kind, trimmed) }, { type: 'daily-break' });
    setValue('');
  };

  const placeholder =
    kind === 'domain' ? 'youtube.com' : kind === 'keyword' ? '123movies' : 'Terraria';

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-850/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'domain' | 'keyword' | 'app')}
          aria-label="Target kind"
        >
          <option value="domain">Website</option>
          <option value="keyword">Keyword</option>
          <option value="app">App</option>
        </select>
        <input
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-accent"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn btn-primary" onClick={submit}>
          Add
        </button>
      </div>
    </div>
  );
}

function prettyLabel(kind: 'domain' | 'keyword' | 'app', value: string): string {
  if (kind === 'keyword') return `“${value}” (keyword)`;
  const base = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? value;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
