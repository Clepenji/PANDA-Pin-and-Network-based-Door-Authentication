#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Production Shutdown Script
# ==============================================================================
# Gracefully stops running PANDA backend server processes and workers.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/panda.pid"

echo "Stopping PANDA services..."

STOPPED=false

if systemctl is-active --quiet panda 2>/dev/null; then
    echo "  Stopping systemd service panda.service..."
    sudo systemctl stop panda 2>/dev/null || true
    STOPPED=true
fi

if systemctl is-active --quiet pibas 2>/dev/null; then
    echo "  Stopping legacy systemd service pibas.service..."
    sudo systemctl stop pibas 2>/dev/null || true
    STOPPED=true
fi

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "  Terminating PANDA server (PID $PID)..."
        kill -TERM "$PID" 2>/dev/null || true
        for i in {1..10}; do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                STOPPED=true
                break
            fi
            sleep 0.5
        done

        if ps -p "$PID" > /dev/null 2>&1; then
            echo "  Force killing PANDA server (PID $PID)..."
            kill -KILL "$PID" 2>/dev/null || true
            STOPPED=true
        fi
    fi
    rm -f "$PID_FILE"
fi
rm -f "$SCRIPT_DIR/pibas.pid" 2>/dev/null || true

# Fallback check for any remaining uvicorn workers
if pgrep -f "uvicorn backend.app.main:app" > /dev/null 2>&1; then
    echo "  Cleaning up orphan uvicorn processes..."
    pkill -f "uvicorn backend.app.main:app" 2>/dev/null || true
    STOPPED=true
fi

if [ "$STOPPED" = true ]; then
    echo "  ✓ PANDA server has been stopped."
else
    echo "  No running PANDA instance was found."
fi
