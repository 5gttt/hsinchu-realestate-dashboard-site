// 建案熱力看板（2026-09-30 依 Claude Design「建案熱力看板.html」改版，接真實 API）
// 舊版備份：backups/pre-county-expand-20260930/webapp/projects.js
// 建案數上千時色塊太碎，只畫成交量前 N 名（搜尋命中的另外補上）；手機寬度再減量
const TREEMAP_LIMIT = matchMedia('(max-width: 760px)').matches ? 30 : 80;

const S = { year: 'all', region: 'all', month: 'all', period: 'all', q: '', sel: null };
let MONTHS = [];       // 資料內所有 'YYYY-MM'，遞增
let CITIES = [];       // 資料內所有鄉鎮市區
let ALL_ITEMS = [];    // 目前篩選下的全部建案統計
let ITEMS = [];        // 實際畫在 treemap 上的建案
let statsReq = 0, detailReq = 0;

// 顏色：低價苔綠 ⇄ 高價磚紅，中間淡色
const ramp = t => {
  t = Math.max(0, Math.min(1, t));
  const a = Math.round(12 + Math.abs(t - 0.5) * 2 * 88);
  return `color-mix(in srgb, var(${t < 0.5 ? '--lo' : '--hi'}) ${a}%, #fff)`;
};
const txt = t => Math.abs(t - 0.5) > 0.3 ? '#fff' : 'var(--ink)';

// 戶別標籤：「甲-D」→ 甲棟D戶；單純棟別「A」→ A棟
const wingHead = w => w.includes('-') ? w.replace('-', '棟') + '戶' : w + '棟';
const wingShort = w => w.includes('-') ? w.replace('-', '') : w + '棟';

// ---------- 篩選 ----------
function filterParams() {
  const p = new URLSearchParams();
  const cities = citiesForRegion(S.region, CITIES);
  if (cities.length) p.set('cities', cities.join(','));
  const months = monthsForFilter(MONTHS, S);
  if (months) p.set('months', months.join(','));
  return { params: p, months };
}

