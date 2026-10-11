/**
 * PWA 支援：Service Worker 註冊（離線開啟、自動更新）、永久儲存申請、執行環境判斷。
 * Service Worker 只在正式網站（打包後）啟用；開發時不註冊，避免快取舊程式。
 */
import { toast } from './ui.js';

/** 是否以「加入主畫面」的 App 形式開啟。 */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function registerServiceWorker() {
  if (!import.meta.env?.PROD || !('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker 註冊失敗', err));
  // 新版本接手時提示（第一次安裝不提示）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('系統已更新到最新版本，重新開啟或重新整理頁面即可使用新功能', 'success');
  });
}

/**
 * 申請永久儲存，降低瀏覽器在空間不足時清除 IndexedDB 的機會。
 * @returns {Promise<'persisted'|'granted'|'denied'|'unsupported'>}
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

const HINT_KEY = 'estate-insight:install-hint-dismissed';

/**
 * 手機用瀏覽器開啟（尚未加入主畫面）時，顯示加入主畫面提示：
 *  - Android Chrome：使用系統的安裝提示（beforeinstallprompt）
 *  - iPhone／iPad Safari：沒有安裝 API，顯示手動步驟
 * 加入主畫面後資料較不會被系統清除（iOS 對一般網站閒置約 7 天可能清除資料）。
 */
export function initInstallHint(box) {
  if (!box || isStandalone() || !isTouchDevice()) return;
  try { if (localStorage.getItem(HINT_KEY)) return; } catch { /* 忽略 */ }

  let deferred = null;
  const show = (html) => {
    box.innerHTML = `<div class="install-hint-body">${html}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-hint-close>不再提示</button>`;
    box.hidden = false;
  };
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-hint-close]')) {
      box.hidden = true;
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 忽略 */ }
    } else if (e.target.closest('[data-hint-install]') && deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === 'accepted') box.hidden = true;
    }
  });

  if (isIOS()) {
    show('<strong>建議加入主畫面使用</strong>：點 Safari 下方的「分享」按鈕 →「加入主畫面」。加入後像 App 一樣開啟，資料也比較不會被 iPhone 自動清除。');
  } else {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      show('<strong>可以把系統安裝成 App</strong>，之後從主畫面開啟，資料也比較不會被清除。 <button type="button" class="btn btn-primary btn-sm" data-hint-install>安裝</button>');
    });
  }
}

export async function storageStatus() {
  if (!navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}
