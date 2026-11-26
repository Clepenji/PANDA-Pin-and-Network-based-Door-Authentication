/**
 * PANDA (Pin And Network-based Door Authentication) - ESP32-WROOM Edge Controller
 * Production Firmware v1.2.0 - Dynamic Dual-Network, Smart LCD & Real-Time Sync
 *
 * Hardware & Wiring Configuration:
 *   - 20x4 Character LCD via PCF8574 I2C Expander (Address: 0x27, SDA: GPIO 27, SCL: GPIO 26)
 *   - 4x4 Matrix Keypad via PCF8574 I2C Expander  (Address: 0x20, SDA: GPIO 27, SCL: GPIO 26)
 *   - Fail-Safe Door Lock Output on GPIO 13 (HIGH = Locked/Energized, LOW = Unlocked for 10s)
 *   - Indoor Exit Push-Button on GPIO 25 (Active LOW with internal pull-up resistor)
 *
 * Required Arduino IDE Libraries:
 *   - I2CKeyPad (by Rob Tillaart)
 *   - LiquidCrystal I2C (by Frank de Brabander)
 *   - WebSockets (by Markus Sattler)
 *   - ArduinoJson (by Benoit Blanchon, v7.x)
 */

#include <Arduino.h>           // Core Arduino framework types, GPIO, and timing functions
#include <WiFi.h>              // ESP32 Wi-Fi station mode networking stack
#include <WiFiUdp.h>           // UDP stack for non-blocking NTP connectivity queries
#include <WebSocketsClient.h>  // Bidirectional WebSocket client for real-time server link
#include <ArduinoJson.h>       // JSON serialization and deserialization for protocol frames
#include <LittleFS.h>          // Flash filesystem for persistent PIN register & offline log queue
#include <Wire.h>              // Hardware I2C master driver (shared by LCD and Keypad)
#include <LiquidCrystal_I2C.h> // I2C character display controller
#include <I2CKeyPad.h>         // Rob Tillaart's lightweight PCF8574 4x4 matrix keypad library
#include <HTTPUpdate.h>        // Server-pull HTTP Over-The-Air (OTA) firmware updater (Server-authenticated only)
#include <mbedtls/md.h>        // ESP-IDF hardware-accelerated cryptographic HMAC-SHA256 engine
#include <time.h>              // Standard C time conversion structures (gmtime, struct tm)
#include <sys/time.h>          // POSIX system clock functions (gettimeofday, settimeofday)
#include <vector>              // C++ STL dynamic array for in-memory PIN register

// ============================================================================
// 1. HARDWARE IDENTIFIERS & CRYPTOGRAPHIC CREDENTIALS
// (Configure these to match the values from the Root Admin Hardware Portal)
// ============================================================================
#define FIRMWARE_VERSION       "1.2.0"
#define SPACE_ID               "sandboxx_0"                  // Target Facility Space Slug (e.g. sandboxx_0)
#define DEVICE_ID              "ESP32_SANDBOXX_0_BACK_DOOR"
#define DEVICE_SECRET          "91d39bdc3bb30595b8ffddee070f7a62"

// Emergency Master TOTP Lifespan & Rotation Window (Fixed 24h = 86400s, independent of User PIN TTL)
#define TOTP_TIME_STEP_SEC     86400UL
#define DEVICE_NAME            "Secondary Door"                   // Friendly Door Lock Name (e.g. Main Door, Back Door)

// ============================================================================
// 2. OTA (OVER-THE-AIR) UPDATE CONFIGURATION & PER-SSID MACRO TOGGLE
// ============================================================================
// Set OTA_SERVER_ONLY_ON_SSID_1 to 1:
//   - On WIFI_SSID_1: Server-only OTA (ArduinoOTA port 3232 is disabled).
//   - On WIFI_SSID_2: Network ArduinoOTA mode (ArduinoOTA port 3232 enabled).
// Set OTA_SERVER_ONLY_ON_SSID_1 to 0:
//   - Network ArduinoOTA mode is enabled for ALL SSIDs (SSID_1 and SSID_2).
#define OTA_SERVER_ONLY_ON_SSID_1  1

#include <ArduinoOTA.h>
#define ARDUINO_OTA_PORT       3232
#define ARDUINO_OTA_HOSTNAME   DEVICE_ID       // Broadcasts via mDNS as ESP32_SANDBOXX_DOOR.local
#define ARDUINO_OTA_PASSWORD   ""              // Optional password ("" for no password)

// ============================================================================
// 3. DYNAMIC NETWORK & BACKEND HOST CONFIGURATION
// ============================================================================
// Dual Wi-Fi Network Credentials (SSID_2 is prioritized; ESP auto-switches to SSID_2 when detected)
#define WIFI_SSID_1            "Sandboxx_2.4"         // Secondary / Fallback Hotspot
#define WIFI_PASSWORD_1        ""

#define WIFI_SSID_2            "Phone1150"  // Primary / Prioritized Network
#define WIFI_PASSWORD_2        "hotspots"

#define WIFI_FAILOVER_TIMEOUT_MS 12000UL           // 12 seconds per network attempt when disconnected
#define WIFI_PRIORITY_SCAN_INTERVAL_MS 30000UL     // 30 seconds periodic check for SSID_2 while on SSID_1

// Server Host Selection: Set USE_DOMAIN_NAME to true for public domain hosting.
// Set to false when running directly against local LAN IP.
#define USE_DOMAIN_NAME        false

#define SERVER_DOMAIN          "panda.example.com" // Public domain (resolved via DNS)
#define SERVER_LOCAL_IP        "172.16.45.145"     // Local development LAN IP
#define SERVER_PORT            8000                // Local dev: 8000 | Production HTTP: 80 | HTTPS: 443
#define SERVER_USE_SSL         false               // Set true if public domain uses WSS/SSL (port 443)
#define WS_PATH                "/ws/esp32/" SPACE_ID

// Display Timezone Offset (IST = UTC + 5h 30m = 19800 seconds)
#define DISPLAY_TZ_OFFSET_SEC  19800

// ESP32 GPIO Assignments
#define I2C_SDA_PIN            27
#define I2C_SCL_PIN            26
#define LOCK_PIN               13   // Fail-safe lock output (HIGH = Locked, LOW = Unlocked)
#define EXIT_BUTTON_PIN        25   // Indoor exit switch (Active LOW with internal pullup)

// Fail-Safe Lock Polarity & Timing
#define LOCK_STATE_LOCKED      HIGH
#define LOCK_STATE_UNLOCKED    LOW
#define UNLOCK_DURATION_MS     10000UL // 10-second unlock duration

// I2C Peripheral Addresses
#define LCD_I2C_ADDR           0x27
#define KEYPAD_I2C_ADDR        0x20

// Flash File Paths & Intervals
#define PINS_FILE_PATH         "/active_pins.json"
#define OUTBOX_FILE_PATH       "/event_outbox.jsonl"
#define SERVER_PING_TIMEOUT_MS 360000UL // Reconnect if server heartbeat absent for 6 mins
#define OFFLINE_CLOCK_PROMPT_MS 180000UL // Prompt for manual time entry if offline > 3 mins after powerloss

// ============================================================================
// 3. DATA STRUCTURES & CUSTOM LCD STATUS ICONS
// ============================================================================
struct PinRecord {
  String pin;          // 6-digit numeric access code
  uint64_t valid_till; // UTC Unix Epoch expiration timestamp (seconds)
};

enum SystemUIMode {
  MODE_NORMAL_PIN,
  MODE_CLOCK_INPUT
};

// 16-key matrix mapping
const char KEYMAP[16] = {
  '1', '4', '7', '*',
  '2', '5', '8', '0',
  '3', '6', '9', '#',
  'A', 'B', 'C', 'D'
};

// Custom 5x8 Pixel Status Icon Bitmaps (Loaded into CGRAM slots 1..3)
// Slot 1: Wi-Fi Connected Symbol
byte ICON_WIFI[8] = {
  0b00000,
  0b01110,  //  ***
  0b10001,  // *   *
  0b00000,  //
  0b00100,  //   *
  0b01010,  //  * *
  0b00000,  //
  0b00100   //   *
};

// Slot 2: Server Connected (Inverted Triangle from top: ▼)
byte ICON_INV_TRIANGLE[8] = {
  0b00000,
  0b11111,  // *****
  0b11111,  // *****
  0b01110,  //  ***
  0b01110,  //  ***
  0b00100,  //   *
  0b00100,  //   *
  0b00000   //
};

