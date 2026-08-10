/* =======================================================================
   電子紙桌曆 — 版面A（整月月曆）+ Google 行事曆 + 繁體中文
   ★ 勤輪詢 + 只有「內容有變」才刷屏（新增行程幾分鐘內就更新）
   ★ 白底黑字；星期列/日期數字 16px 加粗、行程 14px 加粗；今天用紅色橫條
   -----------------------------------------------------------------------
   硬體：Waveshare 7.5" e-Paper (B) 三色 800x480 + e-Paper ESP32 Driver Board
   函式庫：GxEPD2、Adafruit GFX、ArduinoJson(7.x)、U8g2_for_Adafruit_GFX
   開發板：ESP32 Dev Module
   分割區：工具→Partition Scheme 選「Huge APP (3MB No OTA)」← 中文字型較大，必選
   ======================================================================= */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <SPI.h>

#define ENABLE_GxEPD2_GFX 0
#include <GxEPD2_3C.h>
#include <U8g2_for_Adafruit_GFX.h>
#include "TradFont.h"   // 繁體中文字型（trad14 行程 / trad16 星期・日期・標題）
#include "Lunar.h"      // 農曆換算表（1900-2098，已逐日比對過）

/* ========== ① 你一定要改的設定 ========== */
const char*    WIFI_SSID       = "BWLinksys-2.4G";       // 只能 2.4GHz
const char*    WIFI_PASSWORD   = "bw16112945";
const char*    SCRIPT_URL      = "https://script.google.com/macros/s/AKfycbyfbxCY7N1-mqkVWKE4QZVmGgxkNzABQS2aIftCU86pHb6A6vWceoewkL2pGazcyZVA/exec";  // 結尾是 /exec
const uint64_t REFRESH_MINUTES = 1;                  // 每幾分鐘檢查一次（插電可設短，如 5）

/* 農曆：顯示在日期數字右邊。
   ★ 會用到「初 廿 正 閏 七 八 九 十」這些字，TradFont.h 若沒收就畫不出來，
     程式會自動偵測（u8g2 對缺字回傳 0 寬度）並退回顯示阿拉伯數字，不會變成空白。 */
const bool SHOW_LUNAR = true;

/* ========== 螢幕腳位（ESP32 Driver Board 固定，照抄） ========== */
#define EPD_CS   15
#define EPD_DC   27
#define EPD_RST  26
#define EPD_BUSY 25
#define EPD_SCK  13
#define EPD_MOSI 14

/* 7.5" 三色 800x480 —— 用 Z08（實測這顆面板正確、會刷新）。
   第二個參數用 HEIGHT/4 = 分頁繪製，省 RAM（避免 DRAM 溢位）。RAM 還是不夠可再改 /8 */
