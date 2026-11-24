<p align="center"><img src="static/logo-full.svg" alt="Ishveren — AI Recruiter" height="64"></p>

# Ishveren (Metaphor)
AI-based smart HR recruiter assistant: CV screening, AI-content detection, candidate footprint checks, fit scoring, and AI voice/video interviews.

## Quick Start

1. Provide your Z.ai API key via environment variable (or create a local `API.txt`, which is gitignored):
   ```bash
   export ZAI_API_KEY="your-api-key-here"
   ```
2. Launch the app:
   ```bash
   ./run.sh
   ```
   The web interface starts on `http://localhost:8000`.

## Structure

- [`frontend/`](frontend/) — HR dashboard (React + Vite + Tailwind). Runs on mock data by default; see [frontend/README.md](frontend/README.md) for how to connect the backend and AI services.
