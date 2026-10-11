// Vite 設定（只用於開發伺服器與打包；網站本身是原生 HTML / CSS / JavaScript）。
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 列出 public/ 下所有檔案（會原封不動複製到 dist/）。 */
function listPublicFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listPublicFiles(full, base) : [relative(base, full).replace(/\\/g, '/')];
  });
}

/**
 * 產生 Service Worker：把打包後的所有檔案名稱寫進 sw.js 的預先快取清單，
 * 並以內容雜湊作為快取版本，每次重新部署都會自動更新。
 */
function serviceWorkerPlugin() {
  return {
    name: 'estate-insight-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync('src-sw/sw.js', 'utf8');
      const files = new Set(['./', 'index.html']);
      for (const name of Object.keys(bundle)) files.add(name);
      for (const name of listPublicFiles('public')) files.add(name);
      files.delete('sw.js');

      const list = [...files].sort();
      const hash = createHash('sha256');
      for (const name of list) {
        const item = bundle[name];
        if (item) hash.update(item.type === 'chunk' ? item.code : item.source);
        else hash.update(name);
      }
      const version = hash.digest('hex').slice(0, 12);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__CACHE_VERSION__', version)
          .replace('__PRECACHE_LIST__', JSON.stringify(list, null, 2)),
      });
    },
  };
}

export default defineConfig({
  // 相對路徑：部署在 https://帳號.github.io/專案名/ 或任何子目錄都能運作
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
  plugins: [serviceWorkerPlugin()],
});
