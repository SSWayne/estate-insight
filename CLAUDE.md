# CLAUDE.md

Estate Insight：台北市／新北市自住購屋分析系統。使用者以繁體中文溝通，介面全部使用繁體中文與台灣房地產用語。

## 硬性限制

- 只用 HTML5、CSS3、Vanilla JavaScript（ES Modules）。禁止 React／Vue／Angular／Svelte／TypeScript、任何後端或伺服器資料庫。
- Node.js 只用於 Vite 開發伺服器、`npm test` 與 `scripts/`，不可成為網站執行期的一部分。
- 房屋資料一律經由 `js/db.js` 存取 IndexedDB；設定經由 `js/settings.js` 存 localStorage。不得只存在記憶體陣列或用假資料充當。
- 不得顯示虛構的實際行情；沒有資料時顯示空狀態。

## 指令

- `npm run dev`：開發伺服器 http://localhost:5173（`.claude/launch.json` 名稱 `estate-insight`）
- `npm test`：`node --test "tests/**/*.test.js"`
- `npm run build`：輸出到 `dist/`

## 架構慣例

- **分層**：`model.js`／`utils.js`／`filters.js`／`constants.js` 是純函式模組，不可在頂層觸碰 DOM（測試直接在 Node 載入）。資料存取在 `db.js`，畫面在各頁面模組。
- **寫入**：頁面一律透過 `property-service.js` 寫入（會正規化＋驗證，失敗丟 `ValidationError`／`NotFoundError`），不可直接呼叫 `db.js` 的寫入函式。寫入後會發出 `properties:changed` 事件。
- **共用操作**：收藏／狀態／刪除用 `property-actions.js` 的 `bindPropertyActions`（`data-action="favorite|status|delete"` + `data-id`）；刪除一律經 `confirmAndDelete` 確認。
- **對話框**：用 `ui.js` 的 `confirmDialog()`，不要用 `window.confirm`。
- **未儲存變更**：表單頁呼叫 `ctx.setLeaveGuard(() => isDirty)`，路由與 beforeunload 會自動提醒。
- **統計／圖表**：計算放在 `stats.js`／`finance.js`（純函式，回傳實際納入筆數 n）；畫圖只用 `charts.js`，頁面 cleanup 時呼叫 `destroyCharts()`。「符合預算」＝總價 ≤ 上限且依房貸預設估算的月付 ≤ 上限；未設定預算時顯示「—」而非 0。
- **評分**：`scoring.js`（純函式）。缺資料的項目 `score: null` 不納入加權、以 `coverage` 揭露；價格／室內空間為相對分數，以整個資料庫為基準（`scoreAll(list, settings, pool)`），不足 2 筆或數值全相同時不評分。排名一律用 `rankProperties`（完整 → 資料不足 → 無分數 → 不符必要條件），清單的評分排序也用它。
- **房貸**：`finance.js` 的 `computeMortgage(input)` 負責驗證與全部計算（回傳 `errors`／`warnings`／`values`／`result`）；單位：總價、自備款、貸款、裝修、其他購屋成本為萬元，月付、管理費為元，其他持有成本為元／年。頁面草稿存 `estate-insight:mortgage-draft`（只是方便用）。`#/mortgage?id=` 會帶入物件總價與管理費。
- **匯入匯出**：純邏輯在 `import-export.js`（`toCSV`／`parseCSV`／`csvToRecords`／`buildBackup`／`parseBackup`／`analyzeImport`），介面在 `import-ui.js`，寫入用 `service.importProperties`（再驗證、單一 transaction）。CSV 欄位由 `ALL_KEYS` 產生，新增欄位不需改匯入匯出程式。還原時 `normalizeProperty(raw, null, { keepTimestamps: true })` 保留 updatedAt。瀏覽器實測檔案選擇時，用 `DataTransfer` 攔截 `HTMLInputElement.prototype.click` 餵檔案（原生檔案對話框無法自動化）。
- **比較清單**：`compare-store.js`（localStorage，最多 5 筆，`compare:changed` 事件）；刪除物件時 app.js 會自動移出。
- **事件綁定**：頁面不可把監聽器綁在共用的 `#view` 上（重複進入會累積），要綁在每次重建的子元素（如 `.page`）。
- **版面**：寬表格放在 `.table-wrap`（已設 `position: relative`，避免 `.sr-only` 撐開頁面）；grid／stack 子元素已設 `min-width: 0`。
- **瀏覽器實測**：建立的測試資料標題以「【測試】」開頭，測完只刪這些；改設定前先把原值存到 localStorage 以外的地方（重新整理會清掉 window 變數）。
- **測試**：`tests/service.test.js` 以 `fake-indexeddb` 在 Node 測試實際的 IndexedDB 讀寫。
- **頁面**：每個頁面模組匯出 `render(view, ctx)`，可回傳清除函式；在 `app.js` 的 `PAGES` 註冊。路由為 hash：`#/edit?id=xxx`。
- **欄位**：新增房屋欄位只改 `model.js` 的 `FIELDS`（表單、驗證、CSV 欄位皆由此產生）。必要時在 `validateProperty` 補跨欄位規則，並加測試。
- **缺值**：空值一律為 `null`，不可當作 0。統計、排序、評分都要明確處理 `null`（排序排最後、範圍篩選排除、評分不給 0 分並說明）。
- **單價**：明確區分「含車位」`unitPriceGross` 與「排除車位」`unitPriceNet`；後者缺車位價格或坪數時為 `null`。
- **樣式**：只用 `css/styles.css` 中的 CSS 變數（`--color-*`、`--space-*`、`--radius-*`、`--shadow-*`）。圖表色用 `--chart-1..5`／`CHART_COLORS`，台北市固定第 1 色、新北市固定第 2 色，順序已通過色盲檢查，不可任意調換或循環。
- **圖示**：HTML 中用 `icon('name')`（`ui.js`），渲染後呼叫 `refreshIcons()`。
- **未完成功能**：在畫面上明確標示尚未提供，不可假裝已完成。

