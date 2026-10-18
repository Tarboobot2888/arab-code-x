/**
 * 🎵 YouTube Audio Downloader (PTT/Record Mode) — نيزوكو ريكورد
 * ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🎀
 * يقوم بتحميل الصوت من يوتيوب وتحويله ديناميكياً إلى صيغة opus ليعمل كـ ريكورد أزرق
 */

import crypto from "crypto"
import axios from "axios"
import fs from "fs"
import path from "path"
import ffmpeg from "fluent-ffmpeg"

// --- إعدادات وثوابت البث والقناة (Newsletter) للوهم البرمجي ---
const newsletterJid  = '120363407598531220@newsletter';
const newsletterName = '.𓏲⋆˙𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🎀';

class SaveTube {
  constructor() {
    this.ky = 'C5D58EF67A7584E4A29F6C35BBC4EB12'
    this.m = /^((?:https?:)?\/\/)?((?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]{11})/
    this.is = axios.create({
      headers: {
        'content-type': 'application/json',
        'origin': 'https://yt.savetube.me',
        'user-agent': 'Mozilla/5.0 (Android 15; Mobile)'
      }
    })
  }

  async decrypt(enc) {
    const buf = Buffer.from(enc, 'base64')
    const key = Buffer.from(this.ky, 'hex')
    const iv = buf.slice(0, 16)
    const data = buf.slice(16)

    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final()
    ])

    return JSON.parse(decrypted.toString())
  }

  async getCdn() {
    const res = await this.is.get("https://media.savetube.vip/api/random-cdn")
    return { status: true, data: res.data.cdn }
  }

  async download(url) {
    const id = url.match(this.m)?.[3]
    if (!id) throw "رابط يوتيوب غير صالح"

    const cdn = await this.getCdn()
    const info = await this.is.post(`https://${cdn.data}/v2/info`, {
      url: `https://www.youtube.com/watch?v=${id}`
    })

    const dec = await this.decrypt(info.data.data)

    const dl = await this.is.post(`https://${cdn.data}/download`, {
      id,
      downloadType: 'audio',
      quality: '128',
      key: dec.key
    })

    return {
      title: dec.title,
      duration: dec.duration,
      thumb: dec.thumbnail,
      download: dl.data.data.downloadUrl
    }
  }
}

/* ================= المعالج ================= */

let handler = async (m, { conn, args, usedPrefix, command }) => {
  if (!args[0]) {
    return m.reply(
      `❌ الاستخدام:\n${usedPrefix + command} <رابط_يوتيوب>\n\nمثال:\n${usedPrefix + command} https://youtu.be/U2vyax9Uufc`
    )
  }

  const url = args[0]
  const st = new SaveTube()

  // 1️⃣ كائن الـ contextInfo للرسائل النصية التوضيحية
  const infoContextInfo = {
    mentionedJid: [m.sender],
    isForwarded: true,
    forwardingScore: 999,
    forwardedNewsletterMessageInfo: {
      newsletterJid: newsletterJid,
      newsletterName: newsletterName,
      serverMessageId: -1
    },
    externalAdReply: {
      title: '.𓏲⋆˙𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🎀',
      body: 'تحميل يوتيوب وتحويله لـ ريكورد 🎧',
      thumbnail: global.icons || '', 
      sourceUrl: 'https://whatsapp.com/channel/0029Vb7AkG84inotOc8BXE1K',
      mediaType: 1,
      renderLargerThumbnail: false
    }
  };

  // 2️⃣ كائن الـ contextInfo المخصص للريكورد الصوتي (بدون إعلانات ومربعات روابط)
  const audioContextInfo = {
    mentionedJid: [m.sender],
    isForwarded: true,
    forwardingScore: 999,
    forwardedNewsletterMessageInfo: {
      newsletterJid: newsletterJid,
      newsletterName: newsletterName,
      serverMessageId: -1
    }
  };

  // مسارات مؤقتة لمعالجة الملف بداخل السيرفر وتفادي استهلاك الرام
  const tmpInput = path.join(`./tmp_${Date.now()}.mp3`);
  const tmpOutput = path.join(`./tmp_${Date.now()}.opus`);

  try {
    await conn.reply(
      m.chat,
      `*⏳ جَــأࢪي م࣬ـــ؏ٚـأݪـجَۿ أݪــࢪأبٚطَ وتنزيل المقطع الصوتي...*`,
      m,
      { contextInfo: infoContextInfo, quoted: m }
    )

    const res = await st.download(url)

    // تحميل ملف الـ MP3 الأصلي وحفظه مؤقتاً في السيرفر
    const audioResponse = await axios.get(res.download, { responseType: 'arraybuffer' })
    fs.writeFileSync(tmpInput, Buffer.from(audioResponse.data, 'binary'))

    // تحديث الحالة إلى تسجيل صوتي لإعطاء المظهر الحقيقي الحركي
    await conn.sendPresenceUpdate('recording', m.chat);

    // ⚙️ عملية التحويل البرمجية إلى ترميز opus المتوافق بالملي مع الـ PTT
    await new Promise((resolve, reject) => {
      ffmpeg(tmpInput)
        .toFormat('opus')
        .audioChannels(1) // تحويله لأحادية لتطابق تسجيل الواتساب القياسي
        .audioFrequency(48000)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(tmpOutput);
    });

    // قراءة ملف الـ opus الناتج
    const opusBuffer = fs.readFileSync(tmpOutput);

    // إرسال المقطع على هيئة ريكورد رسمي أزرق
    await conn.sendMessage(
      m.chat,
      {
        audio: opusBuffer,
        mimetype: 'audio/ogg; codecs=opus', // تفعيل الترميز المعتمد
        ptt: true, // تفعيل ميزة الريكورد الحقيقي الحركي
        fileName: `${res.title}.opus`,
        contextInfo: audioContextInfo // خالي من الـ externalAdReply لحذف المربع الأسود وعلامة الرابط
      },
      { quoted: m }
    )

    // رسالة إتمام العملية بنجاح بالثيم الخاص بك
    let successText = `✔ *تـم الـتـحـمـيـل ✨ بـنـجـاح!* \n\n` +
                      `📌 *العنوان:* ${res.title}\n` +
                      `⏱ *المدة:* ${res.duration}\n` +
                      `🎀 *بواسطة:* ${newsletterName}`;

    await conn.reply(m.chat, successText, m, { contextInfo: infoContextInfo, quoted: m });

  } catch (e) {
    console.error(e)
    await conn.reply(
      m.chat,
      `❌ *حدث خطأ أثناء معالجة وتحويل الصوت:*\n${e.message || e}`,
      m,
      { contextInfo: infoContextInfo, quoted: m }
    )
  } finally {
    // تنظيف السيرفر وحذف الملفات المؤقتة تلقائياً لعدم ملء مساحة التخزين (Storage)
    if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

handler.help = ['صوت']
handler.command = ['صوت', 'ytmp3', 'mp3']
handler.tags = ['download']

export default handler