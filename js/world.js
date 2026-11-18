// 3D 场景：烘焙写实房间（Blender 烘好的光照贴图 + glb）、三个容器的开启动画、容器标记。
// 坐标：x 向东，y 向上，z 向南；房间 x 在 [-2.75, 2.75]，z 在 [-2.25, 2.25]，层高 2.7。门在南墙（x=0.6）。
// 相机 yaw=0 时朝 -z（朝北，衣柜方向）。
// 容器对应：desk=沙发上的衣服堆，wardrobe=衣柜（东侧一对门），chest=床头柜抽屉。
import * as THREE from '../lib/three.module.js';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { diag, showFatal } from './diag.js';

export const ROOM = { x0: -2.75, x1: 2.75, z0: -2.25, z1: 2.25, h: 2.7 };
export const PLAYER_R = 0.2;   // 床尾与沙发之间的缝只有约 0.48m，半径 0.26 会把整个北半屋隔成孤岛
export const EYE_H = 1.6;
export const PLAYER_START = { x: -2.15, z: 1.4, yaw: -0.85, pitch: 0 };   // 西墙门内，朝东北看向房间中央（床一角、衣柜、沙发、窗同时入画）

export const EXIT_POINT = { x: -2.43, z: 1.4, r: 1.0 };   // 门垫中心（门内侧）；半径内可点「撤离」

const ASSET_BASE = 'assets/room/';

// xz 平面矩形碰撞盒 [minx, minz, maxx, maxz]，按家具实际占地
export const COLLIDERS = [
  [-4, -3.25, -2.75, 3.25], [2.75, -3.25, 4, 3.25], [-4, -3.25, 4, -2.25], [-4, 2.25, 4, 3.25], // 四面墙外侧
  [-2.15, -2.25, -0.55, -0.42],      // 双人床（AI 模型：宽 1.6、长 1.8）
  [-2.725, -2.17, -2.275, -1.77],    // 床头柜（AI 模型：0.45 x 0.4）
  [0.3, -2.25, 2.3, -1.65],          // 衣柜
  [2.095, -1.0, 2.745, 0.6],         // 书桌
  [1.43, -0.67, 1.97, -0.13],        // 办公椅
  [-0.2, 0.30, 1.6, 1.30],           // 沙发（AI 模型：1.8 x 1.0）
  [-0.775, 0.525, -0.325, 0.975],    // 边几
  [2.18, 1.23, 2.62, 1.67],          // 落地灯
];

// 房门(西墙靠南，合页在南侧)开足后的门板：从合页向东伸出的一条薄板，贴着南墙一侧，进屋后加入碰撞
export const DOOR_OPEN_COLLIDER = [-2.78, 1.79, -1.9, 1.86];
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const RAD = Math.PI / 180;

// ---------- 小工具 ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTex(w, h, draw, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opt.repeat[0], opt.repeat[1]); }
  return t;
}
function glowTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,140,1)'); gr.addColorStop(0.3, 'rgba(255,180,90,0.45)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
const FACADE = { cols: 7, rows: 9, cell: 2, w: 14, h: 18, lit: { c: 3, r: 5 } };
function facadeTex() {
  const cw = 146, ch = 142;
  return canvasTex(cw * FACADE.cols, ch * FACADE.rows, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1b2234'); gr.addColorStop(1, '#262c3c'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let y = 0; y < FACADE.rows; y++) for (let x = 0; x < FACADE.cols; x++) {
      const px = x * cw + 22, py = y * ch + 22, ww = cw - 44, hh = ch - 44;
      const lit = x === FACADE.lit.c && y === FACADE.lit.r;
      const faint = (x === 1 && y === 2) || (x === 5 && y === 7);
      g.fillStyle = '#10151f'; g.fillRect(px - 6, py - 6, ww + 12, hh + 12);
      if (lit) {
        const wg = g.createLinearGradient(0, py, 0, py + hh); wg.addColorStop(0, '#ffe3a0'); wg.addColorStop(1, '#ffb450');
        g.fillStyle = wg; g.fillRect(px, py, ww, hh);
        g.fillStyle = 'rgba(160,70,40,0.55)'; g.fillRect(px, py, 16, hh); g.fillRect(px + ww - 16, py, 16, hh); // 窗帘
        g.fillStyle = 'rgba(120,60,20,0.5)'; g.fillRect(px + ww * 0.35, py + hh * 0.55, ww * 0.3, hh * 0.45); // 家具剪影
        g.fillStyle = '#fff1c4'; g.beginPath(); g.arc(px + ww * 0.75, py + hh * 0.3, 7, 0, 7); g.fill();
      } else {
        const v = 14 + ((r() * 8) | 0);
        g.fillStyle = faint ? '#27384f' : 'rgb(' + v + ',' + (v + 6) + ',' + (v + 20) + ')'; g.fillRect(px, py, ww, hh);
        g.fillStyle = 'rgba(120,150,200,0.07)'; g.fillRect(px, py, ww * 0.5, hh * 0.35);
      }
      g.fillStyle = '#10151f'; g.fillRect(px + ww / 2 - 1.5, py, 3, hh);
    }
    for (let y = 0; y <= FACADE.rows; y++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y * ch - 4, w, 6); }
  });
}
function skyTex() {
  return canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#050914'); gr.addColorStop(0.65, '#12204a'); gr.addColorStop(1, '#2b3a6b'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = rng(21);
    for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.25 + r() * 0.7) + ')'; const s = r() > 0.9 ? 2.5 : 1.3; g.fillRect(r() * w, r() * h * 0.7, s, s); }
    g.fillStyle = '#f4efd8'; g.beginPath(); g.arc(w * 0.82, h * 0.2, 20, 0, 7); g.fill();
    g.fillStyle = 'rgba(244,239,216,0.12)'; g.beginPath(); g.arc(w * 0.82, h * 0.2, 50, 0, 7); g.fill();
  });
}

// ---------- 反光用的小环境贴图：窗户亮块 + 几盏灯，只用来给皮面/金属一点随视角变化的高光 ----------
function envTex() {
  const t = canvasTex(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#8d8576'); gr.addColorStop(0.5, '#6e6556'); gr.addColorStop(1, '#33291d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const blob = (x, y, r, col) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, col); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); };
    g.fillStyle = '#ffffff'; g.fillRect(114, 48, 22, 20);                 // 东墙窗
    blob(125, 58, 26, 'rgba(255,255,255,0.7)');
    blob(27, 68, 14, 'rgba(255,214,150,1)');                               // 床头灯
    blob(218, 66, 12, 'rgba(255,214,150,1)');                              // 边几灯
    blob(150, 60, 14, 'rgba(255,220,160,1)');                              // 落地灯
    g.fillStyle = 'rgba(255,238,200,0.95)'; g.fillRect(0, 0, w, 10);        // 顶灯
  });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// ---------- 室外夜景（旧开场用，按需才建，当前流程不用）----------
