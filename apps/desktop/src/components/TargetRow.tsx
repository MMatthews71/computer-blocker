import type { ManagedTarget } from '@focuslock/core';

const KIND_ICON: Record<string, string> = {
  domain: '🌐',
  url: '🔗',
  keyword: '🔎',
  app: '🖥️',
  executable: '⚙️',
  category: '🗂️',
};

export function TargetRow({
  managed,
  ruleLabel,
  onStartBreak,
}: {
  managed: ManagedTarget;
  ruleLabel: string;
  onStartBreak: () => void;
}) {
  const { target, rule } = managed;
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="text-lg">
          {KIND_ICON[target.kind] ?? '•'}
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium">{target.label}</div>
          <div className="truncate text-xs text-slate-500">{target.value}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {rule.type === 'daily-break' && (
          <button className="btn btn-primary" onClick={onStartBreak} title="Spend a break to unlock">
            Break
          </button>
        )}
        {/* Daily breaks is the only strategy, so the rule is shown, not chosen. */}
        <span className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-sm text-slate-400">
          {ruleLabel}
        </span>
        <span
          aria-label={`${target.label} is locked and cannot be removed`}
          title="Locked — added targets can't be removed."
          className="cursor-default select-none px-1 text-slate-500"
        >
          🔒
        </span>
      </div>
    </div>
  );
}
