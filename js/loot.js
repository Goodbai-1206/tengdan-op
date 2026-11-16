// 搜容器 + 背包面板（表现层按 _ref/loot_spec.md 重做）。
// 流程：放大镜静止停在下一件的格子里 -> 到点品质色闪一下显形 -> 放大镜立刻跳到下一格，件与件之间零间隔。
// 物品留在容器里由玩家自己拿：点一下弹小菜单"放入"，或者拖拽。
// 所有拖拽坐标都先用 controls.toStage 换成舞台坐标，格子位置用 offsetLeft/Top 链算出，
// 不用 getBoundingClientRect，所以竖屏旋转 90 度时落点也是对的。
import * as audio from './audio.js';
import { view, onStageResize, makeDragScroll, toStage } from './controls.js';
import { RARITY_KEYS, CONTAINER_IDS } from './config.js';
import { buildMemorial, canvasToBlob } from './memorial.js';

// dur：搜索时长（秒，用户定的节奏）；k：显形闪色强度（参考录像里低品质闪得弱）
// 品质色：搜打撤通行的"鲜明但不刺眼"一套，白是中性浅灰。q0/q1/q2 是格子底色由下到上的深色渐变（预先混好，不用 color-mix，老手机也能显示）。
const mixc = (rgb, t, base = [14, 15, 16]) => 'rgb(' + rgb.map((v, i) => Math.round(v * t + base[i] * (1 - t))).join(',') + ')';
function mkRarity(name, rgb, dur, k) {
  const a = rgb.split(',').map(Number);
  return { name, rgb, color: 'rgb(' + rgb + ')', dur, k, q0: mixc(a, 0.62), q1: mixc(a, 0.34, [18, 19, 20]), q2: mixc(a, 0.16, [22, 23, 25]), glow: 'rgba(' + rgb + ',.75)' };
}
export const RARITY = {
  white:  mkRarity('普通', '196,201,207', 1.5, 0.35),
  green:  mkRarity('优良', '79,207,108', 1.5, 0.35),
  blue:   mkRarity('精良', '63,140,240', 2.0, 0.7),
  purple: mkRarity('稀有', '160,92,240', 3.0, 1),
  gold:   mkRarity('传奇', '230,181,44', 4.5, 1),
  red:    mkRarity('至臻', '240,70,58', 6.0, 1),
};
function setQ(el, Rr) {
  el.style.setProperty('--rgb', Rr.rgb); el.style.setProperty('--k', Rr.k);
  el.style.setProperty('--q', Rr.color); el.style.setProperty('--q0', Rr.q0); el.style.setProperty('--q1', Rr.q1); el.style.setProperty('--q2', Rr.q2); el.style.setProperty('--qg', Rr.glow);
}

const BAG_COLS = 7, CONT_COLS = 6, MIN_ROWS = 4;
const DRAG_PX = 8;          // 手指移动超过这个距离才算拖拽
const TAKE_MS = 50;         // 拿取：原位淡出 3 帧
const START_DELAY = 250;    // 面板出现动画（约 0.25 秒）之后搜索立刻开始
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rafWait = () => new Promise(r => requestAnimationFrame(r));
// 价值显示：整数加千分位，有小数保留一位，0.1 不会被四舍五入成 0
export const fmt = n => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? r.toLocaleString('en-US') : r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- 格子占位 ----------
function fits(entries, cols, rows, c, r, w, hh, ignore) {
  if (c < 0 || r < 0 || c + w > cols || r + hh > rows) return false;
  for (const e of entries) {
    if (e === ignore) continue;
    if (c < e.c + e.it.size[0] && c + w > e.c && r < e.r + e.it.size[1] && r + hh > e.r) return false;
  }
  return true;
}
function findSpot(entries, cols, rows, w, hh) {
  for (let r = 0; r + hh <= rows; r++) for (let c = 0; c + w <= cols; c++) if (fits(entries, cols, rows, c, r, w, hh)) return { c, r };
  return null;
}
function packItems(items, cols) {
  const placed = [];
  let rows = 0;
  for (const it of items) {
    const w = it.size[0], hh = it.size[1];
    let spot = null;
    for (let r = 0; !spot; r++) for (let c = 0; c + w <= cols && !spot; c++) if (fits(placed, cols, 1e9, c, r, w, hh)) spot = { c, r };
    placed.push({ it, c: spot.c, r: spot.r });
    rows = Math.max(rows, spot.r + hh);
  }
  return { placed, rows };
}
const bySize = (a, b) => (b.size[0] * b.size[1] - a.size[0] * a.size[1]) || (b.size[1] - a.size[1]);

// 图标：有图片用图片（完整显示不裁切；加载失败退回 emoji），否则 emoji
function makeIcon(it, cls) {
  const box = h('div', cls);
  const emo = h('span', 'emo', it.emoji);
  if (it.image) {
    const img = new Image();
    img.alt = ''; img.draggable = false;
    img.onerror = () => { img.remove(); box.appendChild(emo); };
    img.src = it.image;
    box.appendChild(img);
  } else box.appendChild(emo);
  return box;
}

const MAGNIFIER = '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M14.6 14.6 L20.5 20.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';


