# 我的 Todo + LINE bot + Google 行事曆 — 完整設定手冊

一步一步照做即可。整個系統只有一個 Cloudflare Worker,程式就是這個資料夾裡的 `worker.js`。

## 系統總覽

```
你的手機 / 電腦
 ├── 瀏覽器打開 Worker 網址  → 待辦 Dashboard(看統計、新增、打勾)
 └── LINE 傳訊息給 bot
      ├── 「待辦 : XX」「待辦事項」「完成 2」 → 待辦(存 Cloudflare KV)
      └── 「行程 : XX」「今天行程」「本週行程」 → Google 日曆
```

## 最後要有的設定總表(對照用)

| 在哪裡 | 種類 | 名稱 | 值 |
|---|---|---|---|
| Worker → 繫結 | KV 命名空間 | `TODO_KV` | 選 KV `todos` |
| Worker → 變數與機密 | 機密 | `APP_PASSWORD` | 自己想的 dashboard 登入密碼 |
| Worker → 變數與機密 | 機密 | `LINE_CHANNEL_SECRET` | LINE channel secret |
| Worker → 變數與機密 | 機密 | `LINE_CHANNEL_ACCESS_TOKEN` | LINE access token |
| Worker → 變數與機密 | 機密 | `GOOGLE_SA_KEY` | Google 服務帳戶 JSON 金鑰(整份) |
| Worker → 變數與機密 | 機密 | `GOOGLE_CALENDAR_ID` | 你的 Gmail 地址 |

⚠️ 名稱必須一字不差(全大寫+底線)。每次改完機密/繫結,記得重新 **Deploy** 一次。

---

# 階段 1:Cloudflare Worker + 待辦 Dashboard

### 1-1 註冊 Cloudflare
- 到 https://dash.cloudflare.com/sign-up 用 email 註冊(免費、免信用卡)
- **去信箱點驗證信**(沒驗證的話之後「部署」按鈕會反灰)

### 1-2 建立 Worker
1. 左側 **Workers 和 Pages** → 右上 **建立應用程式** → **Create Worker / 從 Hello World 開始**
2. 取名(例如 `todolist`)→ 等名稱旁出現藍勾 → 按 **部署**
   - 若「部署」一直反灰:確認 email 已驗證;再不行改用**無痕視窗**(擴充功能常擋按鈕)
3. 部署後按 **編輯程式碼**,把 `worker.js` **整份貼上取代**預設程式 → 右上 **Deploy**

### 1-3 建立 KV(存待辦資料的地方)
1. 左側 **儲存體和資料庫 → KV** → **建立命名空間**,名稱 `todos`

### 1-4 綁定 KV 到 Worker
1. 回到你的 Worker → 上方分頁 **繫結** → **新增繫結** → 選 **KV 命名空間**
2. 變數名稱:`TODO_KV`、KV 命名空間:選 `todos` → 儲存

### 1-5 設 Dashboard 登入密碼
1. Worker → **設定 → 變數與機密** → **新增**
2. 類型:**機密(Secret)**、名稱:`APP_PASSWORD`、值:自己想一組密碼 → 儲存 → Deploy

### 1-6 測試 ✅
- 打開你的 Worker 網址(Worker「概觀」頁上方看得到,形如 `https://todolist.xxx.workers.dev`)
- 輸入密碼登入 → 新增一筆任務 → 按 F5 重新整理 → 任務還在 = 成功
- 手機也打開同網址、輸入同密碼;可用「分享 → 加入主畫面」當 App

---

# 階段 2:LINE bot(待辦指令)

前提:你已在 https://developers.line.biz/ 建好 Messaging API channel(bot)。

### 2-1 拿兩把金鑰
- **Channel secret**:你的 channel → **Basic settings** 分頁 → Channel secret
- **Channel access token**:**Messaging API** 分頁最下方 → Channel access token → 按 **Issue** → 複製

### 2-2 加到 Worker
**設定 → 變數與機密** 新增兩個**機密**:
- `LINE_CHANNEL_SECRET` = Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN` = access token
加完 → Deploy

### 2-3 設定 Webhook
LINE Developers → **Messaging API** 分頁 → Webhook settings:
1. **Webhook URL** 填:`https://你的worker網址/line`(dashboard 網址**後面加 `/line`**)
2. 打開 **Use webhook**
3. 按 **Verify** → 應顯示 **Success**

### 2-4 關閉罐頭自動回覆
同一頁 **Auto-reply messages** → **Disabled**(不關的話每句多一條官方罐頭)

