import axios from 'axios'

// الزخارف المعتمدة لديك
const startDeco = `☽⚝ͫ͢❏ِꏍ🍡﴿ۦٕۛ۬٭ۦٕۛ۬❏ِ ﷽⎆☽⚝ͫ͢❏ِ🍡ꏍﭕ﴿ۦٕۛ۬٭ۦٕۛ۬❏ِ
╮ ⊰✫⊱─⊰✫⊱─⊰✫⊱╭`

const endDeco = `┘⊰✫⊱─⊰✫⊱─⊰✫⊱└
☽⚝ͫ͢❏ِꏍ🍡﴿ۦٕۛ۬٭ۦٕۛ۬❏ِ ﷽⎆☽⚝ͫ͢❏ِꏍﭕ🍡﴿ۦٕۛ۬٭ۦٕۛ۬❏ِ`

const line1 = `| *◠  ⿻  𝅄ٺــم࣬ أݪٺــحہּٰم࣬ــيـــݪ*`
const line2 = `*◠  ⿻  𝅄شٰــيࢪ ࢪأبٚــطَ أݪــجَࢪوٰبٚ ـ؏ٚـݪــشٰأنٰ أݪــي غٰيــࢪڪٰٖ يسٰــٺفَأډ؍ 🌸♡゙ ُ𓂁*`

// إعدادات الـ API المستخرجة من الـ cURL الخاص بك لتخطي الحماية
const DOWNREELS_API = "https://api.zoraahub.com/fetch.php"
const HEADERS = {
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "content-type": "application/json",
  "cookie": "_ga_ECP5SKBQFR=GS2.1.s1783013499$o1$g0$t1783013499$j60$l0$h0; _ga=GA1.1.514099473.1783013500; dom3ic8zudi28v8lr6fgphwffqoz0j6c=c0d494a1-daba-4f50-8b1f-c051b8003549%3A2%3A1; cf_clearance=imwqauddDXpUML59XipbmqhUWQcpdCP_9XlNVZ10A88-1783013501-1.2.1.1-0IQpncxFmrIldU9bkr6PD8OlRrTAPCIIwJ50VwvRij37Avcgasyr6L8eR45xwKFzDO4nTFl5_wMRaAgPBHfAYxD0AGC9BS6sdt0x8FM6qVntiN73KYHgX536Z0kbp67nOPSejSvGlCATKlmykNf4IVic4klJ7VpBHv6a_prEC.w38w_kz_2twhGRLFKOix2U0yE.TQ4H0lCRJ6FPP69KXg6EHoE5I2ZAPMa8y4m0giop9BEVpzgpwSfPlIxpbNLgCrVfLZAxEa4HvWeZLXTGWW4xBOk5lde7w3aVDdtxaOIEEhzaL4brLZn7am0khNsgGrgE7uLQsJQXjdpaVzAqoA",
  "origin": "https://downreels.com",
  "pragma": "no-cache",
  "referer": "https://downreels.com/en/download-video-instagram/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
}

// دالة الكوتات (الجهة الاتصال الفيك)
function contactQuote(m) {
  return {
    key: {
      participants: '0@s.whatsapp.net',
      remoteJid: 'status@broadcast',
      fromMe: false,
      id: 'GOKU'
    },
    message: {
      contactMessage: {
        displayName: m.pushName || 'Unknown',
        vcard: `BEGIN:VCARD
VERSION:3.0
N:${m.pushName || 'User'};;;;
FN:${m.pushName || 'User'}
item1.TEL;waid=${m.sender.split('@')[0]}:${m.sender.split('@')[0]}
item1.X-ABLabel:📞 WhatsApp
ORG:NEZUKO BOT ✓
TITLE:Verified
END:VCARD`
      }
    },
    participant: '0@s.whatsapp.net'
  }
}

let handler = async (m, { conn, args, usedPrefix, command }) => {
    const fkontak = contactQuote(m)

    // التحقق من وجود رابط
    if (!args[0]) {
        return conn.reply(
            m.chat,
            `${startDeco}\n\n*• يرجى وضع رابط فيديو انستغرام بعد الأمر*\n\n*مثال:*\n${usedPrefix + command} https://www.instagram.com/reel/C7X.../\n\n${endDeco}`,
            fkontak
        )
    }

    await conn.reply(
        m.chat,
        `${startDeco}\n\n*⏳ جاري التحميل بأعلى دقة متوفرة HD...*\n\n${endDeco}`,
        fkontak
    )

    try {
        // إرسال الطلب إلى خادم دوان ريلز مباشرة
        const response = await axios.post(DOWNREELS_API, { url: args[0] }, { headers: HEADERS, timeout: 25000 })
        const data = response.data

        if (data.status !== "ok" || !data.videos || data.videos.length === 0) {
            throw new Error('تعذر استخراج روابط التحميل، تأكد أن الحساب عام (Public).')
        }

        // فلترة للبحث عن رابط الـ HD أو اختيار أعلى جودة متوفرة في القائمة
        const getBestVideo = (videoList) => {
            const hdVideo = videoList.find(v => v.quality && v.quality.toLowerCase().includes("hd"))
            return hdVideo ? hdVideo.url : videoList[0].url
        }

        // حالة 1: فيديو منفرد
        if (data.videos.length === 1) {
            let downloadUrl = getBestVideo(data.videos)

            await conn.sendMessage(
                m.chat,
                {
                    video: { url: downloadUrl },
                    caption: `${startDeco}\n\n🎬 *تم استخراج الفيديو بدقة عالية HD*\n\n${line1}\n${line2}\n\n${endDeco}`
                },
                { quoted: fkontak }
            )
        } 
        
        // حالة 2: ألبوم ميديا متعددة (سلايدر)
        else if (data.videos.length > 1) {
            await conn.reply(m.chat, `📦 تم العثور على ألبوم يحتوي على (${data.videos.length}) ملفات، جاري إرسالها تتابعيًا...`, fkontak)
            
            for (const item of data.videos) {
                if (item.isVideo) {
                    await conn.sendMessage(m.chat, { video: { url: item.url } }, { quoted: fkontak })
                } else {
                    await conn.sendMessage(m.chat, { image: { url: item.url } }, { quoted: fkontak })
                }
            }
        }

    } catch (e) {
        console.error(e)
        await conn.reply(
            m.chat,
            `${startDeco}\n\n*❌ حدث خطأ أثناء جلب المقطع:*\n${e.message || e}\n\n${endDeco}`,
            fkontak
        )
    }
}

// الإعدادات والمفاتيح الخاصة بالبوت
handler.help = ['انستا', 'insta']
handler.tags = ['downloader']
handler.command = /^(انستا|انستغرام|insta|instagram|reel)$/i

export default handler