// 主儀表板（2026-09-30 依 Claude Design「大新竹實登儀表板.html」改版，全部資料於前端篩選計算）
// 舊版備份：backups/pre-county-expand-20260930/webapp/app.js（原始版本另見 git 歷史）

const ROOMS = ['毛胚屋', '一房', '兩房', '三房', '四房', '五房以上'];
const PER_PAGE = 15;
const POLICY_MARK = { month: '2024-09', text: '第七波信用管制' };
const CONCENTRATION_RATIO = 30;   // 單一建案佔當月成交超過此 % → 警示
const CONCENTRATION_MIN = 10;     // 當月成交少於此筆數不判斷，避免小樣本誤報
const EXPAND_FIELDS = ['建物型態', '土地位置建物門牌', '棟及號', '主要用途', '車位類別', '車位坪數', '車位總價元', '備註'];

const S = { year: 'all', region: 'all', month: 'all', type: 'all', period: 'all', exSp: true, exG: true, exNR: true, sort: 'k', dir: -1, page: 0, q: '' };
let DATA = [], MONTHS = [], CITIES = [], CUR = [], CONC = [], BROKEN = [];
let PARK = null;   // 車位明細（另外載入，晚到再補畫車位卡）
let DET = {};      // 數字卡點擊明細：key → { title, html }
const BROKEN_NAME = /[?？\ufffd]/;   // 政府原始檔罕見字被轉成問號
const OPEN = new Set();   // 明細表已展開的列

const mLabel = m => `${m.slice(2, 4)}/${m.slice(5)}`;
const shiftYear = (m, n) => `${+m.slice(0, 4) - n}${m.slice(4)}`;
const EMPTY = '<div class="empty">此條件無資料</div>';