function buildExt(W, H) {
  const ext = new THREE.Scene();
  ext.background = new THREE.Color(0x070b18);
  ext.fog = new THREE.Fog(0x0a1124, 25, 70);
  const extCam = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 16, 12), new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false }));
  sky.position.y = 10; ext.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x0b1020 }));
  ground.rotation.x = -Math.PI / 2; ext.add(ground);
  const facadeMat = new THREE.MeshBasicMaterial({ map: facadeTex() }), darkMat = new THREE.MeshBasicMaterial({ color: 0x111726 });
  const bld = new THREE.Mesh(new THREE.BoxGeometry(FACADE.w, FACADE.h, 10), [darkMat, darkMat, darkMat, darkMat, facadeMat, darkMat]);
  bld.position.set(0, FACADE.h / 2, -5); ext.add(bld);
  const sideMat = new THREE.MeshBasicMaterial({ color: 0x0e1424 });
  [[-12, 13, 9], [13, 10, 8], [-22, 20, 10], [24, 16, 9], [-8, 8, 6]].forEach((b, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b[2] + 4, b[1], 8), sideMat);
    m.position.set(b[0], b[1] / 2, -6 - (i % 2) * 6); ext.add(m);
  });
  const lw = FACADE.lit;
  const winPos = new THREE.Vector3(-FACADE.w / 2 + (lw.c + 0.5) * FACADE.cell, FACADE.h - (lw.r + 0.5) * FACADE.cell, 0.02);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.0, fog: false }));
  glow.position.copy(winPos); glow.position.z += 0.4; ext.add(glow);
  return { scene: ext, camera: extCam, winPos, glow };
}

