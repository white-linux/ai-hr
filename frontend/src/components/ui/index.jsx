import { initials } from '../../utils/format';
import { VERTICAL_BY_ID } from '../../constants/verticals';

/* Tailwind needs literal class names, so tones are looked up from maps. */
const PILL_TONES = {
  neutral: 'bg-slate-800 text-slate-300 ring-slate-700',
  info: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  success: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  danger: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
};

const BAR_TONES = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
  info: 'bg-sky-400',
  neutral: 'bg-slate-500',
};

/** Higher is better (match score, correctness). */
export const scoreTone = (score) => (score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger');
/** Higher is worse (AI-generation probability). */
export const riskTone = (pct) => (pct >= 70 ? 'danger' : pct >= 40 ? 'warning' : 'success');

export function Pill({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILL_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function VerticalTag({ vertical }) {
  return <Pill>{VERTICAL_BY_ID[vertical]?.label ?? vertical}</Pill>;
}

export function ScoreBadge({ score, tone = scoreTone(score) }) {
  return (
    <Pill tone={tone} className="tabular-nums">
      {score}%
    </Pill>
  );
}

export function Meter({ label, value, tone = 'info' }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium tabular-nums text-slate-200">{value}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-800"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${BAR_TONES[tone]}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function Avatar({ name }) {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-300 ring-1 ring-slate-700">
      {initials(name)}
    </div>
  );
}

export function Spinner({ className = 'size-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IconButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function RefreshIcon({ spinning = false }) {
  return (
    <svg
      className={`size-4 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
