import { useMemo } from 'react';
import { KanbanColumn } from './KanbanColumn';
import { RawCVCard, ReturnedTaskCard, ScannedCVCard, TaskSentCard } from './cards';
import { IconButton, RefreshIcon } from './ui';
import { STAGE } from '../constants/pipeline';

/** The 4-column pipeline board. Purely presentational: all data comes in via props. */
export function KanbanBoard({
  allCVs,
  isLoadingCVs,
  scanned,
  tasksSent,
  returned,
  runs,
  stage,
  activeVertical,
  isSyncing,
  onReloadCVs,
  onCheckSubmissions,
}) {
  // Selected vertical first, so HR sees what the next scan will cover.
  const sortedCVs = useMemo(
    () =>
      [...allCVs].sort(
        (a, b) => Number(b.vertical === activeVertical) - Number(a.vertical === activeVertical),
      ),
    [allCVs, activeVertical],
  );
  const sortedScans = useMemo(() => [...scanned].sort((a, b) => b.score - a.score), [scanned]);
  const sortedTasks = useMemo(
    () => [...tasksSent].sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    [tasksSent],
  );
  const returnedTaskIds = useMemo(() => new Set(returned.map((r) => r.taskId)), [returned]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:h-full xl:grid-cols-4">
      <KanbanColumn
        title="All CVs in Database"
        description="Raw incoming applications"
        count={allCVs.length}
        accent="slate"
        isLoading={isLoadingCVs}
        emptyMessage="No CVs in the database."
        headerAction={
          <IconButton label="Reload CVs" onClick={onReloadCVs} disabled={isLoadingCVs}>
            <RefreshIcon spinning={isLoadingCVs} />
          </IconButton>
        }
      >
        {sortedCVs.map((cv) => (
          <RawCVCard key={cv.id} cv={cv} highlighted={cv.vertical === activeVertical} />
        ))}
      </KanbanColumn>

      <KanbanColumn
        title="Scanned CVs"
        description="AI match score out of 100%"
        count={scanned.length}
        accent="sky"
        isLoading={stage === STAGE.SCANNING}
        emptyMessage="Pick a vertical below and run a scan."
      >
        {sortedScans.map((result) => (
          <ScannedCVCard key={result.id} result={result} threshold={runs[result.vertical]?.threshold} />
        ))}
      </KanbanColumn>

      <KanbanColumn
        title="Tasks Sent"
        description="Candidates above the threshold"
        count={tasksSent.length}
        accent="amber"
        isLoading={stage === STAGE.SENDING}
        emptyMessage="Tasks go out automatically to candidates who pass the threshold."
      >
        {sortedTasks.map((task) => (
          <TaskSentCard key={task.id} task={task} isReturned={returnedTaskIds.has(task.id)} />
        ))}
      </KanbanColumn>

      <KanbanColumn
        title="Returned & Analyzed"
        description="AI detector + correctness check"
        count={returned.length}
        accent="emerald"
        isLoading={stage === STAGE.ANALYZING}
        emptyMessage="Completed tasks show up here as candidates return them."
        headerAction={
          <IconButton
            label="Check for new submissions"
            onClick={onCheckSubmissions}
            disabled={isSyncing || tasksSent.length === 0}
          >
            <RefreshIcon spinning={isSyncing} />
          </IconButton>
        }
      >
        {returned.map((submission) => (
          <ReturnedTaskCard key={submission.id} submission={submission} />
        ))}
      </KanbanColumn>
    </div>
  );
}
