
const WHEEL_PRIZES = [
  { id: "sukuna", name: "ريومن سوكونا 👑🩸", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Sukuna&text2=Jujutsu&text3=King", chance: 0.03 },
  { id: "gojo", name: "ساتورو غوجو 👁️⚡", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Gojo&text2=Jujutsu&text3=SixEyes", chance: 0.04 },
  { id: "yuta", name: "يوتا اوكوتسو 🗡️💍", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Yuta&text2=Jujutsu&text3=Rika", chance: 0.05 },
  { id: "toji", name: "توجي فوشيغورو 🗡️👤", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Toji&text2=Jujutsu&text3=Heavenly", chance: 0.06 },
  { id: "geto", name: "سوغورو غيتو 🖤📿", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Geto&text2=Jujutsu&text3=Curses", chance: 0.08 },
  { id: "itadori", name: "يوجي إيتادوري 🔥👊", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Itadori&text2=Jujutsu&text3=BlackFlash", chance: 0.09 },
  { id: "megumi", name: "مغومي فوشيغورو 🐺⛩️", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Megumi&text2=Jujutsu&text3=Shadows", chance: 0.10 },
  { id: "nanami", name: "كينتامي نانامي 👔🗡️", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Nanami&text2=Jujutsu&text3=Ratio", chance: 0.10 },
  { id: "nobara", name: "نوبارا كوغيساكي 🔨", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Nobara&text2=Jujutsu&text3=StrawDoll", chance: 0.10 },
  { id: "inumaki", name: "إينوماكي توغي 🗣️", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Inumaki&text2=Jujutsu&text3=Speech", chance: 0.10 },
  { id: "miwa", name: "كاسومي ميوا ⚔️🔵", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Miwa&text2=Jujutsu&text3=Sword", chance: 0.10 },
  { id: "ijichi", name: "إيجيتشي 👓🚗", type: "ability", image: "https://api.popcat.xyz/welcomecard?background=https://p4.wallpaperbetter.com/wallpaper/705/174/614/jujutsu-kaisen-anime-hd-wallpaper-preview.jpg&text1=Ijichi&text2=Jujutsu&text3=Curtain", chance: 0.05 },
  { id: "exp", name: "+1,500 خبرة XP 💥", type: "exp", amount: 1500, chance: 0.05 },
  { id: "money", name: "+3,000 فلوس 💰", type: "money", amount: 3000, chance: 0.05 }
];

let handler = async (m, { conn }) => {
  const chatId = m.chat;
  const sender = m.sender || m.key?.participant || chatId;
  const pushName = m.pushName || 'مقاتل';

  let user = {};
  if (typeof global.db?.getUser === 'function') {
    user = global.db.getUser(sender) || {};
  } else if (global.db?.data?.users) {
    user = global.db.data.users[sender] || {};
  }

  if (!user.abilities) user.abilities = {};
  if (!user.trainData) user.trainData = { level: 1, exp: 0, money: 500 };

  const rand = Math.random();
  let cumulative = 0;
  let wonPrize = WHEEL_PRIZES[WHEEL_PRIZES.length - 1];

  for (const prize of WHEEL_PRIZES) {
    cumulative += prize.chance;
    if (rand <= cumulative) {
      wonPrize = prize;
      break;
    }
  }

  let resultMsg = '';

  if (wonPrize.type === 'ability') {
    user.abilities[wonPrize.id] = (user.abilities[wonPrize.id] || 0) + 1;
    resultMsg = `حصلت على شخصية **[ ${wonPrize.name} ]**!\nتم إضافتها إلى حقيبتك.`;
  } else if (wonPrize.type === 'exp') {
    user.trainData.exp = (user.trainData.exp || 0) + wonPrize.amount;
    resultMsg = `حصلت على **+${wonPrize.amount} XP** نقاط خبرة!`;
  } else if (wonPrize.type === 'money') {
    user.trainData.money = (user.trainData.money || 0) + wonPrize.amount;
    resultMsg = `حصلت على **+${wonPrize.amount} فلوس**!`;
  }

  if (typeof global.db?.setUser === 'function') {
    global.db.setUser(sender, user);
  } else if (global.db?.data?.users) {
    global.db.data.users[sender] = user;
  }
  if (typeof global.db?.write === 'function') global.db.write();

  const caption = 
`╔═══════════════════════════╗
║ 🎰 *عجلة حظ الجوجوتسو* 🎰 ║
╠═══════════════════════════╣
║ 👤 *المستدعي:* ${pushName}
║ 🎁 *الجائزة:* ${wonPrize.name}
╠═══════════════════════════╣
║ ✨ *النتيجة:* ${resultMsg}
╚═══════════════════════════╝

💡 *لتفقد حقيبتك استخدم:* \`.ادوات\`
💡 *لتفعيل التقنية استخدم:* \`.ادوات تفعيل ${wonPrize.id}\``;

  if (wonPrize.image) {
    await conn.sendMessage(chatId, { image: { url: wonPrize.image }, caption }, { quoted: m });
  } else {
    await conn.sendMessage(chatId, { text: caption }, { quoted: m });
  }
};

handler.help    = ['عجلة', 'spin'];
handler.tags    = ['rpg', 'games'];
handler.command = ['عجلة', 'عجله', 'spin', 'wheel'];

export default handler;