// ---------- treemap ----------
function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.slice();
  while (rest.length && w > 0 && h > 0) {
    const sh = Math.min(w, h);
    let row = [], best = Infinity;
    for (const it of rest) {
      const r = [...row, it], s = r.reduce((a, b) => a + b.a, 0);
      const mx = Math.max(...r.map(z => z.a)), mn = Math.min(...r.map(z => z.a));
      const wo = Math.max(sh * sh * mx / (s * s), s * s / (sh * sh * mn));
      if (wo > best) break;
      best = wo; row = r;
    }
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) {
      const rw = s / h; let yy = y;
      row.forEach(z => { const hh = z.a / rw; out.push({ ...z, x, y: yy, w: rw, h: hh }); yy += hh; });
      x += rw; w -= rw;
    } else {
      const rh = s / w; let xx = x;
      row.forEach(z => { const ww = z.a / rh; out.push({ ...z, x: xx, y, w: ww, h: rh }); xx += ww; });
      y += rh; h -= rh;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

async function loadStats() {
  const my = ++statsReq;
  const { params, months } = filterParams();
  if (months && !months.length) { ALL_ITEMS = []; renderMap(); return; }
  $('tm').innerHTML = '<div class="empty">資料載入中…</div>';
  try {
    const j = await Api.stats(params);
    if (my !== statsReq) return;
    ALL_ITEMS = (j.data || [])
      .filter(d => d['建案名稱'] && d['成交筆數'] > 0)
      .map(d => ({ nm: d['建案名稱'], r: d['鄉鎮市區'] || '', n: d['成交筆數'], avg: (d['平均單價'] || 0) / 10000 }))
      .sort((a, b) => b.n - a.n);
    renderMap();
  } catch (err) {
    if (my !== statsReq) return;
    $('tm').innerHTML = `<div class="empty">載入失敗：${esc(err.message)}</div>`;
  }
}

function renderMap() {
  const el = $('tm');
  const q = S.q.trim();
  ITEMS = ALL_ITEMS.slice(0, TREEMAP_LIMIT);
  if (q) ALL_ITEMS.slice(TREEMAP_LIMIT).filter(x => x.nm.includes(q)).forEach(x => ITEMS.push(x));

  if (!ITEMS.length) {
    el.innerHTML = '<div class="empty">此條件無成交資料</div>';
    $('scope').textContent = ''; $('tmNote').textContent = ''; $('lgLo').textContent = ''; $('lgHi').textContent = '';
    $('detail').innerHTML = '';
    return;
  }
  const W = el.clientWidth, H = el.clientHeight;
  const tot = ITEMS.reduce((s, x) => s + x.n, 0);
  const allTot = ALL_ITEMS.reduce((s, x) => s + x.n, 0);
  const prices = ITEMS.map(x => x.avg).filter(v => v > 0);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  $('lgLo').textContent = f1(lo);
  $('lgHi').textContent = f1(hi) + ' 萬/坪';
  $('scope').textContent = `${ALL_ITEMS.length} 個建案 · ${allTot.toLocaleString()} 筆`;
  const hidden = ALL_ITEMS.length - ITEMS.length;
  $('tmNote').textContent = hidden > 0 ? `色塊只顯示成交量前 ${TREEMAP_LIMIT} 名，其餘 ${hidden} 個建案可用右上搜尋找到。` : '';

  el.innerHTML = squarify(ITEMS.map(x => ({ ...x, a: x.n / tot * W * H })), 0, 0, W, H).map(t => {
    const k = (t.avg - lo) / ((hi - lo) || 1);
    const cls = [t.w < 110 || t.h < 72 ? 'sm' : '', t.w < 52 || t.h < 30 ? 'xs' : '', S.sel === t.nm ? 'on' : '', q && !t.nm.includes(q) ? 'dim' : ''].join(' ');
    const tipHtml = esc(`<b>${esc(t.nm)}</b>　${esc(t.r)}<br>${t.n} 筆 · 均價 <b>${f1(t.avg)}</b> 萬/坪`);
    return `<div class="tile ${cls}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px" data-nm="${esc(t.nm)}" data-tip="${tipHtml}">`
      + `<div style="background:${ramp(k)};color:${txt(k)}"><span style="display:flex;flex-direction:column;min-width:0"><b>${esc(t.nm)}</b><small>${esc(t.r)}</small></span>`
      + `<span class="n"><span><em>${t.n}</em> 筆</span><span>${f1(t.avg)}</span></span></div></div>`;
  }).join('');

  if (!S.sel || !ITEMS.some(x => x.nm === S.sel)) {
    const hit = q && ITEMS.find(x => x.nm.includes(q));
    selectProject((hit || ITEMS[0]).nm, false);
  }
}

$('tm').addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (t) selectProject(t.dataset.nm, true);
});