// ---------- 資料整理 ----------
function zhFloor(text) {
  const s = String(text || '').replace('層', '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const d = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s in d) return d[s];
  if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  return m ? (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0) : null;
}

function roomIndex(label) {
  const i = ROOMS.indexOf(label);
  if (i >= 0) return i;
  const n = { 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[String(label).replace('房', '')] ?? parseInt(label, 10);
  return n >= 5 ? 5 : -1;
}

function normalize(r) {
  const date = String(r['交易年月日'] ?? '').trim();
  const note = String(r['備註'] || '');
  const fl = zhFloor(r['移轉層次']);
  const tf = Number(r['總樓層數']);
  return {
    raw: r,
    k: /^\d{7}$/.test(date) ? +date : 0,
    d: /^\d{7}$/.test(date) ? `${date.slice(0, 3)}/${date.slice(3, 5)}/${date.slice(5)}` : date,
    m: r['月份'] || '',
    r: r['鄉鎮市區'] || '',
    pj: r['建案名稱'] || '',
    type: r['建物型態'] || '',
    rooms: roomIndex(r['房型']),
    roomLabel: r['房型'] || '未標示',
    ping: Number(r['建物坪數']) || 0,
    p: (Number(r['建物單價']) || 0) / 10000,
    tot: (Number(r['總價']) || 0) / 10000,
    fl, tf: Number.isFinite(tf) && tf > 0 ? Math.floor(tf) : null,
    sp: note.includes('特殊關係') || note.includes('親友'),
    cx: String(r['解約情形'] || '').trim() !== '',
    addr: r['土地位置建物門牌'] || '',
    nr: isNonResidential(r),
    q: null,
  };
}

// 異常單筆：不自動剔除，但不計入統計，於明細表標「待確認」
function flagOutliers(rows) {
  const byRegion = {};
  rows.forEach(x => { if (x.p > 0) (byRegion[x.r] = byRegion[x.r] || []).push(x.p); });
  const medByRegion = Object.fromEntries(Object.entries(byRegion).map(([k, v]) => [k, med(v)]));
  rows.forEach(x => {
    const rm = medByRegion[x.r];
    if (x.ping > 0 && x.ping < 8) x.q = '建物坪數不足 8 坪，疑似僅含車位或儲藏空間';
    else if (!(x.p > 0) || !(x.tot > 0)) x.q = '單價或總價缺漏';
    else if (rm && x.p > rm * 2.5) x.q = `單價超過${x.r}中位數 2.5 倍`;
    else if (rm && x.p < rm * 0.4) x.q = `單價低於${x.r}中位數 4 成`;
  });
}

// ---------- 篩選 ----------
function baseRows() {
  const cities = citiesForRegion(S.region, CITIES);
  return DATA.filter(x =>
    (!cities.length || cities.includes(x.r)) &&
    (S.type === 'all' || x.type === S.type) &&
    !(S.exSp && x.sp) &&
    !(S.exG && x.fl === 1) &&
    !(S.exNR && x.nr));
}
const inMonths = (rows, ms) => { const k = new Set(ms); return rows.filter(x => k.has(x.m)); };
// 車位卡：只看坡道平面、排除價格 0／待確認；套用區域與廠辦開關（型態、一樓等房屋條件不適用）
function parkBase() {
  const cities = citiesForRegion(S.region, CITIES);
  return PARK.filter(x => x.g === '坡道平面' && parkValid(x) && (!cities.length || cities.includes(x.r)) && !(S.exNR && x.nr));
}

// ---------- 圖表 ----------
function colChart(el, pts, { fmt = fi, colorFn, marker, H = 210, unit = '', after } = {}) {
  if (!pts.some(p => p.v)) { el.innerHTML = EMPTY; return; }
  const W = Math.max(el.clientWidth, 260), pl = 38, pr = 6, pt = 20, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const y = nice(0, Math.max(...pts.map(p => p.v))), sy = v => pt + ih - (v - y.lo) / (y.hi - y.lo) * ih;
  const bw = iw / pts.length, w = Math.min(bw * 0.62, 40), step = Math.ceil(pts.length / (iw / 46));
  let s = `<svg width="${W}" height="${H}">`;
  y.t.forEach(t => { s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`; });
  pts.forEach((p, i) => {
    const x = pl + bw * i + (bw - w) / 2;
    if (marker && p.m === marker.month) s += `<line class="mk" x1="${x + w / 2}" x2="${x + w / 2}" y1="${pt - 6}" y2="${pt + ih}"/><text class="mkt" x="${x + w / 2 + 6}" y="${pt + 4}">${marker.text}</text>`;
    s += `<rect x="${x}" y="${sy(p.v)}" width="${w}" height="${Math.max(pt + ih - sy(p.v), 0)}" rx="1.5" fill="${colorFn ? colorFn(p, i) : 'var(--bar)'}" data-tip="${esc(p.tip || `${p.l}　<b>${fmt(p.v)}${unit}</b>`)}"/>`;
    if (i % step === 0 || pts.length <= 14) s += `<text class="ax" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${p.l}</text>`;
    if (p.top) s += `<text class="ax" x="${x + w / 2}" y="${sy(p.v) - 6}" text-anchor="middle" style="fill:var(--ink2)">${p.top}</text>`;
  });
  if (after) s += after({ pl, iw, pt, ih, bw });
  el.innerHTML = s + '</svg>';
}

function lineChart(el, pts, { fmt = f1, marker, H = 200, unit = '' } = {}) {
  if (!pts.length) { el.innerHTML = EMPTY; return; }
  const W = Math.max(el.clientWidth, 260), pl = 38, pr = 10, pt = 20, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const vs = pts.map(p => p.v), y = nice(Math.min(...vs), Math.max(...vs));
  const sy = v => pt + ih - (v - y.lo) / (y.hi - y.lo || 1) * ih;
  const sx = i => pl + (pts.length === 1 ? iw / 2 : iw * i / (pts.length - 1));
  const step = Math.ceil(pts.length / (iw / 46));
  let s = `<svg width="${W}" height="${H}">`;
  y.t.forEach(t => { s += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="ax" x="${pl - 8}" y="${sy(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`; });
  const mi = marker ? pts.findIndex(p => p.m === marker.month) : -1;
  if (mi >= 0) s += `<line class="mk" x1="${sx(mi)}" x2="${sx(mi)}" y1="${pt - 6}" y2="${pt + ih}"/><text class="mkt" x="${sx(mi) + 6}" y="${pt + 4}">${marker.text}</text>`;
  s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(p.v)}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"/>`;
  pts.forEach((p, i) => { if (i % step === 0 || pts.length <= 14) s += `<text class="ax" x="${sx(i)}" y="${H - 8}" text-anchor="middle">${p.l}</text>`; });
  const L = pts.length - 1;
  s += `<circle cx="${sx(L)}" cy="${sy(pts[L].v)}" r="3.5" fill="var(--acc)"/><text x="${sx(L) - 6}" y="${sy(pts[L].v) - 9}" text-anchor="end" style="font-family:var(--mono);font-size:11.5px;font-weight:500;fill:var(--acc)">${fmt(pts[L].v)}</text>`;
  const cw = iw / Math.max(pts.length - 1, 1);
  pts.forEach((p, i) => { s += `<rect x="${sx(i) - cw / 2}" y="${pt}" width="${cw}" height="${ih}" fill="transparent" data-tip="${esc(`${p.l}　<b>${fmt(p.v)}${unit}</b>　${p.n} 件`)}"/>`; });
  el.innerHTML = s + '</svg>';
}

function delta(cur, prev) {
  if (!prev) return '<span class="dl fl"><b>—</b></span>';
  const d = (cur - prev) / prev * 100, c = Math.abs(d) < 0.5 ? 'fl' : d > 0 ? 'up' : 'dn';
  return `<span class="dl ${c}"><b>${d > 0 ? '+' : ''}${d.toFixed(1)}%</b></span>`;
}

function spark(vals) {
  if (vals.length < 2) return '';
  const W = 84, H = 24, mn = Math.min(...vals), mx = Math.max(...vals), sy = v => H - 2 - (v - mn) / ((mx - mn) || 1) * (H - 4);
  return `<svg width="${W}" height="${H}"><path d="${vals.map((v, i) => `${i ? 'L' : 'M'}${i / (vals.length - 1) * W},${sy(v)}`).join('')}" fill="none" stroke="var(--ink3)" stroke-width="1.3"/></svg>`;
}

const projLink = (region, name) => `<a href="${googleSearchUrl(region, name)}" target="_blank" rel="noopener noreferrer" title="Google 搜尋此建案">${esc(name)}</a>`;

// ---------- 主畫面 ----------
function render() {
  const B0 = baseRows(), B = B0.filter(x => !x.q);
  const filtered = monthsForFilter(MONTHS, S);
  const ms = filtered || MONTHS;
  const cur = inMonths(B, ms);
  CUR = inMonths(B0, ms);

  // 比較基準：全部期間 → 近 12 月 vs 前 12 月；有篩選 → 去年同期
  let cmpCur = cur, prev, cmpLabel, cmpMs = ms, prevMs;
  if (!filtered) {
    cmpMs = MONTHS.slice(-12);
    prevMs = MONTHS.slice(-24, -12);
    cmpCur = inMonths(B, cmpMs);
    prev = inMonths(B, prevMs);
    cmpLabel = '近12月 vs 前12月';
  } else {
    prevMs = ms.map(m => shiftYear(m, 1));
    prev = inMonths(B, prevMs);
    cmpLabel = '較去年同期';
  }

  $('scope').textContent = `${regionLabel(S.region)} · ${ms.length ? mLabel(ms[0]) + ' – ' + mLabel(ms[ms.length - 1]) : '—'}`;

  const byM = ms.map(m => { const a = cur.filter(x => x.m === m); return { m, l: mLabel(m), a, n: a.length }; });
  const P = cur.map(x => x.p), T = cur.map(x => x.tot), Q = cur.map(x => x.ping);

  const K = [
    ['vol', '交易量', cur.length.toLocaleString(), '件', '', cmpCur.length, prev.length, byM.map(x => x.n)],
    ['tot', '總價平均', fi(avg(T)), '萬元', cur.length ? `中位數 ${fi(med(T))}` : '', avg(cmpCur.map(x => x.tot)), avg(prev.map(x => x.tot)), byM.map(x => avg(x.a.map(y => y.tot)))],
    ['price', '建物單價平均', f1(avg(P)), '萬/坪', cur.length ? `中位數 ${f1(med(P))} · ${f1(Math.min(...P))}–${f1(Math.max(...P))}` : '', avg(cmpCur.map(x => x.p)), avg(prev.map(x => x.p)), byM.map(x => avg(x.a.map(y => y.p)))],
    ['ping', '建物坪數平均', f1(avg(Q)), '坪', cur.length ? `中位數 ${f1(med(Q))}` : '', avg(cmpCur.map(x => x.ping)), avg(prev.map(x => x.ping)), byM.map(x => avg(x.a.map(y => y.ping)))],
  ];
  // 車位：本期（區域＋期間＋廠辦開關）所有類別；卡片數字只看坡道平面
  const cities = citiesForRegion(S.region, CITIES), mk = new Set(ms);
  const parkScope = PARK ? PARK.filter(x => mk.has(x.m) && (!cities.length || cities.includes(x.r)) && !(S.exNR && x.nr)) : [];
  let pk = [];
  if (!PARK) K.push(['', '車位價格中位數', '…', '', '車位資料載入中', 0, 0, []]);
  else {
    const PB = parkBase(), PV = (pk = inMonths(PB, ms)).map(x => x.p);
    const fl = parkByFloor(pk).filter(f => /^B[1-3]$/.test(f.f));
    const pm = inMonths(PB, prevMs || []).map(x => x.p);
    K.push(['park', '車位價格中位數', PV.length ? fi(med(PV)) : '—', '萬/位', fl.map(f => `${f.f} ${fi(f.med)}`).join(' · ') || '坡道平面', med(inMonths(PB, cmpMs).map(x => x.p)), pm.length ? med(pm) : 0,
      ms.map(m => { const a = pk.filter(x => x.m === m).map(x => x.p); return a.length >= 3 ? med(a) : 0; })]);
  }
  $('kpis').innerHTML = K.map(([key, lb, v, u, sub, c, p, sp]) =>
    `<div class="kpi${key && cur.length ? ' tap' : ''}"${key ? ` data-det="${key}" role="button" tabindex="0"` : ''}><div class="lb">${lb}</div><div class="v">${v}<small>${u}</small></div><div class="sub">${sub}</div>`
    + `<div class="row"><span>${delta(c, prev.length ? p : 0)}<span class="dl">${cmpLabel}</span></span>${spark(sp.filter(x => x > 0))}</div></div>`).join('');

  // 建案彙總
  const pc = {};
  cur.forEach(x => { const o = pc[x.pj] = pc[x.pj] || { n: 0, s: 0, r: x.r }; o.n++; o.s += x.p; });
  const ps = Object.entries(pc).filter(([k]) => k).map(([k, v]) => ({ k, n: v.n, p: v.s / v.n, r: v.r })).sort((a, b) => b.n - a.n);

  // 單案佔比過高月份（沿用舊版警示規則）
  CONC = byM.filter(x => x.n >= CONCENTRATION_MIN).map(x => {
    const c = {};
    x.a.forEach(y => { if (y.pj) c[y.pj] = (c[y.pj] || 0) + 1; });
    const [pj, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    return { m: x.m, pj, n, total: x.n, r: (x.a.find(y => y.pj === pj) || {}).r, ratio: n / x.n * 100 };
  }).filter(x => x.ratio > CONCENTRATION_RATIO).sort((a, b) => b.ratio - a.ratio);

  const flagged = CUR.filter(x => x.q);
  const bn = {};
  CUR.forEach(x => { if (BROKEN_NAME.test(x.pj)) { const k = x.r + '|' + x.pj; (bn[k] = bn[k] || { r: x.r, pj: x.pj, n: 0, addr: x.addr }).n++; } });
  BROKEN = Object.values(bn).sort((a, b) => b.n - a.n);
  const qaCount = flagged.length + CONC.length + BROKEN.length;
  const hi = cur.reduce((a, x) => !a || x.p > a.p ? x : a, null);
  const lo = cur.reduce((a, x) => !a || x.p < a.p ? x : a, null);
  const cx = cur.filter(x => x.cx).length;
  // 最貴車位：單一車位價格最高（排除子母／大車位、價格 0 與待確認），同價多案時註明
  const pv = parkScope.filter(x => parkValid(x) && !x.big);
  const parkRank = [...pv].sort((a, b) => b.p - a.p || b.m.localeCompare(a.m)), ptop = parkRank[0];
  let parkTop = '<div class="card"><small>最高車位價格</small><b>…</b><span>車位資料載入中</span></div>';
  if (PARK) {
    const ties = ptop ? new Set(pv.filter(x => x.p === ptop.p).map(x => x.pj)).size - 1 : 0;
    parkTop = ptop
      ? `<div class="card tap" data-det="pk" role="button" tabindex="0"><small>最高車位價格</small><b><a href="projects.html#p=${encodeURIComponent(ptop.pj)}" title="查看此建案車位明細">${esc(ptop.pj)}</a>${ties ? `<span> 等 ${ties + 1} 案</span>` : ''}</b><span>${fi(ptop.p)} 萬 · ${ptop.a ? f1(ptop.a) + ' 坪 · ' : ''}${esc(ptop.f)} · ${mLabel(ptop.m)}</span></div>`
      : '<div class="card"><small>最高車位價格</small><b>—</b><span>此條件無車位成交</span></div>';
  }
  $('hl').innerHTML = cur.length ? `
    <div class="card tap" data-det="hi" role="button" tabindex="0"><small>最高單價建案</small><b>${projLink(hi.r, hi.pj)}</b><span>${f1(hi.p)} 萬/坪 · ${esc(hi.d)}</span></div>
    <div class="card tap" data-det="lo" role="button" tabindex="0"><small>最低單價建案</small><b>${projLink(lo.r, lo.pj)}</b><span>${f1(lo.p)} 萬/坪 · ${esc(lo.d)}</span></div>
    ${parkTop}
    <div class="card tap" data-det="cx" role="button" tabindex="0"><small>解約量</small><b>${cx} <span>/ ${cur.length.toLocaleString()}</span></b><span>佔比 ${(cx / cur.length * 100).toFixed(2)}%</span></div>
    <button class="card qa ${qaCount ? '' : 'ok'}" id="qaBtn" type="button"><small>數據品質警示</small><b><i></i>${qaCount ? `${qaCount} 項待確認` : '無異常'}</b><span>${qaCount ? `異常 ${flagged.length} 筆 · 集中月 ${CONC.length} · 缺字建案 ${BROKEN.length} →` : '—'}</span></button>` : '';
  DET = buildDetails({ cur, cmpCur, prev, cmpLabel, ms, byM, T, P, Q, pk, parkScope, parkRank, flaggedN: flagged.length });
  const qb = $('qaBtn');
  if (qb && qaCount) qb.onclick = () => drawer(true);

  // 洞察
  const rc = {};
  cur.forEach(x => { rc[x.r] = (rc[x.r] || 0) + 1; });
  const rs = Object.entries(rc).sort((a, b) => b[1] - a[1]);
  const rm = ROOMS.map((l, k) => {
    const a = cur.filter(x => x.rooms === k);
    return { k, l, n: a.length, p: avg(a.map(x => x.p)), ping: avg(a.map(x => x.ping)), t: med(a.map(x => x.tot)) };
  });
  const rmTop = [...rm].sort((a, b) => b.n - a.n)[0];
  const h3 = byM.slice(-3).flatMap(x => x.a), h3p = byM.slice(-6, -3).flatMap(x => x.a);
  const tr = h3p.length && h3.length ? (avg(h3.map(x => x.p)) / avg(h3p.map(x => x.p)) - 1) * 100 : null;
  $('insight').innerHTML = cur.length && ps.length ? `
    <div><small>成交重心</small><p><strong>${esc(rs[0][0])}</strong> 佔成交 <strong>${(rs[0][1] / cur.length * 100).toFixed(0)}%</strong>；最熱銷建案「${esc(ps[0].k)}」共 ${ps[0].n} 件。</p></div>
    <div><small>價格動能</small><p>${tr === null ? '期間過短，無法比較近期價格動能。' : `近 3 月均價較前 3 月 <strong>${tr > 0 ? '+' : ''}${tr.toFixed(1)}%</strong>，${Math.abs(tr) < 1 ? '價格大致持平。' : tr > 0 ? '價格仍在墊高。' : '價格出現鬆動。'}`}</p></div>
    <div><small>主力產品</small><p><strong>${rmTop.l}</strong>佔 ${(rmTop.n / cur.length * 100).toFixed(0)}%，平均 ${f1(rmTop.ping)} 坪、總價中位數 ${fi(rmTop.t)} 萬。</p></div>` : '<div><p>此條件無資料</p></div>';

  // 每月成交件數
  colChart($('chVol'), byM.map(x => ({ m: x.m, l: x.l, v: x.n })), { marker: POLICY_MARK, unit: ' 件', colorFn: (p, i) => i === byM.length - 1 ? 'var(--acc)' : 'var(--bar)' });

  // 區域分佈
  const rmax = rs.length ? rs[0][1] : 1;
  $('chReg').innerHTML = rs.length ? rs.map(([k, n], i) =>
    `<div class="hb ${i === 0 ? 'top' : ''}" data-tip="${esc(`${esc(k)}　<b>${n} 件</b>`)}"><span>${esc(k)}</span><div class="t"><i style="width:${n / rmax * 100}%"></i></div><span class="n"><b>${n.toLocaleString()}</b> · ${(n / cur.length * 100).toFixed(1)}%</span></div>`).join('') : EMPTY;

  // 單價、坪數趨勢
  const lp = byM.filter(x => x.n);
  lineChart($('chPrice'), lp.map(x => ({ m: x.m, l: x.l, v: avg(x.a.map(y => y.p)), n: x.n })), { marker: POLICY_MARK, unit: ' 萬/坪' });
  lineChart($('chPing'), lp.map(x => ({ m: x.m, l: x.l, v: avg(x.a.map(y => y.ping)), n: x.n })), { marker: POLICY_MARK, unit: ' 坪' });

  // 單價分佈（2 萬一級，區間取 1%–99% 分位，兩端合併）
  if (P.length) {
    const sorted = [...P].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.01)], q99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const lo2 = Math.floor(q1 / 2) * 2, hi2 = Math.max(lo2 + 2, Math.ceil(q99 / 2) * 2);
    const bins = [];
    for (let v = lo2; v < hi2; v += 2) bins.push({ lo: v, l: String(v), v: 0 });
    P.forEach(p => { bins[Math.max(0, Math.min(bins.length - 1, Math.floor((p - lo2) / 2)))].v++; });
    const medP = med(P);
    colChart($('chHist'), bins.map((b, i) => ({ ...b, tip: `${i === 0 ? '≤' : ''}${b.lo}–${b.lo + 2}${i === bins.length - 1 ? '+' : ''} 萬/坪　<b>${b.v} 件</b>` })), {
      colorFn: p => medP >= p.lo && medP < p.lo + 2 ? 'var(--acc)' : 'var(--bar2)',
      after: ({ pl, bw, pt }) => `<text x="${pl + bw * ((medP - lo2) / 2)}" y="${pt - 6}" text-anchor="middle" style="font-size:11px;fill:var(--acc);font-weight:500">中位數 ${f1(medP)}</text>`,
    });
  } else $('chHist').innerHTML = EMPTY;

  // 熱門建案
  const tmax = ps.length ? ps[0].n : 1;
  $('chTop').innerHTML = ps.length ? ps.slice(0, 8).map((p, i) =>
    `<div class="rk"><span class="no">${pad(i + 1)}</span><span class="nm"><b>${projLink(p.r, p.k)}</b><small>${esc(p.r)}</small></span><span class="ct"><span><i style="width:${p.n / tmax * 100}%"></i></span>${p.n}</span><span class="pr">${f1(p.p)}</span></div>`).join('') : EMPTY;

  // 坪數帶
  const pb = [[0, 20, '<20'], [20, 25, '20–25'], [25, 30, '25–30'], [30, 35, '30–35'], [35, 40, '35–40'], [40, 50, '40–50'], [50, 1e9, '50+']].map(([a, b, l]) => {
    const s = cur.filter(x => x.ping >= a && x.ping < b);
    return { l, v: s.length, t: med(s.map(x => x.tot)) };
  });
  const pbMax = Math.max(...pb.map(x => x.v));
  colChart($('chPingB'), pb.map(x => ({ l: x.l, v: x.v, top: x.v ? fi(x.t) + '萬' : '', tip: `${x.l} 坪　<b>${x.v} 件</b>　總價中位 ${fi(x.t)} 萬` })), { H: 220, colorFn: p => p.v === pbMax ? 'var(--acc)' : 'var(--bar2)' });

  // 房型
  const shades = ['oklch(0.93 0.003 250)', 'oklch(0.86 0.004 250)', 'oklch(0.7 0.005 250)', 'oklch(0.58 0.005 250)', 'oklch(0.45 0.005 250)', 'oklch(0.3 0.005 250)'];
  const rcol = k => k === rmTop.k ? 'var(--acc)' : shades[k];
  const rtxt = k => k === rmTop.k || k >= 3 ? '#fff' : 'var(--ink)';
  $('chRoom').innerHTML = cur.length ? `
    <div class="stack">${rm.map(r => r.n ? `<div style="flex:${r.n};background:${rcol(r.k)};color:${rtxt(r.k)}" data-tip="${esc(`${r.l}　<b>${(r.n / cur.length * 100).toFixed(1)}%</b>`)}">${r.n / cur.length > 0.08 ? (r.n / cur.length * 100).toFixed(0) + '%' : ''}</div>` : '').join('')}</div>
    <table class="rtbl"><tr><th>房型</th><th>件數</th><th>佔比</th><th>平均坪數</th><th>平均單價</th></tr>
    ${rm.map(r => `<tr><td><span class="sw" style="background:${rcol(r.k)}"></span>${r.l}</td><td>${r.n.toLocaleString()}</td><td>${(r.n / cur.length * 100).toFixed(1)}%</td><td>${r.n ? f1(r.ping) : '—'}</td><td>${r.n ? f1(r.p) : '—'}</td></tr>`).join('')}</table>` : EMPTY;

  renderTable();
  renderQA();
}

