#!/usr/bin/env bash
# ==============================================================================
# PANDA - Start Services Script
# Starts PostgreSQL, FastAPI Backend, and React Frontend
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_DATA="/home/clepenji/panda_postgres_data"
[ ! -d "$PG_DATA" ] && [ -d "/home/clepenji/pibas_postgres_data" ] && PG_DATA="/home/clepenji/pibas_postgres_data"
ENV_NAME="panda"
[ ! -d "/home/clepenji/micromamba/envs/panda" ] && [ -d "/home/clepenji/micromamba/envs/pibas" ] && ENV_NAME="pibas"
MAMBA_BIN="/home/clepenji/micromamba/envs/${ENV_NAME}/bin"

echo "=================================================="
echo "    Starting PANDA System Services"
echo "=================================================="

# 1. Start PostgreSQL if not running
if ! $MAMBA_BIN/pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
    echo "Starting PostgreSQL daemon..."
    $MAMBA_BIN/pg_ctl -D "$PG_DATA" -l "$PG_DATA/logfile" start
    echo "✓ PostgreSQL started."
else
    echo "✓ PostgreSQL already running."
fi

echo ""
echo "To run the backend:"
echo "    cd $DIR"
echo "    micromamba run -n $ENV_NAME uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload"
echo ""
echo "To run the frontend:"
echo "    cd $DIR/frontend"
echo "    npm run dev"
echo ""
echo "Backend:  http://localhost:8000 (Docs: http://localhost:8000/api/docs)"
echo "Frontend: http://localhost:5173"
echo "=================================================="
