/**
 * 派工查詢 bot — 獨立 Cloudflare Worker
 * 工程師傳 empNo(工號)→ 回傳他「今天」的行程(companyName / serContent / carNo / address1)
 *
 * 需要綁定:
 *   - KV Namespace binding，變數名稱: DISPATCH_KV   (快取 MIS token + 記住工程師工號)
 *   - 機密 LINE_CHANNEL_SECRET        (派工 bot 的 channel secret)
 *   - 機密 LINE_CHANNEL_ACCESS_TOKEN  (派工 bot 的 access token)
 *   - 機密 MIS_USER                   (MIS 管理者帳號 userName)
 *   - 機密 MIS_PASS                   (MIS 管理者密碼)
 *   - (選填) 變數 MIS_BASE            (預設 http://mis.barwand.com.tw:8882)
 *
 * 路由:
 *   GET  /      -> 健康檢查
 *   POST /line  -> LINE webhook
 *
 * 工程師操作:
 *   傳「kai」(工號)     -> 回今天的行程,並記住這個工號
 *   傳「今天 / 查詢」     -> 用記住的工號再查一次
 */

const DEFAULT_BASE = "http://mis.barwand.com.tw:8882";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/line") return handleLine(request, env);
    if (url.pathname === "/") return new Response("dispatch bot ok");
    return new Response("Not found", { status: 404 });
  }
};

/* ---------------- 小工具 ---------------- */
const pad2 = n => (n < 10 ? "0" : "") + n;
function twParts(offsetDays) {
  const d = new Date(Date.now() + (8 * 3600 + (offsetDays || 0) * 86400) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
function twTodaySlash() { const p = twParts(0); return p.y + "/" + pad2(p.m) + "/" + pad2(p.d); }
function misBase(env) { return (env.MIS_BASE || DEFAULT_BASE).replace(/\/+$/, ""); }
function b64urlDecode(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return atob(s); }
function jwtExp(token) {
  try { const p = JSON.parse(b64urlDecode(String(token).split(".")[1])); return p.exp || null; }
  catch (e) { return null; }
}

/* ---------------- MIS 登入 / token 自動續期 ---------------- */
async function misLogin(env) {
  if (!env.MIS_USER || !env.MIS_PASS) throw new Error("尚未設定 MIS_USER / MIS_PASS");
  const res = await fetch(misBase(env) + "/login", {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "*/*" },
    body: JSON.stringify({ userName: env.MIS_USER, password: env.MIS_PASS })
  });
  if (!res.ok) throw new Error("MIS 登入失敗 (HTTP " + res.status + ")");
  const j = await res.json();
  if (!j.accessToken) throw new Error("MIS 登入沒有回傳 token");
  const now = Math.floor(Date.now() / 1000);
  const exp = jwtExp(j.accessToken) || (now + 3000);
  await env.DISPATCH_KV.put("mis_token", JSON.stringify({ token: j.accessToken, exp: exp }),
    { expirationTtl: Math.max(60, exp - now - 30) });
  return j.accessToken;
}

async function misToken(env) {
  const cached = await env.DISPATCH_KV.get("mis_token", "json");
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.token && cached.exp > now + 60) return cached.token;
  return misLogin(env);
}

async function misSchedule(empNo, dateSlash, env) {
  const path = "/api/Schedule?dateTimeString=" + encodeURIComponent(dateSlash) + "&empNo=" + encodeURIComponent(empNo);
  let token = await misToken(env);
  let res = await fetch(misBase(env) + path, { headers: { "authorization": "Bearer " + token, "accept": "*/*" } });
  if (res.status === 401) {                 // token 失效 → 重新登入再試一次
    token = await misLogin(env);
    res = await fetch(misBase(env) + path, { headers: { "authorization": "Bearer " + token, "accept": "*/*" } });
  }
  if (!res.ok) throw new Error("查詢失敗 (HTTP " + res.status + ")");
  const j = await res.json();
  return (j && Array.isArray(j.data)) ? j.data : [];
}

