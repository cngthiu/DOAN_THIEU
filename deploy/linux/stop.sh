#!/bin/bash
# Stop the background ExamGuard started by start.sh (the systemd service: sudo systemctl stop examguard).
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
if [ -f "$ROOT/logs/backend.pid" ]; then
    pid=$(cat "$ROOT/logs/backend.pid")
    cwd=$(readlink -f "/proc/$pid/cwd" 2> /dev/null || true)
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2> /dev/null || true)
    if [ "$cwd" = "$ROOT/backend" ] && [[ "$cmd" == *"uvicorn app.main:app"* ]]; then
        kill "$pid" 2> /dev/null || true
        for _ in $(seq 1 20); do
            kill -0 "$pid" 2> /dev/null || break
            sleep 0.25
        done
        kill -0 "$pid" 2> /dev/null && kill -KILL "$pid" 2> /dev/null || true
        echo "stopped"
    else
        echo "pid file does not belong to ExamGuard"
    fi
else
    echo "not running"
fi
rm -f "$ROOT/logs/backend.pid"
