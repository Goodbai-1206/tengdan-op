// 流程状态机：启动页 -> 开场 -> 探索 <-> 搜索 -> 结算 -> 再看一遍房间。
import { normalizeContent, CONTAINER_IDS } from './config.js';
import * as audio from './audio.js';
import { initStage, createControls, view, onStageResize } from './controls.js';
import { createWorld, COLLIDERS, PLAYER_R, EYE_H, PLAYER_START, DOOR_OPEN_COLLIDER, EXIT_POINT } from './world.js';
// 旧开场（js/intro.js，含 world.ext 夜景外立面、style.css 的 .intro* 样式）已摘出流程，文件保留；新开场从 playIntro() 接入。
import { createLoot } from './loot.js';
import { createMusic } from './music.js';
import { diag } from './diag.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const content = normalizeContent(window.GIFT_CONTENT);
document.title = content.codename;

const stage = $('stage');
initStage(stage);


// ---------- 世界、控制、面板 ----------
let world;
try {
  world = createWorld($('gl'), view.W * view.scale, view.H * view.scale);
} catch (err) {
  console.error(err);
  $('cv-msg').textContent = '这台设备无法显示 3D 画面，请换一个浏览器试试';
  $('start-btn').style.display = 'none';
  throw err;
}
// 3D 画布按实际像素渲染（逻辑尺寸 x 缩放系数），再用 CSS 缩回舞台逻辑尺寸，放大后不发糊
function resizeWorld() {
  world.resize(view.W * view.scale, view.H * view.scale);
  const cv = $('gl').querySelector('canvas');
  if (cv) { cv.style.width = view.W + 'px'; cv.style.height = view.H + 'px'; }
}
onStageResize(resizeWorld);
resizeWorld();

const ctl = createControls($('touch'), $('joy'), $('joy-knob'), { onInteract: () => tryInteract() });
const loot = createLoot(stage, content, { onChange: () => updateProgress(), onAllCollected: () => { $('progress').classList.remove('flash'); void $('progress').offsetWidth; $('progress').classList.add('flash'); } });

const player = { x: PLAYER_START.x, z: PLAYER_START.z, yaw: PLAYER_START.yaw, pitch: PLAYER_START.pitch, bob: 0, stepIdx: 0, moveAmt: 0 };
const music = createMusic(stage, { tracksUrl: params.get('mt') || null });
music.init();
let state = 'title';
let nearId = null;
let autoLook = null;

// ---------- 碰撞 ----------
function collides(x, z) {
  for (const b of COLLIDERS) {
    const cx = clamp(x, b[0], b[2]), cz = clamp(z, b[1], b[3]);
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < PLAYER_R * PLAYER_R) return true;
  }
  return false;
}
function tryMove(dx, dz) {
  // 分轴移动：撞墙时另一轴仍可滑动
  if (!collides(player.x + dx, player.z)) player.x += dx;
  if (!collides(player.x, player.z + dz)) player.z += dz;
}

// ---------- 相机 ----------
function applyCamera(bobY) {
  const c = world.camera;
  c.position.set(player.x, (window.__eyeY || EYE_H) + bobY, player.z);   // __eyeY 仅供截图测试对机位
  c.rotation.set(player.pitch, player.yaw, 0);
}