function selectProject(nm, scroll) {
  S.sel = nm;
  document.querySelectorAll('#tm .tile').forEach(t => t.classList.toggle('on', t.dataset.nm === nm));
  loadDetail(nm);
  if (scroll) {
    const d = $('detail');
    scrollTo({ top: d.getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' });
  }
}

// ---------- 建案明細 ----------
async function loadDetail(nm) {
  const my = ++detailReq;
  const el = $('detail');
  el.innerHTML = `<div class="det-h"><div><h2>${esc(nm)}</h2><p>載入中…</p></div></div>`;
  const [{ speed, floor }, park] = await Promise.all([
    Api.project(nm).catch(() => ({ speed: null, floor: null })),
    Api.parking().catch(() => null),
  ]);
  if (my !== detailReq) return;
  renderDetail(nm, speed, floor, park ? park.filter(x => normName(x.pj) === normName(nm)) : null);
}

function renderDetail(nm, speed, floor, park) {
  const el = $('detail');
  const item = ALL_ITEMS.find(x => x.nm === nm);
  const units = speed && Number(speed['總戶數']) > 0 ? Number(speed['總戶數']) : null;
  // 已售戶數：排除解約、同一戶只算一次（後端 dedupe_sold_units）
  const n = speed ? (speed['已售戶數'] ?? speed['總交易筆數']) : 0;
  const pts = speed ? (speed['銷售速度資料'] || []) : [];
  const over = !!(speed && speed['超過總戶數']);
  const pct = units ? Math.min(n / units * 100, 100) : null;
  const breakdown = speed && speed['原始筆數'] > n
    ? `原始 ${speed['原始筆數']} 筆 ＝ 已售 ${n} 戶${speed['解約筆數'] ? ` ＋ 解約 ${speed['解約筆數']} 筆` : ''}${speed['重複登錄筆數'] ? ` ＋ 同戶重複登錄 ${speed['重複登錄筆數']} 筆` : ''}`
    : '';

  // 副標：沿用樓層分析的「區域・層數・棟數」，再補總戶數
  const subParts = floor && floor.subtitle
    ? floor.subtitle.split('・').filter(s => s && s !== '實價登錄資料')
    : [item ? item.r : ''];
  if (units) subParts.push(`${units} 戶`);
  subParts.push('全期實價登錄資料');

  const milestone = m => {
    const p = pts.find(x => x['銷售比例'] >= m);
    return p ? `${p['日期']}<em>${Math.round(p['距首筆天數'] / 30.4)} 個月</em>` : '未達成';
  };

  const segs = 30, pc = Math.min(pct ?? 0, 100), full = Math.floor(pc / 100 * segs), part = pc / 100 * segs - full;
  const prog = Array.from({ length: segs }, (_, i) =>
    i < full ? '<i class="s"></i>' : (i === full && part > 0 ? `<i class="h" style="--p:${part * 100}%"></i>` : '<i></i>')).join('');

  const statCard = `
    <div class="card stat">
      <div>
        <div class="lb">銷售率</div>
        ${pct == null ? '<div class="big na">總戶數待補</div>'
          : over ? '<div class="big">100<small>%</small></div><div class="warn">已售戶數超過總戶數，總戶數可能登錄有誤</div>'
          : `<div class="big">${f1(pct)}<small>%</small></div>`}
      </div>
      <div>
        <div class="lb" style="display:flex;justify-content:space-between"><span>已售戶數 / 總戶數</span><b style="font-family:var(--mono);font-weight:500">${n} / ${units ?? '—'}</b></div>
        <div class="prog" style="margin-top:8px">${prog}</div>
        ${breakdown ? `<div class="bd">${breakdown}</div>` : ''}
      </div>
      <div class="ms">
        <div><span>首筆交易日</span><b>${esc(speed ? speed['首筆交易日'] : '—')}</b></div>
        <div><span>20% 達成</span><b>${units ? milestone(20) : '—'}</b></div>
        <div><span>50% 達成</span><b>${units ? milestone(50) : '—'}</b></div>
        <div><span>最新交易日</span><b>${esc(speed ? speed['最新交易日'] : '—')}</b></div>
      </div>
    </div>`;

  const curveCard = `
    <div class="card panel">
      <div class="ph"><h3>銷售速度</h3><small>${units ? '累計已售戶數佔總戶數' : '累計佔已售戶數（缺總戶數）'}</small></div>
      <div class="chart" id="cv"></div>
    </div>`;

  el.innerHTML = `
    <div class="det-h"><div><h2>${esc(nm)}</h2><p>${esc(subParts.join(' · '))}</p></div><span class="meta">點擊上方色塊切換建案</span></div>
    <div class="det">${statCard}${curveCard}</div>
    ${floorPanel(floor)}
    ${parkPanel(park)}`;

  if (pts.length) curve($('cv'), pts, !!units);
  else $('cv').innerHTML = '<div class="empty">無法計算銷售速度</div>';
  if ($('pkDots')) parkTrend($('pkDots'), park.filter(parkValid));
}

// ---------- 車位價格 ----------
const PARK_COLORS = { B1: 'var(--acc)', B2: 'oklch(0.62 0.15 45)', B3: 'oklch(0.52 0.11 150)', B4: 'oklch(0.32 0.01 250)', 'B5+': 'oklch(0.32 0.01 250)', '1F': 'oklch(0.72 0.01 250)', '2F+': 'oklch(0.72 0.01 250)' };
const parkColor = f => PARK_COLORS[f] || 'oklch(0.72 0.01 250)';
const mLabel = m => `${m.slice(2, 4)}/${m.slice(5)}`;

function parkPanel(rows) {
  const head = '<div class="ph"><h3>車位價格</h3><small>萬元/位 · 已排除解約、特殊交易</small></div>';
  if (rows == null) return `<div class="card panel" style="margin-top:12px">${head}<div class="empty">車位資料讀取失敗</div></div>`;
  if (!rows.length) return `<div class="card panel" style="margin-top:12px">${head}<div class="empty">此建案沒有車位成交登錄</div></div>`;
  const ok = rows.filter(parkValid), zero = rows.filter(x => x.zero).length, low = rows.filter(x => x.q).length;
  const months = [...new Set(rows.map(x => x.m))].sort(), recent = new Set(months.slice(-6));
  const multi = rows.filter(x => x.n >= 2).length;

  // 摘要：坡道平面中位數、一戶多車位比例
  const ramp = ok.filter(x => x.g === '坡道平面').map(x => x.p);
  const sumRows = [
    ramp.length ? `<div class="fl-row"><span>坡道平面</span><b>中位數 ${fi(med(ramp))} 萬 · ${fi(Math.min(...ramp))}–${fi(Math.max(...ramp))} 萬（${ramp.length} 位）</b></div>` : '',
    `<div class="fl-row"><span>一戶多車位</span><b>${multi} 位屬於一次買 2 個以上的交易（佔 ${(multi / rows.length * 100).toFixed(0)}%）</b></div>`,
  ].filter(Boolean).join('');

  // 類別 × 樓層
  let body = '';
  PARK_GROUPS.forEach(([g]) => {
    const gr = ok.filter(x => x.g === g);
    if (!gr.length) return;
    parkByFloor(gr).forEach((f, i, arr) => {
      const fr = gr.filter(x => x.f === f.f), rc = fr.filter(x => recent.has(x.m)).map(x => x.p);
      const ar = fr.map(x => x.a).filter(a => a > 0), last = fr.reduce((a, x) => x.m > a ? x.m : a, '');
      body += `<tr>${i === 0 ? `<td class="pn" rowspan="${arr.length}">${g}</td>` : ''}`
        + `<td><i class="fdot" style="background:${parkColor(f.f)}"></i>${esc(f.f)}</td><td class="num">${f.n}</td>`
        + `<td class="num"><b>${fi(f.med)}</b></td><td class="num">${f.lo === f.hi ? fi(f.lo) : `${fi(f.lo)}–${fi(f.hi)}`}</td>`
        + `<td class="num">${rc.length ? `${fi(med(rc))}<small>（${rc.length}）</small>` : '—'}</td>`
        + `<td class="num">${ar.length ? f1(med(ar)) : '—'}</td><td class="num">${last ? mLabel(last) : '—'}</td></tr>`;
    });
  });

  return `
    <div class="card panel" style="margin-top:12px">
      ${head}
      <div class="fl-sum">${sumRows}</div>
      <div class="pk-grid">
        <div class="ac-table-wrap"><table class="ac pkt">
          <thead><tr><th>類別</th><th>樓層</th><th class="num">車位數</th><th class="num">中位數</th><th class="num">最低–最高</th><th class="num">近 6 月中位數</th><th class="num">坪數</th><th class="num">最近成交</th></tr></thead>
          <tbody>${body || '<tr><td colspan="8">無有效價格</td></tr>'}</tbody>
        </table></div>
        <div><div class="pk-cap">各樓層價格走勢（每點＝當月成交車位中位數，滑鼠移上或點按看數字）</div><div class="chart" id="pkDots"></div></div>
      </div>
      <div class="bd">${[
        `共 ${rows.length} 個車位`,
        zero ? `價格 0（含於房價或贈送）${zero} 個未計入` : '',
        low ? `${low} 個價格異常待確認未計入（坡道平面低於 ${PARK_LOW} 萬，或高於同案中位數 ${PARK_HIGH} 倍且坪數不大）` : '',
        '近 6 月＝此建案最後 6 個有成交的月份',
      ].filter(Boolean).join('；')}</div>
    </div>`;
}

// 各樓層價格走勢：一條線＝一個樓層（坡道平面優先），每點＝該月成交車位的價格中位數
function parkTrend(el, rows) {
  const ramp = rows.filter(x => x.g === '坡道平面');
  const use = ramp.length >= 3 ? ramp : rows.filter(x => x.g === (PARK_GROUPS.find(([g]) => rows.some(x => x.g === g)) || [''])[0]);
  if (!use.length) { el.innerHTML = '<div class="empty">無有效價格</div>'; return; }
  const ms = [...new Set(use.map(x => x.m))].sort();
  // 首尾之間每個月都列出（沒成交的月份留空，線直接連到下一個有成交的月份）
  const months = [];
  for (let [y, m] = ms[0].split('-').map(Number); `${y}-${pad(m)}` <= ms[ms.length - 1]; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${pad(m)}`);
  const floors = [...new Set(use.map(x => x.f))].sort((a, b) => PARK_FLOORS.indexOf(a) - PARK_FLOORS.indexOf(b));
  const series = floors.map(f => ({ f, pts: months.map(m => { const a = use.filter(x => x.f === f && x.m === m).map(x => x.p); return a.length ? { v: med(a), n: a.length } : null; }) }));
  const all = series.flatMap(s => s.pts.filter(Boolean).map(p => p.v));
  const W = Math.max(el.clientWidth, 260), H = 240, pl = 40, pr = 12, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const y = nice(Math.min(...all), Math.max(...all)), sy = v => pt + ih - (v - y.lo) / ((y.hi - y.lo) || 1) * ih;
  const sx = i => pl + (months.length === 1 ? iw / 2 : iw * i / (months.length - 1));
  const step = Math.ceil(months.length / (iw / 46));
  let s = `<svg width="${W}" height="${H}">`;
  y.t.forEach(t => { s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${fi(t)}</text>`; });
  months.forEach((m, i) => { if (i % step === 0 || months.length <= 12) s += `<text class="ax" x="${sx(i)}" y="${H - 8}" text-anchor="middle">${mLabel(m)}</text>`; });
  series.forEach(sr => {
    const c = parkColor(sr.f), pts = sr.pts.map((p, i) => p && { x: sx(i), y: sy(p.v) }).filter(Boolean);
    s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`;
    pts.forEach(p => { s += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${c}"/>`; });
  });
  // 每個月一條感應區：列出各樓層當月中位數
  const cw = iw / Math.max(months.length - 1, 1);
  months.forEach((m, i) => {
    const lines = series.filter(sr => sr.pts[i]).map(sr => `${esc(sr.f)}　<b>${fi(sr.pts[i].v)} 萬</b>（${sr.pts[i].n} 位）`);
    if (lines.length) s += `<rect x="${sx(i) - cw / 2}" y="${pt}" width="${cw}" height="${ih}" fill="transparent" data-tip="${esc(`${mLabel(m)}<br>${lines.join('<br>')}`)}"/>`;
  });
  el.innerHTML = s + '</svg>';
  el.insertAdjacentHTML('beforeend', `<div class="gl2">${floors.map(f => `<span><i style="background:${parkColor(f)};height:3px;vertical-align:3px"></i>${esc(f)}</span>`).join('')}<span>${esc(use[0].g)}</span></div>`);
}

