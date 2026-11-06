import { Spinner } from './ui';

const fieldLabel = 'mb-1.5 block text-xs font-medium text-slate-400';
const inputBase =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60';

/**
 * HR action area. Fully controlled: it owns no state and calls `onRun` with
 * the current settings — the parent decides what running means.
 */
export function ControlPanel({
  verticals,
  vertical,
  onVerticalChange,
  prompt,
  onPromptChange,
  isPromptEdited,
  onResetPrompt,
  threshold,
  onThresholdChange,
  onRun,
  isRunning,
  statusLabel,
}) {
  const canRun = !isRunning && prompt.trim().length > 0;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (canRun) onRun({ vertical, prompt: prompt.trim(), threshold });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-slate-800 bg-slate-900/80 px-4 py-4 backdrop-blur sm:px-6"
    >
      <div className="grid gap-4 lg:grid-cols-[12rem_1fr_14rem_auto] lg:items-end">
        <div>
          <label htmlFor="vertical" className={fieldLabel}>
            Vertical
          </label>
          <select
            id="vertical"
            value={vertical}
            onChange={(e) => onVerticalChange(e.target.value)}
            disabled={isRunning}
            className={`${inputBase} h-10`}
          >
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="prompt" className="text-xs font-medium text-slate-400">
              Evaluation criteria (prompt)
            </label>
            {isPromptEdited && (
              <button
                type="button"
                onClick={onResetPrompt}
                disabled={isRunning}
                className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
              >
                Reset to default
              </button>
            )}
          </div>
          <textarea
            id="prompt"
            rows={2}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            disabled={isRunning}
            placeholder="Describe what the AI should look for in CVs for this vertical…"
            className={`${inputBase} min-h-10 resize-y py-2 leading-relaxed`}
          />
        </div>

        <div>
          <label htmlFor="threshold" className={fieldLabel}>
            Passing threshold
          </label>
          <div className="flex h-10 items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              disabled={isRunning}
              aria-label="Passing threshold slider"
              className="flex-1 accent-indigo-500"
            />
            <div className="relative w-[4.75rem] shrink-0">
              <input
                id="threshold"
                type="number"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => onThresholdChange(Number(e.target.value))}
                disabled={isRunning}
                className={`${inputBase} h-10 appearance-none pr-7 tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-slate-500">
                %
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={!canRun}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
        >
          {isRunning && <Spinner />}
          {isRunning ? 'Processing…' : 'Run AI Scan & Process'}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500" aria-live="polite">
        {statusLabel}
      </p>
    </form>
  );
}