function updatePlayer(dt) {
  const look = ctl.consumeLook();
  if (state === 'explore') {
    player.yaw -= look.dx * 0.0048;
    player.pitch = clamp(player.pitch - look.dy * 0.0048, -Math.PI / 3, Math.PI / 3);
    const mv = ctl.getMove();
    const speed = 2.0;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    const vx = (fx * mv.y + rx * mv.x) * speed * dt, vz = (fz * mv.y + rz * mv.x) * speed * dt;
    const before = { x: player.x, z: player.z };
    if (vx || vz) tryMove(vx, vz);
    const moved = Math.hypot(player.x - before.x, player.z - before.z) / Math.max(dt, 1e-4) / speed;
    player.moveAmt += (clamp(moved, 0, 1) - player.moveAmt) * Math.min(1, dt * 10);
    if (player.moveAmt > 0.05) {
      player.bob += dt * Math.PI * 1.9 * 1.15 * (0.4 + player.moveAmt * 0.6);
      const idx = Math.floor(player.bob / Math.PI);
      if (idx !== player.stepIdx) { player.stepIdx = idx; audio.footstep(); }
    }
  } else {
    player.moveAmt *= 0.9;
  }
  // 搜索前自动转向容器
  if (autoLook) {
    const k = Math.min(1, dt * 6);
    let dy = autoLook.yaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    player.yaw += dy * k; player.pitch += (autoLook.pitch - player.pitch) * k;
    if (autoLook.x != null) { player.x += (autoLook.x - player.x) * k * 0.6; player.z += (autoLook.z - player.z) * k * 0.6; }
    if (autoLook.release && (autoLook.release -= dt) <= 0) autoLook = null;
  }
  const bobY = -Math.abs(Math.sin(player.bob)) * 0.03 * player.moveAmt;
  applyCamera(bobY);
}

// ---------- 交互检测：准星对准才提示 ----------
const searchBtn = $('search-btn');
const AIM_FAR = 3.2;          // 对准多远就描边（米）
const SPK_NEAR = 2.2;         // 音响小，近到多少出现「音乐」按钮
const AIM_NEAR = 1.8;         // 近到多少才出现「搜索」按钮（米）
const HINT_ENABLED = new URLSearchParams(location.search).get('nohint') !== '1';   // 测试用：?nohint=1 关闭    // 防卡关轻提示总开关
const HINT_FIRST = 45, HINT_EVERY = 30, HINT_DUR = 1.2;   // 首次等待 / 之后间隔 / 一次呼吸时长（秒）
const xhair = document.createElement('div');
xhair.id = 'xhair'; xhair.style.display = 'none';
stage.appendChild(xhair);
let exitArmed = false, allGot = false, actionMode = null;
const SEARCH_IC = searchBtn.innerHTML;
const MUSIC_IC = '<svg class="hud-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>';
const EXIT_IC = '<svg class="hud-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4"/><path d="M4 12h9"/><path d="M9.5 8.5L13 12l-3.5 3.5"/></svg><span class="btn-lb">撤离</span>';
function setActionMode(m) {
  if (m === actionMode) return;
  actionMode = m;
  searchBtn.classList.toggle('show', !!m);
  searchBtn.classList.toggle('m-exit', m === 'exit');
  searchBtn.classList.toggle('m-music', m === 'music');
  searchBtn.dataset.mode = m || '';
  if (m) { searchBtn.innerHTML = m === 'exit' ? EXIT_IC : m === 'music' ? MUSIC_IC : SEARCH_IC; searchBtn.setAttribute('aria-label', m === 'exit' ? '撤离' : m === 'music' ? '音乐' : '搜索'); }
}
let hintNext = Infinity, hintT0 = -1, aimTick = 0, aimCache = null;
function resetHint() { hintNext = performance.now() + HINT_FIRST * 1000; hintT0 = -1; }
function updateNear() {
  let aim = null;
  const exploring = state === 'explore';
  if (xhair.style.display !== (exploring ? '' : 'none')) xhair.style.display = exploring ? '' : 'none';
  if (exploring) { if ((aimTick++ & 3) === 0) aimCache = world.pickAim(AIM_FAR); aim = aimCache; } else aimCache = null;   // 射线检测降到约 1/4 帧率（布料网格面数多）
  const isSp = !!aim && aim.id === 'speaker';
  const cleared = !!aim && !isSp && loot.status(aim.id) === 'cleared';
  world.setAim(aim ? aim.id : null, cleared);
  const best = aim && !cleared && aim.dist < (isSp ? SPK_NEAR : AIM_NEAR) ? aim.id : null;
  nearId = best;
  // 撤离点（门垫半径内）：走出过一次范围后才生效，免得一进屋就弹「撤离」；瞄着容器时让位给搜索
  const dEx = Math.hypot(player.x - EXIT_POINT.x, player.z - EXIT_POINT.z);
  if (dEx > EXIT_POINT.r + 0.5) exitArmed = true;
  const inExit = exploring && exitArmed && dEx < EXIT_POINT.r;
  setActionMode(!exploring ? null : best === 'speaker' ? 'music' : best ? 'search' : inExit ? 'exit' : null);
  world.setExitGuide(exploring && allGot);
  // 防卡关：很久没开新搜索点，让还没搜的容器描边缓慢呼吸一次
  if (HINT_ENABLED && !allGot && exploring && aim) {
    // 玩家正对着某个容器时不叫轻提示（否则别的容器会跟着亮），取消正在进行的这次，之后按间隔再来
    if (hintT0 >= 0) { hintT0 = -1; hintNext = performance.now() + HINT_EVERY * 1000; CONTAINER_IDS.forEach(id => world.setHint(id, 0)); }
  } else if (HINT_ENABLED && !allGot && exploring) {
    const now = performance.now();
    if (hintT0 < 0 && now >= hintNext) hintT0 = now;
    const pending = CONTAINER_IDS.filter(id => loot.status(id) !== 'cleared');
    if (hintT0 >= 0) {
      const p = (now - hintT0) / (HINT_DUR * 1000);
      if (p >= 1) { hintT0 = -1; hintNext = now + HINT_EVERY * 1000; CONTAINER_IDS.forEach(id => world.setHint(id, 0)); }
      else CONTAINER_IDS.forEach(id => world.setHint(id, pending.includes(id) ? 0.5 * Math.sin(Math.PI * p) : 0));
    }
  } else if (hintT0 >= 0) { hintT0 = -1; CONTAINER_IDS.forEach(id => world.setHint(id, 0)); }
}
// 点屏幕上的容器：短按（几乎没移动）时，从点按位置发射线
(() => {
  const tl = $('touch'); let d0 = null;
  tl.addEventListener('pointerdown', e => { d0 = { x: e.offsetX, y: e.offsetY, t: performance.now() }; });
  tl.addEventListener('pointerup', e => {
    if (!d0 || state !== 'explore') { d0 = null; return; }
    const moved = Math.hypot(e.offsetX - d0.x, e.offsetY - d0.y), dt = performance.now() - d0.t;
    d0 = null;
    if (moved > 8 || dt > 300) return;
    const hit = world.pickAt(e.offsetX / tl.offsetWidth * 2 - 1, -(e.offsetY / tl.offsetHeight * 2 - 1), SPK_NEAR);
    if (hit && hit.id === 'speaker') { audio.uiClick(); openMusic(); }
    else if (hit && hit.dist < AIM_NEAR && loot.status(hit.id) !== 'cleared') { audio.uiClick(); startSearch(hit.id); }
  });
})();

