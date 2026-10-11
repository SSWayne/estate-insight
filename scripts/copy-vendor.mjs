// 將 Chart.js 與 Lucide 的瀏覽器版（UMD）複製到 public/vendor/（網址路徑為 /vendor/），讓系統不需外部網路也能運作。
// 只在開發機執行（npm install 後自動執行），不屬於網站執行期程式碼。
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/chart.js/dist/chart.umd.js', 'public/vendor/chart.umd.js'],
  ['node_modules/lucide/dist/umd/lucide.min.js', 'public/vendor/lucide.min.js'],
];

mkdirSync(resolve(root, 'public/vendor'), { recursive: true });
for (const [from, to] of files) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] 找不到 ${from}，略過`);
    continue;
  }
  copyFileSync(src, resolve(root, to));
  console.log(`[vendor] ${from} → ${to}`);
}
