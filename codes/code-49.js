

// 🚀 ملف: تهكير.js - محاكاة تهكير (ترفيهي) - 𝒀𝒐𝒕𝒔𝒖𝒃𝒂
//https://whatsapp.com/channel/0029Vb8xTot1t90ks8pCah1O
//*

const EMOJI = '👨🏿‍💻';
const BOT_NAME = '𝒀𝒐𝒕𝒔𝒖𝒃𝒂 - 𝑩𝜺𝑻⃝🎐';
const DEVELOPER = '- ๋࣭ . 𝑴𝒓  • 𝒀𝒐𝒕𝒔𝒖𝒐  •  𝑫𝒆𝒗 ๋࣭';
const CHANNEL_JID = '120363431382129644@newsletter';
const CHANNEL_NAME = '..๋࣭𝒀𝒐𝒕𝒔𝒖𝒃𝒂 • 𝑪𝒉𝒂𝒏𝒏𝒆𝒍.๋࣭';
const CHANNEL_LINK = 'https://whatsapp.com/channel/##########';
const MAIN_IMAGE = 'https://i.ibb.co/nMrq17xX/IMG-20260925-WA0103.jpg';

const CHANNEL_INFO = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: CHANNEL_JID,
            newsletterName: CHANNEL_NAME,
            serverMessageId: -1
        }
    }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ✅ قوائم عشوائية
function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

// ✅ بيانات عشوائية
const randomData = {
    ip: () => `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    location: () => {
        const lat = (Math.random() * 180 - 90).toFixed(4);
        const lng = (Math.random() * 360 - 180).toFixed(4);
        return `${lat}°${lat > 0 ? 'N' : 'S'}, ${lng}°${lng > 0 ? 'E' : 'W'}`;
    },
    ssn: () => Math.floor(Math.random() * 900000000 + 100000000).toString(),
    mac: () => {
        const chars = '0123456789ABCDEF';
        let mac = '';
        for (let i = 0; i < 6; i++) {
            mac += chars[Math.floor(Math.random() * 16)] + chars[Math.floor(Math.random() * 16)];
            if (i < 5) mac += ':';
        }
        return mac;
    },
    device: () => pickRandom(['Android-A15', 'iPhone 15 Pro', 'Samsung Galaxy S24', 'Google Pixel 9', 'OnePlus 12', 'Xiaomi 14']),
    isp: () => pickRandom(['Ucom Universal', 'Orange', 'Maroc Telecom', 'Inwi', 'Vodafone', 'AT&T', 'Verizon', 'T-Mobile']),
    router: () => pickRandom(['Toshiba', 'TP-Link', 'D-Link', 'Netgear', 'Asus', 'Cisco', 'Huawei']),
    port: () => pickRandom(['8080, 80', '443, 8080', '80, 443', '3000, 8080', '22, 443']),
    gateway: () => `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    wan: () => `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
};

const handler = async (m, { conn, text }) => {
    const chatId = m.chat;

    if (!text) {
        const bodyText = `${EMOJI}━━━[ *💻  تهكير* ]━━━${EMOJI}

📌 *طريقة الاستخدام:*
▸ .تهكير @مستخدم

📝 *مثال:*
▸ .تهكير @المستخدم

${EMOJI} *بيانت للمطور فقط*`;

        try {
            await conn.sendButton(chatId, {
                imageUrl: MAIN_IMAGE,
                bodyText: bodyText,
                footerText: `${EMOJI} ${BOT_NAME}`,
                buttons: [
                    {
                        name: 'cta_url',
                        params: {
                            display_text: `${EMOJI} قناة البوت`,
                            url: CHANNEL_LINK
                        }
                    }
                ],
                mentions: [m.sender],
                newsletter: {
                    name: CHANNEL_NAME,
                    jid: CHANNEL_JID
                },
                interactiveConfig: { buttons_limits: 20 }
            }, m);
        } catch (e) {
            await conn.sendMessage(chatId, {
                text: bodyText,
                ...CHANNEL_INFO
            }, { quoted: m });
        }
        return;
    }

    let who;
    if (m.isGroup) {
        who = m.mentionedJid?.[0];
    } else {
        who = m.chat;
    }

    if (!who) {
        return m.reply(`${EMOJI} ❌ *الرجاء الإشارة لمستخدم*`);
    }

    try {
        await conn.sendMessage(chatId, { react: { text: '💻', key: m.key } });

        // ─── مراحل التحميل الوهمي ──────────────────────
        const startMsg = `${EMOJI} *جاري بدء عملية الاختراق...* 🔥`;
        const percentages = [
            pickRandom(['21','22','23','24','25','26','27','28','29','30']),
            pickRandom(['31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','49','50']),
            pickRandom(['51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66','67','68','69','70']),
            pickRandom(['71','72','73','74','75','76','77','78','79','80','81','82','83','84','85','86','87','88','89','90']),
            pickRandom(['91','92','93','94','95','96','97','98','99','100'])
        ];

        const { key } = await conn.sendMessage(chatId, { text: startMsg }, { quoted: m });

        for (const p of percentages) {
            await delay(600);
            await conn.sendMessage(chatId, { text: `${EMOJI} *جاري الاختراق...* ${p}%`, edit: key });
        }

        await delay(500);

        // ✅ بيانات عشوائية جديدة في كل مرة
        const targetName = who.split('@')[0];
        const now = new Date();
        const date = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        const time = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const resultText = `${EMOJI}━━━[ *💻 تم الاختراق بنجاح* ]━━━${EMOJI}

🎯 *المستهدف:* @${targetName}
📅 *التاريخ:* ${date}
⏰ *الوقت:* ${time}

━━━━━━━━━━━━━━━━━━━━━━
📊 *معلومات الاختراق:*

🌐 *IP:* ${randomData.ip()}
📍 *الموقع:* ${randomData.location()}
🔑 *SSN:* ${randomData.ssn()}
🖥️ *الجهاز:* ${randomData.device()}
📶 *ISP:* ${randomData.isp()}
🌍 *DNS:* 8.8.8.8 / 1.1.8.1
🔌 *Gateway:* ${randomData.gateway()}
📡 *Subnet Mask:* 255.255.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}
🔓 *UDP Ports:* ${randomData.port()}
🔒 *TCP Ports:* ${randomData.port()}
🏷️ *MAC:* ${randomData.mac()}
📡 *WAN:* ${randomData.wan()}
🔧 *Router:* ${randomData.router()}
━━━━━━━━━━━━━━━━━━━━━━
💀 *تم اختراق جدار الحماية بنجاح!*

