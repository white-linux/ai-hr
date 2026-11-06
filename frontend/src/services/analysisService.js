import { config } from '../config';
import { api } from './apiClient';
import * as mock from '../mocks/handlers';

/**
 * Column 4 — integrity + correctness analysis of one returned task.
 *
 * INTEGRATION POINT (AI team): run the submission through the AI-generated
 * content detector and an LLM grader, then return both results together.
 * Suggested endpoint: POST /tasks/submissions/:id/analyze
 *
 * @param {import('../types').Submission} submission
 * @returns {Promise<import('../types').IntegrityAnalysis>}
 */
export async function analyzeTaskIntegrity(submission) {
  if (config.useMocks) return mock.analyzeTaskIntegrity(submission);
  return api.post(`/tasks/submissions/${encodeURIComponent(submission.id)}/analyze`);
}
