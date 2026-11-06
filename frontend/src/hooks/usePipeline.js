import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeTaskIntegrity,
  fetchAllCVs,
  fetchReturnedTasks,
  scanCVs,
  sendAutomatedTasks,
} from '../services';
import { RUNNING_STAGES, STAGE } from '../constants/pipeline';
import { config } from '../config';

/** Replace every item of `vertical` in `list` with `next` (other verticals are kept). */
const replaceVertical = (list, vertical, next) => [
  ...list.filter((item) => item.vertical !== vertical),
  ...next,
];

const errorMessage = (err) => err?.message || 'Something went wrong. Please try again.';

/**
 * Owns all board state and runs the pipeline:
 *   scanCVs -> sendAutomatedTasks -> fetchReturnedTasks -> analyzeTaskIntegrity
 * Components stay presentational; to change the flow, change it here.
 * Re-running a vertical replaces only that vertical's results.
 */
export function usePipeline() {
  const [allCVs, setAllCVs] = useState([]);
  const [isLoadingCVs, setIsLoadingCVs] = useState(true);
  const [scanned, setScanned] = useState([]);
  const [tasksSent, setTasksSent] = useState([]);
  /** @type {[import('../types').AnalyzedSubmission[], Function]} */
  const [returned, setReturned] = useState([]);
  /** vertical -> { threshold, prompt, finishedAt: string | null } of its latest run */
  const [runs, setRuns] = useState({});
  const [stage, setStage] = useState(STAGE.IDLE);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Refs let the polling loop read the latest tasks without re-subscribing.
  const tasksRef = useRef(tasksSent);
  const submittedTaskIds = useRef(new Set());
  const syncInFlight = useRef(false);

  useEffect(() => {
    tasksRef.current = tasksSent;
  }, [tasksSent]);

  const loadCVs = useCallback(async () => {
    setIsLoadingCVs(true);
    try {
      setAllCVs(await fetchAllCVs());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoadingCVs(false);
    }
  }, []);

  useEffect(() => {
    loadCVs();
  }, [loadCVs]);

  /** Fetch new submissions for pending tasks and analyze each one. */
  const syncSubmissions = useCallback(async (taskList) => {
    const pending = taskList.filter((t) => !submittedTaskIds.current.has(t.id));
    if (!pending.length || syncInFlight.current) return;

    syncInFlight.current = true;
    setIsSyncing(true);
    try {
      const submissions = await fetchReturnedTasks(pending.map((t) => t.id));
      // Ignore results for tasks that were replaced by a re-run meanwhile.
      const liveTaskIds = new Set(tasksRef.current.map((t) => t.id));
      const fresh = submissions.filter(
        (s) => liveTaskIds.has(s.taskId) && !submittedTaskIds.current.has(s.taskId),
      );
      if (!fresh.length) return;

      fresh.forEach((s) => submittedTaskIds.current.add(s.taskId));
      setReturned((prev) => [...fresh.map((s) => ({ ...s, analysis: null })), ...prev]);

      await Promise.all(
        fresh.map(async (submission) => {
          const patch = await analyzeTaskIntegrity(submission)
            .then((analysis) => ({ analysis }))
            .catch((err) => ({ analysisError: errorMessage(err) }));
          setReturned((prev) => prev.map((r) => (r.id === submission.id ? { ...r, ...patch } : r)));
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      syncInFlight.current = false;
      setIsSyncing(false);
    }
  }, []);

  /** Full pipeline for one vertical, triggered by the control panel. */
  const run = useCallback(
    async ({ vertical, prompt, threshold }) => {
      setError(null);
      try {
        setStage(STAGE.SCANNING);
        const results = await scanCVs(vertical, prompt);
        setScanned((prev) => replaceVertical(prev, vertical, results));
        // Record this run's threshold now so scan cards show pass/fail immediately.
        setRuns((prev) => ({
          ...prev,
          [vertical]: { threshold, prompt, finishedAt: prev[vertical]?.finishedAt ?? null },
        }));

        setStage(STAGE.SENDING);
        const sent = await sendAutomatedTasks(threshold, results);
        const nextTasks = replaceVertical(tasksRef.current, vertical, sent);
        tasksRef.current = nextTasks;
        setTasksSent(nextTasks);
        setReturned((prev) => prev.filter((r) => r.vertical !== vertical));
        const liveIds = new Set(nextTasks.map((t) => t.id));
        submittedTaskIds.current = new Set(
          [...submittedTaskIds.current].filter((id) => liveIds.has(id)),
        );
        setRuns((prev) => ({
          ...prev,
          [vertical]: { ...prev[vertical], finishedAt: new Date().toISOString() },
        }));

        setStage(STAGE.ANALYZING);
        await syncSubmissions(nextTasks);
        setStage(STAGE.DONE);
      } catch (err) {
        setError(errorMessage(err));
        setStage(STAGE.IDLE);
      }
    },
    [syncSubmissions],
  );

  // Poll for returned tasks. Swap for WebSockets/SSE when the backend supports it.
  useEffect(() => {
    if (!config.submissionPollMs) return undefined;
    const id = setInterval(() => syncSubmissions(tasksRef.current), config.submissionPollMs);
    return () => clearInterval(id);
  }, [syncSubmissions]);

  return {
    allCVs,
    isLoadingCVs,
    scanned,
    tasksSent,
    returned,
    runs,
    stage,
    isRunning: RUNNING_STAGES.includes(stage),
    isSyncing,
    error,
    dismissError: () => setError(null),
    run,
    reloadCVs: loadCVs,
    checkSubmissions: () => syncSubmissions(tasksRef.current),
  };
}
