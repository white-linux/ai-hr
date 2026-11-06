import { CVCard } from './CVCard';
import { Pill } from '../ui';
import { timeAgo } from '../../utils/format';

/** Column 3 — a task sent to a qualified candidate. */
export function TaskSentCard({ task, isReturned }) {
  return (
    <CVCard
      name={task.candidateName}
      subtitle={`Qualified with ${task.score}%`}
      badge={isReturned ? <Pill tone="success">Returned</Pill> : <Pill tone="warning">Awaiting</Pill>}
    >
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
        <p className="font-medium text-slate-200">{task.title}</p>
        <p className="mt-1 line-clamp-2 leading-relaxed text-slate-400">{task.snippet}</p>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>Sent {timeAgo(task.sentAt)}</span>
        <span>Due {timeAgo(task.dueAt)}</span>
      </div>
    </CVCard>
  );
}