// ---------- 明細表 ----------
function renderTable() {
  const q = S.q.trim();
  const rows = CUR.filter(x => !q || x.pj.includes(q) || x.r.includes(q) || x.addr.includes(q))
    .sort((a, b) => (a[S.sort] > b[S.sort] ? 1 : a[S.sort] < b[S.sort] ? -1 : 0) * S.dir);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  S.page = Math.min(S.page, pages - 1);
  const pageRows = rows.slice(S.page * PER_PAGE, S.page * PER_PAGE + PER_PAGE);
  $('tb').innerHTML = pageRows.map((x, i) => {
    const id = S.page * PER_PAGE + i, open = OPEN.has(x);
    const badges = (x.q ? `<span class="badge" data-tip="${esc(esc(x.q))}">待確認</span>` : '')
      + (x.sp ? '<span class="badge g">特殊</span>' : '') + (x.cx ? '<span class="badge g">解約</span>' : '');
    const rawFloor = String(x.raw['移轉層次'] || '');
    const floor = [x.fl != null ? `${x.fl}F` : (rawFloor === '全' ? '全棟' : rawFloor), x.tf ? `${x.tf}F` : ''].filter(Boolean).join(' / ');
    const more = EXPAND_FIELDS.filter(f => x.raw[f] !== null && x.raw[f] !== undefined && String(x.raw[f]).trim() !== '' && String(x.raw[f]) !== '0')
      .map(f => {
        let v = x.raw[f];
        if (f === '車位總價元') v = `${fi(v / 10000)} 萬`;
        else if (f === '車位坪數') v = `${v} 坪`;
        return `<div><span>${f}</span>${esc(v)}</div>`;
      }).join('');
    return `<tr class="main ${open ? 'open' : ''}" data-i="${id}">
        <td class="m">${esc(x.d)}</td><td>${esc(x.r)}</td><td class="pj">${x.pj ? projLink(x.r, x.pj) : '—'}</td>
        <td class="r m">${fi(x.tot)}</td><td class="r m"><b>${f1(x.p)}</b></td><td class="r m">${x.ping.toFixed(2)}</td>
        <td class="r m">${esc(floor)}</td><td>${esc(x.roomLabel)}</td><td>${badges}</td><td class="ex">${open ? '▾' : '▸'}</td></tr>`
      + (open ? `<tr class="more"><td colspan="10"><div class="more-grid">${more || '<div>無其他資料</div>'}</div></td></tr>` : '');
  }).join('') || `<tr><td colspan="10">${EMPTY}</td></tr>`;
  $('tb').onclick = e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr.main');
    if (!tr) return;
    const x = pageRows[+tr.dataset.i - S.page * PER_PAGE];
    OPEN.has(x) ? OPEN.delete(x) : OPEN.add(x);
    renderTable();
  };
  document.querySelectorAll('.dt th.s').forEach(th => {
    th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (th.dataset.k === S.sort ? (S.dir > 0 ? ' ↑' : ' ↓') : '');
  });
  $('pgInfo').textContent = `${rows.length.toLocaleString()} 筆`;
  $('pgNo').textContent = `${S.page + 1} / ${pages}`;
  $('prev').disabled = S.page === 0;
  $('next').disabled = S.page >= pages - 1;
}