/* ---------------- LINE ---------------- */
function toLineMessages(payload) {
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.filter(m => m != null)
    .map(m => (typeof m === "string") ? { type: "text", text: m.slice(0, 4900) } : m)
    .slice(0, 5);
}
async function lineReply(replyToken, payload, token) {
  if (!token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + token },
      body: JSON.stringify({ replyToken: replyToken, messages: toLineMessages(payload) })
    });
  } catch (e) { /* ignore */ }
}
async function verifyLineSignature(body, signature, secret) {
  if (!secret || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = new Uint8Array(mac);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin) === signature;
}
function mapsLink(loc) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(loc); }
function navButton(loc) {
  return { type: "button", style: "link", height: "sm", action: { type: "uri", label: "🧭 開啟導航", uri: mapsLink(loc) } };
}

async function handleLine(request, env) {
  if (request.method !== "POST") return new Response("ok");
  const bodyText = await request.text();
  const sig = request.headers.get("x-line-signature") || "";
  if (!(await verifyLineSignature(bodyText, sig, env.LINE_CHANNEL_SECRET))) return new Response("bad signature", { status: 403 });

  let body; try { body = JSON.parse(bodyText); } catch (e) { body = {}; }
  for (const ev of (body.events || [])) {
    if (ev.type === "message" && ev.message && ev.message.type === "text" && ev.replyToken) {
      const userId = ev.source && ev.source.userId;
      const reply = await processDispatch(ev.message.text, userId, env);
      if (reply) await lineReply(ev.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
    }
  }
  return new Response("ok");
}

const HELP = [
  "🛠 派工查詢",
  "",
  "傳你的「工號」就能查今天的行程,例如:",
  "　kai",
  "",
  "查過一次後,之後直接傳:",
  "　今天  或  查詢",
  "就會用同一個工號再查一次。"
].join("\n");

function s(v) { return (v == null ? "" : String(v)).trim(); }

async function processDispatch(text, userId, env) {
  const t = s(text);
  if (!t) return HELP;
  if (/^(help|說明|\?|？|指令)$/i.test(t)) return HELP;

  let empNo;
  if (/^(今天|今日|查詢|查|我的行程|行程|今天行程|今日行程|我的工作)$/.test(t)) {
    empNo = userId ? await env.DISPATCH_KV.get("emp:" + userId) : null;
    if (!empNo) return "請先傳你的工號(例如 kai),我就會記住你,之後傳「今天」即可 🙂";
  } else {
    empNo = t;                                   // 把訊息當工號
  }

  let data;
  try {
    data = await misSchedule(empNo, twTodaySlash(), env);
  } catch (e) {
    return "❌ 查詢發生問題:" + e.message + "\n請稍後再試,或聯絡管理員。";
  }

  // 記住這個工號(下次可用「今天」)
  if (userId) await env.DISPATCH_KV.put("emp:" + userId, empNo, { expirationTtl: 60 * 60 * 24 * 120 });

  if (!data.length) return "📋 工號「" + empNo + "」今天沒有派工行程(若工號有誤請確認)。";
  return buildScheduleFlex(empNo, data);
}

function buildScheduleFlex(empNo, data) {
  const who = s(data[0] && data[0].empCName) || empNo;
  const shown = data.slice(0, 20);
  const body = [{ type: "text", text: "📋 " + who + " 今天的行程(" + data.length + " 筆)", weight: "bold", size: "md", wrap: true }];

  shown.forEach((it, i) => {
    if (i > 0) body.push({ type: "separator", margin: "lg" });
    const company = s(it.companyName) || s(it.callName) || "(未填客戶)";
    body.push({ type: "text", text: "🏢 " + company, weight: "bold", size: "sm", wrap: true, margin: "md" });
    const ser = s(it.serContent).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (ser) body.push({ type: "text", text: ser, size: "sm", wrap: true, color: "#333333" });
    if (s(it.carNo)) body.push({ type: "text", text: "🚗 車號:" + s(it.carNo), size: "xs", color: "#666666" });
    if (s(it.address1)) {
      body.push({ type: "text", text: "📍 " + s(it.address1), size: "xs", color: "#999999", wrap: true });
      body.push(navButton(s(it.address1)));
    }
  });
  if (data.length > 20) body.push({ type: "text", text: "(僅顯示前 20 筆)", size: "xs", color: "#999999", margin: "md" });

  return { type: "flex", altText: "📋 " + who + " 今天的行程(" + data.length + " 筆)",
    contents: { type: "bubble", size: "mega", body: { type: "box", layout: "vertical", spacing: "none", contents: body } } };
}
