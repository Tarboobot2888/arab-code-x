import fetch from 'node-fetch';
import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

let handler = async (m, { conn, text, usedPrefix, command }) => {
    // 1️⃣ معالجة الضغط على أزرار التحميل المباشرة (نفس الكود الثاني الثابت مع فحص ذكي للحجم)
    if (command === 'dl_media') {
        if (!text) return;
        let [type, url, title, format] = text.split('|');
        if (!url) return;

        await m.react('⏳');
        
        try {
            // فحص حجم الملف الفعلي من الرابط مباشرة دون التأثير على حجم أزرار الواتساب
            let sizeRes = await fetch(url.trim(), { method: 'HEAD' });
            let contentLength = sizeRes.headers.get('content-length');
            let fileSizeMb = contentLength ? parseFloat((contentLength / (1024 * 1024)).toFixed(2)) : 0;

            if (type === 'video') {
                // ⚡ شرط الـ 90 ميجا اللي طلبته
                if (fileSizeMb > 0 && fileSizeMb <= 90) {
                    await conn.sendMessage(m.chat, {
                        video: { url: url.trim() },
                        caption: `✨ *NEZUKO BOT* ✨\n\n📦 *العنوان:* ${title}\n📊 *الحجم:* ${fileSizeMb} MB`,
                        mimetype: 'video/mp4'
                    }, { quoted: m });
                } else {
                    // أكبر من 90 ميجا يرسل كمستند عرض سريع تلقائياً
                    await conn.sendMessage(m.chat, {
                        document: { url: url.trim() },
                        mimetype: 'video/mp4',
                        fileName: `${title.trim()}.mp4`,
                        caption: `⚠️ *ملاحظة:* تم إرساله كملف لأن حجمه (${fileSizeMb || 'ضخم'}) يتعدى الـ 90 MB.\n\n✨ *NEZUKO BOT*`
                    }, { quoted: m });
                }
            } else if (type === 'audio') {
                if (fileSizeMb > 0 && fileSizeMb <= 90) {
                    await conn.sendMessage(m.chat, {
                        audio: { url: url.trim() },
                        mimetype: 'audio/mp4',
                        ptt: false
                    }, { quoted: m });
                } else {
                    await conn.sendMessage(m.chat, {
                        document: { url: url.trim() },
                        mimetype: 'audio/mpeg',
                        fileName: `${title.trim()}.mp3`,
                        caption: `✨ *NEZUKO BOT* ✨\n🎵 صوت بحجم: ${fileSizeMb} MB`
                    }, { quoted: m });
                }
            }
            await m.react('✅');
        } catch (err) {
            console.error(err);
            await m.react('❌');
            m.reply('❌ فشل إرسال الميديا، السيرفر مضغوط أو الرابط منتهي.');
        }
        return;
    }

    // 2️⃣ الأمر الرئيسي للاستخراج البنيوي ومحاكاة الكود الثاني الناجح (.فيديو)
    if (!text) return m.reply(`⚠️ يرجى إدخال رابط يوتيوب بعد الأمر.\nمثال:\n${usedPrefix + command} https://youtube.com/watch?v=W2o_HupXq1g`);

    await m.react('🔍');

    try {
        const API_URL = 'https://api.vidssave.com/api/contentsite_api/media/parse';
        const headers = {
            'accept': '*/*',
            'accept-language': 'ar-SD',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://vidssave.com',
            'referer': 'https://vidssave.com/',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
        };

        const body = new URLSearchParams({
            'auth': '20250901majwlqo',
            'domain': 'api-ak.vidssave.com',
            'origin': 'cache',
            'link': text.trim()
        });

        let res = await fetch(API_URL, { method: 'POST', headers, body });
        let json = await res.json();

        if (!json.data || !json.data.resources) {
            throw new Error('لم يتم العثور على بيانات للرابط.');
        }

        let { title, thumbnail, resources } = json.data;

        let videoOptions = [];
        let audioOptions = [];

        // رجعنا الـ ID قصير جداً وبسيط زي الكود الثاني عشان يشتغل 100% بدون كراش حروف
        resources.forEach(res => {
            let sizeMb = res.size ? (res.size / (1024 * 1024)).toFixed(2) + ' MB' : 'جاهز للتحميل';
            
            if (res.type === 'video') {
                videoOptions.push({
                    title: `🎬 فيديو جودة [${res.quality}]`,
                    description: `الحجم: ${sizeMb} | الصيغة: ${res.format}`,
                    id: `${usedPrefix}dl_media video|${res.download_url}|${title}|${res.format}`
                });
            } else if (res.type === 'audio') {
                audioOptions.push({
                    title: `🎵 صوت جودة [${res.quality}]`,
                    description: `الحجم: ${sizeMb} | الصيغة: ${res.format}`,
                    id: `${usedPrefix}dl_media audio|${res.download_url}|${title}|${res.format}`
                });
            }
        });

        // تحضير ميديا البوستر للرسالة
        let media;
        try {
            media = await prepareWAMessageMedia(
                { image: { url: thumbnail } },
                { upload: conn.waUploadToServer }
            );
        } catch {
            media = null;
        }

        let bodyText = `*🎥 يـوتـيـوب داونـلـودر 🎥*\n\n` +
                       `📌 *العنوان:* ${title}\n` +
                       `🔗 *الرابط:* ${text.trim()}\n\n` +
                       `⚙️ *معلومة:* الفيديوهات حتى *90 MB* يتم إرسالها كعرض مباشر، وما فوق ذلك كـ ملف حفاظاً على السرعة.`;

        const interactiveMessage = {
            body: { text: bodyText },
            footer: { text: '✦ ✦ 𝐍𝐄𝐙𝐔𝐊𝐎 👑 𝐁𝐎𝐓 ✦' },
            header: media ? {
                hasMediaAttachment: true,
                imageMessage: media.imageMessage,
            } : { hasMediaAttachment: false },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: "🎬 جودات الفيديو المتاحة",
                            sections: [{ title: "🎞️ اختر جودة الفيديو", rows: videoOptions }]
                        })
                    },
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: "🎵 جودات الصوت المتاحة",
                            sections: [{ title: "🎼 اختر جودة الصوت", rows: audioOptions }]
                        })
                    }
                ],
                messageParamsJson: JSON.stringify({
                    bottom_sheet: {
                        list_title: "خيارات التحميل الفورية لشات نيـزوكو",
                        button_title: "تحميل الجودة 📥"
                    }
                })
            }
        };

        const msg = generateWAMessageFromContent(
            m.chat,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject(interactiveMessage)
                    }
                }
            },
            { userJid: conn.user.jid, quoted: m }
        );

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('📥');

    } catch (e) {
        console.error(e);
        await m.react('❌');
        m.reply(`❌ حدث خطأ أثناء جلب البيانات، تأكد من صحة الرابط وحاول مجدداً.`);
    }
};

handler.help = ['فيديو'];
handler.tags = ['downloader'];
handler.command = /^(فيديو|dl_media)$/i;

export default handler;