// ---------- 數據品質抽屜 ----------
function renderQA() {
  const flagged = CUR.filter(x => x.q);
  let h = '';
  if (flagged.length) {
    h += `<h4>異常單筆（${flagged.length}）</h4><p class="note">未自動刪除，但已排除於統計之外，並在明細表標「待確認」，請人工複核。</p>`;
    h += flagged.slice(0, 50).map(b => `<div class="qi"><b>${esc(b.q)}</b><span>${esc(b.r)} · ${esc(b.pj || '未命名建案')} · ${esc(b.raw['移轉層次'] || '')} · ${b.ping} 坪 · ${f1(b.p)} 萬/坪</span><code>成交日 ${esc(b.d)}</code></div>`).join('');
    if (flagged.length > 50) h += `<p class="note">另有 ${flagged.length - 50} 筆，請在明細表搜尋或排序查看。</p>`;
  }
  if (CONC.length) {
    h += `<h4>單一建案佔比過高的月份（${CONC.length}）</h4><p class="note">當月單一建案超過 ${CONCENTRATION_RATIO}% 成交，該月數據易受此案影響（當月未滿 ${CONCENTRATION_MIN} 筆不判斷）。</p>`;
    h += CONC.map(c => `<div class="qi"><b>${mLabel(c.m)} · ${esc(c.pj)} 佔 ${c.ratio.toFixed(1)}%</b><span>${esc(c.r || '')} · ${c.n} / ${c.total} 筆</span></div>`).join('');
  }
  if (BROKEN.length) {
    h += `<h4>建案名稱缺字（${BROKEN.length}）</h4><p class="note">政府原始資料的罕見字被轉成「?」。請到 Google Sheets 的 Name_Fix 分頁填入正確名稱，下次資料更新會自動改正。</p>`;
    h += BROKEN.map(b => `<div class="qi"><b>${esc(b.pj)}</b><span>${esc(b.r)} · ${b.n} 筆 · <a href="${googleSearchUrl(b.r, b.addr + ' 建案')}" target="_blank" rel="noopener noreferrer">${esc(b.addr)}</a></span></div>`).join('');
  }
  $('qaList').innerHTML = h || '<p class="note">目前篩選條件下沒有異常。</p>';
}
const drawer = on => { $('drawer').classList.toggle('on', on); $('dbg').classList.toggle('on', on); };
$('dx').onclick = $('dbg').onclick = () => drawer(false);
addEventListener('keydown', e => { if (e.key === 'Escape') drawer(false); });

