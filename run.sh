#!/usr/bin/env bash
# One-command launcher: venv + deps + seed + server on http://localhost:8000
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "[*] Creating virtualenv…"
  python3 -m venv .venv
fi

if ! .venv/bin/python -c "import fastapi, uvicorn, sqlmodel, httpx, pypdf, docx, PIL, multipart" 2>/dev/null; then
  echo "[*] Installing dependencies…"
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi

echo "[*] Seeding database (idempotent)…"
.venv/bin/python -c "from models import init_db; init_db(seed=True); print('DB ready')"

echo "[*] Starting server on http://localhost:8000 (admin / admin123)"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
