// plugins/ultimate_manager_v3.js
// 🚀 المدير الخارق 3.0 - منشن وحظر وطرد جميع الأعضاء (بشكل كامل)
// ✦ يعمل مع مجموعات كبيرة (أكثر من 500 عضو) عبر التقسيم إلى دفعات
// 🛡️ للمطور فقط - محمي بكلمة مرور

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'ultimate_v3');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// 👑 المطور الأساسي
// ============================================================
const MAIN_OWNER = '447475774418';

// ============================================================
// 🔑 كلمة المرور
// ============================================================
const SECRET_PASSWORD = 'MyUltimateBot2026@Secure';

// ============================================================
// ⚙️ الإعدادات العامة
// ============================================================
const CONFIG = {
    PROFILE_INTERVAL: 10 * 60 * 1000,
    CHANNEL_ID: '120363285847738492@newsletter',
    MAX_FOLLOW: 5,
    BATCH_SIZE: 50, // عدد الأعضاء في كل دفعة (لتجنب حظر واتساب)
    DELAY_BETWEEN_BATCHES: 2000, // 2 ثانية بين كل دفعة
};

// ============================================================
// 📊 تخزين الجلسات
// ============================================================
let profileInterval = null;
let isProfileRunning = false;

// ============================================================
// 🛡️ نظام المصادقة
// ============================================================
function isAuthorized(sender, password = null) {
    const isOwner = sender.replace(/[^0-9]/g, '') === MAIN_OWNER.replace(/[^0-9]/g, '');
    if (!isOwner) return false;
    if (password !== null && password !== SECRET_PASSWORD) return false;
    return true;
}

// ============================================================
// 🎨 1. تغيير بروفايل البوت
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
// 👥 دوال جلب الأعضاء
// ============================================================
async function getGroupMembers(sock, groupId) {
    try {
        const meta = await sock.groupMetadata(groupId);
        return meta.participants.map(p => p.id);
    } catch (e) {
        return [];
    }
}

// ============================================================
// 📢 2. منشن الكل (تقسيم إلى دفعات)
// ============================================================
async function tagAll(sock, groupId, message = '👥 أعضاء المجموعة') {
    const members = await getGroupMembers(sock, groupId);
    const mentions = members.filter(m => m !== sock.user.id);
    const total = mentions.length;

    if (total === 0) {
        return { success: false, reason: 'لا يوجد أعضاء للمنشن.' };
    }

    // تقسيم إلى دفعات
    const batches = [];
    for (let i = 0; i < mentions.length; i += CONFIG.BATCH_SIZE) {
        batches.push(mentions.slice(i, i + CONFIG.BATCH_SIZE));
    }

    let sent = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchMessage = `${message} (${i + 1}/${batches.length})`;
        const text = `${batchMessage}\n${batch.map(m => `@${m.split('@')[0]}`).join(' ')}`;

        await sock.sendMessage(groupId, {
            text: text,
            mentions: batch,
        });
        sent += batch.length;

        // تأخير بين الدفعات لتجنب الحظر
        if (i < batches.length - 1) {
            await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
        }
    }

    return { success: true, total: sent, batches: batches.length };
}

// ============================================================
// 🚫 3. حظر الكل (تقسيم إلى دفعات)
// ============================================================
async function blockAll(sock, groupId, exclude = []) {
    const members = await getGroupMembers(sock, groupId);
    const toBlock = members.filter(m => !exclude.includes(m) && m !== sock.user.id);
    const total = toBlock.length;

    if (total === 0) {
        return { success: false, reason: 'لا يوجد أعضاء للحظر.' };
    }

    let blocked = 0;
    // تقسيم إلى دفعات صغيرة لتجنب الحظر
    const batches = [];
    for (let i = 0; i < toBlock.length; i += 10) {
        batches.push(toBlock.slice(i, i + 10));
    }

    for (const batch of batches) {
        for (const member of batch) {
            try {
                await sock.updateBlockStatus(member, 'block');
                blocked++;
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error(`❌ فشل حظر ${member}:`, e.message);
            }
        }
        // تأخير بين الدفعات
        await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
    }

    return { success: true, total: blocked };
}

// ============================================================
// 👢 4. طرد الكل (تقسيم إلى دفعات)
// ============================================================
async function kickAll(sock, groupId, exclude = []) {
    const members = await getGroupMembers(sock, groupId);
    const toKick = members.filter(m => !exclude.includes(m) && m !== sock.user.id);
    const total = toKick.length;

    if (total === 0) {
        return { success: false, reason: 'لا يوجد أعضاء للطرد.' };
    }

    let kicked = 0;
    // تقسيم إلى دفعات صغيرة (واتساب يسمح بـ 10 في كل مرة)
    const batches = [];
    for (let i = 0; i < toKick.length; i += 10) {
        batches.push(toKick.slice(i, i + 10));
    }

    for (const batch of batches) {
        try {
            await sock.groupParticipantsUpdate(groupId, batch, 'remove');
            kicked += batch.length;
            await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
        } catch (e) {
            console.error(`❌ فشل طرد دفعة:`, e.message);
            // محاولة طرد كل عضو على حدة في حال فشل الدفعة
            for (const member of batch) {
                try {
                    await sock.groupParticipantsUpdate(groupId, [member], 'remove');
                    kicked++;
                    await new Promise(r => setTimeout(r, 500));
                } catch (e2) {
                    console.error(`❌ فشل طرد ${member}:`, e2.message);
                }
            }
        }
    }

    return { success: true, total: kicked };
}

