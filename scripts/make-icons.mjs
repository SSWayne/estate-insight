// 產生 App 圖示（PNG），只用 Node 內建模組。執行：node scripts/make-icons.mjs
// 圖案與網頁 favicon 一致：深海軍藍底、金色房子線條。輸出到 public/icons/。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x13, 0x22, 0x38];
const FG = [0xc8, 0xa4, 0x6a];

// 以 32×32 座標描述房子（與 favicon 相同），線寬 2.2
const PATHS = [
  [[7, 15], [16, 8], [25, 15], [25, 25], [7, 25], [7, 15]], // 屋頂＋牆
  [[13.5, 25], [13.5, 19], [18.5, 19], [18.5, 25]],         // 門
];
const STROKE = 2.2;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, size, r) {
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/**
 * @param {number} size 輸出尺寸
 * @param {{ radius: number, scale: number }} opt radius：圓角（0＝滿版方形）；scale：圖案占畫面比例
 */
function render(size, { radius, scale }) {
  const SS = 4; // 每像素 4×4 超取樣（抗鋸齒）
  const px = Buffer.alloc(size * size * 4);
  const unit = (size * scale) / 32;           // 32 座標 → 像素
  const offset = (size - size * scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0; let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (!insideRoundedRect(fx, fy, size, radius)) continue;
          bg++;
          const gx = (fx - offset) / unit;
          const gy = (fy - offset) / unit;
          const hit = PATHS.some((path) => path.slice(1).some((p, i) => distToSegment(gx, gy, path[i], p) <= STROKE / 2));
          if (hit) fg++;
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const f = bg ? fg / bg : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, size, px);
}

/* ---- 最小 PNG 編碼器（RGBA、無濾波） ---- */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
const outputs = [
  ['icon-192.png', 192, { radius: 192 * 0.22, scale: 0.86 }],
  ['icon-512.png', 512, { radius: 512 * 0.22, scale: 0.86 }],
  // maskable：滿版底色，圖案縮在安全區（中央 80%）內，讓 Android 可裁成圓形或其他形狀
  ['icon-maskable-512.png', 512, { radius: 0, scale: 0.62 }],
  // iOS：不可透明、滿版，系統會自動加圓角
  ['apple-touch-icon.png', 180, { radius: 0, scale: 0.8 }],
];
for (const [name, size, opt] of outputs) {
  writeFileSync(`public/icons/${name}`, render(size, opt));
  console.log(`public/icons/${name}（${size}×${size}）`);
}
