# PANDA — Raspberry Pi 4 Model B (4GB) Setup & Deployment Guide

This guide details step-by-step instructions to configure, run, and auto-start **PANDA** as a 24/7 dedicated facility access controller on a **Raspberry Pi 4 Model B (4GB RAM)**.

---

## 1. System Requirements & Recommendations

* **Hardware**: Raspberry Pi 4 Model B (4GB RAM)
* **Storage**: High-end MicroSD card (A1/A2 rated, 32GB+) or USB 3.0 SSD (recommended for maximum PostgreSQL write durability).
* **Operating System**: **Raspberry Pi OS Lite (64-bit)** (Debian Bookworm) or **Ubuntu Server 24.04/22.04 LTS (64-bit ARM64)**.
  > [!IMPORTANT]
  > Always install the **64-bit (`aarch64`)** edition of the OS. 64-bit is required for pre-built Python ARM wheels and PostgreSQL performance.

---

## 2. Step 1: Operating System & System Dependencies

Connect to the Raspberry Pi via SSH, update packages, and install runtime prerequisites:

```bash
# 1. Update OS packages
sudo apt update && sudo apt upgrade -y

# 2. Install Python 3, PostgreSQL, Git, Node.js, and build tools
sudo apt install -y \
    git curl \
    python3 python3-venv python3-pip python3-dev \
    build-essential libpq-dev \
    postgresql postgresql-contrib \
    nginx

# 3. Install Node.js (v20 LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify installations:
```bash
python3 --version     # Python 3.11+
node -v              # v20.x+
psql --version       # psql 15+
```

---

## 3. Step 2: Configure PostgreSQL Database

The Pi 4B runs native PostgreSQL as an automated systemd daemon:

```bash
# 1. Ensure PostgreSQL is enabled and running
sudo systemctl enable --now postgresql

# 2. Create the 'postgres' superuser password and 'panda' database
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres createdb -O postgres panda

# 3. Test connection
PGPASSWORD=postgres psql -U postgres -h localhost -d panda -c "SELECT 1;"
```

### Restore Database Data & Schema
Transfer your `panda_db_dump.sql` to the Pi (e.g., via `scp` or flash drive):
```bash
PGPASSWORD=postgres psql -U postgres -h localhost -d panda -f ~/panda_db_dump.sql
```

---

## 4. Step 3: Clone Codebase & Setup Python Virtual Environment

Clone or transfer the PANDA repository to `/home/pi/PANDA`:

```bash
cd /home/pi
# Clone or unpack
# git clone <YOUR_REPO_URL> PANDA
cd PANDA

# 1. Create a lightweight Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Upgrade pip and install optimized production dependencies
pip install --upgrade pip
pip install -r backend/requirements-pi.txt
```

> [!TIP]
> `backend/requirements-pi.txt` contains clean production wheels (`fastapi`, `uvicorn`, `sqlalchemy`, `asyncpg`, `pyjwt`, `pywebpush`, etc.) without compiling extraneous packages, keeping Pi memory usage under **80MB**!

---

## 5. Step 4: Configure Environment Variables (`.env`)

Create or update `/home/pi/PANDA/.env`:

```env
# Mode
ENVIRONMENT=production
DEBUG=False

# PostgreSQL Connection (local native socket / port 5432)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/panda
SYNC_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/panda

# Security Tokens
SECRET_KEY=generate-a-strong-random-secret-key-for-production-jwt
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=43200

# Access PIN Duration
PIN_TTL_SECONDS=180
PIN_TTL_MINUTES=3

# Root Admin & Notifications
ROOT_ADMIN_EMAIL=rehankuriance@gmail.com
VAPID_PUBLIC_KEY=BGYYyGhat5PNu2w7q_w4uhC1kdsSYOTCd8vrYSXgdxrKIoetQmhpbqxRZl_SRUxeJNubyWZXrU5F1mCkCtjLBmo
VAPID_PRIVATE_KEY=z3iINySUY5XeTyVsO19yv6CjFQbOo-J1FUt4LqDVscE
VAPID_CLAIM_EMAIL=mailto:rehankuriance@gmail.com

# Server Bindings (Listen on all interfaces)
HOST=0.0.0.0
PORT=8000
FRONTEND_URL=http://0.0.0.0:8000
```

---

## 6. Step 5: Build React Frontend

FastAPI automatically serves the built frontend SPA from `frontend/dist`. Build it once:

```bash
cd /home/pi/PANDA/frontend
npm install
npm run build
```

> [!NOTE]
> On the Raspberry Pi 4B (4GB), `npm run build` takes ~15–25 seconds.
> Once built, FastAPI serves both the web app and the WebSocket API together on port `8000` — **no Node/Vite process needed in production**!

---

## 7. Step 6: 24/7 Autostart via Systemd Service

To ensure PANDA starts automatically whenever the Raspberry Pi boots and recovers if an unexpected crash occurs:

```bash
# 1. Copy the systemd service file
sudo cp /home/pi/PANDA/deploy/panda.service /etc/systemd/system/panda.service

# 2. Reload systemd daemon
sudo systemctl daemon-reload

# 3. Enable service to start on boot & start it now
sudo systemctl enable --now panda
```

### Check Service Status & Logs
```bash
# Check status
sudo systemctl status panda

# View live streaming server logs
sudo journalctl -u panda -f
```

---

## 8. Step 7: (Optional) Nginx Reverse Proxy for Port 80 / SSL

To access PANDA on standard HTTP port `80` (or configure domain SSL with Let's Encrypt / Cloudflare):

Create `/etc/nginx/sites-available/panda`:
```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 20M;

    # Proxy all traffic and WebSockets to FastAPI backend
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site:
```bash
sudo ln -sf /etc/nginx/sites-available/panda /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Now accessing `http://<RASPBERRY_PI_IP>` directly opens the PANDA web portal!

---

## 9. Step 8: Configure ESP32 Microcontrollers

1. Find the Raspberry Pi's local IP address:
   ```bash
   hostname -I
   # Example: 192.168.1.100
   ```
2. In `hardware/esp32_firmware/esp32_firmware.ino`:
   ```cpp
   // If using local IP:
   #define USE_DOMAIN_NAME        false
   #define SERVER_HOST            "192.168.1.100"  // Raspberry Pi IP
   #define SERVER_PORT            8000             // Or 80 if using Nginx
   ```
   Or if hosting on a public domain with Dynamic DNS:
   ```cpp
   #define USE_DOMAIN_NAME        true
   #define SERVER_DOMAIN          "panda.yourdomain.com"
   #define SERVER_PORT            80
   ```
3. Flash the code to the ESP32. It will connect to the Pi, establish the WebSocket channel, and begin serving access credentials!
