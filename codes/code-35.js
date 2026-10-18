// plugins/ultimate_manager.js
// 🚀 المدير الخارق - 5 مهام في كود واحد
// ✦ بروفايل، مجموعات، قنوات، متابعة، أمان
// 🛡️ للمطور فقط - استخدم بحكمة

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'ultimate');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 👑 المطور الأساسي
const MAIN_OWNER = '967736551354';

// ============================================================
// ⚙️ الإعدادات العامة
// ============================================================
const CONFIG = {
    PROFILE_INTERVAL: 10 * 60 * 1000, // تغيير البروفايل كل 10 دقائق (600,000 مللي ثانية)
    CHANNEL_ID: '120363285847738492@newsletter', // قناتك
    MAX_FOLLOW: 5, // عدد القنوات للمتابعة في كل مرة (تجنب الحظر)
};

// ============================================================
// 📊 تخزين الجلسات
// ============================================================
let profileInterval = null;
let isProfileRunning = false;

// ============================================================
// 🎨 1. تغيير بروفايل البوت التلقائي
// ============================================================
async function fetchRandomImage() {
    try {
        const seed = Math.floor(Math.random() * 1000000);
        const url = `https://picsum.photos/seed/${seed}/800/800`;
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (response.data && response.data.length > 1000) {
            return Buffer.from(response.data);
        }
        throw new Error('صورة فارغة');
    } catch (e) {
        return null;
    }
}

async function changeProfile(sock) {
    try {
        const imageBuffer = await fetchRandomImage();
        if (!imageBuffer) return false;
        await sock.updateProfilePicture(sock.user.id, imageBuffer);
        const time = new Date().toLocaleTimeString('ar-EG');
        console.log(chalk.green(`✅ [${time}] تم تغيير بروفايل البوت`));
        return true;
    } catch (e) {
        console.error(chalk.red('❌ فشل تغيير البروفايل:'), e.message);
        return false;
    }
}

export function startAutoProfile(sock) {
    if (isProfileRunning) return false;
    isProfileRunning = true;
    changeProfile(sock);
    profileInterval = setInterval(() => changeProfile(sock), CONFIG.PROFILE_INTERVAL);
    console.log(chalk.cyan(`🖼️ بدء تغيير البروفايل كل ${CONFIG.PROFILE_INTERVAL / 60000} دقائق`));
    return true;
}

export function stopAutoProfile() {
    if (profileInterval) {
        clearInterval(profileInterval);
        profileInterval = null;
        isProfileRunning = false;
        console.log(chalk.yellow('⏹️ تم إيقاف تغيير البروفايل'));
        return true;
    }
    return false;
}

// ============================================================
// 👥 2. إدارة المجموعات (حظر الكل، طرد الكل، منشن الكل)
// ============================================================
async function getGroupMembers(sock, groupId) {
    try {
        const meta = await sock.groupMetadata(groupId);
        return meta.participants.map(p => p.id);
    } catch (e) {
        return [];
    }
}