function curve(el, raw, hasUnits) {
  // 總戶數偏小時累計會超過 100%，曲線封頂在 100%（上方卡片已提示總戶數可能有誤）
  const pts = raw.map(p => ({ x: p['距首筆天數'], y: Math.min(p['銷售比例'], 100), d: p['日期'], c: p['累積交易筆數'] }));
  const W = Math.max(el.clientWidth, 260), H = 260, pl = 38, pr = 14, pt = 14, pb = 34;
  const iw = W - pl - pr, ih = H - pt - pb;
  const ymax = 100;
  const xm = Math.max(pts[pts.length - 1].x, 30);
  const sx = v => pl + v / xm * iw, sy = v => pt + ih - v / ymax * ih;
  const xs = Math.ceil(xm / 5 / 30) * 30 || 30;
  let s = `<svg width="${W}" height="${H}">`;
  [0, 20, 40, 60, 80, 100].forEach(t => {
    s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${t}%</text>`;
  });
  for (let v = 0; v <= xm; v += xs) s += `<text class="ax" x="${sx(v)}" y="${H - 16}" text-anchor="middle">${v}</text>`;
  s += `<text class="ax" x="${pl + iw / 2}" y="${H}" text-anchor="middle">距首筆交易日（天）</text>`;
  if (hasUnits) {
    [20, 50].forEach(m => {
      const q = pts.find(p => p.y >= m);
      if (!q) return;
      s += `<line x1="${sx(q.x)}" x2="${sx(q.x)}" y1="${sy(q.y)}" y2="${pt + ih}" stroke="var(--acc)" stroke-dasharray="3 3"/>`
        + `<text x="${sx(q.x) + 6}" y="${sy(q.y) + 14}" style="font-size:11px;fill:var(--acc);font-weight:500">${m}% · 第 ${Math.round(q.x)} 天</text>`;
    });
  }
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x)},${sy(q.y)}`).join('');
  const L = pts[pts.length - 1];
  s += `<path d="M${sx(0)},${pt + ih}L${d.slice(1)}L${sx(L.x)},${pt + ih}Z" fill="var(--ink)" opacity=".05"/>`
    + `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>`
    + `<circle cx="${sx(L.x)}" cy="${sy(L.y)}" r="3.5" fill="var(--acc)"/>`;
  const step = Math.max(1, Math.floor(pts.length / 60));
  pts.forEach((q, i) => {
    if (i % step && i !== pts.length - 1) return;
    const t = esc(`${q.d}　第 ${Math.round(q.x)} 天<br>累計 ${q.c} 筆 · <b>${f1(q.y)}%</b>`);
    s += `<circle cx="${sx(q.x)}" cy="${sy(q.y)}" r="7" fill="transparent" data-tip="${t}"/>`;
  });
  el.innerHTML = s + '</svg>';
}

function floorPanel(data) {
  const head = '<div class="ph"><h3>樓層單價分析</h3><small>萬元/坪</small></div>';
  if (!data || !data.rows || !data.rows.length) {
    return `<div class="card panel" style="margin-top:12px">${head}<div class="empty">此建案無樓層分析資料（棟及號格式不支援）</div></div>`;
  }
  const prices = data.rows.map(r => r.unitPriceWan);
  const pl = Math.min(...prices), ph = Math.max(...prices);
  const lookup = {};
  data.rows.forEach(r => { lookup[`${r.wing}|${r.floor}`] = r; });

  // 統計列
  let sum = '';
  const st = data.stats || {};
  const rows = [];
  if (st.floorPremiumWan != null) {
    const yuan = Math.round(st.floorPremiumWan * 10000);
    rows.push(`<div class="fl-row"><span>樓層價差</span><b>每層約 ${yuan > 0 ? '+' : ''}${yuan.toLocaleString()} 元/坪</b></div>`);
  }
  if (st.wingStats && st.wingStats.diffs && st.wingStats.diffs.length) {
    const ws = st.wingStats, last = ws.diffs.length - 1;
    const chips = ws.diffs.map((d, i) => {
      if (d.wing === ws.baseWing) return `<span class="chip base">${esc(wingShort(d.wing))} 基準</span>`;
      const tag = i === 0 && d.diffWan < 0 ? '<em>最低</em>' : (i === last && d.diffWan > 0 ? '<em>最高</em>' : '');
      return `<span class="chip ${i === last && d.diffWan > 0 ? 'hi' : ''}">${esc(wingShort(d.wing))} ${d.diffWan > 0 ? '+' : ''}${d.diffWan.toFixed(2)}${tag}</span>`;
    }).join('');
    const insuf = (ws.insufficient || []).length
      ? `<span class="chip insuf">${esc(ws.insufficient.map(wingShort).join('、'))} 資料不足</span>` : '';
    rows.push(`<div class="fl-row"><span>戶別價差</span><div class="chips">${chips}${insuf}</div></div>`);
  }
  if (rows.length) sum = `<div class="fl-sum">${rows.join('')}</div>`;

  let grid = `<tr><th class="fl"></th>${data.wings.map(w => {
    const type = (data.wingTypes || {})[w], area = (data.wingAreas || {})[w];
    return `<th>${esc(wingHead(w))}<small>${esc(type || '—')} · ${area ? f1(area) : '—'} 坪</small></th>`;
  }).join('')}</tr>`;
  data.floors.forEach(f => {
    grid += `<tr><td class="fl">${f}F</td>`;
    data.wings.forEach(w => {
      const u = lookup[`${w}|${f}`];
      if (!u) { grid += `<td class="u" data-tip="${esc(`${esc(wingShort(w))} · ${f}F　未登錄`)}">—</td>`; return; }
      const k = (u.unitPriceWan - pl) / ((ph - pl) || 1);
      const extra = [u.count > 1 ? `均 ${u.count} 筆` : '', u.dblCar ? '雙車位' : ''].filter(Boolean).join(' · ');
      const t = `<b>${esc(wingShort(w))} · ${f}F</b>　${esc(u.txDate)}<br>${u.areaPing} 坪 · <b>${f1(u.unitPriceWan)}</b> 萬/坪 · 總價 ${fi(u.total / 10000)} 萬${extra ? '<br>' + extra : ''}`;
      grid += `<td class="${u.dblCar ? 'dbl' : ''}" style="background:${ramp(k)};color:${txt(k)}" data-tip="${esc(t)}">${f1(u.unitPriceWan)}</td>`;
    });
    grid += '</tr>';
  });

  return `
    <div class="card panel" style="margin-top:12px">
      ${head}${sum}
      <div class="gridwrap"><table class="fg">${grid}</table></div>
      <div class="gl2">
        <span><i style="background:var(--lo)"></i>${f1(pl)}</span>
        <span><i style="background:var(--hi)"></i>${f1(ph)} 萬/坪</span>
        <span><i style="background:repeating-linear-gradient(45deg,transparent 0 3px,var(--line) 3px 4px);border:1px solid var(--line)"></i>未登錄</span>
        <span><i style="box-shadow:inset 0 0 0 1.5px var(--warn)"></i>雙車位</span>
        <span>戶別價差已扣除樓層影響</span>
      </div>
      <div class="bd">${[
        `表內 ${data.count} 格（同棟同戶別同樓層多筆合併為一格、顯示均價）`,
        data.cancelledCount ? `已排除解約 ${data.cancelledCount} 筆` : '',
        data.unparsedCount ? `棟號或樓層無法解析 ${data.unparsedCount} 筆未列入` : '',
      ].filter(Boolean).join('；')}</div>
    </div>`;
}

// ---------- 坪數區間比較 ----------
async function loadAreaCompare() {
  const min = parseFloat($('acMin').value), max = parseFloat($('acMax').value);
  const out = $('acOut');
  if (Number.isNaN(min) || Number.isNaN(max)) { out.innerHTML = '<div class="empty">請輸入最小與最大坪數</div>'; return; }
  const { params, months } = filterParams();
  if (months && !months.length) { out.innerHTML = '<div class="empty">此篩選條件無資料</div>'; return; }
  params.set('min_area', min); params.set('max_area', max);
  out.innerHTML = '<div class="empty">查詢中…</div>';
  try {
    const j = await Api.byArea(params);
    const list = (j.data && j.data.projects) || [];
    if (!list.length) { out.innerHTML = `<div class="empty">${min}～${max} 坪沒有符合的建案成交</div>`; return; }
    const body = list.map((p, i) => {
      const tl = p.timeline || {};
      const tx = p.matchedTransactions || [];
      const avgP = tx.length ? tx.reduce((s, x) => s + x.unitPriceWan, 0) / tx.length : null;
      const m = k => tl[k] != null ? `${tl[k]} 個月` : '—';
      return `<tr data-nm="${esc(p.projectName)}">
        <td class="rk">${i + 1}</td>
        <td class="pn">${esc(p.projectName)}${p.lowConfidence ? '<span class="low">樣本少</span>' : ''}</td>
        <td>${esc(p.city)}</td>
        <td class="num">${p.matchCount} / ${p.totalCount}<span style="color:var(--ink3)">（${f1(p.matchRatio)}%）</span></td>
        <td class="num">${p.paceMonthly != null ? f1(p.paceMonthly) : '—'} 筆/月</td>
        <td class="num">${m('20%耗時月數')}</td>
        <td class="num">${m('50%耗時月數')}</td>
        <td class="num">${avgP != null ? f1(avgP) : '—'}</td>
        <td class="num">${esc(tl['首筆交易日'] || '—')}</td>
      </tr>`;
    }).join('');
    out.innerHTML = `
      <div class="ac-sum">${min}～${max} 坪 · 共 ${list.length} 個建案有成交，依去化速度排序</div>
      <div class="ac-table-wrap"><table class="ac">
        <thead><tr><th></th><th>建案</th><th>區域</th><th class="num">符合筆數 / 總筆數</th><th class="num">去化速度</th><th class="num">20% 耗時</th><th class="num">50% 耗時</th><th class="num">符合戶均價 萬/坪</th><th class="num">首筆交易</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>`;
  } catch (err) {
    out.innerHTML = `<div class="empty">查詢失敗：${esc(err.message)}</div>`;
  }
}
$('acForm').addEventListener('submit', e => { e.preventDefault(); loadAreaCompare(); });
$('acOut').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-nm]');
  if (tr) selectProject(tr.dataset.nm, true);
});