function tryInteract() {
  if (state !== 'explore') return;
  if (nearId === 'speaker') openMusic();
  else if (nearId) startSearch(nearId);
  else if (actionMode === 'exit') requestExit();
}
// 音响面板：开着时玩家不能动，关了回探索
async function openMusic() {
  if (state !== 'explore') return;
  state = 'music'; ctl.setEnabled(false); nearId = null; setActionMode(null);
  await music.openPanel();
  state = 'explore'; ctl.setEnabled(true);
}
// 撤离：全部搜出直接结算；否则先问一句
async function requestExit() {
  if (state !== 'explore') return;
  const c = loot.counts(), full = c.got >= c.total;
  state = 'confirm'; ctl.setEnabled(false); setActionMode(null);
  if (!full) {
    const ok = await loot.confirmExit(c.total - c.got);
    if (!ok) { state = 'explore'; ctl.setEnabled(true); return; }
  }
  await runEnding(full);
}
searchBtn.addEventListener('click', () => { audio.uiClick(); tryInteract(); });

// ---------- 搜索流程 ----------
const LOOK_Y = { desk: 0.62, wardrobe: 1.1, chest: 0.4 };
const OPEN_SFX = { desk: audio.drawerOpen, wardrobe: audio.wardrobeOpen, chest: audio.chestOpen };

