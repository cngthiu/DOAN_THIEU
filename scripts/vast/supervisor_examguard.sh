#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
if [ -s /opt/supervisor-scripts/utils/environment.sh ]; then
    . /opt/supervisor-scripts/utils/environment.sh
fi
set -a
. "$ROOT/.env"
set +a
cd "$ROOT/backend"
exec "$ROOT/backend/.venv/bin/python" -m uvicorn app.main:app \
    --host "${EXAMGUARD_HOST:-0.0.0.0}" --port "${EXAMGUARD_PORT:-${PORT:-8000}}" --proxy-headers
