// 主儀表板、建案熱力看板、比較分析共用的工具（2026-09-30 改版）
// STATIC：GitHub Pages 靜態版（config.js 設 true），改讀 build_static.py 預先算好的 JSON；
// 否則為伺服器版（本機 server.py / Render），照常呼叫 /api
const STATIC = !!window.STATIC_SITE;
const API = '/api';

// 區域分組：新竹市 / 新竹縣全縣 / 苗栗竹南頭份（下拉選單與排序都依此）
const REGION_GROUPS = [
  ['新竹市', ['新竹市']],
  ['新竹縣', ['竹北市', '竹東鎮', '湖口鄉', '新豐鄉', '寶山鄉', '新埔鎮', '芎林鄉', '關西鎮', '北埔鄉', '橫山鄉', '峨眉鄉', '尖石鄉', '五峰鄉']],
  ['苗栗縣', ['竹南鎮', '頭份市']],
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = v => Number(v).toFixed(1);
const fi = v => Math.round(v).toLocaleString();
const pad = v => String(v).padStart(2, '0');
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const med = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

// 座標軸刻度：回傳 { lo, hi, t: 刻度陣列 }
function nice(min, max, n = 4) {
  const sp = (max - min) || 1, raw = sp / n, mag = 10 ** Math.floor(Math.log10(raw));
  const st = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  const lo = Math.floor(min / st) * st, hi = Math.ceil(max / st) * st, t = [];
  for (let v = lo; v <= hi + 1e-9; v += st) t.push(+v.toFixed(6));
  return { lo, hi, t };
}


async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || `${url} 失敗`);
  return j;
}

// 非住宅（廠辦／辦公）：售價結構與住宅不同，住宅統計預設排除（與 report_helpers.non_residential_mask 同規則）
function isNonResidential(r) {
  const t = String(r['建物型態'] || ''), u = String(r['主要用途'] || ''), n = String(r['建案名稱'] || '');
  return t === '辦公商業大樓' || (t === '其他' && u === '見其他登記事項') || /廠辦|辦公|商辦/.test(n);
}

function opt(el, arr) {
  el.innerHTML = arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
}

// 區域下拉：分組＋各縣「全部」選項；值為鄉鎮名或 'grp:縣名'
function buildRegionSelect(el, cities) {
  const known = new Set(REGION_GROUPS.flatMap(g => g[1]));
  let html = '<option value="all">全部</option>';
  REGION_GROUPS.forEach(([label, list]) => {
    const present = list.filter(c => cities.includes(c));
    if (!present.length) return;
    html += `<optgroup label="${label}">`;
    if (present.length > 1) html += `<option value="grp:${label}">${label}（全部）</option>`;
    html += present.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    html += '</optgroup>';
  });
  const others = cities.filter(c => !known.has(c));
  if (others.length) html += `<optgroup label="其他">${others.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</optgroup>`;
  el.innerHTML = html;
}

// 區域選單值 → 鄉鎮清單；'all' 回空陣列（不限）
function citiesForRegion(value, cities) {
  if (value === 'all') return [];
  if (value.startsWith('grp:')) {
    const g = REGION_GROUPS.find(x => x[0] === value.slice(4));
    return g ? g[1].filter(c => cities.includes(c)) : [];
  }
  return [value];
}

function regionLabel(value) {
  if (value === 'all') return '大新竹全區';
  return value.startsWith('grp:') ? value.slice(4) + '全區' : value;
}

// 年度／月份／期間快速鍵 → 'YYYY-MM' 月份清單；全部不限時回 null
function monthsForFilter(allMonths, { year, month, period }) {
  if (year === 'all' && month === 'all' && period === 'all') return null;
  const last = allMonths[allMonths.length - 1];
  let list = allMonths.slice();
  if (period === '3') list = allMonths.slice(-3);
  else if (period === '6') list = allMonths.slice(-6);
  else if (period === 'ytd' && last) list = list.filter(m => m.slice(0, 4) === last.slice(0, 4));
  if (year !== 'all') list = list.filter(m => m.slice(0, 4) === year);
  if (month !== 'all') list = list.filter(m => +m.slice(5) === +month);
  return list;
}

