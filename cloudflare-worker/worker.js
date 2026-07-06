/**
 * 我的 Todo — 單一 Cloudflare Worker(前端 + 後端 + KV 儲存 + LINE bot)
 *
 * 需要綁定:
 *   - KV Namespace binding，變數名稱: TODO_KV
 *   - 環境變數/密鑰:  APP_PASSWORD               (dashboard 登入密碼)
 *   - 環境變數/密鑰:  LINE_CHANNEL_SECRET        (LINE channel secret,驗證訊息來源)
 *   - 環境變數/密鑰:  LINE_CHANNEL_ACCESS_TOKEN  (LINE channel access token,回覆訊息用)
 *   - 環境變數/密鑰:  GOOGLE_SA_KEY              (Google 服務帳戶的 JSON 金鑰「整份內容」)
 *   - 環境變數/密鑰:  GOOGLE_CALENDAR_ID         (你的行事曆 ID,通常就是你的 Gmail 地址)
 *
 * 路由:
 *   GET  /       -> 回傳 dashboard 網頁
 *   POST /api    -> {action:'list'|'add'|'complete'|'reopen'|'delete', ...}  (需帶 x-app-password)
 *   POST /line   -> LINE Messaging API webhook
 *
 * LINE 指令(待辦):
 *   待辦 : 內容      -> 新增待辦(冒號全形半形皆可)
 *   待辦事項         -> 列出待辦清單
 *   完成 2           -> 完成清單上第 2 筆
 * LINE 指令(行事曆):
 *   行程 : 明天 14:00 拜訪宏益   -> 建立 Google 日曆活動(1 小時)
 *   行程 : 7/10 出差台中         -> 全天活動
 *   今天行程 / 明天行程 / 本週行程 -> 查詢行程
 *   其他文字         -> 回覆使用說明
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api") {
      return handleApi(request, env);
    }
    if (url.pathname === "/line") {
      return handleLine(request, env);
    }
    return new Response("Not found", { status: 404 });
  },

  /* Cron 觸發:自動推播今日摘要(在 Cloudflare 觸發事件設定排程) */
  async scheduled(event, env, ctx) {
    await sendDailyDigest(env);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function handleApi(request, env) {
  const pw = request.headers.get("x-app-password") || "";
  if (!env.APP_PASSWORD || pw !== env.APP_PASSWORD) return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const action = body.action;

  let tasks = (await env.TODO_KV.get("todos", "json")) || [];
  if (!Array.isArray(tasks)) tasks = [];

  if (action === "list") {
    // no change
  } else if (action === "add") {
    const content = (body.content || "").trim();
    if (!content) return json({ error: "empty content" }, 400);
    let prio = Number(body.priority);
    if (!(prio >= 1 && prio <= 4)) prio = 1;
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      content: content,
      priority: prio,
      due: body.due || null,
      done: false,
      createdAt: new Date().toISOString()
    });
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
  } else if (action === "complete") {
    tasks = tasks.map(t => t.id === body.id ? Object.assign({}, t, { done: true, completedAt: new Date().toISOString() }) : t);
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
  } else if (action === "reopen") {
    tasks = tasks.map(t => {
      if (t.id !== body.id) return t;
      const c = Object.assign({}, t, { done: false });
      delete c.completedAt;
      return c;
    });
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
  } else if (action === "delete") {
    tasks = tasks.filter(t => t.id !== body.id);
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
  } else {
    return json({ error: "unknown action" }, 400);
  }
  return json({ tasks: tasks });
}

/* ---------------- LINE bot ---------------- */

async function handleLine(request, env) {
  if (request.method !== "POST") return new Response("ok");
  const bodyText = await request.text();

  const sig = request.headers.get("x-line-signature") || "";
  const valid = await verifyLineSignature(bodyText, sig, env.LINE_CHANNEL_SECRET);
  if (!valid) return new Response("bad signature", { status: 403 });

  let body;
  try { body = JSON.parse(bodyText); } catch (e) { body = {}; }
  const events = body.events || [];

  for (const ev of events) {
    if (ev.type === "message" && ev.message && ev.message.type === "text" && ev.replyToken) {
      /* 記住使用者 ID,自動推播用 */
      if (ev.source && ev.source.userId) {
        const prev = await env.TODO_KV.get("line_user_id");
        if (prev !== ev.source.userId) await env.TODO_KV.put("line_user_id", ev.source.userId);
      }
      const replyText = await processLineCommand(ev.message.text, env);
      if (replyText) await lineReply(ev.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
    }
  }
  return new Response("ok");
}

async function verifyLineSignature(body, signature, secret) {
  if (!secret || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = new Uint8Array(mac);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin) === signature;
}

async function lineReply(replyToken, text, token) {
  if (!token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + token },
      body: JSON.stringify({ replyToken: replyToken, messages: [{ type: "text", text: String(text).slice(0, 4900) }] })
    });
  } catch (e) { /* reply 失敗不影響 webhook 回應 */ }
}

async function linePush(userId, text, token) {
  if (!token || !userId) return false;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + token },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text: String(text).slice(0, 4900) }] })
    });
    return res.ok;
  } catch (e) { return false; }
}

/* ---- 每日摘要(Cron 自動推播) ---- */

