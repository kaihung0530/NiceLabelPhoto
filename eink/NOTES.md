# 電子紙桌曆（EinkCalendar）— 專案筆記與交接

> **給後續 session 的說明**：使用者沒有獨立的 eink repo，檔案原本是直接上傳給 Claude 的。
> 要接手請先讀完本檔，程式碼裡也有對應的中文註解。
>
> **這個專案有兩份**：
> - `kaihung0530/Claude` 的 `eink/` —— **主要位置，含 `TradFont.h`（2.3MB），可直接編譯**
> - `kaihung0530/NiceLabelPhoto` 的 `eink/` —— 副本，**不含字型檔**（那個 repo 是公開的）
>
> 兩邊都跟該 repo 原本的主題無關，只是借放。改東西請以 Claude repo 那份為準。

---

## 1. 這是什麼

掛在牆上的電子紙月曆，ESP32 定時去抓 Google 行事曆，內容有變才刷屏。

| 項目 | 內容 |
|---|---|
| 面板 | Waveshare 7.5" e-Paper (B) 三色 800×480，`GxEPD2_750c_Z08` |
| 主控 | ESP32 Dev Module + e-Paper ESP32 Driver Board |
| 函式庫 | GxEPD2、Adafruit GFX、ArduinoJson 7.x、U8g2_for_Adafruit_GFX |
| 分割區 | **Huge APP (3MB No OTA)** ← 中文字型大，必選 |
| 後端 | Google Apps Script 網頁應用程式，回傳當月行程 JSON |
| 電源 | 插電常供，`REFRESH_MINUTES = 1`，深度睡眠醒來→比對簽章→有變才刷 |

### 檔案

| 檔案 | 說明 |
|---|---|
| `EinkCalendar.ino` | 韌體主程式 |
| `Lunar.h` | 農曆換算表 + 換算函式（**必須跟 .ino 同資料夾**） |
| `TradFont.h` | 繁體中文點陣字型，2.3MB（**只在 Claude repo，見下方說明**） |
| `Code.gs` | Google Apps Script 後端，要貼到 Apps Script 編輯器 |
| `preview.svg` | 版面預覽（由 `test/preview.py` 產生） |
| `test/` | 驗證用腳本，見第 5 節 |

### 字型 `TradFont.h`（已解析驗證，別再猜）

WenQuanYi 點陣宋體轉的 u8g2 字型，**2.3MB**，兩套：

| 字型 | 字數 | 大小 | 收了什麼 | 用在哪 |
|---|---|---|---|---|
| `u8g2_font_trad14` | **21172** | 837 KB | **完整 CJK** + ASCII + 標點 | 行程內文、農曆 |
| `u8g2_font_trad16` | 106 | 2 KB | 只有 ASCII + `日一二三四五六月年更新` | 星期列、日期數字、標題 |

用 `test/font_probe.py` 直接解二進位查過（不是看檔頭註解自我宣稱）：

- 農曆用到的 `初 廿 正 閏 七 八 九 十` **trad14 全都有**，中文會正常顯示
- `…`（truncateUTF8 用的）、`～` trad14 有；**`↳` `‧` `·` `★` 沒有**
  → 所以 `CONT_PREFIX` 用 ASCII 的 `"> "`，別換成箭頭符號
- `★` 沒收不影響：`isImportant()` 只拿它做字串比對，`cleanTitle()` 會把它拿掉，不會畫出來
- **trad16 只有那 11 個中文字**，星期列／標題想加別的中文字得重產字型

字型檔大小是為什麼分割區一定要選 Huge APP。

---

## 2. 資料流

```
Google 日曆 → Apps Script doGet() → JSON → ESP32 fetchCalendar() → gDays[1..31] → render()
```

JSON 格式（`Code.gs` 產生）：

```json
{ "year":2026, "month":8, "today":6, "updated":"08:31",
  "events":[ {"day":18, "endDay":20, "time":"", "title":"自動化設備展"} ] }
```

- `day` = 開始日，`endDay` = 結束日（**含當天**）
- `day: 0` 是特例，代表「上個月就開始了，本月是延續」
- `endDay` 缺席時韌體視為單日，所以**舊版 Apps Script 搭新韌體不會壞**
- 刷屏判斷：只對 `events` 陣列算 FNV-1a 簽章存進 `RTC_DATA_ATTR`，
  `updated` 不列入（否則每分鐘都不一樣，會一直刷屏）

---

## 3. 這個 session 做了什麼（依序）

### 3.1 連續行程只顯示第一天

**根因**：Apps Script 每筆行程只吐 `day`（開始日），韌體也只塞 `gDays[day]` 一格。

**修法**：兩邊都改。Apps Script 加 `endDay`，韌體展開成連續幾格。

Google 的坑：**全天行程的 `getEndTime()` 是不含的** —— 8/18~8/20 會回傳
8/21 00:00，直接用會多畫一天。`Code.gs` 退 1 毫秒讓它落回真正的最後一天。
同樣邏輯也讓「18:00~隔天00:00」的跨夜行程不會溢到隔天。

