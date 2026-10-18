// ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓
// Developer: Monte Dev

import axios from 'axios';
import * as cheerio from 'cheerio';
import PDFDocument from 'pdfkit';
import { Buffer } from 'buffer';
import { generateWAMessageContent, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

// ============================================================
// الإعدادات الأساسية
// ============================================================
const API_URL = 'https://api.azorafly.com/api/query';
const SITE_URL = 'https://azorafly.com';
const STORAGE_HOST = 'storage.azorafly.com';
const DEFAULT_PAGE_SIZE = 39;

const HEADERS = {
    'Accept': 'text/html,application/json,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar-SD,ar;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Origin': SITE_URL,
    'Pragma': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
};

// تخزين نتائج البحث مؤقتاً لكل مستخدم (دالتك الأصلية والمهمة جداً)
const searchCache = {};

// ============================================================
// دوال مساعدة وسكراب (بنفس كودك الأصلي الدقيق)
// ============================================================

function detailsFromSearchPost(post) {
    if (!post) return null;
    const genres = Array.isArray(post.genres)
        ? post.genres.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
        : [];
    return {
        title: post.postTitle || 'غير معروف',
        image: post.featuredImage || '',
        type: post.seriesType || 'غير معروف',
        status: post.seriesStatus || 'غير معروف',
        rating: post.averageRating ?? 'غير معروف',
        genres,
        description: post.description || post.story || post.synopsis || ''
    };
}

async function searchManhwa(query) {
    const params = {
        page: 1,
        perPage: DEFAULT_PAGE_SIZE,
        view: 'archive',
        searchTerm: query,
        orderBy: 'lastChapterAddedAt',
        orderDirection: 'desc'
    };
    const url = `${API_URL}?${new URLSearchParams(params)}`;
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    return response.data;
}

async function fetchSeriesPage(slug) {
    const url = `${SITE_URL}/series/${slug}`;
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    return response.data;
}

function extractChapters(html, slug) {
    const $ = cheerio.load(html);
    const chapters = {};
    $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const match = href.match(new RegExp(`/series/${slug}/chapter-(\\d+)`));
        if (match) {
            const number = parseInt(match[1]);
            if (number > 0) {
                const absoluteUrl = href.startsWith('http') ? href : `${SITE_URL}${href}`;
                chapters[number] = absoluteUrl;
            }
        }
    });
    return Object.fromEntries(Object.entries(chapters).sort((a, b) => b[0] - a[0]));
}

function extractSeriesDetails(html) {
    const $ = cheerio.load(html);
    const details = {};

    details.title = $('h1.entry-title').text().trim() || $('title').text().trim() || 'غير معروف';
    details.image = $('.entry-image img').attr('src') || $('img.wp-post-image').attr('src') || '';

    $('.post-meta .meta-item').each((i, el) => {
        const label = $(el).find('.label').text().trim();
        const value = $(el).find('.value').text().trim();
        if (label.includes('النوع')) details.type = value;
        if (label.includes('الحالة')) details.status = value;
        if (label.includes('التقييم')) details.rating = value;
    });

    const genres = [];
    $('.genres a').each((i, el) => {
        genres.push($(el).text().trim());
    });
    details.genres = genres;
    details.description = $('.entry-content p').first().text().trim() || '';

    return details;
}

async function fetchChapterImages(chapterUrl) {
    const response = await axios.get(chapterUrl, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const images = [];
    $('img[src]').each((i, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        if (src.includes(STORAGE_HOST) && src.includes('/WP-manga/')) {
            images.push(src);
        }
    });
    return [...new Set(images)];
}

async function downloadImage(url, referer = SITE_URL) {
    const response = await axios.get(url, {
        headers: { Referer: referer },
        responseType: 'arraybuffer',
        timeout: 30000
    });
    return Buffer.from(response.data);
}

async function createPDF(images, title) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let addedPages = 0;
        for (const img of images) {
            try {
                doc.addPage({ margin: 0 });
                doc.image(img, 0, 0, { width: doc.page.width, height: doc.page.height });
                addedPages++;
            } catch (e) {}
        }
        if (addedPages === 0) {
            reject(new Error('لا توجد صور صالحة للفصل'));
        }
        doc.end();
    });
}

