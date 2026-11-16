// 开场动画（约 12.5 秒，可跳过）：目标地图 -> 夜景公寓外立面推近 -> 白闪/黑场 -> 屋内落到门口 + 地图名称。
import * as audio from './audio.js';
import { view } from './controls.js';
import { PLAYER_START, EYE_H } from './world.js';

const T_MAP_END = 4.6;     // 地图段结束
const T_EXT_END = 9.0;     // 夜景结束（之后白闪）
const T_FLASH_END = 9.35;  // 白闪峰值，切到屋内
const T_DESC_START = 9.5, T_DESC_END = 12.0;
const T_NAME_IN = 10.2, T_NAME_OUT = 11.9, T_END = 12.6;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);

export function createIntro({ stage, world, content, onDone }) {
  const root = document.createElement('div'); root.className = 'intro hidden';
  const mapCv = document.createElement('canvas'); mapCv.className = 'intro-map';
  const scan = document.createElement('div'); scan.className = 'intro-scanlines';
  const tag = document.createElement('div'); tag.className = 'intro-tag';
  const fade = document.createElement('div'); fade.className = 'intro-fade';
  const name = document.createElement('div'); name.className = 'intro-mapname';
  const skip = document.createElement('button'); skip.className = 'intro-skip'; skip.textContent = '跳过 ›';
  root.append(mapCv, scan, tag, fade, name, skip);
  stage.appendChild(root);
  name.textContent = content.mapName;
  tag.textContent = '任务简报 // ' + content.codename;

  const state = { active: false, mode: 'none', t: 0, locked: false, whooshed: false, droned: false, switched: false, lastTypeT: 0 };

  // 地图装饰：用固定随机数生成道路与街区，保证每次一样
  const deco = (() => {
    let a = 12345; const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const roads = [], blocks = [];
    for (let i = 0; i < 7; i++) roads.push({ h: i % 2 === 0, p: 0.1 + r() * 0.8, w: 3 + r() * 5 });
    for (let i = 0; i < 40; i++) blocks.push({ x: r(), y: r(), w: 0.02 + r() * 0.05, h: 0.02 + r() * 0.06 });
    return { roads, blocks };
  })();

  function drawMap(t) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * view.scale;   // 舞台放大后画布按实际像素画
    const W = view.W, H = view.H;
    if (mapCv.width !== Math.round(W * dpr) || mapCv.height !== Math.round(H * dpr)) { mapCv.width = Math.round(W * dpr); mapCv.height = Math.round(H * dpr); }
    const g = mapCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#070d12'; g.fillRect(0, 0, W, H);
    // 街区与道路
    g.fillStyle = 'rgba(70,110,110,0.16)';
    deco.blocks.forEach(b => g.fillRect(b.x * W, b.y * H, b.w * W, b.h * H));
    g.strokeStyle = 'rgba(120,170,160,0.22)';
    deco.roads.forEach(r => { g.lineWidth = r.w; g.beginPath(); if (r.h) { g.moveTo(0, r.p * H); g.lineTo(W, r.p * H + 14); } else { g.moveTo(r.p * W, 0); g.lineTo(r.p * W - 18, H); } g.stroke(); });
    // 网格（缓慢漂移）
    const off = (t * 6) % 28;
    g.lineWidth = 1;
    for (let x = -28 + off; x < W; x += 28) { const major = Math.round((x - off) / 28) % 5 === 0; g.strokeStyle = major ? 'rgba(90,200,180,0.26)' : 'rgba(90,200,180,0.1)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = -28 + off; y < H; y += 28) { const major = Math.round((y - off) / 28) % 5 === 0; g.strokeStyle = major ? 'rgba(90,200,180,0.26)' : 'rgba(90,200,180,0.1)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // 扫描线光带
    const sy = ((t * 0.5) % 1) * (H + 80) - 40;
    const sg = g.createLinearGradient(0, sy - 40, 0, sy + 40); sg.addColorStop(0, 'rgba(90,220,190,0)'); sg.addColorStop(0.5, 'rgba(90,220,190,0.16)'); sg.addColorStop(1, 'rgba(90,220,190,0)');
    g.fillStyle = sg; g.fillRect(0, sy - 40, W, 80);
    // 目标标记：圆环收缩锁定
    const cx = W * 0.27, cy = H * 0.52;
    const k = clamp((t - 0.4) / 2.2, 0, 1), R = lerp(170, 26, easeOut(k));
    const locked = k >= 1;
    const col = locked ? '255,179,71' : '120,230,200';
    g.strokeStyle = 'rgba(' + col + ',0.95)'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(' + col + ',0.5)';
    g.beginPath(); g.arc(cx, cy, R * 1.5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - R * 1.9, cy); g.lineTo(cx - R * 0.5, cy); g.moveTo(cx + R * 0.5, cy); g.lineTo(cx + R * 1.9, cy);
    g.moveTo(cx, cy - R * 1.9); g.lineTo(cx, cy - R * 0.5); g.moveTo(cx, cy + R * 0.5); g.lineTo(cx, cy + R * 1.9); g.stroke();
    if (locked) {
      const pulse = 1 + ((t - 2.6) * 1.5 % 1) * 1.2;
      g.strokeStyle = 'rgba(255,179,71,' + (0.7 - (pulse - 1) * 0.5) + ')'; g.beginPath(); g.arc(cx, cy, 26 * pulse, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,179,71,1)'; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
      g.font = '12px sans-serif'; g.fillText('目标已锁定', cx + 36, cy - 30);
    }
    // 四角括号
    g.strokeStyle = 'rgba(120,230,200,0.6)'; g.lineWidth = 2;
    const m = 16, L = 22;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(c => { g.beginPath(); g.moveTo(c[0], c[1] + c[3] * L); g.lineTo(c[0], c[1]); g.lineTo(c[0] + c[2] * L, c[1]); g.stroke(); });
    return locked;
  }

  function setFade(color, a) { fade.style.background = color; fade.style.opacity = a; }

  function setInteriorCam(y, z, pitch) {
    const c = world.camera;
    c.position.set(PLAYER_START.x, y, z); c.rotation.set(pitch, PLAYER_START.yaw, 0);
  }

  function start() {
    state.active = true; state.t = 0; state.mode = 'none';
    state.locked = state.whooshed = state.droned = state.switched = false;
    root.classList.remove('hidden');
    name.style.opacity = 0;
    mapCv.style.display = ''; scan.style.display = ''; tag.style.display = '';
    setFade('#000', 0);
    skip.onclick = () => finish();
  }

  function finish() {
    if (!state.active) return;
    state.active = false; state.mode = 'none';
    audio.stopDrone(0.8);
    world.setGlow(0);
    root.classList.add('hidden');
    onDone();
  }

  function update(dt) {
    if (!state.active) return;
    const t = (state.t += dt);
    const ext = world.ext;

    if (t < T_MAP_END) {
      state.mode = 'none';
      const locked = drawMap(t);
      if (locked && !state.locked) { state.locked = true; audio.lockBeep(); }
      const f = t > T_MAP_END - 0.4 ? (t - (T_MAP_END - 0.4)) / 0.4 : (t < 0.4 ? 1 - t / 0.4 : 0);
      setFade('#000', clamp(f, 0, 1));
    } else if (t < T_FLASH_END) {
      if (state.mode !== 'exterior') {
        state.mode = 'exterior';
        mapCv.style.display = scan.style.display = tag.style.display = 'none';
      }
      if (!state.droned) { state.droned = true; audio.startDrone(); audio.whoosh(1.2); }
      const s = clamp((t - T_MAP_END) / (T_EXT_END - T_MAP_END), 0, 1), e = easeIO(s);
      const w = ext.winPos;
      ext.camera.position.set(lerp(6, w.x, e), lerp(2.2, w.y + 0.1, e), lerp(34, 6.2, e));
      ext.camera.lookAt(lerp(0, w.x, e), lerp(9, w.y, e), 0);
      ext.camera.rotation.z += Math.sin(t * 0.6) * 0.004;
      world.setGlow(0.35 + e * 0.5);
      if (!state.whooshed && t > T_EXT_END - 0.9) { state.whooshed = true; audio.whoosh(1.4); }
      if (t < T_MAP_END + 0.5) setFade('#000', 1 - (t - T_MAP_END) / 0.5);
      else if (t > T_EXT_END) setFade('#fff', clamp((t - T_EXT_END) / (T_FLASH_END - T_EXT_END), 0, 1));
      else setFade('#000', 0);
    } else if (t < T_END) {
      if (!state.switched) { state.switched = true; state.mode = 'interior'; world.setGlow(0); audio.stopDrone(1.5); audio.flashHit(); }
      // 白闪 -> 黑场 -> 淡入
      if (t < T_DESC_START) setFade(t < T_FLASH_END + 0.08 ? '#fff' : '#000', t < T_FLASH_END + 0.08 ? 1 : 1);
      else setFade('#000', clamp(1 - (t - T_DESC_START) / 0.7, 0, 1));
      const k = clamp((t - T_DESC_START) / (T_DESC_END - T_DESC_START), 0, 1), e = easeOut(k);
      setInteriorCam(lerp(2.45, EYE_H, e), lerp(PLAYER_START.z + 0.5, PLAYER_START.z, e), lerp(-0.7, PLAYER_START.pitch, e));
      let a = 0;
      if (t >= T_NAME_IN && t < T_NAME_OUT) a = clamp((t - T_NAME_IN) / 0.5, 0, 1);
      else if (t >= T_NAME_OUT) a = clamp(1 - (t - T_NAME_OUT) / 0.6, 0, 1);
      name.style.opacity = a; name.style.transform = 'scale(' + (1 + (1 - a) * 0.06) + ')';
    } else {
      finish();
    }
  }

  return { start, update, finish, get active() { return state.active; }, get mode() { return state.mode; }, get time() { return state.t; } };
}