// Slot 3: Wi-Fi Disconnected (Greek Phi 'Φ' / Slashed Zero)
byte ICON_PHI[8] = {
  0b00100,  //   *
  0b01110,  //  ***
  0b10101,  // * * *
  0b10101,  // * * *
  0b10101,  // * * *
  0b01110,  //  ***
  0b00100,  //   *
  0b00000   //
};

// ============================================================================
// 4. GLOBAL OBJECTS & FREERTOS HANDLES
// ============================================================================
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 20, 4);
I2CKeyPad keyPad(KEYPAD_I2C_ADDR);
WebSocketsClient webSocket;

SemaphoreHandle_t fsMutex;   // Protects LittleFS files & pinCache vector
SemaphoreHandle_t i2cMutex;  // Protects I2C bus transactions (LCD and Keypad)

std::vector<PinRecord> pinCache;

// Volatile Shared Telemetry Flags
volatile bool isWifiConnected     = false;
volatile bool isInternetNtpSynced = false;
volatile bool isServerAuthed      = false;
volatile bool isTimeValid         = false; // CRITICAL: True ONLY after NTP/Server sync OR manual time entry!
volatile bool isDoorUnlocked      = false;
volatile uint32_t unlockEndMs     = 0;
volatile uint32_t lastServerRxMs  = 0;

volatile bool isLockDisabled      = false; // Root Admin disable lock state
String disabledByEmail            = "";    // Email of admin who disabled the lock

uint32_t bootTimestampMs          = 0;
bool clockPromptTriggered         = false;
bool isClockManualSet             = false;

uint32_t offlineStartedEpoch      = 0;
bool wasOffline                   = false;

String pendingOtaUrl              = "";
String pendingOtaSha256           = "";
String pendingOtaMsgId            = "";
volatile bool isOtaInProgress     = false;

// LCD Differential Rendering Shadow Buffer (Eliminates Screen Flickering)
char lcdShadowBuffer[4][21];
bool lcdShadowInitialized = false;

// ============================================================================
// 5. UTILITY FUNCTIONS: CLOCK, HMAC-SHA256 & RFC 6238 TOTP ENGINE
// ============================================================================

uint64_t getCurrentEpochUTC() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec;
}

void setInternalEpochUTC(uint64_t epochSec) {
  if (epochSec < 1700000000ULL) return;
  struct timeval tv;
  tv.tv_sec = (time_t)epochSec;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  isTimeValid = true; // Mark time as authoritative
}

String generateMsgId() {
  char buf[48];
  snprintf(buf, sizeof(buf), "%s-%llu-%08x", SPACE_ID, getCurrentEpochUTC(), esp_random());
  return String(buf);
}

String computeHmacSha256Hex(const String& key, const String& payload) {
  uint8_t hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t mdType = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(mdType), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key.c_str(), key.length());
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload.c_str(), payload.length());
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  char hexOut[65];
  for (int i = 0; i < 32; i++) {
    snprintf(hexOut + (i * 2), 3, "%02x", hmacResult[i]);
  }
  hexOut[64] = '\0';
  return String(hexOut);
}

// RFC 6238 / RFC 4226 6-Digit TOTP Verification Engine
// Matches backend TotpService HMAC-SHA256 algorithm with ±1 window drift tolerance
bool verifyEmergencyTotp(const String& enteredPin, uint64_t epochSec, uint32_t timeStep = TOTP_TIME_STEP_SEC) {
  if (!isTimeValid) {
    Serial.println("[TOTP] Rejected: Time is not valid/set yet.");
    return false;
  }
  if (enteredPin.length() != 6) return false;
  for (int i = 0; i < 6; i++) {
    if (!isDigit(enteredPin[i])) return false;
  }
  if (epochSec < 1700000000ULL) return false;

  uint64_t currentCounter = epochSec / timeStep;

  // Check current window (0) and previous window (-1) for clock skew tolerance
  for (int w = 0; w >= -1; w--) {
    if (w < 0 && currentCounter == 0) continue;
    uint64_t counter = currentCounter + w;

    // Pack 64-bit big-endian counter into 8 bytes
    uint8_t msg[8];
    for (int i = 7; i >= 0; i--) {
      msg[i] = (uint8_t)(counter & 0xFF);
      counter >>= 8;
    }

    uint8_t hmacResult[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
    mbedtls_md_hmac_starts(&ctx, (const unsigned char*)DEVICE_SECRET, strlen(DEVICE_SECRET));
    mbedtls_md_hmac_update(&ctx, msg, 8);
    mbedtls_md_hmac_finish(&ctx, hmacResult);
    mbedtls_md_free(&ctx);

    // Dynamic truncation (RFC 4226 Section 5.3)
    uint8_t offset = hmacResult[31] & 0x0F;
    uint32_t binary = ((hmacResult[offset] & 0x7F) << 24) |
                      ((hmacResult[offset + 1] & 0xFF) << 16) |
                      ((hmacResult[offset + 2] & 0xFF) << 8) |
                      (hmacResult[offset + 3] & 0xFF);

    uint32_t pinNum = binary % 1000000UL;
    char expectedPin[7];
    snprintf(expectedPin, sizeof(expectedPin), "%06u", (unsigned int)pinNum);

    if (enteredPin.equals(expectedPin)) {
      Serial.printf("[TOTP] Emergency Master PIN verified! Window skew=%d, PIN=%s\n", w, expectedPin);
      return true;
    }
  }
  return false;
}

// Convert YYYY-MM-DD HH:MM:SS components to UTC Unix Epoch
uint64_t computeEpochFromDateTime(int year, int month, int day, int hour, int minute, int second) {
  static const int daysBeforeMonth[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  int y = year;
  int m = month;
  int d = day;

  int days = (y - 1970) * 365 + ((y - 1969) / 4) - ((y - 1901) / 100) + ((y - 1601) / 400);
  days += daysBeforeMonth[m - 1];
  if (m > 2 && (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0))) {
    days += 1;
  }
  days += (d - 1);

  uint64_t epoch = (uint64_t)days * 86400ULL +
                   (uint64_t)hour * 3600ULL +
                   (uint64_t)minute * 60ULL +
                   (uint64_t)second;
  return epoch;
}

bool parseAndValidateDateTime14(const String& buf, int& y, int& m, int& d, int& hr, int& min, int& sec) {
  if (buf.length() != 14) return false;
  for (int i = 0; i < 14; i++) {
    if (!isDigit(buf[i])) return false;
  }

  y   = buf.substring(0, 4).toInt();
  m   = buf.substring(4, 6).toInt();
  d   = buf.substring(6, 8).toInt();
  hr  = buf.substring(8, 10).toInt();
  min = buf.substring(10, 12).toInt();
  sec = buf.substring(12, 14).toInt();

  if (y < 2024 || y > 2099) return false;
  if (m < 1 || m > 12) return false;

  int daysInMonth = 31;
  if (m == 4 || m == 6 || m == 9 || m == 11) daysInMonth = 30;
  else if (m == 2) {
    bool isLeap = (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0));
    daysInMonth = isLeap ? 29 : 28;
  }
  if (d < 1 || d > daysInMonth) return false;

  if (hr < 0 || hr > 23) return false;
  if (min < 0 || min > 59) return false;
  if (sec < 0 || sec > 59) return false;

  return true;
}

// Formats 14 raw digits into dynamic "YYYY-MM-DD HH:MM:SS" on LCD
String formatDateTimeForLcd(const String& rawDigits) {
  char out[21];
  const char* mask = "YYYY-MM-DD HH:MM:SS";
  int digitIdx = 0;
  int outIdx = 0;

  for (int i = 0; i < 19; i++) {
    char m = mask[i];
    if (m == '-' || m == ' ' || m == ':') {
      out[outIdx++] = m;
    } else {
      if (digitIdx < (int)rawDigits.length()) {
        out[outIdx++] = rawDigits[digitIdx++];
      } else {
        out[outIdx++] = '_';
      }
    }
  }
  out[outIdx] = '\0';
  return String(out);
}

// ============================================================================
// 6. LITTLEFS FLASH STORAGE: ACTIVE PIN CACHE & OFFLINE EVENT OUTBOX
// ============================================================================

