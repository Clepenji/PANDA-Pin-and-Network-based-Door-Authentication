#!/usr/bin/env bash
# ==============================================================================
# PANDA - Stop Services Script
# ==============================================================================

PG_DATA="/home/clepenji/panda_postgres_data"
[ ! -d "$PG_DATA" ] && [ -d "/home/clepenji/pibas_postgres_data" ] && PG_DATA="/home/clepenji/pibas_postgres_data"
ENV_NAME="panda"
[ ! -d "/home/clepenji/micromamba/envs/panda" ] && [ -d "/home/clepenji/micromamba/envs/pibas" ] && ENV_NAME="pibas"
MAMBA_BIN="/home/clepenji/micromamba/envs/${ENV_NAME}/bin"

echo "Stopping PANDA PostgreSQL server..."
if [ -f "$MAMBA_BIN/pg_ctl" ]; then
    $MAMBA_BIN/pg_ctl -D "$PG_DATA" stop -m fast || true
fi

echo "Stopping Node / Uvicorn if running in background..."
pkill -f "uvicorn backend.app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

echo "✓ All PANDA services stopped."