GxEPD2_3C<GxEPD2_750c_Z08, GxEPD2_750c_Z08::HEIGHT / 4> display(
    GxEPD2_750c_Z08(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
U8G2_FOR_ADAFRUIT_GFX u8g2Fonts;

/* ========== 版面常數 ========== */
const int W = 800, H = 480;
const int HEAD_H = 42;   // 標題列高（原 58；標題往上貼齊後省下的高度還給日期格）
const int DOW_H  = 26;   // 星期列高（原 30）

/* 標題字級：月份數字用 Adafruit GFX 內建字型放大畫，
   因為 TradFont.h 只做了 14/16px 兩種，中文字型放不大。
   內建字型一格是 6x8，乘上倍數就是實際像素：4 -> 24x32、3 -> 18x24 */
const int TITLE_TOP   = 2;   // 標題距畫面頂端
const int MONTH_SCALE = 4;   // 月份數字倍率（想更大改 5，但要一起把 HEAD_H 加大）
const int YEAR_SCALE  = 3;   // 年份數字倍率

/* ---- 每格行程的排版 ----
   注意：TradFont.h 只有 14px / 16px 兩種中文字型，字級不能再更小，
   所以三行是靠「壓薄日期橫條 + 縮行距」擠出來的，已經是 68px 格高的極限。
   真的想要更小的字，得重新產一份 12px 的 TradFont.h */
const int EVENT_LINES  = 3;   // 每格最多顯示幾行行程（超過的算進 +N）
const int DATE_BAND_H  = 20;  // 日期數字那一條的高度（今天是紅底），原本 24
const int EVENT_TOP    = 34;  // 第一行行程的基線，相對格子頂端
const int EVENT_LINE_H = 16;  // 行程行距，原本 18（要搭配 drawText 的透明模式才不會互相蓋到）

/* ========== 行事曆資料 ========== */
struct DayCell { uint8_t count; String t[EVENT_LINES]; bool hot[EVENT_LINES]; };
DayCell gDays[32];
int    gYear = 2026, gMonth = 7, gToday = 15;
String gUpdated = "--:--";

/* 連續行程（如 8/18~8/20）的第二天起要加的前綴。
   注意：這裡的字必須是 TradFont.h 有收的字元，用 ASCII 最保險。
   想改成 "↳"、"‧" 之類的符號，請先確認字型檔有該字，否則會變成空白或豆腐格 */
const char* CONT_PREFIX = "> ";

int daysInMonth(int y, int m);          // 定義在下面，fetchCalendar() 先用到

/* 內容簽章：深度睡眠也保留，用來判斷「行程有沒有變」 */
RTC_DATA_ATTR uint32_t gLastSig = 0;

uint32_t fnv1a(const String& s){
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < s.length(); i++){ h ^= (uint8_t)s[i]; h *= 16777619u; }
  return h;
}

/* 判斷「重要」行程：標題以 ★ 或 * 開頭，或含關鍵字 → 顯示紅色。可自行增減 */
bool isImportant(const String& s){
  if (s.startsWith("★") || s.startsWith("*")) return true;
  const char* kw[] = {"生日", "截止", "繳費", "面試", "結婚", "紀念", "考試"};
  for (const char* k : kw) if (s.indexOf(k) >= 0) return true;
  return false;
}
String cleanTitle(String s){
  if (s.startsWith("★"))      s = s.substring(String("★").length());
  else if (s.startsWith("*")) s = s.substring(1);
  s.trim();
  return s;
}

/* 把一筆行程塞進某一天。塞滿 EVENT_LINES 行之後只記數量（畫面上會顯示 +N） */
void addToDay(int d, const String& label, bool hot){
  if (d < 1 || d > 31) return;
  DayCell& c = gDays[d];
  if (c.count < EVENT_LINES){ c.t[c.count] = label; c.hot[c.count] = hot; }
  c.count++;
}

/* ========== 抓 Google 行事曆
   回傳： 1 = 內容有變（要刷屏）  0 = 沒變（跳過刷屏）  -1 = 抓取失敗 ========== */
int fetchCalendar(){
  WiFiClientSecure client;
  client.setInsecure();                                  // 略過憑證檢查（簡單起見）
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);// Apps Script 會 302 轉址
  if (!http.begin(client, SCRIPT_URL)) { Serial.println("http.begin fail"); return -1; }

  int code = http.GET();
  Serial.printf("HTTP code: %d\n", code);
  if (code != HTTP_CODE_OK) { http.end(); return -1; }

  String payload = http.getString();
  http.end();

  JsonDocument doc;                                      // ArduinoJson 7：自動配置
  DeserializationError err = deserializeJson(doc, payload);
  if (err) { Serial.print("JSON err: "); Serial.println(err.c_str()); return -1; }

  gYear    = doc["year"]  | gYear;
  gMonth   = doc["month"] | gMonth;
  gToday   = doc["today"] | gToday;
  gUpdated = String((const char*)(doc["updated"] | "--:--"));

  /* 只對「events」算簽章（不含更新時間，否則每次都不一樣） */
  String evStr; serializeJson(doc["events"], evStr);
  uint32_t sig = fnv1a(evStr);
  bool changed = (sig != gLastSig);
  gLastSig = sig;

  for (int i = 0; i < 32; i++){
    gDays[i].count = 0;
    for (int k = 0; k < EVENT_LINES; k++){ gDays[i].t[k] = ""; gDays[i].hot[k] = false; }
  }

  int dim = daysInMonth(gYear, gMonth);
  for (JsonObject e : doc["events"].as<JsonArray>()){
    /* day = 開始日，endDay = 結束日（含當天）。
       舊版 Apps Script 沒有 endDay 欄位時，自動當成單日行程，行為與以前一樣 */
    int d0 = e["day"]    | 0;
    int d1 = e["endDay"] | d0;

    bool fromLastMonth = (d0 < 1);    // day=0 代表上個月就開始了，本月是延續
    if (d1 < d0) d1 = d0;
    if (d0 < 1)  d0 = 1;
    if (d1 > dim) d1 = dim;           // 延續到下個月
    if (d0 > dim || d1 < 1) continue; // 整段都不在本月

    String title = String((const char*)(e["title"] | ""));
    String tm    = String((const char*)(e["time"]  | ""));
    bool   hot   = isImportant(title);
    String base  = cleanTitle(title);

    /* 連續行程要每一天都畫：開始那天顯示「時間 + 標題」，之後幾天顯示「> 標題」 */
    for (int d = d0; d <= d1; d++){
      bool isStart = (d == d0 && !fromLastMonth);
      String label = isStart ? ((tm.length() ? tm + " " : "") + base)
                             : (String(CONT_PREFIX) + base);
      addToDay(d, label, hot);
    }
  }
  Serial.println(changed ? "Calendar changed -> refresh" : "No change -> skip");
  return changed ? 1 : 0;
}

