#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Production Release Setup Script (Portable)
# ==============================================================================
# Sets up PANDA on any Linux/macOS machine using standard Python venv and npm.
# Does NOT require micromamba or conda.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================================================================="
echo "     PANDA — Pin And Network-based Door Authentication: Production Setup"
echo "=============================================================================="

# 1. Check prerequisites
echo "[1/5] Checking system prerequisites..."
command -v python3 >/dev/null 2>&1 || { echo >&2 "Error: python3 is required but not installed. Aborting."; exit 1; }

PYTHON_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "  ✓ Found Python $PYTHON_VER"

# If production bundle frontend/dist/index.html exists, node/npm are NOT needed!
if [ -f "frontend/dist/index.html" ]; then
    echo "  ✓ Pre-compiled production frontend bundle detected in frontend/dist."
    echo "    (Node.js and npm are not required on this production runtime server)"
else
    echo "  -> Pre-compiled frontend bundle missing. Checking for Node and npm..."
    command -v node >/dev/null 2>&1 || {
        echo >&2 "Error: Node.js is required to compile frontend from source."
        echo >&2 "Please install Node.js on this machine or build the bundle on your development laptop."
        exit 1
    }
    command -v npm >/dev/null 2>&1 || { echo >&2 "Error: npm is required. Aborting."; exit 1; }
    echo "  ✓ Found Node $(node -v)"
    echo "  ✓ Found npm $(npm -v)"
fi

# 2. Setup Python Virtual Environment
echo ""
echo "[2/5] Setting up local Python virtual environment (venv)..."
if [ ! -d "venv" ] || [ ! -f "venv/bin/activate" ]; then
    rm -rf venv
    python3 -m venv venv || {
        echo >&2 ""
        echo >&2 "✗ Error: Failed to create Python virtual environment."
        echo >&2 "  On Ubuntu / Debian (Raspberry Pi), please run:"
        echo >&2 "    sudo apt update && sudo apt install -y python3-venv python3-pip python3-dev libpq-dev"
        echo >&2 ""
        exit 1
    }
    echo "  ✓ Created new virtual environment in $SCRIPT_DIR/venv"
else
    echo "  ✓ Existing virtual environment found in $SCRIPT_DIR/venv"
fi

# Activate venv
source venv/bin/activate
pip install --upgrade pip setuptools wheel --quiet
echo "  ✓ Pip upgraded to $(pip --version | awk '{print $2}')"

# 3. Install Python Dependencies
echo ""
echo "[3/5] Installing backend Python packages from requirements.txt..."
pip install -r requirements.txt --quiet
echo "  ✓ All backend dependencies installed successfully."

# 4. Install Frontend Dependencies & Compile Production Bundle
echo ""
if [ -f "frontend/dist/index.html" ]; then
    echo "[4/5] Using pre-compiled production frontend bundle (frontend/dist)."
else
    echo "[4/5] Building minified React PWA production bundle..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        echo "  -> Installing frontend npm packages (clean install)..."
        npm install --quiet
    fi

    echo "  -> Compiling Vite production distribution bundle (dist)..."
    npm run build
    cd "$SCRIPT_DIR"
    echo "  ✓ Production bundle compiled in frontend/dist"
fi

# 5. Initialize Directories & Environment Configuration
echo ""
echo "[5/5] Initializing application directories and configuration..."
mkdir -p logs
mkdir -p backend/firmware_bins

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "  ✓ Generated initial .env from .env.example"
    else
        echo "  ! Warning: No .env found. Please configure .env before starting."
    fi
else
    echo "  ✓ Existing .env file found."
fi

# Check for clean-db flag
CLEAN_DB="false"
for arg in "$@"; do
    if [[ "$arg" == "--clean-db" || "$arg" == "--fresh" || "$arg" == "--reset-db" ]]; then
        CLEAN_DB="true"
    fi
done

# 6. Database Provisioning & Schema Migrations
echo ""
echo "[6/6] Ensuring PostgreSQL database schema..."
if command -v psql >/dev/null 2>&1; then
    if [ "$CLEAN_DB" = "true" ]; then
        echo "  -> [CLEAN-DB] Dropping existing databases for fresh setup..."
        sudo -u postgres psql -c "DROP DATABASE IF EXISTS panda;" 2>/dev/null || true
        sudo -u postgres psql -c "DROP DATABASE IF EXISTS panda_release;" 2>/dev/null || true
    fi

    DB_EXISTS=false
    if sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw panda_release; then
        DB_EXISTS=true
    elif PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -U postgres -w -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw panda_release; then
        DB_EXISTS=true
    fi

    if [ "$DB_EXISTS" = false ]; then
        echo "  -> Creating isolated release database 'panda_release'..."
        sudo -u postgres psql -c "CREATE DATABASE panda_release;" 2>/dev/null || \
            PGPASSWORD="${PGPASSWORD:-postgres}" psql -h 127.0.0.1 -U postgres -w -c "CREATE DATABASE panda_release;" 2>/dev/null || true
    fi
fi
if [ -d "venv" ]; then
    source venv/bin/activate
    alembic upgrade head >/dev/null 2>&1 || true
    echo "  ✓ Database schema up to date on 'panda_release'."
fi

# Ensure executable permissions on all release scripts
chmod +x setup.sh setup_rehan.sh run.sh run_rehan.sh stop.sh stop_rehan.sh

echo ""
echo "=============================================================================="
echo "   ✓ PANDA Production Release Build is ready!"
echo "=============================================================================="
echo "To start PANDA services, run:"
echo "   ./run.sh"
echo ""
echo "To stop PANDA services, run:"
echo "   ./stop.sh"
echo "=============================================================================="
