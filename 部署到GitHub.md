# 把系統放上 GitHub Pages（給沒有電腦的家人用手機開）

完成後會得到一個網址，例如：`https://你的帳號.github.io/estate-insight/`
家人用手機打開、加入主畫面，就能像 App 一樣使用。

> **隱私說明**：放上 GitHub 的只有「網站程式」，**不包含任何房屋資料**。每個人的資料只存在自己的手機或電腦裡。
> 免費帳號的 GitHub Pages 需要「公開」專案，所以別人看得到程式碼，但看不到你們的資料；別人打開網址也只會看到空的系統。

---

## 第一次設定（約 15 分鐘，只需做一次）

### 1. 註冊 GitHub 帳號
到 <https://github.com/signup> 註冊免費帳號。帳號名稱會出現在網址裡（`帳號.github.io`）。

### 2. 安裝 GitHub Desktop
到 <https://desktop.github.com> 下載安裝，開啟後用剛才的帳號登入。
（這是 GitHub 官方的圖形介面工具，之後上傳更新只要按按鈕，不用打指令。）

### 3. 把專案加入 GitHub Desktop
1. 選單 **File → Add local repository…**
2. 選擇資料夾：`C:\Users\WayneChi\Desktop\台北房子比較系統`
3. 會出現「This directory does not appear to be a Git repository」，點 **create a repository**
4. **Name** 填 `estate-insight`（網址會用這個名字），其他保持預設，按 **Create repository**

> 專案裡的 `.gitignore` 已設定好，不會上傳 `node_modules`、`dist` 等不需要的資料夾。

### 4. 上傳到 GitHub
1. 左下角 **Summary** 填 `第一版`，按 **Commit to main**
2. 上方按 **Publish repository**
3. **取消勾選「Keep this code private」**（免費版 GitHub Pages 需要公開專案）
4. 按 **Publish repository**

### 5. 開啟 GitHub Pages
1. 在 GitHub Desktop 按 **Repository → View on GitHub**，會開啟網頁
2. 點上方 **Settings** → 左側 **Pages**
3. **Build and deployment → Source** 選 **GitHub Actions**

### 6. 第一次部署
1. 點上方 **Actions** 分頁
2. 左側點 **部署到 GitHub Pages** → 右側 **Run workflow** → **Run workflow**
3. 等 1～2 分鐘，出現綠色勾勾 ✅ 就完成了
4. 點進去，在 **deploy** 底下會看到網址，例如 `https://你的帳號.github.io/estate-insight/`

> 第 4 步上傳時也會自動跑一次部署，那次可能因為 Pages 還沒開啟而失敗（紅色 ✖），屬正常現象，照第 6 步重跑即可。

---

## 之後更新（Claude 修改程式後）

1. 打開 GitHub Desktop，左側會列出修改過的檔案
2. **Summary** 簡單寫這次改了什麼，按 **Commit to main**
3. 按上方 **Push origin**
4. 約 1～2 分鐘後網站自動更新（可在 GitHub 的 **Actions** 分頁看進度）

> 部署前會自動執行檢查與測試，**沒通過就不會更新網站**，線上版本不會壞掉。
> 家人的手機下次在有網路時打開，就會自動拿到新版本（會出現「系統已更新」提示）。

---

## 給家人：手機上怎麼用

### 加入主畫面（很重要，請一定要做）
- **iPhone**：用 **Safari** 打開網址 → 點下方 **分享** 按鈕（方框加向上箭頭）→ **加入主畫面** → **新增**
- **Android**：用 **Chrome** 打開網址 → 會出現「安裝」提示，或點右上角 **⋮** → **安裝應用程式／加到主畫面**

之後從主畫面的「雙北購屋」圖示開啟。
> iPhone 用 Safari 直接開的網站，閒置一段時間後資料可能被系統清除；從主畫面開啟則不會有這個問題。

### 和家人交換資料
1. **傳出**：後台管理 → 匯入匯出 → **分享 JSON 完整備份** → 選 **LINE** → 傳給對方
2. **收到**：在 LINE 點開檔案 → 儲存到手機（iPhone 選「儲存到檔案」）
3. **匯入**：後台管理 → 匯入匯出 → **匯入 JSON 備份** → 選剛才的檔案 → 看預覽 → **確認匯入**

系統會自動處理：
- 新物件 → 加入
- 雙方都有的物件 → 保留**較新**的版本
- 對方刪除的物件 → 一併刪除（你在那之後修改過的會保留）
- 預設**不會**覆蓋你的預算與評分權重

### 注意事項
- 這不是即時同步：兩人同時改同一間物件時，以「最後修改時間較新」的為準。改完記得傳備份給對方。
- 每支手機都要定期備份（系統會提醒）。**換手機前一定要先匯出備份。**
- 不要清除瀏覽器的網站資料，否則資料會消失（有備份就能還原）。