// ---------- 下载（带进度、可重试）----------
const Q0 = new URLSearchParams(location.search);
const STALL_MS = Number(Q0.get('stall')) || 20000;   // 单个文件这么久没收到新数据就中止重下（测试时可用 ?stall=毫秒 缩短）
const TRIES = 3, BACKOFF = [800, 2500];
const fileCache = new Map();   // 下载成功或进行中的文件：文件名 -> Promise<ArrayBuffer>；失败的会被清掉，重试时重新下
const wait = ms => new Promise(r => setTimeout(r, ms));
const shortName = u => String(u).split('/').pop();
async function fetchOnce(url, onBytes) {
  const ac = new AbortController(); let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), STALL_MS); };
  try {
    arm();
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    arm();
    if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); onBytes(b.byteLength); return b; }
    const reader = r.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(); chunks.push(value); got += value.length; onBytes(got);
    }
    const buf = new Uint8Array(got); let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return buf.buffer;
  } catch (e) {
    if (ac.signal.aborted) throw new Error(Math.round(STALL_MS / 1000) + ' 秒没有收到新数据');
    throw e;
  } finally { clearTimeout(timer); }
}
async function fetchBytes(url, size, onBytes) {
  const name = shortName(url); let last;
  for (let a = 1; a <= TRIES; a++) {
    onBytes(0);   // 重试时该文件的进度先归零再涨
    try {
      diag('下载 ' + name + ' 第' + a + '次');
      const b = await fetchOnce(url, onBytes);
      onBytes(size || b.byteLength);
      diag('完成 ' + name + ' ' + b.byteLength + 'B');
      return b;
    } catch (e) {
      last = e; diag('失败 ' + name + ' 第' + a + '次：' + (e && e.message));
      if (a < TRIES) await wait(BACKOFF[a - 1]);
    }
  }
  onBytes(0);
  const err = new Error(name + '：' + (last && last.message)); err.file = name; err.reason = String(last && last.message); throw err;
}
function getBytes(url, size, onBytes) {
  if (!fileCache.has(url)) {
    const p = fetchBytes(url, size, onBytes);
    fileCache.set(url, p); p.catch(() => { if (fileCache.get(url) === p) fileCache.delete(url); });
  }
  return fileCache.get(url);
}
// 带选项的 createImageBitmap 在旧版 iOS Safari 上会直接抛错：先探一次，不行就走 <img> 解码，翻转方向与原来保持一致
let bitmapOptsOk = null;
async function probeBitmapOpts() {
  if (bitmapOptsOk !== null) return bitmapOptsOk;
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('无 createImageBitmap');
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await createImageBitmap(c, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    if (b.close) b.close();
    bitmapOptsOk = true;
  } catch (e) { bitmapOptsOk = false; diag('createImageBitmap 带选项不可用：' + (e && e.message) + '，改用 <img> 解码'); }
  return bitmapOptsOk;
}
async function decodeImage(buf, flipY, name) {
  const blob = new Blob([buf], { type: 'image/jpeg' });
  if (await probeBitmapOpts()) {
    try { const bmp = await createImageBitmap(blob, { imageOrientation: flipY ? 'flipY' : 'none', premultiplyAlpha: 'none' }); diag('解码 ' + name + ' bitmap'); return bmp; }
    catch (e) { diag('bitmap 解码失败 ' + name + '：' + (e && e.message) + '，改用 <img>'); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('图片解码失败')); im.src = url; });
    diag('解码 ' + name + ' img' + (flipY ? '+翻转' : ''));
    if (!flipY) return im;
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const g = cv.getContext('2d'); g.translate(0, cv.height); g.scale(1, -1); g.drawImage(im, 0, 0);
    return cv;
  } finally { URL.revokeObjectURL(url); }
}
async function loadTex(renderer, file, size, onBytes, { srgb = true, flipY = false, equirect = false } = {}) {
  const buf = await getBytes(ASSET_BASE + file, size, onBytes);
  let bmp;
  try { bmp = await decodeImage(buf, flipY, file); }
  catch (e) { fileCache.delete(ASSET_BASE + file); const err = new Error(file + '：' + (e && e.message)); err.file = file; err.reason = String(e && e.message); throw err; }
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (equirect) { t.mapping = THREE.EquirectangularReflectionMapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.needsUpdate = true;
  return t;
}

// ---------- 世界 ----------
export function createWorld(host, W, H) {
  const Q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const ROOM_EXPOSURE = Number(Q.get('exp') || 1.9);   // Blender 曝光 +0.8 档
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(62, W / H, 0.03, 50);
  camera.rotation.order = 'YXZ';
  camera.position.set(PLAYER_START.x, EYE_H, PLAYER_START.z);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120d09);

  // ===== 容器与标记 =====
  const markerGeo = new THREE.OctahedronGeometry(0.115, 0); markerGeo.scale(1, 1.5, 1);
  const edgeGeo = new THREE.EdgesGeometry(markerGeo);
  function makeMarker(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.95, toneMapped: false }));
    const e = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false }));
    g.add(m, e); g.visible = false; scene.add(g); return { g, m, e, baseY: y };
  }

  // 活动部件（加载完才有）
  const parts = {}, closed = {};
  const rot = (n, axis, deg, p) => { const o = parts[n]; if (o) o.rotation[axis] = closed[n].r[axis] + deg * RAD * p; };
  const containers = {
    // 衣服堆：绕南侧边掀开约 100 度
    desk: {
      id: 'desk', access: { x: 1.22, z: 1.05 }, stand: { x: 1.2, z: 1.95, yaw: 0, pitch: -0.82 },
      marker: makeMarker(1.22, 1.05, 1.0), dur: 0.7, p: 0, dir: 0, searched: false,
      // 翻开：最上面的卫衣南端被掀起、甩到靠背上；针织衫被拨到一边（向西南滑开）
      apply(p) {
        const e = easeOut(p);
        rot('clothes_top', 'x', -66, e);
        const k = parts.clothes_knit; if (k) { k.position.x = closed.clothes_knit.p.x - 0.28 * e; k.position.z = closed.clothes_knit.p.z + 0.12 * e; }
      },
    },
    // 衣柜东侧一对门：各自绕外侧合页向外开约 95 度
    wardrobe: {
      id: 'wardrobe', access: { x: 1.8, z: -1.65 }, stand: { x: 0.95, z: -0.3, yaw: -0.56, pitch: -0.3 },
      marker: makeMarker(1.8, 2.5, -1.95), dur: 0.8, p: 0, dir: 0, searched: false,
      apply(p) { const e = ease(p); rot('wd_door_b_l', 'y', -95, e); rot('wd_door_b_r', 'y', 95, e); },
    },
    // 床头柜抽屉：朝南拉出约 0.3m
    chest: {
      id: 'chest', access: { x: -2.5, z: -1.55 }, stand: { x: -2.5, z: -0.5, yaw: 0, pitch: -0.78 },
      marker: makeMarker(-2.5, 1.2, -1.95), dur: 0.55, p: 0, dir: 0, searched: false,
      apply(p) { const o = parts.nightstand_drawer; if (o) o.position.z = closed.nightstand_drawer.p.z + 0.3 * easeOut(p); },
    },
  };
  const doorOpenU = { value: 0 };   // 走廊图集光照图混合：0 关门版 / 1 开门版
  let expMul = 1;
  // 房门：p 开门进度 0..1（绕合页向屋内转 95 度）；press 把手下压 0..1
  const door = {
    p: 0,
    set(p) { this.p = p; const o = parts.door_slab; if (o) o.rotation.y = closed.door_slab.r.y - 95 * RAD * p; doorOpenU.value = p; },
    press(q) { const o = parts.door_lever_o; if (o) o.rotation.x = closedLever.x + 0.6 * q; },
  };
  let closedLever = { x: 0 };
  const waiters = [];
  function open(id) {
    const c = containers[id];
    if (c.p >= 1) return Promise.resolve();   // 已经打开：直接放行
    c.dir = 1;
    return new Promise(res => waiters.push({ c, res }));
  }
  function markSearched(id) {
    const c = containers[id]; c.searched = true;
    c.marker.m.material.color.set(0x8a8a8a); c.marker.m.material.opacity = 0.55; c.marker.e.material.opacity = 0.35;
    c.marker.g.scale.set(0.8, 0.8, 0.8);
  }
  // 悬浮菱形标记已取消（改为准星对准描边）：接口保留，但永远不显示
  function setMarkersVisible(v) { Object.values(containers).forEach(c => { c.marker.g.visible = false; }); }

  // ===== 准星对准描边：遮罩描边（把目标网格以纯白画进半分辨率的离屏遮罩，后期里取遮罩边缘外扩 2~3px 输出白边；只在有目标时才画遮罩）=====
  // 描边对象：整件家具的外轮廓（衣柜 = 全部柜门和柜体，床头柜 = 柜体 + 抽屉面板，衣服堆 = 三块衣服）；被别的物体挡住的部分不进遮罩
  const AIM_PARTS = { desk: ['clothes_top', 'clothes_base', 'clothes_knit'], wardrobe: ['wd_door_b_l', 'wd_door_b_r', 'ai_wardrobe'], chest: ['nightstand_drawer', 'ns_ai_body'], speaker: ['speaker_mini'] };
  const speakerLed = { mat: null, on: null, lit: false, pulse: 0 };
  const outlines = {};            // id -> { a, target, hint, dim }
  const aimMeshes = [];           // 被射线检测的原网格
  const maskClones = {};          // id -> [{ src, clone }]
  const maskScene = new THREE.Scene();
  const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false, depthFunc: THREE.LessEqualDepth });
  const occMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });   // 遮罩前的深度预渲染：整个房间只写深度，用来挡住藏在柜体里面的部分
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  let maskRT = null;
  function buildOutlines() {
    for (const id in AIM_PARTS) {
      outlines[id] = { a: 0, target: 0, hint: 0, dim: false };
      maskClones[id] = [];
      for (const n of AIM_PARTS[id]) {
        const part = parts[n]; if (!part) continue;
        const list = []; part.traverse(x => { if (x.isMesh) list.push(x); });
        list.forEach(mesh => {
          mesh.userData.aimId = id; aimMeshes.push(mesh);
          const clone = new THREE.Mesh(mesh.geometry, maskMat);
          clone.matrixAutoUpdate = false; clone.matrixWorldAutoUpdate = false; clone.frustumCulled = false; clone.visible = false;
          maskScene.add(clone); maskClones[id].push({ src: mesh, clone });
        });
      }
    }
    // 衣服堆、衣柜、床头柜：各加一个包住整件的看不见的命中盒（只参与对准射线，不画、不进描边遮罩），
    // 免得准星刚好落在布料网格的缝里、或抽屉缝上时对不中
    for (const id of ['desk', 'wardrobe', 'chest']) {
      const bb = new THREE.Box3(); let any = false;
      for (const n of AIM_PARTS[id]) { const part = parts[n]; if (!part) continue; part.updateMatrixWorld(true); bb.expandByObject(part); any = true; }
      if (!any) continue;
      bb.expandByScalar(0.03);
      const sz = bb.getSize(new THREE.Vector3()), ct = bb.getCenter(new THREE.Vector3());
      const px = new THREE.Mesh(new THREE.BoxGeometry(sz.x, sz.y, sz.z), new THREE.MeshBasicMaterial({ visible: false }));
      px.position.copy(ct); px.updateMatrixWorld(true); px.userData.aimId = id; px.userData.noOcc = true; px.name = 'aimproxy_' + id; scene.add(px); aimMeshes.push(px);
    }
    // 音响只有 9 厘米宽：加一个看不见的略大的射线命中盒，准星不用瞄得那么准（只参与射线，不画、不进遮罩）
    if (parts.speaker_mini) {
      const px = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
      parts.speaker_mini.getWorldPosition(px.position); px.position.y += 0.04;
      px.updateMatrixWorld(true); px.userData.aimId = 'speaker'; px.userData.noOcc = true; scene.add(px); aimMeshes.push(px);
    }
  }
  // 音响：随节拍微缩放（底面不动）、指示灯只在播放时亮
  function setSpeaker(playing, level) {
    const o = parts.speaker_mini;
    if (o) { const k = 1 + 0.018 * (playing ? level : 0); o.scale.set(k, k, k); }
    if (speakerLed.mat && speakerLed.lit !== !!playing) { speakerLed.lit = !!playing; speakerLed.mat.color.copy(playing ? speakerLed.on : new THREE.Color(0.05, 0.1, 0.07)); }
  }
  // 从屏幕 NDC 点发射线：命中可搜索容器且距离在 maxDist 内 -> { id, dist }
  function pickAt(nx, ny, maxDist) {
    if (!aimMeshes.length) return null;
    _ndc.set(nx, ny);
    raycaster.setFromCamera(_ndc, camera);
    raycaster.far = maxDist;
    const hit = raycaster.intersectObjects(aimMeshes, false)[0];
    return hit ? { id: hit.object.userData.aimId, dist: hit.distance } : null;
  }
  function setAim(id, dim) { for (const k in outlines) { outlines[k].target = k === id ? 1 : 0; if (k === id) outlines[k].dim = !!dim; } }
  function setHint(id, v) { if (outlines[id]) outlines[id].hint = v; }
  function outlineAlpha(id) { const o = outlines[id]; return o ? Math.max(o.a * (o.dim ? 0.55 : 1), o.hint) : 0; }
  function updateOutlines(dt) {
    for (const id in outlines) {
      const o = outlines[id];
      o.a += Math.sign(o.target - o.a) * Math.min(Math.abs(o.target - o.a), dt / 0.12);
    }
  }
  // 画遮罩：只画当前最亮的那个容器；返回 { alpha, dim } 或 null（没有目标时完全跳过这一步）
  function renderMask(size) {
    let best = null, ba = 0.01;
    for (const id in outlines) { const al = outlineAlpha(id); if (al > ba) { ba = al; best = id; } }
    if (!best) return null;
    if (!maskRT || maskRT.width !== Math.max(2, size.x) || maskRT.height !== Math.max(2, size.y)) {
      if (maskRT) maskRT.dispose();
      maskRT = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { depthBuffer: true, samples: 4 });   // 全分辨率 + 4 倍多重采样：斜边不出台阶
      postMat.uniforms.tMask.value = maskRT.texture;
    }
    for (const id in maskClones) for (const m of maskClones[id]) {
      const on = id === best;
      m.clone.visible = on;
      if (on) { m.src.updateWorldMatrix(true, false); m.clone.matrix.copy(m.src.matrixWorld); m.clone.matrixWorld.copy(m.src.matrixWorld); }
    }
    renderer.setRenderTarget(maskRT); renderer.clear();
    const ac = renderer.autoClear; renderer.autoClear = false;
    const bgSave = scene.background, hidden = [];
    scene.traverse(o => { if (o.userData.noOcc && o.visible) { o.visible = false; hidden.push(o); } });   // 光晕、窗外夜景、地面暗斑不参与遮挡
    scene.background = null; scene.overrideMaterial = occMat;
    renderer.render(scene, camera);
    scene.overrideMaterial = null; scene.background = bgSave; hidden.forEach(o => { o.visible = true; });
    renderer.render(maskScene, camera);
    renderer.autoClear = ac; renderer.setRenderTarget(null);
    return { alpha: ba, dim: outlines[best].dim };
  }

  // 楼梯口：平台南沿的竖面在烘焙导出时被当成"看不见的面"剔掉了，从楼梯下方往上看会透出夜空。这里在平台实体内侧补一块不受光的深色盒子，
  // 盒子顶面比地面低 4mm（被地面盖住），只有那条缺面的缝能看到它。只是视觉遮挡，不参与碰撞、对准、描边。
  function addStairFiller() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1d1814, side: THREE.DoubleSide });
    const XW = -5.65, XC0 = -4.55, ZTOP = 1.75;
    const m = new THREE.Mesh(new THREE.BoxGeometry(XC0 - 0.05 - XW - 0.04, 1.3, ZTOP + 0.004 - 0.2), mat);
    m.position.set((XW + 0.02 + XC0 - 0.05 - 0.02) / 2, -0.004 - 0.65, (0.2 + ZTOP + 0.004) / 2);
    m.name = 'stair_filler'; scene.add(m);
    // 梯级内部和路缘：被剔掉的还有梯级侧面、路缘顶面，同样在实体里面补深色块（顶面都比可见面低 4mm）
    const H_ST = 0.17, D_ST = 0.27, NST = 6;
    for (let k = 1; k <= NST; k++) {
      const top = -k * H_ST - 0.004, bot = -(NST + 1) * H_ST - 0.1;
      const x0 = XW - 0.1, x1 = XC0 - 0.02, z0 = ZTOP + (k - 1) * D_ST - 0.03, z1 = ZTOP + k * D_ST;   // 两侧伸进墙和路缘、向上一级方向伸进相邻梯级，盖住接缝
      const st = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, top - bot, z1 - z0), mat);
      st.position.set((x0 + x1) / 2, (top + bot) / 2, (z0 + z1) / 2); st.name = 'stair_filler_' + k; scene.add(st);
    }
    const cu = new THREE.Mesh(new THREE.BoxGeometry(0.075, (NST + 1) * H_ST - 0.01, 4.8 - ZTOP), mat);
    cu.position.set(XC0 - 0.0115, -0.004 - ((NST + 1) * H_ST - 0.01) / 2, (ZTOP + 4.8) / 2); cu.name = 'stair_filler_curb'; scene.add(cu);
  }

  // ===== 加载 =====
  const progressCbs = [];
  const loaded = new Map(); let totalBytes = 1;
  let frac = 0;
  const bump = (k) => (n) => { loaded.set(k, n); let l = 0; for (const v of loaded.values()) l += v; frac = Math.min(1, l / totalBytes); progressCbs.forEach(f => f(frac)); };
  const stats = { ready: false, loadMs: 0 };
  let built = false;
  const t0 = performance.now();

  async function load() {
    diag('开始加载');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder().decode(await getBytes(ASSET_BASE + 'manifest.json', 0, () => {}))); }
    catch (e) { if (e && e.file) throw e; fileCache.delete(ASSET_BASE + 'manifest.json'); const err = new Error('manifest.json：' + (e && e.message)); err.file = 'manifest.json'; err.reason = String(e && e.message); throw err; }
    totalBytes = manifest.totalBytes;
    const glbP = getBytes(ASSET_BASE + manifest.glb.file, manifest.glb.bytes, bump('glb'));
    const lmP = Object.entries(manifest.lm).map(([k, v]) => loadTex(renderer, v.file, v.bytes, bump('lm' + k)).then(t => [k, t, v.scale]));
    const skyP = loadTex(renderer, manifest.sky.file, manifest.sky.bytes, bump('sky'), { flipY: true, equirect: true });
    const lmBP = manifest.lmB ? Object.entries(manifest.lmB).map(([a, v]) => loadTex(renderer, v.file, v.bytes, bump('lmB' + a)).then(t => [a, t])) : [];   // 楼道各图集「门开着」版光照图
    const [glbBuf, lms, sky, lmBl] = await Promise.all([glbP, Promise.all(lmP), skyP, Promise.all(lmBP)]);
    const lmBs = Object.fromEntries(lmBl);

    scene.background = sky;
    scene.backgroundIntensity = manifest.sky.scale * Number(Q.get('bgi') || 1);
    const pm = new THREE.PMREMGenerator(renderer);
    const et = envTex();
    scene.environment = pm.fromEquirectangular(et).texture;
    scene.environmentIntensity = Number(Q.get('envi') || 1.0);
    pm.dispose(); et.dispose();

    diag('解析 room.glb');
    // GLTFLoader 在构造解析器时按全局 createImageBitmap 是否存在决定贴图加载方式；带选项的调用不可用时，临时让它走 <img> 路径
    const bmpOk = await probeBitmapOpts();
    const gltf = await new Promise((res, rej) => {
      const savedCIB = window.createImageBitmap;
      if (!bmpOk) window.createImageBitmap = undefined;
      try { new GLTFLoader().parse(glbBuf, ASSET_BASE, res, rej); } catch (e) { rej(e); }
      finally { window.createImageBitmap = savedCIB; }
    }).catch(e => { fileCache.delete(ASSET_BASE + manifest.glb.file); const err = new Error(manifest.glb.file + '：' + (e && e.message || e)); err.file = manifest.glb.file; err.reason = String(e && e.message || e); throw err; });
    diag('room.glb 解析完成');
    const lmMap = {};
    for (const [k, t, s] of lms) { lmMap[k] = { t, s }; }   // 颜色图与光照图共用同一套 UV（UV0）
    const gain = Number(Q.get('lm') || 1);
    const ENV_I = { metal: 1.2, semi: 1.1, matte: 0.35 };
    const AI_MAT = { sofa: { r: 0.38, env: 1.0 }, bed: { r: 0.9, env: 0.3 }, chair: { r: 0.6, env: 0.5 }, dog: { r: 0.95, env: 0.2 }, wardrobe: { r: 0.7, env: 0.5 }, nightstand: { r: 0.6, env: 0.5 } };   // 各件 AI 家具的粗糙度和环境反射强度
    const CORF_K = Number(Q.get('ck') || 0.45).toFixed(3), CORF_REF = (1 + Number(Q.get('ck') || 0.45) * 2.56).toFixed(3);   // 楼道距离衰减：K 越大越暗得快；REF 让 1.6 米处亮度不变
    const done = new Set();
    // 楼道专用环境反射：偏暗的暖灰环境 + 天花上的灯 + 地平线一圈被灯照亮的对面墙，让半亮漆面的门和五金有柔和的高光带
    const corEnvTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const g = cv.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#6b5f4c'); gr.addColorStop(0.42, '#8a7a62'); gr.addColorStop(0.55, '#7d6f58'); gr.addColorStop(1, '#2a2620');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      const blob = (x, y, r, a, c) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(' + c + ',' + a + ')'); rg.addColorStop(1, 'rgba(' + c + ',0)'); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); };
      blob(256, 18, 90, 1.0, '255,226,170'); blob(60, 118, 70, 0.55, '255,214,160'); blob(300, 120, 90, 0.5, '255,222,176'); blob(440, 122, 60, 0.4, '255,210,150');
      const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
      const pm2 = new THREE.PMREMGenerator(renderer); const r = pm2.fromEquirectangular(t).texture; pm2.dispose(); t.dispose(); return r;
    })();
    const CORR = new Set(['5', '8', '9']);   // 楼道三个图集：5 墙和邻居门，8 地面/梯级/天花/栏杆，9 302 门板和五金
    // 走廊图集（含房门）有两张光照图：关门版 / 开门版，按开门进度混合
    const blendMat = (m, lmBtex, fall) => {
      const FALL = fall ? 'corFall(vWPos)' : '1.0';
      m.onBeforeCompile = sh => {
        sh.uniforms.lightMap2 = { value: lmBtex }; sh.uniforms.uOpen = doorOpenU; sh.uniforms.uLamp = { value: new THREE.Vector3(-3.75, 2.3, 1.4) };
        const NL = String.fromCharCode(10);
        // 楼道：在光照图之外再按「到楼道灯的距离」做平方反比式的明暗过渡（灯下亮，两端、墙角、天花板边缘暗），平均亮度不变
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>' + NL + 'varying vec3 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>' + NL + 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <lightmap_pars_fragment>', '#include <lightmap_pars_fragment>' + NL + 'uniform sampler2D lightMap2;' + NL + 'uniform float uOpen;' + NL + 'uniform vec3 uLamp;' + NL + 'varying vec3 vWPos;' + NL + 'float corFall(vec3 p) { float d = distance(p, uLamp); return clamp(' + CORF_REF + ' / (1.0 + ' + CORF_K + ' * d * d), 0.0, 2.2); }')
          .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;', 'vec3 lightMapIrradiance = mix(lightMapTexel.rgb, texture2D(lightMap2, vLightMapUv).rgb, uOpen) * lightMapIntensity * ' + FALL + ';'));   // 注意：onBeforeCompile 时 include 还没展开，要把 chunk 取出来再替换
      };
      m.customProgramCacheKey = () => 'lmBlend' + (fall ? 'F' : 'N');
    };
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (done.has(m)) return; done.add(m);
        if (m.name.startsWith('em_')) {
          // 自发光物体不受光照图影响，直接显示基色
          const nm = new THREE.MeshBasicMaterial({ color: m.color.clone(), side: THREE.DoubleSide }); nm.name = m.name;
          if (/^em_shade_glow/.test(m.name)) {
            const gb = o.geometry; gb.computeBoundingBox();
            const uni = { uY0: { value: gb.boundingBox.min.y }, uY1: { value: gb.boundingBox.max.y }, uBoost: { value: Number(Q.get('shade') || 1.0) } };
            nm.onBeforeCompile = sh => {
              Object.assign(sh.uniforms, uni);
              sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
              sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform float uY0; uniform float uY1; uniform float uBoost;')
                .replace('#include <dithering_fragment>', `
                  float gt = clamp((vWp.y - uY0) / max(uY1 - uY0, 0.001), 0.0, 1.0);
                  float vdn = abs(dot(normalize(vWn), normalize(cameraPosition - vWp)));
                  float gk = mix(1.35, 0.55, gt) * (0.7 + 0.45 * pow(vdn, 1.3));
                  gl_FragColor.rgb *= gk * uBoost;
                  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.0, 0.86, 0.62), 0.35 * gt);
                  #include <dithering_fragment>`);
            };
            nm.customProgramCacheKey = () => 'shadeGlow';
          }
          if (m.name === 'em_speaker_led') { speakerLed.mat = nm; speakerLed.on = nm.color.clone(); nm.color.setRGB(0.05, 0.1, 0.07); }   // 指示灯只在播放时亮
          o.material = Array.isArray(o.material) ? o.material.map(x => x === m ? nm : x) : nm;
          return;
        }
        const ai = m.name.match(/^ai(\d+)_(\w+)/);   // AI 家具：自带颜色贴图(UV0)，光照图用第二套 UV(uv1)
        if (ai && lmMap[ai[1]]) {
          const lt = lmMap[ai[1]].t.clone(); lt.channel = 1; lt.needsUpdate = true;
          const cfg = AI_MAT[ai[2]] || { r: 0.7, env: 0.4 };
          m.lightMap = lt;
          m.lightMapIntensity = lmMap[ai[1]].s * Math.PI * gain;
          m.metalness = 0; m.roughness = cfg.r; m.envMapIntensity = cfg.env;
          if (cfg.col) m.color.setRGB(cfg.col[0], cfg.col[1], cfg.col[2]);
          if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          m.needsUpdate = true;
          return;
        }
        const k = m.name.match(/^a(\d+)_(\w+)/);
        if (k && lmMap[k[1]]) {
          m.lightMap = lmMap[k[1]].t;
          m.lightMapIntensity = lmMap[k[1]].s * Math.PI * gain;   // three 内部会再乘 1/PI
          m.metalness = Math.min(m.metalness, 0.4);
          if (k[2] === 'semi' || k[2] === 'leather') m.roughness = Math.min(m.roughness, 0.42);   // leather 桶（黑皮沙发）暂与 semi 同参数，校色待定
          m.envMapIntensity = ENV_I[k[2] === 'leather' ? 'semi' : k[2]] != null ? ENV_I[k[2] === 'leather' ? 'semi' : k[2]] : 0.5;
          if (k[1] === '6') { m.color.setRGB(1.0, Number(Q.get('fg') || 0.84), Number(Q.get('fb') || 0.62)); if (k[2] === 'semi') { m.roughness = 0.45; m.envMapIntensity = 0.4; } }   // 地板：暖木色 + 很弱的反射   // 地板：弱反射，映出窗和灯的朦胧亮斑
          // 新版 three 里 scene.environment 的强度由 scene.environmentIntensity 统一决定，材质自己的 envMapIntensity 不生效；楼道和门牌要单独控制反射，所以显式挂上 envMap
          const isC = CORR.has(k[1]);
          if (isC || (k[1] === '4' && k[2] === 'gloss')) {
            if (k[2] === 'metal') { m.envMap = corEnvTex; m.envMapIntensity = Number(Q.get('cem') || (k[1] === '9' ? 0.12 : 1.6)); m.metalness = 0.55; }   // 门五金(图集9)：反射太强会变一片死白，压到 0.12 才是拉丝不锈钢的灰
            else if (k[2] === 'gloss') { m.envMap = corEnvTex; m.envMapIntensity = Number(Q.get('ceg') || (k[1] === '9' ? 0.8 : k[1] === '5' ? 0.6 : 1.1)); m.metalness = 0; m.roughness = 0.3; }   // 门板和门框的亮漆：反射减弱，免得发白发橘}
            else { m.envMap = scene.environment; m.envMapIntensity = Number(Q.get('cenv') || 0.24); }
          }
          if (isC) {
            m.lightMapIntensity *= Number(Q.get('cg') || (k[1] === '9' ? (k[2] === 'metal' ? 0.604 : 0.762) : 3.2));   // 门(图集9)的光照图本身较亮，不再额外放大 3.2 倍，改成略压暗（门板深红棕）
            if (k[1] !== '9') m.color.setRGB(Number(Q.get('ccr') || 0.94), Number(Q.get('ccg') || 0.98), Number(Q.get('ccb') || 1.38));   // 楼道比屋里暗：老楼昏暗
          }
          if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          if (lmBs[k[1]]) blendMat(m, lmBs[k[1]], k[1] !== '9');
          m.needsUpdate = true;
        }
      });
    });
    built = true;
    scene.add(gltf.scene);
    addStairFiller();
    gltf.scene.updateMatrixWorld(true);
    for (const n of ['nightstand_drawer', 'wd_door_b_l', 'wd_door_b_r', 'clothes_top', 'clothes_knit', 'ns_ai_body', 'ai_wardrobe', 'door_slab', 'door_lever_o', 'plate302', 'speaker_mini']) {
      const o = gltf.scene.getObjectByName(n);
      if (!o) { console.warn('缺少活动部件', n); continue; }
      parts[n] = o; closed[n] = { p: o.position.clone(), r: o.rotation.clone() };
    }
    if (parts.door_lever_o) closedLever = { x: parts.door_lever_o.rotation.x };
    if (parts.door_slab && parts.door_lever_o) parts.door_slab.attach(parts.door_lever_o);   // 把手、门牌跟着门板转
    if (parts.door_slab && parts.plate302) parts.door_slab.attach(parts.plate302);
    buildOutlines();
    addNightWindow(); addLampGlows(); addContactShadows(); addExitGuide();
    renderer.compile(scene, camera);   // 提前编译着色器，免得进屋第一帧卡一下
    stats.loadMs = Math.round(performance.now() - t0);
    stats.ready = true;
    progressCbs.forEach(f => f(1));
    diag('房间就绪，用时 ' + stats.loadMs + 'ms');
  }
  let ready = load();
  ready.catch(e => { console.error('房间加载失败', e); diag('加载失败 ' + (e && e.message)); });
  // 加载失败后只重下失败的部分（已下好的文件有缓存），不用整页刷新
  function reload() {
    if (stats.ready || built) return ready;
    diag('重新加载');
    ready = load();
    ready.catch(e => { console.error('房间加载失败', e); diag('加载失败 ' + (e && e.message)); });
    return ready;
  }
  renderer.domElement.addEventListener('webglcontextlost', e => {
    e.preventDefault(); diag('WebGL 上下文丢失');
    showFatal('手机内存不足，请关掉其它应用后刷新');
  });

  // ===== 主循环用 =====
  let tAcc = 0;
  function update(dt) {
    tAcc += dt;
    for (const sp of glows) { const d = camera.position.distanceTo(sp.position); const k = Math.min(1, Math.max(0, (d - 1.8) / 1.4)); sp.material.opacity = sp.userData.ba * k * k * (3 - 2 * k); }   // 离镜头近时光晕淡出，免得糊在镜头前
    updateOutlines(dt); updateExitGuide(dt);
    for (const id in containers) {
      const c = containers[id];
      if (c.dir && c.p < 1) { c.p = Math.min(1, c.p + dt / c.dur); c.apply(c.p); }
      if (c.dir && c.p >= 1) {
        c.dir = 0;
        for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].c === c) { waiters[i].res(); waiters.splice(i, 1); }
      }
      const mk = c.marker;
      if (!c.searched) {
        const s = 1 + Math.sin(tAcc * 4) * 0.12; mk.g.scale.set(s, s, s);
        mk.m.material.opacity = 0.75 + Math.sin(tAcc * 4) * 0.2;
      }
      mk.g.position.y = mk.baseY + Math.sin(tAcc * 2 + c.access.x) * 0.04;
      mk.g.rotation.y += dt * (c.searched ? 0.3 : 1.2);
    }
  }

  // ===== 轻量后期：场景先画到 HDR 渲染目标（多重采样抗锯齿），再用一个全屏着色器完成 锐化 / 对比度 / 暗角 / 胶片颗粒 / 色调映射 =====
  const POST = Q.get('post') !== '0';
  const PQ = { contrast: Number(Q.get('con') || 1.06), vig: Number(Q.get('vig') || 0.32), grain: Number(Q.get('grain') || 0.010), sharp: Number(Q.get('sharp') || 0.38), sat: Number(Q.get('sat') || 1.12) };
  const NLC = String.fromCharCode(10);
  let rt = null, postScene = null, postCam = null, postMat = null;
  function initPost() {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    rt = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    postMat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: null }, uMaskOn: { value: 0 }, uMaskA: { value: 0 }, uMaskPx: { value: 2.6 }, uMaskCol: { value: 1 }, tDiffuse: { value: rt.texture }, uTexel: { value: new THREE.Vector2(1 / sz.x, 1 / sz.y) }, uTime: { value: 0 }, uCon: { value: PQ.contrast }, uVig: { value: PQ.vig }, uGrain: { value: PQ.grain }, uSharp: { value: PQ.sharp }, uSat: { value: PQ.sat } },
      vertexShader: 'varying vec2 vUv;' + NLC + 'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tMask; uniform float uMaskOn, uMaskA, uMaskPx, uMaskCol;',
        'uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uTime, uCon, uVig, uGrain, uSharp, uSat;',
        'varying vec2 vUv;',
        'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
        'void main() {',
        '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
        '  vec3 b = (texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;',
        '  c += (c - b) * uSharp;',
        '  c = max(c, vec3(0.0));',
        '  c = max((c - 0.18) * uCon + 0.18, vec3(0.0));',
        '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);',
        '  vec2 q = vUv - 0.5; c *= 1.0 - uVig * dot(q, q) * 2.2;',
        '  c += (hash(vUv * (1.0 / uTexel) + uTime) - 0.5) * uGrain * (0.4 + l);',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '  if (uMaskOn > 0.5) {',
        '    float m0 = texture2D(tMask, vUv).r; float mx = 0.0;',
        '    for (int i = 0; i < 16; i++) { float an = 6.2831853 * float(i) / 16.0; vec2 d = vec2(cos(an), sin(an)) * uTexel * uMaskPx; mx = max(mx, texture2D(tMask, vUv + d).r); mx = max(mx, texture2D(tMask, vUv + d * 0.7).r); mx = max(mx, texture2D(tMask, vUv + d * 0.4).r); }',
        '    float e = clamp((mx - m0) * 1.6, 0.0, 1.0) * uMaskA;',
        '    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(uMaskCol), e);',
        '  }',
        '}'
      ].join(NLC),
      depthTest: false, depthWrite: false
    });
    postScene = new THREE.Scene(); postCam = new THREE.Camera();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, postMat); quad.frustumCulled = false; postScene.add(quad);
  }

  // ===== 窗外夜景：单独一张 2048x1024 的程序绘制夜景（天际线 + 亮灯窗户 + 月亮），挂在窗外，比天空盒清晰得多 =====
  function nightCityTex() {
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
    const g = cv.getContext('2d');
    // 天空：偏灰的深藏青到近黑
    const sky = g.createLinearGradient(0, 0, 0, 1024); sky.addColorStop(0, '#05070b'); sky.addColorStop(0.5, '#0d121b'); sky.addColorStop(1, '#1c2330');
    g.fillStyle = sky; g.fillRect(0, 0, 2048, 1024);
    const r = rng(77);
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(210,215,225,' + (0.12 + r() * 0.3) + ')'; g.fillRect(r() * 2048, r() * 420, 1.6, 1.6); }
    g.fillStyle = 'rgba(200,200,190,0.5)'; g.beginPath(); g.arc(1560, 190, 26, 0, 7); g.fill();
    g.fillStyle = 'rgba(200,200,190,0.06)'; g.beginPath(); g.arc(1560, 190, 80, 0, 7); g.fill();
    // 三层剪影：远（浅灰蓝、窗灯少）、中、近（最暗最高），窗灯是暖黄小点、疏密不均
    const layers = [
      { col: '#1a212d', hmin: 120, hmax: 380, wmin: 80, wmax: 170, lit: 0.05, step: 22, a: 0.55 },
      { col: '#10151e', hmin: 200, hmax: 560, wmin: 100, wmax: 210, lit: 0.10, step: 24, a: 0.75 },
      { col: '#090c12', hmin: 300, hmax: 720, wmin: 120, wmax: 260, lit: 0.07, step: 26, a: 0.9 }
    ];
    for (const L of layers) {
      let x = -60;
      while (x < 2100) {
        const bw = L.wmin + r() * (L.wmax - L.wmin), bh = L.hmin + r() * (L.hmax - L.hmin), y = 1024 - bh;
        g.fillStyle = L.col; g.fillRect(x, y, bw, bh);
        // 疏密不均：每栋楼有自己的亮灯密度，且按「楼层」成片亮/暗
        const dens = L.lit * (0.2 + r() * 1.8);
        for (let wy = y + 16; wy < 1010; wy += L.step) {
          const rowOn = r() < 0.55;
          for (let wx = x + 10; wx < x + bw - 12; wx += L.step - 8) {
            if (rowOn && r() < dens * 2.2) { const warm = r() > 0.18; g.fillStyle = warm ? 'rgba(255,208,128,' + (0.45 + r() * 0.4) * L.a + ')' : 'rgba(200,225,245,' + (0.35 + r() * 0.3) * L.a + ')'; g.fillRect(wx, wy, 6, 8); }
          }
        }
        x += bw + 4 + r() * 22;
      }
    }
    // 轻微虚化（景深）：把整张图用小半径模糊重绘一遍（不支持 ctx.filter 的浏览器就保持原样）
    const out = document.createElement('canvas'); out.width = 2048; out.height = 1024;
    const g2 = out.getContext('2d');
    g2.filter = 'blur(1.6px)'; g2.drawImage(cv, 0, 0); g2.filter = 'none';
    const t = new THREE.CanvasTexture(out); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  // ===== 接触阴影：细脚家具（办公椅、落地灯、边几、书桌、床头柜）光照图里的落地暗影太弱，会有「浮在地板上」的感觉，补软边暗斑贴片（不重烘）=====
  function addContactShadows() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const spot = (x, z, r, a, sx = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2 * sx, r * 2 * sz), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: a, depthWrite: false, toneMapped: false, color: 0x000000 }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.renderOrder = 2; m.userData.noOcc = true; scene.add(m);
    };
    spot(1.7, -0.4, 0.36, 0.38);                                     // 办公椅：五星脚下一整片
    for (let k = 0; k < 5; k++) { const a = k * 2 * Math.PI / 5 + 0.3 + 1.87 * 0; spot(1.7 + 0.31 * Math.cos(a), -0.4 + 0.31 * Math.sin(a), 0.06, 0.5); }
    spot(2.4, 1.45, 0.3, 0.5); spot(2.4, 1.45, 0.17, 0.35);          // 落地灯底盘
    for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 + 0.5; spot(-0.55 + 0.15 * Math.cos(a), 0.75 + 0.15 * Math.sin(a), 0.055, 0.55); }
    spot(-0.55, 0.75, 0.3, 0.16);                                     // 边几：桌面挡光的一圈淡影
    for (const [x, z] of [[2.16, 0.56], [2.7, 0.56], [2.16, -0.96], [2.7, -0.96]]) spot(x, z, 0.06, 0.5);   // 书桌四脚
    for (const [x, z] of [[-2.69, -2.14], [-2.31, -2.14], [-2.69, -1.81], [-2.31, -1.81]]) spot(x, z, 0.05, 0.5);   // 床头柜四脚
  }
  // ===== 撤离点引导：门垫上一圈柔和的暖色地面光晕（全部搜出后才亮，不用悬浮标记）=====
  const exitGuide = { mesh: null, v: 0, target: 0 };
  function addExitGuide() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,140,0.0)'); gr.addColorStop(0.55, 'rgba(255,205,120,0.55)'); gr.addColorStop(0.8, 'rgba(255,190,100,0.25)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(EXIT_POINT.x, 0.022, EXIT_POINT.z); m.renderOrder = 3; m.userData.noOcc = true; m.visible = false; scene.add(m);
    exitGuide.mesh = m;
  }
  function setExitGuide(on) { exitGuide.target = on ? 1 : 0; }
  function updateExitGuide(dt) {
    const e = exitGuide; if (!e.mesh) return;
    e.v += Math.sign(e.target - e.v) * Math.min(Math.abs(e.target - e.v), dt / 1.2);
    e.mesh.visible = e.v > 0.001;
    e.mesh.material.opacity = 0.5 * e.v * (0.75 + 0.25 * Math.sin(tAcc * 2.2));
  }
  function addNightWindow() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: nightCityTex(), color: new THREE.Color(0.66, 0.67, 0.71).multiplyScalar(Number(Q.get('nw') || 4.2)) }));
    m.rotation.y = -Math.PI / 2; m.position.set(11, 3.2, -0.2); m.userData.noOcc = true; scene.add(m);
  }
  // ===== 灯具附近柔和辉光：加色混合的小光晕精灵（几乎零成本）=====
  const glows = [];
  function addLampGlows() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,225,170,1)'); gr.addColorStop(0.25, 'rgba(255,190,110,0.45)'); gr.addColorStop(1, 'rgba(255,160,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    for (const [x, y, z, sc, ba] of [[-2.5, 0.88, -1.95, 0.9, 0.24], [2.4, 1.62, 1.45, 1.3, 0.26], [-2.2, 2.66, 1.4, 0.7, 0.14], [2.45, 0.95, -0.62, 0.5, 0.14]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.15 }));
      sp.userData.ba = ba; sp.position.set(x, y, z); sp.scale.set(sc, sc, 1); sp.renderOrder = 6; sp.userData.noOcc = true; scene.add(sp); glows.push(sp);
    }
  }
  let postT = 0;

  let extObj = null;
  const getExt = () => extObj || (extObj = buildExt(W, H));
  function render(mode) {
    if (mode === 'exterior') {
      const e = getExt(); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.render(e.scene, e.camera);
    } else if (mode === 'interior') {
      renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = ROOM_EXPOSURE * expMul;
      if (POST && stats.ready) {
        if (!rt) initPost();
        renderer.setRenderTarget(rt); renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        const mk = renderMask(renderer.getDrawingBufferSize(new THREE.Vector2()));
        postMat.uniforms.uMaskOn.value = mk ? 1 : 0;
        if (mk) { postMat.uniforms.uMaskA.value = Math.min(1, mk.alpha * (mk.dim ? 1.6 : 1)); postMat.uniforms.uMaskCol.value = mk.dim ? 0.72 : 1.0; postMat.uniforms.uMaskPx.value = (mk.dim ? 1.7 : 2.7) * renderer.getPixelRatio(); }
        postMat.uniforms.uTime.value = (postT += 0.37) % 100;
        renderer.render(postScene, postCam);
      } else renderer.render(scene, camera);
    }
  }
  function resize(w, h) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (rt) { const sz = renderer.getDrawingBufferSize(new THREE.Vector2()); rt.setSize(sz.x, sz.y); postMat.uniforms.uTexel.value.set(1 / sz.x, 1 / sz.y); }
    if (extObj) { extObj.camera.aspect = w / h; extObj.camera.updateProjectionMatrix(); }
  }
  function setGlow(v) { if (extObj) extObj.glow.material.opacity = v; }

  return {
    renderer, camera, scene, containers, update, render, resize,
    get ext() { return getExt(); },
    open, markSearched, setMarkersVisible, setGlow, setExitGuide, setSpeaker, get exitGuideValue() { return exitGuide.v; }, door, setExposureMul(m) { expMul = m; },
    pickAt, pickAim(maxDist) { return pickAt(0, 0, maxDist); }, setAim, setHint, outlineAlpha,
    get ready() { return ready; }, reload, stats, onProgress(f) { progressCbs.push(f); f(frac); }, get progress() { return frac; },
  };
}
