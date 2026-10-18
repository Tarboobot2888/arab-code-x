/**
 * 🎬 Pinterest Video Search & Carousel
 * Developer: Monte Dev
 * ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓
 */

import axios from 'axios';
import { generateWAMessageFromContent, prepareWAMessageMedia } from '@whiskeysockets/baileys';

// دالة البحث واستخراج الروابط من الـ API الخاص بك
async function fetchPinterestVideos(query, limit = 10) {
    const base = "https://www.pinterest.com";
    const searchQ = query.toLowerCase().includes('video') ? query : `${query} video`;
    
    // جلب ملفات تعريف الارتباط (Cookies)
    let csrf = "62203c66c1926631bb30ec65ec2f5d14";
    let cookieStr = "";
    try {
        let res = await axios.get(base);
        let setCookies = res.headers['set-cookie'] || [];
        cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
        let csrfMatch = cookieStr.match(/csrftoken=([^;]+)/);
        if (csrfMatch) csrf = csrfMatch[1];
    } catch (e) {}

    const source_url = `/search/pins/?q=${encodeURIComponent(searchQ)}&rs=typed`;
    const dataStr = new URLSearchParams({
        source_url: source_url,
        data: JSON.stringify({
            options: { query: searchQ, scope: "pins", auto_correction_disabled: false },
            context: {}
        })
    }).toString();

    try {
        // البحث عن الـ IDs
        let searchRes = await axios.post(`${base}/resource/BaseSearchResource/get/`, dataStr, {
            headers: {
                'cookie': cookieStr,
                'x-csrftoken': csrf,
                'x-requested-with': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const rawText = typeof searchRes.data === 'string' ? searchRes.data : JSON.stringify(searchRes.data);
        const matches = rawText.match(/"id":"(\d{10,})"/g) || [];
        let uniqueIds = [...new Set(matches.map(m => m.replace(/"id":"|"/g, '')))];

        let results = [];
        for (let id of uniqueIds) {
            if (results.length >= limit) break; // التوقف عند الوصول للعدد المطلوب
            
            try {
                let pageUrl = `https://www.pinterest.com/pin/${id}/`;
                // استخدام الـ API الخاص بـ Monte Dev
                let apiUrl = `https://www.monte-dev.online/api/download/pinterest-downloader?url=${encodeURIComponent(pageUrl)}`;
                let apiRes = await axios.get(apiUrl, { timeout: 10000 });
                
                if (apiRes.data && apiRes.data.success && apiRes.data.type === 'video') {
                    results.push({
                        title: apiRes.data.title || 'بدون عنوان',
                        page_url: pageUrl,
                        video_url: apiRes.data.download
                    });
                }
            } catch (e) {
                continue; // تخطي في حال فشل الفحص
            }
        }
        return results;
    } catch (e) {
        console.error('Pinterest Search Error:', e);
        return [];
    }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) {
        return m.reply(`🚩 *يرجى إدخال كلمة البحث!*\nمثال: ${usedPrefix + command} انمي`);
    }

    await m.react('⏳');
    await m.reply('🥝 *جاري البحث و التحمـيل يرجى الانتظـار و الصلاه على نبينا محمد.....*');

    try {
        // جلب الفيديوهات (الحد الأقصى 10 كما طلبت)
        const videos = await fetchPinterestVideos(text, 10);

        if (videos.length === 0) {
            await m.react('❌');
            return m.reply('⚠️ *لم يتم العثور على أي فيديوهات مطابقة.*');
        }

        let cards = [];
        
        // بناء الشريط التفاعلي (Carousel)
        for (let vid of videos) {
            try {
                // تجهيز الفيديو كرسالة ميديا (يتم رفعه لسيرفر واتساب)
                let media = await prepareWAMessageMedia({ video: { url: vid.video_url } }, { upload: conn.waUploadToServer });
                
                cards.push({
                    header: {
                        hasMediaAttachment: true,
                        videoMessage: media.videoMessage
                    },
                    body: { 
                        text: `🎬 *العنوان:* ${vid.title.substring(0, 60)}...\n🔗 *الصفحة:* ${vid.page_url}` 
                    },
                    nativeFlowMessage: {
                        buttons: [
                            {
                                name: "cta_url",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "📥 تحميل مباشر",
                                    url: vid.video_url,
                                    merchant_url: vid.video_url
                                })
                            }
                        ]
                    }
                });
            } catch (err) {
                console.error('فشل في تجهيز أحد الفيديوهات:', err);
            }
        }

        if (cards.length === 0) {
            return m.reply('❌ *حدث خطأ أثناء معالجة الفيديوهات للرسالة التفاعلية.*');
        }

        // إرسال الكاروسيل
        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: {
                        body: {
                            text: `*🎯 نتائج بحث فيديوهات بينترست*\n🔎 *البحث:* ${text}\n📊 *العدد:* ${cards.length}\n\n*⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓*`
                        },
                        carouselMessage: {
                            cards: cards
                        }
                    }
                }
            }
        }, { quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('✅');

    } catch (error) {
        console.error(error);
        await m.react('❌');
        m.reply(`⚠️ *حدث خطأ:* ${error.message}`);
    }
};

handler.help = ['فيديو-بين <كلمة البحث>'];
handler.tags = ['search', 'downloader'];
handler.command = /^(فيديو-بين|بحث-فيديو|pvs)$/i;

export default handler;