void loadPinsFromFlash() {
  xSemaphoreTake(fsMutex, portMAX_DELAY);
  pinCache.clear();

  if (LittleFS.exists(PINS_FILE_PATH)) {
    File f = LittleFS.open(PINS_FILE_PATH, "r");
    if (f) {
      JsonDocument doc;
      if (!deserializeJson(doc, f)) {
        JsonArray arr = doc.as<JsonArray>();
        for (JsonObject obj : arr) {
          PinRecord rec;
          rec.pin = obj["pin"].as<String>();
          rec.valid_till = obj["valid_till"].as<uint64_t>();
          pinCache.push_back(rec);
        }
      }
      f.close();
    }
  }
  Serial.printf("[LittleFS] Loaded %d active PINs from flash.\n", (int)pinCache.size());
  xSemaphoreGive(fsMutex);
}

void savePinsToFlashLocked() {
  File f = LittleFS.open("/pins_tmp.json", "w");
  if (!f) return;

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (const auto& rec : pinCache) {
    JsonObject obj = arr.add<JsonObject>();
    obj["pin"] = rec.pin;
    obj["valid_till"] = rec.valid_till;
  }
  serializeJson(doc, f);
  f.close();

  LittleFS.remove(PINS_FILE_PATH);
  LittleFS.rename("/pins_tmp.json", PINS_FILE_PATH);
}

bool upsertPinRecord(const String& pin, uint64_t validTill) {
  xSemaphoreTake(fsMutex, portMAX_DELAY);
  bool updated = false;
  for (auto& rec : pinCache) {
    if (rec.pin == pin) {
      rec.valid_till = validTill;
      updated = true;
      break;
    }
  }
  if (!updated) {
    pinCache.push_back({pin, validTill});
  }
  savePinsToFlashLocked();
  Serial.printf("[PIN] Registered PIN: %s (expires: %llu)\n", pin.c_str(), validTill);
  xSemaphoreGive(fsMutex);
  return true;
}

bool removePinRecord(const String& pin) {
  xSemaphoreTake(fsMutex, portMAX_DELAY);
  for (auto it = pinCache.begin(); it != pinCache.end(); ++it) {
    if (it->pin == pin) {
      pinCache.erase(it);
      break;
    }
  }
  savePinsToFlashLocked();
  Serial.printf("[PIN] Revoked PIN: %s\n", pin.c_str());
  xSemaphoreGive(fsMutex);
  return true;
}

void pruneExpiredPins() {
  if (!isTimeValid) return; // Do not prune if clock is unverified

  uint64_t now = getCurrentEpochUTC();
  if (now < 1700000000ULL) return;

  xSemaphoreTake(fsMutex, portMAX_DELAY);
  bool changed = false;
  for (auto it = pinCache.begin(); it != pinCache.end(); ) {
    if (now > it->valid_till) {
      Serial.printf("[PIN] Expired PIN pruned: %s\n", it->pin.c_str());
      it = pinCache.erase(it);
      changed = true;
    } else {
      ++it;
    }
  }
  if (changed) savePinsToFlashLocked();
  xSemaphoreGive(fsMutex);
}

// Critical rule: Cached PINs will ONLY work after time is entered or synchronized!
bool validatePinInRegister(const String& enteredPin) {
  if (!isTimeValid) {
    Serial.println("[PIN BLOCKED] Time is not set! Cached PINs are blocked until time is established.");
    return false;
  }

  uint64_t now = getCurrentEpochUTC();
  bool valid = false;

  xSemaphoreTake(fsMutex, portMAX_DELAY);
  for (const auto& rec : pinCache) {
    if (rec.pin == enteredPin) {
      if (now <= rec.valid_till) {
        valid = true;
      }
      break;
    }
  }
  xSemaphoreGive(fsMutex);
  return valid;
}

// Reliable Outbox Queueing: creates file if missing, appends safely
void enqueueOutboundEvent(const String& jsonLine) {
  xSemaphoreTake(fsMutex, portMAX_DELAY);
  if (!LittleFS.exists(OUTBOX_FILE_PATH)) {
    File initF = LittleFS.open(OUTBOX_FILE_PATH, "w");
    if (initF) initF.close();
  }
  File f = LittleFS.open(OUTBOX_FILE_PATH, "a");
  if (f) {
    f.println(jsonLine);
    f.close();
    Serial.printf("[OUTBOX] Cached event: %s\n", jsonLine.c_str());
  } else {
    Serial.println("[OUTBOX ERROR] Failed to open /event_outbox.jsonl for writing!");
  }
  xSemaphoreGive(fsMutex);
}

// Flush Outbound Events: Uses BATCH_LOGS to send all cached offline logs at once
void flushOutboundEvents() {
  if (!isServerAuthed) return;

  xSemaphoreTake(fsMutex, portMAX_DELAY);
  if (!LittleFS.exists(OUTBOX_FILE_PATH)) {
    xSemaphoreGive(fsMutex);
    return;
  }

  File f = LittleFS.open(OUTBOX_FILE_PATH, "r");
  std::vector<String> lines;
  if (f) {
    while (f.available()) {
      String line = f.readStringUntil('\n');
      line.trim();
      if (line.length() > 0) lines.push_back(line);
    }
    f.close();
  }
  xSemaphoreGive(fsMutex);

  if (lines.empty()) return;

  Serial.printf("[OUTBOX] Preparing BATCH_LOGS dispatch with %d event(s)...\n", (int)lines.size());

  // Package all pending events into a single BATCH_LOGS payload
  JsonDocument batchDoc;
  batchDoc["type"] = "BATCH_LOGS";
  batchDoc["msg_id"] = generateMsgId();
  batchDoc["space_id"] = SPACE_ID;
  JsonArray arr = batchDoc["events"].to<JsonArray>();

  for (const String& line : lines) {
    JsonDocument itemDoc;
    DeserializationError err = deserializeJson(itemDoc, line);
    if (!err) {
      arr.add(itemDoc);
    }
  }

  String batchStr;
  serializeJson(batchDoc, batchStr);

  if (webSocket.sendTXT(batchStr)) {
    xSemaphoreTake(fsMutex, portMAX_DELAY);
    LittleFS.remove(OUTBOX_FILE_PATH);
    xSemaphoreGive(fsMutex);
    Serial.printf("[OUTBOX] Successfully dispatched and cleared %d offline event(s)!\n", (int)lines.size());
  } else {
    Serial.println("[OUTBOX WARNING] Failed to send BATCH_LOGS over WebSocket. Retrying later.");
  }
}

// ============================================================================
// 7. FLICKER-FREE DIFFERENTIAL LCD RENDERING (20x4 PCF8574 I2C)
// ============================================================================

void initLcdShadow() {
  for (int r = 0; r < 4; r++) {
    for (int c = 0; c < 20; c++) {
      lcdShadowBuffer[r][c] = ' ';
    }
    lcdShadowBuffer[r][20] = '\0';
  }
  lcdShadowInitialized = true;
}

// Differential screen renderer: Writes ONLY changed characters over I2C
void renderLcdFlickerFree(const String& row0, const String& row1, const String& row2, const String& row3) {
  xSemaphoreTake(i2cMutex, portMAX_DELAY);
  if (!lcdShadowInitialized) initLcdShadow();

  String rows[4] = {row0, row1, row2, row3};
  for (int r = 0; r < 4; r++) {
    while (rows[r].length() < 20) rows[r] += ' ';
    if (rows[r].length() > 20) rows[r] = rows[r].substring(0, 20);

    for (int c = 0; c < 20; c++) {
      char ch = rows[r][c];
      if (ch != lcdShadowBuffer[r][c]) {
        lcd.setCursor(c, r);
        if ((uint8_t)ch < 8) {
          lcd.write((uint8_t)ch); // Custom status icon (0..5)
        } else {
          lcd.print(ch);
        }
        lcdShadowBuffer[r][c] = ch;
      }
    }
  }
  xSemaphoreGive(i2cMutex);
}

// NTP Internet Connectivity Verification (Every 30 seconds)
WiFiUDP ntpUdpClient;
const unsigned long NTP_POLL_INTERVAL_MS = 30000UL;
static unsigned long lastNtpPollMs = 0;

void pollNtpInternetStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    isInternetNtpSynced = false;
    return;
  }

  const int NTP_PACKET_SIZE = 48;
  byte packetBuffer[NTP_PACKET_SIZE];
  memset(packetBuffer, 0, NTP_PACKET_SIZE);
  packetBuffer[0] = 0b11100011; // LI 3, Version 4, Mode 3 (Client)
  packetBuffer[1] = 0;
  packetBuffer[2] = 6;
  packetBuffer[3] = 0xEC;

  IPAddress ntpServerIp;
  bool resolved = WiFi.hostByName("pool.ntp.org", ntpServerIp);
  if (!resolved) {
    resolved = WiFi.hostByName("time.google.com", ntpServerIp);
  }
  if (!resolved) {
    isInternetNtpSynced = false;
    return;
  }

  ntpUdpClient.begin(2390);
  ntpUdpClient.beginPacket(ntpServerIp, 123);
  ntpUdpClient.write(packetBuffer, NTP_PACKET_SIZE);
  ntpUdpClient.endPacket();

  uint32_t startWait = millis();
  bool replyReceived = false;
  while (millis() - startWait < 800) {
    int cb = ntpUdpClient.parsePacket();
    if (cb >= NTP_PACKET_SIZE) {
      ntpUdpClient.read(packetBuffer, NTP_PACKET_SIZE);
      unsigned long highWord = word(packetBuffer[40], packetBuffer[41]);
      unsigned long lowWord = word(packetBuffer[42], packetBuffer[43]);
      unsigned long secsSince1900 = (highWord << 16) | lowWord;
      const unsigned long seventyYears = 2208988800UL;
      unsigned long epoch = secsSince1900 - seventyYears;
      if (epoch > 1700000000UL) {
        struct timeval tv = { (time_t)epoch, 0 };
        settimeofday(&tv, NULL);
        isInternetNtpSynced = true;
        isTimeValid = true;
        replyReceived = true;
        Serial.printf("[NTP] 30s NTP poll OK! Internet active. Epoch: %lu\n", epoch);
        break;
      }
    }
    delay(10);
  }
  ntpUdpClient.stop();

  if (!replyReceived) {
    isInternetNtpSynced = false;
    Serial.println("[NTP] 30s NTP poll timeout! Internet unreachable.");
  }
}

// Construct Row 0 with Time, Space Name, and 3 Status Icons in Top-Right
// Col 17: Wi-Fi Icon (Slot 1 for Wi-Fi ON, Slot 3 for Phi / Wi-Fi OFF)
// Col 18: Internet Icon ('I' for online, 'N' for offline)
// Col 19: Server Icon (Slot 2 for Inverted Triangle ON, 'X' for Server OFF)
String buildHeaderRow() {
  char timeStr[6] = "--:--";
  if (isTimeValid) {
    time_t localEpoch = (time_t)(getCurrentEpochUTC() + DISPLAY_TZ_OFFSET_SEC);
    struct tm* timeinfo = gmtime(&localEpoch);
    if (localEpoch > 1700000000L && timeinfo != nullptr) {
      snprintf(timeStr, sizeof(timeStr), "%02d:%02d", timeinfo->tm_hour, timeinfo->tm_min);
    }
  }

  char h[21];
  char spaceNameBuf[11];
  String sName = String(SPACE_ID);
  sName.toUpperCase();
  snprintf(spaceNameBuf, sizeof(spaceNameBuf), "%-10s", sName.substring(0, 10).c_str());

  char netChar  = isWifiConnected ? (char)1 : (char)3;
  char inetChar = isInternetNtpSynced ? 'I' : 'N';
  char srvChar  = isServerAuthed ? (char)2 : 'X';

  snprintf(h, sizeof(h), "%s %s %c%c%c", timeStr, spaceNameBuf, netChar, inetChar, srvChar);
  return String(h);
}

void triggerDoorUnlock10s() {
  digitalWrite(LOCK_PIN, LOCK_STATE_UNLOCKED);
  isDoorUnlocked = true;
  unlockEndMs = millis() + UNLOCK_DURATION_MS;
  Serial.println("[LOCK] Door UNLOCKED for 10 seconds.");
}

// ============================================================================
// 8. ARDUINO NETWORK OTA & SERVER-PULL OTA UPDATERS
// ============================================================================

static bool arduinoOtaInitialized = false;

static inline bool isNetworkOtaAllowedForSlot(uint8_t wifiSlot) {
#if (OTA_SERVER_ONLY_ON_SSID_1 == 1)
  // Slot 0 = WIFI_SSID_1 (Server-Only OTA), Slot 1 = WIFI_SSID_2 (Network ArduinoOTA)
  return (wifiSlot == 1);
#else
  (void)wifiSlot;
  return true;
#endif
}