async function buildDailyDigest(env) {
  const p = twDateParts(0);
  const lines = ["☀️ 早安!今日摘要 " + p.m + "/" + p.d + "(" + WEEKDAY[p.w] + ")"];

  /* 待辦 */
  let tasks = (await env.TODO_KV.get("todos", "json")) || [];
  if (!Array.isArray(tasks)) tasks = [];
  const active = sortActive(tasks);
  if (active.length) {
    const today = twToday();
    const prioMark = { 4: "🔴P1 ", 3: "🟡P2 ", 2: "🔵P3 ", 1: "" };
    lines.push("", "📝 待辦(" + active.length + " 筆)");
    active.forEach((x, i) => {
      let due = "";
      if (x.due) due = x.due < today ? "(" + x.due + " ⚠️逾期)" : x.due === today ? "(今天)" : "(" + x.due + ")";
      lines.push((i + 1) + ". " + prioMark[x.priority] + x.content + due);
    });
    lines.push("完成請回覆:完成 1");
  } else {
    lines.push("", "📝 沒有待辦事項 🎉");
  }

  /* 今日行程(未設定 Google 就跳過) */
  if (env.GOOGLE_SA_KEY && env.GOOGLE_CALENDAR_ID) {
    try {
      const token = await googleAccessToken(env);
      const a = twDateParts(0), b = twDateParts(1);
      const timeMin = a.y + "-" + pad2(a.m) + "-" + pad2(a.d) + "T00:00:00+08:00";
      const timeMax = b.y + "-" + pad2(b.m) + "-" + pad2(b.d) + "T00:00:00+08:00";
      const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events" +
        "?singleEvents=true&orderBy=startTime&maxResults=50" +
        "&timeMin=" + encodeURIComponent(timeMin) + "&timeMax=" + encodeURIComponent(timeMax);
      const res = await fetch(url, { headers: { "authorization": "Bearer " + token } });
      const j = await res.json();
      const items = (res.ok && j.items) ? j.items : [];
      lines.push("", "📅 今日行程");
      if (items.length) {
        for (const ev of items) {
          const timeText = (ev.start && ev.start.dateTime) ? ev.start.dateTime.slice(11, 16) : "全天";
          lines.push("• " + timeText + "　" + (ev.summary || "(未命名)") + (ev.location ? "\n　📍 " + ev.location : ""));
        }
      } else {
        lines.push("今天沒有安排行程");
      }
    } catch (e) { /* 行事曆讀不到就略過,不影響待辦推播 */ }
  }

  return lines.join("\n");
}

async function sendDailyDigest(env) {
  const userId = await env.TODO_KV.get("line_user_id");
  if (!userId) return false;
  const text = await buildDailyDigest(env);
  return linePush(userId, text, env.LINE_CHANNEL_ACCESS_TOKEN);
}

/* 台灣時區的今天 (UTC+8) */
function twToday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = n => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

/* 與 dashboard 相同的排序:逾期 > 今天 > 其他,再依優先級高到低 */
function sortActive(tasks) {
  const today = twToday();
  const rank = t => (!t.due ? 2 : t.due < today ? 0 : t.due === today ? 1 : 2);
  return tasks.filter(t => !t.done).sort((a, b) =>
    rank(a) - rank(b) || b.priority - a.priority || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

const LINE_HELP = [
  "你可以這樣使用 📝",
  "",
  "── 待辦(提醒事項)──",
  "新增:待辦 : 內容",
  "　例如「待辦 : 回覆宏益報價」",
  "查看:待辦事項",
  "完成:完成 2　(第 2 筆)",
  "",
  "── 行程(Google 日曆)──",
  "新增:行程 : 日期 時間 內容 @地點",
  "　例如「行程 : 明天 14:00 拜訪宏益 @宜兒樂澄清店」",
  "　例如「行程 : 7/10 出差台中」(全天,@地點可省略)",
  "查看:今天行程 / 明天行程 / 本週行程 / 本月行程 / 下月行程",
  "改期:改行程 2 明天 15:00(先查行程看編號)",
  "刪除:刪行程 2",
  "",
  "── 其他 ──",
  "今日摘要:立即收到一則今日待辦+行程"
].join("\n");

async function processLineCommand(text, env) {
  const t = String(text || "").trim();

  /* ---- 行事曆指令(Google Calendar) ---- */
  let g = t.match(/^行程\s*[:：]\s*(.+)$/s);
  if (g) {
    try { return await gcalAdd(g[1], env); }
    catch (e) { return "❌ 建立行程失敗:" + e.message; }
  }
  if (/^(今日|今天)行程$/.test(t)) {
    try { return await gcalListRange(0, 1, "今天", env); }
    catch (e) { return "❌ 查詢行程失敗:" + e.message; }
  }
  if (/^(明日|明天)行程$/.test(t)) {
    try { return await gcalListRange(1, 2, "明天", env); }
    catch (e) { return "❌ 查詢行程失敗:" + e.message; }
  }
  if (/^(本月|這個月|當月)行程$/.test(t)) {
    try { return await gcalListMonth(0, env); }
    catch (e) { return "❌ 查詢行程失敗:" + e.message; }
  }
  if (/^(下月|下個月)行程$/.test(t)) {
    try { return await gcalListMonth(1, env); }
    catch (e) { return "❌ 查詢行程失敗:" + e.message; }
  }
  if (/^(本週|本周|一週|一周|近期)?行程$/.test(t)) {
    try { return await gcalListRange(0, 7, "未來 7 天", env); }
    catch (e) { return "❌ 查詢行程失敗:" + e.message; }
  }
  g = t.match(/^(?:改|修改)行程\s*(\d+)\s*[:：]?\s*(.*)$/s);
  if (g) {
    try { return await gcalModify(Number(g[1]), g[2], env); }
    catch (e) { return "❌ 修改行程失敗:" + e.message; }
  }
  g = t.match(/^(?:刪|刪除|删|删除)行程\s*(\d+)$/);
  if (g) {
    try { return await gcalDelete(Number(g[1]), env); }
    catch (e) { return "❌ 刪除行程失敗:" + e.message; }
  }

  /* 手動測試每日摘要推播 */
  if (/^(推播測試|測試推播|今日摘要)$/.test(t)) {
    const okPush = await sendDailyDigest(env);
    return okPush ? null : "❌ 推播失敗:請先傳過任意訊息讓我記住你,並確認 access token 正確";
  }

  let tasks = (await env.TODO_KV.get("todos", "json")) || [];
  if (!Array.isArray(tasks)) tasks = [];

  /* 新增: 待辦 : XXX (全形/半形冒號皆可) */
  let m = t.match(/^待辦\s*[:：]\s*(.+)$/s);
  if (m) {
    const content = m[1].trim();
    if (!content) return "內容是空的喔,格式:待辦 : 內容";
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      content: content,
      priority: 1,
      due: null,
      done: false,
      createdAt: new Date().toISOString()
    });
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
    const activeCount = tasks.filter(x => !x.done).length;
    return "✅ 已新增待辦:\n「" + content + "」\n\n目前共 " + activeCount + " 筆待完成";
  }

  /* 列出清單 */
  if (/^(待辦事項|待辦清單|清單|待辦)$/.test(t)) {
    const active = sortActive(tasks);
    if (!active.length) return "🎉 目前沒有待辦事項,全部清空了!";
    const today = twToday();
    const prioMark = { 4: "🔴P1 ", 3: "🟡P2 ", 2: "🔵P3 ", 1: "" };
    const lines = active.map((x, i) => {
      let due = "";
      if (x.due) due = x.due < today ? "(" + x.due + " ⚠️逾期)" : x.due === today ? "(今天)" : "(" + x.due + ")";
      return (i + 1) + ". " + prioMark[x.priority] + x.content + due;
    });
    return "📋 待辦清單(" + active.length + " 筆)\n\n" + lines.join("\n") + "\n\n完成請回覆:完成 1";
  }

  /* 完成第 N 筆 */
  m = t.match(/^完成\s*(\d+)$/);
  if (m) {
    const idx = Number(m[1]) - 1;
    const active = sortActive(tasks);
    if (idx < 0 || idx >= active.length) return "找不到第 " + m[1] + " 筆,目前清單有 " + active.length + " 筆。先傳「待辦事項」看編號喔。";
    const target = active[idx];
    tasks = tasks.map(x => x.id === target.id ? Object.assign({}, x, { done: true, completedAt: new Date().toISOString() }) : x);
    await env.TODO_KV.put("todos", JSON.stringify(tasks));
    const remain = tasks.filter(x => !x.done).length;
    return "🎉 已完成:\n「" + target.content + "」\n\n還剩 " + remain + " 筆待完成";
  }

  return LINE_HELP;
}

