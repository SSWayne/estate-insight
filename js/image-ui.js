/**
 * 物件圖片介面：表單中的上傳編輯區、詳細頁的圖片格、看大圖（lightbox）。
 * 表單中的變更只存在編輯區內，按「儲存」時才和物件一起寫入（property-service.js）。
 */
import { getImageData } from './property-service.js';
import {
  compressImage, kindLabel, IMAGE_KINDS, MAX_IMAGES, CAPTION_MAX,
} from './images.js';
import { icon, toast, emptyState, optionList, withFocus } from './ui.js';
import { escapeHtml } from './utils.js';
import { refreshIcons } from './vendor.js';

const imgAlt = (img, i) => escapeHtml(img.caption || `${kindLabel(img.kind)} ${i + 1}`);

/* =====================================================================
   表單：上傳與編輯
   ===================================================================== */
/**
 * 在 container 中掛載圖片編輯區。
 * @param {HTMLElement} container
 * @param {object[]} initial 物件現有的圖片（依順序）
 * @returns {{ getImages: () => object[], signature: () => string, isBusy: () => boolean }}
 */
export function mountImageEditor(container, initial) {
  const items = initial.map((img) => ({ ...img }));
  let busy = false;

  const draw = () => {
    container.innerHTML = editorHtml(items, busy);
    refreshIcons();
  };

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) { toast('請選擇圖片檔（JPG、PNG、WebP）', 'warning'); return; }
    const room = MAX_IMAGES - items.length;
    if (room <= 0) { toast(`每筆物件最多 ${MAX_IMAGES} 張圖片`, 'warning'); return; }
    if (files.length > room) toast(`最多 ${MAX_IMAGES} 張，只加入前 ${room} 張`, 'warning');
    busy = true;
    draw();
    const failed = [];
    for (const file of files.slice(0, room)) {
      try {
        items.push(await compressImage(file));
      } catch (err) {
        failed.push(err.message);
      }
    }
    busy = false;
    withFocus(draw);
    if (failed.length) toast(failed.join('；'), 'error');
  }

  container.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'imageInput') { addFiles(t.files); t.value = ''; }
    else if (t.dataset.imgKind) { items.find((x) => x.id === t.dataset.imgKind).kind = t.value; }
  });
  container.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.imgCaption) items.find((x) => x.id === t.dataset.imgCaption).caption = t.value.slice(0, CAPTION_MAX);
  });
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-img-pick]')) { container.querySelector('#imageInput').click(); return; }
    const btn = e.target.closest('[data-img-action]');
    if (!btn) return;
    const i = items.findIndex((x) => x.id === btn.dataset.id);
    if (i < 0) return;
    const action = btn.dataset.imgAction;
    if (action === 'view') { openGallery(items, i); return; }
    if (action === 'remove') items.splice(i, 1);
    else if (action === 'cover') items.unshift(...items.splice(i, 1));
    else {
      const j = i + (action === 'left' ? -1 : 1);
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
    }
    withFocus(draw);
  });
  // 拖曳上傳
  container.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    container.querySelector('.image-drop')?.classList.add('is-over');
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) container.querySelector('.image-drop')?.classList.remove('is-over');
  });
  container.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    container.querySelector('.image-drop')?.classList.remove('is-over');
    if (!busy) addFiles(e.dataTransfer.files);
  });

  draw();
  return {
    getImages: () => items.map((x) => ({ ...x })),
    signature: () => JSON.stringify(items.map((x) => [x.id, x.kind, x.caption])),
    isBusy: () => busy,
  };
}

function editorHtml(items, busy) {
  const full = items.length >= MAX_IMAGES;
  return `
    <section class="card form-section">
      <div class="form-section-head">${icon('images')}<h2 class="card-title">照片與格局圖</h2>
        <span class="small muted" style="margin-left:auto">${items.length} / ${MAX_IMAGES} 張</span></div>
      <div class="image-drop${full ? ' is-disabled' : ''}">
        <input type="file" id="imageInput" accept="image/*" multiple class="sr-only"${full || busy ? ' disabled' : ''}>
        <button type="button" class="btn btn-secondary" data-img-pick${full || busy ? ' disabled' : ''}>${icon(busy ? 'loader' : 'image-plus')}${busy ? '處理中…' : '選擇圖片'}</button>
        <p class="small muted">${full ? `已達上限 ${MAX_IMAGES} 張，請先刪除再上傳。` : '也可以把圖片拖曳到這裡。上傳時會自動壓縮（長邊 1600 像素），第一張為封面。'}</p>
      </div>
      ${items.length ? `<ul class="image-grid" aria-label="已上傳的圖片">${items.map((img, i) => `
        <li class="image-item">
          <button type="button" class="image-thumb" data-img-action="view" data-id="${escapeHtml(img.id)}" aria-label="檢視大圖：${imgAlt(img, i)}">
            <img src="${escapeHtml(img.thumb)}" alt="">
            ${i === 0 ? '<span class="badge badge-gold image-cover">封面</span>' : ''}
          </button>
          <select data-img-kind="${escapeHtml(img.id)}" aria-label="第 ${i + 1} 張的類型">${optionList(IMAGE_KINDS, img.kind)}</select>
          <input type="text" data-img-caption="${escapeHtml(img.id)}" value="${escapeHtml(img.caption)}" maxlength="${CAPTION_MAX}" placeholder="說明（選填）" aria-label="第 ${i + 1} 張的說明">
          <div class="image-tools">
            <button type="button" class="btn btn-ghost btn-sm" data-img-action="left" data-id="${escapeHtml(img.id)}" title="往前移"${i === 0 ? ' disabled' : ''}>${icon('arrow-left')}<span class="sr-only">第 ${i + 1} 張往前移</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-img-action="right" data-id="${escapeHtml(img.id)}" title="往後移"${i === items.length - 1 ? ' disabled' : ''}>${icon('arrow-right')}<span class="sr-only">第 ${i + 1} 張往後移</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-img-action="cover" data-id="${escapeHtml(img.id)}" title="設為封面"${i === 0 ? ' disabled' : ''}>${icon('star')}<span class="sr-only">第 ${i + 1} 張設為封面</span></button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-img-action="remove" data-id="${escapeHtml(img.id)}" title="刪除">${icon('trash-2')}<span class="sr-only">刪除第 ${i + 1} 張</span></button>
          </div>
        </li>`).join('')}</ul>` : ''}
      <p class="small muted mt-2">圖片只存在這台裝置的瀏覽器中；換裝置請用「JSON 完整備份」（預設包含圖片）。</p>
    </section>`;
}

