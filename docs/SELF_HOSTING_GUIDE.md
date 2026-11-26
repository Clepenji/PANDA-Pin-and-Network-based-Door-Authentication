# PANDA — Self-Hosting & Local Execution Guide

This guide details how to start, run, and maintain the **PANDA (Pin And Network-based Door Authentication)** monorepo on your local machine or Ubuntu server.

---

## 1. System Architecture & Ports

| Service | Port | Description |
| :--- | :--- | :--- |
| **PostgreSQL** | `5432` | Relational database (models, PIN cache, audit logs, ESP32 registry) |
| **FastAPI Backend** | `8000` | Asynchronous REST APIs, WebSockets (`/ws/esp32/{space_id}`), and SPA static serving |
| **Vite Dev Server** | `5173` | React frontend development server with Hot Module Replacement (HMR) |
| **ESP32 Edge Node** | — | Hardware microcontroller door controller connecting via WebSocket |

> [!NOTE]
> When the frontend is built (`npm run build` in `frontend/`), **FastAPI serves both the frontend UI and the backend APIs simultaneously on port `8000`**. You do not need the Vite dev server running in production!

---

## 2. Prerequisites & Environment

1. **Micromamba / Conda environment**: `panda` (Python 3.11)
2. **Node.js**: v18+ and `npm`
3. **PostgreSQL**: PostgreSQL 15+ cluster located at `~/panda_postgres_data`

---

## 3. Step-by-Step Server Startup

### Step 1: Start PostgreSQL
```bash
# Check if PostgreSQL is already running
micromamba run -n panda pg_isready -h localhost -p 5432

# If not running, start the cluster:
micromamba run -n panda pg_ctl -D ~/panda_postgres_data -l ~/panda_postgres_data/logfile start
```

### Step 2: Build the Frontend (Optional for Production Mode)
If you made changes to the React code:
```bash
cd /home/clepenji/PANDA/frontend
npm run build
cd /home/clepenji/PANDA
```

### Step 3: Run the FastAPI Backend
From the workspace root (`/home/clepenji/PANDA`):
```bash
micromamba run -n panda uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```
On startup, FastAPI will automatically:
- Seed the initial database state (Root Admin: `rehankuriance@gmail.com`).
- Seed default Facility Spaces (`sandboxx_0` and `sandboxx_1`).
- Provision default cryptographic credentials for ESP32 nodes.
- Start APScheduler for 5-minute ESP32 heartbeat watchdogs and annual September 1st purges.

### Step 4: Run Vite Frontend Dev Server (Development Only)
If you want instant hot-reloading while developing:
```bash
cd /home/clepenji/PANDA/frontend
npm run dev
```
Open **`http://localhost:5173`** or **`http://<SERVER_LAN_IP>:5173`** in your browser. All API and WebSocket requests are automatically proxied to port 8000.

---

## 4. One-Liner Quickstart Scripts

You can also run both or stop them with the following one-liners:

### Start Backend in Background:
```bash
nohup micromamba run -n panda uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 > backend.log 2>&1 &
```

### Stop Server Processes:
```bash
# Stop FastAPI
pkill -f "uvicorn backend.app.main:app"

# Stop PostgreSQL
micromamba run -n panda pg_ctl -D ~/panda_postgres_data stop
```

---

## 5. Default Credentials & Portal Access

- **Master Root Admin**:
  - Email: `rehankuriance@gmail.com`
  - Access: Full access to all Facility Spaces, SuperUser management, Directory cluster graphs, ESP32 secret rotation, and OTA firmware updates.
- **Interactive Swagger API Docs**:
  - `http://localhost:8000/docs`
- **Service Health Check**:
  - `http://localhost:8000/health`

---

## 6. ESP32 Hardware Connection

1. Open `hardware/esp32_firmware/esp32_firmware.ino` in Arduino IDE.
2. Confirm the settings at the top of the sketch:
   ```cpp
   #define FIRMWARE_VERSION       "1.0.1"
   #define SPACE_ID               "sandboxx_0"
   #define DEVICE_SECRET          "<TOKEN_COPIED_FROM_ROOT_ADMIN_PORTAL>"
   #define WIFI_SSID              "Your_WiFi_SSID"
   #define WIFI_PASSWORD          "Your_WiFi_Password"
   #define SERVER_HOST            "10.138.31.138"  // Your Ubuntu LAN IP
   #define SERVER_PORT            8000
   ```
3. Flash the code onto the ESP32. Upon boot, the ESP32 will connect to Wi-Fi, complete the HMAC challenge with `AUTH_HELLO`, receive `AUTH_ACK`, and display the online icon on the LCD.
