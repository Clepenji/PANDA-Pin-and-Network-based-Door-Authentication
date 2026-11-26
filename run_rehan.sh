#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Production Runner (Rehan's Machine)
# ==============================================================================
# Runs PANDA using Rehan's micromamba 'panda' environment and manages
# the local PostgreSQL database server.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/panda.pid"
LOG_FILE="$SCRIPT_DIR/logs/backend.log"
PG_DATA="/home/clepenji/panda_postgres_data"
[ ! -d "$PG_DATA" ] && [ -d "/home/clepenji/pibas_postgres_data" ] && PG_DATA="/home/clepenji/pibas_postgres_data"
PG_LOG="/home/clepenji/panda_postgres.log"

echo "=============================================================================="
echo "      PANDA — Launching on Rehan's Machine (Micromamba 'panda')"
echo "=============================================================================="

# 1. Detect Micromamba
if command -v micromamba >/dev/null 2>&1; then
    MAMBA_BIN="micromamba"
elif [ -f "$HOME/.local/bin/micromamba" ]; then
    MAMBA_BIN="$HOME/.local/bin/micromamba"
elif [ -f "$HOME/bin/micromamba" ]; then
    MAMBA_BIN="$HOME/bin/micromamba"
else
    echo "Error: micromamba not found. Fallback to standard ./run.sh."
    exit 1
fi

# 2. Check and Start PostgreSQL if needed
echo "[1/3] Checking PostgreSQL service..."
ENV_NAME="panda"
if [ ! -d "$HOME/micromamba/envs/panda" ] && [ -d "$HOME/micromamba/envs/pibas" ]; then
    ENV_NAME="pibas"
fi
if $MAMBA_BIN run -n "$ENV_NAME" pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    echo "  ✓ PostgreSQL is running and accepting connections."
else
    echo "  PostgreSQL is not running. Attempting to start local instance at $PG_DATA..."
    if [ -d "$PG_DATA" ]; then
        $MAMBA_BIN run -n "$ENV_NAME" pg_ctl -D "$PG_DATA" -l "$PG_LOG" start
        sleep 2
        if $MAMBA_BIN run -n "$ENV_NAME" pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
            echo "  ✓ PostgreSQL started successfully."
        else
            echo "  ! Error starting PostgreSQL. Check $PG_LOG"
        fi
    else
        echo "  ! PostgreSQL data dir $PG_DATA not found. Please start PostgreSQL manually."
    fi
fi

# 3. Check existing PID
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "  ! PANDA is already running with PID $OLD_PID."
        echo "    Web Portal: http://localhost:8000"
        echo "    To restart, run: ./stop_rehan.sh && ./run_rehan.sh"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

mkdir -p logs

# 4. Launch FastAPI Server via Micromamba
HOST="0.0.0.0"
PORT="8000"
WORKERS=1

UVICORN_BIN="$HOME/micromamba/envs/${ENV_NAME}/bin/uvicorn"
if [ ! -x "$UVICORN_BIN" ]; then
    UVICORN_BIN=$($MAMBA_BIN run -n "$ENV_NAME" which uvicorn)
fi

if [ "$1" == "--foreground" ] || [ "$1" == "-f" ]; then
    echo "Starting in foreground mode (Press Ctrl+C to terminate)..."
    exec "$UVICORN_BIN" backend.app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS"
else
    echo "[2/3] Starting PANDA production server in background..."
    nohup "$UVICORN_BIN" backend.app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS" </dev/null >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    disown "$NEW_PID" 2>/dev/null || true
    echo "$NEW_PID" > "$PID_FILE"

    sleep 2
    if ps -p "$NEW_PID" > /dev/null 2>&1; then
        echo "  ✓ PANDA started with PID: $NEW_PID"
        echo ""
        echo "=============================================================================="
        echo "   Access Endpoints:"
        echo "   • Web App & Admin Portal:   http://localhost:$PORT"
        echo "   • Interactive API Docs:     http://localhost:$PORT/api/docs"
        echo "   • Health Check:             http://localhost:$PORT/health"
        echo "   • Door WebSocket Gateway:   ws://localhost:$PORT/api/v1/ws/<space_slug>"
        echo "=============================================================================="
        echo "   • Live Logs:                tail -f logs/backend.log"
        echo "   • Stop Server:              ./stop_rehan.sh"
        echo "=============================================================================="
    else
        echo "  ✗ Error: PANDA server failed to stay running. Recent logs:"
        tail -n 25 "$LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
fi
