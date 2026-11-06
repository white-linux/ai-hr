# Metaphor — Frontend

HR dashboard for the AI-driven hiring pipeline. Built with React 19, Vite and Tailwind CSS v4.
Out of the box it runs on **mock data**, so it works before the backend exists.

```
All CVs ──scanCVs()──▶ Scanned CVs ──sendAutomatedTasks()──▶ Tasks Sent ──fetchReturnedTasks()──▶ Returned & Analyzed
                         (AI score)        (score ≥ threshold)                + analyzeTaskIntegrity()
```

## Run it

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Project layout

```
src/
├── services/          ← integration layer: the only files that talk to the backend
│   ├── apiClient.js       fetch wrapper (base URL, auth header, errors)
│   ├── cvService.js       fetchAllCVs(), scanCVs(vertical, prompt)
│   ├── taskService.js     sendAutomatedTasks(threshold, scanResults), fetchReturnedTasks(taskIds)
│   ├── analysisService.js analyzeTaskIntegrity(submission)
│   └── index.js           what the UI imports
├── mocks/             ← fake backend used when VITE_USE_MOCKS=true
│   ├── data.js            sample CVs, tasks, analysis texts
│   └── handlers.js        one mock per service function
├── hooks/
│   ├── usePipeline.js     board state + pipeline orchestration + polling
│   └── useScanSettings.js vertical / prompt (per vertical) / threshold
├── components/
│   ├── KanbanBoard.jsx    the 4 columns
│   ├── KanbanColumn.jsx   generic column (header, count, loading, empty state)
│   ├── ControlPanel.jsx   HR action area at the bottom
│   ├── cards/             CVCard (base) + one card per column
│   └── ui/                Pill, Meter, ScoreBadge, Avatar, Spinner…
├── constants/         verticals + default prompts, pipeline stages
├── config/            env-based runtime config
└── types.js           JSDoc data contracts — the API response shapes
```

Data flows one way: **components → hooks → services → (mocks | backend)**.
Components never import services or mocks directly.

## Connecting the backend

1. Copy `.env.example` to `.env.local`, then set:
   ```
   VITE_USE_MOCKS=false
   VITE_API_PROXY_TARGET=http://localhost:8000   # your backend
   ```
2. Implement these endpoints, or change the paths in `src/services/*`:

| Service function | Suggested endpoint | Request body | Returns (see `src/types.js`) |
|---|---|---|---|
| `fetchAllCVs()` | `GET /api/cvs` | — | `CV[]` |
| `scanCVs(vertical, prompt)` | `POST /api/cvs/scan` | `{ vertical, prompt }` | `ScanResult[]` |
| `sendAutomatedTasks(threshold, scanResults)` | `POST /api/tasks/send` | `{ threshold, scanResultIds }` | `SentTask[]` (only those sent) |
| `fetchReturnedTasks(taskIds)` | `POST /api/tasks/submissions` | `{ taskIds }` | `Submission[]` |
| `analyzeTaskIntegrity(submission)` | `POST /api/tasks/submissions/:id/analyze` | — | `IntegrityAnalysis` |

If your response shapes differ, map them **inside the service function** so no component changes.

3. Auth: return the HR user's session token from `getAuthToken()` in `src/services/apiClient.js`.

## For the AI team

- **CV scoring** happens behind `scanCVs`. The backend gets `vertical` and HR's free-text `prompt` (the evaluation criteria) and should return a 0–100 `score` and a short `summary` for each CV.
- **Integrity check** happens behind `analyzeTaskIntegrity`. Return `aiGenerationProbability` (from the AI detector), `correctnessScore`, a `verdict` (`pass` | `review` | `fail`) and a `summary`.

> ⚠️ **API keys never go in the frontend.** Every `VITE_*` variable is bundled into the JavaScript that ships to the browser, where anyone can read it. OpenAI, Anthropic and AI-detector keys belong in backend environment variables. The frontend only calls your backend.

## Common changes

- **Add a vertical:** add an entry to `src/constants/verticals.js` (and its task in `src/mocks/data.js` while you're on mocks).
- **Real-time updates instead of polling:** replace the `setInterval` effect in `usePipeline.js` with a WebSocket/SSE listener that calls the same submission-handling logic. Set `VITE_SUBMISSION_POLL_MS=0` to turn polling off.
- **Add a column:** add a card in `components/cards/`, a state slice in `usePipeline.js`, and a `<KanbanColumn>` in `KanbanBoard.jsx`.
