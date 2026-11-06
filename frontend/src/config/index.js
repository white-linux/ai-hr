const env = import.meta.env;

/** Central runtime config. Read from Vite env vars (see .env.example). */
export const config = {
  useMocks: (env.VITE_USE_MOCKS ?? 'true') !== 'false',
  apiBaseUrl: env.VITE_API_BASE_URL || '/api',
  submissionPollMs: Number(env.VITE_SUBMISSION_POLL_MS ?? 5000),
  mockLatencyMs: Number(env.VITE_MOCK_LATENCY_MS ?? 600),
};
