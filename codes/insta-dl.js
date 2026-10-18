import fetch from 'node-fetch';
import crypto from 'node:crypto';
import {
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    proto
} from '@whiskeysockets/baileys';

const API_BASE = 'https://api.savefromins.com/api/contentsite_api';
const API_DOMAIN = 'api-ak.savefromins.com';
const API_AUTH = 'f8a1c2d4';
const API_ORIGIN = 'https://igvideodownloader.net';
const MAX_INLINE_MB = 90;
const REQUEST_TIMEOUT_MS = 60_000;

function aesKeys() {
    
    return [
        `${API_AUTH}${API_AUTH}${API_AUTH}${API_AUTH}`,
        'rz18efAXUbdiaO7k'
    ];
}

function decryptApiData(value) {
    if (typeof value !== 'string' || !value.trim()) return value;

    let lastError;
    for (const keyText of aesKeys()) {
        try {
            const key = Buffer.from(keyText, 'utf8');
            const iv = key.subarray(0, 16);
            const decipher = crypto.createDecipheriv(
                key.length === 16 ? 'aes-128-cbc' : key.length === 24 ? 'aes-192-cbc' : 'aes-256-cbc',
                key,
                iv
            );
            decipher.setAutoPadding(false);
            const plain = Buffer.concat([
                decipher.update(Buffer.from(value.trim(), 'base64')),
                decipher.final()
            ]).toString('utf8').replace(/\0+$/g, '');
            return JSON.parse(plain);
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`تعذر فك استجابة API: ${lastError?.message || 'مفتاح غير صالح'}`);
}

async function readApiResponse(response) {
    const raw = await response.text();
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = raw;
    }

    
    if (parsed && typeof parsed === 'object' && typeof parsed.data === 'string') {
        try {
            parsed.data = decryptApiData(parsed.data);
        } catch {
            
            if (parsed.status === 1) throw new Error('استجابة API مشفرة وغير قابلة للقراءة');
        }
    } else if (typeof parsed === 'string') {
        try {
            parsed = decryptApiData(parsed);
        } catch {
            
        }
    }

    return parsed;
}

function apiHeaders() {
    return {
        accept: '*/*',
        'accept-language': 'ar-SD,ar;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        origin: API_ORIGIN,
        referer: `${API_ORIGIN}/`,
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36'
    };
}