function updateProgress() { const c = loot.counts(); $('progress').querySelector('.pn').textContent = c.got + '/' + c.total; allGot = c.total > 0 && c.got >= c.total; }

async function startSearch(id) {
  state = 'search';
  ctl.setEnabled(false);
  nearId = null; setActionMode(null); xhair.style.display = 'none';   // 立刻藏准星，不等下一帧（低帧率设备上会多留好几秒）
  resetHint();
  const c = world.containers[id];
  const dx = c.access.x - player.x, dz = c.access.z - player.z, d = Math.max(0.3, Math.hypot(dx, dz));
  // 自动转向容器；离得太近时向后退到约 1.3 米（有墙就退到能退的最远处）
  let tx = player.x, tz = player.z;
  if (d < 1.3) {
    const ux = -dx / d, uz = -dz / d;
    for (let dd = 1.3; dd > d + 0.05; dd -= 0.1) {
      const x = c.access.x + ux * dd, z = c.access.z + uz * dd;
      if (!collides(x, z)) { tx = x; tz = z; break; }
    }
  }
  const dd2 = Math.hypot(c.access.x - tx, c.access.z - tz);
  autoLook = { yaw: Math.atan2(-dx, -dz), pitch: clamp(Math.atan2(LOOK_Y[id] - EYE_H, dd2), -0.6, 0.3), x: tx, z: tz };
  await sleep(350);
  OPEN_SFX[id]();
  await world.open(id);
  await sleep(150);
  const res = await loot.openContainer(id);
  autoLook = { yaw: player.yaw, pitch: 0, release: 0.7 }; // 离开把视线抬回水平
  syncMarkers();
  updateProgress();
  state = 'explore';      // 13/13 也回到探索，由玩家自己去门口撤离
  ctl.setEnabled(true);
}

// 3D 标记：还有东西没拿保持亮，全拿完才变灰
function syncMarkers() {
  CONTAINER_IDS.forEach(id => { if (loot.status(id) === 'cleared') world.markSearched(id); });
}

// ---------- 背包（探索中随时打开，只含背包） ----------
async function openBag() {
  if (state !== 'explore') return;
  state = 'bag';
  ctl.setEnabled(false);
  nearId = null; setActionMode(null);
  await loot.openBag();
  state = 'explore';
  ctl.setEnabled(true);
}
$('bag-btn').addEventListener('click', () => { audio.uiClick(); openBag(); });

async function runEnding(full) {
  state = 'ending';
  ctl.setEnabled(false); setActionMode(null);
  { const tt = document.querySelector('.exit-toast'); if (tt) tt.classList.remove('on'); }   // 「物资已全部搜出」提示别盖在结算页上
  const c = loot.counts();
  loot.dim(true); await sleep(650);                       // 0.6 秒压暗再出结算层
  const p = loot.showEnding(loot.bagItems(), { full, found: c.got, total: c.total });
  await sleep(120); loot.dim(false);
  await p;                                                // 点「返回房间」才会返回；「再来一局」整页重载
  player.x = PLAYER_START.x; player.z = PLAYER_START.z; player.yaw = PLAYER_START.yaw; player.pitch = PLAYER_START.pitch;
  exitArmed = false; resetHint();
  state = 'explore';
  ctl.setEnabled(true);
}

// ---------- 进入探索 ----------
function enterExplore() {
  state = 'explore';
  resetHint(); exitArmed = false;
  player.x = PLAYER_START.x; player.z = PLAYER_START.z; player.yaw = PLAYER_START.yaw; player.pitch = PLAYER_START.pitch;
  world.setMarkersVisible(true);
  $('hud').classList.remove('hidden');
  updateProgress();
  ctl.setEnabled(true);
  music.startAuto();
  const hint = $('hint'); hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 5000);
}

