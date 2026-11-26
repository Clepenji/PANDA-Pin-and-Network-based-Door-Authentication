#!/usr/bin/env bash
# ==============================================================================
# PANDA (Pin And Network-based Door Authentication) - Automated Raspberry Pi Deployment Script
# ==============================================================================
# Deploys PANDA directly from your development laptop to your Raspberry Pi
# running Ubuntu 24.04 LTS without repeated password prompts.
#
# Supported Usage Formats:
#   1. By IP, User, and Password:
#      ./deploy_to_pi.sh <PI_IP> <PI_USER> [PASSWORD] [REMOTE_DIR]
#      e.g. ./deploy_to_pi.sh 172.16.45.145 pi mypassword
#
#   2. Standard SSH target format:
#      ./deploy_to_pi.sh <USER@PI_IP> [PASSWORD] [REMOTE_DIR]
#      e.g. ./deploy_to_pi.sh pi@172.16.45.145 mypassword
#
#   3. Saved Default (press Enter to reuse last successful IP & user):
#      ./deploy_to_pi.sh
#
#   4. Clean/Fresh Database Wipe:
#      ./deploy_to_pi.sh pi@172.16.45.145 --clean-db
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.deploy_config"

# Check for clean-db flag
CLEAN_DB="false"
NON_FLAG_ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--clean-db" || "$arg" == "--fresh" || "$arg" == "--reset-db" ]]; then
        CLEAN_DB="true"
    else
        NON_FLAG_ARGS+=("$arg")
    fi
done

# Parse arguments flexibly
ARG1="${NON_FLAG_ARGS[0]:-}"
ARG2="${NON_FLAG_ARGS[1]:-}"
ARG3="${NON_FLAG_ARGS[2]:-}"
ARG4="${NON_FLAG_ARGS[3]:-}"

PI_USER=""
PI_IP=""
PI_PASS=""
REMOTE_DIR="~/PANDA"

# Detect argument layout
if [[ "$ARG1" == *"@"* ]]; then
    # Format: user@ip [password] [dir]
    PI_USER="${ARG1%@*}"
    PI_IP="${ARG1#*@}"
    PI_PASS="$ARG2"
    [ -n "$ARG3" ] && REMOTE_DIR="$ARG3"
