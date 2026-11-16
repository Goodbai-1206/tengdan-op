// 内容规整：把 content.js 里用户填的内容补上默认值，缺字段、写错都不会白屏。

export const CONTAINER_IDS = ['desk', 'wardrobe', 'chest'];
export const RARITY_KEYS = ['white', 'green', 'blue', 'purple', 'gold', 'red'];

const DEFAULT_NAMES = { desk: '书桌抽屉', wardrobe: '衣柜', chest: '床脚储物箱' };

function str(v, fallback) {
  return (typeof v === 'string' && v.trim() !== '') ? v : fallback;
}

function normalizeItem(raw) {
  const it = (raw && typeof raw === 'object') ? raw : {};
  let size = Array.isArray(it.size) ? it.size : [1, 1];
  const w = Math.min(5, Math.max(1, Math.round(Number(size[0]) || 1)));
  const h = Math.min(3, Math.max(1, Math.round(Number(size[1]) || 1)));
  let image = typeof it.image === 'string' && it.image.trim() ? it.image.trim() : '';
  if (image && !/^(https?:)?\/\//.test(image) && image.indexOf('/') < 0) image = 'images/' + image;
  // value：可选的价值数字，没填或不是数字就是 null
  const vn = (it.value === '' || it.value == null) ? NaN : Number(it.value);
  return {
    name: str(it.name, '神秘物品'),
    rarity: RARITY_KEYS.indexOf(it.rarity) >= 0 ? it.rarity : 'white',
    text: str(it.text, ''),
    emoji: str(it.emoji, '🎁'),
    image,
    size: [w, h],
    value: Number.isFinite(vn) && vn >= 0 ? vn : null,
  };
}

export function normalizeContent(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  const containers = {};
  const cs = (c.containers && typeof c.containers === 'object') ? c.containers : {};
  for (const id of CONTAINER_IDS) {
    const src = cs[id] || {};
    let items = Array.isArray(src.items) ? src.items.map(normalizeItem) : [];
    if (!items.length) items = [normalizeItem({ name: '空空的', text: '这里什么都没有，请在 content.js 里填写物品。' })];
    containers[id] = { id, name: str(src.name, DEFAULT_NAMES[id]), items };
  }
  return {
    codename: str(c.codename, '腾诞日行动'),
    subtitle: typeof c.subtitle === 'string' ? c.subtitle : '',   // 封面已不再显示
    mapName: str(c.mapName, '温暖小屋'),
    containers,
  };
}
