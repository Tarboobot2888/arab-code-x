// commands/لرابط.js
import axios from 'axios';
import FormData from 'form-data';
import { fileTypeFromBuffer } from 'file-type';

async function uploadFile(fileBuffer) {
    try {
        const form = new FormData();
        const fileInfo = await fileTypeFromBuffer(fileBuffer);
        const ext = fileInfo?.ext || 'bin';
        form.append('files[]', fileBuffer, `file.${ext}`);

        const uploadRes = await axios.post('https://uguu.se/upload.php', form, {
            headers: { ...form.getHeaders() },
            timeout: 30000
        });

        if (!uploadRes.data?.files?.[0]?.url) {
            throw new Error('فشل رفع الملف');
        }

        return {
            url: uploadRes.data.files[0].url,
            fileName: uploadRes.data.files[0].name || 'ملف'
        };
    } catch (error) {
        throw new Error(error.message || 'فشل الاتصال');
    }
}

export default {
    name: 'لرابط',
    aliases: ['رفع', 'upload', 'رابط'],
    category: 'tools',
    description: '📤 رفع الملفات إلى Uguu',

    async execute(sock, m, args, { cfg }) {
        const chatJid = m.key.remoteJid;
        const sender = m.key.participant || m.participant || m.key.remoteJid;
        const comando = 'لرابط';

        // ✅ التحقق من النخبة والمطور
        const isOwner = cfg.ownerNumber === sender;
        const isElite = (cfg.eliteNumbers || []).includes(sender);

        if (!isOwner && !isElite) {
            return sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: m });
        }

        // ✅ التحقق من وجود رد
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            return sock.sendMessage(chatJid, {
                text: `📤 *رفع الملفات إلى Uguu*\n\n` +
                      `📌 *الاستخدام:*\n` +
                      `• ارد على صورة/فيديو/ملف\n` +
                      `• اكتب .لرابط`
            }, { quoted: m });
        }

        // ✅ تحديد نوع الملف
        const isImage = quoted.imageMessage;
        const isVideo = quoted.videoMessage;
        const isAudio = quoted.audioMessage;
        const isDocument = quoted.documentMessage;

        if (!isImage && !isVideo && !isAudio && !isDocument) {
            return sock.sendMessage(chatJid, {
                text: '❌ قم بالرد على صورة، فيديو، صوت، أو ملف.'
            }, { quoted: m });
        }

        await sock.sendMessage(chatJid, { react: { text: '⏳', key: m.key } });

        try {
            // ✅ تحميل الميديا
            const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
            
            let mediaType = 'image';
            let mediaMessage = null;
            
            if (quoted.imageMessage) {
                mediaType = 'image';
                mediaMessage = quoted.imageMessage;
            } else if (quoted.videoMessage) {
                mediaType = 'video';
                mediaMessage = quoted.videoMessage;
            } else if (quoted.audioMessage) {
                mediaType = 'audio';
                mediaMessage = quoted.audioMessage;
            } else if (quoted.documentMessage) {
                mediaType = 'document';
                mediaMessage = quoted.documentMessage;
            }

            if (!mediaMessage) {
                throw new Error('لا يمكن قراءة الملف');
            }

            // ✅ تحميل الملف
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer || buffer.length < 100) {
                throw new Error('فشل تحميل الملف');
            }

            // ✅ تحديد نوع الملف
            const fileInfo = await fileTypeFromBuffer(buffer);
            const mimeType = fileInfo?.mime || mediaMessage.mimetype || 'application/octet-stream';

            // ✅ رفع الملف
            const result = await uploadFile(buffer);

            if (result?.url) {
                const size = buffer.length;
                const sizeFormatted = size > 1024 * 1024 
                    ? `${(size / (1024 * 1024)).toFixed(2)} MB`
                    : `${(size / 1024).toFixed(2)} KB`;

                await sock.sendMessage(chatJid, {
                    text: `✅ *تم الرفع بنجاح*\n\n` +
                          `📦 *الملف:* ${result.fileName || 'ملف'}\n` +
                          `📂 *النوع:* ${mimeType}\n` +
                          `📊 *الحجم:* ${sizeFormatted}\n` +
                          `🔗 *الرابط:* ${result.url}`
                }, { quoted: m });

                await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });
            } else {
                throw new Error('لم يتم العثور على رابط');
            }

        } catch (error) {
            console.error('❌ Upload Error:', error);
            await sock.sendMessage(chatJid, { react: { text: '❌', key: m.key } });
            await sock.sendMessage(chatJid, {
                text: `❌ *خطأ:* ${error.message}`
            }, { quoted: m });
        }
    }
};
