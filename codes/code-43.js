import { prepareWAMessageMedia, generateWAMessageFromContent } from '@whiskeysockets/baileys' // تم تعديل المسار للمكتبة القياسية لضمان العمل
import fetch from 'node-fetch'

let handler = async (m, { conn }) => {
  try {
    let audioUrl = 'https://files.catbox.moe/pkniv6.mp3'
    let thumbnailUrl = 'https://files.catbox.moe/jjiqdb.jpeg'
    let videoLink = 'https://youtube.com/watch?v=tRf0pd5FS-I&si=A7Vl3LcKR9FPaSsT'

    // 1. إرسال التفاعل المطلوب 🌼
    await conn.sendMessage(m.chat, { react: { text: '🌋', key: m.key } })

    // 2. تجهيز الصورة (Thumbnail)
    let thumb = await (await fetch(thumbnailUrl)).buffer()

    // 3. تجهيز ملف الصوت كموسيقى (ptt: false و mimetype: audio/mpeg)
    let message = await prepareWAMessageMedia(
      { 
        audio: { url: audioUrl }, 
        mimetype: 'audio/mpeg', // تم التغيير من ogg ليعمل كموسيقى
        ptt: false 
      }, 
      { upload: conn.waUploadToServer }
    )

    // 4. توليد الرسالة التفاعلية مع البطاقة
    const template = generateWAMessageFromContent(
      m.chat,
      {
        audioMessage: {
          ...message.audioMessage,
          duration: 180, // الثواني تظهر في الواجهة
          contextInfo: {
            externalAdReply: {
              title: 'WELCOME TO GOJO BOT',
              body: '© 2026 𝐘𝐎𝐍𝐎 𝐃𝐄𝐕',
              mediaType: 2, // فيديو/رابط فيديو
              thumbnail: thumb,
              mediaUrl: videoLink,
              sourceUrl: videoLink,
              renderLargerThumbnail: true
            }
          }
        }
      },
      { quoted: m }
    )

    // 5. إرسال الرسالة
    await conn.relayMessage(m.chat, template.message, { messageId: template.key.id })

  } catch (e) {
    console.error(e)
    m.reply('حصل خطأ 😢')
  }
}

// الإعدادات المطلوبة للتشغيل عند مناداة "بوت" أو "غوجو"
handler.customPrefix = /^(بوت|غوجو)$/i
handler.command = new RegExp() 

export default handler