import { Header } from './components/Header';
import { ErrorBanner } from './components/ErrorBanner';
import { KanbanBoard } from './components/KanbanBoard';
import { ControlPanel } from './components/ControlPanel';
import { usePipeline } from './hooks/usePipeline';
import { useScanSettings } from './hooks/useScanSettings';
import { VERTICALS, VERTICAL_BY_ID } from './constants/verticals';
import { STAGE, STAGE_LABEL } from './constants/pipeline';
import { config } from './config';
import { timeAgo } from './utils/format';

function statusText(stage, run, verticalLabel) {
  if (stage !== STAGE.IDLE && stage !== STAGE.DONE) return STAGE_LABEL[stage];
  if (run?.finishedAt) {
    return `${verticalLabel}: last run ${timeAgo(run.finishedAt)} at a ${run.threshold}% threshold.${config.submissionPollMs ? " Returned tasks are checked automatically." : ""}`;
  }
  return `${verticalLabel} hasn't been scanned yet.`;
}

export default function App() {
  const pipeline = usePipeline();
  const settings = useScanSettings();
  const verticalLabel = VERTICAL_BY_ID[settings.vertical].label;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 xl:h-screen">
      <Header useMocks={config.useMocks} />
      <ErrorBanner message={pipeline.error} onDismiss={pipeline.dismissError} />

      <main className="flex-1 p-4 sm:px-6 xl:min-h-0">
        <KanbanBoard
          allCVs={pipeline.allCVs}
          isLoadingCVs={pipeline.isLoadingCVs}
          scanned={pipeline.scanned}
          tasksSent={pipeline.tasksSent}
          returned={pipeline.returned}
          runs={pipeline.runs}
          stage={pipeline.stage}
          activeVertical={settings.vertical}
          isSyncing={pipeline.isSyncing}
          onReloadCVs={pipeline.reloadCVs}
          onCheckSubmissions={pipeline.checkSubmissions}
        />
      </main>

      <ControlPanel
        verticals={VERTICALS}
        vertical={settings.vertical}
        onVerticalChange={settings.setVertical}
        prompt={settings.prompt}
        onPromptChange={settings.setPrompt}
        isPromptEdited={settings.isPromptEdited}
        onResetPrompt={settings.resetPrompt}
        threshold={settings.threshold}
        onThresholdChange={settings.setThreshold}
        onRun={pipeline.run}
        isRunning={pipeline.isRunning}
        statusLabel={statusText(pipeline.stage, pipeline.runs[settings.vertical], verticalLabel)}
      />
    </div>
  );
}
