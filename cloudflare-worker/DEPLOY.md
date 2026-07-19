# 自動部署到 Cloudflare(GitHub Actions + Wrangler)

設定一次之後,只要 push 到 `main` 且改到 `cloudflare-worker/` 底下的檔案,
GitHub Actions 就會自動用 wrangler 把最新的 `worker.js` 部署到 Cloudflare,
不用再手動複製貼上。

相關檔案:
- `cloudflare-worker/wrangler.toml` — 部署設定(Worker 名稱、KV 綁定、Cron)
- `.github/workflows/deploy-worker.yml` — GitHub Actions 工作流程

---

## 一次性設定(約 5 分鐘)

### 步驟 1:改 `wrangler.toml` 三個值
打開 `cloudflare-worker/wrangler.toml`,改成你自己的:

1. **`name`** → 你 Cloudflare 上「現有」的 Worker 名稱。
   > ⚠️ 填錯會**新建另一個 Worker**,而不是更新你原本那個!
   > 到 Dashboard → Workers & Pages,看你現在那個 Worker 的名稱是什麼就填什麼。
2. **`kv_namespaces` 的 `id`** → 你的 KV namespace id。
   > Dashboard → Storage & Databases → KV → 你的 namespace 會顯示 ID;
   > 或本機執行 `npx wrangler kv namespace list`。
3. **`crons`**(可選)→ 排程,預設每 3 小時一次。

### 步驟 2:建立 Cloudflare API Token
1. 到 https://dash.cloudflare.com/profile/api-tokens → **Create Token**
2. 用範本 **Edit Cloudflare Workers** → Continue → Create Token
3. 複製產生的 token(只會顯示一次)
4. 順便記下你的 **Account ID**:Dashboard 右側,或 Workers & Pages 頁面可看到。

### 步驟 3:把兩個值加到 GitHub Secrets
GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**,加兩個:

| Secret 名稱 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 步驟 2 產生的 token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

### 步驟 4:觸發部署
- 之後任何對 `cloudflare-worker/` 的 push 到 `main` 都會自動部署。
- 想立刻跑一次:GitHub repo → **Actions** 分頁 → 左邊選 **Deploy Cloudflare Worker**
  → **Run workflow**。

---

## 重要說明

- **機密不受影響**:`APP_PASSWORD`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、
  `GOOGLE_SA_KEY`、`GOOGLE_CALENDAR_ID` 是 Worker Secrets,部署**不會**動到它們,
  維持你在 Cloudflare 後台設定的即可(所以不要寫進 `wrangler.toml`)。
- **KV 資料不受影響**:部署只更新程式,待辦/監看資料都還在。
- **Cron 由 `wrangler.toml` 接管**:部署後排程會以 `wrangler.toml` 的 `crons` 為準,
  之後要改排程就改這個檔案(不必再進 Dashboard 設定)。
- **只部署 `cloudflare-worker/`**:`dispatch-worker/` 是另一個獨立 Worker,此流程不會碰它。
