/* =======================================================================
   電子紙桌曆 — Google Apps Script 後端
   輸出本月所有行程給 ESP32，連續行程（如 8/18~8/20）會附上 endDay
   -----------------------------------------------------------------------
   部署：Apps Script 編輯器 → 部署 → 新增部署作業 → 類型「網頁應用程式」
         執行身分 = 我；具有存取權的使用者 = 「任何人」
         部署後把結尾 /exec 的網址貼到 EinkCalendar.ino 的 SCRIPT_URL
   ★ 每次改完程式碼都要「管理部署作業 → 編輯 → 版本：新版本」才會生效
   ======================================================================= */

/* ========== 設定 ========== */
const CAL_ID = 'primary';        // 'primary' = 預設行事曆；或填 xxx@group.calendar.google.com
const TZ     = 'Asia/Taipei';
const TZ_OFF = 8;                // 台灣 UTC+8、無日光節約。改時區的話這裡也要改

function doGet() {
  const now = new Date();
  const y     = Number(Utilities.formatDate(now, TZ, 'yyyy'));
  const m     = Number(Utilities.formatDate(now, TZ, 'M'));
  const today = Number(Utilities.formatDate(now, TZ, 'd'));

  /* 用 UTC 推算月份邊界，這樣不管 Apps Script 專案本身設什麼時區都正確 */
  const H = 3600 * 1000;
  const monthStart = new Date(Date.UTC(y, m - 1, 1) - TZ_OFF * H);
  const monthEnd   = new Date(Date.UTC(y, m,     1) - TZ_OFF * H);  // 下月1號00:00（不含）
  const dim        = new Date(Date.UTC(y, m, 0)).getUTCDate();      // 本月天數

  const cal = CalendarApp.getCalendarById(CAL_ID) || CalendarApp.getDefaultCalendar();
  const events = cal.getEvents(monthStart, monthEnd);

  const out = [];
  events.forEach(function (ev) {
    const s = ev.getStartTime();
    let e = ev.getEndTime();

    /* Google 行事曆的「結束時間」是不含的：
       8/18~8/20 的全天行程，getEndTime() 會回 8/21 00:00。
       退 1 毫秒讓它落回真正的最後一天 8/20，否則會多畫一天。 */
    if (e.getTime() > s.getTime()) e = new Date(e.getTime() - 1);

    const d0 = clampDay(s, y, m, dim);   // 開始日（跨月的話夾在本月範圍內）
    const d1 = clampDay(e, y, m, dim);   // 結束日（含當天）

    /* 只有「真的在本月開始」的行程才顯示時間；
       從上個月延續過來的，時間留空（那個時間不是今天發生的） */
    const startsThisMonth = inThisMonth(s, y, m);
    let time = '';
    if (startsThisMonth && !ev.isAllDayEvent()) {
      time = Utilities.formatDate(s, TZ, 'HH:mm');
    }

    out.push({
      day:    d0,
      endDay: d1,                 // ← 韌體靠這個把行程畫滿整段期間
      time:   time,
      title:  ev.getTitle() || '(無標題)'
    });
  });

  /* 排序：先按開始日，同一天的話「跨天/整天」排前面，再按時間 */
  out.sort(function (a, b) {
    if (a.day !== b.day) return a.day - b.day;
    const aSpan = a.endDay - a.day, bSpan = b.endDay - b.day;
    if (aSpan !== bSpan) return bSpan - aSpan;
    return String(a.time).localeCompare(String(b.time));
  });

  const payload = {
    year:    y,
    month:   m,
    today:   today,
    updated: Utilities.formatDate(now, TZ, 'HH:mm'),
    events:  out
  };

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* 這個日期是不是落在指定的年月 */
function inThisMonth(dt, y, m) {
  return Number(Utilities.formatDate(dt, TZ, 'yyyy')) === y &&
         Number(Utilities.formatDate(dt, TZ, 'M'))    === m;
}

/* 取「日」，跨月的部分夾到本月邊界：
   上個月就開始 → 回 0（韌體看到 0 會知道要標成「延續中」）
   下個月才結束 → 回本月最後一天 */
function clampDay(dt, y, m, dim) {
  const yy = Number(Utilities.formatDate(dt, TZ, 'yyyy'));
  const mm = Number(Utilities.formatDate(dt, TZ, 'M'));
  const dd = Number(Utilities.formatDate(dt, TZ, 'd'));
  if (yy < y || (yy === y && mm < m)) return 0;
  if (yy > y || (yy === y && mm > m)) return dim;
  return dd;
}

/* 在編輯器裡按「執行」跑這個，可以先看 JSON 對不對，不用燒板子 */
function testOutput() {
  Logger.log(doGet().getContent());
}
