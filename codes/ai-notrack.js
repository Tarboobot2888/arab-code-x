// أمر نوت-تراك - التحدث مع الذكاء الاصطناعي Notrack
// ⏤͟͞ू⃪𝑵𝜩𝒁𝑼𝑲̤͝𝜣͓ۧٛ͢ ͝ 𝑩𝜣𝑻🍓

import axios from 'axios';

// ============================================================
// إعدادات ثابتة (الكوكيز والهيدرز)
// ============================================================
const COOKIE = 'si_usr_id=54MdSvFT_14LFH4; uid=3d7d0119-aa54-44dd-9210-730e0995d422; si_ses_id=54MrGORj_1X3JTL';

const HEADERS = {
  'accept': '*/*',
  'accept-language': 'ar-SD',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'cookie': COOKIE,
  'origin': 'https://notrack.ai',
  'pragma': 'no-cache',
  'priority': 'u=1, i',
  'referer': 'https://notrack.ai/chat',
  'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
};

// ============================================================
// الدوال الأساسية
// ============================================================

// إرسال الرسالة إلى Notrack ومعالجة التدفق
async function askNotrack(question) {
  const payload = {
    user_input: question,
    mode: 'usual',
    model: 'C',
    persona: 'normal',
    max_turns: 6,
    chat_id: null,
    attachments: [],
    regenerate: false,
    edit: false,
    edit_mid: null
  };

  const response = await axios.post(
    'https://notrack.ai/api/dispatch',
    payload,
    {
      headers: HEADERS,
      responseType: 'stream',
      timeout: 60000
    }
  );

  return new Promise((resolve, reject) => {
    let fullAnswer = '';
    let buffer = '';
    let done = false;

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data: ')) {
          const jsonPart = trimmed.substring(6);
          try {
            const parsed = JSON.parse(jsonPart);
            
            if (parsed.type === 'delta' && parsed.chunk) {
              fullAnswer += parsed.chunk;
            }
            
            if (parsed.type === 'message' && parsed.content) {
              fullAnswer = parsed.content;
            }
            
            if (parsed.type === 'done') {
              done = true;
            }
          } catch (e) {
            // تجاهل الأسطر غير الصالحة
          }
        }
      }
    });

    response.data.on('end', () => {
      if (fullAnswer.trim()) {
        resolve(fullAnswer.trim());
      } else {
        reject(new Error('لم يتم استلام أي رد من الذكاء الاصطناعي'));
      }
    });

    response.data.on('error', (err) => {
      reject(err);
    });
  });
}

// ============================================================
// الأمر الرئيسي
// ============================================================

const handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `💬 *أمر نوت-تراك (AI)*\n\n` +
      `*الاستخدام:*\n${usedPrefix + command} سؤالك هنا\n\n` +
      `*مثال:*\n${usedPrefix + command} ما هي ميزاتك؟`
    );
  }

  await m.reply('⏳ *جاري التفكير...*');
  await m.react('💭');

  try {
    const answer = await askNotrack(text);

    // تقسيم الرد إذا كان طويلاً (حد واتساب 4096 حرف)
    const maxLength = 4000;
    if (answer.length > maxLength) {
      const parts = answer.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [];
      for (const part of parts) {
        await conn.sendMessage(m.chat, { text: part }, { quoted: m });
      }
    } else {
      await conn.sendMessage(m.chat, { text: answer }, { quoted: m });
    }

    await m.react('✅');
  } catch (err) {
    console.error('خطأ في نوت-تراك:', err.message);
    let errorMsg = err.message || 'خطأ غير معروف';
    if (err.response?.status === 403 || err.response?.status === 401) {
      errorMsg = '⚠️ انتهت صلاحية الجلسة. يرجى تحديث الكوكيز في الكود.';
    }
    await m.reply(`❌ *حدث خطأ:* ${errorMsg}`);
    await m.react('❌');
  }
};

handler.help = ['نوت-تراك <سؤال>'];
handler.tags = ['ai'];
handler.command = /^(نوت-تراك|notrack)$/i;

export default handler;