// 比較分析頁：區域比較／建案比較／去化速度排行（2026-09-30 新增）
const COLORS = ['var(--acc)', 'oklch(0.62 0.15 45)', 'oklch(0.52 0.11 150)', 'oklch(0.32 0.01 250)'];
const MAX_PICK = 4;
const ROOMS = ['毛胚屋', '一房', '兩房', '三房', '四房', '五房以上'];
const ROOM_SHADES = ['oklch(0.93 0.003 250)', 'oklch(0.85 0.004 250)', 'oklch(0.72 0.03 255)', 'var(--acc)', 'oklch(0.45 0.005 250)', 'oklch(0.3 0.005 250)'];
const BANDS = [[0, 1000, '<1000萬'], [1000, 1500, '1000–1500'], [1500, 2000, '1500–2000'], [2000, 2500, '2000–2500'], [2500, 3000, '2500–3000'], [3000, 1e9, '3000萬+']];
const BAND_SHADES = ['oklch(0.93 0.003 250)', 'oklch(0.84 0.02 255)', 'oklch(0.72 0.06 255)', 'oklch(0.58 0.12 255)', 'oklch(0.45 0.1 255)', 'oklch(0.3 0.05 255)'];
const AREA_BINS = [[0, 20, '<20坪'], [20, 25, '20–25'], [25, 30, '25–30'], [30, 35, '30–35'], [35, 40, '35–40'], [40, 50, '40–50'], [50, 1e9, '50坪+']];
const EMPTY = '<div class="empty">此條件無資料</div>';

let DATA = [], MONTHS = [], CITIES = [], PACE = null;
const RG = { picks: ['竹北市', '新竹市', '竹東鎮', '湖口鄉'], period: '12' };
const PJ = { picks: [], cache: {} };