function fmtStamp(latest) {
  const at = latest.built_at || latest.updated_at;
  const t = at
    ? new Date(at).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  if (STATIC) return `資料更新 ${t}`;
  return `${String(latest.source || '').replace(' (Google Sheets)', '')} · 更新 ${t}`.trim();
}

// ---------- 車位價格（政府車位明細檔，一車位一列） ----------
// 類別分組：坡道平面是主流、行情比較都以它為準；機械、一樓平面價位差很多，分開看
const PARK_GROUPS = [
  ['坡道平面', ['坡道平面']],
  ['機械', ['坡道機械', '升降機械', '塔式車位']],
  ['一樓平面', ['一樓平面']],
  ['其他', ['升降平面', '其他']],
  ['子母／大車位', []],   // 不看政府類別，由 flagParkBig 依坪數判斷（一個登記含兩台車的空間，價格約一般車位的 1.5～2 倍）
];
const PARK_BIG = { area: 1.4, price: 1.3, abs: 18 };   // 坪數 ≥ 同案同類別中位數 1.4 倍且價格 ≥ 同案同層 1.3 倍（價高是因為空間大），或 ≥ 18 坪
const PARK_FLOORS = ['2F+', '1F', 'B1', 'B2', 'B3', 'B4', 'B5+'];
const PARK_LOW = 80;   // 坡道平面低於 80 萬：疑似登錄錯誤或機車位，標待確認不計入行情
const PARK_HIGH = 1.4; // 高於同案同層中位數 1.4 倍、坪數又沒有比較大：標待確認不計入行情
const parkGroup = t => (PARK_GROUPS.find(g => g[1].includes(t)) || ['其他'])[0];
// [區, 案, 月, 類, 層, 萬, 坪, 同筆車位數, 非住宅]
function parkRow([r, pj, m, t, f, p, a, n, nr]) {
  const g = parkGroup(t);
  return { r, pj, m, t, g, f: f || '未標示', p, a, n, nr: !!nr, zero: !(p > 0), q: g === '坡道平面' && p > 0 && p < PARK_LOW };
}
const parkValid = x => !x.zero && !x.q;
// 異常判斷的比較基準：跟「同建案同類別」比坪數、跟「同建案同類別同樓層」比價格（樓層越深越便宜，不能跟整案比）。
// 該層少於 3 位時，改用該建案最貴那一層的中位數，避免把唯一一位 B1 誤判成高價。
function parkRefs(rows) {
  const by = (keyFn) => {
    const g = {};
    rows.forEach(x => { if (x.p > 0) (g[keyFn(x)] = g[keyFn(x)] || []).push(x); });
    return g;
  };
  const proj = by(x => x.pj + '|' + x.t), floor = by(x => x.pj + '|' + x.t + '|' + x.f);
  const area = {}, topFloor = {}, floorMed = {};
  Object.entries(proj).forEach(([k, v]) => { const as = v.map(x => x.a).filter(a => a > 0); if (v.length >= 5 && as.length >= 5) area[k] = med(as); });
  Object.entries(floor).forEach(([k, v]) => {
    if (v.length < 3) return;
    const m = med(v.map(x => x.p)), pk = k.split('|').slice(0, 2).join('|');
    floorMed[k] = m;
    topFloor[pk] = Math.max(topFloor[pk] || 0, m);
  });
  return x => {
    const pk = x.pj + '|' + x.t;
    return { a: area[pk] || null, p: floorMed[pk + '|' + x.f] || topFloor[pk] || null };
  };
}

// 子母／大車位：坪數與價格都明顯高於同案 → 改歸「子母／大車位」，不和單一車位一起算行情、最高價
// （有些建案一般車位只登記 5～6 坪，子母是 11～12 坪，所以不設固定坪數門檻，一律跟自己建案比）
function flagParkBig(rows) {
  const ref = parkRefs(rows);
  rows.forEach(x => {
    if (!(x.a > 0) || !(x.p > 0)) return;
    const r = ref(x);
    if (x.a >= PARK_BIG.abs || (r.a && r.p && x.a >= r.a * PARK_BIG.area && x.p >= r.p * PARK_BIG.price)) { x.g = '子母／大車位'; x.big = true; x.q = false; }
  });
  return rows;
}