void setupArduinoOta() {
  if (arduinoOtaInitialized) return;

  ArduinoOTA.setPort(ARDUINO_OTA_PORT);
  ArduinoOTA.setHostname(ARDUINO_OTA_HOSTNAME);

  #if defined(ARDUINO_OTA_PASSWORD)
  if (strlen(ARDUINO_OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(ARDUINO_OTA_PASSWORD);
  }
  #endif

  ArduinoOTA.onStart([]() {
    isOtaInProgress = true;
    String type;
    if (ArduinoOTA.getCommand() == U_FLASH) {
      type = "sketch";
    } else { // U_SPIFFS / U_FS
      type = "filesystem";
      LittleFS.end();
    }
    Serial.println("\n[ArduinoOTA] Flash starting (" + type + ")...");
    renderLcdFlickerFree("** ARDUINO OTA **   ", "Flashing Firmware...", "Please Wait...      ", "Do Not Power Off    ");
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("\n[ArduinoOTA] Firmware update complete! Rebooting...");
    renderLcdFlickerFree("** OTA COMPLETE **  ", "Firmware Updated!   ", "Rebooting Controller", "Please Wait...      ");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static int lastPercent = -1;
    unsigned int pct = (total > 0) ? (progress / (total / 100)) : 0;
    if ((int)pct != lastPercent && pct % 10 == 0) {
      lastPercent = (int)pct;
      Serial.printf("[ArduinoOTA] Progress: %u%%\n", pct);
      char progBuf[21];
      snprintf(progBuf, sizeof(progBuf), "Progress: %3u%%     ", pct);
      renderLcdFlickerFree("** ARDUINO OTA **   ", "Flashing Firmware...", String(progBuf), "Do Not Power Off    ");
    }
  });

  ArduinoOTA.onError([](ota_error_t error) {
    isOtaInProgress = false;
    Serial.printf("[ArduinoOTA] Error[%u]: ", error);
    if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
    else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
    else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
    else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
    else if (error == OTA_END_ERROR) Serial.println("End Failed");

    renderLcdFlickerFree("** OTA ERROR **     ", "Update Aborted      ", "Reverting Safe State", "Ready               ");
    vTaskDelay(pdMS_TO_TICKS(2000));
  });

  ArduinoOTA.begin();
  arduinoOtaInitialized = true;
  Serial.printf("[ArduinoOTA] Network OTA listening on port %d (mDNS: %s.local)\n",
                ARDUINO_OTA_PORT, ARDUINO_OTA_HOSTNAME);
}

void sendProtocolAck(const String& ackId, bool success, const String& errCode = "", const String& detail = "") {
  if (!isServerAuthed) return;
  JsonDocument doc;
  doc["type"] = success ? "ACK" : "NACK";
  doc["ack_id"] = ackId;
  doc["space_id"] = SPACE_ID;
  if (!success) {
    doc["error_code"] = errCode;
    doc["detail"] = detail;
  }
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void executeHttpOtaUpdate() {
  if (pendingOtaUrl.length() == 0 || isDoorUnlocked) return;

  isOtaInProgress = true;
  renderLcdFlickerFree("** FIRMWARE OTA **  ", "Downloading Binary..", "Please Wait...      ", "Do Not Power Off    ");
  WiFiClient client;
  String hostTarget = USE_DOMAIN_NAME ? String(SERVER_DOMAIN) : String(SERVER_LOCAL_IP);
  String fullUrl = String("http://") + hostTarget + ":" + String(SERVER_PORT) + pendingOtaUrl;

  Serial.printf("[OTA] Commencing update from: %s\n", fullUrl.c_str());
  t_httpUpdate_return ret = httpUpdate.update(client, fullUrl);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("[OTA] Update failed: %s\n", httpUpdate.getLastErrorString().c_str());
    sendProtocolAck(pendingOtaMsgId, false, "ERR_OTA_DOWNLOAD_FAIL", httpUpdate.getLastErrorString());
    pendingOtaUrl = "";
    isOtaInProgress = false;
    renderLcdFlickerFree("** OTA FAILED **    ", "Reverting Safe State", "System Online       ", "Ready               ");
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      lastServerRxMs = millis();
      Serial.println("[WS] Connected to WebSocket gateway! Awaiting challenge...");
      break;
    }

    case WStype_DISCONNECTED: {
      Serial.printf("[WS] Disconnected from server (Authed was: %s)\n", isServerAuthed ? "true" : "false");
      if (isServerAuthed && !wasOffline) {
        wasOffline = true;
        offlineStartedEpoch = (uint32_t)getCurrentEpochUTC();
      }
      isServerAuthed = false;
      break;
    }

    case WStype_TEXT: {
      lastServerRxMs = millis();
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) {
        Serial.println("[WS] Malformed JSON received from server.");
        sendProtocolAck("unknown", false, "ERR_MALFORMED_PAYLOAD", "Invalid JSON");
        return;
      }

      String msgType = doc["type"] | "";
      String msgId   = doc["msg_id"] | "";
      Serial.printf("[WS INBOUND] type='%s', msg_id='%s'\n", msgType.c_str(), msgId.c_str());

      // 1. Server Anti-Spoofing Challenge -> Auto-Sync Clock & Reply AUTH_HELLO
      if (msgType == "AUTH_CHALLENGE") {
        String nonce = doc["nonce"] | "";

        uint64_t srvEpoch = doc["server_epoch"] | 0ULL;
        if (srvEpoch > 1700000000ULL) {
          setInternalEpochUTC(srvEpoch);
          isInternetNtpSynced = true;
          isTimeValid = true;
          Serial.printf("[AUTH] Clocks aligned with server epoch: %llu\n", srvEpoch);
        }

        uint64_t ts = getCurrentEpochUTC();
        char tsBuf[32];
        snprintf(tsBuf, sizeof(tsBuf), "%llu", ts);

        String sigInput = String(SPACE_ID) + ":" + nonce + ":" + String(tsBuf);
        String signature = computeHmacSha256Hex(DEVICE_SECRET, sigInput);

        Serial.printf("[AUTH] Challenge received. Signing payload='%s'\n", sigInput.c_str());

        JsonDocument hello;
        hello["type"] = "AUTH_HELLO";
        hello["msg_id"] = generateMsgId();
        hello["space_id"] = SPACE_ID;
        hello["device_id"] = DEVICE_ID;
        hello["device_name"] = DEVICE_NAME;
        hello["timestamp"] = ts;
        hello["firmware_version"] = FIRMWARE_VERSION;
        hello["boot_reason"] = (int)esp_reset_reason();
        hello["mac_address"] = WiFi.macAddress();
        hello["signature"] = signature;

        String out;
        serializeJson(hello, out);
        webSocket.sendTXT(out);
        Serial.println("[AUTH] Dispatched AUTH_HELLO response.");
      }

      // 2. Authentication Confirmed -> Server Link Active
      else if (msgType == "AUTH_ACK") {
        isServerAuthed = true;
        isInternetNtpSynced = true;
        isTimeValid = true;
        lastServerRxMs = millis();
        Serial.println("[AUTH] AUTH_ACK received! ESP32 successfully authenticated & registered online.");

        isLockDisabled = doc["is_disabled"] | false;
        String disEmail = doc["disabled_by_email"] | "";
        if (disEmail.length() == 0) {
          disEmail = doc["admin_email"] | "";
        }
        disabledByEmail = disEmail;
        if (isLockDisabled) {
          Serial.printf("[LOCK] Current lock status: DISABLED by %s\n", disabledByEmail.c_str());
        }

        uint64_t srvEpoch = doc["server_epoch"] | 0ULL;
        if (srvEpoch > 1700000000ULL) {
          setInternalEpochUTC(srvEpoch);
        }

        if (wasOffline) {
          uint64_t now = getCurrentEpochUTC();
          uint32_t downSec = (now > offlineStartedEpoch) ? (uint32_t)(now - offlineStartedEpoch) : 0;
          JsonDocument rec;
          rec["type"] = "NETWORK_RECOVERED";
          rec["msg_id"] = generateMsgId();
          rec["space_id"] = SPACE_ID;
          rec["offline_duration_sec"] = downSec;
          rec["timestamp"] = now;
          String recOut;
          serializeJson(rec, recOut);
          enqueueOutboundEvent(recOut);
          wasOffline = false;
        }

        // Authoritative PIN synchronization if pins array is included in AUTH_ACK
        if (doc["pins"].is<JsonArray>()) {
          JsonArray pinsArr = doc["pins"].as<JsonArray>();
          xSemaphoreTake(fsMutex, portMAX_DELAY);
          pinCache.clear();
          for (JsonObject obj : pinsArr) {
            PinRecord rec;
            rec.pin = obj["pin"].as<String>();
            rec.valid_till = obj["valid_till"] | 0ULL;
            if (rec.pin.length() == 6 && rec.valid_till > 0) {
              pinCache.push_back(rec);
            }
          }
          savePinsToFlashLocked();
          Serial.printf("[AUTH_ACK] Authoritative PIN sync complete: %d valid PIN(s) cached in flash.\n", (int)pinCache.size());
          xSemaphoreGive(fsMutex);
        }

        // Flush all cached offline events in batch upon successful reconnect
        flushOutboundEvents();
      }

      // Root Admin Disable / Enable Lock Commands
      else if (msgType == "LOCK_DISABLED") {
        isLockDisabled = true;
        disabledByEmail = doc["admin_email"] | "";
        sendProtocolAck(msgId, true);
        Serial.printf("[LOCK] Lock disabled by Root Admin: %s\n", disabledByEmail.c_str());
      }

      else if (msgType == "LOCK_ENABLED") {
        isLockDisabled = false;
        disabledByEmail = "";
        sendProtocolAck(msgId, true);
        Serial.println("[LOCK] Lock re-enabled by Root Admin.");
      }

      else if (msgType == "NACK") {
        String errCode = doc["error_code"] | "ERR_UNKNOWN";
        String detail  = doc["detail"] | "Authentication failed";
        Serial.printf("[WS NACK ERROR] %s: %s\n", errCode.c_str(), detail.c_str());
      }

      // 3. New PIN Dispatched -> Store in Flash
      else if (msgType == "ADD_PIN") {
        String pin = doc["pin"] | "";
        uint64_t validTill = doc["valid_till"] | 0ULL;
        if (pin.length() == 6 && validTill > 0) {
          upsertPinRecord(pin, validTill);
          sendProtocolAck(msgId, true);
        } else {
          sendProtocolAck(msgId, false, "ERR_MALFORMED_PAYLOAD", "Invalid pin or valid_till");
        }
      }

      // 4. PIN Revoked -> Remove from Flash
      else if (msgType == "REVOKE_PIN") {
        String pin = doc["pin"] | "";
        if (pin.length() == 6) {
          removePinRecord(pin);
          sendProtocolAck(msgId, true);
        } else {
          sendProtocolAck(msgId, false, "ERR_MALFORMED_PAYLOAD", "Invalid pin for revocation");
        }
      }

      // 4a. PURGE_PINS: Clear all cached PINs immediately from RAM and Flash
      else if (msgType == "PURGE_PINS" || msgType == "CLEAR_ALL_PINS") {
        xSemaphoreTake(fsMutex, portMAX_DELAY);
        pinCache.clear();
        savePinsToFlashLocked();
        LittleFS.remove(PINS_FILE_PATH);
        Serial.println("[PURGE_PINS] All cached PINs purged from ESP32 RAM and Flash.");
        xSemaphoreGive(fsMutex);
        sendProtocolAck(msgId, true);
      }

      // 4b. Full Authoritative PIN Synchronization from Server
      else if (msgType == "SYNC_PINS") {
        JsonArray pinsArr = doc["pins"].as<JsonArray>();
        xSemaphoreTake(fsMutex, portMAX_DELAY);
        pinCache.clear();
        for (JsonObject obj : pinsArr) {
          PinRecord rec;
          rec.pin = obj["pin"].as<String>();
          rec.valid_till = obj["valid_till"] | 0ULL;
          if (rec.pin.length() == 6 && rec.valid_till > 0) {
            pinCache.push_back(rec);
          }
        }
        savePinsToFlashLocked();
        if (pinCache.empty()) {
          LittleFS.remove(PINS_FILE_PATH);
        }
        Serial.printf("[SYNC_PINS] Authoritative PIN sync complete: %d valid PIN(s) cached in flash.\n", (int)pinCache.size());
        xSemaphoreGive(fsMutex);
        sendProtocolAck(msgId, true);
      }

      // 4c. Server Requested Offline Logs
      else if (msgType == "REQUEST_LOGS") {
        Serial.println("[WS] Server requested offline logs. Flushing outbox...");
        flushOutboundEvents();
        sendProtocolAck(msgId, true);
      }

      // 5. Server Heartbeat / Ping -> Reply PONG
      else if (msgType == "PING") {
        JsonDocument pong;
        pong["type"] = "PONG";
        pong["ack_id"] = msgId;
        pong["space_id"] = SPACE_ID;
        pong["timestamp"] = getCurrentEpochUTC();
        pong["cached_pins"] = (int)pinCache.size();
        pong["free_heap"] = ESP.getFreeHeap();
        String out;
        serializeJson(pong, out);
        webSocket.sendTXT(out);
      }

      // 6. Server Event ACK
      else if (msgType == "ACK") {
        Serial.println("[WS] Server acknowledged transaction.");
      }

      // 7. OTA Firmware Update
      else if (msgType == "OTA_UPDATE") {
        pendingOtaUrl = doc["url"] | "";
        pendingOtaSha256 = doc["sha256"] | "";
        pendingOtaMsgId = msgId;
        sendProtocolAck(msgId, true);
        Serial.printf("[OTA] Queued firmware update: %s\n", pendingOtaUrl.c_str());
      }
      break;
    }

    default:
      break;
  }
}

