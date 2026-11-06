import { config } from '../config';
import { api } from './apiClient';
import * as mock from '../mocks/handlers';

/**
 * Column 1 — every CV stored in the database.
 * Suggested endpoint: GET /cvs
 * @returns {Promise<import('../types').CV[]>}
 */
export async function fetchAllCVs() {
  if (config.useMocks) return mock.fetchAllCVs();
  return api.get('/cvs');
}

/**
 * Column 2 — AI evaluation of the CVs in one vertical.
 *
 * INTEGRATION POINT (AI team): the backend should send each CV + the HR
 * prompt to the LLM and return a 0–100 match score with a short summary.
 * Suggested endpoint: POST /cvs/scan  { vertical, prompt }
 *
 * @param {import('../types').VerticalId} vertical
 * @param {string} prompt  HR's evaluation criteria for this vertical
 * @returns {Promise<import('../types').ScanResult[]>}
 */
export async function scanCVs(vertical, prompt) {
  if (config.useMocks) return mock.scanCVs(vertical, prompt);
  return api.post('/cvs/scan', { vertical, prompt });
}
