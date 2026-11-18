// 桌上的迷你音响：歌单、播放、音量、距离衰减，以及「音响」小面板。
// 歌单读 music/tracks.json：[{ "file": "01.mp3", "title": "歌名" }]，文件放在 music/ 目录；列表为空或文件不在 = 「还没有放入歌曲」。
// 音频走 <audio> 元素（边下边播，懒加载），再接进 audio.js 的总线（共用总音量 / 静音 / 压缩器）。
import * as audio from './audio.js';

const BASE = 0.04;            // 满格增益。显形声峰值约 0.08，音乐（峰值约 0.8 的曲子）在默认音量 0.7 时约低 10dB
const VOL_KEY = 'loot_music_vol';
const FADE_IN = 1.5;          // 进屋后第一次自动播放的淡入秒数
const DUCK = 0.6;             // 搜索面板打开时压到 60%
const FAR_MIN = 0.72;         // 屋里最远处至少 72%
const ROOM_FAR = 5.5;         // 屋里离音响最远约 5.5 米
const SPEAKER = { x: 2.615, z: 0.12 };

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" stroke="none"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="2.4" height="12" rx="1" fill="currentColor" stroke="none"/><path d="M19 6v12L9 12z" fill="currentColor" stroke="none"/></svg>',
  next: '<svg viewBox="0 0 24 24"><rect x="16.6" y="6" width="2.4" height="12" rx="1" fill="currentColor" stroke="none"/><path d="M5 6v12l10-6z" fill="currentColor" stroke="none"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4.5 9.5h3.5l4.5-3.5v12l-4.5-3.5H4.5z" fill="currentColor"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.4 6.8a7.4 7.4 0 0 1 0 10.4"/></svg>',
};