// ============================================================
// الأمر الرئيسي (مدمج مع توجيه الأزرار المباشر)
// ============================================================
const handler = async (m, { conn, text, usedPrefix, command }) => {
    const cmd = command.toLowerCase();

    // ==========================================
    // 1. أمر البحث عن المانهوا
    // ==========================================
    if (cmd === 'مانهوا') {
        if (!text) {
            return m.reply(
                `📖 *أمر البحث عن المانهوا*\n\n` +
                `*الاستخدام:*\n${usedPrefix + command} اسم المانهوا\n\n` +
                `*مثال:*\n${usedPrefix + command} Solo Leveling`
            );
        }

        await m.reply('🔍 *جاري البحث عن المانهوا...*');
        await m.react('⏳');

        try {
            const searchData = await searchManhwa(text);
            const posts = searchData.posts || [];

            if (posts.length === 0) {
                return m.reply(`❌ *لم يتم العثور على نتائج للبحث:* "${text}"`);
            }

            // تخزين نتائج البحث للمستخدم (عشان نستخدمها في أمر التفاصيل)
            searchCache[m.sender] = posts;

            const firstResult = posts[0];
            const thumbnail = firstResult.featuredImage || 'https://via.placeholder.com/300x400?text=No+Image';

            const rows = posts.slice(0, 10).map((post, index) => ({
                header: `📖 النتيجة ${index + 1}`,
                title: post.postTitle || 'بدون عنوان',
                description: `📌 ${post.seriesType || 'غير معروف'} | ${post.seriesStatus || 'غير معروف'}`,
                id: `${usedPrefix}تفاصيل-مانهوا ${post.slug}` // 🎯 توجيه مباشر
            }));

            let imageMessage = null;
            try {
                const content = await generateWAMessageContent({ image: { url: thumbnail } }, { upload: conn.waUploadToServer });
                imageMessage = content.imageMessage;
            } catch (e) {}

            const caption = `📖 *نتائج البحث عن:* ${text}\n` +
                `📊 *العدد:* ${posts.length}\n\n` +
                `📌 *النتيجة الأولى:*\n` +
                `🎬 *العنوان:* ${firstResult.postTitle || 'غير معروف'}\n` +
                `📂 *النوع:* ${firstResult.seriesType || 'غير معروف'}\n` +
                `📊 *الحالة:* ${firstResult.seriesStatus || 'غير معروف'}\n` +
                `⭐ *التقييم:* ${firstResult.averageRating || 'غير معروف'}\n\n` +
                `🔽 *اختر المانهوا من القائمة أدناه:*`;

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: { text: caption },
                    footer: { text: '📖 نظام البحث عن المانهوا' },
                    header: imageMessage ? { hasMediaAttachment: true, imageMessage } : { hasMediaAttachment: false },
                    nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📋 قائمة النتائج', sections: [{ title: '📋 اختر المانهوا', rows }] }) }] }
                })}}
            }, { quoted: m });

            await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            await m.react('✅');

        } catch (err) {
            console.error('خطأ في مانهوا:', err.message);
            await m.reply(`❌ *حدث خطأ:* ${err.message}`);
        }
    }

    // ==========================================
    // 2. أمر تفاصيل المانهوا
    // ==========================================
    if (cmd === 'تفاصيل-مانهوا') {
        const slug = text.trim();
        if (!slug) return;

        await m.react('⏳');
        await conn.sendMessage(m.chat, { text: `📖 *جاري تحميل بيانات المانهوا...*` }, { quoted: m });

        try {
            const html = await fetchSeriesPage(slug);
            
            // 🎯 هنا رجعنا نستخدم دالتك الأصلية اللي تسحب التفاصيل الدقيقة من الـ Cache
            const cachedPost = (searchCache[m.sender] || []).find(post => String(post.slug || '') === String(slug));
            const details = detailsFromSearchPost(cachedPost) || extractSeriesDetails(html);
            const chapters = extractChapters(html, slug);

            if (Object.keys(chapters).length === 0) {
                return m.reply('❌ *لم يتم العثور على فصول لهذه المانهوا.*');
            }

            let detailsText = `📖 *${details.title}*\n\n`;
            detailsText += `📂 *النوع:* ${details.type || 'غير معروف'}\n`;
            detailsText += `📊 *الحالة:* ${details.status || 'غير معروف'}\n`;
            detailsText += `⭐ *التقييم:* ${details.rating || 'غير معروف'}\n`;
            if (details.genres && details.genres.length > 0) {
                detailsText += `🏷️ *التصنيفات:* ${details.genres.join('، ')}\n`;
            }
            if (details.description) {
                detailsText += `\n📝 *القصة:*\n${details.description.substring(0, 300)}${details.description.length > 300 ? '...' : ''}\n`;
            }
            detailsText += `\n📌 *عدد الفصول المتاحة:* ${Object.keys(chapters).length}\n`;
            detailsText += `🔽 *اختر الفصل الذي تريد تحميله:*`;

            const chapterKeys = Object.keys(chapters).slice(0, 15);
            const rows = chapterKeys.map(num => ({
                header: `📖 الفصل ${num}`,
                title: `الفصل ${num}`,
                description: `تحميل الفصل ${num} كـ PDF`,
                id: `${usedPrefix}تنزيل-فصل ${slug} ${num}` // 🎯 توجيه مباشر للتنزيل
            }));

            let imageMessage = null;
            if (details.image) {
                try {
                    const content = await generateWAMessageContent({ image: { url: details.image } }, { upload: conn.waUploadToServer });
                    imageMessage = content.imageMessage;
                } catch (e) {}
            }

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: { text: detailsText },
                    footer: { text: '📖 اختر الفصل لتحميله كـ PDF' },
                    header: imageMessage ? { hasMediaAttachment: true, imageMessage } : { hasMediaAttachment: false },
                    nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📋 قائمة الفصول', sections: [{ title: 'قائمة الفصول', rows }] }) }] }
                })}}
            }, { quoted: m });

            await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
            await m.react('✅');

        } catch (err) {
            console.error('خطأ في تحميل المانهوا:', err.message);
            await m.reply(`❌ *حدث خطأ:* ${err.message}`);
        }
    }

    // ==========================================
    // 3. أمر تنزيل الفصل
    // ==========================================
    if (cmd === 'تنزيل-فصل') {
        const parts = text.split(' ');
        if (parts.length < 2) return;
        const slug = parts[0];
        const chapterNum = parts[1];

        await m.react('⏳');
        await conn.sendMessage(m.chat, { text: `⏳ *جاري تحميل الفصل ${chapterNum}...* قد يستغرق 20-40 ثانية` }, { quoted: m });

        try {
            const chapterUrl = `${SITE_URL}/series/${slug}/chapter-${chapterNum}`;
            const images = await fetchChapterImages(chapterUrl);

            if (images.length === 0) {
                return m.reply(`❌ *الفصل ${chapterNum} لا يحتوي على صور قابلة للتحميل.*`);
            }

            await conn.sendMessage(m.chat, { text: `📥 *جاري تحميل ${images.length} صورة...*` }, { quoted: m });

            const imageBuffers = [];
            for (let i = 0; i < images.length; i++) {
                try {
                    const buffer = await downloadImage(images[i], chapterUrl);
                    imageBuffers.push(buffer);
                } catch (e) {
                    console.log(`فشل تحميل الصورة ${i+1}:`, e.message);
                }
            }

            if (imageBuffers.length === 0) {
                return m.reply(`❌ *فشل تحميل صور الفصل ${chapterNum}.*`);
            }

            await conn.sendMessage(m.chat, { text: `📄 *جاري إنشاء PDF...*` }, { quoted: m });

            const pdfBuffer = await createPDF(imageBuffers, `${slug}-chapter-${chapterNum}`);
            const fileName = `${slug}_chapter_${chapterNum}.pdf`;

            await conn.sendMessage(m.chat, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: fileName,
                caption: `📖 *تم تحميل الفصل ${chapterNum} بنجاح!*\n\n` +
                    `📚 *المانهوا:* ${slug}\n` +
                    `📄 *الفصل:* ${chapterNum}\n` +
                    `🖼️ *عدد الصور:* ${imageBuffers.length}\n\n*⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓*`
            }, { quoted: m });

            await m.react('✅');

        } catch (err) {
            console.error('خطأ في تحميل الفصل:', err.message);
            await m.reply(`❌ *حدث خطأ أثناء تحميل الفصل:* ${err.message}`);
        }
    }
};

handler.command = /^(مانهوا|تفاصيل-مانهوا|تنزيل-فصل)$/i;
handler.help = ['مانهوا <اسم>'];
handler.tags = ['downloader'];

export default handler;
