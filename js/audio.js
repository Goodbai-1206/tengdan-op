// 全部音效用 WebAudio 现场合成，不使用任何音频文件。
// 所有函数在 AudioContext 未解锁时静默返回。

let ctx = null, master = null, noiseBuf = null;
let muted = false;   // 封面的声音开关；解锁前先记着，解锁后生效
let drone = null;

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* 静默 */ }
}

// 封面声音开关：静音只把总音量拉到 0
export function setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.85; }
export function isMuted() { return muted; }

// 测试用：把音效接到一个 OfflineAudioContext 上离线渲染成波形
export function _attachOffline(c) {
  ctx = c;
  master = ctx.createGain(); master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6;
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// 给音乐模块用：把 <audio> 元素接进同一条总线（总音量/静音/压缩器共用）
export function getBus() { return ctx && ctx.state !== 'closed' ? { ctx, master } : null; }

const ok = () => !!ctx && ctx.state !== 'closed';
const now = () => ctx.currentTime;
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// 测试用：记录每个发声体的开始时刻和每次显形声的时刻，用来断言「没有持续声、每件只响一次」
export const _log = { reveals: [], voices: [] };
function tone(o) {
  const t0 = (o.t || 0) + now(); _log.voices.push(t0);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
  const a = o.attack || 0.005, peak = o.gain == null ? 0.2 : o.gain;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  let out = g;
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
  out.connect(master);
  osc.start(t0); osc.stop(t0 + o.dur + 0.05);
}

// 噪声：经滤波器，可扫频
function noise(o) {
  const t0 = (o.t || 0) + now(); _log.voices.push(t0);
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.ftype || 'lowpass';
  f.frequency.setValueAtTime(o.f, t0);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
  f.Q.value = o.q || 0.7;
  const g = ctx.createGain(); const a = o.attack || 0.005, peak = o.gain == null ? 0.2 : o.gain;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 1.5); src.stop(t0 + o.dur + 0.05);
}

// ---------- 界面与开场 ----------
export function uiClick() { if (!ok()) return; tone({ f: 900, f2: 600, dur: 0.07, type: 'square', gain: 0.06 }); }
export function typeTick() {
  if (!ok()) return;
  noise({ f: 3500, ftype: 'highpass', dur: 0.03, gain: 0.07 });
  tone({ f: 1700 + Math.random() * 300, dur: 0.02, type: 'square', gain: 0.03 });
}
export function lockBeep() {
  if (!ok()) return;
  tone({ f: 1100, dur: 0.09, type: 'square', gain: 0.07 });
  tone({ t: 0.12, f: 1650, dur: 0.22, type: 'square', gain: 0.08 });
}
export function whoosh(dur = 1.4) {
  if (!ok()) return;
  noise({ f: 250, f2: 2400, ftype: 'bandpass', q: 1.2, dur: dur * 0.55, attack: dur * 0.4, gain: 0.35 });
  noise({ t: dur * 0.5, f: 2400, f2: 220, ftype: 'bandpass', q: 1.2, dur: dur * 0.6, attack: 0.02, gain: 0.28 });
}
export function startDrone() {
  if (!ok() || drone) return;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.22, now() + 1.5);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const oscs = [55, 82.41, 110.3].map((f, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = i === 0 ? 1 : 0.35; o.connect(og); og.connect(lp); o.start(); return o;
  });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18;
  const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  lp.connect(g); g.connect(master);
  drone = { g, oscs: oscs.concat([lfo]) };
}
export function stopDrone(fade = 1.2) {
  if (!drone || !ok()) { drone = null; return; }
  const d = drone; drone = null;
  d.g.gain.cancelScheduledValues(now());
  d.g.gain.setValueAtTime(Math.max(d.g.gain.value, 0.0001), now());
  d.g.gain.exponentialRampToValueAtTime(0.0001, now() + fade);
  setTimeout(() => d.oscs.forEach(o => { try { o.stop(); } catch (e) { /* */ } }), fade * 1000 + 100);
}
export function flashHit() {
  if (!ok()) return;
  noise({ f: 6000, f2: 800, ftype: 'highpass', dur: 0.5, gain: 0.25 });
  tone({ f: 90, f2: 40, dur: 0.6, gain: 0.35 });
}

