#!/usr/bin/env bash
# Public access: starts the app + a free Cloudflare quick tunnel (https://<random>.trycloudflare.com).
# HTTPS is required for candidates' camera/microphone. Stop with: ./share.sh stop
set -e
cd "$(dirname "$0")"
CF="${CLOUDFLARED:-$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")}"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"   # 0.0.0.0 = reachable from the local network too

restart_server() {
  pkill -f "uvicorn main:app.*--port $PORT" 2>/dev/null || true
  for i in $(seq 1 20); do ss -ltn | grep -q ":$PORT " || break; sleep 0.5; done
  [ -s ADMIN_PASS.txt ] && export ADMIN_PASSWORD="$(cat ADMIN_PASS.txt)"
  setsid nohup .venv/bin/uvicorn main:app --host "$HOST" --port "$PORT" --proxy-headers --forwarded-allow-ips='*' > server.log 2>&1 &
  echo $! > server.pid
  for i in $(seq 1 60); do curl -s "localhost:$PORT/api/vacancies" >/dev/null && return 0; sleep 1; done
  echo "Server failed to start, see server.log"; return 1
}

if [ "$1" = "restart" ]; then  # restart only the app (keeps the same public URL)
  restart_server && echo "Server restarted. Public URL: $(cat PUBLIC_URL.txt 2>/dev/null)"; exit $?
fi

if [ "$1" = "stop" ]; then
  for f in tunnel.pid server.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
  echo "Stopped."; exit 0
fi

if [ ! -x "$CF" ]; then
  echo "[*] Downloading cloudflared…"
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -o "$HOME/.local/bin/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$HOME/.local/bin/cloudflared"; CF="$HOME/.local/bin/cloudflared"
fi

# Public = never use the demo password. Generated once, kept in ADMIN_PASS.txt (gitignored).
[ -s ADMIN_PASS.txt ] || python3 -c "import secrets;print(secrets.token_urlsafe(12))" > ADMIN_PASS.txt
chmod 600 ADMIN_PASS.txt
export ADMIN_PASSWORD="$(cat ADMIN_PASS.txt)"

# (Re)start the app server with proxy headers so links/cookies use the public https URL
[ -x .venv/bin/uvicorn ] || { echo "Run ./run.sh once first to create the venv"; exit 1; }
restart_server

[ -f tunnel.pid ] && kill "$(cat tunnel.pid)" 2>/dev/null || true
setsid nohup "$CF" tunnel --no-autoupdate --url "http://localhost:$PORT" > tunnel.log 2>&1 &
echo $! > tunnel.pid
URL=""
for i in $(seq 1 40); do URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1); [ -n "$URL" ] && break; sleep 1; done
[ -n "$URL" ] || { echo "Tunnel failed, see tunnel.log"; exit 1; }
echo "$URL" > PUBLIC_URL.txt
echo
echo "  Public URL : $URL"
echo "  Admin login: admin / $(cat ADMIN_PASS.txt)"
echo "  Logs       : server.log, tunnel.log   ·   restart app: ./share.sh restart   ·   stop: ./share.sh stop"