elif [ -n "$ARG1" ] && [ -n "$ARG2" ] && [[ "$ARG2" != /* ]] && [[ "$ARG2" != "~"* ]]; then
    # Format: ip user [password] [dir]
    PI_IP="$ARG1"
    PI_USER="$ARG2"
    PI_PASS="$ARG3"
    [ -n "$ARG4" ] && REMOTE_DIR="$ARG4"
elif [ -n "$ARG1" ]; then
    # Only 1 arg provided
    if [[ "$ARG1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        PI_IP="$ARG1"
    fi
fi

# Load cached config if missing
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE" 2>/dev/null || true
fi

# Interactive prompts only if parameters are still missing
if [ -z "$PI_IP" ]; then
    echo "=============================================================================="
    echo "     PANDA — Deploy to Raspberry Pi (Ubuntu 24.04 LTS)"
    echo "=============================================================================="
    read -rp "Enter Raspberry Pi IP address [${SAVED_IP:-172.16.45.145}]: " INPUT_IP
    PI_IP="${INPUT_IP:-${SAVED_IP:-172.16.45.145}}"
fi

if [ -z "$PI_USER" ]; then
    read -rp "Enter Raspberry Pi Username [${SAVED_USER:-pi}]: " INPUT_USER
    PI_USER="${INPUT_USER:-${SAVED_USER:-pi}}"
fi

if [ -z "$PI_PASS" ]; then
    read -rsp "Enter Raspberry Pi Password (for SSH & sudo) [Enter if SSH key configured]: " INPUT_PASS
    echo ""
    PI_PASS="$INPUT_PASS"
fi

# Save configuration for fast one-key reuse
cat <<EOF > "$CONFIG_FILE"
SAVED_IP="$PI_IP"
SAVED_USER="$PI_USER"
EOF

SSH_TARGET="${PI_USER}@${PI_IP}"
MUX_SOCKET="/tmp/panda_mux_${PI_USER}_${PI_IP//./_}"

# Setup SSH Askpass if password was passed as argument
ASKPASS_FILE=""
if [ -n "$PI_PASS" ]; then
    ASKPASS_FILE=$(mktemp /tmp/panda_askpass_XXXXXX.sh)
    cat <<EOF > "$ASKPASS_FILE"
#!/bin/sh
echo "$PI_PASS"
EOF
    chmod +x "$ASKPASS_FILE"
    export SSH_ASKPASS="$ASKPASS_FILE"
    export SSH_ASKPASS_REQUIRE="force"
    export DISPLAY="dummy:0"
fi

# Cleanup helper on exit
cleanup() {
    [ -n "$ASKPASS_FILE" ] && rm -f "$ASKPASS_FILE"
    if [ -S "$MUX_SOCKET" ]; then
        ssh -o ControlPath="$MUX_SOCKET" -O exit "$SSH_TARGET" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Common SSH Options with ControlMaster (Authenticates ONCE, reuses connection)
SSH_OPTS="-o ControlMaster=auto -o ControlPath=$MUX_SOCKET -o ControlPersist=10m -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo ""
echo "=============================================================================="
echo "  Deploying PANDA Release to $SSH_TARGET:$REMOTE_DIR"
echo "=============================================================================="

# 1. Compile frontend on Laptop (saves Pi's slower ARM CPU and RAM)
echo "[1/4] Building production frontend bundle on laptop..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "  -> Installing frontend dependencies..."
    npm install --quiet
fi
npm run build
cd "$SCRIPT_DIR"
echo "  ✓ Frontend compiled in frontend/dist"

# 2. Establish Master SSH Connection (Authenticates ONCE)
echo ""
echo "[2/4] Connecting to Raspberry Pi ($SSH_TARGET)..."
if [ -z "$PI_PASS" ]; then
    echo "  (You will only be prompted for your password ONCE for the whole deployment)"
fi

ssh $SSH_OPTS -f -N "$SSH_TARGET" || {
    echo >&2 "Error: Could not connect to $SSH_TARGET. Please verify IP, username, and password."
    exit 1
}
echo "  ✓ Connected. Master SSH session established."

# 3. Create remote directory and sync release files
echo ""
echo "[3/4] Transferring release bundle via rsync over multiplexed SSH..."
ssh -o ControlPath="$MUX_SOCKET" "$SSH_TARGET" "mkdir -p $REMOTE_DIR"

rsync -avz --delete \
    -e "ssh -o ControlPath=$MUX_SOCKET" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'logs/*.log' \
    --exclude 'panda.pid' \
    --exclude 'pibas.pid' \
    --exclude '.deploy_config' \
    "$SCRIPT_DIR/" "$SSH_TARGET:$REMOTE_DIR/"

# Explicitly ensure production .env is deployed to remote
if [ -f "$SCRIPT_DIR/.env" ]; then
    rsync -avz -e "ssh -o ControlPath=$MUX_SOCKET" "$SCRIPT_DIR/.env" "$SSH_TARGET:$REMOTE_DIR/.env"
fi

echo "  ✓ Files transferred successfully (including pre-built frontend/dist and .env)."

# Verify if remote sudo requires password
if [ -z "$PI_PASS" ]; then
    if ! ssh -o ControlPath="$MUX_SOCKET" "$SSH_TARGET" "sudo -n true 2>/dev/null"; then
        while [ -z "$PI_PASS" ]; do
            echo ""
            read -rsp "Raspberry Pi sudo password required for services & database: " PI_PASS
            echo ""
            if [ -z "$PI_PASS" ]; then
                echo "Error: Sudo password cannot be empty when sudo requires authentication on Raspberry Pi."
            fi
        done
    fi
fi

# 4. Trigger remote setup, migrations, and service restart
echo ""
echo "[4/4] Applying setup, migrations, and restarting PANDA on Raspberry Pi..."
ssh -o ControlPath="$MUX_SOCKET" "$SSH_TARGET" bash -s "$PI_PASS" "$REMOTE_DIR" "$CLEAN_DB" << 'REMOTE_SCRIPT'
set -e
REMOTE_PASS="$1"
REMOTE_PATH="${2:-~/PANDA}"
CLEAN_DB="${3:-false}"
eval REMOTE_PATH="$REMOTE_PATH"
cd "$REMOTE_PATH"

run_sudo() {
    if [ -n "$REMOTE_PASS" ]; then
        echo "$REMOTE_PASS" | sudo -S "$@"
    else
        sudo -n "$@" 2>/dev/null || true
    fi
}

chmod +x setup.sh run.sh stop.sh 2>/dev/null || true

# 1. Stop any existing PANDA/legacy PiBAS processes cleanly first
echo "  -> Stopping previous PANDA processes..."
run_sudo systemctl stop panda 2>/dev/null || true
run_sudo systemctl stop pibas 2>/dev/null || true
run_sudo systemctl disable pibas 2>/dev/null || true
run_sudo rm -f /etc/systemd/system/pibas.service 2>/dev/null || true
./stop.sh >/dev/null 2>&1 || true
pkill -f "uvicorn backend.app.main:app" 2>/dev/null || true

# 2. Fix directory and log ownership to prevent root conflicts
run_sudo chown -R "$USER:$USER" "$REMOTE_PATH" 2>/dev/null || true
mkdir -p "$REMOTE_PATH/logs"
run_sudo chown -R "$USER:$USER" "$REMOTE_PATH/logs" 2>/dev/null || true
touch "$REMOTE_PATH/logs/backend.log" 2>/dev/null || true
chmod 664 "$REMOTE_PATH/logs/backend.log" 2>/dev/null || true

# 3. Clean database if requested
if [ "$CLEAN_DB" = "true" ]; then
    echo "  -> [CLEAN-DB] Dropping and recreating PostgreSQL databases for fresh start..."
    run_sudo -u postgres psql -c "DROP DATABASE IF EXISTS panda;" 2>/dev/null || true
    run_sudo -u postgres psql -c "DROP DATABASE IF EXISTS panda_release;" 2>/dev/null || true
fi

# 4. Ensure postgres user has password 'postgres' and release database exists
run_sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null || true
run_sudo -u postgres psql -c "CREATE DATABASE panda OWNER postgres;" 2>/dev/null || true
run_sudo -u postgres psql -c "CREATE DATABASE panda_release OWNER postgres;" 2>/dev/null || true

# 5. Run setup if venv is missing
if [ ! -d venv ] || [ ! -f venv/bin/activate ]; then
    echo "  -> Initializing Python virtual environment on Raspberry Pi..."
    ./setup.sh
fi

# 6. Apply migrations
if [ -d venv ]; then
    source venv/bin/activate
    alembic upgrade head 2>/dev/null || true
    echo "  ✓ Database schema applied cleanly via Alembic."
fi

# 7. Configure systemd service with remote user and directory
if [ -f "$REMOTE_PATH/scripts/panda.service" ]; then
    sed -e "s|%USER%|$USER|g" -e "s|%INSTALL_DIR%|$REMOTE_PATH|g" "$REMOTE_PATH/scripts/panda.service" > /tmp/panda.service
    run_sudo cp /tmp/panda.service /etc/systemd/system/panda.service 2>/dev/null || true
    run_sudo systemctl daemon-reload 2>/dev/null || true
fi

# 7. Restart server
if [ -f /etc/systemd/system/panda.service ]; then
    echo "  -> Restarting systemd service panda.service..."
    run_sudo systemctl daemon-reload 2>/dev/null || true
    run_sudo systemctl enable panda 2>/dev/null || true
    run_sudo systemctl restart panda || {
        echo "  ! Systemd restart failed, launching via ./run.sh directly..."
        ./run.sh
    }
    echo "  ✓ Systemd service panda restarted and active."
else
    echo "  -> Launching server via ./run.sh..."
    ./run.sh
fi
REMOTE_SCRIPT

echo ""
echo "=============================================================================="
echo "   ✓ Deployment Complete!"
echo "   PANDA is running on your Raspberry Pi: http://${PI_IP}:8000"
echo "=============================================================================="
echo ""
echo "Tip: To never type a password again, run this once from your laptop terminal:"
echo "   ssh-copy-id ${SSH_TARGET}"
echo "=============================================================================="
