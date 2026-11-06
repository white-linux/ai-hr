import { CVCard } from './CVCard';
import { Meter, Pill, Spinner, riskTone, scoreTone } from '../ui';
import { timeAgo } from '../../utils/format';

const VERDICT = {
  pass: { tone: 'success', label: 'Pass' },
  review: { tone: 'warning', label: 'Review' },
  fail: { tone: 'danger', label: 'Fail' },
};

/** Column 4 — a returned task with AI-detector and correctness results. */
export function ReturnedTaskCard({ submission }) {
  const { analysis, analysisError } = submission;
  const verdict = analysis && VERDICT[analysis.verdict];

  let badge = (
    <Pill tone="info">
      <Spinner className="size-3" /> Analyzing
    </Pill>
  );
  if (verdict) badge = <Pill tone={verdict.tone}>{verdict.label}</Pill>;
  else if (analysisError) badge = <Pill tone="danger">Error</Pill>;

  return (
    <CVCard name={submission.candidateName} subtitle={submission.taskTitle} badge={badge}>
      <p className="line-clamp-2 italic leading-relaxed text-slate-400">“{submission.excerpt}”</p>

      {analysis && (
        <>
          <Meter
            label="AI generation probability"
            value={analysis.aiGenerationProbability}
            tone={riskTone(analysis.aiGenerationProbability)}
          />
          <Meter
            label="Task correctness"
            value={analysis.correctnessScore}
            tone={scoreTone(analysis.correctnessScore)}
          />
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Correctness analysis
            </p>
            <p className="leading-relaxed text-slate-300">{analysis.summary}</p>
          </div>
        </>
      )}

      {!analysis && !analysisError && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-1.5 animate-pulse rounded-full bg-slate-800" />
          <div className="h-1.5 w-2/3 animate-pulse rounded-full bg-slate-800" />
        </div>
      )}

      {analysisError && <p className="text-rose-300">{analysisError}</p>}

      <p className="text-[11px] text-slate-500">Submitted {timeAgo(submission.submittedAt)}</p>
    </CVCard>
  );
}
