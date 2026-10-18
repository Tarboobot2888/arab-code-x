'use strict';

import axios from 'axios';
import {
    generateWAMessageFromContent,
    proto,
    isJidGroup
} from "@whiskeysockets/baileys";

const BASE = 'https://spotsaver.net';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': BASE,
    'Referer': `${BASE}/spotify-track-downloader/`
};

/* ───────────── توليد أوامر التحميل ───────────── */
const DL_COMMANDS = [];
for (let i = 0; i < 20; i++) DL_COMMANDS.push(`spdl${i}`);
DL_COMMANDS.push('spdlall');

/* ───────────── Native Flow Nodes ───────────── */

function getPrivacyModeTs() {
    return (
        Math.floor(Date.now() / 1000) - 77980457
    ).toString();
}

function buildMixedNativeFlowBizNode() {
    return {
        tag: "biz",
        attrs: {
            actual_actors: "2",
            host_storage: "2",
            privacy_mode_ts: getPrivacyModeTs()
        },
        content: [
            {
                tag: "interactive",
                attrs: { type: "native_flow", v: "1" },
                content: [
                    { tag: "native_flow", attrs: { v: "9", name: "mixed" } }
                ]
            },
            {
                tag: "quality_control",
                attrs: { source_type: "third_party" }
            }
        ]
    };
}

/* ───────────── Helpers ───────────── */

async function fetchSpotify(query) {
    const isUrl = /^https?:\/\//i.test(query);
    const params = isUrl ? { url: query } : { q: query };

    const response = await axios.get(`${BASE}/api/spotify/`, {
        params,
        headers: HEADERS,
        timeout: 30000
    });

    return {
        type: response.data?.type || 'track',
        items: response.data?.items || []
    };
}

async function getVideoId(title, artist) {
    const response = await axios.post(
        `${BASE}/api/get-id/`,
        { title, artist },
        {
            headers: { ...HEADERS, 'Content-Type': 'application/json' },
            timeout: 20000
        }
    );

    if (!response.data?.success || !response.data?.videoId) {
        throw new Error('ما لقيناش صوت على YouTube');
    }
    return response.data.videoId;
}

async function getDownloadUrl(videoId, title) {
    const response = await axios.post(
        `${BASE}/api/download/`,
        {
            videoId,
            candidateIds: [],
            format: 'mp3',
            title,
            licenseKey: null
        },
        {
            headers: { ...HEADERS, 'Content-Type': 'application/json' },
            timeout: 40000
        }
    );

    if (!response.data?.success || !response.data?.downloadUrl) {
        throw new Error('فشل تجهيز الرابط');
    }
    return response.data.downloadUrl;
}

async function downloadAudio(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, Referer: `${BASE}/` },
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const buffer = Buffer.from(response.data);
    if (buffer.length < 5000) throw new Error('الملف صغير');
    return buffer;
}

