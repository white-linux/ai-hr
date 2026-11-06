import { CVCard } from './CVCard';
import { Meter, Pill, ScoreBadge, VerticalTag, scoreTone } from '../ui';

/** Column 2 — AI match score for one CV. `threshold` is from that vertical's last run. */
export function ScannedCVCard({ result, threshold }) {
  const passed = threshold === undefined || result.score >= threshold;

  return (
    <CVCard
      name={result.candidateName}
      subtitle={result.role}
      badge={<ScoreBadge score={result.score} />}
      muted={!passed}
    >
      <Meter label="AI match score" value={result.score} tone={scoreTone(result.score)} />
      <p className="leading-relaxed text-slate-400">{result.summary}</p>
      <div className="flex items-center gap-1.5">
        <VerticalTag vertical={result.vertical} />
        {threshold !== undefined &&
          (passed ? (
            <Pill tone="success">Passed {threshold}%</Pill>
          ) : (
            <Pill>Below {threshold}%</Pill>
          ))}
      </div>
    </CVCard>
  );
}
