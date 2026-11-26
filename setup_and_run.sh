#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Setup & Run Script
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_DATA="/home/clepenji/panda_postgres_data"
[ ! -d "$PG_DATA" ] && [ -d "/home/clepenji/pibas_postgres_data" ] && PG_DATA="/home/clepenji/pibas_postgres_data"
ENV_NAME="panda"
[ ! -d "/home/clepenji/micromamba/envs/panda" ] && [ -d "/home/clepenji/micromamba/envs/pibas" ] && ENV_NAME="pibas"
MAMBA_BIN="/home/clepenji/micromamba/envs/${ENV_NAME}/bin"
LOG_DIR="$DIR/logs"

mkdir -p "$LOG_DIR"

echo "=================================================="
echo "    Setting up and Starting PANDA System"
echo "=================================================="

# 1. Start PostgreSQL if not already running
if ! $MAMBA_BIN/pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
    echo "[1/4] Starting PostgreSQL database daemon..."
    $MAMBA_BIN/pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" start
    sleep 1
    if $MAMBA_BIN/pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
        echo "✓ PostgreSQL is online and accepting connections."
    else
        echo "✗ Error starting PostgreSQL. Check $PG_DATA/logfile"
        exit 1
    fi
else
    echo "✓ [1/4] PostgreSQL is already running."
fi

# 2. Run Database Migrations
echo "[2/4] Verifying database schema migrations..."
cd "$DIR"
micromamba run -n "$ENV_NAME" alembic upgrade head
echo "✓ Database schema up to date."

# 3. Start Backend Server
echo "[3/4] Starting FastAPI backend on port 8000..."
# Stop existing uvicorn if running
pkill -f "uvicorn backend.app.main:app" 2>/dev/null || true
sleep 1
nohup micromamba run -n "$ENV_NAME" uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "✓ Backend launched in background (PID: $BACKEND_PID, Log: $LOG_DIR/backend.log)."

# 4. Start Frontend Server
echo "[4/4] Starting React frontend dev server on port 5173..."
pkill -f "vite --host 0.0.0.0" 2>/dev/null || true
sleep 1
cd "$DIR/frontend"
nohup npm run dev -- --host 0.0.0.0 --port 5173 > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "✓ Frontend launched in background (PID: $FRONTEND_PID, Log: $LOG_DIR/frontend.log)."

# Verify health
echo ""
echo "Waiting for services to become ready..."
for i in {1..15}; do
    if curl -s http://localhost:8000/api/docs >/dev/null 2>&1 && curl -s http://localhost:5173 >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo "=================================================="
echo "    PANDA Services Successfully Running!"
echo "=================================================="
echo "  Backend API:   http://localhost:8000"
echo "  API Docs:      http://localhost:8000/api/docs"
echo "  Frontend Web:  http://localhost:5173"
echo "  LAN Access:    http://$LAN_IP:5173"
echo "--------------------------------------------------"
echo "  To view logs:"
echo "    tail -f logs/backend.log"
echo "    tail -f logs/frontend.log"
echo "  To stop all services:"
echo "    ./stop_services.sh"
echo "=================================================="