// ---------- 开场「门外进门」（约 5 秒，点屏幕可跳过）----------
// 0~1.2s 黑场淡入，站在老楼楼梯最后几级上仰看，左下角打字；0.8~2.3 走上过道并右转面朝 302 门；2.2 把手转动（咔哒）；
// 2.5~3.7 门向屋内推开（暖光漏出，曝光由暗到亮）；3.7~5 走进门落到出生点（门内面朝东），字淡出，界面淡入。
// 结尾门保持敞开（走廊尽头有墙，从屋里看出去不露虚空），门板作为碰撞体留在门边。
// 旧的「地图 + 夜景外立面」开场：js/intro.js（createIntro）、world.js 的 buildExt/world.ext、style.css 的 .intro*，已不再调用。
const INTRO_T = 5.0;
const introEl = document.createElement('div');
introEl.className = 'in2 hidden';
introEl.innerHTML = '<div class="in2-fade"></div><div class="in2-txt"><div class="in2-l1"></div><div class="in2-l2"></div></div>';
stage.appendChild(introEl);
const inFade = introEl.querySelector('.in2-fade'), inL1 = introEl.querySelector('.in2-l1'), inL2 = introEl.querySelector('.in2-l2'), inTxt = introEl.querySelector('.in2-txt');
const L1 = content.codename, L2_PRE = '目标：', L2_TAIL = '搜出全部物资';
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeO = t => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
let introRun = null;
function doorFinal() {
  world.door.set(1); world.door.press(0); world.setExposureMul(1);
  if (COLLIDERS.indexOf(DOOR_OPEN_COLLIDER) < 0) COLLIDERS.push(DOOR_OPEN_COLLIDER);
}
function playIntro() {
  if (params.get('skipintro') === '1') { doorFinal(); enterExplore(); return Promise.resolve(); }
  return new Promise(async resolve => {
    await world.ready.catch(() => {});
    state = 'intro';
    world.setMarkersVisible(false);
    world.door.set(0); world.door.press(0);
    introEl.classList.remove('hidden');
    inFade.style.opacity = '1'; inTxt.style.opacity = '1'; inL1.textContent = ''; inL2.textContent = '';
    const t0 = performance.now();
    window.__introT0 = t0;   // 测试用：开场起点时间戳
    let done = false, unlocked = false, swung = false;
    const finish = (skipped) => {
      if (done) return; done = true;
      introRun = null; introEl.removeEventListener('pointerdown', onSkip);
      doorFinal();
      introEl.classList.add('hidden');
      enterExplore();
      const hud = $('hud'); hud.style.transition = 'none'; hud.style.opacity = '0';
      requestAnimationFrame(() => { hud.style.transition = 'opacity .5s'; hud.style.opacity = '1'; });
      resolve();
    };
    const onSkip = () => finish(true);
    introEl.addEventListener('pointerdown', onSkip);
    introRun = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= INTRO_T) { finish(false); return; }
      // 相机：从楼梯最后几级(西南侧)往上走 -> 踏上过道 -> 右转面朝 302 门(在东) -> 推门 -> 进屋落到出生点（门内，面朝东）
      const climb = easeIO(seg(t, 0.8, 2.3)), turn = easeIO(seg(t, 1.0, 2.3)), drift = seg(t, 2.3, 3.7), walk = easeIO(seg(t, 3.7, 5.0));
      let x = lerp(-5.1, -4.1, climb), z = lerp(2.75, 1.45, climb);
      x = lerp(x, -3.95, drift); x = lerp(x, PLAYER_START.x, walk); z = lerp(z, PLAYER_START.z, walk);
      const yaw = lerp(lerp(0, -Math.PI / 2, turn), PLAYER_START.yaw, walk);   // 先右转面朝门，进屋后再转向房间中央
      // 脚下高度：楼梯段（x<-4.55、z>1.75）随梯级下降，其余是平地；上台阶时有轻微起伏
      const sfac = clamp((-4.45 - x) / 0.35, 0, 1);              // 离开楼梯段(x<-4.55)时平滑过渡到平地
      const onStair = sfac > 0 && z > 1.75;
      const ground = onStair ? -Math.min(1.19, (z - 1.75) / 0.27 * 0.17) * sfac : 0;
      const moving = seg(t, 0.8, 2.3) * (1 - seg(t, 2.3, 2.6)) + seg(t, 3.7, 4.0) * (1 - seg(t, 4.8, 5.0));
      const bob = -Math.abs(Math.sin(t * 5.6)) * 0.03 * Math.min(1, moving * 1.2) + (onStair ? Math.abs(Math.sin(t * 5.6)) * 0.015 : 0);
      const c = world.camera;
      c.position.set(x, EYE_H - 0.05 + ground + bob + Math.sin(t * 1.7) * 0.004, z);
      c.rotation.set(0.08 * (1 - turn) + PLAYER_START.pitch * turn, yaw + Math.sin(t * 0.9) * 0.003 * (1 - walk), 0);
      // 把手转动、开锁
      if (!unlocked && t >= 2.2) { unlocked = true; audio.doorUnlock(); }
      world.door.press(easeO(seg(t, 2.2, 2.5)) * (1 - easeO(seg(t, 3.3, 3.6))));
      // 开门
      if (!swung && t >= 2.5) { swung = true; audio.doorSwing(); }
      world.door.set(easeIO(seg(t, 2.5, 3.7)));
      // 曝光：门一开暖光涌进来，先冲高一点再适应回正常
      const bump = Math.sin(Math.PI * seg(t, 2.6, 4.6));
      world.setExposureMul(1 + 0.3 * bump);
      // 黑场淡入
      inFade.style.opacity = String(1 - easeO(seg(t, 0, 1.2)));
      // 打字：左下角两行，1.2 前打完，3.8 起淡出
      const n1 = Math.floor(seg(t, 0.25, 0.8) * L1.length), n2 = Math.floor(seg(t, 0.75, 1.2) * (L2_PRE.length + L2_TAIL.length));
      inL1.textContent = L1.slice(0, n1);
      inL2.innerHTML = '<b>' + L2_PRE.slice(0, n2) + '</b>' + L2_TAIL.slice(0, Math.max(0, n2 - L2_PRE.length));
      inTxt.style.opacity = String(1 - seg(t, 3.7, 4.2));
    };
  });
}

