/**
 * In-browser fake backend. Each export mirrors a service function 1:1 and
 * returns data in the shapes from src/types.js. Used when VITE_USE_MOCKS=true.
 * Nothing in here should be imported by components — only by src/services.
 */
import { config } from '../config';
import { ANALYSIS_SUMMARIES, MOCK_CVS, SUBMISSION_EXCERPTS, TASK_TEMPLATES } from './data';

const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const latency = (factor = 1) => sleep(config.mockLatencyMs * factor * (0.6 + Math.random() * 0.8));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const nowIso = () => new Date().toISOString();

/** Fake "database" that lives for the browser session. */
const db = {
  cvs: MOCK_CVS.map((cv) => ({ ...cv })),
  /** taskId -> { task, returnsAt: number | null, excerpt } */
  tasks: new Map(),
};

export async function fetchAllCVs() {
  await latency();
  return db.cvs.map((cv) => ({ ...cv }));
}

export async function scanCVs(vertical, prompt) {
  await latency(2);
  const criteria = prompt.toLowerCase();

  return db.cvs
    .filter((cv) => cv.vertical === vertical)
    .map((cv) => {
      // Fake scoring: experience + skills that appear in HR's prompt + noise.
      const matchedSkills = cv.skills.filter((s) => criteria.includes(s.toLowerCase()));
      const score = clamp(
        Math.round(28 + Math.min(cv.yearsExperience, 8) * 4 + matchedSkills.length * 9 + Math.random() * 10),
        0,
        100,
      );
      const summary = matchedSkills.length
        ? `Matches ${matchedSkills.join(', ')}. ${cv.yearsExperience} yrs of relevant experience.`
        : `No direct matches with the criteria. ${cv.yearsExperience} yrs of experience as ${cv.role}.`;

      return {
        id: `scan-${cv.id}`,
        cvId: cv.id,
        candidateName: cv.candidateName,
        vertical: cv.vertical,
        role: cv.role,
        score,
        matchedSkills,
        summary,
        scannedAt: nowIso(),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function sendAutomatedTasks(threshold, scanResults) {
  await latency();
  const sentAt = Date.now();

  return scanResults
    .filter((r) => r.score >= threshold)
    .map((r) => {
      const template = TASK_TEMPLATES[r.vertical];
      const task = {
        id: `task-${r.cvId}-${sentAt}`,
        cvId: r.cvId,
        candidateName: r.candidateName,
        vertical: r.vertical,
        score: r.score,
        title: template.title,
        snippet: template.snippet,
        sentAt: new Date(sentAt).toISOString(),
        dueAt: new Date(sentAt + 3 * DAY_MS).toISOString(),
      };
      // Simulate candidates: ~25% never reply, the rest reply within ~20s.
      const returnsAt = Math.random() < 0.25 ? null : sentAt + Math.random() * 20_000;
      db.tasks.set(task.id, { task, returnsAt, excerpt: pick(SUBMISSION_EXCERPTS[r.vertical]) });
      return task;
    });
}

export async function fetchReturnedTasks(taskIds) {
  await latency(0.5);
  const now = Date.now();

  return taskIds
    .map((id) => db.tasks.get(id))
    .filter((entry) => entry && entry.returnsAt !== null && entry.returnsAt <= now)
    .map(({ task, returnsAt, excerpt }) => ({
      id: `sub-${task.id}`,
      taskId: task.id,
      cvId: task.cvId,
      candidateName: task.candidateName,
      vertical: task.vertical,
      taskTitle: task.title,
      submittedAt: new Date(returnsAt).toISOString(),
      excerpt,
    }));
}

export async function analyzeTaskIntegrity(/* submission */) {
  await latency(1.5);
  const aiGenerationProbability = Math.round(Math.random() ** 1.6 * 100); // skewed low
  const correctnessScore = Math.round(40 + Math.random() * 60);

  let verdict = 'review';
  if (aiGenerationProbability >= 70 || correctnessScore < 55) verdict = 'fail';
  else if (aiGenerationProbability < 40 && correctnessScore >= 75) verdict = 'pass';

  return {
    aiGenerationProbability,
    correctnessScore,
    verdict,
    summary: pick(ANALYSIS_SUMMARIES[verdict]),
    analyzedAt: nowIso(),
  };
}