export function createMusic(stage, hooks = {}) {
  const base = 'music/';
  let tracks = [];
  let idx = 0;
  let status = 'idle';       // idle | loading | playing | paused | error
  let userPaused = false;    // 玩家点过暂停：自动恢复不再覆盖
  let hiddenPaused = false;  // 页面隐藏时被我们暂停
  let wantAuto = false;      // 已经进屋、应该自动播放
  let blocked = false;       // 自动播放被浏览器挡了，等下一次触摸再试
  let el = null, src = null, mg = null, an = null, anBuf = null;
  let vol = 0.7, fade = 1, fadeT = -1;
  let curSrc = '';
  const requested = [];      // 测试用：请求过哪些曲目文件（懒加载断言）
  let level = 0;
  try { const v = parseFloat(localStorage.getItem(VOL_KEY)); if (isFinite(v)) vol = Math.min(1, Math.max(0, v)); } catch (e) { /* 静默 */ }

  const listeners = [];
  const emit = () => { listeners.forEach(f => f()); };

  // ---------- 歌单 ----------
  let ready = null;
  function init() {
    if (ready) return ready;
    ready = (async () => {
      try {
        const r = await fetch(hooks.tracksUrl || (base + 'tracks.json'), { cache: 'no-cache' });
        if (!r.ok) throw new Error('no tracks.json');
        const j = await r.json();
        const list = (Array.isArray(j) ? j : []).filter(t => t && t.file);
        const ok = await Promise.all(list.map(async t => { try { const h = await fetch(base + encodeURIComponent(t.file), { method: 'HEAD' }); return h.ok; } catch (e) { return false; } }));
        tracks = list.filter((_, i) => ok[i]).map(t => ({ file: t.file, title: t.title || t.file }));
      } catch (e) { tracks = []; }
      emit();
    })();
    return ready;
  }

  // ---------- 音频元素与总线 ----------
  function ensureEl() {
    if (el) return el;
    el = new Audio(); el.preload = 'none'; el.loop = false; el.crossOrigin = 'anonymous';
    el.addEventListener('playing', () => { status = 'playing'; emit(); });
    el.addEventListener('pause', () => { if (status !== 'error' && !el.ended) { status = status === 'loading' ? 'loading' : 'paused'; emit(); } });
    el.addEventListener('waiting', () => { if (!el.paused) { status = 'loading'; emit(); } });
    el.addEventListener('stalled', () => { if (!el.paused && el.readyState < 3) { status = 'loading'; emit(); } });
    el.addEventListener('error', () => { status = 'error'; emit(); });
    el.addEventListener('ended', () => { next(true); });
    return el;
  }
  function connect() {
    const bus = audio.getBus();
    if (!bus || src) return !!src;
    ensureEl();
    try {
      src = bus.ctx.createMediaElementSource(el);
      mg = bus.ctx.createGain(); mg.gain.value = 0;
      an = bus.ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.6; anBuf = new Uint8Array(an.frequencyBinCount);
      src.connect(mg); mg.connect(bus.master); mg.connect(an);
      return true;
    } catch (e) { console.warn('音乐接入总线失败', e); src = null; return false; }
  }
  const trackUrl = i => base + encodeURIComponent(tracks[i].file);

  function loadTrack(i) {
    ensureEl();
    const u = trackUrl(i);
    if (curSrc !== u) {
      curSrc = u; el.src = u; requested.push(tracks[i].file);
    }
  }
  async function playCurrent() {
    if (!tracks.length) return false;
    ensureEl(); connect();
    loadTrack(idx);
    status = el.readyState >= 3 ? 'playing' : 'loading'; emit();
    try {
      await el.play(); blocked = false; return true;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') { blocked = true; status = 'paused'; emit(); }
      else if (e && e.name !== 'AbortError') { status = 'error'; emit(); }
      return false;
    }
  }

  // 点封面按钮时（用户手势内）预热：接好总线、增益为 0 的情况下把第 1 首 play 一下再停，换来之后的程序化播放权限
  async function prime() {
    await init();
    if (!tracks.length) return;
    ensureEl(); connect();
    if (mg) mg.gain.value = 0;
    loadTrack(0);
    try { await el.play(); if (!wantAuto) { el.pause(); el.currentTime = 0; status = 'paused'; } /* 已经进屋自动播放了就别再停（网慢时预热的 play 可能晚于进屋才返回） */ } catch (e) { /* 静默：之后再试 */ }
  }

  // 进屋：第 1 首自动播放，1.5 秒淡入（玩家已经手动选过/暂停过就不再抢）
  async function startAuto() {
    await init();
    wantAuto = true;
    if (!tracks.length || userPaused) return;
    fade = 0; fadeT = performance.now();
    idx = 0;
    const ok = await playCurrent();
    if (!ok && blocked) armRetry();
  }
  function armRetry() {
    const f = () => { document.removeEventListener('pointerdown', f, true); if (wantAuto && !userPaused && status !== 'playing') { fade = 0; fadeT = performance.now(); playCurrent(); } };
    document.addEventListener('pointerdown', f, true);
  }

  // ---------- 操作 ----------
  async function playIndex(i) {
    if (!tracks.length) return;
    idx = (i + tracks.length) % tracks.length; userPaused = false;
    if (curSrc !== trackUrl(idx) && el) { el.pause(); }
    fade = 1; fadeT = -1;
    emit();
    await playCurrent();
  }
  function next(auto) { if (tracks.length) playIndex(idx + 1); }
  function prev() { if (tracks.length) playIndex(idx - 1); }
  async function toggle() {
    if (!tracks.length) return;
    ensureEl();
    if (status === 'playing' || (status === 'loading' && !el.paused)) { userPaused = true; el.pause(); status = 'paused'; emit(); }
    else { userPaused = false; fade = 1; fadeT = -1; await playCurrent(); }
  }
  function retry() { if (!tracks.length) return; if (el) { el.removeAttribute('src'); curSrc = ''; } userPaused = false; playCurrent(); }
  function setVolume(v) {
    vol = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOL_KEY, String(vol)); } catch (e) { /* 静默 */ }
    emit();
  }

  // 页面隐藏时暂停，回来再接着放
  document.addEventListener('visibilitychange', () => {
    if (!el) return;
    if (document.hidden) { if (status === 'playing' || (status === 'loading' && !el.paused)) { hiddenPaused = true; el.pause(); } }
    else if (hiddenPaused) { hiddenPaused = false; if (!userPaused) playCurrent(); }
  });

  // ---------- 每帧：距离 / 压低 / 淡入 -> 增益；节拍强度 ----------
  // env = { active（已进屋，不在开场/封面）, x, z（玩家位置）, ducked（搜索面板打开） }
  function distGain(x, z) {
    const d = Math.hypot(x - SPEAKER.x, z - SPEAKER.z);
    const k = Math.min(1, Math.max(0, (d - 1.0) / (ROOM_FAR - 1.0)));
    return 1 - (1 - FAR_MIN) * k;
  }
  let lastGain = 0;
  function update(dt, env) {
    if (fadeT >= 0) { fade = Math.min(1, (performance.now() - fadeT) / (FADE_IN * 1000)); if (fade >= 1) fadeT = -1; }
    const inRoom = env.active && env.x > -2.72;      // 西墙以西 = 走廊，一律静音
    let g = 0;
    if (inRoom) g = BASE * vol * vol * distGain(env.x, env.z) * (env.ducked ? DUCK : 1) * fade;
    lastGain = g;
    const bus = audio.getBus();
    if (mg && bus) mg.gain.setTargetAtTime(g, bus.ctx.currentTime, 0.12);
    else if (el) el.volume = Math.min(1, g / BASE);
    // 节拍：低频段能量（约 40~250Hz）的包络，0..1
    if (an && status === 'playing') {
      an.getByteFrequencyData(anBuf);
      let sum = 0; const n = 6;      // fftSize 512 @44.1k：每格约 86Hz，取前 6 格
      for (let i = 0; i < n; i++) sum += anBuf[i];
      const raw = Math.min(1, Math.max(0, (sum / n / 255 - 0.35) / 0.5));
      level += (raw - level) * Math.min(1, dt * (raw > level ? 25 : 8));
    } else level *= Math.max(0, 1 - dt * 8);
  }

  // ---------- 面板 ----------
  const root = document.createElement('div'); root.className = 'mp hidden';
  root.innerHTML = '<div class="mp-box" role="dialog" aria-label="音响"><div class="mp-head"><span class="mp-ttl">音响</span><button class="mp-x" aria-label="关闭">' + ICON.close + '</button></div><div class="mp-list"></div><div class="mp-ctl"><button class="mp-b mp-prev" aria-label="上一首">' + ICON.prev + '</button><button class="mp-b mp-pp" aria-label="播放/暂停"></button><button class="mp-b mp-next" aria-label="下一首">' + ICON.next + '</button></div><div class="mp-vol"><span class="mp-vi">' + ICON.vol + '</span><input class="mp-rng" type="range" min="0" max="100" step="1" aria-label="音量"></div></div>';
  stage.appendChild(root);
  const q = s => root.querySelector(s);
  const listEl = q('.mp-list'), ppBtn = q('.mp-pp'), rng = q('.mp-rng');
  let openRes = null;

  function render() {
    listEl.innerHTML = '';
    if (!tracks.length) {
      const e = document.createElement('div'); e.className = 'mp-empty'; e.textContent = '还没有放入歌曲'; listEl.appendChild(e);
    } else {
      tracks.forEach((t, i) => {
        const b = document.createElement('button'); b.className = 'mp-row' + (i === idx ? ' cur' : ''); b.dataset.i = i;
        const on = i === idx;
        let tail = '';
        if (on && status === 'error') b.classList.add('err');
        else if (on && status === 'loading') tail = '<span class="mp-sp"></span>';
        else if (on && status === 'playing') tail = '<span class="mp-bars on"><i></i><i></i><i></i></span>';
        else if (on) tail = '<span class="mp-bars"><i></i><i></i><i></i></span>';
        b.innerHTML = '<span class="mp-n">' + (i + 1) + '</span><span class="mp-t"></span>' + tail;
        b.querySelector('.mp-t').textContent = on && status === 'error' ? '加载失败，点此重试' : t.title;
        b.onclick = () => { audio.uiClick(); if (i === idx && status === 'error') retry(); else if (i === idx && status !== 'idle' && status !== 'paused') { /* 已在播 */ } else playIndex(i); };
        listEl.appendChild(b);
      });
    }
    const playing = status === 'playing' || status === 'loading' && el && !el.paused;
    ppBtn.innerHTML = playing ? ICON.pause : ICON.play;
    ppBtn.classList.toggle('on', !!playing);
    root.querySelectorAll('.mp-b').forEach(b => { b.disabled = !tracks.length; });
    rng.disabled = false;
    if (document.activeElement !== rng) rng.value = Math.round(vol * 100);
    rng.style.setProperty('--p', Math.round(vol * 100) + '%');
  }
  listeners.push(render);

  q('.mp-x').onclick = () => { audio.uiClick(); closePanel(); };
  root.addEventListener('pointerdown', e => { if (e.target === root) closePanel(); });
  ppBtn.onclick = () => { audio.uiClick(); toggle(); };
  q('.mp-prev').onclick = () => { audio.uiClick(); prev(); };
  q('.mp-next').onclick = () => { audio.uiClick(); next(); };
  rng.addEventListener('input', () => { setVolume(rng.value / 100); });

  async function openPanel() {
    await init();
    render();
    root.classList.remove('hidden');
    requestAnimationFrame(() => root.classList.add('show'));
    audio.panelOpen();
    return new Promise(res => { openRes = res; });
  }
  function closePanel() {
    if (!openRes) return;
    root.classList.remove('show');
    setTimeout(() => root.classList.add('hidden'), 160);
    audio.panelClose();
    const r = openRes; openRes = null; r();
  }

  return {
    init, prime, startAuto, openPanel, closePanel, update, toggle, next, prev, playIndex, retry, setVolume,
    onChange: f => listeners.push(f),
    get tracks() { return tracks; }, get index() { return idx; }, get status() { return status; },
    get volume() { return vol; }, get level() { return level; }, get playing() { return status === 'playing'; },
    get isOpen() { return !!openRes; }, get gain() { return mg ? mg.gain.value : -1; }, get targetGain() { return lastGain; },
    get masterGain() { const b = audio.getBus(); return b ? b.master.gain.value : -1; },
    get currentTime() { return el ? el.currentTime : 0; }, get paused() { return el ? el.paused : true; },
    get requested() { return requested.slice(); }, get el() { return el; }, rootEl: root,
  };
}
