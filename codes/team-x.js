/**
 * 📖 Team-X Manga Scraper & Downloader (Fixed Quality & PDF)
 * Developer: Monte Dev
 * ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { Buffer } from 'buffer';
import { generateWAMessageContent, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

// ============================================================
// الإعدادات الأساسية
// ============================================================
const SITE_URL = 'https://olympustaff.com';

const HEADERS = {
    'accept': '*/*',
    'accept-language': 'ar-SD',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'referer': 'https://olympustaff.com/',
    'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    'cookie': '_ga_S18C1WZXWD=GS2.1.s1787162950$o1$g0$t1787162950$j60$l0$h0; _ga=GA1.2.1223847063.1787162951; cf_clearance=ApYlj6CinA5zI7ACkbL9efgXImZejUV_OzFTVRpDK7E-1787162965-1.2.1.1-kJvKA2jOyzXPFvLdFw.kt7NSfMTgQMZoVFS7PrhGaNCdta1t4IuNDbNS2TX582NgKaT7ihVUooF_x6cTDYnsAoWv4HhK8DBIiyM7sbsNQBHpMBgZdPJooi8EQypDv_M3uIohT.GvMJE5Ds56Xg7MqK3bqxOAaDcrr43nXohyiNn0kU9BPTMIOsy_upzhvS92md3XRdV_uOQWStqJAWkXBr_wegfE9.UnfvrVXmbIcovwLoRSaHbFUqyPbf7ZTFT.BRCLIJVV0LMHesmcuupPSYO9sWnYY6JO3NGJLqR8hOv2eeleXPSGMBDJnZ4npj2EmNfafSroXfKF..oksDUzBoh3QdZ9u_803THBy2LnBUo;'
};

const searchCache = {};

// ============================================================
// دوال السكراب
// ============================================================

async function searchTeamX(query) {
    const url = `${SITE_URL}/ajax/search?keyword=${encodeURIComponent(query)}`;
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const results = [];

    $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        if (!href.includes('/series/') || href.includes('/search?')) return;
        
        const title = $(el).find('h4').text().trim();
        if (!title) return;

        // سحب الصورة الأصلية عالية الجودة (تخطي المصغرات)
        let rawImg = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || 'https://via.placeholder.com/300x400?text=No+Image';
        const img = rawImg.replace(/-\d+x\d+\.(jpg|png|jpeg|webp)/i, '.$1');

        const ps = $(el).find('p');
        const type = $(ps[0]).find('span').text().trim() || 'غير معروف';
        const chaptersCount = $(ps[1]).text().trim() || 'غير معروف';
        
        const slug = href.replace(/\/$/, '').split('/').pop();

        if (!results.find(r => r.slug === slug)) {
            results.push({ title, url: href, slug, img, type, chapters: chaptersCount });
        }
    });
    
    return results;
}

async function fetchTeamXChapters(slug) {
    const mangaUrl = `${SITE_URL}/series/${slug}`;
    let chapterList = [];
    let page = 1;

    while (page <= 3) {
        try {
            const url = `${mangaUrl}?page=${page}`;
            const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
            const $ = cheerio.load(response.data);
            let foundNew = false;

            $('a[href]').each((i, el) => {
                const href = $(el).attr('href');
                if (href.includes(`/series/${slug}/`)) {
                    const parts = href.replace(/\/$/, '').split('/');
                    const chapterNum = parts[parts.length - 1];
                    
                    if (chapterNum.replace('.', '').match(/^\d+$/)) {
                        const chapterTitle = $(el).text().trim();
                        if (!chapterList.find(c => c.num === chapterNum)) {
                            chapterList.push({ num: chapterNum, title: chapterTitle, url: href });
                            foundNew = true;
                        }
                    }
                }
            });

            if (!foundNew) break;
            const pagination = $('ul.pagination');
            if (!pagination.length) break;
            
            page++;
        } catch (e) {
            break;
        }
    }
    
    return chapterList.sort((a, b) => parseFloat(b.num) - parseFloat(a.num));
}