// ---------- 數字卡點擊明細（桌機、手機都用點的） ----------
const TOT_BANDS = [[0, 1000, '1000 萬以下'], [1000, 1500, '1000–1500'], [1500, 2000, '1500–2000'], [2000, 2500, '2000–2500'], [2500, 3000, '2500–3000'], [3000, 1e9, '3000 萬以上']];
const PING_BANDS = [[0, 20, '20 坪以下'], [20, 25, '20–25'], [25, 30, '25–30'], [30, 35, '30–35'], [35, 40, '35–40'], [40, 50, '40–50'], [50, 1e9, '50 坪以上']];
const pct = (n, t) => t ? (n / t * 100).toFixed(1) + '%' : '—';
const groupBy = (rows, f) => { const g = {}; rows.forEach(x => { const k = f(x); if (k) (g[k] = g[k] || []).push(x); }); return g; };
const bigNums = items => `<div class="big2">${items.map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('')}</div>`;
const bandRows = (vals, bands) => {
  const c = bands.map(([a, b]) => vals.filter(v => v >= a && v < b).length), mx = Math.max(...c, 1);
  return bands.map(([, , l], i) => [l, c[i].toLocaleString(), pct(c[i], vals.length), { bar: c[i] / mx }]);
};
const projCell = x => `<a href="projects.html#p=${encodeURIComponent(x.pj)}">${esc(x.pj)}</a>`;

