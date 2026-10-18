// commands/وصف.js
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

export default {
  category: 'tools',
  name: 'وصف',
  aliases: ['groupdesc', 'desc'],
  description: 'جلب وصف مجموعة عبر الرابط مع زر نسخ',

  execute: async (sock, m, args, { cfg }) => {
    try {
      await sock.sendMessage(m.key.remoteJid, {
        react: { text: '🔍', key: m.key }
      });

      const link = args[0];
      if (!link) {
        return await sock.sendMessage(m.key.remoteJid, {
          text: '❌ *أرسل رابط المجموعة*\n\nمثال: *.وصف https://chat.whatsapp.com/xxx*'
        });
      }

      // استخراج الكود من الرابط
      const code = link.split('chat.whatsapp.com/')[1]?.split('?')[0];
      if (!code) {
        return await sock.sendMessage(m.key.remoteJid, {
          text: '❌ *الرابط غير صحيح*'
        });
      }

      // جلب معلومات المجموعة
      const groupInfo = await sock.groupGetInviteInfo(code);

      const desc = groupInfo.desc || 'لا يوجد وصف';
      const name = groupInfo.subject || 'بدون اسم';
      const size = groupInfo.size || 0;

      // ✅ بناء زر النسخ (ينسخ الوصف فقط)
      const copyButton = {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: '📋 نسخ الوصف',
          copy_code: desc
        })
      };

      // ✅ زر نسخ الرابط
      const copyLinkButton = {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: '🔗 نسخ الرابط',
          copy_code: link
        })
      };

      // ✅ إرسال الرسالة مع زر النسخ
      const bodyText = `📋 *معلومات المجموعة:*\n\n👥 *الاسم:* ${name}\n👤 *الأعضاء:* ${size}\n📝 *الوصف:*\n${desc}`;

      const interactiveMessage = {
        body: { text: bodyText },
        footer: { text: '📋 ABOUD BOT' },
        nativeFlowMessage: {
          buttons: [copyButton, copyLinkButton]
        }
      };

      const msg = generateWAMessageFromContent(m.key.remoteJid, {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: proto.Message.InteractiveMessage.fromObject(interactiveMessage)
          }
        }
      }, { userJid: sock.user?.jid, quoted: m });

      await sock.relayMessage(m.key.remoteJid, msg.message, { messageId: msg.key.id });

    } catch (e) {
      console.error('وصف error:', e);
      await sock.sendMessage(m.key.remoteJid, {
        text: '🔴 *خطأ:* تعذر جلب معلومات المجموعة، تأكد من صحة الرابط'
      });
    }
  }
};