// ---------- 探索 ----------
let stepFlip = false;
export function footstep() {
  if (!ok()) return;
  stepFlip = !stepFlip;
  const r = 0.85 + Math.random() * 0.3;
  noise({ f: 520 * r, f2: 180, dur: 0.09, gain: 0.16 });
  tone({ f: (stepFlip ? 95 : 80) * r, f2: 45, dur: 0.1, gain: 0.2 });
}
export function drawerOpen() {
  if (!ok()) return;
  noise({ f: 700, f2: 1500, ftype: 'bandpass', q: 2.5, dur: 0.42, attack: 0.08, gain: 0.14 });
  noise({ t: 0.4, f: 300, dur: 0.1, gain: 0.22 });
  tone({ t: 0.4, f: 120, f2: 60, dur: 0.14, gain: 0.25 });
}
export function wardrobeOpen() {
  if (!ok()) return;
  tone({ f: 190, f2: 130, dur: 0.6, type: 'sawtooth', gain: 0.05, attack: 0.1 });
  tone({ t: 0.05, f: 233, f2: 160, dur: 0.55, type: 'sawtooth', gain: 0.035, attack: 0.1 });
  noise({ f: 900, ftype: 'bandpass', q: 3, dur: 0.6, attack: 0.15, gain: 0.07 });
  noise({ t: 0.62, f: 260, dur: 0.12, gain: 0.2 });
  tone({ t: 0.62, f: 100, f2: 55, dur: 0.16, gain: 0.25 });
}
export function chestOpen() {
  if (!ok()) return;
  noise({ f: 1800, ftype: 'highpass', dur: 0.06, gain: 0.12 });              // 锁扣
  tone({ t: 0.05, f: 160, f2: 360, dur: 0.55, type: 'sawtooth', gain: 0.045, attack: 0.1 }); // 合页吱呀
  noise({ t: 0.3, f: 500, f2: 200, dur: 0.35, gain: 0.1 });
  tone({ t: 0.6, f: 110, f2: 55, dur: 0.18, gain: 0.25 });
}

// 开场：门锁「咔哒」+ 门轴吱呀（同样现场合成）
export function doorUnlock() {
  if (!ok()) return;
  noise({ f: 2600, ftype: 'highpass', dur: 0.05, attack: 0.002, gain: 0.2 });
  tone({ t: 0.0, f: 1300, f2: 800, dur: 0.05, type: 'square', gain: 0.05 });
  noise({ t: 0.11, f: 3200, ftype: 'highpass', dur: 0.04, attack: 0.002, gain: 0.16 });   // 锁舌回弹
  tone({ t: 0.11, f: 220, f2: 130, dur: 0.08, gain: 0.18 });
}
export function doorSwing() {
  if (!ok()) return;
  tone({ t: 0.05, f: 150, f2: 330, dur: 1.2, type: 'sawtooth', gain: 0.04, attack: 0.3 });   // 门轴吱呀
  tone({ t: 0.25, f: 210, f2: 120, dur: 0.9, type: 'sawtooth', gain: 0.025, attack: 0.3 });
  noise({ f: 700, f2: 300, ftype: 'bandpass', q: 2, dur: 1.4, attack: 0.4, gain: 0.05 });
  noise({ t: 1.45, f: 260, dur: 0.12, gain: 0.12 });                                        // 门挡到位的闷响
}