### 2-5 測試 ✅
用 Messaging API 分頁的 **QR code** 加 bot 好友,傳:
- `待辦 : 測試一下` → 應回「✅ 已新增待辦」
- `待辦事項` → 應列出清單(dashboard 上也看得到同一筆)
- `完成 1` → 完成清單第 1 筆

---

# 階段 3:Google 行事曆(行程指令)

### 3-1 建 Google Cloud 專案(免費)
1. https://console.cloud.google.com/ 用你的 Google 帳號登入
2. 上方專案選單 → **建立專案**(名稱隨意,例如 `line-bot`)

### 3-2 啟用 Calendar API
左側 **API 和服務 → 程式庫** → 搜尋 **Google Calendar API** → **啟用**

### 3-3 建服務帳戶 + 下載金鑰
1. 左側 **IAM 與管理 → 服務帳戶** → **建立服務帳戶**
   - 名稱:`line-bot`,其餘步驟全部跳過/繼續
2. 點進剛建的服務帳戶 → **金鑰** 分頁 → **新增金鑰 → 建立新的金鑰 → JSON** → 自動下載 `.json` 檔
3. 用記事本打開那個 json 檔,先放著(下一步要用)

### 3-4 加到 Worker
**設定 → 變數與機密** 新增兩個**機密**:
- `GOOGLE_SA_KEY` = json 檔的**整份內容**(從 `{` 到 `}` 全部)
- `GOOGLE_CALENDAR_ID` = 你的 **Gmail 地址**(行事曆是哪個帳號就填哪個)
加完 → Deploy

### 3-5 把日曆共用給 bot(最容易漏掉的一步!)
1. 打開 **Google 日曆網頁版**(calendar.google.com)
2. 左側「我的日曆」找到你的主日曆 → 滑過去按 **⋮ → 設定與共用**
3. **與特定使用者或群組共用** → **新增使用者**
4. 貼上 json 檔裡的 **`client_email`**(形如 `line-bot@專案名.iam.gserviceaccount.com`)
5. 權限選 **「變更活動」** → 傳送

### 3-6 測試 ✅
傳 LINE:
- `行程 : 明天 下午2點 測試行程` → 應回「📅 已加入行事曆」,去 Google 日曆確認有出現
- `今天行程` / `本週行程` → 應回行程列表
- 測完把測試活動刪掉即可

---

# LINE 指令總表

| 你傳 | bot 做 |
|---|---|
| `待辦 : 內容` | 新增待辦(存 KV,dashboard 同步看得到) |
| `待辦事項` | 列出待辦清單(逾期/今天排前面) |
| `完成 2` | 完成清單第 2 筆 |
| `行程 : 明天 14:00 拜訪宏益 @宜兒樂澄清店` | 建 Google 日曆活動(預設 1 小時,`@地點` 填到位置欄,可省略) |
| `行程 : 7/10 出差台中` | 建全天活動 |
| `今天行程` / `明天行程` / `本週行程` / `本月行程` / `下月行程` | 查 Google 日曆回編號列表 |
| `改行程 2 明天 15:00` | 把清單第 2 筆改期(只給日期或只給時間也可以) |
| `刪行程 2` | 刪除清單第 2 筆 |
| 其他文字 | 回使用說明 |

日期:`今天` `明天` `後天` `7/10` `2026/7/10`;時間:`14:00` `下午2點` `2點半`(不寫=全天)

---

# 疑難排解

| 症狀 | 原因/解法 |
|---|---|
| Cloudflare「部署」反灰 | email 未驗證 → 收信驗證;或擴充功能擋住 → 無痕視窗 |
| Dashboard 顯示「密碼失效」 | `APP_PASSWORD` 沒設或值不同;設完要 Deploy |
| Dashboard 儲存失敗 | KV 繫結名稱必須是 `TODO_KV`,綁完要 Deploy |
| LINE Verify 失敗 | Webhook URL 要以 `/line` 結尾;`LINE_CHANNEL_SECRET` 要設對 |
| bot 已讀不回 | 「Use webhook」沒開;或 access token 沒設/貼錯 |
| 每句多一條罐頭回覆 | Auto-reply messages 沒關 |
| 行程回「Google 授權失敗」 | `GOOGLE_SA_KEY` 要貼 json 整份;Calendar API 要啟用 |
| 行程回「Not Found / 403」 | 日曆沒共用給 `client_email`,或權限不是「變更活動」;`GOOGLE_CALENDAR_ID` 要是正確 Gmail |

# 安全提醒
- 所有金鑰只放在 Worker 的「機密」裡,不要傳給別人、不要截圖外流
- `APP_PASSWORD` 建議用「機密」類型儲存;懷疑外洩就換一組並 Deploy