顯示：開始那天「時間 + 標題」，之後幾天「> 標題」（`CONT_PREFIX`）。

### 3.2 標題 8月2026 放大加粗

**限制**：`TradFont.h` 只有 14/16px 兩種，`U8g2_for_Adafruit_GFX` 不支援縮放，
**中文字沒辦法放大或縮小**。

**修法**：月份和年份的**數字**改用 Adafruit GFX 內建字型放大畫
（`display.setTextSize()`，內建字型一格 6×8），「月」字仍用 trad16 基線對齊。
`MONTH_SCALE = 4`（24×32）、`YEAR_SCALE = 3`（18×24），都右移 1px 重畫一次加粗。

順便把標題往上貼齊，`HEAD_H` 58→42、`DOW_H` 30→26，省下的 20px 全給日期格。

### 3.3 每格三行行程

`EVENT_LINES` 2→3，日期橫條 `DATE_BAND_H` 24→20，
`EVENT_TOP` 43→34，`EVENT_LINE_H` 18→16。
`DayCell` 的 `t1/t2` 改成陣列 `t[EVENT_LINES]`，之後要調行數只改一個常數。

### 3.4 ★ 行程字被切掉（重要，別再踩）

**症狀**：每格的最後一行完好，前面幾行底部被削掉 2~3px，`0`看起來像`n`、
`1`像`7`、`B`像`R`。

**根因**：u8g2 非透明模式會**連字身外框一起填背景色**。trad14 是
`BBX Build Mode: 1`，外框固定 **20px**（基線上 17、下 3），但**實際筆劃只有 13px**
（基線上 12、下 1）—— 兩者差了 7px，這就是陷阱所在。

行距 18 時外框只重疊 2px、剛好沒吃到墨水，所以兩行版本看不出問題；
縮到 16 之後重疊 4px，下一行的外框就往上蓋掉上一行的字底。
每格最後一行沒事，是因為後面沒東西再蓋它了。

（外框 20px / 筆劃 13px 都是 `test/glyph_bbx.py`、`test/glyph_ink.py` 解點陣量出來的）

**修法**：`drawText()` 裡加 `u8g2Fonts.setFontMode(1)`（透明模式）。

**關鍵**：`setup()` 裡本來就有 `setFontMode(1)`，但**每次 `setFont()` 之後就會失效**，
render 迴圈每畫一行都在切字型，所以實際畫的時候是實心模式。必須放在 `drawText()` 裡。

三行在 68px 格高裡外框一定會重疊（18×3 = 54px，從日期下方 y+21 起算會到 y+75，
超出格子），**所以透明模式是必要條件，不是可選的**。

### 3.5 農曆

`Lunar.h`，顯示在日期數字右邊，trad14 不加粗。初一改顯示月份（正月／閏六月）。

農曆表**不是手打也不是憑記憶**，是用 Python `lunardate` 掃過每一天反推打包出來的
（`test/gen_lunar.py` → `test/make_header.py`）。1900-2098 共 199 筆，796 bytes，
放 `PROGMEM`。產出的第一筆是 `0x04bd8`，跟公認經典農曆表完全一致。

換算用 Howard Hinnant 的 `days_from_civil`，不碰 `time_t`，
避開 ESP32 上 32 位元溢位和時區問題。

---

## 4. 版面幾何（改任何一個數字前先看這裡）

```
HEAD_H = 42   標題列      標題底線 y=34，分隔線 y=38..40
DOW_H  = 26   星期列      基線 y=60
gridY  = 68   日期格起點  gridH = 412，2026/8 是 6 週 → cellH = 68

格子內（相對格子頂端 y）—— 筆劃範圍是實測的，trad14 基線上 12px、下 1px：
  日期橫條   y+1  .. y+20    ← DATE_BAND_H，只有「今天」畫紅底
  日期數字   基線 y+16       ← trad16；農曆接在右邊，trad14
  行程第1行  基線 y+34   筆劃 y+22 .. y+35   外框 y+17 .. y+37
  行程第2行  基線 y+50   筆劃 y+38 .. y+51   外框 y+33 .. y+53
  行程第3行  基線 y+66   筆劃 y+54 .. y+67   外框 y+49 .. y+69
  格線       y+68

  日期橫條底 y+20 vs 第1行筆劃頂 y+22  -> 2px
  第3行筆劃底 y+67 vs 格線 y+68        -> 1px
  行距 16 vs 筆劃高 13                 -> 行間距 3px
```

**這已經是 68px 格高的極限。** `test/preview.py` 裡有 assert，
改常數只要撞到就會直接報錯，不用等燒進去才發現。

---

## 5. 怎麼驗證（不用燒板子）

在 `eink/` 目錄下執行：