${EMOJI} *${BOT_NAME}*`;

        // ✅ إرسال النتيجة
        try {
            await conn.sendButton(chatId, {
                imageUrl: MAIN_IMAGE,
                bodyText: resultText,
                footerText: `${EMOJI} ${BOT_NAME}`,
                buttons: [
                    {
                        name: 'quick_reply',
                        params: {
                            display_text: `${EMOJI} تهكير جديد`,
                            id: `.تهكير`
                        }
                    },
                    {
                        name: 'cta_url',
                        params: {
                            display_text: `${EMOJI} قناة البوت`,
                            url: CHANNEL_LINK
                        }
                    }
                ],
                mentions: [who],
                newsletter: {
                    name: CHANNEL_NAME,
                    jid: CHANNEL_JID
                },
                interactiveConfig: { buttons_limits: 20 }
            }, m);
        } catch (e) {
            console.log(`${EMOJI} فشل إرسال الأزرار:`, e);
            await conn.sendMessage(chatId, {
                text: resultText,
                mentions: [who],
                ...CHANNEL_INFO
            }, { quoted: m });
        }

        await conn.sendMessage(chatId, { react: { text: '✅', key: m.key } });

    } catch (error) {
        console.error('❌ خطأ في أمر تهكير:', error);
        await conn.sendMessage(chatId, {
            text: `${EMOJI} ❌ *حدث خطأ*\n📌 ${error.message || 'يرجى المحاولة مرة أخرى'}`,
            ...CHANNEL_INFO
        }, { quoted: m });
    }
};

handler.command = ['تهكير', 'هكر', 'دوكس', 'تشفير', 'اختراق'];
handler.category = 'fun';
handler.group = true;

export default handler;