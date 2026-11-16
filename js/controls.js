// 舞台布局（横竖屏）、触摸/键鼠输入、坐标映射。
// 竖屏时整个 #stage 用 CSS 旋转 90 度铺满，所有触摸坐标都必须经过 toStage 换算成舞台坐标。

// 设计舞台 844x390。窗口更大时整个舞台（3D + 界面）等比放大撑满窗口：
// scale = min(窗口宽/844, 窗口高/390)，逻辑尺寸 W x H = 窗口尺寸 / scale（至少 844x390）。
export const DESIGN = { W: 844, H: 390 };
export const view = { W: 844, H: 390, rotated: false, iw: 844, ih: 390, scale: 1, safe: { t: 0, r: 0, b: 0, l: 0 } };

let stageEl = null;
let probe = null;
const resizeListeners = [];

export function onStageResize(fn) { resizeListeners.push(fn); }

// 屏幕坐标 -> 舞台坐标。竖屏时舞台被顺时针旋转 90 度：
// 舞台点 (sx, sy) 落在屏幕 (iw - sy, sx)，反过来 sx = clientY, sy = iw - clientX。
export function toStage(clientX, clientY) {
  const k = view.scale || 1;
  if (view.rotated) return { x: clientY / k, y: (view.iw - clientX) / k };
  return { x: clientX / k, y: clientY / k };
}

function readSafeArea() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
  };
}

// 根据当前窗口尺寸摆放舞台。横屏直铺；竖屏旋转 90 度，宽=屏幕高，高=屏幕宽。
export function layoutStage() {
  const iw = window.innerWidth, ih = window.innerHeight;
  view.iw = iw; view.ih = ih;
  view.rotated = ih > iw;
  const s = readSafeArea();
  // 竖屏时舞台旋转 90 度：舞台宽 = 屏幕高，舞台高 = 屏幕宽
  const long = view.rotated ? ih : iw, short = view.rotated ? iw : ih;
  const k = Math.min(long / DESIGN.W, short / DESIGN.H);
  view.scale = k;
  view.W = long / k; view.H = short / k;
  stageEl.style.width = view.W + 'px';
  stageEl.style.height = view.H + 'px';
  if (view.rotated) {
    stageEl.style.transform = 'translateX(' + iw + 'px) rotate(90deg) scale(' + k + ')';
    // 舞台左=屏幕上，舞台上=屏幕右，舞台右=屏幕下，舞台下=屏幕左
    view.safe = { t: s.right / k, r: s.bottom / k, b: s.left / k, l: s.top / k };
  } else {
    stageEl.style.transform = 'scale(' + k + ')';
    view.safe = { t: s.top / k, r: s.right / k, b: s.bottom / k, l: s.left / k };
  }
  const st = stageEl.style;
  st.setProperty('--sa-t', view.safe.t + 'px');
  st.setProperty('--sa-r', Math.max(view.safe.r, 12) + 'px');
  st.setProperty('--sa-b', view.safe.b + 'px');
  st.setProperty('--sa-l', Math.max(view.safe.l, 12) + 'px');
  stageEl.classList.toggle('is-rotated', view.rotated);
  resizeListeners.forEach(fn => fn(view));
}

