table = open("test/lunar_table.txt").read().rstrip().rstrip(",")
hdr = '''/* =======================================================================
   Lunar.h — 農曆換算（給 EinkCalendar.ino 用）
   資料表由 lunardate 反推產生並逐日比對過，涵蓋農曆 1900-2098 年
   每筆 uint32：bit0-3 = 閏月月份(0=無)，bit4-15 = 12個月大小(1=30天)，bit16 = 閏月是否30天
   ======================================================================= */
#pragma once
#include <Arduino.h>

const int LUNAR_Y0 = 1900, LUNAR_Y1 = 2098;

static const uint32_t LUNAR_INFO[] PROGMEM = {
%s
};

static inline uint32_t lunarInfo(int y){ return pgm_read_dword(&LUNAR_INFO[y - LUNAR_Y0]); }
static inline int lunarLeapMonth(int y){ return lunarInfo(y) & 0xf; }
static inline int lunarLeapDays(int y){
  if (!lunarLeapMonth(y)) return 0;
  return (lunarInfo(y) & 0x10000) ? 30 : 29;
}
static inline int lunarMonthDays(int y, int m){          // m = 1..12，不含閏月
  return (lunarInfo(y) & (0x10000 >> m)) ? 30 : 29;
}
static inline int lunarYearDays(int y){
  int sum = 0;
  for (int m = 1; m <= 12; m++) sum += lunarMonthDays(y, m);
  return sum + lunarLeapDays(y);
}

/* 西元年月日 -> 從西元元年起算的天數（Howard Hinnant 的 days_from_civil，
   不用 time_t，避免 32 位元溢位跟時區問題） */
static inline long daysFromCivil(int y, int m, int d){
  y -= (m <= 2);
  const int  era = (y >= 0 ? y : y - 399) / 400;
  const int  yoe = y - era * 400;
  const int  doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const int  doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (long)era * 146097L + doe - 719468L;
}

struct Lunar { int year, month, day; bool leap, valid; };

static Lunar toLunar(int gy, int gm, int gd){
  Lunar r = {0, 0, 0, false, false};
  long offset = daysFromCivil(gy, gm, gd) - daysFromCivil(1900, 1, 31);   // 1900-01-31 = 農曆正月初一
  if (offset < 0) return r;

  int y = LUNAR_Y0;
  for (; y <= LUNAR_Y1; y++){
    int dy = lunarYearDays(y);
    if (offset < dy) break;
    offset -= dy;
  }
  if (y > LUNAR_Y1) return r;                      // 超出資料表範圍

  const int leapM = lunarLeapMonth(y);
  bool isLeap = false;
  int m = 1;
  for (; m <= 12; m++){
    int dm = lunarMonthDays(y, m);
    if (offset < dm) break;
    offset -= dm;
    if (leapM == m){                               // 閏月緊接在第 leapM 個月之後
      int dl = lunarLeapDays(y);
      if (offset < dl){ isLeap = true; break; }
      offset -= dl;
    }
  }
  r.year = y; r.month = m; r.day = (int)offset + 1; r.leap = isLeap; r.valid = true;
  return r;
}

/* 顯示用字串：初一~三十；每月初一改顯示月份（正月、閏六月…） */
static String lunarLabel(int gy, int gm, int gd){
  Lunar l = toLunar(gy, gm, gd);
  if (!l.valid) return "";
  static const char* MON[12] = {"正","二","三","四","五","六",
                                "七","八","九","十","十一","十二"};
  static const char* TENS[4] = {"初","十","廿","三"};
  if (l.day == 1){
    String s = l.leap ? "閏" : "";
    return s + MON[l.month - 1] + "月";
  }
  if (l.day == 10) return "初十";
  if (l.day == 20) return "二十";
  if (l.day == 30) return "三十";
  static const char* DIG[10] = {"","一","二","三","四","五","六","七","八","九"};
  return String(TENS[l.day / 10]) + DIG[l.day %% 10];
}

/* 字型沒收農曆用字時的退路：直接印阿拉伯數字（初一顯示成 6/1 這種） */
static String lunarLabelAscii(int gy, int gm, int gd){
  Lunar l = toLunar(gy, gm, gd);
  if (!l.valid) return "";
  if (l.day == 1) return String(l.month) + "/1";
  return String(l.day);
}
''' % table
open("Lunar.h","w").write(hdr)
print("Lunar.h 產生完成，", len(hdr.splitlines()), "行")