async function apiPost(path, data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const body = new URLSearchParams({
            auth: API_AUTH,
            domain: API_DOMAIN,
            ...data
        });
        const response = await fetch(`${API_BASE}/${path}`, {
            method: 'POST',
            headers: apiHeaders(),
            body,
            signal: controller.signal
        });
        return await readApiResponse(response);
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بخدمة التحليل');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function safeText(value, fallback = '') {
    return String(value || fallback).replace(/[|#\r\n]/g, ' ').trim();
}

function mediaType(resource, parentType = '') {
    const type = String(resource?.type || parentType || '').toLowerCase();
    const format = String(resource?.format || '').toLowerCase();
    if (type === 'audio' || format === 'mp3' || format === 'm4a' || format === 'aac') return 'audio';
    if (type === 'picture' || type === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(format)) return 'image';
    return 'video';
}

function encodeDownloadPayload(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeDownloadPayload(text) {
    const value = String(text || '').trim();
    try {
        return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
        // توافق مع الأزرار القديمة التي كانت تستخدم type|url|title|format.
        const [type, url, title, format] = value.split('|');
        return { type, url, title, format };
    }
}

function buildOptions(data, usedPrefix) {
    const options = [];
    const seen = new Set();
    const mediaItems = Array.isArray(data?.media) ? data.media : [];

    for (const item of mediaItems) {
        const resources = Array.isArray(item?.resources) ? item.resources : [];
        for (const resource of resources) {
            const url = resource?.download_url || '';
            const resourceContent = resource?.resource_content || '';
            if (!url && !resourceContent) continue;

            const type = mediaType(resource, item?.type);
            const format = safeText(resource?.format, type === 'audio' ? 'mp3' : type === 'image' ? 'jpg' : 'mp4');
            const quality = safeText(resource?.quality, 'HD');
            const identity = url || resourceContent;
            if (seen.has(identity)) continue;
            seen.add(identity);

            const size = Number(resource?.size);
            const sizeLabel = Number.isFinite(size) && size > 0
                ? `${(size / (1024 * 1024)).toFixed(2)} MB`
                : 'تحميل مباشر';

            const payload = encodeDownloadPayload({
                type,
                url,
                title: safeText(data?.title, 'Instagram Media'),
                format,
                resourceContent
            });

            options.push({
                title: `${type === 'audio' ? '🎵' : type === 'image' ? '🖼️' : '🎬'} ${quality} · ${format.toUpperCase()}`,
                description: `الحجم: ${sizeLabel}`,
                id: `${usedPrefix}dl_ig_media ${payload}`
            });
        }
    }

    return options.slice(0, 10);
}

async function fetchMedia(url) {
    const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36',
            accept: '*/*',
            referer: 'https://www.instagram.com/'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) throw new Error(`رابط التحميل أعاد HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (/text\/html|application\/json/i.test(contentType)) {
        throw new Error('رابط التحميل منتهي أو أعاد صفحة حماية بدلاً من الميديا');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('الملف المسترجع فارغ');
    return { buffer, contentType };
}

async function sendDownloadedMedia(m, conn, payload) {
    if (!payload?.url) throw new Error('هذا الخيار يحتاج معالجة تحميل إضافية وغير متاح حالياً');

    const { buffer, contentType } = await fetchMedia(payload.url);
    const sizeMb = buffer.length / (1024 * 1024);
    const type = payload.type || mediaType({ format: payload.format });
    const format = String(payload.format || '').toLowerCase();
    const title = safeText(payload.title, 'Instagram Media');

    if (type === 'image') {
        await conn.sendMessage(m.chat, {
            image: buffer,
            caption: `📸 ${title}`
        }, { quoted: m });
        return;
    }

    if (type === 'audio') {
        const mimetype = contentType.startsWith('audio/') ? contentType : 'audio/mpeg';
        if (sizeMb <= MAX_INLINE_MB) {
            await conn.sendMessage(m.chat, { audio: buffer, mimetype, ptt: false }, { quoted: m });
        } else {
            await conn.sendMessage(m.chat, {
                document: buffer,
                mimetype,
                fileName: `Instagram_Audio.${format || 'mp3'}`,
                caption: `🎵 الحجم: ${sizeMb.toFixed(2)} MB`
            }, { quoted: m });
        }
        return;
    }

    const mimetype = contentType.startsWith('video/') ? contentType : 'video/mp4';
    if (sizeMb <= MAX_INLINE_MB) {
        await conn.sendMessage(m.chat, {
            video: buffer,
            mimetype,
            caption: `🎬 ${title}\n📊 الحجم: ${sizeMb.toFixed(2)} MB`
        }, { quoted: m });
    } else {
        await conn.sendMessage(m.chat, {
            document: buffer,
            mimetype,
            fileName: `Instagram_Video.${format || 'mp4'}`,
            caption: `📦 أُرسل كملف لأن الحجم ${sizeMb.toFixed(2)} MB`
        }, { quoted: m });
    }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
    if (command === 'dl_ig_media') {
        if (!text) return;
        await m.react('⏳');
        try {
            await sendDownloadedMedia(m, conn, decodeDownloadPayload(text));
            await m.react('✅');
        } catch (error) {
            console.error('[ig-downloader]', error);
            await m.react('❌');
            await m.reply(`❌ فشل التحميل: ${error.message || 'الرابط منتهي أو محمي.'}`);
        }
        return;
    }

    const link = String(text || '').trim();
    if (!link) {
        return m.reply(`⚠️ أرسل رابط إنستغرام بعد الأمر.\nمثال:\n${usedPrefix + command} https://www.instagram.com/reel/XXXXXX/`);
    }

    await m.react('🔍');
    try {
        const result = await apiPost('media/parse', { origin: 'source', link });
        if (result?.status !== 1 || !result?.data) {
            throw new Error(result?.msg || result?.status_code || 'تعذر تحليل الرابط');
        }

        const options = buildOptions(result.data, usedPrefix);
        if (!options.length) throw new Error('لم تُرجع الخدمة أي جودة قابلة للتحميل');

        let mediaMessage = null;
        if (result.data.thumbnail) {
            try {
                mediaMessage = await prepareWAMessageMedia(
                    { image: { url: result.data.thumbnail } },
                    { upload: conn.waUploadToServer }
                );
            } catch (error) {
                console.warn('[ig-downloader] thumbnail skipped:', error.message);
            }
        }

        const title = safeText(result.data.title, 'Instagram Media').slice(0, 80);
        const interactiveMessage = {
            body: {
                text: `*📸 Instagram Downloader*\n\n📌 *العنوان:* ${title}\n🔗 *الرابط:* ${link}\n\nاختر الجودة أو نوع الملف المطلوب:`
            },
            footer: { text: '✦ ARAB TOP DEV ✦' },
            header: mediaMessage ? {
                hasMediaAttachment: true,
                imageMessage: mediaMessage.imageMessage
            } : { hasMediaAttachment: false },
            nativeFlowMessage: {
                buttons: [{
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                        title: '📥 خيارات التحميل',
                        sections: [{ title: 'الجودات المتاحة', rows: options }]
                    })
                }],
                messageParamsJson: JSON.stringify({
                    bottom_sheet: {
                        list_title: 'اختر الجودة',
                        button_title: 'تحميل'
                    }
                })
            }
        };

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject(interactiveMessage)
                }
            }
        }, { userJid: conn.user.jid, quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('📥');
    } catch (error) {
        console.error('[ig-downloader]', error);
        await m.react('❌');
        await m.reply(`❌ تعذر جلب الميديا: ${error.message || 'خدمة التحليل غير متاحة حالياً.'}`);
    }
};

handler.help = ['انستا'];
handler.tags = ['downloader'];
handler.command = /^(انستا|ig|dl_ig_media)$/i;

export default handler;