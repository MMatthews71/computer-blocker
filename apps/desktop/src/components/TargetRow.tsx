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
  onStartBreak,
}: {
  managed: ManagedTarget;
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

      {rule.type === 'daily-break' && (
        <button
          className="btn btn-primary shrink-0"
          onClick={onStartBreak}
          title="Spend a break to unlock"
        >
          Break
        </button>
      )}
    </div>
  );
}