const mLabel = m => `${m.slice(2, 4)}/${m.slice(5)}`;
const zhFloor1 = t => /^(一層|1層|1)$/.test(String(t || '').trim());
function roomIndex(label) {
  const i = ROOMS.indexOf(label);
  if (i >= 0) return i;
  const n = { 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[String(label).replace('房', '')] ?? parseInt(label, 10);
  return n >= 5 ? 5 : -1;
}

// ---------- 共用圖表 ----------
// 多條折線（x 為月份類別）；vals 可含 null（當月樣本不足）
function multiLine(el, labels, series, { fmt = f1, unit = '', H = 220 } = {}) {
  const all = series.flatMap(s => s.vals).filter(v => v != null);
  if (!all.length) { el.innerHTML = EMPTY; return; }
  const W = Math.max(el.clientWidth, 260), pl = 40, pr = 10, pt = 14, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const y = nice(Math.min(...all), Math.max(...all)), sy = v => pt + ih - (v - y.lo) / ((y.hi - y.lo) || 1) * ih;
  const sx = i => pl + (labels.length === 1 ? iw / 2 : iw * i / (labels.length - 1));
  const step = Math.ceil(labels.length / (iw / 46));
  let s = `<svg width="${W}" height="${H}">`;
  y.t.forEach(t => { s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`; });
  labels.forEach((l, i) => { if (i % step === 0 || labels.length <= 14) s += `<text class="ax" x="${sx(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`; });
  series.forEach(sr => {
    let d = '', pen = false;
    sr.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${sx(i)},${sy(v)}`; pen = true; });
    s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  });
  const cw = iw / Math.max(labels.length - 1, 1);
  labels.forEach((l, i) => {
    const t = `${l}<br>` + series.map(sr => `${esc(sr.name)}　<b>${sr.vals[i] == null ? '—' : fmt(sr.vals[i]) + unit}</b>`).join('<br>');
    s += `<rect x="${sx(i) - cw / 2}" y="${pt}" width="${cw}" height="${ih}" fill="transparent" data-tip="${esc(t)}"/>`;
  });
  el.innerHTML = s + '</svg>';
}

// 多條 x-y 折線（x 為數值，例如距首筆天數）
function multiXY(el, series, { yMax = 100, xLabel = '' } = {}) {
  const pts = series.flatMap(s => s.pts);
  if (!pts.length) { el.innerHTML = EMPTY; return; }
  const W = Math.max(el.clientWidth, 260), H = 240, pl = 40, pr = 14, pt = 14, pb = 34, iw = W - pl - pr, ih = H - pt - pb;
  const xm = Math.max(30, ...pts.map(p => p.x)), sx = v => pl + v / xm * iw, sy = v => pt + ih - v / yMax * ih;
  const xs = Math.ceil(xm / 5 / 30) * 30 || 30;
  let s = `<svg width="${W}" height="${H}">`;
  [0, 20, 40, 60, 80, 100].forEach(t => { s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${t}%</text>`; });
  for (let v = 0; v <= xm; v += xs) s += `<text class="ax" x="${sx(v)}" y="${H - 16}" text-anchor="middle">${v}</text>`;
  s += `<text class="ax" x="${pl + iw / 2}" y="${H}" text-anchor="middle">${xLabel}</text>`;
  series.forEach(sr => {
    if (!sr.pts.length) return;
    s += `<path d="${sr.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join('')}" fill="none" stroke="${sr.color}" stroke-width="1.8"/>`;
    const L = sr.pts[sr.pts.length - 1];
    s += `<circle cx="${sx(L.x)}" cy="${sy(L.y)}" r="3.5" fill="${sr.color}" data-tip="${esc(`${esc(sr.name)}<br>第 ${L.x} 天 · <b>${f1(L.y)}%</b>`)}"/>`;
  });
  el.innerHTML = s + '</svg>';
}

const legend = (el, items) => { el.innerHTML = items.map(x => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join(''); };

// 100% 堆疊橫條：rows = [{name, color, counts[]}]
function stackBars(el, rows, keys, shades) {
  if (!rows.some(r => r.counts.some(Boolean))) { el.innerHTML = EMPTY; return; }
  el.innerHTML = rows.map(r => {
    const tot = r.counts.reduce((a, b) => a + b, 0) || 1;
    return `<div class="sbar"><span style="color:${r.color};font-weight:500">${esc(r.name)}</span><div class="bar">${r.counts.map((c, i) => {
      if (!c) return '';
      const pct = c / tot * 100, dark = i >= Math.ceil(keys.length / 2);
      return `<div style="flex:${c};background:${shades[i]};color:${dark ? '#fff' : 'var(--ink)'}" data-tip="${esc(`${esc(r.name)} · ${keys[i]}　<b>${pct.toFixed(1)}%</b>（${c} 件）`)}">${pct >= 9 ? pct.toFixed(0) + '%' : ''}</div>`;
    }).join('')}</div></div>`;
  }).join('') + `<div class="skey">${keys.map((k, i) => `<span><i style="background:${shades[i]}"></i>${k}</span>`).join('')}</div>`;
}

// ---------- 資料 ----------
function normalize(r) {
  const note = String(r['備註'] || '');
  return {
    m: r['月份'] || '', r: r['鄉鎮市區'] || '', pj: r['建案名稱'] || '',
    p: (Number(r['建物單價']) || 0) / 10000, tot: (Number(r['總價']) || 0) / 10000, ping: Number(r['建物坪數']) || 0,
    rooms: roomIndex(r['房型']),
    ok: !(note.includes('特殊關係') || note.includes('親友')) && !zhFloor1(r['移轉層次']) && !String(r['解約情形'] || '').trim() && !isNonResidential(r),
  };
}

// ---------- 區域比較 ----------
const REGION_OPTIONS = () => {
  const out = [];
  REGION_GROUPS.forEach(([label, list]) => {
    const present = list.filter(c => CITIES.includes(c));
    if (!present.length) return;
    out.push({ group: label });
    if (present.length > 1) out.push({ v: 'grp:' + label, t: label + '全區' });
    present.forEach(c => out.push({ v: c, t: c }));
  });
  return out;
};

function renderRegionPicks() {
  $('regionPick').innerHTML = REGION_OPTIONS().map(o => {
    if (o.group) return `<span class="pk-grp">${o.group}</span>`;
    const i = RG.picks.indexOf(o.v);
    return `<button class="pk ${i >= 0 ? 'on' : ''}" data-v="${esc(o.v)}" style="${i >= 0 ? `color:${COLORS[i]}` : ''}"><i style="${i >= 0 ? `background:${COLORS[i]}` : ''}"></i>${esc(o.t)}</button>`;
  }).join('');
}
$('regionPick').addEventListener('click', e => {
  const b = e.target.closest('.pk');
  if (!b) return;
  const v = b.dataset.v, i = RG.picks.indexOf(v);
  if (i >= 0) RG.picks.splice(i, 1);
  else if (RG.picks.length < MAX_PICK) RG.picks.push(v);
  else { RG.picks.shift(); RG.picks.push(v); }
  renderRegion();
});
$('regionPeriod').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  RG.period = b.dataset.v;
  [...$('regionPeriod').children].forEach(x => x.classList.toggle('on', x === b));
  renderRegion();
});

function renderRegion() {
  renderRegionPicks();
  const period = RG.period === 'all' ? MONTHS : MONTHS.slice(-Number(RG.period));
  const pset = new Set(period), l12 = new Set(MONTHS.slice(-12)), p12 = new Set(MONTHS.slice(-24, -12)), l3 = new Set(MONTHS.slice(-3));
  const regions = RG.picks.map((v, i) => {
    const cities = citiesForRegion(v, CITIES);
    const all = DATA.filter(x => x.ok && cities.includes(x.r));
    return { v, i, name: regionLabel(v).replace('全區', '（全區）'), color: COLORS[i], all, cur: all.filter(x => pset.has(x.m)) };
  });
  if (!regions.length) {
    ['regionTable', 'rgPrice', 'rgVol', 'rgRoom', 'rgBand'].forEach(id => { $(id).innerHTML = EMPTY; });
    return;
  }

  // 比較表
  const stat = g => {
    const c = g.cur, P = c.map(x => x.p), T = c.map(x => x.tot);
    const a12 = avg(g.all.filter(x => l12.has(x.m)).map(x => x.p)), a0 = avg(g.all.filter(x => p12.has(x.m)).map(x => x.p));
    const rc = ROOMS.map((_, k) => c.filter(x => x.rooms === k).length), top = rc.indexOf(Math.max(...rc));
    return {
      n: c.length, perMonth: c.length / (period.length || 1), p: avg(P), pm: med(P), yoy: a0 ? (a12 / a0 - 1) * 100 : null,
      ping: avg(c.map(x => x.ping)), tm: med(T), room: c.length ? `${ROOMS[top]} ${(rc[top] / c.length * 100).toFixed(0)}%` : '—',
      pj: new Set(c.map(x => x.pj).filter(Boolean)).size, active: new Set(g.all.filter(x => l3.has(x.m)).map(x => x.pj).filter(Boolean)).size,
    };
  };
  const S = regions.map(stat);
  const row = (label, f, cls = '') => `<tr><td>${label}</td>${S.map((s, i) => `<td class="${cls}">${f(s, i)}</td>`).join('')}</tr>`;
  $('regionTable').innerHTML = `<thead><tr><th></th>${regions.map(g => `<th><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</th>`).join('')}</tr></thead><tbody>
    ${row('成交件數', s => s.n.toLocaleString())}
    ${row('月均成交', s => f1(s.perMonth) + '<small>件</small>')}
    ${row('平均單價', s => s.n ? f1(s.p) + '<small>萬/坪</small>' : '—')}
    ${row('單價中位數', s => s.n ? f1(s.pm) : '—')}
    ${row('均價年增（近12月 vs 前12月）', s => s.yoy == null ? '—' : `${s.yoy > 0 ? '+' : ''}${s.yoy.toFixed(1)}%`)}
    ${row('總價中位數', s => s.n ? fi(s.tm) + '<small>萬</small>' : '—')}
    ${row('平均坪數', s => s.n ? f1(s.ping) + '<small>坪</small>' : '—')}
    ${row('主力房型', s => s.room, 'txt')}
    ${row('有成交建案數', s => s.pj)}
    ${row('近 3 月有成交建案', s => s.active)}
  </tbody>`;

  // 趨勢
  const labels = period.map(mLabel);
  const byMonth = (g, f) => period.map(m => { const a = g.cur.filter(x => x.m === m); return a.length >= 3 ? f(a) : null; });
  multiLine($('rgPrice'), labels, regions.map(g => ({ name: g.name, color: g.color, vals: byMonth(g, a => avg(a.map(x => x.p))) })), { unit: ' 萬/坪' });
  multiLine($('rgVol'), labels, regions.map(g => ({ name: g.name, color: g.color, vals: period.map(m => g.cur.filter(x => x.m === m).length) })), { fmt: fi, unit: ' 件' });
  legend($('rgLegend1'), regions); legend($('rgLegend2'), regions);

  stackBars($('rgRoom'), regions.map(g => ({ name: g.name, color: g.color, counts: ROOMS.map((_, k) => g.cur.filter(x => x.rooms === k).length) })), ROOMS, ROOM_SHADES);
  stackBars($('rgBand'), regions.map(g => ({ name: g.name, color: g.color, counts: BANDS.map(([a, b]) => g.cur.filter(x => x.tot >= a && x.tot < b).length) })), BANDS.map(b => b[2]), BAND_SHADES);
}

// ---------- 建案比較 ----------
function renderProjPicks() {
  $('projPick').innerHTML = PJ.picks.length
    ? PJ.picks.map((n, i) => `<button class="pk on" data-v="${esc(n)}" style="color:${COLORS[i]}"><i style="background:${COLORS[i]}"></i>${esc(n)}<em class="x">×</em></button>`).join('')
    : '<span class="meta">尚未選擇建案，輸入名稱或到「去化速度排行」點建案加入</span>';
}
$('projPick').addEventListener('click', e => {
  const b = e.target.closest('.pk');
  if (!b) return;
  PJ.picks = PJ.picks.filter(n => n !== b.dataset.v);
  renderProject();
});
function addProject(name) {
  if (!name || PJ.picks.includes(name)) return;
  if (!DATA.some(x => x.pj === name)) return;
  if (PJ.picks.length >= MAX_PICK) PJ.picks.shift();
  PJ.picks.push(name);
  renderProject();
}
$('projInput').addEventListener('change', e => { addProject(e.target.value.trim()); e.target.value = ''; });
$('projInput').addEventListener('keydown', e => { if (e.key === 'Enter') { addProject(e.target.value.trim()); e.target.value = ''; } });

async function loadProjectDetail(name) {
  if (PJ.cache[name]) return PJ.cache[name];
  PJ.cache[name] = await Api.project(name).catch(() => ({ speed: null, floor: null }));
  return PJ.cache[name];
}

async function renderProject() {
  renderProjPicks();
  if (!PJ.picks.length) { ['projTable', 'pjCurve', 'pjArea'].forEach(id => { $(id).innerHTML = EMPTY; }); $('pjLegend1').innerHTML = ''; return; }
  $('projTable').innerHTML = '<tbody><tr><td>載入中…</td></tr></tbody>';
  await ensurePace();
  const picks = PJ.picks.slice();
  const details = await Promise.all(picks.map(loadProjectDetail));
  if (picks.join('|') !== PJ.picks.join('|')) return;   // 載入期間使用者又改了選擇

  const P = picks.map((name, i) => {
    const rows = DATA.filter(x => x.pj === name && x.ok);
    const pace = PACE.projects.find(x => x.name === name) || {};
    const rc = ROOMS.map((_, k) => rows.filter(x => x.rooms === k).length), top = rc.indexOf(Math.max(...rc));
    const prices = rows.map(x => x.p).filter(v => v > 0), pings = rows.map(x => x.ping).filter(v => v > 0);
    return {
      name, color: COLORS[i], rows, pace, ...details[i],
      city: pace.city || (rows[0] || {}).r || '',
      p: avg(prices), pmin: prices.length ? Math.min(...prices) : null, pmax: prices.length ? Math.max(...prices) : null,
      tm: med(rows.map(x => x.tot)), pingMin: pings.length ? Math.min(...pings) : null, pingMax: pings.length ? Math.max(...pings) : null,
      room: rows.length ? `${ROOMS[top]} ${(rc[top] / rows.length * 100).toFixed(0)}%` : '—',
    };
  });
  const row = (label, f, cls = '') => `<tr><td>${label}</td>${P.map(p => `<td class="${cls}">${f(p)}</td>`).join('')}</tr>`;
  const prem = p => p.floor && p.floor.stats && p.floor.stats.floorPremiumWan != null ? `${p.floor.stats.floorPremiumWan > 0 ? '+' : ''}${Math.round(p.floor.stats.floorPremiumWan * 10000).toLocaleString()}<small>元/坪</small>` : '—';
  $('projTable').innerHTML = `<thead><tr><th></th>${P.map(p => `<th><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${row('區域', p => esc(p.city), 'txt')}
    ${row('總戶數', p => p.pace.units ?? '—')}
    ${row('已售戶數', p => p.pace.sold ?? '—')}
    ${row('銷售率', p => p.pace.soldPct == null ? '—' : f1(p.pace.soldPct) + '%')}
    ${row('首筆成交', p => esc(p.pace.firstDate || '—'))}
    ${row('上市月數', p => p.pace.monthsOnMarket ?? '—')}
    ${row('每月去化', p => p.pace.pacePct == null ? '—' : f1(p.pace.pacePct) + '<small>%</small>')}
    ${row('近 3 月去化', p => (p.pace.recent3 ?? '—') + '<small>戶</small>')}
    ${row('50% 耗時', p => p.pace.monthsTo50 == null ? '未達' : p.pace.monthsTo50 + '<small>個月</small>')}
    ${row('平均單價', p => p.rows.length ? f1(p.p) + '<small>萬/坪</small>' : '—')}
    ${row('單價區間', p => p.pmin == null ? '—' : `${f1(p.pmin)}–${f1(p.pmax)}`)}
    ${row('總價中位數', p => p.rows.length ? fi(p.tm) + '<small>萬</small>' : '—')}
    ${row('坪數範圍', p => p.pingMin == null ? '—' : `${f1(p.pingMin)}–${f1(p.pingMax)}`)}
    ${row('主力房型', p => p.room, 'txt')}
    ${row('樓層價差（每層）', prem)}
  </tbody>`;

  multiXY($('pjCurve'), P.map(p => ({
    name: p.name, color: p.color,
    pts: ((p.speed && p.speed['銷售速度資料']) || []).map(d => ({ x: d['距首筆天數'], y: Math.min(d['銷售比例'], 100) })),
  })), { xLabel: '距首筆交易日（天）' });
  legend($('pjLegend1'), P.map(p => ({ name: p.name + (p.pace.units ? '' : '（缺總戶數，以已售戶為 100%）'), color: p.color })));
  stackBars($('pjArea'), P.map(p => ({ name: p.name, color: p.color, counts: AREA_BINS.map(([a, b]) => p.rows.filter(x => x.ping >= a && x.ping < b).length) })), AREA_BINS.map(b => b[2]), BAND_SHADES.concat('oklch(0.2 0.03 255)'));
}

// ---------- 去化速度排行 ----------
async function ensurePace() {
  if (!PACE) PACE = await Api.pace();
  return PACE;
}

function renderPace() {
  if (!PACE) { $('paceTable').innerHTML = `<tbody><tr><td>${EMPTY}</td></tr></tbody>`; return; }
  $('paceAsOf').textContent = `資料截至 ${PACE.asOf} · 以已售戶計（排除解約、同戶只算一次）`;
  const cities = citiesForRegion($('pcRegion').value, CITIES);
  const year = $('pcYear').value, minU = Number($('pcMin').value), key = $('pcSort').value, onSale = $('pcOnSale').checked;
  let list = PACE.projects.filter(p =>
    (!cities.length || cities.includes(p.city)) && (year === 'all' || String(p.launchYear) === year) &&
    (minU === 0 || (p.units || 0) >= minU) && (!onSale || (p.soldPct ?? 0) < 95));
  const noUnits = key !== 'recent3' ? list.filter(p => p[key] == null).length : 0;
  if (key !== 'recent3') list = list.filter(p => p[key] != null);
  list.sort((a, b) => key === 'monthsTo50' ? a[key] - b[key] : b[key] - a[key]);
  $('pcCount').textContent = `${list.length} 案` + (noUnits ? `（另 ${noUnits} 案缺總戶數或未達 50%，未列入此排序）` : '');
  const top = list.slice(0, 100);
  $('paceTable').innerHTML = `<thead><tr>
      <th class="l"></th><th class="l">建案</th><th class="l">區域</th><th>總戶數</th><th>已售</th><th>銷售率</th>
      <th>首筆成交</th><th>上市月數</th><th>每月去化</th><th>近 3 月去化</th><th>50% 耗時</th><th>均價 萬/坪</th></tr></thead>
    <tbody>${top.map((p, i) => `<tr>
      <td class="no l">${i + 1}</td>
      <td class="nm l"><button data-nm="${esc(p.name)}" title="加入建案比較">${esc(p.name)}</button></td>
      <td class="rg l">${esc(p.city)}</td>
      <td>${p.units ?? '—'}</td><td>${p.sold}</td>
      <td><span class="pbar"><span><i style="width:${p.soldPct ?? 0}%"></i></span>${p.soldPct == null ? '—' : f1(p.soldPct) + '%'}</span></td>
      <td>${esc(p.firstDate)}</td><td>${p.monthsOnMarket}</td>
      <td class="${key === 'pacePct' && i < 10 ? 'hot' : ''}">${p.pacePct == null ? '—' : f1(p.pacePct) + '%'}</td>
      <td class="${key === 'recent3' && i < 10 ? 'hot' : ''}">${p.recent3}</td>
      <td>${p.monthsTo50 == null ? '—' : p.monthsTo50 + ' 月'}</td>
      <td>${p.avgPriceWan ?? '—'}</td></tr>`).join('') || `<tr><td colspan="12">${EMPTY}</td></tr>`}</tbody>`;
}
['pcRegion', 'pcYear', 'pcMin', 'pcSort', 'pcOnSale'].forEach(id => $(id).addEventListener('change', renderPace));
$('paceTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-nm]');
  if (!b) return;
  addProject(b.dataset.nm);
  showTab('project');
});

// ---------- 分頁 ----------
function showTab(t) {
  [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
  history.replaceState(null, '', '#' + t);
  if (t === 'region') renderRegion();
  if (t === 'project') renderProject();
  if (t === 'pace') ensurePace().then(renderPace).catch(err => { $('paceTable').innerHTML = `<tbody><tr><td>載入失敗：${esc(err.message)}</td></tr></tbody>`; });
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

async function init() {
  try {
    const [latest, data] = await Promise.all([Api.latest(), Api.data()]);
    $('stamp').textContent = fmtStamp(latest);
    DATA = (data.rows || []).map(normalize);
    MONTHS = [...new Set(DATA.map(x => x.m).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort();
    CITIES = [...new Set(DATA.map(x => x.r).filter(Boolean))];
    $('projList').innerHTML = [...new Set(DATA.map(x => x.pj).filter(Boolean))].sort().map(n => `<option value="${esc(n)}">`).join('');
    buildRegionSelect($('pcRegion'), CITIES);
    opt($('pcYear'), [['all', '全部'], ...[...new Set(MONTHS.map(m => m.slice(0, 4)))].sort().reverse().map(y => [y, y + ' 年開賣'])]);
    RG.picks = RG.picks.filter(v => citiesForRegion(v, CITIES).length);
    const t = (location.hash || '#region').slice(1);
    showTab(['region', 'project', 'pace'].includes(t) ? t : 'region');
  } catch (err) {
    $('stamp').textContent = `讀取失敗：${err.message}`;
  }
}
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const t = (location.hash || '#region').slice(1); if (DATA.length && t !== 'pace') showTab(t); }, 150); });
init();