// 自绘图标集（24 格，线宽 1.8，圆头圆角，同一视觉重量）。运行时塞进页面一次，用 <use href="#i-名字"> 引用。
const SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
  '<symbol id="i-close" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>' +
  '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></symbol>' +
  '<symbol id="i-sort" viewBox="0 0 24 24"><path d="M4 7h9M4 12h6M4 17h3"/><path d="M17.5 6v12M14.5 15l3 3 3-3"/></symbol>' +
  '<symbol id="i-bag" viewBox="0 0 24 24"><path d="M9 7.5V6.5a3 3 0 0 1 6 0v1"/><rect x="5" y="7.5" width="14" height="12.5" rx="4"/><path d="M9 14h6"/></symbol>' +
  '<symbol id="i-crate" viewBox="0 0 24 24"><path d="M3.5 10.5L6 5h12l2.5 5.5"/><rect x="3.5" y="10.5" width="17" height="9" rx="2"/><path d="M9.5 14.5h5"/></symbol>' +
  '<symbol id="i-putin" viewBox="0 0 24 24"><path d="M12 3.5v10M8 9.5l4 4 4-4"/><path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/></symbol>' +
  '<symbol id="i-putback" viewBox="0 0 24 24"><path d="M12 13.5v-10M8 7.5l4-4 4 4"/><path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/></symbol>' +
  '<symbol id="i-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.2l3.3 4.8-3.3 4.8-3.3-4.8z"/></symbol>' +
  '<symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></symbol>' +
  '<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>' +
  '<symbol id="i-camera" viewBox="0 0 24 24"><path d="M4 8.5a2 2 0 0 1 2-2h2l1.4-2h5.2L16 6.5h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.3"/></symbol>' +
  '<symbol id="i-leave" viewBox="0 0 24 24"><path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M14 8l4 4-4 4M18 12H9.5"/></symbol>' +
  '<symbol id="i-pip" viewBox="0 0 24 24"><path d="M12 3l5.5 9-5.5 9-5.5-9z" fill="currentColor" stroke="none"/></symbol>' +
  '</defs></svg>';
const ic = name => '<svg class="ic" viewBox="0 0 24 24"><use href="#i-' + name + '"/></svg>';
function ensureSprite() {
  if (document.getElementById('lp-sprite')) return;
  const d = document.createElement('div'); d.id = 'lp-sprite'; d.innerHTML = SPRITE; document.body.appendChild(d);
}