/* ========== 日期小工具 ========== */
int dowFirst(int y, int m){                 // 該月1號星期幾：0=日..6=六（Sakamoto）
  static int t[] = {0,3,2,5,0,3,5,1,4,6,2,4};
  if (m < 3) y -= 1;
  return (y + y/4 - y/100 + y/400 + t[m-1] + 1) % 7;
}
int daysInMonth(int y, int m){
  static int d[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (m == 2 && ((y%4==0 && y%100!=0) || y%400==0)) return 29;
  return d[m-1];
}

/* ========== 繪圖小工具 ========== */
/* 畫字。bold=true 時同一行畫兩次、右移 1px，讓點陣字筆劃變粗（電子紙上好讀很多）

   ★ setFontMode(1) = 透明模式，每次畫字都要重設，不能只在 setup() 設一次：
     u8g2 的字身外框（trad14 約 18px）比實際筆劃高，非透明模式下會連外框一起
     填背景色，行距 16px 時「下一行的外框」就會把「上一行的字底」蓋掉
     —— 症狀是 0 變成 n、1 變成 7，而且每格最後一行不會被蓋（後面沒東西了）。
     三行在 68px 格高裡外框一定會重疊，所以透明模式是必要的，不是可選的。 */
void drawText(int x, int y, const String& s, uint16_t color,
              uint16_t bg = GxEPD_WHITE, bool bold = true){
  u8g2Fonts.setFontMode(1);                  // 只畫筆劃，不填背景框
  u8g2Fonts.setForegroundColor(color);
  u8g2Fonts.setBackgroundColor(bg);          // 透明模式下用不到，保留給日後切回實心用
  u8g2Fonts.setCursor(x, y);
  u8g2Fonts.print(s);
  if (bold){ u8g2Fonts.setCursor(x + 1, y); u8g2Fonts.print(s); }
}
String truncateUTF8(const String& s, int maxW){          // 以 UTF-8 字元為單位裁切，中文不切一半
  if ((int)u8g2Fonts.getUTF8Width(s.c_str()) + 1 <= maxW) return s;   // +1 = 加粗多出的寬度
  int ell = u8g2Fonts.getUTF8Width("…");
  String out = ""; int i = 0, n = s.length();
  while (i < n){
    int len = 1; unsigned char ch = s[i];
    if      (ch >= 0xF0) len = 4;
    else if (ch >= 0xE0) len = 3;
    else if (ch >= 0xC0) len = 2;
    String next = out + s.substring(i, i + len);
    if ((int)u8g2Fonts.getUTF8Width(next.c_str()) + ell + 1 > maxW) break;
    out = next; i += len;
  }
  return out + "…";
}
void drawEventLine(int x, int baseY, int cellW, const String& label, bool hot){
  uint16_t col = hot ? GxEPD_RED : GxEPD_BLACK;
  display.fillRect(x + 7, baseY - 11, 3, 12, col);      // 左側色條（高 12，留 1px 不碰格線）
  u8g2Fonts.setFont(u8g2_font_trad14);                  // 行程：14px 加粗
  drawText(x + 14, baseY, truncateUTF8(label, cellW - 20), col);
}

/* ========== 主繪製：整月月曆（版面A） ========== */
void render(){
  int startDow = dowFirst(gYear, gMonth);
  int dim      = daysInMonth(gYear, gMonth);
  int weeks    = (startDow + dim + 6) / 7;
  int gridY    = HEAD_H + DOW_H;
  int gridH    = H - gridY;
  int cellW    = W / 7;
  int cellH    = gridH / weeks;

  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    /* ---- 標題列：月份 + 年（放大加粗，往上貼齊） ---- */
    int titleBase = TITLE_TOP + 8 * MONTH_SCALE;   // 大數字的底線，其他元素都對齊它

    display.setTextWrap(false);
    display.setTextColor(GxEPD_BLACK);

    String mon = String(gMonth);                   // 月份數字：例如 "8"
    display.setTextSize(MONTH_SCALE);
    display.setCursor(16, TITLE_TOP);              // 內建字型的座標是「左上角」，不是基線
    display.print(mon);
    display.setCursor(17, TITLE_TOP);              // 右移 1px 再畫一次 = 加粗
    display.print(mon);

    /* 「月」字：仍用 trad16，基線對齊大數字底部 */
    int monX = 16 + (int)mon.length() * 6 * MONTH_SCALE - MONTH_SCALE + 2;  // 扣掉尾端字距
    u8g2Fonts.setFont(u8g2_font_trad16);
    drawText(monX, titleBase - 2, "月", GxEPD_BLACK);
    int monW = u8g2Fonts.getUTF8Width("月");

    /* 年份：比月份小一級，底部對齊 */
    display.setTextSize(YEAR_SCALE);
    display.setCursor(monX + monW + 16, titleBase - 8 * YEAR_SCALE);
    display.print(String(gYear));
    display.setCursor(monX + monW + 17, titleBase - 8 * YEAR_SCALE);
    display.print(String(gYear));

    display.setTextSize(1);                        // 還原，避免影響後面的繪製

    u8g2Fonts.setFont(u8g2_font_trad14);
    String upd = "更新 " + gUpdated;
    int uw = u8g2Fonts.getUTF8Width(upd.c_str());
    drawText(W - 16 - uw, titleBase - 2, upd, GxEPD_RED);   // 底部對齊標題

    display.fillRect(0, HEAD_H - 4, W, 3, GxEPD_BLACK);

    /* ---- 星期列（16px 加粗） ---- */
    const char* dows[7] = {"日","一","二","三","四","五","六"};
    u8g2Fonts.setFont(u8g2_font_trad16);
    for (int i = 0; i < 7; i++){
      uint16_t col = (i == 0) ? GxEPD_RED : GxEPD_BLACK;
      drawText(i * cellW + 9, HEAD_H + 18, String(dows[i]), col);
    }

    /* ---- 日期格 ---- */
    for (int w = 0; w < weeks; w++){
      for (int d = 0; d < 7; d++){
        int idx    = w * 7 + d;
        int dayNum = idx - startDow + 1;
        int x = d * cellW, y = gridY + w * cellH;

        display.drawRect(x, y, cellW + 1, cellH + 1, GxEPD_BLACK);
        if (dayNum < 1 || dayNum > dim) continue;

        bool today = (dayNum == gToday);
        uint16_t numColor = (d == 0) ? GxEPD_RED : GxEPD_BLACK;
        uint16_t numBg    = GxEPD_WHITE;
        if (today){                                        // 今天：紅色橫條 + 白字
          display.fillRect(x + 1, y + 1, cellW - 1, DATE_BAND_H, GxEPD_RED);
          numColor = GxEPD_WHITE; numBg = GxEPD_RED;
        }

        int numBase = y + DATE_BAND_H - 4;                 // 日期數字基線，貼齊橫條底部
        String dnum = String(dayNum);
        u8g2Fonts.setFont(u8g2_font_trad16);               // 日期數字：16px 加粗
        drawText(x + 8, numBase, dnum, numColor, numBg);

        DayCell& c = gDays[dayNum];

        if (SHOW_LUNAR){                                   // 農曆：接在日期數字右邊，14px 不加粗
          int dnW  = u8g2Fonts.getUTF8Width(dnum.c_str()) + 1;  // +1 = 加粗多出的寬度
          int lunX = x + 8 + dnW + 5;
          u8g2Fonts.setFont(u8g2_font_trad14);
          String lun = lunarLabel(gYear, gMonth, dayNum);
          /* 字型沒收農曆用字時 u8g2 會回傳 0 寬度，自動退回阿拉伯數字 */
          if (lun.length() && u8g2Fonts.getUTF8Width(lun.c_str()) < 8)
            lun = lunarLabelAscii(gYear, gMonth, dayNum);
          /* 右邊要留位子給 +N，不然「閏十一月」這種四個字的會撞上 */
          int avail = (x + cellW) - lunX - (c.count > EVENT_LINES ? 26 : 6);
          if (lun.length())
            drawText(lunX, numBase, truncateUTF8(lun, avail), numColor, numBg, false);
        }

        if (c.count > EVENT_LINES){                        // 塞不下的：日期列右側標 +N
          u8g2Fonts.setFont(u8g2_font_trad14);
          String more = "+" + String(c.count - EVENT_LINES);
          int mw = u8g2Fonts.getUTF8Width(more.c_str());
          drawText(x + cellW - 9 - mw, numBase, more, numColor, numBg);
        }

        int ty = y + EVENT_TOP;                            // 行程：最多 EVENT_LINES 行
        for (int k = 0; k < EVENT_LINES && k < c.count; k++){
          drawEventLine(x, ty, cellW, c.t[k], c.hot[k]);
          ty += EVENT_LINE_H;
        }
      }
    }
  } while (display.nextPage());
}

