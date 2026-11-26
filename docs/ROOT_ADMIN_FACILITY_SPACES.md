# PANDA — Master Root Admin Guide: Registering & Maintaining Facility Spaces (ESPs)

This operational guide details the complete procedure for the **Master Root Administrator** (`rehankuriance@gmail.com`) to register, configure, and maintain new Facility Spaces and their corresponding IoT hardware controllers (ESP32 door locks) in **PANDA (Pin And Network-based Door Authentication)**.

---

## 1. Architectural Overview & Security Boundary

In PANDA:
* A **Facility Space** represents an access-controlled physical zone (e.g. `SandBoxx 0`, `SandBoxx 1`, `SandBoxx 2 - Robotics Lab`).
* Each Facility Space is paired with a dedicated physical IoT microcontroller (ESP32-WROOM) operating a relay and a numeric keypad.
* **Master Root Admin Only:** To protect the physical building perimeter, the ability to register new spaces and ESP hardware is restricted **exclusively** to the Master Root Administrator (`rehankuriance@gmail.com`, `is_root=True`). Secondary Admins, SuperUsers, and Entrants cannot register spaces and will receive a `403 Forbidden` response from the backend.

---

## 2. Step-by-Step: Registering a New Facility Space via the UI

1. **Log in as Root Admin**:
   * Navigate to the PANDA login page (`/`).
   * Enter `rehankuriance@gmail.com` and click **Continue to Dashboard**.
2. **Access the Spaces Tab**:
   * On the Admin Dashboard top navigation bar, click the **"Facility Spaces & ESPs"** tab (this tab is visible exclusively to the Root Admin).
3. **Open the Registration Modal**:
   * Click the **"+ Register Space / ESP32"** button in the top-right corner.
4. **Enter Space & Hardware Details**:
   * **Space Display Name**: e.g., `SandBoxx 2 (Robotics & AI)`
   * **Machine Slug**: Auto-formatted in lowercase alphanumeric with underscores (e.g., `sandboxx_2`).
   * **ESP32 Device Identifier**: Auto-formatted hardware identifier (e.g., `ESP32_SANDBOXX_2_DOOR`). This must match the device ID flashed into the physical ESP32 firmware.
   * **Active Status**: Keep checked (`is_active = True`) to allow immediate PIN issuance and keypad authentication.
5. **Confirm Registration**:
   * Click **"Confirm Registration"**.
   * The new space is immediately persisted to PostgreSQL and will dynamically appear in all space selectors, SuperUser authority dropdowns, and WebSocket channels.

---

## 3. Physical ESP32 Hardware Configuration

Each physical ESP32 installed on a door lock connects to the PANDA backend using institutional Wi-Fi:

### 3.1. Real-Time WebSocket Channel
The ESP32 opens a persistent WebSocket connection to receive instant PIN additions and early revocations:
```text
ws://<PANDA_HOST>/api/v1/ws/esp32/{space_slug}
```
**Payloads received by the ESP32**:
* **Add PIN**:
  ```json
  {
    "action": "ADD_PIN",
    "space_id": "sandboxx_2",
    "pin": "488205",
    "expires_at": "2026-11-15T02:45:00Z"
  }
  ```
* **Revoke PIN**:
  ```json
  {
    "action": "REVOKE_PIN",
    "space_id": "sandboxx_2",
    "pin": "488205"
  }
  ```

### 3.2. Polling Sync Fallback (Network Resilience)
If Wi-Fi drops or the ESP32 boots up after a power cycle, it polls the sync endpoint to rebuild its local memory cache of active unexpired PINs:
```http
GET /api/v1/esp32/{space_slug}/sync
```
**Response**:
```json
{
  "space_id": "sandboxx_2",
  "synced_at": "2026-11-15T02:42:00Z",
  "pins": [
    {
      "pin": "488205",
      "expires_at": "2026-11-15T02:45:00Z",
      "holder_name": "Arjun Sharma",
      "holder_email": "lead.robotics@college.edu"
    }
  ]
}
```

### 3.3. Keypad Event Submission
When an entrant types a 6-digit PIN on the door keypad, the ESP32 posts the event to verify entry:
```http
POST /api/v1/esp32/events
Content-Type: application/json

{
  "space_id": "sandboxx_2",
  "pin_entered": "488205",
  "timestamp": "2026-11-15T02:42:30Z",
  "door_unlocked": true
}
```

---

## 4. Delegating Space Authority to SuperUsers

Once the space is registered, delegate operational authority to club leads or lab managers:
1. In the Admin Dashboard, switch to the **"SuperUsers"** tab.
2. Click **"+ Add SuperUser"** (or edit an existing SuperUser).
3. Under **Facility Space Authority**, check the box for your newly created space (`SandBoxx 2`).
4. Save the record.
5. That SuperUser now has:
   * Real-time access to review access requests for `SandBoxx 2`.
   * Authority to self-generate direct entrance passes for `SandBoxx 2`.
   * Authority to revoke active keys in `SandBoxx 2`.

---

## 5. Testing & Verification via Keypad Simulator

To verify door lock operations without being physically at the building:
1. On the top navigation header, click the **"ESP Keypad"** tool button.
2. Select your newly created space from the dropdown (e.g. `SandBoxx 2`).
3. Have a SuperUser generate an active PIN for that space.
4. Enter the 6-digit code on the interactive keypad simulator.
5. Verify that:
   * The status turns green (**"Access Granted — Relay Energized"**).
   * An immutable `ACCESS_GRANTED` record appears in the **Audit Logs**.

---

## 6. Maintenance & Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **Space not visible in dropdowns** | `is_active` set to `False` | In PostgreSQL or the registry, verify `is_active` is `True`. |
| **ESP32 not receiving PINs** | WebSocket disconnected | Ensure ESP32 firmware reconnects with exponential backoff and polls `GET /api/v1/esp32/{slug}/sync`. |
| **"Access Forbidden (403)" when creating space** | Caller is not Root Admin | Log in strictly with `rehankuriance@gmail.com`. Secondary admins cannot manage spaces. |
| **Duplicate Space Slug error (400)** | Slug or ESP32 ID already in use | Use a unique slug (e.g. `sandboxx_3`) and unique hardware ID. |
