# 派工查詢 bot — 從零開始設定手冊

一個**獨立**的 LINE bot + Cloudflare Worker,和你的個人 todo bot 完全分開。
工程師傳「工號(empNo)」→ 回他今天的行程(客戶、內容、車號、地址+導航)。

---

## ⚠️ 動工前一定要先確認:MIS API 的「埠」與 HTTPS

**Cloudflare Worker 對外連線只允許特定的埠**,你的 API 目前是 `http://mis.barwand.com.tw:8882`,**埠 8882 很可能不被 Worker 允許**,會連不到。

Worker 允許的埠:
- HTTP:80、8080、8880、2052、2082、2086、2095
- HTTPS:443、8443、2053、2083、2087、2096

**建議(一次解決兩個問題):把 MIS API 對外開在 `https://mis.barwand.com.tw`(443 埠)並加上 HTTPS 憑證**(Let's Encrypt 免費,或用 IIS/反向代理綁憑證)。這樣:
1. Worker 連得到(443 在允許清單)
2. 客戶地址、帳密、token 不再明文傳輸(安全)

設定好之後,把下面 `MIS_BASE` 改成新網址即可。
> 若暫時只能用 8882 測試:先把 API 換到 **8880**(允許清單內)也可以先動起來,但仍是 http 未加密,正式上線請上 443+HTTPS。

---

## 步驟 1:建立新的 LINE bot(Messaging API channel)

1. 到 https://developers.line.biz/console/ 登入
2. 選一個 Provider(沒有就建一個,例如公司名)→ **Create a new channel** → **Messaging API**
3. 填名稱(例如「派工通知」)、類別等 → 建立
4. 兩把金鑰待會要用:
   - **Channel secret**:**Basic settings** 分頁 → Channel secret
   - **Channel access token**:**Messaging API** 分頁 → Channel access token → **Issue** → 複製
5. **Messaging API** 分頁把 **Auto-reply messages** 設為 **Disabled**(不然每句多一條罐頭)

## 步驟 2:建立新的 Cloudflare Worker

1. Cloudflare → **Workers 和 Pages** → **建立應用程式** → **Create Worker / Hello World**
2. 取名(例如 `dispatch`)→ **部署**
3. **編輯程式碼** → 把 `dispatch-worker/worker.js` **整份貼上取代** → **Deploy**
4. 記下網址,形如 `https://dispatch.你的帳號.workers.dev`

## 步驟 3:建立 KV 並綁定

1. **儲存體和資料庫 → KV** → **建立命名空間**,名稱例如 `dispatch`
2. 你的 Worker → **繫結** → **新增繫結** → **KV 命名空間**
   - 變數名稱:`DISPATCH_KV`(⚠️ 一字不差)
   - 命名空間:選 `dispatch` → 儲存

## 步驟 4:設定機密(帳密與金鑰)

Worker → **設定 → 變數與機密**,新增以下(類型都選 **機密 / Secret**):

| 名稱 | 值 |
|---|---|
| `LINE_CHANNEL_SECRET` | 派工 bot 的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 派工 bot 的 access token |
| `MIS_USER` | MIS 管理者帳號(能查所有人的那組) |
| `MIS_PASS` | MIS 管理者密碼 |

(選填)若 API 換了網址,再加一個**變數** `MIS_BASE` = 新的 base(例如 `https://mis.barwand.com.tw`)。沒設就用預設 `http://mis.barwand.com.tw:8882`。

設定完 **Deploy** 一次。

> 註:帳密放在「機密」比放 KV 更安全(加密、讀不到),效果一樣是「只存一組管理者帳密」。token 會自動登入取得並快取在 KV,過期自動續期。

## 步驟 5:設定 Webhook

LINE Developers → 你的派工 channel → **Messaging API** → Webhook settings:
1. **Webhook URL**:`https://dispatch.你的帳號.workers.dev/line`
2. 打開 **Use webhook**
3. 按 **Verify** → 應顯示 **Success**

## 步驟 6:測試 ✅

1. 用 **Messaging API** 分頁的 QR code 加這個派工 bot 好友
2. 傳你的**工號**(例如 `kai`)→ 應回今天的行程卡片(客戶、內容、車號、地址+導航按鈕)
3. 之後傳 `今天` 或 `查詢` → 用同一個工號再查一次

---

## 工程師怎麼用

| 傳給 bot | 回覆 |
|---|---|
| `kai`(自己的工號) | 今天的派工行程,並記住工號 |
| `今天` / `查詢` | 用記住的工號再查一次 |
| `help` | 使用說明 |

每筆行程會顯示:🏢 客戶名稱、服務內容、🚗 車號(有才顯示)、📍 地址 +「🧭 開啟導航」按鈕。

## 費用
- Cloudflare Worker + KV:免費額度綽綽有餘
- LINE:工程師「主動查詢」= 用**回覆**(免費且無限),不吃推播額度 → **全程免費**

## 疑難排解

| 症狀 | 原因/解法 |
|---|---|
| 傳工號回「查詢發生問題… (連線失敗 / fetch)」 | **最可能是埠問題**:Worker 連不到 8882。把 API 換到 443(HTTPS)或允許清單內的埠,並設 `MIS_BASE` |
| 回「MIS 登入失敗」 | `MIS_USER`/`MIS_PASS` 不對,或登入路徑不同 |
| 回「查詢失敗 (HTTP 401)」持續 | 該管理者帳號沒有查其他 empNo 的權限 |
| Verify 失敗 | Webhook URL 要以 `/line` 結尾;`LINE_CHANNEL_SECRET` 要對 |
| bot 已讀不回 | Use webhook 沒開,或 access token 沒設/貼錯 |

## 未來擴充(等你們開回寫 API)
- 「完成 1/2/3」回寫完成時間+狀態 → 需要 MIS 提供「更新完成」API,且 Schedule 回傳每筆帶**唯一工單編號**(目前沒有)
- 每天早上自動推播各工程師行程 → 需要 LINE 綁定 userId + 可能升級 LINE 付費方案(推播才計費)
