import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let handler = async (m, { conn, text }) => {
    try {
        // 🛡️ حدد رقم المطور الخاص بك هنا (مثال: '967770000000@s.whatsapp.net')
        // استبدل الرقم أدناه برقم هاتفك الحقيقي مع رمز الدولة
        const developerNumber = '967XXXXXXXXX@s.whatsapp.net'; 

        // التحقق مما إذا كان المرسل هو المطور أم لا
        if (m.sender !== developerNumber) {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return m.reply('❌ عذراً، هذا الأمر مخصص للمطور فقط ولا يمكن للآخرين استخدامه.');
        }

        // التحقق من كتابة الأمر بالطريقة الصحيحة وعلامة |
        if (!text || !text.includes('|')) {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return m.reply(
                `❌ **خطأ في طريقة الاستخدام!**\n\n` +
                `📌 **الطريقة الصحيحة:**\n` +
                `رد على الملف واكتب:\n` +
                `\`تصدير اسم_المجلد | اسم_الملف\`\n\n` +
                `مثال:\n` +
                `\`تصدير vedio | vedio1\``
            );
        }

        await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

        if (!m.quoted) {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return m.reply('❌ يرجى الرد على الملف المراد حفظه.');
        }

        let quoted = m.quoted;
        let mime = (quoted.msg || quoted).mimetype || '';
        
        if (!quoted.hasMedia && !mime) {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return m.reply('❌ الرسالة التي رددت عليها لا تحتوي على ملف صالح.');
        }

        let parts = text.split('|').map(v => v.trim());
        let rawFolder = parts[0]; 
        let rawFile = parts[1];

        if (!rawFolder || !rawFile) {
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
            return m.reply('❌ يرجى كتابة اسم المجلد واسم الملف بشكل صحيح.\nمثال: `تصدير vedio | vedio1`');
        }

        // 🛡️ حماية أمنية (Path Traversal Protection)
        let folderName = rawFolder.replace(/[^a-zA-Z0-9_\u0621-\u064A]/g, '_');
        let customFileName = rawFile.replace(/[^a-zA-Z0-9_\u0621-\u064A]/g, '_');

        let targetDir = path.join(__dirname, '../', folderName);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        let media = await quoted.download();
        
        let ext = 'bin';
        if (mime) {
            let matches = mime.match(/\/([a-zA-Z0-9-+]+)/);
            if (matches) ext = matches[1].replace('x-', '');
        }
        if (quoted.fileName) {
            let fileExt = path.extname(quoted.fileName).replace('.', '');
            if (fileExt) ext = fileExt;
        }

        let fileName = `${customFileName}.${ext}`;
        let filePath = path.join(targetDir, fileName);

        fs.writeFileSync(filePath, media);

        await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        await m.reply(`✅ **تم حفظ الملف بنجاح!**\n📁 المجلد: \`${folderName}\`\n📄 اسم الملف: \`${fileName}\``);

    } catch (error) {
        console.error('خطأ في حفظ الملف:', error);
        await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        await m.reply('❌ حدث خطأ أثناء تنفيذ الطلب.');
    }
};

handler.command = /^(تصدير|vedio)$/i;
handler.group = true; 

export default handler;