// حظر جميع الأعضاء (ما عدا المطور والبوت)
async function blockAll(sock, groupId, exclude = []) {
    const members = await getGroupMembers(sock, groupId);
    const toBlock = members.filter(m => !exclude.includes(m) && m !== sock.user.id);
    let blocked = 0;
    for (const member of toBlock.slice(0, 20)) { // حد أقصى 20 لتجنب الحظر
        try {
            await sock.updateBlockStatus(member, 'block');
            blocked++;
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {}
    }
    return blocked;
}

// طرد جميع الأعضاء (ما عدا المطور والبوت) - للمجموعات
async function kickAll(sock, groupId, exclude = []) {
    const members = await getGroupMembers(sock, groupId);
    const toKick = members.filter(m => !exclude.includes(m) && m !== sock.user.id);
    let kicked = 0;
    for (const member of toKick.slice(0, 10)) { // حد أقصى 10 لتجنب الحظر
        try {
            await sock.groupParticipantsUpdate(groupId, [member], 'remove');
            kicked++;
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {}
    }
    return kicked;
}

// منشن جميع الأعضاء
async function tagAll(sock, groupId, message = '👥 أعضاء المجموعة') {
    const members = await getGroupMembers(sock, groupId);
    const mentions = members.filter(m => m !== sock.user.id);
    await sock.sendMessage(groupId, {
        text: `${message}\n${mentions.map(m => `@${m.split('@')[0]}`).join(' ')}`,
        mentions: mentions,
    });
    return mentions.length;
}

// ============================================================
// ❤️ 3. وضع إعجابات عشوائية على القناة
// ============================================================
async function getLastChannelMessages(sock, channelId, limit = 3) {
    try {
        const result = await sock.query({
            tag: 'iq',
            attrs: { to: channelId, type: 'get', xmlns: 'w:newsletter' },
            content: [{ tag: 'messages', attrs: { limit: limit } }]
        });
        if (result?.content?.[0]?.content) {
            return result.content[0].content.map(msg => ({
                id: msg.attrs.id,
                fromMe: msg.attrs.fromMe === 'true',
            }));
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function reactToChannel(sock, channelId, messageId, emoji) {
    try {
        await sock.query({
            tag: 'iq',
            attrs: { to: channelId, type: 'set', xmlns: 'w:newsletter' },
            content: [{ tag: 'react', attrs: { message_id: messageId, emoji: emoji } }]
        });
        return true;
    } catch (e) {
        return false;
    }
}

export async function randomChannelReactions(sock) {
    const emojis = ['❤️', '🔥', '🌟', '💯', '👏', '🎉', '✨', '😍', '👍', '💪'];
    const messages = await getLastChannelMessages(sock, CONFIG.CHANNEL_ID, 3);
    let reacted = 0;
    for (const msg of messages) {
        if (msg.fromMe) continue;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        const success = await reactToChannel(sock, CONFIG.CHANNEL_ID, msg.id, emoji);
        if (success) reacted++;
        await new Promise(r => setTimeout(r, 1000));
    }
    return reacted;
}

// ============================================================
// 📡 4. متابعة قنوات واتساب تلقائياً
// ============================================================
const followedChannels = new Set();

async function followChannel(sock, channelId) {
    try {
        await sock.query({
            tag: 'iq',
            attrs: { to: channelId, type: 'set', xmlns: 'w:newsletter' },
            content: [{ tag: 'follow', attrs: {} }]
        });
        followedChannels.add(channelId);
        return true;
    } catch (e) {
        return false;
    }
}

export async function followRandomChannels(sock, count = CONFIG.MAX_FOLLOW) {
    const knownChannels = [
        '120363285847738492@newsletter',
    ];
    const available = knownChannels.filter(c => !followedChannels.has(c));
    const toFollow = available.slice(0, count);
    let followed = 0;
    for (const channel of toFollow) {
        const success = await followChannel(sock, channel);
        if (success) followed++;
        await new Promise(r => setTimeout(r, 2000));
    }
    return followed;
}

// ============================================================
// 🎯 الأوامر الرئيسية
// ============================================================
let handler = async (m, { conn, text, command }) => {
    const sender = m.sender;
    const from = m.chat;

    // ✅ التحقق: فقط المطور الأساسي
    if (sender.replace(/[^0-9]/g, '') !== MAIN_OWNER.replace(/[^0-9]/g, '')) {
        return conn.sendMessage(from, {
            text: `❌ هذا الأمر للمطور فقط.\n👑 المطور: ${MAIN_OWNER}`
        });
    }

    // ====== 1. البروفايل ======
    if (command === 'بروفايل_ابدأ' || command === 'profile_start') {
        const started = startAutoProfile(conn);
        return m.reply(started ? '✅ *بدأ تغيير البروفايل التلقائي!*' : '⚠️ يعمل بالفعل.');
    }
    if (command === 'بروفايل_أوقف' || command === 'profile_stop') {
        const stopped = stopAutoProfile();
        return m.reply(stopped ? '⏹️ *تم إيقاف تغيير البروفايل.*' : '⚠️ ليس قيد التشغيل.');
    }
    if (command === 'بروفايل_الآن' || command === 'profile_now') {
        await m.reply('⏳ جاري تغيير البروفايل...');
        const success = await changeProfile(conn);
        return m.reply(success ? '✅ تم تغيير البروفايل!' : '❌ فشل التغيير.');
    }

    // ====== 2. المجموعات ======
    if (command === 'حظر_الكل' || command === 'block_all') {
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        const exclude = [sender, conn.user.id];
        await m.reply('⏳ جاري حظر الأعضاء...');
        const count = await blockAll(conn, from, exclude);
        return m.reply(`🚫 *تم حظر ${count} عضو.*`);
    }
    if (command === 'طرد_الكل' || command === 'kick_all') {
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        const exclude = [sender, conn.user.id];
        await m.reply('⏳ جاري طرد الأعضاء...');
        const count = await kickAll(conn, from, exclude);
        return m.reply(`👢 *تم طرد ${count} عضو.*`);
    }
    if (command === 'تاغ_الكل' || command === 'tag_all') {
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        const msg = text || '👥 أعضاء المجموعة';
        const count = await tagAll(conn, from, msg);
        return m.reply(`✅ *تم منشن ${count} عضو.*`);
    }

    // ====== 3. القناة (إعجابات) ======
    if (command === 'تفاعل_قناة' || command === 'channel_react') {
        await m.reply('⏳ جاري التفاعل مع القناة...');
        const count = await randomChannelReactions(conn);
        return m.reply(`❤️ *تم التفاعل مع ${count} رسالة.*`);
    }

    // ====== 4. متابعة القنوات ======
    if (command === 'تابع_قنوات' || command === 'follow_channels') {
        const count = parseInt(text) || CONFIG.MAX_FOLLOW;
        await m.reply(`⏳ جاري متابعة ${count} قناة...`);
        const followed = await followRandomChannels(conn, count);
        return m.reply(`📡 *تم متابعة ${followed} قناة.*`);
    }

    // ====== 5. مساعدة ======
    await m.reply(`🚀 *المدير الخارق*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *الأوامر (للمطور فقط):*\n\n` +
        `🖼️ *البروفايل:*\n` +
        `• .بروفايل_ابدأ - بدء التغيير التلقائي\n` +
        `• .بروفايل_أوقف - إيقاف التغيير\n` +
        `• .بروفايل_الآن - تغيير فوري\n\n` +
        `👥 *المجموعات:*\n` +
        `• .حظر_الكل - حظر جميع الأعضاء\n` +
        `• .طرد_الكل - طرد جميع الأعضاء\n` +
        `• .تاغ_الكل [نص] - منشن الكل\n\n` +
        `❤️ *القناة:*\n` +
        `• .تفاعل_قناة - إعجابات عشوائية\n\n` +
        `📡 *المتابعة:*\n` +
        `• .تابع_قنوات [عدد] - متابعة قنوات\n\n` +
        `⚠️ *استخدم بحذر لتجنب حظر البوت.*`);
};

handler.help = [
    'بروفايل_ابدأ', 'بروفايل_أوقف', 'بروفايل_الآن',
    'حظر_الكل', 'طرد_الكل', 'تاغ_الكل',
    'تفاعل_قناة', 'تابع_قنوات'
];
handler.tags = ['owner'];
handler.command = [
    'بروفايل_ابدأ', 'profile_start',
    'بروفايل_أوقف', 'profile_stop',
    'بروفايل_الآن', 'profile_now',
    'حظر_الكل', 'block_all',
    'طرد_الكل', 'kick_all',
    'تاغ_الكل', 'tag_all',
    'تفاعل_قناة', 'channel_react',
    'تابع_قنوات', 'follow_channels'
];

export default handler;