// ---------- 初始化與事件 ----------
function onFilterChange() {
  loadStats();
  if ($('acOut').innerHTML.trim()) loadAreaCompare();
}
const bind = (id, k) => $(id).addEventListener('change', e => { S[k] = e.target.value; onFilterChange(); });
bind('fYear', 'year'); bind('fRegion', 'region'); bind('fMonth', 'month');
$('fPeriod').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  S.period = b.dataset.v;
  [...$('fPeriod').children].forEach(x => x.classList.toggle('on', x === b));
  onFilterChange();
});
$('q').addEventListener('input', e => {
  S.q = e.target.value;
  const q = S.q.trim();
  const hit = q && ALL_ITEMS.find(x => x.nm.includes(q));
  renderMap();
  if (hit && hit.nm !== S.sel) selectProject(hit.nm, false);
});

async function loadMeta() {
  const [latest, summary] = await Promise.all([Api.latest(), Api.summary()]);
  $('stamp').textContent = fmtStamp(latest);
  const g = summary.groups || {};
  MONTHS = Object.keys(g.by_month || {}).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
  CITIES = Object.keys(g.by_city || {});
  const years = Object.keys(g.by_year || {}).sort().reverse();
  opt($('fYear'), [['all', '全部'], ...years.map(y => [y, y])]);
  opt($('fMonth'), [['all', '全部'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}月`])]);
  buildRegionSelect($('fRegion'), CITIES);
  $('fYear').value = S.year; $('fMonth').value = S.month;
  $('fRegion').value = [...$('fRegion').options].some(o => o.value === S.region) ? S.region : 'all';
  S.region = $('fRegion').value;
}

async function init() {
  try {
    await loadMeta();
  } catch (err) {
    $('stamp').textContent = `讀取失敗：${err.message}`;
  }
  await loadStats();
  // 從比較分析頁點建案過來：projects.html#p=建案名稱
  let h = '';
  try { h = decodeURIComponent((location.hash.match(/^#p=(.+)$/) || [])[1] || ''); } catch { h = ''; }
  if (h) {
    const hit = ALL_ITEMS.find(x => normName(x.nm) === normName(h));
    selectProject(hit ? hit.nm : h, true);
  }
}

$('refresh').addEventListener('click', async () => {
  const b = $('refresh');
  b.classList.add('spin'); b.disabled = true;
  try {
    await fetch(`${API}/refresh_data`, { method: 'POST' });
    Api.reset();
    await init();
  } finally {
    b.classList.remove('spin'); b.disabled = false;
  }
});

let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderMap, 120); });
document.fonts.ready.then(() => { if (ALL_ITEMS.length) renderMap(); });
init();
