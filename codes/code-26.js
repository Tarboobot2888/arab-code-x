/* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
 * 👤 المطور: YONO  
 * 🤖 البوت: ♛ 𝐆𝐎𝐉𝐎-𝐁𝐎𝐓 ♛
 * 📦 الوظيفة: نشيد عشوائي حرب/ديني تحميل مباشر
 * 🪖 القنات : https://whatsapp.com/channel/0029VbDd8Iw5Ejxwlvjl3l1r
 * ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎 〕⌬ ╄╾ ━
 */

import crypto from "crypto"
import axios from "axios"
import yts from 'yt-search'

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
    const decrypted = Buffer.concat([ decipher.update(data), decipher.final() ])
    return JSON.parse(decrypted.toString())
  }
  async getCdn() {
    const res = await this.is.get("https://media.savetube.vip/api/random-cdn")
    return res.data.cdn
  }
  async download(url) {
    const id = url.match(this.m)?.[3]
    if (!id) throw "Invalid YouTube URL"
    const cdn = await this.getCdn()
    const info = await this.is.post(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${id}` })
    const dec = await this.decrypt(info.data.data)
    const dl = await this.is.post(`https://${cdn}/download`, { id, downloadType: 'audio', quality: '128', key: dec.key })
    return { title: dec.title, duration: dec.durationLabel || dec.duration, thumb: dec.thumbnail, download: dl.data.data.downloadUrl }
  }
}

let handler = async (m, { conn, text }) => {
  try {
    let query = text?.trim()

    // لائحة ضخمة عشوائية إلا ما كتب والو
    if (!query) {
      const list = [
        "دربنا درب طويل نشيد الحرب", "نشيد الحرب قادمون", "نشيد اثبت يا قلبي",
        "نشيد صليل الصوارم", "نشيد يا عابد الحرمين", "نشيد خيبر خيبر يا يهود",
        "نشيد قادم يا أقصى حماسي", "نشيد لبيك يا أقصى", "نشيد نحن جند الله",
        "نشيد أمتي قد لاح فجر", "نشيد عزة الاسلام", "نشيد يا رجال الله",
        "نشيد ديني حزين بدون موسيقى", "أناشيد إسلامية جهادية حماسية",
        "نشيد أين أسود السنة", "نشيد الحرب جهادي 2024", "نشيد قوة الايمان",
        "نشيد دعوني أناجي حبيبي", "نشيد غرباء", "نشيد نمضي على درب النضال"
      ]
      query = list[Math.floor(Math.random() * list.length)]
    }

    await conn.sendMessage(m.chat, { react: { text: '⚔️', key: m.key } })

    // بحث يوتيوب
    let search = await yts(query + " نشيد")
    if (!search.videos.length) throw 'ما لقيت حتى نشيد'
    // يختار واحد عشوائي من اول 5 باش ما يتكررش
    let video = search.videos.sort(() => 0.5 - Math.random()).slice(0,5)[0]

    await conn.sendMessage(m.chat, {
      text: `* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 الأوامــر┊ ˼‏ 🧬˹ ↶〕* *♣️ ───━ •﹝📌﹞• ━─── *GOJO * ──¤﹝تـحـمـيـل نـشـيـد ↶ ⚔️﹞*
> *🥷🏻┊الـبـحـث:* ${query}
> *🥷🏻┊تـم اخـتـيـار:* ${video.title}
> *🥷🏻┊جـاري الـتـحـمـيـل...*

* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎 〕⌬ ╄╾ ━ *`
    }, { quoted: m })

    // تحميل عبر كلاسك الأصلي
    const st = new SaveTube()
    const res = await st.download(video.url)

    let caption = `* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 ♛ 〕 نـشـيـد الـحـرب / ديـنـي ♣️*
> *🥷🏻┊الـعـنـوان:* ${res.title}
> *🥷🏻┊الـمـدة:* ${res.duration}
> *🥷🏻┊الـمـصـدر:* ${video.url}

*🪖 ──¤﹝مـعـلـومـات الـنـظـام↶﹞*
> *⚜️┊اسـم الـبـوت:* *𝐆𝐎𝐉𝐎-𝐁𝐎𝐓*
* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎 〕⌬ ╄╾ ━ *`

    await conn.sendMessage(m.chat, {
      audio: { url: res.download },
      mimetype: 'audio/mpeg',
      fileName: `${res.title}.mp3`,
      ptt: false,
      contextInfo: {
        isForwarded: true,
        forwardingScore: 999,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363428598542954@newsletter',
          newsletterName: '⚡ 𝐆𝐎𝐉𝐎-𝐁𝐎𝐓 🩸',
          serverMessageId: 100
        }
      }
    }, { quoted: m })

    await conn.sendMessage(m.chat, { image: { url: res.thumb }, caption }, { quoted: m })
    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })

  } catch (e) {
    console.error(e)
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    m.reply(`* ━ ╼╃ ⌬〔❌〕⌬ ╄╾ ━ *\n> فـشـل: ${e.message || e}\n* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎 〕⌬ ╄╾ ━ *`)
  }
}

handler.help = ['نشيد']
handler.tags = ['اسلامي']
handler.command = /^(نشيد|اناشيد|نشيد-حرب|nashid)$/i
export default handler