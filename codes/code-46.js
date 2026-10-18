// plugins/تست.js
import axios from 'axios'

const SEARCH_KEYWORDS = [
    'jjk edit','naruto edit','anime edit','aot edit','demon slayer edit','solo leveling edit','phonk anime edit',
    'itachi uchiha edit','pain edit','obito uchiha edit','sasuke rinnegan edit','minato edit','madara phonk','kakashi edit','gaara edit',
    'luffy gear 5 edit','zoro amv','law edit','doflamingo edit','katakuri edit','sanji edit','ace edit','shanks edit',
    'levi ackerman edit','eren yeager edit','mikasa edit','eren rumbling edit',
    'aizen edit 4k','ichigo bankai edit','ulquiorra edit','grimmjow edit',
    'gojo edit','sukuna edit','toji fushiguro edit','geto edit',
    'rengoku edit','akaza edit','muichiro edit','tanjiro hinokami edit',
    'sung jinwoo edit','beru edit',
    'asta black clover edit','yami sukehiro edit','noelle edit',
    'denji edit','makima edit','aki hayakawa edit',
    'kaneki phonk edit','kaneki ken edit','tokyo ghoul phonk',
    'goku ultra instinct edit','vegeta ultra ego edit','gohan beast edit','broly edit'
]

let lastVideos = []

async function getHDVideoBuffer(videoUrl) {
  try {
    const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`);
    const data = res.data?.data;
    if (!data) return null;
    const bestQualityUrl = data.hdplay || data.play;
    if (!bestQualityUrl) return null;
    const videoStream = await axios({
      method: 'get',
      url: bestQualityUrl,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'arraybuffer'
    });
    return Buffer.from(videoStream.data);
  } catch (e) {
    return null;
  }
}

let handler = async (m, { conn, text }) => {
  await conn.sendMessage(m.chat, { react: { text: "⏳", key: m.key } });
  try {
    let query = text || SEARCH_KEYWORDS[Math.floor(Math.random() * SEARCH_KEYWORDS.length)]
    const searchRes = await axios.get(`https://www.monte-dev.online/api/search/tiktok-search?q=${encodeURIComponent(query)}`);
    let videos = searchRes.data?.result?.videos || [];
    if (videos.length === 0) {
      await conn.sendMessage(m.chat, { react: { text: "❌", key: m.key } });
      return;
    }
    videos = videos.filter(v => !lastVideos.includes(v.url))
    if (videos.length === 0) videos = searchRes.data?.result?.videos || []
    const randomVid = videos[Math.floor(Math.random() * videos.length)]
    lastVideos.push(randomVid.url)
    if (lastVideos.length > 20) lastVideos.shift()
    const buffer = await getHDVideoBuffer(randomVid.url)
    if (!buffer) {
      await conn.sendMessage(m.chat, { react: { text: "❌", key: m.key } });
      return;
    }

    // ✅ فيديو دائري بدون اي حرف
    await conn.sendMessage(m.chat, { 
      video: buffer, 
      mimetype: 'video/mp4',
      ptv: true 
    }, { quoted: m });

    await conn.sendMessage(m.chat, { react: { text: "✅", key: m.key } });
  } catch (e) {
    await conn.sendMessage(m.chat, { react: { text: "❌", key: m.key } });
  }
};

handler.command = /^(تست|تيست|test|anime)$/i
handler.rowner = true
export default handler