// 高價異常：價格 ≥ 同案同層中位數 1.4 倍、坪數又沒有比較大 → 待確認
function flagParkHigh(rows) {
  const ref = parkRefs(rows.filter(x => !x.big));
  rows.forEach(x => {
    if (x.big || x.zero || x.q) return;
    const r = ref(x);
    if (r.p && x.p > r.p * PARK_HIGH && !(r.a && x.a > 0 && x.a >= r.a * 1.3)) x.q = 'high';
  });
  return rows;
}

// 建案名稱比對：政府原始檔缺字有時是「?」有時直接掉字（臻研?研／臻研研），比對時都去掉
const normName = s => String(s || '').replace(/[?？\ufffd\s]/g, '');
// 依樓層彙總：[{f, n, med, lo, hi}]，依 PARK_FLOORS 排序
function parkByFloor(rows) {
  const g = {};
  rows.forEach(x => (g[x.f] = g[x.f] || []).push(x.p));
  const order = f => { const i = PARK_FLOORS.indexOf(f); return i < 0 ? 99 : i; };
  return Object.entries(g).sort((a, b) => order(a[0]) - order(b[0]))
    .map(([f, v]) => ({ f, n: v.length, med: med(v), lo: Math.min(...v), hi: Math.max(...v) }));
}

// ---------- 資料存取層（伺服器版／靜態版共用同一組呼叫） ----------
const Api = (() => {
  const memo = {};
  const once = (key, fn) => (memo[key] = memo[key] || fn().catch(e => { delete memo[key]; throw e; }));
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const rocToSlash = d => { const s = String(d ?? '').replace(/\.0$/, ''); return /^\d{7}$/.test(s) ? `${+s.slice(0, 3) + 1911}/${s.slice(3, 5)}/${s.slice(5)}` : null; };

  const latest = () => once('latest', () => getJSON(STATIC ? 'api/latest.json' : `${API}/latest`));
  const summary = () => once('summary', () => getJSON(STATIC ? 'api/summary.json' : `${API}/summary`));
  const data = () => once('data', () => getJSON(STATIC ? 'api/data.json' : `${API}/data?limit=50000`));
  const pace = () => once('pace', () => getJSON(STATIC ? 'api/pace-ranking.json' : `${API}/projects/pace-ranking`)).then(j => j.data);
  // 車位明細（一車位一列，見 parking.py）→ 物件陣列
  const parking = () => once('parking', () => getJSON(STATIC ? 'api/parking.json' : `${API}/parking`).then(j => flagParkHigh(flagParkBig(j.rows.map(parkRow)))));

  // 單一建案：{ speed, floor }
  async function project(name) {
    if (STATIC) {
      const idx = await once('pidx', () => getJSON('api/projects/index.json'));
      const id = idx.data[name];
      if (!id) return { speed: null, floor: null };
      const j = await getJSON(`api/projects/${id}.json`);
      return { speed: j.speed, floor: j.floor };
    }
    const q = encodeURIComponent(name);
    const [speed, floor] = await Promise.all([
      getJSON(`${API}/projects/sales-speed?project_name=${q}`).then(j => j.data).catch(() => null),
      getJSON(`${API}/projects/floor-analysis?project_name=${q}`).then(j => j.data).catch(() => null),
    ]);
    return { speed, floor };
  }

  // 依區域／月份篩選交易列（params: URLSearchParams，cities、months 以逗號分隔）
  async function scopedRows(params) {
    const rows = (await data()).rows;
    const cities = (params.get('cities') || '').split(',').filter(Boolean);
    const months = (params.get('months') || '').split(',').filter(Boolean);
    return rows.filter(r => (!cities.length || cities.includes(r['鄉鎮市區'])) && (!months.length || months.includes(r['月份'])));
  }

  // 建案成交統計（熱力看板色塊）
  async function stats(params) {
    if (!STATIC) return getJSON(`${API}/projects/stats?${params}`);
    const g = {};
    (await scopedRows(params)).forEach(r => {
      const nm = r['建案名稱'];
      if (!nm) return;
      const o = g[nm] = g[nm] || { '建案名稱': nm, '成交筆數': 0, '_s': 0, '_n': 0, '鄉鎮市區': r['鄉鎮市區'] };
      o['成交筆數']++;
      const p = num(r['建物單價']);
      if (p != null) { o._s += p; o._n++; }
    });
    return { ok: true, data: Object.values(g).map(o => ({ '建案名稱': o['建案名稱'], '成交筆數': o['成交筆數'], '平均單價': o._n ? o._s / o._n : null, '鄉鎮市區': o['鄉鎮市區'] })) };
  }

  // 坪數區間比較：建案去化摘要已預先算好（area-base.json），這裡只依坪數挑建案與交易明細
  async function byArea(params) {
    if (!STATIC) return getJSON(`${API}/projects/by-area?${params}`);
    let lo = Number(params.get('min_area')), hi = Number(params.get('max_area'));
    if (lo > hi) [lo, hi] = [hi, lo];
    const base = (await once('areaBase', () => getJSON('api/area-base.json'))).data;
    const match = {};
    (await scopedRows(params)).forEach(r => {
      const a = num(r['建物坪數']), nm = r['建案名稱'], d = rocToSlash(r['交易年月日']);
      if (a == null || !nm || !d || a < lo || a > hi) return;
      const t = num(r['總價']), u = num(r['建物單價']);
      (match[nm] = match[nm] || []).push({ txDate: d, areaPing: Math.round(a * 100) / 100, floor: r['移轉層次'] || '', roomType: r['房型'] || '',
        totalWan: t == null ? null : Math.round(t / 1000) / 10, unitPriceWan: u == null ? null : Math.round(u / 100) / 100 });
    });
    const projects = Object.keys(match).filter(nm => base[nm]).map(nm => {
      const b = base[nm], tx = match[nm].sort((x, y) => y.txDate.localeCompare(x.txDate));
      return { ...b, matchCount: tx.length, matchRatio: b.totalCount ? Math.round(tx.length / b.totalCount * 1000) / 10 : null, matchedTransactions: tx };
    });
    const key = p => [p.lowConfidence ? 1 : 0, p.paceMonthly != null ? 0 : p.rawPaceMonthly != null ? 1 : 2, -(p.paceMonthly ?? p.rawPaceMonthly ?? 0)];
    projects.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    return { ok: true, data: { projects } };
  }

  // 伺服器版按「資料刷新」後要清掉快取重新讀
  const reset = () => Object.keys(memo).forEach(k => delete memo[k]);
  return { latest, summary, data, pace, parking, project, stats, byArea, reset };
})();