/* ---------------- Google Calendar ---------------- */

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const pad2 = n => (n < 10 ? "0" : "") + n;

/* 台灣時區 (UTC+8) 往後 offsetDays 天的年月日 */
function twDateParts(offsetDays) {
  const d = new Date(Date.now() + (8 * 3600 + (offsetDays || 0) * 86400) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
}

function b64url(str) { return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return b64url(bin);
}

async function googleAccessToken(env) {
  if (!env.GOOGLE_SA_KEY || !env.GOOGLE_CALENDAR_ID) {
    throw new Error("行事曆尚未設定(缺 GOOGLE_SA_KEY 或 GOOGLE_CALENDAR_ID)");
  }
  const cached = await env.TODO_KV.get("gcal_token", "json");
  if (cached && cached.exp > Math.floor(Date.now() / 1000) + 60) return cached.token;

  let sa;
  try { sa = JSON.parse(env.GOOGLE_SA_KEY); } catch (e) { throw new Error("GOOGLE_SA_KEY 不是有效的 JSON,請貼上金鑰檔的完整內容"); }

  const now = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));

  const pem = String(sa.private_key || "").replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(input));
  const jwt = input + "." + b64urlBytes(new Uint8Array(sig));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google 授權失敗:" + (j.error_description || j.error || res.status));
  await env.TODO_KV.put("gcal_token", JSON.stringify({ token: j.access_token, exp: now + 3500 }), { expirationTtl: 3500 });
  return j.access_token;
}

/* 解析開頭的「日期 [時間]」,支援 今天/明天/後天、7/10、2026/7/10、14:00、下午2點、2點半
   日期或時間都可以單獨出現;回傳 {y,mo,da(可為 null), hh,mm(hh 可為 null), rest} */
function parseWhen(text) {
  let rest = String(text || "").trim();
  let y = null, mo = null, da = null;

  let m = rest.match(/^(今天|明天|後天)\s*/);
  if (m) {
    const off = m[1] === "今天" ? 0 : m[1] === "明天" ? 1 : 2;
    const p = twDateParts(off); y = p.y; mo = p.m; da = p.d;
    rest = rest.slice(m[0].length);
  } else if ((m = rest.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*/))) {
    y = +m[1]; mo = +m[2]; da = +m[3]; rest = rest.slice(m[0].length);
  } else if ((m = rest.match(/^(\d{1,2})[\/\-](\d{1,2})\s*/))) {
    const p = twDateParts(0); y = p.y; mo = +m[1]; da = +m[2]; rest = rest.slice(m[0].length);
  }

  let hh = null, mm = 0;
  const fixAmPm = (prefix, h) => {
    if ((prefix === "下午" || prefix === "晚上") && h < 12) return h + 12;
    return h;
  };
  if ((m = rest.match(/^(上午|早上|中午|下午|晚上)?\s*(\d{1,2})[::](\d{2})\s*/))) {
    hh = fixAmPm(m[1], +m[2]); mm = +m[3]; rest = rest.slice(m[0].length);
  } else if ((m = rest.match(/^(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*點\s*(半)?\s*/))) {
    hh = fixAmPm(m[1], +m[2]); mm = m[3] ? 30 : 0; rest = rest.slice(m[0].length);
  }

  return { y: y, mo: mo, da: da, hh: hh, mm: mm, rest: rest };
}

