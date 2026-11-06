import { Avatar } from '../ui';

/**
 * Base card shared by every column. Column-specific cards compose it and
 * pass their own `badge` and body content.
 */
export function CVCard({ name, subtitle, badge, highlighted = false, muted = false, children }) {
  return (
    <article
      className={[
        'rounded-xl border bg-slate-900 p-3 transition hover:border-slate-600',
        highlighted ? 'border-indigo-500/40' : 'border-slate-800',
        muted ? 'opacity-55' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={name} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-slate-100">{name}</h3>
            {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </div>
      {children && <div className="mt-3 space-y-2.5 text-xs text-slate-300">{children}</div>}
    </article>
  );
}