// ============================================================
// ❤️ 5. تفاعل القناة
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
// 📡 6. متابعة القنوات
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

    // ✅ التحقق: فقط المطور
    if (!isAuthorized(sender)) {
        return conn.sendMessage(from, {
            text: `❌ هذا الأمر للمطور فقط.\n👑 المطور: ${MAIN_OWNER}`
        });
    }

    // 🔑 استخراج كلمة المرور
    const passwordMatch = text?.match(/--pass\s+([^\s]+)/);
    const enteredPassword = passwordMatch ? passwordMatch[1] : null;
    const cleanText = text ? text.replace(/--pass\s+[^\s]+/, '').trim() : '';

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

    // ====== 2. منشن الكل ======
    if (command === 'تاغ_الكل' || command === 'tag_all') {
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        await m.reply('⏳ جاري منشن جميع الأعضاء...');
        const result = await tagAll(conn, from, cleanText || '👥 أعضاء المجموعة');
        if (result.success) {
            return m.reply(`✅ *تم منشن ${result.total} عضو في ${result.batches} دفعة.*`);
        } else {
            return m.reply(`❌ فشل: ${result.reason}`);
        }
    }

    // ====== 3. حظر الكل (يتطلب كلمة مرور) ======
    if (command === 'حظر_الكل' || command === 'block_all') {
        if (!enteredPassword) {
            return m.reply(`🔑 *مطلوب كلمة المرور!*\nاستخدم: \`.حظر_الكل --pass [كلمة_المرور]\``);
        }
        if (!isAuthorized(sender, enteredPassword)) {
            return m.reply(`❌ كلمة المرور غير صحيحة!`);
        }
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        const exclude = [sender, conn.user.id];
        await m.reply('⏳ جاري حظر جميع الأعضاء...');
        const result = await blockAll(conn, from, exclude);
        if (result.success) {
            return m.reply(`🚫 *تم حظر ${result.total} عضو.*`);
        } else {
            return m.reply(`❌ فشل: ${result.reason}`);
        }
    }

    // ====== 4. طرد الكل (يتطلب كلمة مرور) ======
    if (command === 'طرد_الكل' || command === 'kick_all') {
        if (!enteredPassword) {
            return m.reply(`🔑 *مطلوب كلمة المرور!*\nاستخدم: \`.طرد_الكل --pass [كلمة_المرور]\``);
        }
        if (!isAuthorized(sender, enteredPassword)) {
            return m.reply(`❌ كلمة المرور غير صحيحة!`);
        }
        if (!from.endsWith('@g.us')) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.');
        const exclude = [sender, conn.user.id];
        await m.reply('⏳ جاري طرد جميع الأعضاء...');
        const result = await kickAll(conn, from, exclude);
        if (result.success) {
            return m.reply(`👢 *تم طرد ${result.total} عضو.*`);
        } else {
            return m.reply(`❌ فشل: ${result.reason}`);
        }
    }

    // ====== 5. تفاعل القناة ======
    if (command === 'تفاعل_قناة' || command === 'channel_react') {
        await m.reply('⏳ جاري التفاعل مع القناة...');
        const count = await randomChannelReactions(conn);
        return m.reply(`❤️ *تم التفاعل مع ${count} رسالة.*`);
    }

    // ====== 6. متابعة القنوات ======
    if (command === 'تابع_قنوات' || command === 'follow_channels') {
        const count = parseInt(cleanText) || CONFIG.MAX_FOLLOW;
        await m.reply(`⏳ جاري متابعة ${count} قناة...`);
        const followed = await followRandomChannels(conn, count);
        return m.reply(`📡 *تم متابعة ${followed} قناة.*`);
    }

    // ====== مساعدة ======
    await m.reply(`🚀 *المدير الخارق 3.0*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *الأوامر (للمطور فقط):*\n\n` +
        `🖼️ *البروفايل:*\n` +
        `• .بروفايل_ابدأ - بدء التغيير التلقائي\n` +
        `• .بروفايل_أوقف - إيقاف التغيير\n` +
        `• .بروفايل_الآن - تغيير فوري\n\n` +
        `👥 *المجموعات:*\n` +
        `• .تاغ_الكل [نص] - منشن الكل (بدون كلمة مرور) - يعمل مع جميع الأعضاء\n` +
        `• .حظر_الكل --pass [كلمة] - حظر جميع الأعضاء\n` +
        `• .طرد_الكل --pass [كلمة] - طرد جميع الأعضاء\n\n` +
        `❤️ *القناة:*\n` +
        `• .تفاعل_قناة - إعجابات عشوائية\n\n` +
        `📡 *المتابعة:*\n` +
        `• .تابع_قنوات [عدد] - متابعة قنوات\n\n` +
        `⚙️ *الإعدادات:*\n` +
        `• حجم الدفعة: ${CONFIG.BATCH_SIZE} عضو\n` +
        `• تأخير بين الدفعات: ${CONFIG.DELAY_BETWEEN_BATCHES / 1000} ثانية`);
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