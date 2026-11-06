import { config } from '../config';
import { api } from './apiClient';
import * as mock from '../mocks/handlers';

/**
 * Column 3 — send a task to every candidate whose score >= threshold.
 *
 * INTEGRATION POINT (backend): pick the right task for the vertical, email it
 * to each qualified candidate and return the tasks that were sent. The
 * backend is the source of truth for who passed; the UI only displays it.
 * Suggested endpoint: POST /tasks/send  { threshold, scanResultIds }
 *
 * @param {number} threshold  0–100
 * @param {import('../types').ScanResult[]} scanResults
 * @returns {Promise<import('../types').SentTask[]>}
 */
export async function sendAutomatedTasks(threshold, scanResults) {
  if (config.useMocks) return mock.sendAutomatedTasks(threshold, scanResults);
  return api.post('/tasks/send', {
    threshold,
    scanResultIds: scanResults.map((r) => r.id),
  });
}

/**
 * Column 4 (input) — submissions candidates have returned so far for the given
 * tasks. The UI polls this; it can later be replaced by WebSockets/SSE.
 * Suggested endpoint: POST /tasks/submissions  { taskIds }
 *
 * @param {string[]} taskIds
 * @returns {Promise<import('../types').Submission[]>}
 */
export async function fetchReturnedTasks(taskIds) {
  if (config.useMocks) return mock.fetchReturnedTasks(taskIds);
  return api.post('/tasks/submissions', { taskIds });
}