// 靜態版沒有伺服器可重新讀取資料，隱藏「資料刷新」按鈕（資料隨每旬更新自動換新）
if (STATIC) document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('refresh'); if (b) b.remove(); });

const googleSearchUrl = (region, name) => `https://www.google.com/search?q=${encodeURIComponent(`${region} ${name}`.trim())}`;

// 點擊明細彈窗：openPop(標題, HTML)；Esc、點背景、× 關閉
function openPop(title, html) {
  if (!document.getElementById('pop')) {
    document.body.insertAdjacentHTML('beforeend', '<div class="pop-bg" id="popBg"></div><div class="pop" id="pop" role="dialog" aria-modal="true" aria-labelledby="popT"><header><h3 id="popT"></h3><button class="x" id="popX" type="button" aria-label="關閉">×</button></header><div class="body" id="popB"></div></div>');
    const close = () => { $('pop').classList.remove('on'); $('popBg').classList.remove('on'); };
    $('popX').onclick = $('popBg').onclick = close;
    addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  $('popT').textContent = title;
  $('popB').innerHTML = html;
  $('pop').classList.add('on'); $('popBg').classList.add('on');
  $('popB').scrollTop = 0;
}
// 明細表格：rows = [[名稱, 值…]]；bar 為 0~1 時多一欄長條
const popTable = (head, rows) => `<table class="pt"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
  rows.map(r => `<tr>${r.map(c => c && c.bar != null ? `<td class="bar"><i style="width:${Math.max(c.bar * 100, 1)}%"></i></td>` : `<td>${c ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const quant = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

// 滑鼠提示：任何帶 data-tip 的元素（手機點一下也會顯示，點空白處收起）
(() => {
  const tip = document.getElementById('tip');
  if (!tip) return;
  const show = e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.style.opacity = 0; return; }
    tip.innerHTML = t.dataset.tip;
    tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
    tip.style.top = Math.max(8, e.clientY - h - 10) + 'px';
  };
  document.addEventListener('mousemove', show);
  document.addEventListener('click', show);   // 觸控裝置沒有 hover，點一下顯示
  addEventListener('scroll', () => { tip.style.opacity = 0; }, { passive: true });
})();
