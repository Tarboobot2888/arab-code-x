const getG = (chatId) => {
    if (!global._gs) global._gs = {};
    if (!global._gs[chatId]) global._gs[chatId] = {};

    if (!global._gs[chatId].counter)
        global._gs[chatId].counter = {};

    return global._gs[chatId];
};

const handler = async (m, { conn, command }) => {
    const g = getG(m.chat);

    if (command === 'مراقبه') {
        g.monitor = !g.monitor;

        if (g.monitor && !g.counter)
            g.counter = {};

        return m.reply(
            g.monitor
                ? '*✅ تم تفعيل مراقبة الرسائل*'
                : '*❌ تم إيقاف مراقبة الرسائل*'
        );
    }

    if (command === 'سجل') {
        const counter = g.counter || {};

        const data = Object.entries(counter)
            .sort((a, b) => b[1] - a[1]);

        if (!data.length)
            return m.reply('*📋 لا توجد رسائل مسجلة*');

        let text = '🏆 *ترتيب نشاط أعضاء الجروب*\n\n';

        for (let i = 0; i < Math.min(data.length, 30); i++) {
            const [jid, count] = data[i];
            const name = await conn.getName(jid);

            text += `${i + 1}. ${name}\n`;
            text += `💬 الرسائل: ${count}\n\n`;
        }

        return conn.sendMessage(
            m.chat,
            { text },
            { quoted: m }
        );
    }
};

handler.before = async (m) => {
    if (!m.isGroup) return false;

    const g = getG(m.chat);

    if (!g.monitor) return false;

    g.counter[m.sender] = (g.counter[m.sender] || 0) + 1;

    return false;
};

handler.command = ['مراقبه', 'سجل'];
handler.usage = ['مراقبه', 'سجل'];
handler.category = 'admins';
handler.admin = true;

export default handler;