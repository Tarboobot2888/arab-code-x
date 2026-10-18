
/**
 * 🕋 Holy Quran Downloader (Clean Version) — نيزوكو
 * ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓
 */

import axios from 'axios';
import pkg from '@whiskeysockets/baileys';
const { generateWAMessageFromContent, proto } = pkg;

const myCredit = `< 𝙂𝙊𝙆𝙐 𝘽𝙊𝙏`;

let handler = async (m, { conn, text, usedPrefix, command }) => {
    const args = text ? text.split('|') : [];

    // --- المرحلة 2: تحميل وإرسال السورة بصيغة مستقرة ---
    if (args.length === 4 && args[0] === 'getsurah') {
        const surahNum = args[1];
        const surahName = args[2];
        const ayahsCount = args[3];
        
        await m.react('⏳');
        m.reply(`*_ جـاري تحمـيل سـورة : ${surahName} _*\n*_ عـدد الايـات : ${ayahsCount} _*\n*_ الـقارئ : مشاري العفاسي 🎙️ _*`);

        try {
            const formattedNumber = surahNum.padStart(3, '0');
            const audioUrl = `https://server8.mp3quran.net/afs/${formattedNumber}.mp3`;

            // إرسال المقطع الصوتي فقط بدون أي contextInfo
            await conn.sendMessage(m.chat, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                ptt: false, 
                fileName: `سورة_${surahName}.mp3`
            }, { quoted: m });

            await m.react('✅');
        } catch (e) {
            console.error("Quran Download Error:", e);
            await m.react('❌');
            m.reply("❌ *عذراً، فشل تحميل السورة.*");
        }
        return;
    }

    // --- المرحلة 1: جلب الفهرس وعرض قائمة السور ---
    await m.react('🕋');

    try {
        const res = await axios.get("https://api.alquran.cloud/v1/surah");
        if (!res.data || res.data.code !== 200) throw new Error("API Offline");
        
        const surahs = res.data.data;

        if (text) {
            const search = surahs.find(s => s.name.includes(text) || s.englishName.toLowerCase().includes(text.toLowerCase()) || s.number == text);
            if (search) {
                const rows = [{
                    header: `سورة ${search.name}`,
                    title: `🏮 تحميل السورة`,
                    description: `رقمها: ${search.number} | آياتها: ${search.numberOfAyahs}`,
                    id: `${usedPrefix + command} getsurah|${search.number}|${search.name}|${search.numberOfAyahs}`
                }];

                let msg = generateWAMessageFromContent(m.chat, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                                body: proto.Message.InteractiveMessage.Body.fromObject({ text: `*_ تـم الـعثور على سورة ${search.name} 🕌 _*` }),
                                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: myCredit }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                    buttons: [{
                                        name: "single_select",
                                        buttonParamsJson: JSON.stringify({
                                            title: '🍥 اضغط للتحميل',
                                            sections: [{ title: 'الـنـتـائـج 🕋', rows: rows }]
                                        })
                                    }]
                                })
                            })
                        }
                    }
                }, { quoted: m });
                return await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            }
        }

        const rows = surahs.slice(0, 114).map((s) => ({
            header: `سورة ${s.name}`,
            title: `🕋 ${s.number}. ${s.name}`,
            description: `عدد الآيات: ${s.numberOfAyahs} | ${s.revelationType === 'Meccan' ? 'مكية' : 'مدنية'}`,
            id: `${usedPrefix + command} getsurah|${s.number}|${s.name}|${s.numberOfAyahs}`
        }));

        let caption = `🕋 *الـمـصحـف الـصـوتـي الـكـامـل*\n\n` +
            `*_ اخـتر الـسورة الـتي تـريد تـحميلها مـن الـقائمة 👇 _*\n` +
            `*_ تـم الـتـنسـيق بـصوت مشاري العفاسي 🎙️ _*`;

        let msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.fromObject({ text: caption }),
                        footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: myCredit }),
                        header: proto.Message.InteractiveMessage.Header.fromObject({
                            title: `*_ نـيـزوكـو - الـقـرآن الـكـريم 📖 _*`,
                            hasMediaAttachment: false
                        }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            buttons: [{
                                name: "single_select",
                                buttonParamsJson: JSON.stringify({
                                    title: '🍥 فـهـرس الـسـور',
                                    sections: [{ title: 'اخـتر الـسورة 📚', rows: rows }]
                                })
                            }]
                        })
                    })
                }
            }
        }, { quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('✅');

    } catch (e) {
        console.error(e);
        await m.react('❌');
        m.reply("❌ *حدث خطأ في جلب بيانات السور.*");
    }
}

handler.help = ['سورة'];
handler.tags = ['islam'];
handler.command = /^(سورة|سور|quran)$/i;

export default handler;