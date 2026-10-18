// commands/سكرين.js
import fetch from 'node-fetch';

// قائمة سيرفرات حديثة ومجانية
const SCREENSHOT_APIS = [
  (url) => `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`,
  (url) => `https://image.thum.io/get/width/1280/crop/800/maxAge/1/${url.replace(/^https?:\/\//, '')}`,
  (url) => `https://api.pikwy.com/v1/screenshot?t=1&w=1280&h=800&u=${encodeURIComponent(url)}`,
  (url) => `https://free.pagepeeker.com/v2/thumbs.php?size=x&url=${encodeURIComponent(url)}`
];

export default {
    name: 'سكرين',
    aliases: ['screen', 'screenshot', 'لقطة'],
    category: 'tools',
    description: '📸 التقاط سكرين شوت لموقع',

    async execute(sock, m, args, { cfg }) {
        const chatJid = m.key.remoteJid;
        const senderJid = m.key.participant || m.participant || m.key.remoteJid;
        const comando = 'سكرين';

        // ✅ التحقق من النخبة والمطور 
        const isOwner = cfg.ownerNumber === senderJid;
        const isElite = (cfg.eliteNumbers || []).includes(senderJid);

        if (!isOwner && !isElite) {
            return await sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: m });
        }

        if (!args[0]) {
            return sock.sendMessage(chatJid, {
                text: `📸 *طريقة الاستخدام:*\n.سكرين رابط_الموقع\n\n📝 *مثال:*\n.سكرين google.com`
            }, { quoted: m });
        }

        let url = args[0].trim();
        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }

        await sock.sendMessage(chatJid, { react: { text: '⏳', key: m.key } });

        let success = false;

        for (let i = 0; i < SCREENSHOT_APIS.length; i++) {
            const screenshotUrl = SCREENSHOT_APIS[i](url);

            try {
                const res = await fetch(screenshotUrl, {
                    method: 'GET',
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });

                if (res.ok) {
                    const buffer = await res.buffer();

                    if (buffer.length > 1000) {
                        await sock.sendMessage(chatJid, {
                            image: buffer,
                            caption: `📸 *سكرين شوت*\n🌐 ${url}`
                        }, { quoted: m });

                        success = true;
                        await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });
                        break;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        if (!success) {
            await sock.sendMessage(chatJid, { react: { text: '❌', key: m.key } });
            await sock.sendMessage(chatJid, {
                text: '❌ فشل التقاط الشاشة. حاول مرة أخرى أو تأكد من الرابط.'
            }, { quoted: m });
        }
    }
};