// ============================================================================
// 9. FREERTOS TASK 1 (CORE 1): REAL-TIME KEYPAD, EXIT BUTTON, LOCK & SMART LCD
// ============================================================================
void TaskHardwareIO(void* pvParameters) {
  SystemUIMode currentMode   = MODE_NORMAL_PIN;
  String enteredPin          = "";
  String statusBanner        = "";
  uint32_t statusResetMs     = 0;
  uint32_t lastLcdRefreshMs  = 0;

  // Manual Time Input Mode State
  String clockInputDigits    = "";
  String clockFeedbackMsg    = "";
  uint32_t clockMsgResetMs   = 0;

  bool keyPressedLockout     = false;
  uint32_t lastKeyChangeMs   = 0;
  bool lastExitBtnState      = HIGH;

  for (;;) {
    uint32_t nowMs = millis();

    // Yield and protect display when Over-The-Air firmware flashing is active
    if (isOtaInProgress) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    // A. Check for 3-Minute Powerloss Condition -> Prompt Manual Time Entry
    // If after 3 minutes (180,000 ms) time has not been established via server or NTP:
    if (!isTimeValid && !isServerAuthed && !clockPromptTriggered) {
      if (bootTimestampMs > 0 && (nowMs - bootTimestampMs >= OFFLINE_CLOCK_PROMPT_MS)) {
        currentMode = MODE_CLOCK_INPUT;
        clockPromptTriggered = true;
        clockInputDigits = "";
        clockFeedbackMsg = "";
        Serial.println("[SYSTEM] Offline > 3 mins after powerloss! Prompting manual time entry for offline TOTP & cached PINs.");
      }
    }

    // Auto-exit clock prompt if server connects or time becomes valid
    if (currentMode == MODE_CLOCK_INPUT && (isServerAuthed || isTimeValid)) {
      currentMode = MODE_NORMAL_PIN;
      statusBanner = "";
    }

    // B. Enforce 10-Second Fail-Safe Unlock Timer
    if (isDoorUnlocked && (int32_t)(nowMs - unlockEndMs) >= 0) {
      digitalWrite(LOCK_PIN, LOCK_STATE_LOCKED);
      isDoorUnlocked = false;
      statusBanner = "";
      statusResetMs = 0;
    }

    // C. Indoor Exit Push-Button (Active LOW with debounce)
    bool exitBtn = digitalRead(EXIT_BUTTON_PIN);
    if (lastExitBtnState == HIGH && exitBtn == LOW) {
      vTaskDelay(pdMS_TO_TICKS(35));
      if (digitalRead(EXIT_BUTTON_PIN) == LOW) {
        triggerDoorUnlock10s();
        enteredPin = "";
        statusBanner = "DOOR UNLOCKED";
        statusResetMs = nowMs + 10000UL;

        JsonDocument ev;
        ev["type"] = "EXIT_BUTTON";
        ev["msg_id"] = generateMsgId();
        ev["space_id"] = SPACE_ID;
        ev["device_id"] = DEVICE_ID;
        ev["timestamp"] = getCurrentEpochUTC();
        String jsonStr;
        serializeJson(ev, jsonStr);

        if (isServerAuthed) {
          if (!webSocket.sendTXT(jsonStr)) enqueueOutboundEvent(jsonStr);
        } else {
          enqueueOutboundEvent(jsonStr);
        }
      }
    }
    lastExitBtnState = exitBtn;

    // D. Scan 4x4 PCF8574 Matrix Keypad
    xSemaphoreTake(i2cMutex, portMAX_DELAY);
    uint8_t rawKeyIdx = keyPad.getKey();
    xSemaphoreGive(i2cMutex);

    if (rawKeyIdx == I2C_KEYPAD_NOKEY) {
      if (keyPressedLockout && (nowMs - lastKeyChangeMs >= 50UL)) {
        keyPressedLockout = false;
      }
    } else if (rawKeyIdx < 16 && !keyPressedLockout && (nowMs - lastKeyChangeMs >= 50UL)) {
      keyPressedLockout = true;
      lastKeyChangeMs = nowMs;
      char key = KEYMAP[rawKeyIdx];

      // ======================================================================
      // KEYPAD MODE 1: MANUAL DATE/TIME SETUP (YYYY-MM-DD HH:MM:SS)
      // ======================================================================
      if (currentMode == MODE_CLOCK_INPUT) {
        if (key >= '0' && key <= '9') {
          if (clockInputDigits.length() < 14) {
            clockInputDigits += key;
            clockFeedbackMsg = "";
          }
        } else if (key == '*' || key == 'C') {
          if (clockInputDigits.length() > 0) {
            clockInputDigits.remove(clockInputDigits.length() - 1);
            clockFeedbackMsg = "";
          } else {
            // Dismiss clock set prompt and return to normal PIN mode
            currentMode = MODE_NORMAL_PIN;
            statusBanner = "TIME NOT SET";
            statusResetMs = nowMs + 3000UL;
          }
        } else if (key == '#' || key == 'D') {
          // Validate 14 digits
          if (clockInputDigits.length() < 14) {
            clockFeedbackMsg = "Need 14 Digits!";
            clockMsgResetMs = nowMs + 2500UL;
          } else {
            int y, m, d, hr, min, sec;
            if (!parseAndValidateDateTime14(clockInputDigits, y, m, d, hr, min, sec)) {
              clockFeedbackMsg = "Invalid Date/Time!";
              clockMsgResetMs = nowMs + 2500UL;
            } else {
              uint64_t localEpoch = computeEpochFromDateTime(y, m, d, hr, min, sec);
              uint64_t utcEpoch = (localEpoch >= DISPLAY_TZ_OFFSET_SEC) ? (localEpoch - DISPLAY_TZ_OFFSET_SEC) : localEpoch;

              setInternalEpochUTC(utcEpoch);
              isClockManualSet = true;
              isTimeValid = true;

              Serial.printf("[CLOCK] Manual time accepted: %04d-%02d-%02d %02d:%02d:%02d -> UTC Epoch: %llu\n",
                            y, m, d, hr, min, sec, utcEpoch);

              renderLcdFlickerFree("** SET SYSTEM TIME **", "YYYY-MM-DD HH:MM:SS ", formatDateTimeForLcd(clockInputDigits), "[ TIME SET OK! ]    ");
              vTaskDelay(pdMS_TO_TICKS(1800));

              currentMode = MODE_NORMAL_PIN;
              statusBanner = "CLOCK CONFIGURED";
              statusResetMs = nowMs + 3000UL;
            }
          }
        }
      }

      // ======================================================================
      // KEYPAD MODE 2: STANDARD 6-DIGIT PIN & OFFLINE MASTER TOTP ACCESS
      // ======================================================================
      else {
        if (key >= '0' && key <= '9') {
          if (enteredPin.length() < 6) {
            enteredPin += key;
          }

          if (enteredPin.length() == 6) {
            // LOCK DISABLED MODE: Accepts ONLY Emergency Master TOTP!
            if (isLockDisabled) {
              bool isMasterTotp = verifyEmergencyTotp(enteredPin, getCurrentEpochUTC(), TOTP_TIME_STEP_SEC);
              if (isMasterTotp) {
                triggerDoorUnlock10s();
                statusBanner = "EMERGENCY PASS";
                statusResetMs = nowMs + 10000UL;
              } else {
                statusBanner = "LOCK IS DISABLED";
                statusResetMs = nowMs + 3000UL;
              }

              // Build and record event (send live or cache offline)
              JsonDocument ev;
              ev["type"] = "PIN_ATTEMPT";
              ev["msg_id"] = generateMsgId();
              ev["space_id"] = SPACE_ID;
              ev["device_id"] = DEVICE_ID;
              ev["pin"] = enteredPin;
              ev["present_in_register"] = false;
              ev["is_emergency_totp"] = isMasterTotp;
              ev["door_unlocked"] = isMasterTotp;
              ev["is_lock_disabled"] = true;
              ev["timestamp"] = getCurrentEpochUTC();
              String jsonStr;
              serializeJson(ev, jsonStr);

              if (isServerAuthed) {
                if (!webSocket.sendTXT(jsonStr)) enqueueOutboundEvent(jsonStr);
              } else {
                enqueueOutboundEvent(jsonStr);
              }

              enteredPin = "";
            }
            // SECURITY CHECK: Cached PINs will ONLY work after time is entered or synced!
            else if (!isTimeValid) {
              Serial.println("[ACCESS DENIED] Time is not set! Cached PINs are blocked until time is established.");
              statusBanner = "TIME NOT SET";
              statusResetMs = nowMs + 3000UL;
              enteredPin = "";
            } else {
              // Step 1: Check in-memory Flash PIN cache (Student / SuperUser PIN)
              bool matched = validatePinInRegister(enteredPin);
              bool isMasterTotp = false;

              // Step 2: If normal PIN fails, verify against Emergency Master TOTP
              if (!matched) {
                matched = verifyEmergencyTotp(enteredPin, getCurrentEpochUTC(), TOTP_TIME_STEP_SEC);
                if (matched) isMasterTotp = true;
              }

              if (matched) {
                triggerDoorUnlock10s();
                if (isMasterTotp) {
                  statusBanner = "EMERGENCY PASS";
                } else {
                  statusBanner = "ACCESS GRANTED";
                }
                statusResetMs = nowMs + 10000UL;
              } else {
                statusBanner = "ACCESS DENIED";
                statusResetMs = nowMs + 3000UL;
              }

              // Build and record event (send live or cache offline)
              JsonDocument ev;
              ev["type"] = "PIN_ATTEMPT";
              ev["msg_id"] = generateMsgId();
              ev["space_id"] = SPACE_ID;
              ev["device_id"] = DEVICE_ID;
              ev["pin"] = enteredPin;
              ev["present_in_register"] = matched;
              ev["is_emergency_totp"] = isMasterTotp;
              ev["door_unlocked"] = matched;
              ev["timestamp"] = getCurrentEpochUTC();
              String jsonStr;
              serializeJson(ev, jsonStr);

              if (isServerAuthed) {
                if (!webSocket.sendTXT(jsonStr)) enqueueOutboundEvent(jsonStr);
              } else {
                enqueueOutboundEvent(jsonStr);
              }

              enteredPin = "";
            }
          }
        } else if (key == '*' || key == 'C') {
          enteredPin = "";
          statusBanner = "INPUT CLEARED";
          statusResetMs = nowMs + 1200UL;
        } else if (key == '#' || key == 'D') {
          // Manual trigger to enter Clock Setup mode if offline and time unverified
          if (!isServerAuthed && !isTimeValid) {
            currentMode = MODE_CLOCK_INPUT;
            clockInputDigits = "";
            clockFeedbackMsg = "";
          }
        }
      }
    }

    // Auto-clear transient feedback banners
    if (clockMsgResetMs > 0 && (int32_t)(nowMs - clockMsgResetMs) >= 0) {
      clockFeedbackMsg = "";
      clockMsgResetMs = 0;
    }

    if (!isDoorUnlocked && statusResetMs > 0 && (int32_t)(nowMs - statusResetMs) >= 0) {
      statusBanner = "";
      statusResetMs = 0;
    }

    // E. Refresh 20x4 I2C LCD Using Flicker-Free Differential Rendering Every 200ms
    if (nowMs - lastLcdRefreshMs >= 200UL) {
      lastLcdRefreshMs = nowMs;

      if (currentMode == MODE_CLOCK_INPUT) {
        String r0 = "** SET SYSTEM TIME **";
        String r1 = "YYYY-MM-DD HH:MM:SS ";
        String r2 = formatDateTimeForLcd(clockInputDigits);
        String r3 = clockFeedbackMsg.length() > 0 ? clockFeedbackMsg : "*:Back/Esc   #:Save ";
        renderLcdFlickerFree(r0, r1, r2, r3);
      } else {
        // Row 0: First row remains identical (Time, Space Slug, 3 Status Icons in Top-Right)
        String r0 = buildHeaderRow();

        // Row 1: Second row shows state of the machine
        String r1;
        if (statusResetMs > 0 && statusBanner.length() > 0) {
          r1 = statusBanner;
        } else if (isLockDisabled) {
          if (disabledByEmail.length() > 0 && ((nowMs / 2500UL) % 2 == 1)) {
            r1 = disabledByEmail;
          } else {
            r1 = "LOCK IS DISABLED";
          }
        } else if (!isTimeValid && !isServerAuthed) {
          r1 = (nowMs - bootTimestampMs < OFFLINE_CLOCK_PROMPT_MS) ? "Connecting Server..." : "Time Set Required";
        } else {
          r1 = isServerAuthed ? "System Online" : "Offline Cache Mode";
        }

        // Row 2: Third row should be 'Enter PIN:'
        String r2 = "Enter PIN:";

        // Row 3: Fourth row displays entered digits separated by spaces with '_' bottom cursor placeholders
        String r3 = "";
        for (int i = 0; i < 6; i++) {
          if (i < (int)enteredPin.length()) {
            r3 += enteredPin[i];
          } else {
            r3 += '_';
          }
          if (i < 5) {
            r3 += ' ';
          }
        }

        renderLcdFlickerFree(r0, r1, r2, r3);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(15));
  }
}

// ============================================================================
// 10. FREERTOS TASK 2 (CORE 0): DUAL WI-FI, DNS RESOLUTION, NTP & WEBSOCKET
// ============================================================================
void TaskNetworkSync(void* pvParameters) {
  uint32_t lastWifiAttemptMs = 0;
  uint32_t lastPinPruneMs    = 0;
  uint32_t lastOutboxPushMs  = 0;
  uint32_t lastPriorityScanMs= 0;
  bool isScanInProgress      = false;
  bool wsInitialized         = false;
  uint8_t currentWifiSlot    = 1; // Start with Priority Slot 1 (WIFI_SSID_2), fallback to Slot 0 (WIFI_SSID_1)

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false); // Managed explicitly for dual-network failover

  Serial.printf("[WIFI] Initializing Station Mode. Attempting Priority SSID: %s\n", WIFI_SSID_2);
  WiFi.begin(WIFI_SSID_2, WIFI_PASSWORD_2);
  lastWifiAttemptMs = millis();

  for (;;) {
    uint32_t nowMs = millis();

    // A. Dual Wi-Fi Failover Manager
    bool wifiNow = (WiFi.status() == WL_CONNECTED);
    if (wifiNow && !isWifiConnected) {
      isWifiConnected = true;
      Serial.printf("[WIFI] Connected successfully to Slot %d! IP: %s | RSSI: %d dBm\n",
                    currentWifiSlot + 1, WiFi.localIP().toString().c_str(), WiFi.RSSI());

      // Attempt NTP synchronization in background
      configTime(0, 0, "pool.ntp.org", "time.google.com");

      // Configure OTA mode based on connected SSID and OTA_SERVER_ONLY_ON_SSID_1 macro
      if (isNetworkOtaAllowedForSlot(currentWifiSlot)) {
        setupArduinoOta();
      } else {
        if (arduinoOtaInitialized) {
          ArduinoOTA.end();
          arduinoOtaInitialized = false;
        }
        Serial.println("[OTA] Server-only OTA mode active on SSID_1 (ArduinoOTA disabled).");
      }

      // Resolve Target Server Host (Domain DNS or Direct Local IP)
      String targetHost = SERVER_LOCAL_IP;
      if (USE_DOMAIN_NAME) {
        IPAddress resolvedIp;
        Serial.printf("[DNS] Resolving domain name '%s'...\n", SERVER_DOMAIN);
        if (WiFi.hostByName(SERVER_DOMAIN, resolvedIp)) {
          targetHost = resolvedIp.toString();
          Serial.printf("[DNS] Successfully resolved domain to IP: %s\n", targetHost.c_str());
        } else {
          Serial.printf("[DNS] Warning: Resolution failed for '%s'. Using raw host.\n", SERVER_DOMAIN);
          targetHost = SERVER_DOMAIN;
        }
      } else {
        Serial.printf("[NET] Configured for direct Local IP: %s\n", targetHost.c_str());
      }

      if (!wsInitialized) {
        Serial.printf("[WS] Connecting to %s://%s:%d%s\n",
                      SERVER_USE_SSL ? "wss" : "ws", targetHost.c_str(), SERVER_PORT, WS_PATH);

        if (SERVER_USE_SSL) {
          webSocket.beginSSL(targetHost.c_str(), SERVER_PORT, WS_PATH);
        } else {
          webSocket.begin(targetHost.c_str(), SERVER_PORT, WS_PATH);
        }
        webSocket.onEvent(onWebSocketEvent);
        webSocket.setReconnectInterval(3000);
        wsInitialized = true;
      }
    } else if (!wifiNow && isWifiConnected) {
      isWifiConnected = false;
      isServerAuthed = false;
      isInternetNtpSynced = false;
      Serial.println("[WIFI] Connection lost! Entering offline resilience mode.");
      if (!wasOffline) {
        wasOffline = true;
        offlineStartedEpoch = (uint32_t)getCurrentEpochUTC();
      }
    }

    // Priority Wi-Fi Roaming: When connected to fallback SSID_1, continuously scan and switch to SSID_2
    if (wifiNow && currentWifiSlot == 0) {
      if (!isScanInProgress && (nowMs - lastPriorityScanMs >= WIFI_PRIORITY_SCAN_INTERVAL_MS)) {
        lastPriorityScanMs = nowMs;
        isScanInProgress = true;
        WiFi.scanNetworks(true, false); // Non-blocking background scan
      }

      if (isScanInProgress) {
        int16_t scanResult = WiFi.scanComplete();
        if (scanResult >= 0) {
          isScanInProgress = false;
          bool foundPrioritySsid = false;
          for (int i = 0; i < scanResult; i++) {
            if (WiFi.SSID(i) == WIFI_SSID_2) {
              foundPrioritySsid = true;
              break;
            }
          }
          WiFi.scanDelete();

          if (foundPrioritySsid) {
            Serial.printf("[WIFI] Priority SSID_2 '%s' detected! Roaming from SSID_1 to SSID_2...\n", WIFI_SSID_2);
            WiFi.disconnect();
            currentWifiSlot = 1;
            WiFi.begin(WIFI_SSID_2, WIFI_PASSWORD_2);
            lastWifiAttemptMs = nowMs;
            isWifiConnected = false;
            isServerAuthed = false;
          }
        } else if (scanResult == -2) {
          isScanInProgress = false;
        }
      }
    } else if (!wifiNow) {
      isScanInProgress = false;
    }

    // Reconnection Failover Logic (when disconnected, alternate between both SSIDs)
    if (!wifiNow && (nowMs - lastWifiAttemptMs >= WIFI_FAILOVER_TIMEOUT_MS)) {
      lastWifiAttemptMs = nowMs;
      currentWifiSlot = (currentWifiSlot == 0) ? 1 : 0; // Alternate between Slot 0 (SSID_1) and Slot 1 (SSID_2)

      const char* nextSsid = (currentWifiSlot == 0) ? WIFI_SSID_1 : WIFI_SSID_2;
      const char* nextPass = (currentWifiSlot == 0) ? WIFI_PASSWORD_1 : WIFI_PASSWORD_2;

      Serial.printf("[WIFI] Switching to network Slot %d: SSID '%s'\n", currentWifiSlot + 1, nextSsid);
      WiFi.disconnect();
      WiFi.begin(nextSsid, nextPass);
    }

    // Check NTP Internet Connectivity & Sync regularly every 30 seconds
    if (wifiNow && (nowMs - lastNtpPollMs >= NTP_POLL_INTERVAL_MS || lastNtpPollMs == 0)) {
      lastNtpPollMs = nowMs;
      pollNtpInternetStatus();
    }

    // B. Service WebSocket & Local Link
    if (isWifiConnected && wsInitialized) {
      webSocket.loop();

      uint32_t currentMs = millis();
      if (isServerAuthed && lastServerRxMs > 0 && (currentMs >= lastServerRxMs) && (currentMs - lastServerRxMs > SERVER_PING_TIMEOUT_MS)) {
        Serial.println("[WS] Server ping timeout (6 min). Forcing socket reconnect.");
        isServerAuthed = false;
        lastServerRxMs = currentMs;
        webSocket.disconnect();
      }
    }

    // C. Purge Expired Flash PINs Every 15s & Flush Outbox Every 5s
    if (nowMs - lastPinPruneMs >= 15000UL) {
      lastPinPruneMs = nowMs;
      pruneExpiredPins();
    }
    if (isServerAuthed && (nowMs - lastOutboxPushMs >= 5000UL)) {
      lastOutboxPushMs = nowMs;
      flushOutboundEvents();
    }

    // D. Service ArduinoOTA Wireless Network Flashing (only when allowed for current SSID)
    if (wifiNow && isNetworkOtaAllowedForSlot(currentWifiSlot) && arduinoOtaInitialized) {
      ArduinoOTA.handle();
    }

    // E. Execute OTA Binary Download When Door Is Safely Locked
    if (pendingOtaUrl.length() > 0 && !isDoorUnlocked) {
      executeHttpOtaUpdate();
    }

    vTaskDelay(pdMS_TO_TICKS(15));
  }
}

