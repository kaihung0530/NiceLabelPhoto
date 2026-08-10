// 用 Node 模擬 Apps Script 環境，驗證 doGet() 的跨日/跨月/全天邏輯
const fs = require('fs');
const TZNAME = 'Asia/Taipei';
global.Utilities = {
  formatDate(d, tz, fmt) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric',
      month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
      .formatToParts(d).reduce((a,x)=>(a[x.type]=x.value,a),{});
    if (fmt === 'yyyy') return p.year;
    if (fmt === 'M')    return String(Number(p.month));
    if (fmt === 'd')    return String(Number(p.day));
    if (fmt === 'HH:mm')return (p.hour==='24'?'00':p.hour) + ':' + p.minute;
    throw new Error('fmt? ' + fmt);
  }
};
global.ContentService = { MimeType:{JSON:'json'},
  createTextOutput(s){ return { getContent:()=>s, setMimeType(){return this;} }; } };

// 台北時間 -> Date
const tp = (y,mo,d,h=0,mi=0) => new Date(Date.UTC(y,mo-1,d,h-8,mi));
function mkEvent(title, start, end, allDay){
  return { getTitle:()=>title, getStartTime:()=>start, getEndTime:()=>end,
           isAllDayEvent:()=>!!allDay };
}
const EVENTS = [
  // 8/18~8/20 全天展覽：Google 的 end 是 8/21 00:00（不含）
  mkEvent('自動化展',        tp(2026,8,18), tp(2026,8,21), true),
  mkEvent('週會',            tp(2026,8,18,9,30),  tp(2026,8,18,10,30), false),
  mkEvent('客戶來訪',        tp(2026,8,18,14,0),  tp(2026,8,18,15,0),  false),
  // 7/28 開始、8/3 結束 -> 本月只看到 1~3 號，且 day 應為 0
  mkEvent('上月延續的專案',  tp(2026,7,28), tp(2026,8,4), true),
  // 8/30 開始、跨到 9/2 -> endDay 應夾成 31
  mkEvent('月底盤點',        tp(2026,8,30), tp(2026,9,3), true),
  // 跨夜但不算隔天：8/10 18:00 ~ 8/11 00:00
  mkEvent('晚班',            tp(2026,8,10,18,0), tp(2026,8,11,0,0), false),
];
global.CalendarApp = {
  getCalendarById: () => ({ getEvents: (s,e) =>
      EVENTS.filter(ev => ev.getStartTime() < e && ev.getEndTime() > s) }),
  getDefaultCalendar(){ return this.getCalendarById(); }
};
// 把「現在」固定在 2026/8/6 台北時間
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a){ if (a.length===0) super(RealDate.UTC(2026,7,6,4,30)); else super(...a); }
};
global.Date.UTC = RealDate.UTC;

eval(fs.readFileSync('Code.gs','utf8'));
const out = JSON.parse(doGet().getContent());
console.log('year/month/today/updated:', out.year, out.month, out.today, out.updated);
console.log('dim 應為 31');
out.events.forEach(e =>
  console.log(`  day=${String(e.day).padStart(2)} endDay=${String(e.endDay).padStart(2)} time="${e.time}" ${e.title}`));
