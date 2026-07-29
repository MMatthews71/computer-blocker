import { useState } from 'react';
import type { Rule, RuleType, Target } from '@focuslock/core';

export function AddTarget({
  onAdd,
}: {
  onAdd: (target: Omit<Target, 'id'>, rule: Rule) => void;
}) {
  const [kind, setKind] = useState<'domain' | 'keyword' | 'app'>('domain');
  const [value, setValue] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('daily-break');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd({ kind, value: trimmed, label: prettyLabel(kind, trimmed) }, ruleForType(ruleType));
    setValue('');
  };

  const placeholder =
    kind === 'domain' ? 'youtube.com' : kind === 'keyword' ? '123movies' : 'Discord';

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
        <select
          className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-2 text-sm"
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as RuleType)}
          aria-label="Rule"
        >
          <option value="permanent-block">Permanent block</option>
          <option value="daily-break">Daily breaks</option>
          <option value="scheduled">Scheduled</option>
          <option value="always-allowed">Always allowed</option>
        </select>
        <button className="btn btn-primary" onClick={submit}>
          Add
        </button>
      </div>

      {kind === 'keyword' && (
        <p className="mt-2 text-xs text-slate-500">
          Blocks any website whose address contains “{value.trim() || 'keyword'}”. Great for
          sites with many mirror domains — e.g. “123movies” blocks 123movies.com,
          123movies-free.net, ww1.123-movies.to, and so on.
        </p>
      )}
    </div>
  );
}

function prettyLabel(kind: 'domain' | 'keyword' | 'app', value: string): string {
  if (kind === 'keyword') return `“${value}” (keyword)`;
  const base = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? value;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function ruleForType(t: RuleType): Rule {
  if (t === 'scheduled') return { type: 'scheduled', windows: [{ start: '19:00', end: '21:00' }] };
  return { type: t } as Rule;
}