async function fetchTeamXImages(chapterUrl) {
    const response = await axios.get(chapterUrl, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const images = [];
    $('img.manga-chapter-img').each((i, el) => {
        const src = $(el).attr('src');
        if (src) images.push(src);
    });
    return [...new Set(images)];
}

async function downloadImage(url, referer = SITE_URL) {
    const response = await axios.get(url, {
        headers: { ...HEADERS, Referer: referer },
        responseType: 'arraybuffer',
        timeout: 30000
    });
    return Buffer.from(response.data);
}

// دالة إنشاء الـ PDF بأبعاد الصور الأصلية
async function createPDF(images, title) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let addedPages = 0;
        for (const imgBuffer of images) {
            try {
                const img = doc.openImage(imgBuffer);
                doc.addPage({
                    size: [img.width, img.height],
                    margin: 0
                });
                doc.image(img, 0, 0, { width: img.width, height: img.height });
                addedPages++;
            } catch (e) {
                console.log('تخطي صورة تالفة أثناء صنع الـ PDF:', e.message);
            }
        }
        
        if (addedPages === 0) reject(new Error('لا توجد صور صالحة للفصل'));
        doc.end();
    });
}

// ============================================================
// الأوامر الرئيسية
// ============================================================
const handler = async (m, { conn, text, usedPrefix, command }) => {
    const cmd = command.toLowerCase();

    // 1. أمر البحث
    if (cmd === 'تيم-اكس') {
        if (!text) {
            return m.reply(
                `📖 *نظام Team-X للمانهوا*\n\n` +
                `*الاستخدام:*\n${usedPrefix + command} اسم المانهوا\n\n` +
                `*مثال:*\n${usedPrefix + command} Solo Leveling`
            );
        }

        await m.reply('🔍 *جاري البحث في Team-X...*');
        await m.react('⏳');

        try {
            const results = await searchTeamX(text);

            if (results.length === 0) {
                return m.reply(`❌ *لم يتم العثور على نتائج للبحث:* "${text}"`);
            }

            searchCache[m.sender] = results;
            const firstResult = results[0];
            const rows = results.slice(0, 10).map((post, index) => ({
                header: `📖 النتيجة ${index + 1}`,
                title: post.title.substring(0, 60),
                description: `📌 ${post.type} | ${post.chapters}`,
                id: `${usedPrefix}تفاصيل-تيم ${post.slug}`
            }));

            let imageMessage = null;
            try {
                const content = await generateWAMessageContent({ image: { url: firstResult.img } }, { upload: conn.waUploadToServer });
                imageMessage = content.imageMessage;
            } catch (e) {}

            const caption = `📖 *نتائج Team-X لـ:* ${text}\n` +
                `📊 *العدد:* ${results.length}\n\n` +
                `📌 *النتيجة الأولى:*\n` +
                `🎬 *العنوان:* ${firstResult.title}\n` +
                `📂 *النوع:* ${firstResult.type}\n` +
                `📚 *الفصول المتاحة:* ${firstResult.chapters}\n\n` +
                `🔽 *اختر المانهوا من القائمة أدناه:*`;

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: { text: caption },
                    footer: { text: '📖 نظام Team-X • Monte Dev' },
                    header: imageMessage ? { hasMediaAttachment: true, imageMessage } : { hasMediaAttachment: false },
                    nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📋 قائمة النتائج', sections: [{ title: '📋 اختر المانهوا', rows }] }) }] }
                })}}
            }, { quoted: m });

            await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            await m.react('✅');

        } catch (err) {
            console.error('خطأ في تيم اكس:', err.message);
            await m.reply(`❌ *حدث خطأ:* ${err.message}`);
        }
    }

    // 2. أمر تفاصيل المانهوا
    if (cmd === 'تفاصيل-تيم') {
        const slug = text.trim();
        if (!slug) return;

        await m.react('⏳');
        await conn.sendMessage(m.chat, { text: `📖 *جاري استخراج الفصول من Team-X...*` }, { quoted: m });

        try {
            const cachedPost = (searchCache[m.sender] || []).find(p => p.slug === slug);
            const chapters = await fetchTeamXChapters(slug);

            if (chapters.length === 0) {
                return m.reply('❌ *لم يتم العثور على فصول لهذه المانهوا.*');
            }

            const title = cachedPost ? cachedPost.title : slug;
            const type = cachedPost ? cachedPost.type : 'غير معروف';
            const img = cachedPost ? cachedPost.img : null;

            let detailsText = `📖 *${title}*\n\n`;
            detailsText += `📂 *النوع:* ${type}\n`;
            detailsText += `📌 *تم العثور على:* ${chapters.length} فصل.\n\n`;
            detailsText += `🔽 *اختر الفصل الذي تريد تحميله:*`;

            const rows = chapters.slice(0, 15).map(c => ({
                header: `📖 الفصل ${c.num}`,
                title: `الفصل ${c.num}`,
                description: c.title.substring(0, 60),
                id: `${usedPrefix}تنزيل-تيم ${slug} ${c.num}`
            }));

            let imageMessage = null;
            if (img) {
                try {
                    const content = await generateWAMessageContent({ image: { url: img } }, { upload: conn.waUploadToServer });
                    imageMessage = content.imageMessage;
                } catch (e) {}
            }

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: { text: detailsText },
                    footer: { text: '📖 اختر الفصل لتحميله كـ PDF' },
                    header: imageMessage ? { hasMediaAttachment: true, imageMessage } : { hasMediaAttachment: false },
                    nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📋 قائمة الفصول', sections: [{ title: 'أحدث الفصول', rows }] }) }] }
                })}}
            }, { quoted: m });

            await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            await m.react('✅');

        } catch (err) {
            console.error('خطأ في تحميل فصول تيم:', err.message);
            await m.reply(`❌ *حدث خطأ:* ${err.message}`);
        }
    }

    // 3. أمر التنزيل وإنشاء الـ PDF
    if (cmd === 'تنزيل-تيم') {
        const parts = text.split(' ');
        if (parts.length < 2) return;
        const slug = parts[0];
        const chapterNum = parts[1];

        await m.react('⏳');
        await conn.sendMessage(m.chat, { text: `⏳ *جاري تحميل الفصل ${chapterNum}...*` }, { quoted: m });

        try {
            const chapterUrl = `${SITE_URL}/series/${slug}/${chapterNum}`;
            const images = await fetchTeamXImages(chapterUrl);

            if (images.length === 0) {
                return m.reply(`❌ *الفصل ${chapterNum} لا يحتوي على صور أو أنه محمي.*`);
            }

            await conn.sendMessage(m.chat, { text: `📥 *تم العثور على ${images.length} صورة، جاري التجميع...*` }, { quoted: m });

            const imageBuffers = [];
            for (let i = 0; i < images.length; i++) {
                try {
                    const buffer = await downloadImage(images[i]);
                    imageBuffers.push(buffer);
                } catch (e) {
                    console.log(`فشل تحميل الصورة ${i+1}:`, e.message);
                }
            }

            if (imageBuffers.length === 0) {
                return m.reply(`❌ *فشل تحميل جميع صور الفصل ${chapterNum}.*`);
            }

            await conn.sendMessage(m.chat, { text: `📄 *جاري إنشاء PDF...*` }, { quoted: m });

            const pdfBuffer = await createPDF(imageBuffers, `${slug}-chapter-${chapterNum}`);
            const fileName = `Team-X_${slug}_Chapter_${chapterNum}.pdf`;

            await conn.sendMessage(m.chat, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: fileName,
                caption: `📖 *تم تحميل الفصل ${chapterNum} بنجاح!*\n\n` +
                    `📚 *المانهوا:* ${slug}\n` +
                    `📄 *الفصل:* ${chapterNum}\n` +
                    `🖼️ *الصور:* ${imageBuffers.length}\n\n*⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓*`
            }, { quoted: m });

            await m.react('✅');

        } catch (err) {
            console.error('خطأ في تحميل الفصل:', err.message);
            await m.reply(`❌ *حدث خطأ أثناء تحميل الفصل:* ${err.message}`);
        }
    }
};

handler.command = /^(تيم-اكس|تفاصيل-تيم|تنزيل-تيم)$/i;
handler.help = ['تيم-اكس <اسم>'];
handler.tags = ['downloader'];

export default handler;
