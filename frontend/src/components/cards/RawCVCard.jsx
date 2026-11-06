import { CVCard } from './CVCard';
import { VerticalTag } from '../ui';
import { timeAgo } from '../../utils/format';

/** Column 1 — a raw CV from the database. */
export function RawCVCard({ cv, highlighted }) {
  return (
    <CVCard
      name={cv.candidateName}
      subtitle={cv.role}
      badge={<VerticalTag vertical={cv.vertical} />}
      highlighted={highlighted}
    >
      <div className="flex flex-wrap gap-1">
        {cv.skills.slice(0, 4).map((skill) => (
          <span key={skill} className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
            {skill}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        {cv.yearsExperience} yrs exp · received {timeAgo(cv.receivedAt)}
      </p>
    </CVCard>
  );
}
