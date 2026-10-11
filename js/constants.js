/**
 * 系統常數：縣市行政區、選項清單、圖表配色。
 * 純資料模組，不可觸碰 DOM（tests/ 會直接在 Node 中載入）。
 */

export const APP_NAME = 'Estate Insight';

export const DISTRICTS = Object.freeze({
  台北市: [
    '中正區', '大同區', '中山區', '松山區', '大安區', '萬華區',
    '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區',
  ],
  新北市: [
    '板橋區', '三重區', '中和區', '永和區', '新莊區', '新店區', '樹林區', '鶯歌區',
    '三峽區', '淡水區', '汐止區', '瑞芳區', '土城區', '蘆洲區', '五股區', '泰山區',
    '林口區', '深坑區', '石碇區', '坪林區', '三芝區', '石門區', '八里區', '平溪區',
    '雙溪區', '貢寮區', '金山區', '萬里區', '烏來區',
  ],
});

export const CITIES = Object.freeze(Object.keys(DISTRICTS));

export const BUILDING_TYPES = Object.freeze([
  '電梯大樓', '華廈', '公寓', '透天厝', '套房', '其他',
]);

export const PARKING_TYPES = Object.freeze([
  '無車位', '坡道平面', '坡道機械', '升降平面', '升降機械', '塔式車位', '其他',
]);

export const ORIENTATIONS = Object.freeze([
  '坐北朝南', '坐南朝北', '坐東朝西', '坐西朝東',
  '坐東北朝西南', '坐西南朝東北', '坐東南朝西北', '坐西北朝東南',
]);

/** 看房狀態。`pending: true` 的狀態計入 Dashboard「待看房數」。 */
export const VIEWING_STATUSES = Object.freeze([
  { value: '待看房', pending: true, tone: 'neutral' },
  { value: '已預約', pending: true, tone: 'info' },
  { value: '已看房', pending: false, tone: 'navy' },
  { value: '考慮中', pending: false, tone: 'gold' },
  { value: '議價中', pending: false, tone: 'success' },
  { value: '已放棄', pending: false, tone: 'muted' },
]);

export const SOURCES = Object.freeze([
  '591 房屋交易網', '樂屋網', '信義房屋', '永慶房屋', '住商不動產',
  '屋主自售', '建商代銷', '親友介紹', '其他',
]);

/**
 * 圖表分類色（固定順序，勿循環）。已用 dataviz validate_palette 檢查：
 * 淺色背景 #ffffff、深色背景 #152234 皆通過（含色盲相鄰色差）。
 * 台北市固定用第 1 色、新北市固定用第 2 色。
 */
export const CHART_COLORS = Object.freeze({
  light: ['#2563b0', '#b8873a', '#8a4fb0', '#16a07a', '#d0563a'],
  dark: ['#4b8ad8', '#b98a3e', '#a57ad0', '#1fae86', '#e06a4c'],
});

export const CITY_COLOR_INDEX = Object.freeze({ 台北市: 0, 新北市: 1 });

export const DB_NAME = 'estate-insight';
export const DB_VERSION = 2; // v2：新增 tombstones（刪除紀錄）
export const STORE_PROPERTIES = 'properties';
export const STORE_TOMBSTONES = 'tombstones';

export const SETTINGS_KEY = 'estate-insight:settings';
