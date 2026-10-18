// ذاكرة مؤقتة لحفظ بيانات الجروب المنسوخ
let copiedGroupData = null;

export default {
    command: ["نسخ", "لصق", "نسخ_الجروب", "clonegroup"],
    category: "المشرفين",
    description: "نسخ ولصق بيانات المجموعات بسهولة",
    
    handler: async (...params) => {
        const sock = params.find(p => p && typeof p.sendMessage === 'function');
        const mek = params.find(p => p && p.key && p.message);
        if (!sock || !mek) return;
        const from = mek.key.remoteJid;

        if (!from.endsWith("@g.us")) {
            return await sock.sendMessage(from, { text: "⚠️ الأمر ده للمجموعات بس يا غالي." }, { quoted: mek });
        }

        const body = (mek.message?.conversation || mek.message?.extendedTextMessage?.text || "").trim();
        const contextInfo = mek.message?.extendedTextMessage?.contextInfo;

        // ==========================================
        // 1. حالة الـ "نسخ" (حفظ البيانات)
        // ==========================================
        if (body.startsWith(".نسخ") && !body.startsWith(".نسخ_الجروب")) {
            await sock.sendMessage(from, { react: { text: "⏳", key: mek.key } });
            try {
                const metadata = await sock.groupMetadata(from);
                let ppUrl = null;
                try {
                    ppUrl = await sock.profilePictureUrl(from, 'image');
                } catch {}

                copiedGroupData = {
                    name: metadata.subject,
                    desc: metadata.desc || "",
                    ppUrl: ppUrl
                };

                await sock.sendMessage(from, { react: { text: "📋", key: mek.key } });
                return await sock.sendMessage(from, { 
                    text: `✅ *تم نسخ بيانات الجروب بنجاح!*\n\n📌 *الاسم:* ${copiedGroupData.name}\n\nروح الجروب التاني واكتب *.لصق* لتطبيق البيانات.` 
                }, { quoted: mek });
            } catch (e) {
                await sock.sendMessage(from, { text: "❌ حصل خطأ أثناء نسخ بيانات الجروب." }, { quoted: mek });
            }
        }

        // ==========================================
        // 2. حالة الـ "لصق" (تطبيق البيانات الحالية)
        // ==========================================
        if (body.startsWith(".لصق")) {
            if (!copiedGroupData) {
                return await sock.sendMessage(from, { text: "⚠️ مفيش جروب منسوخ حالياً! ادخل الجروب الأول واكتب *.نسخ* الأول." }, { quoted: mek });
            }

            await sock.sendMessage(from, { react: { text: "⏳", key: mek.key } });
            try {
                // تغيير الاسم والوصف
                await sock.groupUpdateSubject(from, copiedGroupData.name);
                if (copiedGroupData.desc) {
                    await sock.groupUpdateDescription(from, copiedGroupData.desc);
                }

                // تغيير الصورة
                if (copiedGroupData.ppUrl) {
                    await sock.updateProfilePicture(from, { url: copiedGroupData.ppUrl });
                }

                await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });
                return await sock.sendMessage(from, { 
                    text: `✅ *تم لصق وتطبيق البيانات بنجاح!*\n\n📌 *الاسم الجديد:* ${copiedGroupData.name}` 
                }, { quoted: mek });
            } catch (e) {
                await sock.sendMessage(from, { text: "❌ فشل التعديل! تأكد إن البوت مشرف (Admin) في الجروب ده." }, { quoted: mek });
            }
        }

        // ==========================================
        // 3. حالة نسخ الجروب عبر الريبلاي (رد على رسالة محولة)
        // ==========================================
        if (body.startsWith(".نسخ_الجروب")) {
            let targetJid = null;

            // لو عملت ريبلاي على رسالة جاية من الجروب التاني
            if (contextInfo?.participant) {
                // استخراج JID من الرسالة المقتبسة لو كان شات جروب
                targetJid = contextInfo.remoteJid || contextInfo.participant;
            }

            let args = params.find(p => Array.isArray(p));
            if (!args) {
                args = body.split(/\s+/).slice(1);
            }
            if (args[0] && args[0].endsWith("@g.us")) {
                targetJid = args[0];
            }

            if (!targetJid || !targetJid.endsWith("@g.us")) {
                return await sock.sendMessage(from, { 
                    text: "⚠️ *طريقة الاستخدام:* \n1. ادخل الجروب الأول واكتب *.نسخ*\n2. روح الجروب التاني واكتب *.لصق*\n\nأو اعمل ريبلاي على رسالة من الجروب التاني واكتب *.نسخ_الجروب*" 
                }, { quoted: mek });
            }

            await sock.sendMessage(from, { react: { text: "⏳", key: mek.key } });
            try {
                const metadata = await sock.groupMetadata(targetJid);
                await sock.groupUpdateSubject(from, metadata.subject);
                if (metadata.desc) await sock.groupUpdateDescription(from, metadata.desc);

                try {
                    const ppUrl = await sock.profilePictureUrl(targetJid, 'image');
                    if (ppUrl) await sock.updateProfilePicture(from, { url: ppUrl });
                } catch {}

                await sock.sendMessage(from, { react: { text: "✅", key: mek.key } });
                await sock.sendMessage(from, { text: `✅ تم نقل بيانات الجروب (${metadata.subject}) بنجاح!` }, { quoted: mek });
            } catch (e) {
                await sock.sendMessage(from, { text: "❌ فشل النسخ، تأكد إن البوت مشرف هنا وموجود في الجروب التاني." }, { quoted: mek });
            }
        }
    }
};
