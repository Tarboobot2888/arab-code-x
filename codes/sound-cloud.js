// plugins/soundcloud.js
// ✧ 2B - YoRHa Unit No.2 Type B - تحميل من SoundCloud 🎵

import fetch from "node-fetch";
import { theme } from '../core/theme.js';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

let CLIENT_IDS = [
  'DzA2vRpkKqKVM37Lh9O3XPIJwTpL4U9M',
  'a3e059563d7fd3372b49b37f00a00bcf',
  'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
  'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M',
  'ZbE1zOjMvRkXpL2qW8yN5cF7uA3sD6gH9jK',
];

async function searchSoundCloud(query, limit = 10) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://soundcloud.com',
    'Referer': 'https://soundcloud.com/'
  };

  for (const cid of CLIENT_IDS) {
    try {
      const url = `https://api-v2.soundcloud.com/search?q=${encodeURIComponent(query)}&client_id=${cid}&limit=${limit}&variant_ids=`;
      const res = await fetch(url, { headers });
      if (res.status === 429) continue;
      if (!res.ok) continue;
      const data = await res.json();
      const tracks = data?.collection?.filter(item => item.kind === 'track') || [];
      if (tracks.length > 0) return tracks.slice(0, limit);
    } catch (err) {
      console.log(`[2B-SC] Search error: ${err.message}`);
    }
  }
  return [];
}