```bash
pip install lunardate

python3 test/gen_lunar.py      # 從 lunardate 反推農曆表 -> test/lunar_table.txt
python3 test/make_header.py    # 產生 Lunar.h（表用注入的，避免手打錯字）

g++ -O2 -I test -o test/lunar_test test/lunar_test.cpp
test/lunar_test > test/cpp_out.csv          # C++ 版農曆逐日輸出

node test/gs_test.js           # 用 Node stub 跑 Apps Script 的跨日/跨月/全天邏輯
g++ -o test/t3 test/t3.cpp && test/t3       # 韌體的連續行程展開邏輯
python3 test/preview.py        # 重算版面幾何 + 產生 preview.svg

python3 test/font_probe.py TradFont.h   # 查某個字有沒有被字型收進去
python3 test/glyph_bbx.py  TradFont.h   # 字身外框（填充框）
python3 test/glyph_ink.py  TradFont.h   # 解 RLE 點陣，量真正的筆劃上下界
```

`font_probe.py` 是照 `u8g2_font_get_glyph_data()` 實作的。兩個容易踩的點：
unicode lookup table 的偏移是**累加**的，而且要從 23 bytes 檔頭之後起算；
字面值裡本身含 `;` 和 `"` 字元，抽陣列不能用 `index(';')` 找結尾。
解出來的長度要跟宣告的陣列大小對得上（2119+1=2120、837374+1=837375）才算解對。

`test/shim.h` 是 host 端的 Arduino 墊片（`String`、`PROGMEM`、`pgm_read_dword`），
讓 `Lunar.h` 能在電腦上編譯測試。

**已驗證的結果**：
- 字型：trad14 = 21172 字完整 CJK，農曆用字全有；trad16 = 106 字（只有 ASCII +
  `日一二三四五六月年更新`）；筆劃 13px、外框 20px
- 農曆：2020-2060 共 **14,976 天逐日比對 lunardate，零誤差**；
  閏月標籤（閏二/三/四/五/六/七/八/十一月）全對；2026/8/6 = 廿四
- Apps Script：全天跨日 8/18~8/20 → `day:18, endDay:20`（不是 21）；
  跨夜 8/10 18:00~8/11 00:00 → `endDay:10`（不溢出）；
  上月延續 → `day:0`；跨到下月 → `endDay` 夾在月底
- 展開邏輯：跨月頭尾、超過 3 筆收成 `+N` 都正確

---

## 6. 已知限制 / 待辦

- **字型缺字風險已排除**（見第 1 節）。農曆的中文確定畫得出來。
  程式仍留著缺字自動退回阿拉伯數字的保護，換字型時才會派上用場。
  要動星期列／標題的中文才要注意 —— trad16 只收了 11 個中文字。
- **四行行程**：塞不下。筆劃 13px、行距至少 13，四行要 52px，
  加上日期數字那條（約 16px）= 68px，剛好等於格高、零餘裕，實務上不可行。
  真的要就得重產一份 **12px** 的 `TradFont.h`（行距可壓到 12），
  這也是唯一能真正把行程字變小的方法（現在 14px 是字型下限）。
- **`REFRESH_MINUTES = 1`** 每分鐘醒來一次，插電無所謂，改電池要調大。
- **農曆表到 2098 年**，超出範圍 `toLunar()` 回傳 `valid=false`，農曆欄留白。
- **節氣、國定假日**沒做。
- `Code.gs` 的 `TZ_OFF = 8` 寫死台灣時區（UTC+8 無日光節約），換時區要改。

---

## 7. 部署步驟

**韌體**：`EinkCalendar.ino` + `Lunar.h` + `TradFont.h` 放同一資料夾 →
Arduino IDE → 開發板選 ESP32 Dev Module → **Partition Scheme 選 Huge APP** → 燒錄。

**後端**：`Code.gs` 貼進 Apps Script 編輯器 →
**部署 → 管理部署作業 → 編輯 → 版本選「新版本」** → 更新。

> ★ 只按儲存沒有用，`/exec` 還是會提供舊程式碼 —— 這是最容易卡住的一步。
> 可以先在編輯器執行 `testOutput()`，確認 JSON 有 `endDay` 欄位再部署。

`.ino` 開頭要填的：`WIFI_SSID`（只能 2.4GHz）、`WIFI_PASSWORD`、
`SCRIPT_URL`（結尾 `/exec`）。`Code.gs` 開頭：`CAL_ID`、`TZ`。

---

## 8. 主要可調常數

| 常數 | 現值 | 說明 |
|---|---|---|
| `SHOW_LUNAR` | `true` | 農曆總開關 |
| `CONT_PREFIX` | `"> "` | 連續行程第二天起的前綴 |
| `MONTH_SCALE` / `YEAR_SCALE` | 4 / 3 | 標題數字倍率（內建字型 6×8） |
| `HEAD_H` / `DOW_H` | 42 / 26 | 標題列 / 星期列高 |
| `EVENT_LINES` | 3 | 每格最多幾行行程 |
| `DATE_BAND_H` | 20 | 日期橫條高 |
| `EVENT_TOP` / `EVENT_LINE_H` | 34 / 16 | 第一行基線 / 行距 |
| `REFRESH_MINUTES` | 1 | 幾分鐘檢查一次 |

改完跑 `python3 test/preview.py` 確認沒撞到。
