// plugins/chat_tracker.js
// 🕵️ نظام تتبع المحادثات الشامل - مع أسماء القنوات والمجموعات والروابط
// ✦ يسجل جميع الأرقام، المجموعات، القنوات مع أسمائها وروابطها
// 🛡️ للمطور فقط

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'chat_tracker');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// 👑 المطور الأساسي
// ============================================================
const MAIN_OWNER = '447475774418';

// ============================================================
// 📂 دوال التخزين
// ============================================================
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const LOG_FILE = path.join(DATA_DIR, 'tracker.log');

function loadData(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function logActivity(entry) {
    const log = `[${entry.time}] ${entry.type} | ${entry.user} | ${entry.name || 'غير معروف'} | ${entry.chatId} | ${entry.chatName || 'غير معروف'} | ${entry.message || 'وسائط'}\n`;
    fs.appendFileSync(LOG_FILE, log, 'utf8');
}

// ============================================================
// 🧠 دوال جلب الأسماء والروابط
// ============================================================
function generateChannelLink(channelId) {
    // استخراج الرقم من المعرف (إزالة @newsletter)
    const id = channelId.replace('@newsletter', '');
    return `https://whatsapp.com/channel/${id}`;
}

async function getChannelName(sock, channelId) {
    try {
        // محاولة جلب اسم القناة عبر newsletterGetMessages
        if (typeof sock.newsletterGetMessages === 'function') {
            const result = await sock.newsletterGetMessages(channelId, 1);
            if (result && result.messages && result.messages.length > 0) {
                // بعض الإصدارات تعيد اسم القناة في metadata
                if (result.messages[0]?.newsletterName) {
                    return result.messages[0].newsletterName;
                }
            }
        }
        // محاولة عبر query
        try {
            const result = await sock.query({
                tag: 'iq',
                attrs: { to: channelId, type: 'get', xmlns: 'w:newsletter' },
                content: [{ tag: 'metadata', attrs: {} }]
            });
            if (result?.content?.[0]?.content) {
                const metadata = result.content[0].content;
                if (metadata.attrs?.name) {
                    return metadata.attrs.name;
                }
            }
        } catch (e) {}
        return null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// 🧠 المعالج التلقائي (يُستدعى لكل رسالة)
// ============================================================
export async function trackAll(sock, msg) {
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.participant || msg.sender;
    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const isChannel = chatId.endsWith('@newsletter');
    const isPrivate = !isGroup && !isChannel;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const msgType = Object.keys(msg.message)[0] || 'unknown';

    // جلب اسم المرسل
    let senderName = 'غير معروف';
    try {
        if (sender) {
            senderName = await sock.getName(sender).catch(() => 'غير معروف');
        }
    } catch (e) {}

    // ====== تحديث بيانات المستخدم ======
    const users = loadData(USERS_FILE);
    if (!users[sender]) {
        users[sender] = {
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            totalMessages: 0,
            name: senderName,
            privateChats: 0,
            groups: [],
            channels: [],
            lastMessage: '',
        };
    }
    users[sender].lastSeen = Date.now();
    users[sender].totalMessages++;
    users[sender].name = senderName;
    if (text) users[sender].lastMessage = text.slice(0, 50);

    // ====== تحديث بيانات المجموعات ======
    if (isGroup) {
        if (!users[sender].groups.includes(chatId)) {
            users[sender].groups.push(chatId);
        }
        const groups = loadData(GROUPS_FILE);
        if (!groups[chatId]) {
            let groupName = 'غير معروف';
            let memberCount = 0;
            try {
                const meta = await sock.groupMetadata(chatId);
                groupName = meta.subject || 'غير معروف';
                memberCount = meta.participants ? meta.participants.length : 0;
            } catch (e) {}
            groups[chatId] = {
                name: groupName,
                members: memberCount,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                totalMessages: 0,
                link: `https://chat.whatsapp.com/${chatId.replace('@g.us', '')}`,
            };
        }
        groups[chatId].lastSeen = Date.now();
        groups[chatId].totalMessages++;
        saveData(GROUPS_FILE, groups);
    }

    // ====== تحديث بيانات القنوات ======
    if (isChannel) {
        if (!users[sender].channels.includes(chatId)) {
            users[sender].channels.push(chatId);
        }
        const channels = loadData(CHANNELS_FILE);
        if (!channels[chatId]) {
            let channelName = 'غير معروف';
            try {
                const name = await getChannelName(sock, chatId);
                if (name) channelName = name;
            } catch (e) {}
            channels[chatId] = {
                name: channelName,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                totalMessages: 0,
                link: generateChannelLink(chatId),
            };
        }
        channels[chatId].lastSeen = Date.now();
        channels[chatId].totalMessages++;
        saveData(CHANNELS_FILE, channels);
    }

    if (isPrivate) {
        users[sender].privateChats++;
    }

    saveData(USERS_FILE, users);

    // ====== تسجيل النشاط مع اسم المحادثة ======
    let chatName = 'غير معروف';
    if (isGroup) {
        const groups = loadData(GROUPS_FILE);
        chatName = groups[chatId]?.name || 'غير معروف';
    } else if (isChannel) {
        const channels = loadData(CHANNELS_FILE);
        chatName = channels[chatId]?.name || 'غير معروف';
    } else {
        chatName = 'محادثة خاصة';
    }

    logActivity({
        time: new Date().toISOString(),
        type: isGroup ? 'GROUP' : isChannel ? 'CHANNEL' : 'PRIVATE',
        user: sender || 'unknown',
        name: senderName,
        chatId: chatId || 'unknown',
        chatName: chatName,
        message: text || `[${msgType}]`,
    });
}

// ============================================================
// 📊 عرض قائمة جميع المستخدمين
// ============================================================
function formatUserList(users) {
    const list = Object.entries(users).sort((a, b) => b[1].totalMessages - a[1].totalMessages);
    let reply = `👥 *جميع المتحدثين مع البوت (${list.length})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    list.slice(0, 30).forEach(([id, data], i) => {
        const name = data.name || id?.split('@')[0] || 'غير معروف';
        const cleanId = id?.split('@')[0] || id || 'unknown';
        reply += `${i+1}. *${name}*\n`;
        reply += `   📱 ${cleanId}\n`;
        reply += `   📨 ${data.totalMessages} رسالة\n`;
        reply += `   🕒 آخر ظهور: ${new Date(data.lastSeen).toLocaleString('ar-EG')}\n`;
        if (data.groups && data.groups.length > 0) {
            reply += `   📁 ${data.groups.length} مجموعة\n`;
        }
        if (data.channels && data.channels.length > 0) {
            reply += `   📡 ${data.channels.length} قناة\n`;
        }
        if (data.privateChats > 0) {
            reply += `   📱 ${data.privateChats} محادثة خاصة\n`;
        }
        reply += '\n';
    });
    if (list.length > 30) {
        reply += `... و ${list.length - 30} مستخدم آخر\n`;
    }
    reply += `\n💡 استخدم \`.رسائل_المستخدم [الرقم]\` لعرض رسائل مستخدم معين`;
    return reply;
}

// ============================================================
// 📩 عرض رسائل مستخدم معين
// ============================================================
function getUserMessages(targetNumber) {
    try {
        const logs = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logs.split('\n').filter(line => line.includes(targetNumber));
        const recent = lines.slice(-30).reverse();
        if (recent.length === 0) return null;
        let reply = `📩 *رسائل ${targetNumber} (آخر ${recent.length})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        recent.forEach(line => {
            const parts = line.split(' | ');
            if (parts.length >= 6) {
                const time = parts[0].replace('[', '').replace(']', '');
                const type = parts[1];
                const name = parts[2] || 'غير معروف';
                const chatId = parts[3] || 'غير معروف';
                const chatName = parts[4] || 'غير معروف';
                const msg = parts.slice(5).join(' | ').trim();
                reply += `🕒 ${new Date(time).toLocaleString('ar-EG')}\n`;
                reply += `📌 ${type} | ${name}\n`;
                reply += `📍 ${chatName} (${chatId})\n`;
                reply += `💬 ${msg}\n\n`;
            }
        });
        return reply;
    } catch (e) {
        return null;
    }
}

// ============================================================
// 📊 عرض المجموعات المسجلة مع الأسماء والروابط
// ============================================================
function formatGroups(groups) {
    const list = Object.entries(groups).sort((a, b) => b[1].totalMessages - a[1].totalMessages);
    if (list.length === 0) return '📭 لا توجد مجموعات مسجلة.';
    let reply = `👥 *المجموعات المسجلة (${list.length})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    list.slice(0, 20).forEach(([id, data], i) => {
        reply += `${i+1}. 📌 *${data.name || id.split('@')[0]}*\n`;
        reply += `   🆔 ${id}\n`;
        reply += `   👥 ${data.members || 'غير معروف'} عضو\n`;
        reply += `   📨 ${data.totalMessages} رسالة\n`;
        reply += `   🕒 ${new Date(data.lastSeen).toLocaleString('ar-EG')}\n`;
        if (data.link) reply += `   🔗 ${data.link}\n`;
        reply += '\n';
    });
    return reply;
}

// ============================================================
// 📡 عرض القنوات المسجلة مع الأسماء والروابط
// ============================================================
function formatChannels(channels) {
    const list = Object.entries(channels).sort((a, b) => b[1].totalMessages - a[1].totalMessages);
    if (list.length === 0) return '📭 لا توجد قنوات مسجلة.';
    let reply = `📡 *القنوات المسجلة (${list.length})*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    list.slice(0, 20).forEach(([id, data], i) => {
        reply += `${i+1}. 📌 *${data.name || 'قناة غير معروفة'}*\n`;
        reply += `   🆔 ${id}\n`;
        reply += `   📨 ${data.totalMessages} رسالة\n`;
        reply += `   🕒 ${new Date(data.lastSeen).toLocaleString('ar-EG')}\n`;
        if (data.link) reply += `   🔗 ${data.link}\n`;
        reply += '\n';
    });
    return reply;
}

// ============================================================
// 📊 عرض إحصائيات عامة
// ============================================================
function getStats(users, groups, channels) {
    const totalUsers = Object.keys(users).length;
    const totalGroups = Object.keys(groups).length;
    const totalChannels = Object.keys(channels).length;
    const totalMessages = Object.values(users).reduce((sum, u) => sum + u.totalMessages, 0);
    const activeToday = Object.values(users).filter(u => {
        const last = new Date(u.lastSeen);
        const today = new Date();
        return last.getDate() === today.getDate() &&
               last.getMonth() === today.getMonth() &&
               last.getFullYear() === today.getFullYear();
    }).length;

    return {
        totalUsers,
        totalGroups,
        totalChannels,
        totalMessages,
        activeToday,
    };
}

// ============================================================
// 🎯 الأوامر الرئيسية
// ============================================================
let handler = async (m, { conn, text, command }) => {
    const sender = m.sender;

    // ✅ التحقق من المطور
    if (sender.replace(/[^0-9]/g, '') !== MAIN_OWNER.replace(/[^0-9]/g, '')) {
        return conn.sendMessage(m.chat, {
            text: `❌ هذا الأمر للمطور فقط.\n👑 المطور: ${MAIN_OWNER}`
        });
    }

    const users = loadData(USERS_FILE);
    const groups = loadData(GROUPS_FILE);
    const channels = loadData(CHANNELS_FILE);

    // ====== .جميع_المتحدثين ======
    if (command === 'جميع_المتحدثين' || command === 'all_speakers') {
        const reply = formatUserList(users);
        return m.reply(reply);
    }

    // ====== .رسائل_المستخدم [الرقم] ======
    if (command === 'رسائل_المستخدم' || command === 'user_messages') {
        if (!text) {
            return m.reply(`📩 *عرض رسائل المستخدم*\n\n📌 استخدم: \`.رسائل_المستخدم [الرقم]\`\n💡 مثال: \`.رسائل_المستخدم 1234567890\``);
        }
        const targetNumber = text.replace(/[^0-9]/g, '');
        if (!targetNumber || targetNumber.length < 8) {
            return m.reply('❌ رقم غير صحيح.');
        }
        const reply = getUserMessages(targetNumber);
        if (reply) {
            return m.reply(reply);
        } else {
            return m.reply(`📭 لا توجد رسائل مسجلة للرقم ${targetNumber}.`);
        }
    }

    // ====== .جميع_المجموعات ======
    if (command === 'جميع_المجموعات' || command === 'all_groups') {
        const reply = formatGroups(groups);
        return m.reply(reply);
    }

    // ====== .جميع_القنوات ======
    if (command === 'جميع_القنوات' || command === 'all_channels') {
        const reply = formatChannels(channels);
        return m.reply(reply);
    }

    // ====== .إحصائيات_التتبع ======
    if (command === 'إحصائيات_التتبع' || command === 'tracker_stats') {
        const stats = getStats(users, groups, channels);
        const reply = `📊 *إحصائيات تتبع المحادثات*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👥 إجمالي المتحدثين: ${stats.totalUsers}\n` +
            `📨 إجمالي الرسائل: ${stats.totalMessages}\n` +
            `📈 نشطاء اليوم: ${stats.activeToday}\n` +
            `👥 مجموعات: ${stats.totalGroups}\n` +
            `📡 قنوات: ${stats.totalChannels}\n` +
            `🕒 آخر تحديث: ${new Date().toLocaleString('ar-EG')}\n\n` +
            `📌 *الأوامر:*\n` +
            `• \`.جميع_المتحدثين\` - عرض جميع المستخدمين\n` +
            `• \`.رسائل_المستخدم [الرقم]\` - عرض رسائل مستخدم\n` +
            `• \`.جميع_المجموعات\` - عرض المجموعات مع الأسماء والروابط\n` +
            `• \`.جميع_القنوات\` - عرض القنوات مع الأسماء والروابط`;
        return m.reply(reply);
    }

    // ====== .مسح_سجل_التتبع ======
    if (command === 'مسح_سجل_التتبع' || command === 'clear_tracker') {
        try {
            fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2), 'utf8');
            fs.writeFileSync(GROUPS_FILE, JSON.stringify({}, null, 2), 'utf8');
            fs.writeFileSync(CHANNELS_FILE, JSON.stringify({}, null, 2), 'utf8');
            fs.writeFileSync(LOG_FILE, '', 'utf8');
            await m.reply('🧹 *تم مسح جميع سجلات التتبع والمستخدمين والمجموعات والقنوات.*');
        } catch (e) {
            await m.reply(`❌ فشل المسح: ${e.message}`);
        }
        return;
    }

    // ====== مساعدة ======
    await m.reply(`🕵️ *نظام تتبع المحادثات الشامل*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *الأوامر (للمطور فقط):*\n` +
        `1️⃣ \`.جميع_المتحدثين\` - عرض جميع المستخدمين\n` +
        `2️⃣ \`.رسائل_المستخدم [الرقم]\` - عرض رسائل مستخدم\n` +
        `3️⃣ \`.جميع_المجموعات\` - عرض المجموعات مع الأسماء والروابط\n` +
        `4️⃣ \`.جميع_القنوات\` - عرض القنوات مع الأسماء والروابط\n` +
        `5️⃣ \`.إحصائيات_التتبع\` - عرض إحصائيات عامة\n` +
        `6️⃣ \`.مسح_سجل_التتبع\` - مسح جميع السجلات\n\n` +
        `🔮 *يعمل تلقائياً:* يسجل كل رسالة واردة مع اسم القناة/المجموعة.`);
};

handler.help = [
    'جميع_المتحدثين', 'رسائل_المستخدم', 'جميع_المجموعات',
    'جميع_القنوات', 'إحصائيات_التتبع', 'مسح_سجل_التتبع'
];
handler.tags = ['owner'];
handler.command = [
    'جميع_المتحدثين', 'all_speakers',
    'رسائل_المستخدم', 'user_messages',
    'جميع_المجموعات', 'all_groups',
    'جميع_القنوات', 'all_channels',
    'إحصائيات_التتبع', 'tracker_stats',
    'مسح_سجل_التتبع', 'clear_tracker'
];

export default handler;