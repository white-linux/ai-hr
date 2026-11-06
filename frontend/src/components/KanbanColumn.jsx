import { Children } from 'react';

const ACCENTS = {
  slate: 'bg-slate-400',
  sky: 'bg-sky-400',
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
};

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3" aria-hidden="true">
      <div className="flex items-center gap-2.5">
        <div className="size-8 animate-pulse rounded-full bg-slate-800" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-800" />
          <div className="h-2 w-1/3 animate-pulse rounded bg-slate-800" />
        </div>
      </div>
      <div className="mt-3 h-2 w-full animate-pulse rounded bg-slate-800" />
    </div>
  );
}

/**
 * Generic board column. Knows nothing about CVs — pass any cards as children.
 */
export function KanbanColumn({
  title,
  description,
  count,
  accent = 'slate',
  isLoading = false,
  emptyMessage = 'Nothing here yet.',
  headerAction,
  children,
}) {
  const isEmpty = Children.count(children) === 0;

  return (
    <section
      aria-label={title}
      className="flex max-h-[32rem] min-h-64 flex-col rounded-2xl border border-slate-800 bg-slate-900/50 xl:max-h-none xl:min-h-0"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${ACCENTS[accent]}`} aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold text-slate-100">{title}</h2>
            <span className="rounded-md bg-slate-800 px-1.5 text-xs tabular-nums text-slate-400">
              {count}
            </span>
          </div>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {headerAction}
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {isLoading && isEmpty && [0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        {!isLoading && isEmpty && (
          <div className="grid h-full min-h-32 place-items-center rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
            {emptyMessage}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
