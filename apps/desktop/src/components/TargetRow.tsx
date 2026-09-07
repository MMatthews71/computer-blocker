import type { ManagedTarget, Rule, RuleType } from '@focuslock/core';

const RULE_TYPES: RuleType[] = ['permanent-block', 'daily-break', 'scheduled', 'always-allowed'];

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
  onChangeRule,
  onStartBreak,
}: {
  managed: ManagedTarget;
  ruleLabel: string;
  onChangeRule: (rule: Rule) => void;
  onStartBreak: () => void;
}) {
  const { target, rule } = managed;
  // Commitment lock: you can make a target stricter, but you can't unblock it by
  // switching to "Always allowed" (the service rejects it). Hide that option
  // unless the target is already allowed, so the control never offers a change
  // that would just fail.
  const ruleOptions = rule.type === 'always-allowed'
    ? RULE_TYPES
    : RULE_TYPES.filter((t) => t !== 'always-allowed');
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
        <select
          className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-sm text-slate-200"
          value={rule.type}
          onChange={(e) => onChangeRule(ruleForType(e.target.value as RuleType))}
          aria-label={`Rule for ${target.label} (currently ${ruleLabel})`}
        >
          {ruleOptions.map((t) => (
            <option key={t} value={t}>
              {labelFor(t)}
            </option>
          ))}
        </select>
        <span
          aria-label={`${target.label} is locked and cannot be removed`}
          title="Locked — added targets can't be removed. You can only make them stricter."
          className="cursor-default select-none px-1 text-slate-500"
        >
          🔒
        </span>
      </div>
    </div>
  );
}

function labelFor(t: RuleType): string {
  switch (t) {
    case 'permanent-block':
      return 'Permanent block';
    case 'daily-break':
      return 'Daily breaks';
    case 'scheduled':
      return 'Scheduled';
    case 'always-allowed':
      return 'Always allowed';
  }
}

/** Build a default rule for a chosen type. Scheduled gets a sample window. */
function ruleForType(t: RuleType): Rule {
  if (t === 'scheduled') return { type: 'scheduled', windows: [{ start: '19:00', end: '21:00' }] };
  return { type: t } as Rule;
}
