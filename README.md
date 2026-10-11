# Estate Insight｜雙北購屋分析系統

供個人或小團隊使用的台北市、新北市自住購屋決策工具：記錄自行收集的物件、分析房價、比較候選物件、管理看房進度及試算購屋成本。

- 純前端：HTML5、CSS3、Vanilla JavaScript（ES Modules），不使用任何前端框架或後端。
- 房屋資料存在瀏覽器 **IndexedDB**；使用者設定存在 **localStorage**。
- 圖表：Chart.js；圖示：Lucide。

## 快速開始

**最簡單的方式：雙擊專案資料夾裡的 `啟動系統.bat`。** 它會檢查 Node.js、第一次使用時自動安裝元件、啟動系統並打開瀏覽器；若系統已在執行，則直接打開瀏覽器。使用期間不要關閉那個黑色視窗。

> `啟動系統.bat` 以 Big5（繁中 Windows 預設的 950 字碼頁）儲存，請勿用會自動轉成 UTF-8 的編輯器修改，否則中文訊息可能被 cmd 誤判成指令。

需要 Node.js 18 以上（只用來跑 Vite 開發伺服器與測試，不是網站執行的一部分）。也可以手動啟動：

```bash
npm install
```

```bash
npm run dev
```

開啟 <http://localhost:5173>。

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動本機開發伺服器（Vite，port 5173） |
| `npm run build` | 產生可部署的靜態檔到 `dist/` |
| `npm run preview` | 預覽 `dist/` |
| `npm test` | 執行單元測試（Node 內建 test runner） |
| `npm run lint` | ESLint 靜態檢查（未定義／未使用變數、不可見字元等） |
| `npm run check` | 依序執行 lint、測試、打包；修改程式後請先跑這個 |
| `npm run vendor` | 重新複製第三方套件到 `public/vendor/` |

> 由於使用 ES Modules，直接雙擊 `index.html`（`file://`）無法執行，請使用 `npm run dev`，或把 `dist/` 放到任何靜態網站伺服器。

## 手機使用（GitHub Pages＋PWA）

- 部署與手機使用教學：見 [部署到GitHub.md](部署到GitHub.md)。
- 推送到 `main` 分支時，GitHub Actions 會執行 `npm run check`（lint＋測試＋打包），通過才部署（`.github/workflows/deploy.yml`）。
- PWA：`public/manifest.webmanifest`、`public/icons/`（由 `node scripts/make-icons.mjs` 產生）、Service Worker 範本 `src-sw/sw.js`（打包時由 `vite.config.js` 產生 `dist/sw.js` 並寫入預先快取清單）。Service Worker 只在正式網站啟用，開發時不註冊。
- 手機交換資料：JSON 備份包含刪除紀錄（`deleted`），匯入時合併：新物件加入、雙方都有的保留較新版本、對方刪除的一併刪除；預設不覆蓋本機設定。

## 依賴管理

| 套件 | 版本 | 載入位置 | 未載入時影響 |
|---|---|---|---|
| Chart.js | 4.4.x | `public/vendor/chart.umd.js` | 統計圖表無法顯示（數字統計仍可用） |
| Lucide | 0.511.x | `public/vendor/lucide.min.js` | 圖示不顯示，功能不受影響 |
| Noto Sans TC | — | Google Fonts（外部） | 改用系統字型「微軟正黑體」 |

- Chart.js 與 Lucide 由 `npm install` 後自動複製到 `public/vendor/`（`scripts/copy-vendor.mjs`），**執行期不需要外部網路**。
- 依賴清單集中在 `js/vendor.js`。若元件未載入，畫面頂端會顯示提示，「系統設定 → 系統狀態」也會列出載入狀態。
- `npm run build` 時 Vite 會提示 vendor 腳本「can't be bundled without type="module"」，這是預期行為：它們以原檔複製到 `dist/vendor/`。

## 專案結構

```
index.html              版面骨架（側欄、頂欄、內容區）
css/styles.css          CSS Design System（tokens → base → shell → components → layouts → utilities → responsive）
js/
  app.js                進入點、hash 路由、頁面註冊
  constants.js          行政區、選項、圖表配色、資料庫名稱
  model.js              房屋資料模型：欄位定義、正規化、驗證、衍生計算（純函式）
  utils.js              數字解析、格式化、統計工具（純函式）
  filters.js            篩選與排序（Dashboard／清單／分析共用）
  stats.js              統計計算：總覽、行政區、城市、預算符合度（純函式）
  finance.js            財務計算：本息平均攤還、逐年攤還表、房貸試算驗證（純函式）
  charts.js             Chart.js 封裝：統一樣式、縣市固定配色、銷毀管理
  scoring.js            個人化評分：必要條件＋加權加分條件、評分理由、排名（純函式）
  score-ui.js           分數徽章、評分理由明細等共用呈現
  compare-store.js      比較清單（最多 5 筆，存 localStorage）
  db.js                 IndexedDB 存取層（只負責讀寫）
  property-service.js   房屋資料服務：正規化＋驗證後才寫入，所有頁面的唯一寫入入口
  property-actions.js   收藏、看房狀態、刪除（含確認）的共用操作
  settings.js           使用者設定（localStorage）
  vendor.js             第三方依賴檢查與圖示刷新
  ui.js                 共用 UI 元件（toast、空狀態、KPI 卡片、徽章）
  dashboard.js          Dashboard
  properties.js         房屋清單、詳細資料、新增／編輯表單
  analysis.js           房價分析
  comparison.js         物件比較
  mortgage.js           房貸試算
  admin.js              後台管理
  settings-page.js      系統設定頁
  import-export.js      匯入匯出：CSV 產生／解析、JSON 備份、匯入前檢查與重複偵測（純函式）
  import-ui.js          匯入匯出介面：下載、選檔、預覽、確認寫入
public/vendor/          Chart.js、Lucide（由 npm install 產生）
scripts/copy-vendor.mjs 複製第三方檔案的開發用腳本
tests/                  單元測試
```

