#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_DIR='/home/readest'
readonly COMPOSE_DIR="$PROJECT_DIR/docker"
readonly LOG_DIR="$PROJECT_DIR/logs"
readonly LOCK_FILE="$PROJECT_DIR/.start.lock"

mkdir -p "$LOG_DIR"
log_file="$LOG_DIR/start-$(date +%Y%m%d-%H%M%S).log"

if ! flock -n "$LOCK_FILE" true; then
  echo "A Readest build is already running. Check: $LOG_DIR"
  exit 1
fi

nohup flock -n "$LOCK_FILE" bash -c '
  set -euo pipefail
  cd "$1"
  docker compose -f compose.local.yaml -f compose.build.yaml up --build -d
' _ "$COMPOSE_DIR" >"$log_file" 2>&1 < /dev/null &
pid=$!

echo "Readest build started in background (PID: $pid)."
echo "Build log: $log_file"
echo "Follow safely: tail -f $log_file"