export function createLoot(stage, content, hooks = {}) {
  // ---------- 数据：背包与三个容器 ----------
  const allItems = [];
  CONTAINER_IDS.forEach(id => content.containers[id].items.forEach(it => allItems.push(it)));
  const TOTAL = allItems.length;
  const hasValue = allItems.some(it => it.value != null);
  const bag = { key: 'bag', cols: BAG_COLS, rows: Math.max(MIN_ROWS, packItems(allItems.slice().sort(bySize), BAG_COLS).rows), entries: [] };
  const conts = {};
  CONTAINER_IDS.forEach(id => {
    const items = content.containers[id].items;
    const pk = packItems(items, CONT_COLS);
    conts[id] = {
      key: 'cont', id, name: content.containers[id].name, cols: CONT_COLS, rows: Math.max(MIN_ROWS, pk.rows),
      total: items.length, done: 0, touched: false,
      entries: pk.placed.map((p, i) => ({ it: p.it, c: p.c, r: p.r, idx: i, state: 'unknown', el: null, sess: null })),
    };
  });
  let foreignIdx = 1000;
  const timings = [];   // 测试用：每件搜索的起止时间戳

  function status(id) {
    const k = conts[id];
    if (!k.entries.length) return 'cleared';
    return k.touched ? 'partial' : 'fresh';
  }
  const counts = () => ({ got: bag.entries.length, total: TOTAL });
  const bagValue = () => bag.entries.reduce((s, e) => s + (e.it.value || 0), 0);
  const changed = () => { if (hooks.onChange) hooks.onChange(); };

  // ---------- 面板骨架（分区结构见 loot_spec 第 11 节） ----------
  ensureSprite();
  const root = h('div', 'loot hidden');
  const panel = h('div', 'loot-panel');
  root.append(h('div', 'loot-bg'), panel);

  // 顶栏：标志 + 背包标签（左），关闭 = 离开（右）
  const topBar = h('div', 'lp-top');
  const logo = new Image(); logo.className = 'lp-logo'; logo.alt = ''; logo.draggable = false; logo.src = 'images/logo_mark.png';
  const topTab = h('div', 'lp-tab'); topTab.innerHTML = ic('bag');
  const closeBtn = h('button', 'lp-close'); closeBtn.innerHTML = ic('close'); closeBtn.title = '离开';
  topBar.append(logo, topTab, h('div', 'sp'), closeBtn);

  const zones = h('div', 'lp-zones');
  // 左：自己的区域 = 标题条 + 信息列（总价值、整理）+ 背包网格
  const mineSec = h('section', 'lp-sec mine');
  const mineStrip = h('div', 'strip');
  mineStrip.innerHTML = ic('bag') + '<span class="stl">背包</span><span class="cnt">' + ic('grid') + '<b class="num">0</b><i>/0</i></span>';
  const cntUsed = mineStrip.querySelector('.cnt b'), cntTotal = mineStrip.querySelector('.cnt i');
  const mineBody = h('div', 'mine-body');
  const infoCol = h('aside', 'info');
  const valEl = h('div', 'val'); valEl.title = '价值合计'; valEl.innerHTML = ic('coin') + '<b class="num">0</b>';
  const valueB = valEl.querySelector('b');
  if (!hasValue) valEl.classList.add('hidden');
  const sortBtn = h('button', 'lp-btn sortbtn'); sortBtn.title = '整理背包'; sortBtn.innerHTML = ic('sort') + '<em>整理</em>';
  infoCol.append(valEl, sortBtn);
  const lWrap = h('div', 'lp-wrap'), lGrid = h('div', 'lp-grid');
  lWrap.appendChild(lGrid);
  mineBody.append(infoCol, lWrap);
  mineSec.append(mineStrip, mineBody);
  // 右：容器区 = 标题条（名称 + 搜索状态）+ 网格
  const boxSec = h('section', 'lp-sec box');
  const boxStrip = h('div', 'strip state');
  boxStrip.innerHTML = ic('crate') + '<span class="stl"></span><span class="status"><span class="sico"></span><em></em></span>';
  const boxName = boxStrip.querySelector('.stl'), statusIco = boxStrip.querySelector('.sico'), statusTxt = boxStrip.querySelector('.status em'), statusEl = boxStrip.querySelector('.status');
  const boxBody = h('div', 'box-body');
  const rWrap = h('div', 'lp-wrap'), rGrid = h('div', 'lp-grid');
  rWrap.appendChild(rGrid);
  boxBody.appendChild(rWrap);
  boxSec.append(boxStrip, boxBody);
  zones.append(mineSec, boxSec);
  const L = { col: mineSec, wrap: lWrap, grid: lGrid }, R = { col: boxSec, wrap: rWrap, grid: rGrid, hdName: boxName };

  // 详情卡：浮在两区交界附近，自动避开正在操作的格子和菜单
  const detailBox = h('div', 'lp-detail hidden');
  const dHead = h('div', 'dh');
  const dPip = h('span', 'dq'); dPip.innerHTML = ic('pip');
  const dName = h('h4', 'd-name');
  const dClose = h('button', 'lp-xs'); dClose.innerHTML = ic('close');
  dHead.append(dPip, dName, dClose);
  const dBody = h('div', 'dbody');
  const dIcon = h('div', 'dimg');
  const dRight = h('div', 'dright');
  const dVal = h('div', 'd-val');
  const dText = h('p', 'd-text');
  makeDragScroll(dText);
  dRight.append(dVal, dText);
  dBody.append(dIcon, dRight);
  detailBox.append(dHead, dBody);

  // 点选后贴在物品旁边的小菜单：标题 + 图标按钮
  const menu = h('div', 'lp-menu hidden');
  const menuTitle = h('div', 'm-title', '放入');
  const menuBtn = h('button', 'm-btn');
  menu.append(menuTitle, menuBtn);
  const toast = h('div', 'lp-toast');

  panel.append(topBar, zones, detailBox, menu, toast);
  const detail = h('div', 'detail hidden');   // 结算页点物品用的弹窗
  stage.append(root, detail);

  function showDetail(it) {
    const Rr = RARITY[it.rarity];
    detail.innerHTML = '';
    detail.style.setProperty('--rgb', Rr.rgb);
    const card = h('div', 'detail-card');
    setQ(card, Rr);
    const close = h('button', 'detail-close'); close.innerHTML = ic('close');
    const big = makeIcon(it, 'detail-icon');
    const inf = h('div', 'detail-info');
    const nm = h('div', 'detail-name'); nm.innerHTML = '<span class="dq">' + ic('pip') + '</span>'; nm.append(it.name);
    const tx = h('div', 'detail-text', it.text || '');
    makeDragScroll(tx);
    inf.append(nm);
    if (hasValue && it.value != null) { const v = h('div', 'detail-val'); v.innerHTML = ic('coin') + '<b class="num">' + fmt(it.value) + '</b>'; inf.append(v); }
    inf.append(tx);
    card.append(close, big, inf);
    detail.appendChild(card);
    detail.classList.remove('hidden');
    audio.tapClick();
    const hide = () => detail.classList.add('hidden');
    close.onclick = hide;
    detail.onclick = e => { if (e.target === detail) hide(); };
  }

  // ---------- 状态 ----------
  let isOpen = false, mode = 'search', cur = null;   // mode: 'search' | 'bag'
  let sess = null, closeResolve = null, closing = false, allDoneTimer = 0;
  let sel = null;
  let press = null, drag = null, hlEls = [], taking = false;
  const GAP = 4;                 // 格子间距
  let CS = 48, ST = 52;
  const gridOf = key => (key === 'bag' ? L : R);
  const modelOf = key => (key === 'bag' ? bag : cur);
  const keyOfModel = m => (m === bag ? 'bag' : 'cont');

  function posIn(el) {
    let x = 0, y = 0, e = el;
    while (e && e !== root) {
      x += e.offsetLeft; y += e.offsetTop;
      const p = e.offsetParent;
      if (p && p !== root) { x += p.clientLeft - p.scrollLeft; y += p.clientTop - p.scrollTop; }
      e = p;
    }
    return { x, y };
  }

  // ---------- 物品格渲染 ----------
  function placeEl(e) {
    const w = e.it.size[0], hh = e.it.size[1], s = e.el.style;
    s.left = (e.c * ST + GAP) + 'px'; s.top = (e.r * ST + GAP) + 'px';
    s.width = (w * ST - GAP) + 'px'; s.height = (hh * ST - GAP) + 'px';
    s.setProperty('--ms', Math.round(Math.min(w, hh) * ST) + 'px');
  }

  // 按条目状态重画一格。fresh=刚显形，带一次约 0.4 秒的显形动画
  function paint(e, fresh) {
    const el = e.el, it = e.it;
    el.className = 'it';
    el.innerHTML = '';
    ['--rgb', '--k', '--q', '--q0', '--q1', '--q2', '--qg'].forEach(k => el.style.removeProperty(k));
    if (e.state === 'unknown') {
      el.classList.add('unknown');
    } else if (e.state === 'searching') {
      el.classList.add('searching');
      // 搜索中的持续反馈：细环轨道 + 一段匀速旋转的弧 + 随搜索时长填满的琥珀进度弧，放大镜轻轻摆动
      const dur = RARITY[it.rarity].dur;
      const rg = h('div', 'srch');
      rg.style.setProperty('--dur', dur + 's');
      rg.innerHTML = '<svg viewBox="0 0 40 40" class="ring"><circle class="trk" cx="20" cy="20" r="17"/>' +
        '<circle class="prg" cx="20" cy="20" r="17" pathLength="100"/></svg>' +
        '<svg viewBox="0 0 40 40" class="spin"><circle cx="20" cy="20" r="17" pathLength="100"/></svg>' +
        '<div class="mag">' + ic('search') + '</div>';
      el.appendChild(rg);
    } else {
      const Rr = RARITY[it.rarity];
      el.classList.add('revealed', 'r-' + it.rarity);
      setQ(el, Rr);
      el.append(makeIcon(it, 'ico'));
      if (it.size[0] >= 2) el.append(h('div', 'nm', it.name));   // 1 格宽的放不下名字，名字在详情里看
      if (hasValue && it.value != null) { const pr = h('div', 'pr'); pr.innerHTML = ic('coin') + '<span class="num">' + fmt(it.value) + '</span>'; el.append(pr); }
      el.append(h('i', 'band'));
      if (fresh) { el.classList.add('fresh'); el.append(h('div', 'fx')); }
    }
    if (e === sel) el.classList.add('sel');
    if (drag && drag.entry === e) el.classList.add('lifted');
  }

  function makeEntryEl(e, gridEl) {
    e.el = h('div', 'it');
    e.el._entry = e;
    paint(e);
    placeEl(e);
    gridEl.appendChild(e.el);
  }
  // 先画满空格（内凹的暗格），再放物品
  function buildGrid(g) {
    const gr = gridOf(g.key === 'bag' ? 'bag' : 'cont');
    gr.grid.innerHTML = '';
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const d = h('i', 'c'); d.style.left = (c * ST + GAP) + 'px'; d.style.top = (r * ST + GAP) + 'px'; d.style.width = d.style.height = CS + 'px';
      gr.grid.appendChild(d);
    }
    g.entries.forEach(e => makeEntryEl(e, gr.grid));
  }
  function placeCells(g) {
    const gr = gridOf(g.key === 'bag' ? 'bag' : 'cont');
    const cells = gr.grid.querySelectorAll('.c');
    cells.forEach((d, i) => { const c = i % g.cols, r = (i / g.cols) | 0; d.style.left = (c * ST + GAP) + 'px'; d.style.top = (r * ST + GAP) + 'px'; d.style.width = d.style.height = CS + 'px'; });
  }

  // ---------- 布局：格子大小随舞台宽高自适应 ----------
  function layout() {
    if (!isOpen) return;
    const W = view.W, H = view.H, sa = view.safe;
    const bagOnly = mode === 'bag';
    const padL = Math.max(sa.l, 12), padR = Math.max(sa.r, 12);
    const topH = 40 + sa.t;
    const rowsN = Math.max(bag.rows, bagOnly ? 0 : cur.rows);
    const availW = W - padL - padR;
    const mineFixed = 12 + 78 + 10 + 12 + GAP;            // 内边距 + 信息列 + 间距 + 网格边
    const boxFixed = 12 + 12 + GAP;
    const hFixed = topH + 6 + 34 + 8 + 12 + GAP + 10 + sa.b;   // 顶栏 + 缝 + 标题条 + 内边距 + 网格边 + 底边距
    let cs = 54;
    const wNeed = c => mineFixed + BAG_COLS * (c + GAP) + (bagOnly ? 0 : 12 + boxFixed + CONT_COLS * (c + GAP));
    const hNeed = c => hFixed + rowsN * (c + GAP);
    while (cs > 30 && (wNeed(cs) > availW || hNeed(cs) > H)) cs--;
    CS = cs; ST = cs + GAP;
    root.style.setProperty('--cs', cs + 'px');
    topBar.style.height = topH + 'px'; topBar.style.paddingTop = sa.t + 'px';
    topBar.style.paddingLeft = padL + 'px'; topBar.style.paddingRight = padR + 'px';
    zones.style.left = padL + 'px'; zones.style.right = padR + 'px'; zones.style.top = (topH + 6) + 'px';
    zones.style.justifyContent = bagOnly ? 'flex-start' : 'center';
    L.grid.style.width = (BAG_COLS * ST + GAP) + 'px';
    L.grid.style.height = (bag.rows * ST + GAP) + 'px';
    placeCells(bag);
    if (!bagOnly) {
      R.grid.style.width = (CONT_COLS * ST + GAP) + 'px';
      R.grid.style.height = (cur.rows * ST + GAP) + 'px';
      placeCells(cur);
    }
    bag.entries.forEach(placeEl);
    if (!bagOnly) cur.entries.forEach(placeEl);
    positionOverlays();
  }
  onStageResize(() => { if (isOpen) layout(); });

  // ---------- 顶栏、计数、详情、菜单 ----------
  let shown = 0, tweenOn = false;
  function tweenValue() {
    if (tweenOn) return;
    tweenOn = true;
    (function step() {
      const target = bagValue();
      const d = target - shown;
      if (Math.abs(d) < 0.05) { shown = target; valueB.textContent = fmt(shown); tweenOn = false; return; }
      if (Math.abs(d) < 1.5) shown = target; else shown += d * 0.2;
      valueB.textContent = fmt(shown);
      requestAnimationFrame(step);
    })();
  }
  function setValue(instant) {
    if (!hasValue) return;
    const target = bagValue();
    if (instant) { shown = target; valueB.textContent = fmt(shown); return; }
    tweenValue();
  }

  function inCont(e) { return !!e && !!cur && cur.entries.indexOf(e) >= 0; }

  function refreshInfo() {
    const bagMode = mode === 'bag';
    const e = sel;
    if (e) {
      const Rr = RARITY[e.it.rarity];
      detailBox.classList.remove('hidden');
      setQ(detailBox, Rr);
      dPip.style.color = Rr.color;
      dIcon.innerHTML = ''; dIcon.appendChild(makeIcon(e.it, 'd-ico'));
      dName.textContent = e.it.name;
      dVal.innerHTML = (hasValue && e.it.value != null) ? ic('coin') + '<b class="num">' + fmt(e.it.value) + '</b>' : '';
      dText.textContent = e.it.text || '';
      dText.scrollTop = 0;
    } else {
      detailBox.classList.add('hidden');
    }
    // 小菜单：容器里的物品 -> 放入背包；背包里的物品（搜索中）-> 放回容器；只看背包时没有菜单
    if (e && !bagMode) {
      menu.classList.remove('hidden');
      const toBag = inCont(e);
      menuBtn.innerHTML = ic(toBag ? 'putin' : 'putback') + '<em>' + (toBag ? '背包' : '容器') + '</em>';
      menuBtn.title = toBag ? '放入背包' : '放回容器';
    } else menu.classList.add('hidden');
    positionOverlays();
  }

  // 小菜单贴在物品右侧（右边放不下放左边）；详情卡挑一个不挡住选中物品和菜单的位置
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  function boxOf(el) { const o = posIn(el); return { x: o.x, y: o.y, w: el.offsetWidth, h: el.offsetHeight }; }
  function positionOverlays() {
    if (!sel || !sel.el || !sel.el.isConnected) return;
    const g = gridOf(keyOfModel(inCont(sel) ? cur : bag));
    const o = posIn(g.grid);
    const w = sel.it.size[0], hh = sel.it.size[1];
    const sr = { x: o.x + sel.c * ST + GAP, y: o.y + sel.r * ST + GAP, w: w * ST - GAP, h: hh * ST - GAP };
    let mr = null;
    if (!menu.classList.contains('hidden')) {
      const mw = menu.offsetWidth || 62, mh = menu.offsetHeight || 66;
      let x = sr.x + sr.w + 6;
      if (x + mw > view.W - 6) x = sr.x - mw - 6;
      const y = Math.max(4, Math.min(view.H - mh - 4, sr.y));
      menu.style.left = Math.round(x) + 'px'; menu.style.top = Math.round(y) + 'px';
      mr = { x, y, w: mw, h: mh };
    }
    // 详情卡：候选位置 = 容器区底部、背包区底部、容器区顶部、背包区顶部（只看背包时放在背包右侧）
    if (detailBox.classList.contains('hidden')) return;
    const cw = Math.min(272, view.W - 24);
    detailBox.style.width = cw + 'px';
    const ch = detailBox.offsetHeight;
    const mineR = boxOf(L.col), boxR = mode === 'bag' ? null : boxOf(R.col);
    const bottomY = view.H - 8 - view.safe.b - ch;
    const cands = [];
    if (boxR) cands.push({ x: boxR.x + boxR.w - cw, y: bottomY }, { x: mineR.x + mineR.w - cw, y: bottomY }, { x: boxR.x + boxR.w - cw, y: boxR.y + 36 }, { x: mineR.x + mineR.w - cw, y: mineR.y + 36 });
    else cands.push({ x: mineR.x + mineR.w + 12, y: mineR.y }, { x: mineR.x + mineR.w - cw, y: bottomY });
    let best = null, bestA = 1e12;
    for (const c of cands) {
      const x = Math.max(6, Math.min(view.W - cw - 6, c.x)), y = Math.max(4, Math.min(view.H - ch - 4, c.y));
      const r = { x, y, w: cw, h: ch };
      const a = overlap(r, sr) * 4 + (mr ? overlap(r, mr) * 4 : 0);
      if (a < bestA) { bestA = a; best = r; if (a === 0) break; }
    }
    detailBox.style.left = Math.round(best.x) + 'px'; detailBox.style.top = Math.round(best.y) + 'px';
  }

  function refreshCounts() {
    const used = bag.entries.reduce((s, e) => s + e.it.size[0] * e.it.size[1], 0);
    cntUsed.textContent = used; cntTotal.textContent = '/' + (bag.cols * bag.rows);
    if (mode === 'search' && cur) {
      boxName.textContent = cur.name;
      const searching = cur.entries.some(x => x.state === 'unknown' || x.state === 'searching');
      statusEl.classList.toggle('on', searching);
      // 搜完后这个位置留空（不显示文字或图标）
      statusIco.innerHTML = searching ? ic('search') : '';
      statusTxt.textContent = searching ? '搜索中' : '';
      statusEl.title = statusTxt.textContent;
      statusEl.style.visibility = searching ? '' : 'hidden';
    }
  }

  // 整理背包：大件优先重新排布
  function sortBag() {
    if (!bag.entries.length) return;
    const list = bag.entries.slice().sort((a, b) => bySize(a.it, b.it));
    const pk = packItems(list.map(x => x.it), bag.cols);
    if (pk.rows > bag.rows) return;
    list.forEach((x, i) => { x.c = pk.placed[i].c; x.r = pk.placed[i].r; placeEl(x); });
    select(null);
    audio.dropClick();
  }
  sortBtn.onclick = () => sortBag();

  let toastT = 0;
  function showToast(msg) {
    toast.textContent = msg; toast.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 900);
  }

  function select(e) {
    sel = e;
    [bag, cur].forEach(g => { if (g) g.entries.forEach(x => { if (x.el) x.el.classList.toggle('sel', x === sel); }); });
    refreshInfo();
    if (e) audio.tapClick();
  }

  function afterChange() {
    refreshCounts(); refreshInfo(); setValue();
    changed();
    const c = counts();
    if (isOpen && c.got === c.total && !closing && !allDoneTimer) {
      allDoneTimer = setTimeout(() => { allDoneTimer = 0; if (isOpen) closePanel(); }, 750);
    }
  }

  // ---------- 拾取 ----------
  function stowEntry(e) {
    const w = e.it.size[0], hh = e.it.size[1];
    let spot = findSpot(bag.entries, bag.cols, bag.rows, w, hh);
    if (!spot) {
      const list = bag.entries.concat([{ it: e.it, c: 0, r: 0, _new: true }]).sort((a, b) => bySize(a.it, b.it));
      const pk = packItems(list.map(x => x.it), bag.cols);
      if (pk.rows > bag.rows) return false;
      list.forEach((x, i) => { x.c = pk.placed[i].c; x.r = pk.placed[i].r; });
      const me = list.find(x => x._new);
      spot = { c: me.c, r: me.r };
      delete me._new;
      bag.entries.forEach(placeEl);
    }
    moveEntry(e, bag, spot.c, spot.r);
    return true;
  }
  function moveEntry(e, dst, c, r) {
    const src = bag.entries.indexOf(e) >= 0 ? bag : cur;
    if (src !== dst) {
      src.entries.splice(src.entries.indexOf(e), 1);
      if (e.el) e.el.remove();
      e.c = c; e.r = r;
      if (dst.key === 'cont') { e.idx = foreignIdx++; e.state = 'revealed'; }
      dst.entries.push(e);
      makeEntryEl(e, gridOf(keyOfModel(dst)).grid);
    } else {
      e.c = c; e.r = r; placeEl(e);
    }
  }
  // 拿取：菜单消失，物品原位淡出 3 帧（50ms），然后直接出现在背包里，没有飞行动画
  async function takeEntries(list) {
    if (taking || !list.length) return;
    taking = true;
    select(null);
    list.forEach(e => e.el && e.el.classList.add('taking'));
    audio.putIn();
    await sleep(TAKE_MS);
    let fail = 0;
    list.forEach(e => { if (cur && cur.entries.indexOf(e) >= 0 && !stowEntry(e)) { fail++; if (e.el) e.el.classList.remove('taking'); } });
    taking = false;
    if (fail) showToast('背包放不下了，还剩 ' + fail + ' 件');
    afterChange();
  }
  function pickup(e) {
    if (!e || e.state !== 'revealed' || !inCont(e)) return Promise.resolve(false);
    return takeEntries([e]);
  }
  async function putBack(e) {
    if (!e || bag.entries.indexOf(e) < 0 || !cur) return;
    const spot = findSpot(cur.entries, cur.cols, cur.rows, e.it.size[0], e.it.size[1]);
    if (!spot) { showToast('容器放不下了'); return; }
    select(null);
    moveEntry(e, cur, spot.c, spot.r);
    audio.putIn();
    afterChange();
  }

  // ---------- 指针：点选 / 拖拽 ----------
  function entryOfTarget(t) {
    const el = t && t.closest ? t.closest('.it') : null;
    if (!el || !el._entry || el.classList.contains('ghost')) return null;
    return el._entry;
  }
  function modelOfEntry(e) { return bag.entries.indexOf(e) >= 0 ? bag : cur; }
  function entryTL(e) {
    const g = gridOf(keyOfModel(modelOfEntry(e)));
    const o = posIn(g.grid);
    return { x: o.x + e.c * ST + GAP, y: o.y + e.r * ST + GAP };
  }

  function clearHL() { hlEls.forEach(x => x.remove()); hlEls = []; }

  function targetAt(p, dr) {
    const keys = mode === 'bag' ? ['bag'] : ['cont', 'bag'];
    for (const k of keys) {
      const gr = gridOf(k), o = posIn(gr.wrap);
      if (p.x >= o.x && p.x < o.x + gr.wrap.offsetWidth && p.y >= o.y && p.y < o.y + gr.wrap.offsetHeight) {
        const m = modelOf(k), go = posIn(gr.grid);
        const c = Math.round((p.x - dr.grab.x - go.x - GAP) / ST), r = Math.round((p.y - dr.grab.y - go.y - GAP) / ST);
        const w = dr.entry.it.size[0], hh = dr.entry.it.size[1];
        return { m, k, c, r, ok: fits(m.entries, m.cols, m.rows, c, r, w, hh, dr.entry) };
      }
    }
    return null;
  }

  // 手指所在位置的物品占格投影：能放绿、不能放红
  function drawHL(t, dr) {
    clearHL();
    if (!t) return;
    const gr = gridOf(t.k), w = dr.entry.it.size[0], hh = dr.entry.it.size[1];
    for (let y = t.r; y < t.r + hh; y++) for (let x = t.c; x < t.c + w; x++) {
      if (x < 0 || y < 0 || x >= t.m.cols || y >= t.m.rows) continue;
      const d = h('div', 'hl ' + (t.ok ? 'ok' : 'bad'));
      d.style.cssText = 'left:' + (x * ST + GAP) + 'px;top:' + (y * ST + GAP) + 'px;width:' + CS + 'px;height:' + CS + 'px';
      gr.grid.appendChild(d); hlEls.push(d);
    }
  }
  function setZones(on) {
    L.wrap.classList.toggle('zone', on);
    R.wrap.classList.toggle('zone', on && mode === 'search');
  }

  function startDrag(e, p) {
    select(null);                       // 拖拽时菜单收起
    const ghostEntry = { it: e.it, state: 'revealed', c: 0, r: 0 };
    const gh = h('div', 'it ghost');
    ghostEntry.el = gh;
    paint(ghostEntry);
    gh.classList.add('ghost');       // paint 会重置 className，要在它之后再加
    const w = e.it.size[0], hh = e.it.size[1];
    gh.style.width = (w * ST - GAP) + 'px'; gh.style.height = (hh * ST - GAP) + 'px';
    root.appendChild(gh);
    const tl = entryTL(e);
    drag = { id: press.id, entry: e, ghost: gh, grab: { x: press.start.x - tl.x, y: press.start.y - tl.y }, origin: tl, target: null };
    setZones(true);                     // 同一帧：可放置的区域整片铺绿
    audio.dragStart();
    moveDrag(p);
  }
  function moveDrag(p) {
    drag.ghost.style.transform = 'translate(' + (p.x - drag.grab.x) + 'px,' + (p.y - drag.grab.y) + 'px)';
    drag.target = targetAt(p, drag);
    drawHL(drag.target, drag);
  }
  function endDrag(p, cancel) {
    const dr = drag; drag = null;
    setZones(false);
    dr.ghost.remove();                  // 物品图一帧内直接落位或回原位，没有滑动
    const t = (!cancel && p) ? targetAt(p, dr) : null;
    if (t && t.ok) {
      moveEntry(dr.entry, t.m, t.c, t.r);
      audio.dropClick();
      // 绿色投影约 6 帧（100ms）褪去
      const old = hlEls; hlEls = [];
      old.forEach(x => x.classList.add('out'));
      setTimeout(() => old.forEach(x => x.remove()), 110);
      afterChange();
    } else {
      clearHL();
      if (!cancel) showToast('放不下这里');   // 不可放：无声音，只有提示条
    }
  }

  root.addEventListener('pointerdown', ev => {
    if (!isOpen || press || drag || taking) return;
    if (!detail.classList.contains('hidden')) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest('.lp-menu')) return;
    const e = entryOfTarget(ev.target);
    const p = toStage(ev.clientX, ev.clientY);
    if (e) {
      press = { id: ev.pointerId, entry: e, start: p, last: p, moved: false };
    } else {
      const wrap = ev.target.closest && ev.target.closest('.lp-wrap');
      if (!wrap) return;      // 按钮等其他区域不抢指针，否则按钮点不到
      press = { id: ev.pointerId, entry: null, wrap, start: p, last: p, moved: false };
    }
    try { root.setPointerCapture(ev.pointerId); } catch (x) { /* 静默 */ }
  });
  root.addEventListener('pointermove', ev => {
    if (!press || ev.pointerId !== press.id) return;
    const p = toStage(ev.clientX, ev.clientY);
    if (drag) { moveDrag(p); return; }
    if (!press.moved && Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_PX) {
      press.moved = true;
      if (press.entry && press.entry.state === 'revealed') startDrag(press.entry, p);
    }
    if (press.moved && !drag && press.wrap) press.wrap.scrollTop -= (p.y - press.last.y);
    press.last = p;
  });
  const releasePress = (ev, cancel) => {
    if (!press || ev.pointerId !== press.id) return;
    const pr = press; press = null;
    const p = toStage(ev.clientX, ev.clientY);
    if (drag) { endDrag(p, cancel); return; }
    if (cancel || pr.moved) return;
    if (!pr.entry) { if (sel) select(null); return; }      // 点空白处：菜单和详情收起
    const e = pr.entry;
    if (e.state !== 'revealed') return;
    select(e === sel ? null : e);
  };
  root.addEventListener('pointerup', ev => releasePress(ev, false));
  root.addEventListener('pointercancel', ev => releasePress(ev, true));
  root.addEventListener('wheel', ev => {
    const wrap = ev.target.closest && ev.target.closest('.lp-wrap');
    if (wrap) wrap.scrollTop += ev.deltaY;
  }, { passive: true });
  root.addEventListener('contextmenu', ev => ev.preventDefault());

  menuBtn.onclick = () => { if (!sel) return; if (inCont(sel)) pickup(sel); else putBack(sel); };
  const leave = () => { audio.uiClick(); closePanel(); };
  closeBtn.onclick = leave;
  window.addEventListener('keydown', ev => { if (isOpen && ev.key === 'Escape') leave(); });

  // ---------- 搜索 ----------
  // 放大镜静止停在这一格，到点显形（没有进度环、没有逐格 tick、没有悬念特效）。
  async function revealOne(s, k, e) {
    const it = e.it, Rr = RARITY[it.rarity];
    e.state = 'searching'; e.sess = s; paint(e);
    const t0 = performance.now();
    const dur = Rr.dur * 1000;
    while (true) {
      await rafWait();
      if (s.dead) { if (e.sess === s) { e.state = 'unknown'; e.sess = null; if (e.el && e.el.isConnected) paint(e); } return false; }
      if (performance.now() - t0 >= dur) break;
    }
    // 显形：品质色闪（CSS 动画 24 帧）+ 一声短促的咔嗒
    e.state = 'revealed'; e.sess = null; k.done++; k.touched = true;
    paint(e, true);
    audio.revealSfx(it.rarity);
    timings.push({ id: k.id, name: it.name, rarity: it.rarity, t0, t1: performance.now() });
    refreshCounts(); refreshInfo(); changed();
    return !s.dead;
  }

  async function runSearch(s, k) {
    await sleep(START_DELAY);
    if (s.dead) return;
    const pending = k.entries.filter(e => e.state === 'unknown').sort((a, b) => a.idx - b.idx);
    if (pending.length) audio.searchLoopStart();       // 轻轻的翻找摩擦声，搜完即停
    try {
      for (const e of pending) {
        if (s.dead || k.entries.indexOf(e) < 0) return;
        if (!(await revealOne(s, k, e))) return;     // 显形后同一刻进入下一件，件与件零间隔
      }
    } finally { audio.searchLoopStop(); }
    if (s.dead) return;
    refreshCounts(); refreshInfo();
  }

  // ---------- 打开 / 关闭 ----------
  async function openPanel(m, id) {
    if (isOpen) return { allDone: false };
    mode = m; cur = m === 'search' ? conts[id] : null;
    isOpen = true; closing = false; sel = null; press = null; drag = null; taking = false;
    detail.classList.add('hidden');
    root.classList.toggle('bag-only', m === 'bag');
    R.col.classList.toggle('hidden', m === 'bag');
    buildGrid(bag);
    if (cur) {
      cur.entries.forEach(e => { if (e.state === 'searching') e.state = 'unknown'; });
      buildGrid(cur);
      R.hdName.textContent = cur.name;
    }
    root.classList.remove('hidden');
    layout();
    setValue(true);
    refreshCounts(); refreshInfo();
    audio.panelOpen();
    requestAnimationFrame(() => root.classList.add('show'));
    const p = new Promise(res => { closeResolve = res; });
    if (cur) { sess = { dead: false }; runSearch(sess, cur); }
    return p;
  }

  async function closePanel() {
    if (!isOpen || closing) return;
    closing = true;
    clearTimeout(allDoneTimer); allDoneTimer = 0;
    if (sess) { sess.dead = true; sess = null; }
    if (drag) endDrag(null, true);
    press = null; clearHL(); setZones(false);
    detail.classList.add('hidden');
    audio.panelClose();
    root.classList.remove('show');
    await sleep(160);
    root.classList.add('hidden');
    isOpen = false; closing = false; sel = null;
    root.querySelectorAll('.ghost').forEach(x => x.remove());
    const r = closeResolve; closeResolve = null;
    changed();
    if (r) r({ allDone: counts().got === counts().total });
  }

  // 调试 / 测试用：格子 (c, r) 中心的舞台坐标
  function cellCenter(key, c, r) {
    const o = posIn(gridOf(key).grid);
    return { x: o.x + c * ST + GAP + CS / 2, y: o.y + r * ST + GAP + CS / 2, st: ST, cs: CS };
  }

  // ---------- 结算页：只有收获清单和总价值 ----------
  const end = h('div', 'end hidden');
  const confetti = document.createElement('canvas'); confetti.className = 'confetti';
  const endBox = h('div', 'end-box');
  const endHead = h('div', 'end-head');
  const endTotal = h('div', 'end-total');
  const endLogo = new Image(); endLogo.className = 'end-logo'; endLogo.alt = ''; endLogo.draggable = false; endLogo.src = 'images/logo_mark.png';
  endHead.append(endLogo, h('div', 'end-title', '行动完成'), endTotal);
  const endList = h('div', 'end-list');
  makeDragScroll(endList);
  // 两个选项：纪念（主，琥珀色）= 生成纪念图；撤离（次）= 压暗淡出后回封面，全新一局
  const endBtns = h('div', 'end-btns');
  const memoBtn = h('button', 'end-btn memo'); memoBtn.innerHTML = ic('camera') + '<span>纪念</span>'; memoBtn.title = '保存纪念图';
  const evacBtn = h('button', 'end-btn sec evac'); evacBtn.innerHTML = ic('leave') + '<span>撤离</span>'; evacBtn.title = '撤离，结束这一局';
  endBtns.append(memoBtn, evacBtn);
  const evacFade = h('div', 'evac-fade');
  endBox.append(endHead, endList, endBtns);
  end.append(confetti, endBox);
  stage.append(end, evacFade);
  let endLayout = null, confettiRun = false;

  function runConfetti() {
    const ctx = confetti.getContext('2d');
    const cols = ['#e8a93a', '#ff7a59', '#62c06f', '#4f8fe0', '#a66fe6', '#ff8fb1', '#fff1c4'];
    const ps = [];
    const spawn = n => { for (let i = 0; i < n; i++) ps.push({ x: Math.random() * view.W, y: -10 - Math.random() * view.H * 0.5, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 120, s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 8, c: cols[(Math.random() * cols.length) | 0] }); };
    spawn(110);
    let last = performance.now(), t = 0;
    confettiRun = true;
    (function loop(now) {
      if (!confettiRun) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * view.scale;
      if (confetti.width !== Math.round(view.W * dpr)) { confetti.width = Math.round(view.W * dpr); confetti.height = Math.round(view.H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.W, view.H);
      if (t < 4 && Math.random() < 0.5) spawn(2);
      for (const p of ps) {
        p.x += p.vx * dt + Math.sin(p.r) * 20 * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = 0.9; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      for (let i = ps.length - 1; i >= 0; i--) if (ps[i].y > view.H + 20) ps.splice(i, 1);
      requestAnimationFrame(loop);
    })(last);
  }

  async function showEnding(items) {
    const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => (RARITY_KEYS.indexOf(b.it.rarity) - RARITY_KEYS.indexOf(a.it.rarity)) || (a.i - b.i)).map(x => x.it);
    endList.innerHTML = '';
    sorted.forEach(it => {
      const R2 = RARITY[it.rarity];
      const m = h('div', 'tile r-' + it.rarity); setQ(m, R2);
      m.append(makeIcon(it, 'tile-icon'), h('div', 'tile-nm', it.name));
      if (hasValue && it.value != null) { const pr = h('div', 'tile-pr'); pr.innerHTML = ic('coin') + '<span class="num">' + fmt(it.value) + '</span>'; m.append(pr); }
      m.append(h('i', 'band'));
      m.onclick = () => showDetail(it);
      endList.appendChild(m);
    });
    const total = sorted.reduce((s, it) => s + (it.value || 0), 0);
    endTotal.innerHTML = '';
    if (hasValue) { endTotal.innerHTML = ic('coin') + '<b class="num">' + fmt(total) + '</b>'; endTotal.title = '总价值'; }
    end.classList.remove('hidden');
    requestAnimationFrame(() => end.classList.add('show'));
    runConfetti();
    audio.settle();
    endLayout = () => { confetti.width = 0; };
    lastSorted = sorted; lastTotal = total;
    // 撤离不返回：压暗淡出约 0.6 秒后回到封面（整页重新加载 = 全新一局，背包和容器状态都重置）
    await new Promise(() => {});
  }

  // ---------- 纪念图：canvas 自己画，预览层挂在舞台外面（不受竖屏旋转影响），保存 / 系统分享 / 长按保存 ----------
  let lastSorted = [], lastTotal = 0, memoPop = null, memoUrl = null;
  const MEMO_NAME = '腾诞日行动_纪念.png';
  function closeMemo() { if (memoPop) { memoPop.remove(); memoPop = null; } if (memoUrl) { URL.revokeObjectURL(memoUrl); memoUrl = null; } }
  async function saveMemo(blob) {
    const file = new File([blob], MEMO_NAME, { type: 'image/png' });
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {      // 手机：优先系统分享面板
      try { await navigator.share({ files: [file], title: '腾诞日行动' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = memoUrl; a.download = MEMO_NAME; document.body.appendChild(a); a.click(); a.remove();   // 电脑：直接下载
  }
  async function openMemo() {
    if (memoBtn.disabled) return;
    memoBtn.disabled = true; audio.uiClick();
    try {
      const cv = await buildMemorial(lastSorted, RARITY, { hasValue, total: lastTotal });
      const blob = await canvasToBlob(cv);
      closeMemo();
      memoUrl = URL.createObjectURL(blob);
      const pop = h('div', 'memo-pop');
      const img = new Image(); img.className = 'memo-img'; img.alt = '纪念图'; img.src = memoUrl;
      const hint = h('div', 'memo-hint', '长按图片保存');
      const row = h('div', 'memo-btns');
      const save = h('button', 'end-btn memo-save'); save.innerHTML = ic('putin') + '<span>保存</span>';
      const close = h('button', 'end-btn sec memo-close'); close.innerHTML = ic('close') + '<span>关闭</span>';
      row.append(save, close);
      pop.append(img, hint, row);
      document.body.appendChild(pop); memoPop = pop;
      save.onclick = () => { audio.uiClick(); saveMemo(blob); };
      close.onclick = () => { audio.uiClick(); closeMemo(); };
    } catch (e) { console.error(e); showToast('纪念图生成失败'); }
    memoBtn.disabled = false;
  }
  memoBtn.onclick = openMemo;
  evacBtn.onclick = () => {
    audio.uiClick(); evacFade.classList.add('on');
    setTimeout(() => { if (hooks.onEvacuate) hooks.onEvacuate(); else location.reload(); }, 650);
  };

  onStageResize(() => { if (endLayout) endLayout(); });

  return {
    openContainer: id => openPanel('search', id),
    openBag: () => openPanel('bag'),
    showEnding, showDetail, rootEl: root,
    status, counts, hasValue,
    bagItems: () => bag.entries.map(e => e.it),
    get isOpen() { return isOpen; },
    // 调试 / 测试用
    _model: { bag, conts }, _cellCenter: cellCenter, _timings: timings, _fmt: fmt,
  };
}
