#!/usr/bin/env bash
# start.sh — Start SIGMA components that aren't already running.
#
# Components:
#   API server      → http://localhost:8050  (server/main.py via uv)
#   UI dev server   → http://localhost:5275  (client/ via vite)
#
# The image folder is chosen from within the app on first launch.
# It is saved to config.json and remembered on subsequent starts.
#
# Usage:  ./start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

API_PORT=8050
UI_PORT=5275

# ── helpers ───────────────────────────────────────────────────────────────────

port_in_use() {
  # Returns 0 (true) if the port is already listening.
  lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

log()  { printf "\033[1;34m[sigma]\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m[sigma]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[sigma]\033[0m %s\n" "$*"; }

# ── API server ─────────────────────────────────────────────────────────────────

if port_in_use "$API_PORT"; then
  warn "API server already running on port $API_PORT — skipping."
else
  log "Starting API server on port $API_PORT …"
  cd "$SCRIPT_DIR/server"
  .venv/bin/python -u main.py >"$SCRIPT_DIR/server.log" 2>&1 &
  API_PID=$!
  ok "API server launched (PID $API_PID) — logs → server.log"
  cd "$SCRIPT_DIR"
fi

# ── UI dev server ──────────────────────────────────────────────────────────────

if port_in_use "$UI_PORT"; then
  warn "UI dev server already running on port $UI_PORT — skipping."
else
  log "Starting UI dev server on port $UI_PORT …"
  cd "$SCRIPT_DIR/client"
  npm run dev >"$SCRIPT_DIR/ui.log" 2>&1 &
  UI_PID=$!
  ok "UI dev server launched (PID $UI_PID) — logs → ui.log"
  cd "$SCRIPT_DIR"
fi

# ── Wait for API to be ready ───────────────────────────────────────────────────

printf "\n\033[1;34m[sigma]\033[0m Waiting for API  on http://localhost:$API_PORT"
for i in $(seq 1 30); do
  if port_in_use "$API_PORT"; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 1
done

if ! port_in_use "$API_PORT"; then
  printf "\n"
  warn "API did not become ready within 30 s — check server.log for errors."
fi

# ── Wait for UI to be ready ────────────────────────────────────────────────────

UI_URL="http://localhost:$UI_PORT"

printf "\033[1;34m[sigma]\033[0m Waiting for UI   on $UI_URL"
for i in $(seq 1 30); do
  if port_in_use "$UI_PORT"; then
    printf " ✓\n"
    break
  fi
  printf "."
  sleep 1
done

if ! port_in_use "$UI_PORT"; then
  printf "\n"
  warn "UI did not become ready within 30 s — check ui.log for errors."
fi

# ── Prompt ────────────────────────────────────────────────────────────────────

echo ""
ok "SIGMA is ready."
echo ""
printf "  Open: \033[1;36m%s\033[0m\n" "$UI_URL"
echo ""
read -r -p "Press Enter to open in your default browser (or Ctrl-C to skip)…"
open "$UI_URL"

