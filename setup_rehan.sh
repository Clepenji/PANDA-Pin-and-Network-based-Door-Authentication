#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Setup Script (Rehan's Machine)
# ==============================================================================
# Specifically tailored for Rehan's developer machine using the 'panda'
# micromamba environment and local PostgreSQL cluster.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================================================================="
echo "      PANDA — Setup for Rehan's Machine (Micromamba 'panda' Env)"
echo "=============================================================================="

# 1. Check Micromamba
echo "[1/4] Checking micromamba and 'panda' environment..."
if command -v micromamba >/dev/null 2>&1; then
    MAMBA_BIN="micromamba"
elif [ -f "$HOME/.local/bin/micromamba" ]; then
    MAMBA_BIN="$HOME/.local/bin/micromamba"
elif [ -f "$HOME/bin/micromamba" ]; then
    MAMBA_BIN="$HOME/bin/micromamba"
else
    echo "Error: micromamba binary not found. Please run ./setup.sh for standard venv setup."
    exit 1
fi

echo "  ✓ Found micromamba: $($MAMBA_BIN --version 2>&1 | head -n 1)"
$MAMBA_BIN run -n panda python3 --version
echo "  ✓ Micromamba 'panda' environment verified."

# 2. Update Python Packages in 'panda' env
echo ""
echo "[2/4] Updating dependencies in 'panda' environment..."
$MAMBA_BIN run -n panda pip install -r requirements.txt --quiet
echo "  ✓ Python dependencies up to date."

# 3. Build Production Frontend
echo ""
echo "[3/4] Compiling frontend production bundle..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "  -> Installing frontend dependencies..."
    npm install --quiet
fi
npm run build
cd "$SCRIPT_DIR"
echo "  ✓ Frontend production bundle compiled in frontend/dist"

# 4. Directories and Permissions
echo ""
echo "[4/4] Ensuring directories and script permissions..."
mkdir -p logs
mkdir -p backend/firmware_bins

if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "  ✓ Seeded .env from .env.example"
fi

chmod +x setup.sh setup_rehan.sh run.sh run_rehan.sh stop.sh stop_rehan.sh

echo ""
echo "=============================================================================="
echo "   ✓ Rehan's Environment Setup Complete!"
echo "=============================================================================="
echo "To start PANDA on this machine, run:"
echo "   ./run_rehan.sh"
echo ""
echo "To stop PANDA, run:"
echo "   ./stop_rehan.sh"
echo "=============================================================================="