/* 解析「日期 [時間] 內容 [@地點]」(新增行程用,日期必填) */
function parseSchedule(text) {
  const w = parseWhen(text);
  if (w.y === null) return null;

  let title = w.rest.trim();
  let location = null;
  const lm = title.match(/[@＠]\s*(.+)$/);
  if (lm) { location = lm[1].trim(); title = title.slice(0, lm.index).trim(); }
  if (!title) return null;
  return { y: w.y, mo: w.mo, da: w.da, hh: w.hh, mm: w.mm, title: title, location: location };
}

/* ms(UTC) -> 台灣時間的 ISO 字串 */
function isoTW(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) +
    "T" + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":00+08:00";
}
function nextDayStr(dateStr) {
  const p = dateStr.split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + 86400000);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function mdText(dateStr) { const p = dateStr.split("-"); return (+p[1]) + "/" + (+p[2]); }

async function gcalAdd(text, env) {
  const p = parseSchedule(text);
  if (!p) {
    return "格式看不懂 😅 請用:\n行程 : 日期 時間 內容 @地點\n例如「行程 : 明天 14:00 拜訪宏益 @宜兒樂澄清店」\n或「行程 : 7/10 出差台中」(全天,地點可省略)";
  }
  const token = await googleAccessToken(env);
  const dateStr = p.y + "-" + pad2(p.mo) + "-" + pad2(p.da);
  const ev = { summary: p.title };
  if (p.location) ev.location = p.location;
  let whenText;
  if (p.hh === null) {
    const next = new Date(Date.UTC(p.y, p.mo - 1, p.da) + 86400000);
    ev.start = { date: dateStr };
    ev.end = { date: next.getUTCFullYear() + "-" + pad2(next.getUTCMonth() + 1) + "-" + pad2(next.getUTCDate()) };
    whenText = p.mo + "/" + p.da + " 全天";
  } else {
    const endH = p.hh + 1;
    ev.start = { dateTime: dateStr + "T" + pad2(p.hh) + ":" + pad2(p.mm) + ":00+08:00", timeZone: "Asia/Taipei" };
    ev.end = { dateTime: dateStr + "T" + pad2(Math.min(endH, 23)) + ":" + pad2(endH > 23 ? 59 : p.mm) + ":00+08:00", timeZone: "Asia/Taipei" };
    whenText = p.mo + "/" + p.da + " " + pad2(p.hh) + ":" + pad2(p.mm);
  }
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + token },
    body: JSON.stringify(ev)
  });
  const j = await res.json();
  if (!res.ok) throw new Error((j.error && j.error.message) || ("HTTP " + res.status));
  return "📅 已加入行事曆:\n「" + p.title + "」\n" + whenText + (p.location ? "\n📍 " + p.location : "");
}

async function gcalListRange(fromDays, toDays, label, env) {
  const a = twDateParts(fromDays), b = twDateParts(toDays);
  const timeMin = a.y + "-" + pad2(a.m) + "-" + pad2(a.d) + "T00:00:00+08:00";
  const timeMax = b.y + "-" + pad2(b.m) + "-" + pad2(b.d) + "T00:00:00+08:00";
  return gcalListBetween(timeMin, timeMax, label, env);
}

async function gcalListMonth(offsetMonths, env) {
  const p = twDateParts(0);
  let y = p.y, m = p.m + (offsetMonths || 0);
  while (m > 12) { m -= 12; y++; }
  let y2 = y, m2 = m + 1;
  if (m2 > 12) { m2 = 1; y2++; }
  const timeMin = y + "-" + pad2(m) + "-01T00:00:00+08:00";
  const timeMax = y2 + "-" + pad2(m2) + "-01T00:00:00+08:00";
  return gcalListBetween(timeMin, timeMax, m + " 月", env);
}

async function gcalListBetween(timeMin, timeMax, label, env) {
  const token = await googleAccessToken(env);
  const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events" +
    "?singleEvents=true&orderBy=startTime&maxResults=100" +
    "&timeMin=" + encodeURIComponent(timeMin) + "&timeMax=" + encodeURIComponent(timeMax);
  const res = await fetch(url, { headers: { "authorization": "Bearer " + token } });
  const j = await res.json();
  if (!res.ok) throw new Error((j.error && j.error.message) || ("HTTP " + res.status));
  const items = j.items || [];
  if (!items.length) return "📅 " + label + "沒有安排行程,好好休息 😌";

  const lines = [];
  const mapping = [];   // 記住編號對應,給「改行程 N / 刪行程 N」用
  let lastDate = "";
  for (const ev of items) {
    let dateKey, timeText;
    if (ev.start && ev.start.dateTime) {
      const s = ev.start.dateTime;                       // e.g. 2026-07-03T14:00:00+08:00
      dateKey = s.slice(0, 10);
      timeText = s.slice(11, 16);
    } else if (ev.start && ev.start.date) {
      dateKey = ev.start.date;
      timeText = "全天";
    } else { continue; }
    if (dateKey !== lastDate) {
      const dd = dateKey.split("-");
      const wd = new Date(Date.UTC(+dd[0], +dd[1] - 1, +dd[2])).getUTCDay();
      lines.push((lines.length ? "\n" : "") + "▍" + (+dd[1]) + "/" + (+dd[2]) + "(" + WEEKDAY[wd] + ")");
      lastDate = dateKey;
    }
    let durMin = null;
    if (ev.start && ev.start.dateTime && ev.end && ev.end.dateTime) {
      durMin = Math.round((Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)) / 60000);
    }
    mapping.push({ id: ev.id, summary: ev.summary || "(未命名)", date: dateKey, time: timeText === "全天" ? null : timeText, durMin: durMin });
    lines.push(mapping.length + ". " + timeText + "　" + (ev.summary || "(未命名)") + (ev.location ? "\n　📍 " + ev.location : ""));
  }
  await env.TODO_KV.put("gcal_last_list", JSON.stringify(mapping), { expirationTtl: 86400 });
  return "📅 " + label + "的行程\n\n" + lines.join("\n") +
    "\n\n改期:改行程 1 明天 15:00\n刪除:刪行程 1";
}