## 資料模型補充

規格要求之外另加：`nearestStation`、`stationWalkMinutes`、`transportScore`（1–5）、`livingScore`（1–5），供交通與生活機能評分使用。`viewingStatus` 中「待看房」「已預約」計入 Dashboard 的待看房數。

## 開發階段

1. ✅ 架構、Design System、版型、資料模型、Dashboard 版面
2. ✅ 房屋資料管理與 IndexedDB 寫入（新增／編輯／刪除確認／收藏／狀態／批次操作／重複提醒）
3. ✅ Dashboard 與房價分析統計、Chart.js 圖表
4. ✅ 物件比較（2–5 間）與評分（必要條件＋加權加分條件、評分理由）
5. ✅ 房貸試算（本息平均攤還、零利率、無效輸入）
6. ✅ CSV／JSON 匯入匯出、重複檢查、備份還原
7. ✅ 整體測試與品質檢查

修改後：跑 `npm run check`（lint＋測試＋打包）、在瀏覽器實測、回報實際完成項目。

## 第七階段後的規則

- **設定**：所有讀寫都經過 `sanitizeSettings()`（型別與範圍檢查），頁面可信任設定型別；新增設定欄位時要同步加入檢查與 `tests/settings.test.js`。
- **輸出**：任何來自使用者或匯入檔的值插入 HTML 時一律 `escapeHtml`（包含數字欄位，因為匯入資料可能是字串）。
- **CSV**：匯出時文字以 `= + - @` 開頭會加 `'` 防止公式注入，匯入時還原；覆蓋既有物件時只更新檔案中有的欄位。
- **焦點**：以 innerHTML 重繪使用者剛操作的區塊時，用 `ui.js` 的 `withFocus(fn)` 包起來。
- **計時器**：頁面中的 debounce／setTimeout 必須在 cleanup 中取消（`debounce` 有 `cancel()`）。
- **路由**：`route()` 有序號保護；站內連結的離開提醒在 capture 階段攔截。
- **對比度**：文字色需 ≥ 4.5:1；`--color-text-muted` 等已調整，勿改淡。
- **不可見字元**：BOM 一律寫成 `﻿` 跳脫，不可直接貼上字元（ESLint 會擋）。
- **啟動系統.bat**：以 Big5（CP950）儲存、CRLF 換行、不使用 `chcp 65001`（在 UTF-8 下 cmd 會把含中文的行切斷當成指令執行）。修改後要用 950 字碼頁實測。`npm run dev` 使用 `--strictPort`：IndexedDB 依網址＋連接埠區分，換埠會看起來像資料消失。
- **部署**：GitHub Pages（`.github/workflows/deploy.yml`，`npm run check` 通過才部署）。使用者以 GitHub Desktop 推送；這台電腦沒有 git／gh。`vite.config.js` 的 `base: './'` 不可改成絕對路徑（網站在 `/專案名/` 子路徑下）。
- **PWA**：Service Worker 範本在 `src-sw/sw.js`，打包時產生 `dist/sw.js`；只在 `import.meta.env.PROD` 註冊。新增 public/ 檔案會自動進入預先快取。圖示用 `node scripts/make-icons.mjs` 重新產生。
- **資料庫 v2**：新增 `tombstones`（刪除紀錄）資料表；刪除一律經 `db.deleteProperties` 留下紀錄；匯入用 `db.applyImport`（單一 transaction）。之後升版時，`onupgradeneeded` 只能「新增」，不可動到既有資料，並在 `tests/db-upgrade.test.js` 補測試。
- **交換資料規則**：見 `analyzeImport`（本機刪除紀錄擋住舊備份復活；對方刪除且本機未再修改才刪除）。JSON 匯入預設不還原設定。
- **測試正式版**：用子路徑靜態伺服器（例如掛在 `/estate-insight/`）測 dist，才能驗證 Service Worker 與相對路徑；測完要清除該 origin 的 Service Worker、Cache 與 IndexedDB。
- **瀏覽器面板隱藏時** `requestAnimationFrame` 不會執行，測試腳本不要等 rAF。
