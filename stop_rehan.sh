#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Shutdown Script (Rehan's Machine)
# ==============================================================================
# Gracefully stops running PANDA backend server processes on Rehan's machine.
# Pass '--all' to also stop the local PostgreSQL database server.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/panda.pid"
PG_DATA="/home/clepenji/panda_postgres_data"
[ ! -d "$PG_DATA" ] && [ -d "/home/clepenji/pibas_postgres_data" ] && PG_DATA="/home/clepenji/pibas_postgres_data"

echo "Stopping PANDA services on Rehan's machine..."

# Stop backend server
./stop.sh

# Optional: stop PostgreSQL if '--all' passed
if [ "$1" == "--all" ] || [ "$1" == "-a" ]; then
    echo "Stopping local PostgreSQL server..."
    if command -v micromamba >/dev/null 2>&1; then
        micromamba run -n panda pg_ctl -D "$PG_DATA" stop -m fast || micromamba run -n pibas pg_ctl -D "$PG_DATA" stop -m fast || true
    fi
    echo "  ✓ PostgreSQL stopped."
fi

echo "Shutdown complete."