async function downloadSoundCloud(trackUrl) {
  for (const cid of CLIENT_IDS) {
    try {
      const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${cid}`;
      const res = await fetch(resolveUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      if (res.status === 429) continue;
      if (!res.ok) continue;
      const track = await res.json();
      if (!track?.media?.transcodings?.length) continue;
      
      const tc = track.media.transcodings;
      const pick = tc.find(t => t.format?.protocol === 'progressive') || tc[0];
      if (!pick?.url) continue;
      
      const sep = pick.url.includes('?') ? '&' : '?';
      const streamRes = await fetch(`${pick.url}${sep}client_id=${cid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      if (streamRes.status === 429) continue;
      if (!streamRes.ok) continue;
      
      const streamData = await streamRes.json();
      if (!streamData?.url) continue;
      
      return {
        audioUrl: streamData.url,
        title: track.title || 'SoundCloud',
        thumb: track.artwork_url ? track.artwork_url.replace('large', 't500x500') : null,
      };
    } catch (err) {
      console.log(`[2B-SC] Download error: ${err.message}`);
    }
  }
  throw new Error('فشل التحميل');
}

let handler = async (m, { conn, text, usedPrefix, command }) => {

  const react = async (emoji) => {
    try { await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }); } catch {}
  };

  if (text && text.includes('soundcloud.com')) {
    react('⏳');
    try {
      const result = await downloadSoundCloud(text.trim());
      await conn.sendMessage(m.chat, {
        audio: { url: result.audioUrl },
        mimetype: 'audio/mpeg',
        ptt: false
      }, { quoted: m });
      react('✅');
    } catch (e) {
      react('❌');
      m.reply(theme.build([
        { type: 'title', text: '❄️ 2B: "فشل التحميل"' },
        { type: 'warning', text: e.message }
      ]));
    }
    return;
  }

  if (!text) {
    return m.reply(theme.build([
      { type: 'title', text: '🎵 2B: "وحدة SoundCloud"' },
      { type: 'divider' },
      { type: 'line', text: '🔮 *تحميل الأغاني من SoundCloud*' },
      { type: 'divider' },
      { type: 'info', label: '⚔️ الاستخدام', value: `${usedPrefix + command} <اسم الأغنية>` },
      { type: 'spacer' },
      { type: 'info', label: '📌 مثال', value: `${usedPrefix + command} faded alan walker` }
    ]));
  }

  react('🔍');
  await m.reply(theme.build([
    { type: 'title', text: '🔍 2B: "جاري البحث"' },
    { type: 'info', label: '🎯 الهدف', value: text }
  ]));

  try {
    const tracks = await searchSoundCloud(text, 10);
    if (!tracks.length) {
      react('❌');
      return m.reply(theme.build([
        { type: 'title', text: '❄️ 2B: "لا توجد نتائج"' },
        { type: 'warning', text: `لم يتم العثور على نتائج للبحث: ${text}` }
      ]));
    }

    // ✅ تجهيز صورة من أول نتيجة فيها صورة
    let headerImage = null;
    for (const track of tracks) {
      if (track.artwork_url) {
        try {
          const imgUrl = track.artwork_url.replace('large', 't500x500');
          const imgRes = await fetch(imgUrl);
          if (imgRes.ok) {
            headerImage = Buffer.from(await imgRes.arrayBuffer());
            break;
          }
        } catch {}
      }
    }

    // بناء القائمة
    const sections = [];
    const rows = [];
    
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const artistName = track.user?.username || track.user?.full_name || 'Unknown';
      const duration = Math.floor(track.duration / 60000) + ':' + Math.floor((track.duration % 60000) / 1000).toString().padStart(2, '0');
      const title = track.title.length > 35 ? track.title.substring(0, 32) + '...' : track.title;
      
      rows.push({
        title: `${i + 1}. ${title}`,
        description: `👤 ${artistName} | ⏱️ ${duration}`,
        id: `.ساوند_تحميل ${track.permalink_url}`
      });
    }
    
    sections.push({
      title: "🎵 نتائج البحث",
      rows: rows
    });

    // ✅ بناء الهيدر بالصورة (طريقة بسيطة)
    let header = { hasMediaAttachment: false };
    
    if (headerImage) {
      const media = await prepareWAMessageMedia(
        { image: headerImage },
        { upload: conn.waUploadToServer }
      );
      header = {
        hasMediaAttachment: true,
        imageMessage: media.imageMessage
      };
    }

    const msg = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: proto.Message.InteractiveMessage.fromObject({
            body: proto.Message.InteractiveMessage.Body.create({
              text: theme.build([
                { type: 'title', text: '🎵 2B: "نتائج البحث"' },
                { type: 'info', label: '🎯 البحث', value: text },
                { type: 'info', label: '📊 النتائج', value: `${tracks.length} أغنية` },
                { type: 'divider' },
                { type: 'line', text: '⚔️ اضغط على الزر لاختيار الأغنية' }
              ])
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: '❄️ 2B - YoRHa Unit No.2 Type B ❄️'
            }),
            header: proto.Message.InteractiveMessage.Header.fromObject(header),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
              buttons: [
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    title: "🎵 اختر الأغنية",
                    sections: sections
                  })
                }
              ],
              messageParamsJson: JSON.stringify({
                bottom_sheet: {
                  in_thread_buttons_limit: 1,
                  list_title: "🎵 قائمة الأغاني",
                  button_title: "🎵 عرض النتائج"
                }
              })
            })
          })
        }
      }
    }, { userJid: conn.user.jid, quoted: m });

    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
    react('✅');

  } catch (e) {
    console.error('[2B-SC]', e);
    react('❌');
    m.reply(theme.build([
      { type: 'title', text: '❄️ 2B: "فشلت مهمة البحث"' },
      { type: 'warning', text: e.message }
    ]));
  }
};

// معالج الأزرار - تحميل مباشر
handler.before = async function (m, { conn }) {
  if (!m.text) return;
  
  if (m.text.startsWith('.ساوند_تحميل')) {
    const trackUrl = m.text.replace('.ساوند_تحميل', '').trim();
    if (trackUrl) {
      await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } }).catch(() => {});
      try {
        const result = await downloadSoundCloud(trackUrl);
        await conn.sendMessage(m.chat, {
          audio: { url: result.audioUrl },
          mimetype: 'audio/mpeg',
          ptt: false
        }, { quoted: m });
        await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } }).catch(() => {});
      } catch (e) {
        await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } }).catch(() => {});
        m.reply(theme.build([
          { type: 'title', text: '❄️ 2B: "فشل التحميل"' },
          { type: 'warning', text: e.message }
        ]));
      }
      return true;
    }
  }
  return;
};

handler.help = ['ساوند <اسم>'];
handler.tags = ['downloader'];
handler.command = /^(اغنيه|soundcloud|sc)$/i;

export default handler;