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

## LINE bot(已內建)

同一個 Worker 的 `/line` 路由就是 LINE webhook,與 dashboard 共用同一份 KV 資料。

### 支援指令
| 你傳的訊息 | bot 動作 |
|---|---|
| `待辦 : 內容`(全形/半形冒號皆可) | 新增一筆待辦並回覆確認 |
| `待辦事項`(或 `待辦清單`) | 列出目前待辦(逾期/今天優先、標優先級) |
| `完成 2` | 完成清單上第 2 筆 |
| `行程 : 明天 14:00 拜訪宏益 @宜兒樂澄清店` | 建立 Google 日曆活動(預設 1 小時,`@地點` 會填到位置欄,可省略) |
| `行程 : 7/10 出差台中` | 建立全天活動 |
| `今天行程` / `明天行程` / `本週行程` / `本月行程` / `下月行程` | 查詢 Google 日曆並回覆編號列表 |
| `改行程 2 明天 15:00` | 把清單第 2 筆改期(只給日期或只給時間也可以) |
| `刪行程 2` | 刪除清單第 2 筆 |
| `今日摘要` | 立即推播今日待辦+行程 |
| 其他文字 | 回覆使用說明 |

日期支援:`今天`/`明天`/`後天`、`7/10`、`2026/7/10`;時間支援:`14:00`、`下午2點`、`2點半`,不寫時間就是全天。

### 設定步驟
1. Worker **設定 → 變數與機密** 再加兩個 Secret:
   - `LINE_CHANNEL_SECRET`:LINE Developers → 你的 channel → **Basic settings** → Channel secret
   - `LINE_CHANNEL_ACCESS_TOKEN`:**Messaging API** 分頁 → Channel access token → **Issue** 後複製
2. 把最新的 `worker.js` 貼進 Worker 編輯器重新 **Deploy**
3. LINE Developers → **Messaging API** 分頁 → Webhook settings:
   - Webhook URL 填:`https://<你的worker網址>/line`
   - 開啟 **Use webhook**,按 **Verify** 應顯示 Success
4. 關閉自動回應:Messaging API 分頁裡把 **Auto-reply messages** 設為 Disabled(不然每句都會多一條罐頭回覆)
5. 用 Messaging API 分頁的 QR code 加 bot 好友,傳「待辦事項」測試

## Google 行事曆(行程功能)

bot 透過「服務帳戶」讀寫你的 Google 日曆。設定一次即可:

1. 到 https://console.cloud.google.com/ 登入 Google → 建立專案(名稱隨意,免費)
2. **API 和服務 → 程式庫** → 搜尋 **Google Calendar API** → **啟用**
3. **IAM 與管理 → 服務帳戶** → **建立服務帳戶**(名稱例如 `line-bot`,權限全部跳過)
4. 點進該服務帳戶 → **金鑰** 分頁 → **新增金鑰 → 建立新的金鑰 → JSON** → 會下載一個 `.json` 檔
5. 在 Worker **設定 → 變數與機密** 加兩個 Secret:
   - `GOOGLE_SA_KEY`:用記事本打開剛下載的 json 檔,**整份內容**複製貼上
   - `GOOGLE_CALENDAR_ID`:你的 Gmail 地址(哪個帳號的日曆就填哪個)
6. 把日曆共用給服務帳戶:打開 Google 日曆(網頁版)→ 左側你的日曆 → **設定與共用** → **與特定使用者共用** → 新增 json 檔裡的 `client_email`(形如 `line-bot@xxx.iam.gserviceaccount.com`)→ 權限選 **「變更活動」**
7. 重新部署 Worker,傳 LINE「今天行程」測試

## 每日自動推播

Worker 內建 `scheduled` 處理:在 Worker 的 **設定 → 觸發事件 → Cron 觸發程序** 新增排程即可,例如 `0 0 * * *`(UTC)= 台灣每天早上 8 點推一則「今日待辦 + 今日行程」。bot 會自動記住最後傳訊息給它的使用者作為推播對象;傳「今日摘要」可隨時手動測試。
