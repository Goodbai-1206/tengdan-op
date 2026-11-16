/* ============================================================
   这是整个小游戏里「你要改的内容」，其他文件都不用动。
   用记事本或任何文本编辑器打开，改引号 "" 里面的文字就行。
   改完保存，刷新网页就能看到。

   【怎么填】
   - 每一行末尾的英文逗号 , 不要删。
   - 文字必须写在英文双引号 "" 里面。引号本身不要换成中文引号。
   - 文字里需要换行时，写 \n 就行。

   【稀有度 rarity 只能填下面六个词之一（小写英文）】
     "white"  普通（白）
     "green"  优良（绿）
     "blue"   精良（蓝）
     "purple" 稀有（紫）
     "gold"   传奇（金）
     "red"    至臻（红，最稀有，出现时有大动静，建议放最珍贵的礼物）

   【物品怎么写】每件物品是一对大括号 { ... }，包含：
     name    物品名字，比如 "一张电影票"
     rarity  稀有度，见上面
     text    收礼人点开这件物品时看到的一段话，随便写
     emoji   用一个表情当图标，比如 "🎬"。不想用图片时填它
     image   （可选）想用自己的图片：把图片文件放进 images 文件夹，
             这里填文件名，比如 "gift_cushion.webp"。推荐透明底图标，
             会完整显示在格子里（不裁切）。填了图片就不显示 emoji
     size    （可选）物品占几格 [宽, 高]，默认 [1, 1]。
             比如 [2, 1] 表示横着占 2 格，[1, 2] 表示竖着占 2 格
     value   （可选）物品的"价值"，填一个数字，比如 1280。填了的物品，
             背包格子右下角会显示这个数字，顶部"本次收获"会把背包里的价值加起来。
             只要有一件物品填了，就会显示价值；一件都不填，所有价值相关的显示都会隐藏。
   物品顺序就是翻开的顺序。每个容器放 3 件左右最合适，
   想多放也可以（最多约 15 格），想少放也行。

   【三个容器】desk（沙发上的衣服堆）、wardrobe（衣柜）、chest（床头柜抽屉）。
   这三个名字不要改，只改里面的 name 和 items。
   ============================================================ */

window.GIFT_CONTENT = {
  // 行动代号：网页标题（浏览器标签页）用。封面上的标志是图片 images/logo.webp，改名需要换那张图
  codename: "腾诞日行动",
  // 副标题：封面已不再显示，字段留空即可，不用填
  subtitle: "",

  // 地图名称：进入房间时屏幕中央出现的大字
  mapName: "暖光小屋",

  containers: {
    // 沙发上的衣服堆（程序里的代号仍叫 desk，不要改）
    desk: {
      name: "沙发上的衣服堆",
      items: [
        { name: "小蓝坐垫", rarity: "green", emoji: "🛵", image: "gift_cushion.webp", size: [2, 2], value: 30, text: "虽然没有选择换新载具，小小的也可以守护雨天腾的 PP 保持干燥~" },
        { name: "电动车电池", rarity: "purple", emoji: "🔋", image: "gift_battery.webp", size: [3, 2], value: 200, text: "没错，这个需要去线下电动车门店更换兑现，希望可以让蓝重焕生机" },
        { name: "按摩券", rarity: "gold", emoji: "💆", image: "gift_massage.webp", value: 120, text: "和柏一起去盲人按摩一次" },
        { name: "洗浴券", rarity: "gold", emoji: "🛁", image: "gift_bath.webp", value: 200, text: "冬天泡个澡吧" },
      ],
    },
    // 衣柜（最后一格放最珍贵的礼物）
    wardrobe: {
      name: "衣柜",
      items: [
        { name: "眼影盘", rarity: "purple", emoji: "🎨", image: "gift_eyeshadow.webp", size: [2, 2], value: 350, text: "冷月一代新版，Qtun 指名的不是便宜的眼影" },
        { name: "吉小娃", rarity: "gold", emoji: "🐶", image: "gift_jixiaowa.webp", size: [1, 2], value: 99, text: "鬼迷日眼，吐着舌头，像谁我不说的；dobby is free~" },
        { name: "美味潮汕火锅料理", rarity: "red", emoji: "🍲", image: "gift_hotpot.webp", size: [3, 3], value: 1000, text: "好吧这个可能确实是柏也挺馋的" },
      ],
    },
    // 床头柜抽屉（程序里的代号仍叫 chest，不要改）
    chest: {
      name: "床头柜抽屉",
      items: [
        { name: "关于腾的100个冷知识", rarity: "white", emoji: "🐷", image: "gift_magazine.webp", size: [2, 2], value: 0.1, text: "每天更了解你一点" },
        { name: "新比手机壳", rarity: "green", emoji: "📱", image: "gift_case_bi.webp", value: 20, text: "没错又又是比，普通的手机壳，但清爽利落" },
        { name: "料理楚王手机壳", rarity: "blue", emoji: "📱", image: "gift_case_chu.webp", value: 40, text: "已发送；已成独爪的小楚手机壳（没有腾能当楚的意思）" },
        { name: "巧克力蛋糕", rarity: "blue", emoji: "🍰", image: "gift_cake.webp", size: [2, 2], value: 200, text: "网友说品控口味不输很多私房蛋糕，试试" },
        { name: "奶茶券", rarity: "purple", emoji: "🧋", image: "gift_milktea.webp", value: 70, text: "可以兑换 1 杯免罚奶茶，由柏买单" },
        { name: "拼豆券", rarity: "purple", emoji: "❤️", image: "gift_perler.webp", value: 100, text: "爱拼才会赢 要继续挑战自己" },
      ],
    },
  },
};
