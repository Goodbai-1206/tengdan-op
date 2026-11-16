// 纪念图：不用第三方截图库，直接用 canvas 把结算画面画成一张 16:9 的横图（1920x1080），便于保存和分享。
// 内容：标志、标题"行动完成"、全部物品格（品质底色 + 图标 + 名字 + 价值）、总价值、当天日期。
const W = 1920, H = 1080;
const FONT = 'LootSans, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const NUM = 'LootNum, "Barlow Condensed", sans-serif';

function loadImg(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function coin(ctx, cx, cy, r, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = r * 0.2; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const d = r * 0.5; ctx.beginPath(); ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d * 0.7, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d * 0.7, cy); ctx.closePath(); ctx.stroke();
  ctx.restore();
}
function fit(ctx, text, maxW) {   // 超宽就加省略号
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
const fmtV = n => { const r = Math.round(n * 10) / 10; return Number.isInteger(r) ? r.toLocaleString('en-US') : r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };

// items: 已排好序的物品；RARITY: loot.js 的品质色表；返回 canvas
export async function buildMemorial(items, RARITY, opts) {
  const { hasValue, total, title = '行动完成', logoSrc = 'images/logo.webp', date = new Date() } = opts;
  try {   // 确保用的字体已加载（和页面是同一套）
    await Promise.all(['700 30px LootSans', '500 24px LootSans', '600 40px LootNum'].map(f => document.fonts.load(f, '行动完成腾诞日0123456789')));
  } catch (e) { /* 静默 */ }
  const [logo, ...imgs] = await Promise.all([loadImg(logoSrc), ...items.map(it => it.image ? loadImg(it.image) : Promise.resolve(null))]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // 背景：近黑炭灰径向渐变 + 很淡的横向暗纹
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.12, 80, W * 0.5, H * 0.4, W * 0.75);
  bg.addColorStop(0, '#2a2c2f'); bg.addColorStop(1, '#0a0b0c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.015)'; for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
  // 顶部：标志 + 标题 + 琥珀下划线
  const PAD = 80;
  if (logo) { const lh = 150, lw = logo.width / logo.height * lh; ctx.drawImage(logo, PAD, 40, lw, lh); }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e6e7e9'; ctx.font = '700 64px ' + FONT; ctx.textAlign = 'right';
  ctx.fillText(title, W - PAD, 130);
  ctx.fillStyle = '#e38901'; ctx.fillRect(W - PAD - 220, 152, 220, 5);
  ctx.textAlign = 'left';
  // 物品格：5 列 x 3 行；最后一行剩下的位置放总价值和日期
  const COLS = 5, GX = 18, GY = 18, gx0 = PAD, gy0 = 214;
  const tw = (W - PAD * 2 - GX * (COLS - 1)) / COLS, th = (H - gy0 - 70 - GY * 2) / 3;
  items.forEach((it, i) => {
    const Rr = RARITY[it.rarity];
    const c = i % COLS, r = (i / COLS) | 0;
    const x = gx0 + c * (tw + GX), y = gy0 + r * (th + GY);
    // 品质色底：由下到上由浓到淡
    const g = ctx.createLinearGradient(0, y + th, 0, y);
    g.addColorStop(0, Rr.q0); g.addColorStop(0.48, Rr.q1); g.addColorStop(1, Rr.q2);
    rr(ctx, x, y, tw, th, 16); ctx.fillStyle = g; ctx.fill();
    const hi = it.rarity === 'gold' || it.rarity === 'red';
    ctx.save(); rr(ctx, x, y, tw, th, 16); ctx.clip();
    if (hi) { const sh = ctx.createRadialGradient(x + tw * 0.3, y, 10, x + tw * 0.3, y, tw * 0.9); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sh; ctx.fillRect(x, y, tw, th); }
    // 图标：完整显示不裁切
    const im = imgs[i];
    if (im) {
      const pw = tw - 36, ph = th - 62, s = Math.min(pw / im.width, ph / im.height);
      const iw = im.width * s, ih = im.height * s;
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      ctx.drawImage(im, x + (tw - iw) / 2, y + 40 + (ph - ih) / 2 - 4, iw, ih);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    // 底部实色边
    ctx.fillStyle = Rr.color; ctx.fillRect(x, y + th - 9, tw, 9);
    ctx.restore();
    ctx.lineWidth = hi ? 3 : 2; ctx.strokeStyle = 'rgba(' + Rr.rgb + ',' + (hi ? 0.95 : 0.6) + ')'; rr(ctx, x + 1, y + 1, tw - 2, th - 2, 15); ctx.stroke();
    // 名字（左上）和价值（右下）
    ctx.textAlign = 'left'; ctx.fillStyle = '#eceded'; ctx.font = '700 26px ' + FONT;
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.fillText(fit(ctx, it.name, tw - 32), x + 16, y + 36);
    if (hasValue && it.value != null) {
      ctx.textAlign = 'right'; ctx.font = '600 38px ' + NUM; ctx.fillStyle = '#e9e0c4';
      const txt = fmtV(it.value); ctx.fillText(txt, x + tw - 16, y + th - 22);
      const w = ctx.measureText(txt).width;
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      coin(ctx, x + tw - 16 - w - 18, y + th - 33, 10, '#f2a21f');
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  });
  // 总价值 + 日期：占最后一行剩下的格位
  const n = items.length, slot = n % COLS === 0 ? n : n; // 下一个空位
  const sc = slot % COLS, sr = (slot / COLS) | 0;
  const bx = gx0 + sc * (tw + GX), by = gy0 + sr * (th + GY), bw = W - PAD - bx;
  rr(ctx, bx, by, bw, th, 16); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fill();
  if (hasValue) {
    ctx.textAlign = 'left';
    coin(ctx, bx + 60, by + th / 2 - 14, 26, '#e38901');
    ctx.fillStyle = '#e6e7e9'; ctx.font = '600 110px ' + NUM;
    ctx.fillText(fmtV(total), bx + 108, by + th / 2 + 24);
  }
  const d = date, ds = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  ctx.textAlign = 'left'; ctx.fillStyle = '#8e9196'; ctx.font = '500 30px ' + NUM; ctx.letterSpacing = '3px';
  ctx.fillText(ds, bx + 36, by + th - 30);
  ctx.letterSpacing = '0px';
  // 底部细线 + 小字
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(142,145,150,.7)'; ctx.font = '500 22px ' + FONT;
  ctx.fillText('腾诞日行动 · 纪念', W / 2, H - 28);
  return cv;
}

export function canvasToBlob(cv) {
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob 失败')), 'image/png'));
}
