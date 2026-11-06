export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 sm:mx-6"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-xs font-medium text-rose-300 hover:text-rose-100"
      >
        Dismiss
      </button>
    </div>
  );
}
