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
  return { latest, summary, data, pace, project, stats, byArea, reset };
})();

// 靜態版沒有伺服器可重新讀取資料，隱藏「資料刷新」按鈕（資料隨每旬更新自動換新）
if (STATIC) document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('refresh'); if (b) b.remove(); });

const googleSearchUrl = (region, name) => `https://www.google.com/search?q=${encodeURIComponent(`${region} ${name}`.trim())}`;

// 滑鼠提示：任何帶 data-tip 的元素
(() => {
  const tip = document.getElementById('tip');
  if (!tip) return;
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.style.opacity = 0; return; }
    tip.innerHTML = t.dataset.tip;
    tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
    tip.style.top = Math.max(8, e.clientY - h - 10) + 'px';
  });
})();