/* ========== 主流程 ========== */
void setup(){
  Serial.begin(115200);
  delay(200);

  bool firstBoot = (gLastSig == 0);        // 第一次開機一定要畫一次

  // 1) 連 WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000){ delay(300); Serial.print("."); }
  bool online = (WiFi.status() == WL_CONNECTED);
  Serial.println(online ? " OK" : " FAILED");

  // 2) 抓行事曆，判斷要不要刷屏
  bool refresh = firstBoot;
  if (online){
    int r = fetchCalendar();               // 1=變 0=沒變 -1=失敗
    if      (r == 1)  refresh = true;
    else if (r == 0)  refresh = false;
    else              refresh = firstBoot; // 失敗：第一次開機才畫個底
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // 3) 只有「內容有變（或第一次開機）」才刷新電子紙
  if (refresh){
    Serial.println("Rendering...");
    SPI.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
    display.init(115200);
    u8g2Fonts.begin(display);
    u8g2Fonts.setFontMode(1);
    u8g2Fonts.setFontDirection(0);
    u8g2Fonts.setBackgroundColor(GxEPD_WHITE);  // 必要！否則文字會被塗上黑底
    render();
    display.hibernate();
  } else {
    Serial.println("Screen unchanged, no refresh");
  }

  // 4) 深度睡眠，過幾分鐘再醒來檢查一次
  esp_sleep_enable_timer_wakeup(REFRESH_MINUTES * 60ULL * 1000000ULL);
  Serial.printf("Sleep %llu min...\n", REFRESH_MINUTES);
  esp_deep_sleep_start();
}

void loop(){ /* 深睡後每次醒來都從 setup() 重跑 */ }
