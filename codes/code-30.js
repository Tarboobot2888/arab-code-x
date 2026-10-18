//كود تحويل الفيديو توكتوك الي صوت كان البوت الي مسجلو 🐦
//تقدر تستخدمو زي كانك بعت ريك ليك مدوانت زاخدو من التيكتوك و كدا يعني
//BLACK




import axios from "axios"
import fs from "fs"
import path from "path"
import ffmpeg from "fluent-ffmpeg"

/* ================= المعالج ================= */

let handler = async (m, { conn, args, usedPrefix, command }) => {
  if (!args[0]) {
    return m.reply(
      `❌ الاستخدام:\n${usedPrefix + command} <رابط_تيك_توك>\n\nمثال:\n${usedPrefix + command} https://vm.tiktok.com/xxxxxx/`
    )
  }

  const url = args[0]

  if (!url.includes('tiktok.com')) {
    return m.reply('❌ ده مش رابط TikTok صحيح')
  }

  // مسارات مؤقتة لمعالجة الملف بداخل السيرفر
  const tmpInput = path.join(`./tmp_${Date.now()}.mp3`);
  const tmpOutput = path.join(`./tmp_${Date.now()}.opus`);

  try {
    await m.reply(`*⏳ جَــأࢪي م࣬ـــ؏ٚـأݪـجَۿ أݪــࢪأبٚطَ وتنزيل المقطع الصوتي...*`)

    // جلب بيانات مقطع التيك توك عبر API الخاص بـ TikWM
    const params = new URLSearchParams()
    params.append("url", url)
    params.append("hd", "1")

    const { data } = await axios.post(
      "https://tikwm.com/api/",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0",
          "Cookie": "current_language=en"
        }
      }
    )

    if (!data || !data.data || !data.data.music) {
      throw new Error('فشل جلب الملف الصوتي من TikTok')
    }

    const res = {
      title: data.data.title || 'TikTok Audio',
      duration: data.data.duration ? `${data.data.duration}s` : 'غير معروف',
      download: data.data.music
    }

    // تحميل ملف الـ MP3 الأصلي وحفظه مؤقتاً
    const audioResponse = await axios.get(res.download, { responseType: 'arraybuffer' })
    fs.writeFileSync(tmpInput, Buffer.from(audioResponse.data, 'binary'))

    // إظهار حالة "جاري تسجيل صوتي..." في الشات
    await conn.sendPresenceUpdate('recording', m.chat);

    // تحويل الملف الصوتي لترميز Opus الخاص بالريكوردات
    await new Promise((resolve, reject) => {
      ffmpeg(tmpInput)
        .toFormat('opus')
        .audioChannels(1) // أحادي ليتطابق مع ريكورد الواتساب
        .audioFrequency(48000)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(tmpOutput);
    });

    // قراءة الملف المحول
    const opusBuffer = fs.readFileSync(tmpOutput);

    // 🎯 إرسال الريكورد كأنه متسجل من البوت حالاً في الشات (بدون أي توجيه أو قنوات)
    await conn.sendMessage(
      m.chat,
      {
        audio: opusBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true // لتبان كـ ريكورد أزرق متسجل
      },
      { quoted: m }
    )

    // رسالة إتمام العملية بنجاح
    let successText = `✔ *تـم الـتـحـمـيـل ✨ بـنـجـاح!* \n\n` +
                      `📌 *العنوان:* ${res.title}\n` +
                      `⏱ *المدة:* ${res.duration}`;

    await m.reply(successText);

  } catch (e) {
    console.error(e)
    await m.reply(`❌ *حدث خطأ أثناء معالجة وتحويل الصوت:*\n${e.message || e}`)
  } finally {
    // تنظيف السيرفر وحذف الملفات المؤقتة
    if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

handler.help = ['ريكو']
handler.command = ['ريكو', 'ttmp3', 'ttaudio']
handler.tags = ['download']

export default handler