function buildDetails({ cur, cmpCur, prev, cmpLabel, ms, byM, T, P, Q, pk, parkScope, parkRank, flaggedN }) {
  const D = {}, n = cur.length;
  if (!n) return D;
  const scope = esc($('scope').textContent);
  const regions = Object.entries(groupBy(cur, x => x.r)).sort((a, b) => b[1].length - a[1].length);
  const regMax = Math.max(...regions.map(([, a]) => a.length));

  D.vol = { title: '交易量明細', html: `<p class="note">${scope}</p>`
    + bigNums([['本期', `${n.toLocaleString()} 件`], [cmpLabel, `${cmpCur.length.toLocaleString()} vs ${prev.length.toLocaleString()}`], ['月均', `${f1(n / (ms.length || 1))} 件`]])
    + `<h4>各區件數</h4>${popTable(['區域', '件數', '佔比', ''], regions.map(([r, a]) => [esc(r), a.length.toLocaleString(), pct(a.length, n), { bar: a.length / regMax }]))}`
    + `<h4>近 12 個月</h4>${popTable(['月份', '件數', '均價 萬/坪'], byM.slice(-12).reverse().map(x => [mLabel(x.m), x.n.toLocaleString(), x.n ? f1(avg(x.a.map(y => y.p))) : '—']))}` };

  D.tot = { title: '總價明細', html: `<p class="note">${scope} · 已扣除車位價格</p>`
    + bigNums([['平均', `${fi(avg(T))} 萬`], ['中位數', `${fi(med(T))} 萬`], ['中間 50%', `${fi(quant(T, .25))}–${fi(quant(T, .75))} 萬`]])
    + `<h4>總價帶分佈</h4>${popTable(['總價（萬）', '件數', '佔比', ''], bandRows(T, TOT_BANDS))}`
    + `<h4>各區總價中位數</h4>${popTable(['區域', '件數', '中位數 萬'], regions.map(([r, a]) => [esc(r), a.length.toLocaleString(), fi(med(a.map(x => x.tot)))]))}` };

  const regP = regions.map(([r, a]) => [r, a, avg(a.map(x => x.p))]).sort((a, b) => b[2] - a[2]), pMax = Math.max(...regP.map(x => x[2]));
  D.price = { title: '建物單價明細', html: `<p class="note">${scope}${flaggedN ? ` · 另有 ${flaggedN} 筆異常單價未計入` : ''}</p>`
    + bigNums([['平均', `${f1(avg(P))} 萬/坪`], ['中位數', `${f1(med(P))}`], ['中間 50%', `${f1(quant(P, .25))}–${f1(quant(P, .75))}`]])
    + `<h4>各區平均單價（高→低）</h4>${popTable(['區域', '件數', '平均', '中位數', ''], regP.map(([r, a, v]) => [esc(r), a.length.toLocaleString(), f1(v), f1(med(a.map(x => x.p))), { bar: v / pMax }]))}` };

  const rooms = ROOMS.map((l, k) => { const a = cur.filter(x => x.rooms === k); return [l, a]; }).filter(([, a]) => a.length), rMax = Math.max(...rooms.map(([, a]) => a.length));
  D.ping = { title: '建物坪數明細', html: `<p class="note">${scope} · 已扣除車位坪數</p>`
    + bigNums([['平均', `${f1(avg(Q))} 坪`], ['中位數', `${f1(med(Q))} 坪`], ['中間 50%', `${f1(quant(Q, .25))}–${f1(quant(Q, .75))} 坪`]])
    + `<h4>坪數帶分佈</h4>${popTable(['坪數', '件數', '佔比', ''], bandRows(Q, PING_BANDS))}`
    + `<h4>房型</h4>${popTable(['房型', '件數', '佔比', '平均坪數', ''], rooms.map(([l, a]) => [l, a.length.toLocaleString(), pct(a.length, n), f1(avg(a.map(x => x.ping))), { bar: a.length / rMax }]))}` };

  if (PARK) {
    const PV = pk.map(x => x.p), valid = parkScope.filter(parkValid);
    const groups = PARK_GROUPS.map(([g]) => [g, valid.filter(x => x.g === g).map(x => x.p)]).filter(([, a]) => a.length);
    const zero = parkScope.filter(x => x.zero).length, odd = parkScope.filter(x => x.q).length;
    D.park = { title: '車位價格明細', html: `<p class="note">${scope} · 一個車位一筆（政府車位明細）</p>`
      + (PV.length ? bigNums([['坡道平面中位數', `${fi(med(PV))} 萬`], ['車位數', `${pk.length.toLocaleString()} 位`], ['中間 50%', `${fi(quant(PV, .25))}–${fi(quant(PV, .75))} 萬`]]) : '<p class="note">此條件無坡道平面成交</p>')
      + (PV.length ? `<h4>坡道平面各樓層</h4>${popTable(['樓層', '車位數', '中位數 萬', '最低–最高'], parkByFloor(pk).map(f => [esc(f.f), f.n, fi(f.med), `${fi(f.lo)}–${fi(f.hi)}`]))}` : '')
      + `<h4>各類別</h4>${popTable(['類別', '車位數', '中位數 萬', '最低–最高'], groups.map(([g, a]) => [g, a.length.toLocaleString(), fi(med(a)), `${fi(Math.min(...a))}–${fi(Math.max(...a))}`]))}`
      + `<p class="note">卡片數字只看坡道平面。子母／大車位：坪數與價格都明顯高於同建案一般車位（一個登記約等於兩個車位），另外統計。未計入：價格 0（含於房價或贈送）${zero} 位、價格異常待確認 ${odd} 位。</p>` };

    const seen = new Set(), top = parkRank.filter(x => !seen.has(x.pj) && seen.add(x.pj)).slice(0, 10);
    D.pk = { title: '最高車位價格', html: `<p class="note">${scope} · 每個建案取最高的一個車位</p>`
      + popTable(['建案', '價格 萬', '坪數', '樓層', '成交'], top.map(x => [projCell(x), fi(x.p), x.a ? f1(x.a) : '—', esc(`${x.t} ${x.f}`), mLabel(x.m)]))
      + '<p class="note">已排除子母／大車位（坪數與價格都明顯高於同建案一般車位）與價格異常值（高於同建案同樓層中位數 1.4 倍且坪數不大）。只有 1～2 筆成交的建案無法比對，請保留判讀。</p>' };
  }

  const byProj = Object.entries(groupBy(cur.filter(x => x.pj), x => x.pj)).map(([pj, a]) => {
    const best = a.reduce((m, x) => x.p > m.p ? x : m), worst = a.reduce((m, x) => x.p < m.p ? x : m);
    return { pj, r: a[0].r, a, best, worst, n: a.length, avg: avg(a.map(x => x.p)) };
  });
  const projLinkCell = x => `<a href="projects.html#p=${encodeURIComponent(x.pj)}">${esc(x.pj)}</a>`;
  D.hi = { title: '最高單價建案', html: `<p class="note">${scope} · 每個建案取單價最高的一筆</p>`
    + popTable(['建案', '區域', '最高 萬/坪', '建案均價', '成交日'], [...byProj].sort((a, b) => b.best.p - a.best.p).slice(0, 10).map(x => [projLinkCell(x), esc(x.r), f1(x.best.p), f1(x.avg), esc(x.best.d)])) };
  D.lo = { title: '最低單價建案', html: `<p class="note">${scope} · 每個建案取單價最低的一筆（異常單筆已排除）</p>`
    + popTable(['建案', '區域', '最低 萬/坪', '建案均價', '成交日'], [...byProj].sort((a, b) => a.worst.p - b.worst.p).slice(0, 10).map(x => [projLinkCell(x), esc(x.r), f1(x.worst.p), f1(x.avg), esc(x.worst.d)])) };

  const cxp = byProj.map(x => ({ ...x, c: x.a.filter(y => y.cx).length })).filter(x => x.c).sort((a, b) => b.c - a.c || b.c / b.n - a.c / a.n);
  const cxn = cur.filter(x => x.cx).length;
  D.cx = { title: '解約明細', html: `<p class="note">${scope}</p>`
    + bigNums([['解約', `${cxn} 件`], ['佔比', pct(cxn, n)], ['有解約的建案', `${cxp.length} 案`]])
    + (cxp.length ? `<h4>解約最多的建案</h4>${popTable(['建案', '區域', '解約', '成交', '解約率'], cxp.slice(0, 10).map(x => [projLinkCell(x), esc(x.r), x.c, x.n, pct(x.c, x.n)]))}` : '<p class="note">此條件沒有解約紀錄</p>') };
  return D;
}