function formatDuration(seconds) {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ───────────── إرسال قائمة تفاعلية ───────────── */

async function sendSpotifyList(sock, from, mek, { title, items, isAlbum }) {
    const sections = [];

    if (isAlbum) {
        sections.push({
            title: '📦 تحميل الكل',
            rows: [
                {
                    title: `تحميل ${items.length} صوتية (ZIP)`,
                    description: 'كل الأغاني في ملف مضغوط',
                    id: 'spdlall'   // ✅ كلمة واحدة إنجليزي
                }
            ]
        });
    }

    sections.push({
        title: '🎵 الأغاني',
        rows: items.slice(0, 20).map((song, i) => ({
            title: `${i + 1}. ${song.title}`.slice(0, 60),
            description:
                `🚹 ${song.artist}`.slice(0, 55) +
                (song.duration ? ` | ⏱️ ${formatDuration(song.duration)}` : ''),
            id: `spdl${i}`   // ✅ كلمة واحدة إنجليزي
        }))
    });

    const bodyText =
        `🎵 *${title}*\n` +
        `───────────────\n\n` +
        `  📊 عدد الصوتيات: ${items.length}\n` +
        `  اختر أغنية من القائمة تحت 👇\n\n` +
        `───────────────`;

    const button = proto.Message
        .InteractiveMessage
        .NativeFlowMessage
        .NativeFlowButton
        .create({
            name: "single_select",
            buttonParamsJson: JSON.stringify({
                title: "🎵 اختر أغنية",
                sections,
                has_multiple_buttons: true
            })
        });

    const interactiveMessage = proto.Message
        .InteractiveMessage
        .create({
            body: proto.Message.InteractiveMessage.Body.create({ text: bodyText }),
            footer: proto.Message.InteractiveMessage.Footer.create({
                text: "𓂃 ࣪˖ ִֶָ⚜️ VOX BOT ♖ ִֶָ ˖ ࣪"
            }),
            header: proto.Message.InteractiveMessage.Header.create({
                title: "🎵 Spotify Downloader",
                hasMediaAttachment: false
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                messageVersion: 1,
                messageParamsJson: "{}",
                buttons: [button]
            })
        });

    const msg = generateWAMessageFromContent(
        from,
        {
            viewOnceMessage: {
                message: { interactiveMessage }
            }
        },
        {
            quoted: mek,
            userJid: sock.user?.id
        }
    );

    const bizNode = buildMixedNativeFlowBizNode();
    const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
    const additionalNodes = isJidGroup(from) ? [bizNode] : [botNode, bizNode];

    await sock.relayMessage(
        from,
        msg.message,
        {
            messageId: msg.key.id,
            additionalNodes
        }
    );
}

/* ───────────── تحميل أغنية ───────────── */

async function downloadOne(sock, from, mek, item) {
    const react = (emoji) =>
        sock.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});
    const reply = (text) =>
        sock.sendMessage(from, { text }, { quoted: mek });

    await react('📀');

    const wait = await sock.sendMessage(from, {
        text:
            `🎵 *${item.title}*\n` +
            `🚹 ${item.artist}\n\n` +
            `⚙️ *جاري التحميل...*`
    }, { quoted: mek });

    try {
        const videoId = await getVideoId(item.title, item.artist);
        const downloadUrl = await getDownloadUrl(
            videoId,
            `${item.title} - ${item.artist}`
        );
        const audioBuffer = await downloadAudio(downloadUrl);

        try { await sock.sendMessage(from, { delete: wait.key }); } catch {}

        let caption = `🎵 *${item.title}*\n`;
        caption += `🚹 *الأسم:* ${item.artist}\n`;
        if (item.album) caption += `📀 *الألبوم:* ${item.album}\n`;
        if (item.duration) caption += `⏱️ *المدة:* ${formatDuration(item.duration)}\n`;
        caption +=
            `📦 *الحجم:* ${formatSize(audioBuffer.length)}\n\n` +
            `𓂃 ࣪˖ ִֶָ⚜️ VOX BOT ♖ ִֶָ ˖ ࣪`;

        await reply(caption);

        await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${item.title} - ${item.artist}.mp3`,
            ptt: false
        }, { quoted: mek });

        await react('✅');
    } catch (error) {
        console.error('[Spotify DL]', error?.message || error);
        try { await sock.sendMessage(from, { delete: wait.key }); } catch {}
        await react('❌');
        await reply(`❌ ${error?.message || error}`);
    }
}

/* ───────────── تحميل الكل ZIP ───────────── */

async function downloadMany(sock, from, mek, items, title, type) {
    const react = (emoji) =>
        sock.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});
    const reply = (text) =>
        sock.sendMessage(from, { text }, { quoted: mek });

    await react('🗃');

    const wait = await sock.sendMessage(from, {
        text:
            `📦 *${title}*\n` +
            `📊 *${items.length}* صوتيات\n\n` +
            `⏳ *جاري تجهيز ZIP...*`
    }, { quoted: mek });

    try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        let success = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                await sock.sendMessage(from, {
                    text:
                        `📦 *${title}*\n\n` +
                        `📀 جاري تحميل ${i + 1}/${items.length}\n` +
                        `🎵 ${item.title}`,
                    edit: wait.key
                });

                const videoId = await getVideoId(item.title, item.artist);
                const downloadUrl = await getDownloadUrl(
                    videoId,
                    `${item.title} - ${item.artist}`
                );
                const buffer = await downloadAudio(downloadUrl);

                const safeName = (
                    `${String(i + 1).padStart(2, '0')} - ` +
                    `${item.title} - ${item.artist}.mp3`
                ).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 150);

                zip.file(safeName, buffer);
                success++;
            } catch (error) {
                console.error('Item failed:', item.title, error?.message || error);
            }
            await new Promise((r) => setTimeout(r, 1000));
        }

        if (!success) throw new Error('فشل تحميل كل صوتيات');

        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'STORE'
        });

        const sizeMB = (buffer.length / 1048576).toFixed(2);
        const fileName = `${type}_${Date.now()}.zip`;

        try { await sock.sendMessage(from, { delete: wait.key }); } catch {}

        await sock.sendMessage(from, {
            document: buffer,
            mimetype: 'application/zip',
            fileName,
            caption:
                `📦 *${title}*\n` +
                `✅ *تم التحميل:* ${success}/${items.length}\n` +
                `📁 *الحجم:* ${sizeMB} MB\n\n` +
                `𓂃 ࣪˖ ִֶָ⚜️ VOX BOT ♖ ִֶָ ˖ ࣪`
        }, { quoted: mek });

        await react('✅');
    } catch (error) {
        console.error('[Spotify Bulk]', error?.message || error);
        try { await sock.sendMessage(from, { delete: wait.key }); } catch {}
        await react('❌');
        await reply(`❌ ${error?.message || error}`);
    }
}

/* ───────────── Cache ───────────── */

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;

/* ───────────── Plugin ───────────── */

export default {
    name: 'سبوتي',
    command: ['سبوتي', 'spotify', 'سبوتيفاي', ...DL_COMMANDS],
    category: 'media',
    dev: false,

    handler: async (sock, mek, ctx) => {
        const { from, args, q, prefix = '.' } = ctx;

        const sender =
            mek?.key?.participant ||
            mek?.key?.remoteJid ||
            from;

        const reply = (text) =>
            sock.sendMessage(from, { text }, { quoted: mek });

        const react = (emoji) =>
            sock.sendMessage(from, {
                react: { text: emoji, key: mek.key }
            }).catch(() => {});

        /* ───── كشف أمر التحميل من عدة مصادر ───── */
        const sources = [
            mek?.message?.conversation,
            mek?.message?.extendedTextMessage?.text,
            q,
            Array.isArray(args) ? args.join(' ') : '',
            mek?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
        ].filter(Boolean);

        let dlArg = null;
        for (const src of sources) {
            const m = String(src).match(/spdl(\d+|all)/i);
            if (m) { dlArg = m[1].toLowerCase(); break; }
        }

        /* ───── تحميل الكل ───── */
        if (dlArg === 'all') {
            const cache = CACHE.get(sender);
            if (!cache || !cache.items.length) {
                await react('❌');
                return reply('❌ انتهت صلاحية النتائج');
            }
            return downloadMany(
                sock, from, mek,
                cache.items,
                cache.title || 'Spotify',
                cache.type
            );
        }

        /* ───── تحميل أغنية معينة ───── */
        if (dlArg !== null) {
            const index = Number.parseInt(dlArg, 10);
            const cache = CACHE.get(sender);

            if (!cache || !cache.items[index]) {
                await react('❌');
                return reply('❌ انتهت صلاحية النتائج');
            }
            if (Date.now() - cache.time > CACHE_TTL) {
                CACHE.delete(sender);
                await react('❌');
                return reply('⏰ انتهت صلاحية النتائج');
            }
            return downloadOne(sock, from, mek, cache.items[index]);
        }

        /* ───── بحث ───── */
        const text = (q || (Array.isArray(args) ? args.join(' ') : '')).trim();

        if (!text) {
            return reply(
                `🎵 *Spotify Downloader*\n\n` +
                `📌 *الاستخدام:*\n` +
                `• \`${prefix}سبوتي <اسم صوت>\`\n` +
                `• \`${prefix}سبوتي <رابط Spotify>\`\n\n` +
                `💡 *أمثلة:*\n` +
                `• \`${prefix}سبوتي imagine dragons\`\n` +
                `• \`${prefix}سبوتي عمرو دياب\``
            );
        }

        await react('🔍');

        try {
            const result = await fetchSpotify(text);
            const items = result.items;

            if (!items.length) {
                await react('❌');
                return reply('❌ مفيش نتايج');
            }

            if (result.type === 'track' && items.length === 1) {
                CACHE.set(sender, { items, type: 'track', time: Date.now() });
                return downloadOne(sock, from, mek, items[0]);
            }

            const isAlbum = result.type === 'album' || result.type === 'playlist';
            const shown = items.slice(0, 20);

            CACHE.set(sender, {
                items: shown,
                type: result.type,
                title: text.slice(0, 50),
                time: Date.now()
            });

            const title =
                result.type === 'album' ? 'الألبوم' :
                result.type === 'playlist' ? 'قائمة التشغيل' :
                'نتائج البحث';

            await sendSpotifyList(sock, from, mek, {
                title: `${title}: ${text.slice(0, 40)}`,
                items: shown,
                isAlbum
            });

            await react('✅');
        } catch (error) {
            console.error('[Spotify Search]', error?.message || error);
            await react('❌');
            await reply(`❌ ${error?.message || error}`);
        }
    }
};