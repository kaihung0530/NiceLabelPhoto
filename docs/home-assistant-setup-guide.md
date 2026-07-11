# Home Assistant 完整建置教學

> 目標：用一台 Home Assistant 主機當「中樞」，把 **Samsung 洗衣機/家電** 整合進來，
> 再反向橋接回 **Apple 家庭**，讓你用 **HomePod mini 的 Siri** 語音控制原本搆不到的三星設備。

---

## 目錄

1. [整體架構](#1-整體架構)
2. [第一階段：硬體採購](#2-第一階段硬體採購)
3. [第二階段：安裝 Home Assistant OS](#3-第二階段安裝-home-assistant-os)
4. [第三階段：首次開機設定](#4-第三階段首次開機設定)
5. [第四階段：整合 Samsung 設備（SmartThings）](#5-第四階段整合-samsung-設備smartthings)
6. [第五階段：橋接回 Apple 家庭（HomeKit Bridge）](#6-第五階段橋接回-apple-家庭homekit-bridge)
7. [第六階段：用 Siri / HomePod mini 控制](#7-第六階段用-siri--homepod-mini-控制)
8. [第七階段：自動化範例](#8-第七階段自動化範例)
9. [常見問題與疑難排解](#9-常見問題與疑難排解)
10. [名詞對照表](#10-名詞對照表)
11. [附錄 A：用閒置 Mac 當主機（Intel MacBook Air A1932）](#11-附錄-a用閒置-mac-當主機intel-macbook-air-a1932)

---

## 1. 整體架構

```
        ┌─────────────────────────────┐
        │      Home Assistant         │  ← 中樞（跑在樹莓派等主機上）
        │  （整合所有品牌設備）        │
        └─────────────────────────────┘
          ▲                        │
          │ SmartThings 整合        │ HomeKit Bridge
          │ (雲端 API)              │ (本地)
          ▼                        ▼
   ┌──────────────┐        ┌─────────────────┐
   │ 三星洗衣機   │        │  Apple 家庭 App  │
   │ 等三星家電   │        │  + HomePod mini  │
   └──────────────┘        │  （Siri 語音）   │
                           └─────────────────┘
```

**運作邏輯：**
- Home Assistant 透過 **SmartThings 整合**（雲端 API）把三星設備拉進來。
- 再透過 **HomeKit Bridge** 把這些設備「假裝成 HomeKit 設備」丟回 Apple 家庭。
- 於是 Siri / HomePod mini 就能控制三星洗衣機。

---

## 2. 第一階段：硬體採購

### 主機（三選一）

| 方案 | 說明 | 大約價格 | 推薦度 |
|------|------|---------|--------|
| **Home Assistant Green** | 官方原廠機，開箱即用、免灌系統 | NT$2,500 左右 | ⭐⭐⭐⭐⭐ 新手首選 |
| **Raspberry Pi 4/5 (4GB+)** | 最主流、教學資源最多 | NT$2,000–3,500 | ⭐⭐⭐⭐ |
| **舊電腦 / NAS / 迷你 PC** | 有閒置設備可省錢，用 Docker 或 VM | 免費～ | ⭐⭐⭐ 進階 |

> 本教學以 **Raspberry Pi**（樹莓派）為主線示範，這也是最通用的做法。
> 若你買的是 Home Assistant Green，可**直接跳到第 4 階段**（原廠已預裝系統）。

### 樹莓派方案完整清單

- [ ] Raspberry Pi 4（4GB 以上）或 Raspberry Pi 5
- [ ] **microSD 卡 32GB 以上**（建議 A2 等級，或改用 SSD 更穩）
- [ ] 官方電源供應器（Pi 5 需 27W USB-C，別用手機充電頭湊合）
- [ ] 外殼（建議附散熱風扇）
- [ ] **網路線**（強烈建議接有線，比 Wi-Fi 穩定）
- [ ] 讀卡機（把系統燒進 SD 卡用）

> 💡 進階建議：用 **USB SSD** 取代 SD 卡當開機碟，壽命與速度都好很多。

---

## 3. 第二階段：安裝 Home Assistant OS

> 若使用 Home Assistant Green，跳過本節。

### 步驟 1：下載燒錄工具

在你的電腦（Mac/Windows）安裝 **Raspberry Pi Imager**：
- 官網：https://www.raspberrypi.com/software/

### 步驟 2：燒錄系統

1. 插入 microSD 卡到讀卡機。
2. 打開 Raspberry Pi Imager。
3. **選擇裝置（Device）** → 選你的 Pi 型號。
4. **選擇作業系統（OS）** → `Other specific-purpose OS` → `Home Assistants and home automation` → `Home Assistant` → 選對應你 Pi 型號的版本。
5. **選擇儲存裝置（Storage）** → 選你的 SD 卡。
6. 按 **「燒錄 / Write」**，等待完成（約 5–10 分鐘）。

### 步驟 3：開機

1. 把燒好的 SD 卡插進樹莓派。
2. 接上**網路線**（連到你家路由器）。
3. 接上電源，開機。
4. **等待約 5–20 分鐘**（首次開機會自動下載安裝，請耐心等，不要拔電）。

---

## 4. 第三階段：首次開機設定

### 步驟 1：進入 Web 介面

在**同一個區網**下，用電腦或手機瀏覽器打開：

```
http://homeassistant.local:8123
```

> 若打不開，改用主機的 IP 位址，例如 `http://192.168.1.50:8123`
> （IP 可在路由器管理後台查到，或用 [Fing] App 掃描）。

### 步驟 2：建立帳號

1. 建立你的**管理員帳號**（自訂使用者名稱與密碼，這是本地帳號，記牢）。
2. 設定**家的名稱、地區、時區**（台灣選 `Asia/Taipei`）。
3. Home Assistant 會自動偵測區網內部分設備，可先略過。

### 步驟 3：更新到最新版

進入 **設定（Settings）→ 系統（System）→ 更新（Updates）**，把系統與所有元件更新到最新。

---

## 5. 第四階段：整合 Samsung 設備（SmartThings）

三星家電幾乎都掛在 **Samsung SmartThings** 平台上，Home Assistant 有**官方整合**可以接。

### 前置作業：先確認洗衣機已在 SmartThings App 裡

1. 手機下載 **SmartThings App**（Samsung 官方）。
2. 用你的 **Samsung 帳號**登入。
3. 把洗衣機加入 SmartThings（通常機器面板可掃描 QR 或按配對）。
4. 確認在 App 裡能看到洗衣機、能看狀態，代表雲端連線正常。

> ⚠️ 若洗衣機在 App 裡都連不上，那多半是機型較舊或沒有 Wi-Fi 模組，
> 需先確認型號是否支援 SmartThings（見第 9 節）。

### 在 Home Assistant 加入 SmartThings 整合

新版 Home Assistant（2024.x 以後）的 SmartThings 整合已改用 **OAuth 一鍵登入**，很簡單：

1. Home Assistant → **設定（Settings）→ 裝置與服務（Devices & Services）**。
2. 右下角按 **「+ 新增整合（Add Integration）」**。
3. 搜尋 **`SmartThings`**，點選。
4. 系統會跳轉到 **Samsung 登入頁**，用你的 Samsung 帳號登入並**授權**。
5. 授權完成後跳回 Home Assistant，它會自動把你 SmartThings 裡的設備匯入。

> 📌 若你的版本仍要求「Personal Access Token（PAT）」，
> 到 https://account.smartthings.com/tokens 建立一組 Token（勾選 Devices 相關權限），
> 再貼回 Home Assistant。但新版通常已不需要這步。

### 驗證

回到 **裝置與服務**，你應該會看到 SmartThings 底下列出洗衣機。點進去可看到：
- 運轉狀態（洗滌中 / 完成 / 待機）
- 剩餘時間
- 目前程序

🎉 到這裡，三星洗衣機已經進入 Home Assistant 了。

---

## 6. 第五階段：橋接回 Apple 家庭（HomeKit Bridge）

現在要把 HA 裡的設備「假裝成 HomeKit 設備」丟回 Apple 家庭，這樣 Siri 才能控制。

### 步驟 1：新增 HomeKit Bridge 整合

1. Home Assistant → **設定 → 裝置與服務 → + 新增整合**。
2. 搜尋 **`HomeKit`**（注意：是 **HomeKit** 這個「Bridge」整合，不是 HomeKit Controller）。
3. 選擇要分享給 Apple 家庭的設備範圍：
   - 可選「包含特定網域」如 `switch`、`sensor`、`light`，
   - 或直接指定要分享的實體（entity），例如你的洗衣機。
4. 建立完成後，HA 會產生一個 **HomeKit 配對 QR Code / 8 位數配對碼**。

### 步驟 2：在 iPhone 的家庭 App 加入

1. iPhone 打開 **家庭 App** → 右上 **「+」→ 加入配件**。
2. 掃描 HA 產生的 **QR Code**（在 HA 通知或整合詳情頁裡）。
3. 若出現「無法辨識的配件」，選 **「仍要加入」**（因為這不是原廠認證配件）。
4. 依畫面指示，把設備分配到房間。

### 步驟 3：完成

現在你的三星洗衣機會**出現在 Apple 家庭 App 裡**，跟你原本的 Apple 設備並列在同一個介面。

> 💡 小技巧：洗衣機的「運轉狀態」「完成通知」通常會以**感測器（sensor）**形式呈現，
> 你可以在家庭 App 裡把它設成「收藏」，或用它觸發 Apple 家庭的自動化。

---

## 7. 第六階段：用 Siri / HomePod mini 控制

配對完成後，因為 HomePod mini 本來就是你 Apple 家庭的成員，所以：

- **對 HomePod mini 說**：
  - 「嘿 Siri，洗衣機洗好了嗎？」
  - 「嘿 Siri，客廳的燈打開」（跨品牌一起控制）
- 洗衣完成時，可設定讓 HomePod mini / iPhone **語音或推播通知**你。

> ⚠️ 重點提醒：**HomePod mini 本身不會被「加進」Home Assistant 當喇叭控制**
> （Apple 沒開放）。我們做的是**反向**——把 HA 設備丟回 Apple 家庭，
> 借用 Apple 現成的 Siri / HomePod 生態去控制。這正是最實用的一招。

---

## 8. 第七階段：自動化範例

Home Assistant 的自動化能力遠強於 Apple 家庭。幾個實用範例：

### 範例 A：洗衣機洗完，全家喇叭廣播 + 手機推播

**設定 → 自動化 → 建立自動化**，用 UI 設定：
- **觸發（Trigger）**：洗衣機狀態 從「運轉中」變成「完成」。
- **動作（Action）**：
  - 發送手機推播通知「👕 洗衣機洗好囉！」
  - （若有）讓智慧喇叭語音播報。

YAML 範例（進階可直接貼）：

```yaml
alias: 洗衣機洗完通知
trigger:
  - platform: state
    entity_id: sensor.washer_machine_state   # 依你實際 entity 名稱調整
    to: "finished"
action:
  - service: notify.mobile_app_你的手機名稱
    data:
      title: "洗衣完成"
      message: "👕 洗衣機洗好囉，記得去晾衣服！"
mode: single
```

### 範例 B：晚上 11 點若洗衣機還在運轉，提醒你

```yaml
alias: 深夜洗衣提醒
trigger:
  - platform: time
    at: "23:00:00"
condition:
  - condition: state
    entity_id: sensor.washer_machine_state
    state: "run"
action:
  - service: notify.mobile_app_你的手機名稱
    data:
      message: "洗衣機還在運轉，別忘了。"
mode: single
```

---

## 9. 常見問題與疑難排解

### Q1：我的三星洗衣機支援嗎？
- 需要是**有 Wi-Fi 功能**且**能加入 SmartThings App** 的機型（近年 Wi-Fi 機種大多可以）。
- 快速判斷：**先在手機 SmartThings App 裡試著加入洗衣機**，能加成功、能看狀態，HA 就一定接得到。
- 太舊、沒有 Wi-Fi 的機型無法整合。

### Q2：`homeassistant.local:8123` 打不開？
- 改用 IP 位址（在路由器後台查主機 IP）。
- 確認電腦/手機與主機在**同一個網段**。
- 首次開機需等 5–20 分鐘完成安裝。

### Q3：Apple 家庭掃 QR Code 說「無法辨識的配件」？
- 這是正常的（HA 非原廠認證），選 **「仍要加入 / Add Anyway」** 即可。

### Q4：SmartThings 整合是雲端還是本地？
- 是**雲端 API**。所以三星設備的控制需要網路連線（三星伺服器）。
- 其他本地協定設備（如 Zigbee/Z-Wave）才是完全本地。

### Q5：需要固定 IP 嗎？
- 建議在路由器把 Home Assistant 主機設成 **DHCP 保留（固定 IP）**，
  避免重開機後 IP 變動導致找不到。

### Q6：要不要對外開放（遠端控制）？
- 新手**先不要**急著開放外網。
- 想在外面也能控制，最安全是用官方 **Nabu Casa（Home Assistant Cloud）** 訂閱服務，
  或自建 VPN。**不要**直接把 8123 埠對外曝露。

---

## 10. 名詞對照表

| 名詞 | 說明 |
|------|------|
| **Home Assistant (HA)** | 開源智慧家庭中樞平台 |
| **Home Assistant OS** | 官方作業系統，燒進 SD 卡即可用 |
| **Integration（整合）** | 連接某品牌/協定的外掛，例如 SmartThings 整合 |
| **Entity（實體）** | HA 裡的最小控制單位，例如「洗衣機狀態」是一個 entity |
| **SmartThings** | 三星的智慧家庭平台，HA 透過它接三星設備 |
| **HomeKit Bridge** | HA 的功能，把 HA 設備偽裝成 HomeKit 設備給 Apple 家庭 |
| **HomePod mini** | Apple 智慧喇叭，內建 Siri，可當 HomeKit 中樞 |
| **Nabu Casa** | HA 官方付費雲端服務，用於安全遠端存取 |

---

## 11. 附錄 A：用閒置 Mac 當主機（Intel MacBook Air A1932）

若你有一台閒置的 **Intel 晶片 Mac**（例如 MacBook Air A1932 / Retina 2018–2019），
可以直接拿來當 Home Assistant 主機，不必另外買硬體。

> ✅ Intel Mac 是 x86-64 架構，Home Assistant OS 原生支援（比 M 系列 Apple Silicon 更好搞）。
> A1932 的 i5 + 8GB 記憶體對 HA 來說綽綽有餘。

### ⚠️ 關鍵：兩種「保留 macOS」的做法差很多

| 做法 | 接三星（SmartThings） | **橋回 Apple 家庭（HomeKit Bridge）** |
|------|:---:|:---:|
| **Docker on Mac** | ✅ 可 | ⚠️ **常失敗** |
| **UTM 虛擬機（橋接網路）** | ✅ 可 | ✅ **正常** |

**原因**：macOS 上的 Docker 跑在一層 Linux 小 VM 裡，網路是 NAT 隔離的。
HomeKit Bridge 需要在區網廣播 **mDNS** 讓 iPhone/HomePod 發現它，
這在 Mac Docker 底下常常失敗。SmartThings 是純雲端 API 不受影響，
但 HomeKit 這關（本教學重點）會卡住。

> 結論：要達成「用 Siri/HomePod 控三星」的目標，**請用 UTM 虛擬機 + 橋接網路**，
> 而不是 Docker。UTM 一樣免費、一樣不動你的 macOS 系統。

### UTM 虛擬機安裝步驟

**步驟 1：安裝 UTM（免費）**
- 到 https://mac.getutm.app 下載免費版（或 App Store 付費版，內容相同）。

**步驟 2：下載 Home Assistant OS 虛擬機映像檔**
- 到 https://www.home-assistant.io/installation/ → 選 **Linux / VM**。
- 下載 **KVM/QEMU（`.qcow2`）** 版本。
- 解壓縮得到 `.qcow2` 檔。

**步驟 3：在 UTM 建立虛擬機**
- 新增 → **Virtualize**（Intel Mac 選虛擬化）。
- 系統類型選 **Other / Linux**。
- 把下載的 `.qcow2` 匯入當作硬碟（Import Drive）。
- 記憶體給 **2048 MB（2GB）**，CPU 給 **2 核**。

**步驟 4：⭐ 網路模式改成「Bridged（橋接）」** — 最關鍵一步
- VM 設定 → **Network** → Mode 選 **Bridged (Advanced)**。
- 這會讓 HA 拿到一個**與你家路由器同網段的獨立 IP**，
  HomeKit Bridge 才能被 HomePod / iPhone 發現。
- （若橋接在 Wi-Fi 下不穩，改用 USB-C 轉乙太網路接有線最保險。）

**步驟 5：開機、進入介面**
- 啟動 VM，等待 5–15 分鐘（首次安裝）。
- 瀏覽器打開 `http://homeassistant.local:8123`
  （打不開就用路由器後台查到的那台 VM 的 IP，例如 `http://192.168.1.60:8123`）。
- 接著回到本文件 **第 4 章** 繼續設定帳號。

**步驟 6：讓 Mac 保持開機不睡眠**
- 系統設定 → 電池 / 鎖定畫面 → 設定成**插電時永不睡眠**。
- 闔蓋仍要運作：接電源 + 外接螢幕，或用 Amphetamine（免費）之類工具防止睡眠。

### Mac 當 24/7 主機的注意事項

1. **必須維持開機不睡眠**（見步驟 6），睡了設備就離線。
2. **電池健康**：A1932 是 2018/2019 機器，長期插電發熱，幾年下來留意電池膨脹
   （會頂起觸控板/鍵盤），放通風處。
3. **後續步驟通用**：接三星（第 5 章）、橋回 Apple（第 6 章）的操作與其他主機**完全相同**，
   主機只是換個載體。將來若想換成省電的樹莓派或 Home Assistant Green，操作也一樣。

> 💡 建議心態：先用 Mac + UTM **免成本把整套流程玩熟、確認可行**，
> 之後再決定要不要投資省電的專用硬體長期經營。

---

## 建議實作順序（給你的檢查清單）

- [ ] 1. 確認三星洗衣機能加入手機的 SmartThings App（先驗證可行性）
- [ ] 2. 採購硬體（Raspberry Pi 或 Home Assistant Green）
- [ ] 3. 燒錄並安裝 Home Assistant OS
- [ ] 4. 首次開機、建立帳號、更新到最新版
- [ ] 5. 加入 SmartThings 整合 → 匯入三星洗衣機
- [ ] 6. 加入 HomeKit Bridge → 丟回 Apple 家庭
- [ ] 7. iPhone 家庭 App 配對 → 用 HomePod mini 的 Siri 測試
- [ ] 8. 設定「洗衣完成通知」自動化

---

> 有任何一步卡住，把畫面或錯誤訊息告訴我，我可以針對你的實際型號與網路環境給更精準的指引。