// ---------- 封面：资源预加载 + 按钮状态 + 声音开关 ----------
// 预加载：背景图、标志、封面字体、礼物图片、3D 世界首帧。全部完成按钮才可点；
// 单个资源失败不卡住（按已完成算），超过 12 秒强制放行。
const cover = (() => {
  const btn = $('start-btn'), label = $('start-label');
  const imgUrls = ['images/cover_bg.jpg', 'images/logo.webp'];
  Object.values(content.containers).forEach(c => c.items.forEach(it => { if (it.image && imgUrls.indexOf(it.image) < 0) imgUrls.push(it.image); }));
  const tasks = [];
  imgUrls.forEach(u => tasks.push(new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = u; })));
  tasks.push(document.fonts && document.fonts.load ? Promise.all([document.fonts.load('700 20px CoverNoto', '开始行动加载中'), document.fonts.load('500 12px CoverNoto', '横屏体验更佳')]).catch(() => {}) : Promise.resolve());
  tasks.push(new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res()))));   // 世界已建好并画过首帧
  // 房间资源（约 6MB）占进度的大头：按下载字节数折算权重 ROOM_W，其余任务各算 1 份
  const ROOM_W = 8;
  let roomFrac = 0, doneSmall = 0, ready = false;
  const show = () => {
    const pct = Math.round((doneSmall + roomFrac * ROOM_W) / (tasks.length + ROOM_W) * 100);
    const p = ready ? 100 : Math.min(99, pct);
    btn.style.setProperty('--p', p + '%');
    label.textContent = '加载中 ' + p + '%';
  };
  // 房间加载失败：读条停住，按钮改成「加载失败，点这里重试」，不会亮出「开始行动」
  const msgEl = $('cv-msg');
  let roomOk = false, failed = false;
  const trackRoom = p => p.then(() => { roomFrac = 1; roomOk = true; failed = false; msgEl.textContent = ''; diag('封面：房间加载完成'); }, e => {
    console.error(e); failed = true; diag('封面：加载失败 ' + (e && e.message));
    label.textContent = '加载失败，点这里重试';
    btn.disabled = false; btn.classList.add('is-failed');
    msgEl.textContent = '无法下载：' + ((e && e.file) || '未知文件') + '（' + ((e && e.reason) || (e && e.message) || '未知原因') + '）';
    msgEl.classList.add('is-err');
  });
  const roomTask = trackRoom(world.ready);
  world.onProgress(f => { roomFrac = f; if (!failed) show(); });
  const retry = () => {
    if (!failed) return;
    failed = false; roomFrac = 0; btn.disabled = true; btn.classList.remove('is-failed'); msgEl.textContent = ''; msgEl.classList.remove('is-err');
    show(); diag('封面：点击重试');
    trackRoom(world.reload()).then(() => { if (roomOk && !ready && doneSmall >= tasks.length) finish(); });
  };
  const finish = () => {
    if (ready || !roomOk) return; ready = true;
    btn.style.setProperty('--p', '100%');
    label.textContent = '开始行动';
    btn.disabled = false;
    btn.classList.remove('is-loading'); btn.classList.add('is-ready');
  };
  tasks.forEach(t => t.then(() => { doneSmall++; show(); }));
  Promise.all(tasks.concat(roomTask)).then(finish);
  setTimeout(finish, 45000);   // 兜底：封面小图或字体迟迟不回时也放行；但房间没加载好绝不放行（finish 里有判断）
  return { get ready() { return ready; }, get failed() { return failed; }, retry };
})();

