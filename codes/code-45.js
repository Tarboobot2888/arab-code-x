// plugins/replace.js
// ⛈️ Raiden Shogun - استبدال نص تلقائي 🔄

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// عشان نحصل __dirname بنمط ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('✅ بلوجين .بدل (ESM) تم تحميله');

const handler = async (m, { text, command }) => {

    // لو عايز تخليه للمطور فقط احذف السطرين دول وخلي handler.owner = true شغال تحت
    const allowedNumber = '201130445818@s.whatsapp.net';
    if (m.sender !== allowedNumber) {
        await m.reply('❌ هذا الأمر غير مسموح لك.');
        return;
    }

    console.log(`📌 تم استقبال الأمر: ${command} | نص: ${text}`);

    if (!text || !text.includes('|')) {
        await m.reply('⚡ *الاستخدام:*\n.بدل الكلمة القديمة | الكلمة الجديدة\nمثال:\n.بدل Cheon | Raiden');
        return;
    }

    const [oldText, newText] = text.split('|').map(s => s.trim());

    if (!oldText || !newText) {
        await m.reply('❌ تأكد أنك كتبت الكلمتين بشكل صحيح مفصولتين بـ |');
        return;
    }

    const pluginsDir = path.join(__dirname, '../plugins');
    const rootDir = path.join(__dirname, '..');
    let changedFiles = [];
    let foundFiles = [];

    function walkDir(dir) {
        let files = fs.readdirSync(dir);
        for (let file of files) {
            let fullPath = path.join(dir, file);
            try {
                let stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (['node_modules', '.git', 'session', 'auth'].includes(file)) continue;
                    walkDir(fullPath);
                } else if (file.endsWith('.js') || file.endsWith('.json')) {
                    let content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes(oldText)) {
                        foundFiles.push(fullPath.replace(rootDir + path.sep, ''));
                        // استبدال آمن حتى لو فيه رموز
                        let escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        let updatedContent = content.replace(new RegExp(escaped, 'g'), newText);
                        fs.writeFileSync(fullPath, updatedContent, 'utf8');
                        changedFiles.push(fullPath.replace(rootDir + path.sep, ''));
                    }
                }
            } catch {}
        }
    }

    // هيبحث في البلوجنات بس لو عايزه يبحث في البوت كله غير السطر ده لـ walkDir(rootDir)
    walkDir(pluginsDir);

    if (changedFiles.length === 0) {
        await m.reply(`ℹ️ لم يتم العثور على "${oldText}" في أي ملف.`);
    } else {
        await m.reply(`✅ *تم الاستبدال تلقائياً*\n\n🔍 *${oldText}* ➜ *${newText}*\n📁 *عدد الملفات:* ${changedFiles.length}\n\n📄 *الملفات:*\n${changedFiles.join('\n')}`);
        console.log(`✅ تم التبديل في: ${changedFiles.join(', ')}`);
    }
};

handler.command = /^(بدل|استبدال|replace)$/i;
handler.owner = true;
handler.tags = ['owner'];
handler.desc = 'يبدل نص معين في جميع كودات البلوجين تلقائيا';

export default handler;