export function initStage(el) {
  stageEl = el;
  layoutStage();
  window.addEventListener('resize', layoutStage);
  window.addEventListener('orientationchange', () => { layoutStage(); setTimeout(layoutStage, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layoutStage);
  // 禁止缩放、下拉刷新、长按菜单、双击放大
  const stop = e => { if (e.cancelable) e.preventDefault(); };   // 已经开始滚动的触摸不可取消，硬取消会在控制台报警
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
  // 纪念图预览（.memo-img）要保留长按菜单和选择，其余地方照旧禁掉
  const stopX = e => { if (e.target && e.target.closest && e.target.closest('.memo-img, .memo-pop')) return; if (e.cancelable) e.preventDefault(); };
  document.addEventListener('contextmenu', stopX);
  document.addEventListener('dblclick', stop);
  document.addEventListener('selectstart', stopX);
  document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}

// 让某个元素支持"拖动滚动"（位移经过坐标映射，竖屏旋转下方向也正确）
export function makeDragScroll(el) {
  let id = null, lastY = 0, lastX = 0;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return; // 鼠标用滚轮
    id = e.pointerId; const p = toStage(e.clientX, e.clientY); lastX = p.x; lastY = p.y;
    el.setPointerCapture(id);
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const p = toStage(e.clientX, e.clientY);
    el.scrollTop -= (p.y - lastY); el.scrollLeft -= (p.x - lastX);
    lastX = p.x; lastY = p.y;
  });
  const end = e => { if (e.pointerId === id) id = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// 探索输入：虚拟摇杆（左半屏）、转视角（右半屏）、WASD + 鼠标拖动 + F
export function createControls(touchLayer, joyEl, knobEl, handlers) {
  const ctl = {
    enabled: false,
    move: { x: 0, y: 0 },   // x 向右，y 向前，范围 -1..1
    look: { dx: 0, dy: 0 }, // 累积的视角位移（舞台像素）
    consumeLook() { const r = { dx: this.look.dx, dy: this.look.dy }; this.look.dx = 0; this.look.dy = 0; return r; },
    setEnabled(v) { this.enabled = v; if (!v) { releaseAll(); } },
  };
  const JOY_R = 52;
  let joy = null;   // {id, ox, oy, x, y}
  let lookP = null; // {id, x, y}
  const keys = {};

  function releaseAll() {
    joy = null; lookP = null; joyEl.classList.remove('on');
    ctl.move.x = 0; ctl.move.y = 0;
    for (const k in keys) keys[k] = false;
  }

  touchLayer.addEventListener('pointerdown', e => {
    if (!ctl.enabled) return;
    const p = toStage(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      if (!lookP) { lookP = { id: e.pointerId, x: p.x, y: p.y }; touchLayer.setPointerCapture(e.pointerId); }
      return;
    }
    if (p.x < view.W / 2) {
      if (joy) return;
      joy = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
      joyEl.style.left = p.x + 'px'; joyEl.style.top = p.y + 'px';
      knobEl.style.transform = 'translate(-50%,-50%)';
      joyEl.classList.add('on');
    } else {
      if (lookP) return;
      lookP = { id: e.pointerId, x: p.x, y: p.y };
    }
    touchLayer.setPointerCapture(e.pointerId);
  });

  touchLayer.addEventListener('pointermove', e => {
    if (!ctl.enabled) return;
    const p = toStage(e.clientX, e.clientY);
    if (joy && e.pointerId === joy.id) {
      let dx = p.x - joy.ox, dy = p.y - joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
      knobEl.style.transform = 'translate(' + (dx - JOY_R * 0.0) + 'px,' + dy + 'px) translate(-50%,-50%)';
      ctl.move.x = dx / JOY_R; ctl.move.y = -dy / JOY_R;
    } else if (lookP && e.pointerId === lookP.id) {
      ctl.look.dx += p.x - lookP.x; ctl.look.dy += p.y - lookP.y;
      lookP.x = p.x; lookP.y = p.y;
    }
  });

  const up = e => {
    if (joy && e.pointerId === joy.id) { joy = null; joyEl.classList.remove('on'); ctl.move.x = 0; ctl.move.y = 0; }
    if (lookP && e.pointerId === lookP.id) lookP = null;
  };
  touchLayer.addEventListener('pointerup', up);
  touchLayer.addEventListener('pointercancel', up);

  // 键盘
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'f' || k === 'e') { if (!e.repeat && handlers.onInteract) handlers.onInteract(); return; }
    if (!ctl.enabled) return;
    keys[k] = true;
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // 键盘与摇杆合成最终移动向量
  ctl.getMove = function () {
    let x = ctl.move.x, y = ctl.move.y;
    if (keys['w'] || keys['arrowup']) y += 1;
    if (keys['s'] || keys['arrowdown']) y -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['a'] || keys['arrowleft']) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  };
  return ctl;
}