const sndBtn = $('snd-btn');
sndBtn.addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  sndBtn.classList.toggle('is-off', audio.isMuted());
  sndBtn.setAttribute('aria-pressed', String(audio.isMuted()));
});

// ---------- 启动页 ----------
$('start-btn').addEventListener('click', () => {
  if (cover.failed) { cover.retry(); return; }
  if (!cover.ready || state !== 'title') return;
  audio.unlock();
  music.prime();
  try { const el = document.documentElement; if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); } catch (e) { /* 静默 */ }
  try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* 静默 */ }
  audio.uiClick();
  $('title').classList.add('gone');
  setTimeout(() => $('title').classList.add('hidden'), 500);
  playIntro();
});

// ---------- 主循环 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  music.update(dt, { active: state !== 'title' && state !== 'intro', x: player.x, z: player.z, ducked: loot.isOpen });
  world.setSpeaker(music.playing, music.level);
  if (state === 'intro') {
    if (introRun) introRun();
    world.update(dt);
    world.render('interior');
  } else if (state !== 'title') {
    updatePlayer(dt);
    updateNear();
    world.update(dt);
    world.render('interior');
  } else {
    world.update(dt);
    world.render('none');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- 调试入口 ----------
if (params.get('debug') === '1') {
  window.__game = {
    content, world, player, ctl, loot, audio, view, music,
    get state() { return state; },
    get searched() { return CONTAINER_IDS.filter(id => loot.status(id) === 'cleared'); },
    teleportTo(id) {
      const s = world.containers[id].stand;
      player.x = s.x; player.z = s.z; player.yaw = s.yaw; player.pitch = s.pitch || 0;
    },
    openContainer(id) { return startSearch(id); },
    requestExit, refreshProgress: updateProgress, get allGot() { return allGot; }, get actionMode() { return actionMode; }, EXIT_POINT,
    skipIntro() { const el = document.querySelector('.in2'); if (el && !el.classList.contains('hidden')) el.dispatchEvent(new Event('pointerdown')); },
    start() { $('start-btn').click(); },
    tickAim() { applyCamera(0); world.camera.updateMatrixWorld(true); aimTick = 0; updateNear(); world.update(0.3); world.update(0.3); },   // 测试用：立即刷新一次瞄准并让淡入淡出走完
  };
}
