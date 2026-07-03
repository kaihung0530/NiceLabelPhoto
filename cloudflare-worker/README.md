# 我的 Todo — Cloudflare Worker(前端 + 後端 + KV 一體)

一個單一檔案的 Cloudflare Worker：同時提供 dashboard 網頁、後端 API,並把任務資料存在 Cloudflare KV。
全部同源,沒有 CORS 問題,資料由你自己掌控。

- `worker.js` — 完整程式(複製貼上即可用)

---

## 設定步驟(約 10 分鐘,一次就好)

### 1. 註冊 / 登入 Cloudflare
到 https://dash.cloudflare.com/sign-up 用 email 註冊(免費、不用信用卡)。

### 2. 建一個 Worker
1. 左側選 **Workers & Pages** → **Create application** → **Create Worker**
2. 取個名字(例如 `my-todo`)→ **Deploy**(先部署一個預設版本)
3. 部署後點 **Edit code**,把整個 `worker.js` 的內容**全選貼上**取代預設程式 → 右上 **Deploy**

### 3. 建立 KV 資料庫並綁定
1. 左側 **Storage & Databases** → **KV** → **Create a namespace**,名稱例如 `todos`
2. 回到你的 Worker → **Settings** → **Bindings**(或 Variables)→ **Add binding** → **KV Namespace**
   - Variable name(變數名稱)填:**`TODO_KV`**(一定要一模一樣)
   - KV namespace 選你剛建的 `todos`
   - 儲存

### 4. 設定登入密碼
1. 同樣在 Worker 的 **Settings** → **Variables and Secrets**
2. **Add** 一個變數:
   - 名稱:**`APP_PASSWORD`**(一定要一模一樣)
   - 值:自己想一個密碼(例如 `MyTodo2026!`)
   - 類型建議選 **Secret**(加密)
3. 儲存後 **Deploy** 一次讓設定生效

### 5. 開始使用
- 你的網址是:`https://my-todo.<你的帳號>.workers.dev`(在 Worker 頁面上方可看到)
- 手機/電腦打開 → 輸入你設的密碼 → 就能新增、打勾完成、刪除,資料存在 KV
- 手機可用「分享 → 加入主畫面」當成 App

---

## 需要的綁定總表

| 種類 | 名稱 | 值 |
|---|---|---|
| KV Namespace binding | `TODO_KV` | 你建的 KV namespace |
| 環境變數 / Secret | `APP_PASSWORD` | 你的登入密碼 |

## 注意事項
- KV 是「最終一致」:同一秒在兩台裝置各改一次,偶爾其中一台要重新整理才看到最新。個人單人使用基本無感。
- 免費額度:每天 10 萬次讀取、1000 次寫入,個人用綽綽有餘。

## 未來擴充(預留)
之後要加 **LINE bot**,可在同一個 Worker 增加一個 `/line` 路由當 webhook,共用同一份 KV 資料。