// ---------- 搜索与背包（按 _ref/loot_spec.md 第 9 节） ----------
// 显形声：噪声 + 短音调的复合"咔嗒 + 闷响"，约 0.22s；金色同样的开头但尾巴拖到约 0.55s。
// 搜索过程中没有循环声，只有显形那一下。
function clack(g, tail) {
  noise({ f: 7500, ftype: 'bandpass', q: 0.5, dur: 0.09, attack: 0.003, gain: 0.2 * g });            // 起音：宽带脉冲
  noise({ t: 0.03, f: 7500, ftype: 'bandpass', q: 0.5, dur: 0.06, attack: 0.003, gain: 0.1 * g });    // 第二小峰
  noise({ t: 0.06, f: 1500, ftype: 'bandpass', q: 0.6, dur: 0.1, attack: 0.01, gain: 0.08 * g });     // 主体
  tone({ f: 140, f2: 110, dur: tail ? 0.6 : 0.26, attack: 0.07, gain: (tail ? 0.14 : 0.19) * g });    // 低频闷响（能量主体）
  tone({ t: 0.04, f: 2756, dur: tail ? 0.7 : 0.34, attack: 0.004, gain: 0.05 * g });                   // 2756Hz 细线，音高不变
  if (tail === 'gold' || tail === 'red') noise({ t: 0.05, f: 6000, ftype: 'highpass', dur: tail === 'red' ? 1.0 : 0.9, attack: 0.02, gain: 0.07 * g });
  if (tail === 'blue') noise({ t: 0.05, f: 6000, ftype: 'highpass', dur: 0.35, attack: 0.02, gain: 0.05 * g });
}
export function revealSfx(rarity) {
  if (!ok()) return;
  _log.reveals.push(now());
  switch (rarity) {
    case 'green': clack(0.8); break;
    case 'blue': clack(1, 'blue'); break;
    case 'gold': clack(0.85, 'gold'); break;
    case 'red': clack(0.85, 'red'); break;
    default: clack(1);
  }
}

// 界面类都很轻（比显形声低 15~25dB）
export function panelOpen() { if (!ok()) return; noise({ f: 1500, f2: 5000, ftype: 'bandpass', q: 0.7, dur: 0.3, attack: 0.07, gain: 0.07 }); }
export function panelClose() { if (!ok()) return; noise({ f: 5000, f2: 1500, ftype: 'bandpass', q: 0.7, dur: 0.12, attack: 0.04, gain: 0.05 }); }
export function tapClick() { if (!ok()) return; noise({ f: 2500, ftype: 'highpass', dur: 0.04, attack: 0.002, gain: 0.2 }); }
export function putIn() {
  if (!ok()) return;
  noise({ f: 2500, ftype: 'highpass', dur: 0.04, attack: 0.002, gain: 0.2 });
  noise({ t: 0.03, f: 1000, f2: 5000, ftype: 'bandpass', q: 1, dur: 0.1, attack: 0.03, gain: 0.07 });
}
export function dragStart() { if (!ok()) return; noise({ f: 2000, f2: 5500, ftype: 'bandpass', q: 0.8, dur: 0.38, attack: 0.08, gain: 0.09 }); }
export function dropClick() { if (!ok()) return; noise({ f: 2500, ftype: 'highpass', dur: 0.03, attack: 0.002, gain: 0.1 }); }

// 13/13 提示音：两声轻轻的上行铃音
export function exitCue() { if (!ok()) return; tone({ f: midi(76), dur: 0.5, type: 'sine', gain: 0.07, attack: 0.005 }); tone({ t: 0.16, f: midi(83), dur: 0.7, type: 'sine', gain: 0.06, attack: 0.005 }); }

function chord(notes, t, dur, type, gain, spread = 0.06) {
  notes.forEach((n, i) => tone({ t: t + i * spread, f: midi(n), dur, type, gain, attack: 0.01 }));
}

// ---------- 结算 ----------
export function settle() {
  if (!ok()) return;
  // 暖和弦 Cmaj7 -> Fmaj7 -> G -> C，加亮闪琶音
  chord([60, 64, 67, 71], 0, 1.8, 'triangle', 0.09, 0.05);
  chord([36], 0, 1.8, 'sine', 0.25, 0);
  chord([65, 69, 72, 76], 1.2, 1.8, 'triangle', 0.08, 0.05);
  chord([67, 71, 74, 79], 2.4, 1.6, 'triangle', 0.08, 0.05);
  chord([72, 76, 79, 84], 3.4, 3.2, 'triangle', 0.1, 0.06);
  chord([48], 3.4, 3.2, 'sine', 0.3, 0);
  [84, 88, 91, 96, 91, 88, 84].forEach((n, i) => tone({ t: 3.5 + i * 0.12, f: midi(n), dur: 0.5, type: 'sine', gain: 0.06 }));
  noise({ f: 2500, ftype: 'highpass', dur: 0.4, gain: 0.12 }); // 彩纸"噗"
}