## 資料與隱私

- 所有資料只存在你目前使用的瀏覽器中，不會上傳到任何伺服器。
- 清除瀏覽器網站資料會一併刪除物件資料，請定期在「後台管理 → 匯入匯出」匯出 JSON 備份。
- 系統不內建任何實際行情；所有統計都來自你自行登錄的物件。
- 房貸試算為估算結果，並非銀行核貸承諾。

## 匯入匯出與備份

位置：後台管理 →「匯入匯出」分頁（系統設定也有備份按鈕）。

| 功能 | 說明 |
|---|---|
| 匯出 JSON 完整備份 | 所有物件＋系統設定，保留系統ID與建立／更新時間，可完整還原 |
| 匯出 CSV | UTF-8（含 BOM），Excel 可直接開啟；另附單價、室內坪數、公設比等計算欄 |
| 匯入 CSV | 第一列為欄位名稱，中文（可含單位）或英文 key 皆可；UTF-8 與 Big5 皆可；提供範本下載 |
| 匯入 JSON | 可「合併」或「取代全部」；可選擇是否還原系統設定 |

匯入前一律先預覽並逐列檢查：

- **有錯誤**：欄位格式或必填資料不符，不會匯入，並列出原因。
- **相同系統ID**：可選「保留較新的版本」（預設，依更新時間）、「以匯入資料覆蓋」或「略過」。
- **疑似重複**：系統ID不同，但同行政區名稱相同、或地址與總價相同；預設不匯入，可自行勾選。
- 寫入時再驗證一次，並在單一 transaction 內完成；「取代全部」失敗時原資料不受影響。
- 會自動修正常見寫法：「臺北市」→「台北市」、「大安」→「大安區」、「1,280」→ 1280、「是／否」。

## 單價口徑

| 口徑 | 公式 | 何時可計算 |
|---|---|---|
| 含車位 | 總價 ÷ 權狀坪數 | 總價與權狀坪數皆有填 |
| 排除車位 | (總價 − 車位價格) ÷ (權狀坪數 − 車位坪數) | 「無車位」，或車位價格與車位坪數皆已知 |

有車位但缺少車位價格或坪數時，「排除車位」單價顯示為「無法計算」，不會用估計值代替。

## 評分方式

- **必要條件**（系統設定）：城市、屋齡上限、最少房數、最小權狀坪數、必須有車位。不符者標示「不符必要條件」並排最後；缺資料時標示「待確認」。
- **加分條件**（權重 0–10）：

| 項目 | 計分方式 |
|---|---|
| 預算符合度 | 在預算內 100 分；超出依比例扣分（超出 25% 以上為 0） |
| 價格 | 單價（含車位）與所有物件比較，最低 100、最高 0 |
| 室內空間 | 室內坪數（主建物＋附屬）與所有物件比較，最大 100、最小 0 |
| 屋齡 | 新成屋 100 分，每年 −2.5 分，40 年以上 0 分 |
| 交通 | 捷運步行 5 分鐘內 100 分、25 分鐘以上 0 分，與交通評分星等平均 |
| 生活機能 | 生活機能星等（1 星 0 分、5 星 100 分） |
| 個人偏好 | 個人評分星等 |

- 缺少資料的項目**不計 0 分**，而是不納入加權平均，並顯示「資料完整度」。完整度低於 60% 時分數標示 * 僅供參考，排名排在資料完整的物件之後。

## 開發進度

- [x] 第一階段：專案架構、Design System、導覽與頁面版型、資料模型、Dashboard 版面
- [x] 第二階段：房屋資料管理與 IndexedDB 寫入
- [x] 第三階段：Dashboard 統計與圖表
- [x] 第四階段：物件比較與評分
- [x] 第五階段：房貸試算
- [x] 第六階段：匯入匯出與備份
- [x] 第七階段：整體測試與品質檢查

## 測試與品質

**自動化**（`npm run check`）：ESLint＋82 個單元測試，涵蓋資料模型與驗證、IndexedDB 讀寫（以 fake-indexeddb 模擬）、統計、評分、房貸、匯入匯出、設定檢查。

**瀏覽器實測項目**（第七階段）：

| 項目 | 結果 |
|---|---|
| XSS：所有文字欄位放入 `<img onerror>`、`<script>`，巡覽 9 個頁面 | 0 個注入元素、0 次執行；`javascript:` 網址被拒絕 |
| 惡意 JSON 備份（設定中含腳本、錯誤型別） | 一律改回安全預設值，所有頁面正常 |
| 302 筆資料效能 | 各頁繪製 ≤ 110 ms；評分 22 ms；CSV 匯出 2 ms |
| 375 px 手機寬度，11 個畫面 | 無整頁水平捲動；側欄收合時不可被 Tab 進入 |
| 路由競態、離開未儲存表單、鍵盤焦點保留、狀態選單逐步變更 | 皆正常 |
| 文字對比度 | 主要文字配色皆 ≥ 4.5:1（WCAG AA） |

**已知限制**

- 資料只存在單一瀏覽器，不會跨裝置同步；請定期匯出 JSON 備份。
- 房貸試算未包含寬限期、機動利率與政策性優惠貸款。
- 原生檔案選擇視窗無法自動化測試，匯入流程的選檔之後步驟已以程式測試。