// 點數字卡 → 彈窗；卡片裡的連結照常跳頁
['kpis', 'hl'].forEach(id => {
  const el = $(id);
  const open = e => {
    if (e.target.closest('a')) return;
    const c = e.target.closest('[data-det]');
    if (c && DET[c.dataset.det]) openPop(DET[c.dataset.det].title, DET[c.dataset.det].html);
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
});

// ---------- 載入 ----------
async function load() {
  $('kpis').innerHTML = '<div class="empty" style="grid-column:1/-1">資料載入中…</div>';
  try {
    const [latest, data] = await Promise.all([Api.latest(), Api.data()]);
    $('stamp').textContent = fmtStamp(latest);
    DATA = (data.rows || []).map(normalize);
    flagOutliers(DATA);
    OPEN.clear();
    MONTHS = [...new Set(DATA.map(x => x.m).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort();
    CITIES = [...new Set(DATA.map(x => x.r).filter(Boolean))];
    const years = [...new Set(MONTHS.map(m => m.slice(0, 4)))].sort().reverse();
    const types = Object.entries(DATA.reduce((c, x) => { if (x.type) c[x.type] = (c[x.type] || 0) + 1; return c; }, {})).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    opt($('fYear'), [['all', '全部'], ...years.map(y => [y, y])]);
    opt($('fMonth'), [['all', '全部'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}月`])]);
    opt($('fType'), [['all', '全部'], ...types.map(t => [t, t])]);
    buildRegionSelect($('fRegion'), CITIES);
    ['year', 'month', 'type', 'region'].forEach(k => {
      const el = $('f' + k[0].toUpperCase() + k.slice(1));
      el.value = [...el.options].some(o => o.value === S[k]) ? S[k] : 'all';
      S[k] = el.value;
    });
    render();
    if (!PARK) Api.parking().then(p => { PARK = p; render(); }).catch(() => { PARK = []; render(); });
  } catch (err) {
    $('stamp').textContent = `讀取失敗：${err.message}`;
    $('kpis').innerHTML = `<div class="empty" style="grid-column:1/-1">資料讀取失敗：${esc(err.message)}</div>`;
  }
}

// ---------- 事件 ----------
const bind = (id, k) => $(id).addEventListener('change', e => { S[k] = e.target.value; S.page = 0; render(); });
bind('fYear', 'year'); bind('fRegion', 'region'); bind('fMonth', 'month'); bind('fType', 'type');
$('fPeriod').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  S.period = b.dataset.v;
  [...$('fPeriod').children].forEach(x => x.classList.toggle('on', x === b));
  S.page = 0; render();
});
$('fSpecial').addEventListener('change', e => { S.exSp = e.target.checked; render(); });
$('fG').addEventListener('change', e => { S.exG = e.target.checked; render(); });
$('fNR').addEventListener('change', e => { S.exNR = e.target.checked; render(); });
$('reset').onclick = () => {
  Object.assign(S, { year: 'all', region: 'all', month: 'all', type: 'all', period: 'all', exSp: true, exG: true, exNR: true, page: 0 });
  ['fYear', 'fRegion', 'fMonth', 'fType'].forEach(i => { $(i).value = 'all'; });
  $('fSpecial').checked = $('fG').checked = $('fNR').checked = true;
  [...$('fPeriod').children].forEach(x => x.classList.toggle('on', x.dataset.v === 'all'));
  render();
};
document.querySelectorAll('.dt th.s').forEach(th => {
  th.onclick = () => { const k = th.dataset.k; S.dir = S.sort === k ? -S.dir : -1; S.sort = k; S.page = 0; renderTable(); };
});
$('q').addEventListener('input', e => { S.q = e.target.value; S.page = 0; renderTable(); });
$('prev').onclick = () => { S.page--; renderTable(); };
$('next').onclick = () => { S.page++; renderTable(); };
$('refresh').onclick = async () => {
  const b = $('refresh');
  b.classList.add('spin'); b.disabled = true;
  try {
    await fetch(`${API}/refresh_data`, { method: 'POST' });
    Api.reset();
    PARK = null;
    await load();
  } finally {
    b.classList.remove('spin'); b.disabled = false;
  }
};
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (DATA.length) render(); }, 120); });
document.fonts.ready.then(() => { if (DATA.length) render(); });
load();