async function gcalModify(n, whenText, env) {
  const list = (await env.TODO_KV.get("gcal_last_list", "json")) || [];
  if (!list.length) return "請先傳「本週行程」(或今天/明天行程)看編號,再用「改行程 編號 新時間」";
  if (n < 1 || n > list.length) return "找不到第 " + n + " 筆,上次清單共 " + list.length + " 筆。先傳「本週行程」確認編號喔。";
  const it = list[n - 1];

  const w = parseWhen(whenText);
  if (w.y === null && w.hh === null) {
    return "格式:改行程 " + n + " 明天 15:00\n(只給日期=時間照舊;只給時間=日期照舊)";
  }

  const newDate = w.y !== null ? (w.y + "-" + pad2(w.mo) + "-" + pad2(w.da)) : it.date;
  let hh = null, mm = 0;
  if (w.hh !== null) { hh = w.hh; mm = w.mm; }
  else if (it.time) { hh = +it.time.slice(0, 2); mm = +it.time.slice(3, 5); }

  let body, newWhen;
  if (hh === null) {
    body = { start: { date: newDate, dateTime: null }, end: { date: nextDayStr(newDate), dateTime: null } };
    newWhen = mdText(newDate) + " 全天";
  } else {
    const dur = it.durMin || 60;
    const startMs = Date.parse(newDate + "T" + pad2(hh) + ":" + pad2(mm) + ":00+08:00");
    body = {
      start: { dateTime: isoTW(startMs), date: null, timeZone: "Asia/Taipei" },
      end: { dateTime: isoTW(startMs + dur * 60000), date: null, timeZone: "Asia/Taipei" }
    };
    newWhen = mdText(newDate) + " " + pad2(hh) + ":" + pad2(mm);
  }

  const token = await googleAccessToken(env);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events/" + encodeURIComponent(it.id), {
    method: "PATCH",
    headers: { "content-type": "application/json", "authorization": "Bearer " + token },
    body: JSON.stringify(body)
  });
  const j = await res.json();
  if (!res.ok) throw new Error((j.error && j.error.message) || ("HTTP " + res.status));

  it.date = newDate; it.time = hh === null ? null : pad2(hh) + ":" + pad2(mm);
  await env.TODO_KV.put("gcal_last_list", JSON.stringify(list), { expirationTtl: 86400 });
  return "🔁 已改期:\n「" + it.summary + "」\n新時間:" + newWhen;
}

async function gcalDelete(n, env) {
  const list = (await env.TODO_KV.get("gcal_last_list", "json")) || [];
  if (!list.length) return "請先傳「本週行程」(或今天/明天行程)看編號,再用「刪行程 編號」";
  if (n < 1 || n > list.length) return "找不到第 " + n + " 筆,上次清單共 " + list.length + " 筆。先傳「本週行程」確認編號喔。";
  const it = list[n - 1];

  const token = await googleAccessToken(env);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events/" + encodeURIComponent(it.id), {
    method: "DELETE",
    headers: { "authorization": "Bearer " + token }
  });
  if (!res.ok && res.status !== 204 && res.status !== 410) throw new Error("HTTP " + res.status);

  list.splice(n - 1, 1);
  await env.TODO_KV.put("gcal_last_list", JSON.stringify(list), { expirationTtl: 86400 });
  return "🗑 已刪除行程:\n「" + it.summary + "」";
}

const HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#f9f9f7">
<title>我的 Todo</title>
<style>
  :root{--surface-1:#fcfcfb;--page:#f9f9f7;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--baseline:#c3c2b7;--border:rgba(11,11,11,0.10);--series-1:#2a78d6;--series-2:#1baf7a;--status-good:#0ca30c;--status-warning:#fab219;--status-critical:#d03b3b;--shadow:0 1px 2px rgba(11,11,11,.04),0 4px 16px rgba(11,11,11,.05);--field-bg:#fff;}
  @media (prefers-color-scheme:dark){:root{--surface-1:#1a1a19;--page:#0d0d0d;--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#898781;--gridline:#2c2c2a;--baseline:#383835;--border:rgba(255,255,255,.10);--series-1:#3987e5;--series-2:#199e70;--status-good:#0ca30c;--status-warning:#fab219;--status-critical:#d03b3b;--shadow:0 1px 2px rgba(0,0,0,.3),0 4px 16px rgba(0,0,0,.4);--field-bg:#222220;}}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  html{-webkit-text-size-adjust:100%;}
  body{margin:0;background:var(--page);color:var(--text-primary);font-family:system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;}
  .wrap{max-width:920px;margin:0 auto;padding:max(24px,env(safe-area-inset-top)) 18px 64px;}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:24px;}
  h1{font-size:24px;font-weight:700;margin:0 0 4px;letter-spacing:-.01em;}
  .subtitle{color:var(--text-secondary);font-size:13px;margin:0;}
  .icon-btn{flex:none;width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:var(--surface-1);color:var(--text-secondary);font-size:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
  .icon-btn:active{transform:scale(.96);}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
  .tile{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow);}
  .tile .label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;}
  .tile .value{font-size:30px;font-weight:700;line-height:1;letter-spacing:-.02em;}
  .tile .value.good{color:var(--status-good);}.tile .value.warning{color:var(--status-warning);}.tile .value.critical{color:var(--status-critical);}
  .tile .foot{font-size:12px;color:var(--text-secondary);margin-top:8px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;}
  .panel{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);}
  .panel h2{font-size:13px;font-weight:600;margin:0 0 16px;color:var(--text-secondary);}
  .bar-row{display:flex;align-items:center;gap:12px;margin-bottom:13px;}
  .bar-row:last-child{margin-bottom:0;}
  .bar-key{display:flex;align-items:center;gap:8px;width:84px;flex:none;font-size:13px;}
  .swatch{width:10px;height:10px;border-radius:3px;flex:none;}
  .bar-track{flex:1;height:12px;background:var(--gridline);border-radius:6px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:6px;transition:width .4s ease;}
  .bar-val{width:22px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;color:var(--text-secondary);flex:none;}
  .empty-note{color:var(--text-muted);font-size:13px;}
  .ring-wrap{display:flex;align-items:center;gap:18px;}
  .ring{position:relative;width:104px;height:104px;flex:none;}
  .ring svg{transform:rotate(-90deg);}
  .ring .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .ring .center .pct{font-size:23px;font-weight:700;line-height:1;}
  .ring .center .cap{font-size:11px;color:var(--text-muted);margin-top:2px;}
  .ring-legend{font-size:13px;color:var(--text-secondary);}
  .ring-legend div{margin-bottom:6px;display:flex;align-items:center;gap:8px;}
  .add-form{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
  .add-form input[type=text]{flex:1 1 200px;min-width:0;padding:11px 14px;font-size:15px;border-radius:10px;border:1px solid var(--border);background:var(--field-bg);color:var(--text-primary);}
  .add-form input[type=date],.add-form select{padding:11px 12px;font-size:14px;border-radius:10px;border:1px solid var(--border);background:var(--field-bg);color:var(--text-primary);flex:none;}
  input:focus,select:focus,button:focus{outline:2px solid var(--series-1);outline-offset:1px;}
  .btn{padding:11px 18px;font-size:15px;font-weight:600;border-radius:10px;border:none;cursor:pointer;background:var(--series-1);color:#fff;flex:none;}
  .btn:active{transform:scale(.98);}
  .btn:disabled{opacity:.5;cursor:default;}
  .task{display:flex;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid var(--gridline);}
  .task:last-child{border-bottom:none;}
  .check{flex:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--baseline);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:transparent;font-size:14px;transition:all .15s;background:transparent;}
  .check.p1{border-color:var(--status-critical);}.check.p2{border-color:var(--status-warning);}.check.p3{border-color:var(--series-1);}
  .check:hover{background:var(--status-good);border-color:var(--status-good);color:#fff;}
  .check:active{transform:scale(.9);}
  .check.done{background:var(--status-good);border-color:var(--status-good);color:#fff;}
  .task-main{flex:1;min-width:0;}
  .task-name{font-size:15px;font-weight:500;word-break:break-word;}
  .task.completed .task-name{text-decoration:line-through;color:var(--text-muted);}
  .task-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;}
  .pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--border);color:var(--text-secondary);}
  .pill .dot{width:7px;height:7px;border-radius:999px;flex:none;}
  .del{flex:none;margin-left:auto;background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:8px;}
  .del:hover{color:var(--status-critical);background:rgba(208,59,59,.08);}
  .section-toggle{background:none;border:none;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;padding:0;margin-top:6px;}
  .center-card{max-width:460px;margin:8vh auto 0;}
  .setup{background:var(--surface-1);border:1px solid var(--border);border-radius:16px;padding:26px 24px;box-shadow:var(--shadow);}
  .setup h1{font-size:21px;margin-bottom:8px;}
  .setup p{color:var(--text-secondary);font-size:14px;margin:0 0 12px;}
  .setup input{width:100%;padding:12px 14px;font-size:15px;border-radius:10px;border:1px solid var(--border);background:var(--field-bg);color:var(--text-primary);}
  .msg{font-size:13px;margin-top:12px;padding:10px 12px;border-radius:8px;}
  .msg.err{background:rgba(208,59,59,.10);color:var(--status-critical);}
  .hint{font-size:12px;color:var(--text-muted);margin-top:10px;}
  .loading{text-align:center;color:var(--text-muted);padding:60px 0;font-size:15px;}
  footer{margin-top:26px;font-size:12px;color:var(--text-muted);text-align:center;}
  footer a{color:var(--text-muted);cursor:pointer;}
  .saving-tag{font-size:12px;color:var(--text-muted);margin-left:8px;}
  @media (max-width:680px){.tiles{grid-template-columns:repeat(2,1fr);}.grid2{grid-template-columns:1fr;}h1{font-size:21px;}}