// ============================================================================
// 11. ARDUINO SETUP & LOOP ENTRY POINTS
// ============================================================================
void setup() {
  bootTimestampMs = millis();

  // 1. Diagnostics Serial Link
  Serial.begin(115200);
  delay(200);
  Serial.println("\n\n========================================");
  Serial.println("  PANDA ESP32-WROOM Hardware Controller  ");
  Serial.printf("  Firmware: %s | Space: %s\n", FIRMWARE_VERSION, SPACE_ID);
  Serial.println("========================================");

  // 2. Engage fail-safe door lock immediately (HIGH = Locked)
  pinMode(LOCK_PIN, OUTPUT);
  digitalWrite(LOCK_PIN, LOCK_STATE_LOCKED);
  pinMode(EXIT_BUTTON_PIN, INPUT_PULLUP);

  // 3. Create FreeRTOS synchronization mutexes
  fsMutex  = xSemaphoreCreateMutex();
  i2cMutex = xSemaphoreCreateMutex();

  // 4. Mount LittleFS partition & cache stored PINs
  if (!LittleFS.begin(true)) {
    Serial.println("[LittleFS] Partition mount failed, formatting...");
    LittleFS.format();
    LittleFS.begin(true);
  }
  loadPinsFromFlash();

  // 5. Initialize I2C bus, 20x4 LCD, and I2C Matrix Keypad
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);

  lcd.init();
  lcd.backlight();
  lcd.createChar(1, ICON_WIFI);
  lcd.createChar(2, ICON_INV_TRIANGLE);
  lcd.createChar(3, ICON_PHI);

  keyPad.begin();
  initLcdShadow();

  renderLcdFlickerFree("PANDA Booting...    ", "Loading Flash PINs  ", "Initializing...     ", "Please Wait         ");

  // 6. Pin Tasks to ESP32 Dual Cores
  xTaskCreatePinnedToCore(TaskHardwareIO,  "HardwareIO",  6144,  nullptr, 2, nullptr, 1);
  xTaskCreatePinnedToCore(TaskNetworkSync, "NetworkSync", 10240, nullptr, 1, nullptr, 0);

  Serial.println("[SYSTEM] Hardware tasks initialized and pinned to dual cores.");
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}
