#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Production Runner (Portable)
# ==============================================================================
# Starts the PANDA unified production server (FastAPI serving compiled React SPA,
# REST APIs, and ESP32 WebSocket Gateway) using the local virtual environment.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/panda.pid"
LOG_FILE="$SCRIPT_DIR/logs/backend.log"

echo "=============================================================================="
echo "    PANDA — Pin And Network-based Door Authentication: Production Launch"
echo "=============================================================================="

# 1. Verify Virtual Environment
if [ ! -d "venv" ] || [ ! -f "venv/bin/activate" ]; then
    echo "Virtual environment not detected. Running automated setup..."
    ./setup.sh || {
        echo >&2 "Error: ./setup.sh failed. Please resolve setup prerequisites before launching."
        exit 1
    }
fi

if [ ! -f "venv/bin/activate" ]; then
    echo >&2 "Error: Virtual environment venv/bin/activate not found. Aborting."
    exit 1
fi

source venv/bin/activate

# 2. Check Database Connection
echo "Checking PostgreSQL database connectivity..."
python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(2.0)
try:
    s.connect(('127.0.0.1', 5432))
    s.close()
    print('  ✓ PostgreSQL is reachable on 127.0.0.1:5432')
except Exception:
    print('  ! Warning: PostgreSQL port 5432 is not responding on 127.0.0.1.')
    print('    Please ensure your PostgreSQL server is started before connecting.')
"

# 3. Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "  ! PANDA is already running with PID $OLD_PID."
        echo "    Web Portal: http://localhost:8000"
        echo "    To restart, run: ./stop.sh && ./run.sh"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# 4. Check Frontend Dist Bundle
if [ ! -f "frontend/dist/index.html" ]; then
    echo "Frontend build missing. Compiling frontend now..."
    (cd frontend && npm run build)
fi

# Check for clean-db flag
CLEAN_DB="false"
for arg in "$@"; do
    if [[ "$arg" == "--clean-db" || "$arg" == "--fresh" || "$arg" == "--reset-db" ]]; then
        CLEAN_DB="true"
    fi
done

# Ensure release database exists without prompting for TCP password
if command -v psql >/dev/null 2>&1; then
    if [ "$CLEAN_DB" = "true" ]; then
        echo "  -> [CLEAN-DB] Dropping and recreating database for fresh start..."
        sudo -n -u postgres psql -c "DROP DATABASE IF EXISTS panda;" 2>/dev/null || true
        sudo -n -u postgres psql -c "DROP DATABASE IF EXISTS panda_release;" 2>/dev/null || true
    fi

    DB_EXISTS=false
    if sudo -n -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw panda; then
        DB_EXISTS=true
    elif PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -U postgres -w -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw panda; then
        DB_EXISTS=true
    fi

    if [ "$DB_EXISTS" = false ]; then
        echo "  -> Ensuring database exists..."
        sudo -n -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null || true
        sudo -n -u postgres psql -c "CREATE DATABASE panda OWNER postgres;" 2>/dev/null || \
            PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -U postgres -w -c "CREATE DATABASE panda;" 2>/dev/null || true
        alembic upgrade head 2>/dev/null || true
    elif [ "$CLEAN_DB" = "true" ]; then
        alembic upgrade head 2>/dev/null || true
    fi
fi

# Ensure logs directory and backend.log ownership
mkdir -p "$SCRIPT_DIR/logs" 2>/dev/null || true
if ! touch "$SCRIPT_DIR/logs/.test_write" 2>/dev/null; then
    LOG_FILE="/tmp/panda_backend_${USER}.log"
elif [ -f "$LOG_FILE" ] && [ ! -w "$LOG_FILE" ]; then
    echo "  -> Note: $LOG_FILE is not writable by current user ($USER). Redirecting to per-user log..."
    LOG_FILE="$SCRIPT_DIR/logs/backend_${USER}.log"
    touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/panda_backend_${USER}.log"
else
    rm -f "$SCRIPT_DIR/logs/.test_write" 2>/dev/null || true
    touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/panda_backend_${USER}.log"
fi
touch "$LOG_FILE" 2>/dev/null || true

# 5. Launch Server
HOST="0.0.0.0"
PORT="8000"
WORKERS=1

# Check if foreground mode requested
if [ "$1" == "--foreground" ] || [ "$1" == "-f" ]; then
    echo "Starting PANDA in foreground mode (Press Ctrl+C to terminate)..."
    exec uvicorn backend.app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS"
else
    echo "Starting PANDA production server in background..."
    nohup uvicorn backend.app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS" </dev/null >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    disown "$NEW_PID" 2>/dev/null || true
    echo "$NEW_PID" > "$PID_FILE"

    # Wait 2 seconds and check if process is alive
    sleep 2
    if ps -p "$NEW_PID" > /dev/null 2>&1; then
        echo "  ✓ PANDA started successfully with PID: $NEW_PID"
        echo ""
        echo "=============================================================================="
        echo "   Access Endpoints:"
        echo "   • Web App & Admin Portal:   http://localhost:$PORT"
        echo "   • Interactive API Docs:     http://localhost:$PORT/api/docs"
        echo "   • Health Check:             http://localhost:$PORT/health"
        echo "   • Door WebSocket Gateway:   ws://localhost:$PORT/api/v1/ws/<space_slug>"
        echo "=============================================================================="
        echo "   • Live Logs:                tail -f logs/backend.log"
        echo "   • Stop Server:              ./stop.sh"
        echo "=============================================================================="
    else
        echo "  ✗ Error: PANDA server failed to stay running. Recent logs:"
        tail -n 25 "$LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
fi