</style>
</head>
<body>
<div class="wrap" id="app"><div class="loading">載入中…</div></div>
<script>
(function(){
  var PW_KEY='todo_pw';
  var app=document.getElementById('app');
  var state={tasks:[]};
  var busy=false;
  var PRIO={
    4:{label:'P1 · 緊急',cls:'p1',color:'var(--status-critical)'},
    3:{label:'P2 · 高',cls:'p2',color:'var(--status-warning)'},
    2:{label:'P3 · 中',cls:'p3',color:'var(--series-1)'},
    1:{label:'一般',cls:'',color:'var(--baseline)'}
  };
  function pw(){return localStorage.getItem(PW_KEY)||'';}
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){var m={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};return m[c];});}
  function pad(n){return (n<10?'0':'')+n;}
  function todayStr(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function dueStatus(t){if(!t.due)return 'none';var td=todayStr();if(t.due<td)return 'overdue';if(t.due===td)return 'today';return 'upcoming';}

  function api(action,extra){
    var payload=Object.assign({action:action},extra||{});
    return fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-app-password':pw()},body:JSON.stringify(payload)})
      .then(function(r){
        if(r.status===401){var e=new Error('unauthorized');e.auth=true;throw e;}
        if(!r.ok)throw new Error('HTTP '+r.status);
        return r.json();
      });
  }

  function renderLogin(msg){
    var h=[];
    h.push('<div class="center-card"><div class="setup">');
    h.push('<h1>登入你的 Todo</h1>');
    h.push('<p>請輸入你在 Cloudflare 設定的密碼(APP_PASSWORD)。</p>');
    h.push('<input id="pw" type="password" placeholder="輸入密碼" autocomplete="current-password">');
    h.push('<div style="margin-top:12px"><button class="btn" id="login" style="width:100%">登入</button></div>');
    if(msg)h.push('<div class="msg err">'+esc(msg)+'</div>');
    h.push('<div class="hint">密碼只存在這台裝置的瀏覽器。手機也輸入一次即可。</div>');
    h.push('</div></div>');
    app.innerHTML=h.join('');
    var inp=document.getElementById('pw');
    function go(){var v=inp.value.trim();if(!v)return;localStorage.setItem(PW_KEY,v);load();}
    document.getElementById('login').onclick=go;
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')go();});
    inp.focus();
  }

  function flash(msg,ok){var box=document.getElementById('listMsg');if(box)box.innerHTML='<div class="msg '+(ok?'ok':'err')+'">'+esc(msg)+'</div>';}

  function renderDashboard(savingMsg){
    var active=state.tasks.filter(function(t){return !t.done;});
    var completed=state.tasks.filter(function(t){return t.done;});
    var today=0,overdue=0,high=0;
    active.forEach(function(t){var st=dueStatus(t);if(st==='today')today++;if(st==='overdue')overdue++;if(t.priority>=3)high++;});
    var pctDone=state.tasks.length?Math.round(completed.length/state.tasks.length*100):0;

    var h=[];
    h.push('<header><div><h1>我的 Todo</h1><p class="subtitle">資料存於 Cloudflare KV　•　'+todayStr()+'</p></div><button class="icon-btn" id="gear" title="登出/設定">⚙</button></header>');

    var tiles=[
      {label:'待完成',value:active.length,cls:'',foot:'目前活躍任務'},
      {label:'今日到期',value:today,cls:today?'warning':'',foot:today?'今天要處理':'今天沒有到期'},
      {label:'已逾期',value:overdue,cls:overdue?'critical':'good',foot:overdue?'已過期限':'沒有逾期'},
      {label:'已完成',value:completed.length,cls:'good',foot:pctDone+'% 完成率'}
    ];
    h.push('<section class="tiles">');
    tiles.forEach(function(t){h.push('<div class="tile"><div class="label">'+t.label+'</div><div class="value '+t.cls+'">'+t.value+'</div><div class="foot">'+t.foot+'</div></div>');});
    h.push('</section>');

    var pc={4:0,3:0,2:0,1:0};active.forEach(function(t){pc[t.priority]=(pc[t.priority]||0)+1;});
    var maxP=Math.max(1,pc[4],pc[3],pc[2],pc[1]);
    h.push('<section class="grid2"><div class="panel"><h2>依優先級分佈(待完成)</h2>');
    if(active.length){
      [4,3,2,1].forEach(function(p){
        h.push('<div class="bar-row"><div class="bar-key"><span class="swatch" style="background:'+PRIO[p].color+'"></span>'+PRIO[p].label.split(' · ')[0]+'</div><div class="bar-track"><div class="bar-fill" style="width:'+(pc[p]/maxP*100)+'%;background:'+PRIO[p].color+'"></div></div><div class="bar-val">'+pc[p]+'</div></div>');
      });
    } else { h.push('<div class="empty-note">目前沒有待辦任務</div>'); }
    h.push('</div>');

    var Rr=44,Cc=2*Math.PI*Rr,off=Cc*(1-pctDone/100);
    h.push('<div class="panel"><h2>完成進度</h2><div class="ring-wrap"><div class="ring"><svg width="104" height="104" viewBox="0 0 104 104">');
    h.push('<circle cx="52" cy="52" r="'+Rr+'" fill="none" stroke="var(--gridline)" stroke-width="10"/>');
    h.push('<circle cx="52" cy="52" r="'+Rr+'" fill="none" stroke="var(--status-good)" stroke-width="10" stroke-linecap="round" stroke-dasharray="'+Cc+'" stroke-dashoffset="'+off+'"/>');
    h.push('</svg><div class="center"><div class="pct">'+pctDone+'%</div><div class="cap">完成</div></div></div>');
    h.push('<div class="ring-legend"><div><span class="swatch" style="background:var(--status-good)"></span>已完成 '+completed.length+'</div><div><span class="swatch" style="background:var(--gridline)"></span>待完成 '+active.length+'</div></div></div></div></section>');

    h.push('<section class="panel"><h2>新增與維護任務 '+(savingMsg?'<span class="saving-tag">'+esc(savingMsg)+'</span>':'')+'</h2>');
    h.push('<form class="add-form" id="addForm"><input type="text" id="newContent" placeholder="輸入新任務…" autocomplete="off"><input type="date" id="newDue" title="截止日(可留空)"><select id="newPrio"><option value="1">一般</option><option value="2">P3 中</option><option value="3">P2 高</option><option value="4">P1 緊急</option></select><button class="btn" type="submit">＋ 新增</button></form>');
    h.push('<div id="listMsg"></div><div id="taskList">');

    var rank=function(t){var s=dueStatus(t);return s==='overdue'?0:s==='today'?1:2;};
    var sorted=active.slice().sort(function(a,b){return rank(a)-rank(b)||b.priority-a.priority||String(a.createdAt||'').localeCompare(String(b.createdAt||''));});
    if(sorted.length){
      sorted.forEach(function(t){
        var p=PRIO[t.priority]||PRIO[1];var st=dueStatus(t);
        var dueCol=st==='overdue'?'var(--status-critical)':st==='today'?'var(--status-warning)':'var(--series-1)';
        h.push('<div class="task" data-id="'+t.id+'"><div class="check '+p.cls+'" data-act="complete" data-id="'+t.id+'" title="標記完成">✓</div><div class="task-main"><div class="task-name">'+esc(t.content)+'</div><div class="task-meta">');
        if(t.priority>1)h.push('<span class="pill"><span class="dot" style="background:'+p.color+'"></span>'+p.label+'</span>');
        if(t.due)h.push('<span class="pill"><span class="dot" style="background:'+dueCol+'"></span>'+esc(t.due)+(st==='today'?' · 今天':st==='overdue'?' · 逾期':'')+'</span>');
        h.push('</div></div><button class="del" data-act="delete" data-id="'+t.id+'" title="刪除">🗑</button></div>');
      });
    } else { h.push('<div class="empty-note">🎉 沒有待辦任務,全部清空了!</div>'); }
    h.push('</div>');

    if(completed.length){
      h.push('<button class="section-toggle" id="toggleDone">已完成 ('+completed.length+') ▾</button><div id="doneList" style="display:none;margin-top:8px">');
      completed.slice().reverse().forEach(function(t){
        h.push('<div class="task completed" data-id="'+t.id+'"><div class="check done" data-act="reopen" data-id="'+t.id+'" title="取消完成">✓</div><div class="task-main"><div class="task-name">'+esc(t.content)+'</div></div><button class="del" data-act="delete" data-id="'+t.id+'" title="刪除">🗑</button></div>');
      });
      h.push('</div>');
    }
    h.push('</section>');
    h.push('<footer>資料儲存在你的 Cloudflare KV　·　<a id="reload">重新整理</a></footer>');

    app.innerHTML=h.join('');
    document.getElementById('gear').onclick=logout;
    document.getElementById('reload').onclick=function(){load();};
    document.getElementById('addForm').onsubmit=onAdd;
    var tg=document.getElementById('toggleDone');
    if(tg)tg.onclick=function(){var l=document.getElementById('doneList');var open=l.style.display!=='none';l.style.display=open?'none':'block';tg.textContent='已完成 ('+completed.length+') '+(open?'▾':'▴');};
    var nodes=app.querySelectorAll('[data-act]');
    for(var i=0;i<nodes.length;i++){(function(el){el.onclick=function(){onAction(el.getAttribute('data-act'),el.getAttribute('data-id'));};})(nodes[i]);}
  }

  function logout(){if(confirm('要登出這台裝置嗎?(需要重新輸入密碼)')){localStorage.removeItem(PW_KEY);renderLogin();}}

  function onAdd(e){
    e.preventDefault();
    var inp=document.getElementById('newContent');
    var due=document.getElementById('newDue');
    var prio=document.getElementById('newPrio');
    var content=inp.value.trim();
    if(!content)return;
    act('add',{content:content,priority:Number(prio.value),due:due.value||null},'新增中…');
  }

  function onAction(action,id){
    if(action==='delete'&&!confirm('確定刪除這個任務?'))return;
    var label=action==='complete'?'完成中…':action==='reopen'?'還原中…':action==='delete'?'刪除中…':'儲存中…';
    act(action,{id:id},label);
  }

  function act(action,extra,savingMsg){
    if(busy)return;busy=true;
    renderDashboard(savingMsg||'儲存中…');
    api(action,extra).then(function(res){state.tasks=res.tasks||state.tasks;busy=false;renderDashboard();})
    .catch(function(err){busy=false;
      if(err.auth){localStorage.removeItem(PW_KEY);renderLogin('密碼失效,請重新登入。');return;}
      renderDashboard();flash('操作失敗:'+err.message,false);
    });
  }

  function load(){
    if(!pw()){renderLogin();return;}
    app.innerHTML='<div class="loading">載入中…</div>';
    api('list').then(function(res){state.tasks=res.tasks||[];renderDashboard();})
    .catch(function(err){
      if(err.auth){localStorage.removeItem(PW_KEY);renderLogin('密碼錯誤,請再試一次。');return;}
      var h='<div class="center-card"><div class="setup"><h1>無法連線</h1><p>'+esc(err.message)+'</p><button class="btn" id="retry">重試</button></div></div>';
      app.innerHTML=h;var r=document.getElementById('retry');if(r)r.onclick=function(){load();};
    });
  }

  load();
})();
</script>
</body>
</html>`;
