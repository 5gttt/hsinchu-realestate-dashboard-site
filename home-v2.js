// 新版首頁（index-v2）：摺疊區塊的摘要文字與展開後重畫圖表
// app.js 的 render() 完成後會呼叫 window.onHomeRender；摺起來的區塊寬度為 0，展開時要重畫才會量到正確寬度

window.onHomeRender = ({ cur, byM, rs, ps, rmTop, tr }) => {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  if (!cur.length) {
    set('sumTrend', '此條件無資料'); set('sumStruct', '此條件無資料'); set('sumTable', '此條件無資料');
    return;
  }
  const last = [...byM].reverse().find(x => x.n) || byM[byM.length - 1];
  const trend = tr === null ? '' : `　·　近 3 月單價 ${tr > 0 ? '+' : ''}${tr.toFixed(1)}%`;
  set('sumTrend', `${last.l} 成交 ${last.n.toLocaleString()} 件${trend}`);
  set('sumStruct', `${rs[0][0]} 佔 ${(rs[0][1] / cur.length * 100).toFixed(0)}%　·　${rmTop.l}佔 ${(rmTop.n / cur.length * 100).toFixed(0)}%　·　熱銷「${ps[0] ? ps[0].k : '—'}」`);
  set('sumTable', `${cur.length.toLocaleString()} 筆成交紀錄，可搜尋與排序`);
};

document.querySelectorAll('details.fold').forEach(d => {
  d.addEventListener('toggle', () => { if (d.open && typeof render === 'function' && DATA.length) render(); });
});

// 「排除條件」浮層：點外面就收起來
document.addEventListener('click', e => {
  const m = document.querySelector('details.more[open]');
  if (m && !m.contains(e.target)) m.removeAttribute('open');
});
