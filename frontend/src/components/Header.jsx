import { Pill } from './ui';

export function Header({ useMocks }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-indigo-500/15 text-sm font-bold text-indigo-300 ring-1 ring-indigo-500/30">
          M
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight text-slate-100">Metaphor</h1>
          <p className="text-xs text-slate-500">AI-driven HR pipeline</p>
        </div>
      </div>
      {useMocks && (
        <Pill tone="warning" className="px-2.5 py-1">
          Mock data · set VITE_USE_MOCKS=false to use the API
        </Pill>
      )}
    </header>
  );
}
