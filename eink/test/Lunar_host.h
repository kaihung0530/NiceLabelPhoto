/* =======================================================================
   Lunar.h — 農曆換算（給 EinkCalendar.ino 用）
   資料表由 lunardate 反推產生並逐日比對過，涵蓋農曆 1900-2098 年
   每筆 uint32：bit0-3 = 閏月月份(0=無)，bit4-15 = 12個月大小(1=30天)，bit16 = 閏月是否30天
   ======================================================================= */
#pragma once
#include "shim.h"

const int LUNAR_Y0 = 1900, LUNAR_Y1 = 2098;

static const uint32_t LUNAR_INFO[] PROGMEM = {
  0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,
  0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,
  0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,
  0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,
  0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
  0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,
  0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5d0,0x14573,
  0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,
  0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,
  0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
  0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,
  0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,
  0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,
  0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,
  0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
  0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,
  0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,
  0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,
  0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,
  0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06aa0,0x1a6c4,0x0aae0,
  0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,
  0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,
  0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,
  0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,
  0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150
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
  return String(TENS[l.day / 10]) + DIG[l.day % 10];
}

/* 字型沒收農曆用字時的退路：直接印阿拉伯數字（初一顯示成 6/1 這種） */
static String lunarLabelAscii(int gy, int gm, int gd){
  Lunar l = toLunar(gy, gm, gd);
  if (!l.valid) return "";
  if (l.day == 1) return String(l.month) + "/1";
  return String(l.day);
}
