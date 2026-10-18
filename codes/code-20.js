import fs from 'fs';
import path from 'path';
import axios from 'axios';

// ════════════════════════════════════════════════
// قناتي لا تخمط الكود و تعدل الحقوق عوف السطر : ‏https://whatsapp.com/channel/0029VbB7hIgIyPtbspl1CD2F
// ════════════════════════════════════════════════
// 👑 المالك والمطور: بـاتـمـان 🦇 / +963994855392
// ✦ BOT SIGNATURE: TOJI
// ════════════════════════════════════════════════

const DB_FILE = path.join(process.cwd(), 'tmp', 'fake_mail_db.json');

// التأكد من وجود مجلد tmp
if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
    fs.mkdirSync(path.join(process.cwd(), 'tmp'));
}

// تحميل أو إنشاء قاعدة البيانات
let DB = { mails: {}, active: null };
try {
    if (fs.existsSync(DB_FILE)) {
        DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
        fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
    }
} catch {
    DB = { mails: {}, active: null };
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));

const NovaUltra = {
    command: 'ايميل',
    description: 'بريد وهمي مع إدارة كاملة (إنشاء، عرض، وارد، استخراج كود)',
    elite: 'off',
    lock: 'off',
    group: false,
    prv: false,
    nova: 'on'
};

// API Functions
async function api(method, url, data = {}, token = "") {
    try {
        const res = await axios({
            method,
            url: "https://api.mail.tm" + url,
            data,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: "Bearer " + token } : {})
            }
        });
        return res.data;
    } catch (err) {
        return {};
    }
}

function extractCode(text = "") {
    const match = text.match(/\b\d{4,8}\b/);
    return match ? match[0] : null;
}

async function createMail() {
    const domains = await api("GET", "/domains");
    const domain = domains["hydra:member"]?.[0]?.domain || "mail.tm";
    const rand = Math.random().toString(36).slice(2, 10);
    const email = `${rand}@${domain}`;
    const password = rand + "123";

    await api("POST", "/accounts", { address: email, password });
    const tokenData = await api("POST", "/token", { address: email, password });

    DB.mails[email] = { email, password, token: tokenData.token };
    DB.active = email;
    saveDB();
    return DB.mails[email];
}

async function execute({ sock, msg, args }) {
    const chat = msg.key.remoteJid;
    const action = args[0]?.toLowerCase();

    try {
        // إنشاء إيميل جديد (عند كتابة .ايميل فقط)
        if (!action) {
            const mail = await createMail();
            return sock.sendMessage(chat, {
                text: `📧 *تم إنشاء إيميل جديد (𝐓𝐎𝐉𝐈)*\n\n• الإيميل: ${mail.email}\n• كلمة المرور: ${mail.password}\n\n✅ تم تعيينه كنشط تلقائياً.`
            }, { quoted: msg });
        }

        if (action === 'عرض') {
            const list = Object.keys(DB.mails);
            if (!list.length) return sock.sendMessage(chat, { text: "❌ لا توجد إيميلات محفوظة." });

            let text = "📂 *الإيميلات المحفوظة (𝐓𝐎𝐉𝐈):*\n\n";
            list.forEach((e, i) => {
                text += `${i + 1}. ${e}${DB.active === e ? " ✅" : ""}\n`;
            });
            return sock.sendMessage(chat, { text });
        }

        if (action === 'نشط') {
            const index = parseInt(args[1]);
            const list = Object.keys(DB.mails);
            if (isNaN(index) || index < 1 || index > list.length) return sock.sendMessage(chat, { text: "❌ رقم غير صحيح. مثال: .ايميل نشط 1" });

            DB.active = list[index - 1];
            saveDB();
            return sock.sendMessage(chat, { text: `✅ تم تفعيل الإيميل:\n${DB.active}` });
        }

        if (action === 'الوارد') {
            if (!DB.active) return sock.sendMessage(chat, { text: "❌ لا يوجد إيميل نشط." });
            const mail = DB.mails[DB.active];
            const inbox = await api("GET", "/messages", {}, mail.token);
            const messages = inbox["hydra:member"] || [];

            if (!messages.length) return sock.sendMessage(chat, { text: `📭 الوارد فارغ لـ:\n${DB.active}` });

            let text = `📨 *الوارد (𝐓𝐎𝐉𝐈):*\n\n`;
            messages.forEach((m, i) => {
                text += `${i + 1}. من: ${m.from.address}\n📌 العنوان: ${m.subject || "بدون عنوان"}\n\n`;
            });
            return sock.sendMessage(chat, { text });
        }

        if (action === 'اقرأ') {
            if (!DB.active) return sock.sendMessage(chat, { text: "❌ لا يوجد إيميل نشط." });
            const mail = DB.mails[DB.active];
            const index = parseInt(args[1]) - 1;
            
            const inbox = await api("GET", "/messages", {}, mail.token);
            const messages = inbox["hydra:member"] || [];
            const targetMsg = messages[index];

            if (!targetMsg) return sock.sendMessage(chat, { text: "❌ الرسالة غير موجودة." });

            const fullMsg = await api("GET", "/messages/" + targetMsg.id, {}, mail.token);
            const content = fullMsg.text || fullMsg.html || "";
            const code = extractCode(content);

            return sock.sendMessage(chat, {
                text: code ? `🔐 *كود التحقق الخاص بك:* ${code}` : `📝 *محتوى الرسالة:*\n\n${fullMsg.text.slice(0, 500)}...`
            });
        }

        if (action === 'حذف') {
            DB.mails = {};
            DB.active = null;
            saveDB();
            return sock.sendMessage(chat, { text: "✅ تم تصفية جميع الإيميلات." });
        }

    } catch (error) {
        console.error(error);
        return sock.sendMessage(chat, { text: "❌ حدث خطأ في النظام الوهمي." });
    }
}

export default { NovaUltra, execute };