/* =====================================================================
   詳細頁：圖片格
   ===================================================================== */
export function galleryHtml(images, editHref) {
  if (!images.length) {
    return emptyState({
      iconName: 'image',
      title: '尚未上傳圖片',
      text: '可在編輯頁上傳照片或格局圖。',
      actionHtml: `<a class="btn btn-secondary btn-sm" href="${editHref}">${icon('image-plus')}上傳圖片</a>`,
    });
  }
  return `<ul class="gallery-grid">${images.map((img, i) => `
    <li>
      <button type="button" class="image-thumb" data-gallery-index="${i}" aria-label="檢視大圖：${imgAlt(img, i)}">
        <img src="${escapeHtml(img.thumb)}" alt="" loading="lazy">
        <span class="badge ${img.kind === 'floorplan' ? 'badge-info' : 'badge-neutral'} image-kind">${kindLabel(img.kind)}</span>
      </button>
      ${img.caption ? `<p class="small secondary truncate">${escapeHtml(img.caption)}</p>` : ''}
    </li>`).join('')}</ul>`;
}

/* =====================================================================
   看大圖
   ===================================================================== */
/**
 * 開啟看大圖視窗。先顯示縮圖，原檔讀取完成後替換。←／→ 切換，Esc 關閉。
 * @param {object[]} images 圖片（新上傳尚未儲存的有 data，其餘從資料庫讀取原檔）
 * @param {number} start
 */
export function openGallery(images, start = 0) {
  if (!images.length) return;
  let index = start;
  let url = null;
  let seq = 0;
  const opener = document.activeElement;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog lightbox';
  dlg.setAttribute('aria-label', '檢視圖片');
  dlg.innerHTML = `
    <div class="lightbox-head">
      <span class="lightbox-meta" aria-live="polite"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-lb="close">${icon('x')}關閉</button>
    </div>
    <div class="lightbox-stage">
      <button type="button" class="lightbox-nav prev" data-lb="prev" aria-label="上一張">${icon('chevron-left')}</button>
      <img alt="">
      <button type="button" class="lightbox-nav next" data-lb="next" aria-label="下一張">${icon('chevron-right')}</button>
    </div>`;
  document.body.appendChild(dlg);
  refreshIcons();
  const imgEl = dlg.querySelector('img');
  const multi = images.length > 1;
  dlg.querySelectorAll('.lightbox-nav').forEach((b) => { b.hidden = !multi; });

  const release = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  async function show() {
    const img = images[index];
    const mine = ++seq;
    release();
    imgEl.src = img.thumb;
    imgEl.alt = img.caption || `${kindLabel(img.kind)} ${index + 1}`;
    dlg.querySelector('.lightbox-meta').textContent = `${index + 1} / ${images.length}・${kindLabel(img.kind)}${img.caption ? `・${img.caption}` : ''}`;
    try {
      const data = img.data || (await getImageData(img.id))?.data;
      if (!data || mine !== seq) return;
      url = URL.createObjectURL(new Blob([data], { type: img.type || 'image/jpeg' }));
      imgEl.src = url;
    } catch {
      if (mine === seq) toast('無法讀取原始圖片，顯示縮圖', 'warning');
    }
  }
  const step = (d) => { index = (index + d + images.length) % images.length; show(); };
  const close = () => {
    if (!dlg.isConnected) return;
    seq += 1;
    release();
    if (dlg.open) dlg.close();
    dlg.remove();
    window.removeEventListener('hashchange', close);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };

  dlg.addEventListener('click', (e) => {
    const action = e.target.closest('[data-lb]')?.dataset.lb;
    if (action === 'close') close();
    else if (action === 'prev') step(-1);
    else if (action === 'next') step(1);
    else if (e.target === dlg) close(); // 點背景
  });
  dlg.addEventListener('keydown', (e) => {
    if (!multi) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  window.addEventListener('hashchange', close); // 換頁時關閉
  dlg.showModal();
  dlg.querySelector('[data-lb="close"]').focus();
  show();
}
