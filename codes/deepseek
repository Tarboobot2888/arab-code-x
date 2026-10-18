// ⧼ 𝑷𝑹𝑶𝑻𝑶𝑻𝒀𝑷𝑬 ⧽
// ♡ Raiden Shogun - Plane of Euthymia - DeepSeek AI 🤖

import axios from "axios";
import crypto from "node:crypto";
import { theme } from '../core/theme.js';

const BASE = "https://notegpt.io";

const ua =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function uuid() {
  return crypto.randomUUID();
}

function randomNumber(length = 10) {
  let result = "";
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10);
  return result;
}

function makeSboxGuid() {
  const now = Math.floor(Date.now() / 1000);
  const raw = `${now}|762|${randomNumber(9)}`;
  return Buffer.from(raw).toString("base64");
}

function makeCookieHeader() {
  const now = Math.floor(Date.now() / 1000);
  const anonymousUserId = uuid();

  return [
    `_ga_PFX3BRW5RQ=GS2.1.s${now}$o1$g0$t${now}$j60$l0$h${randomNumber(9)}`,
    `_ga=GA1.2.${randomNumber(9)}.${now}`,
    `_gid=GA1.2.${randomNumber(9)}.${now}`,
    `_gat_gtag_UA_252982427_14=1`,
    `sbox-guid=${encodeURIComponent(makeSboxGuid())}`,
    `anonymous_user_id=${anonymousUserId}`,
  ].join("; ");
}

function parseSSE(rawBody) {
  let answer = "";
  let reasoning = "";

  for (const line of rawBody.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean.startsWith("data:")) continue;

    const raw = clean.replace(/^data:\s*/, "").trim();
    if (!raw || raw === "[DONE]") continue;

    try {
      const json = JSON.parse(raw);

      if (json.reasoning) reasoning += json.reasoning;
      if (json.text) answer += json.text;
      if (json.done) break;
    } catch {}
  }

  return {
    answer,
    reasoning,
  };
}

async function DeepSeekThinking(prompt) {
  const conversationId = uuid();
  const cookieHeader = makeCookieHeader();

  const payload = {
    message: prompt,
    language: "auto",
    model: "deepseek-v4-flash",
    tone: "default",
    length: "moderate",
    conversation_id: conversationId,
    image_urls: [],
    history_messages: [],
    chat_mode: "deep_think",
  };

  const res = await axios.post(
    `${BASE}/api/v2/chat/stream`,
    JSON.stringify(payload),
    {
      timeout: 120000,
      responseType: "stream",
      validateStatus: () => true,
      headers: {
        "sec-ch-ua-platform": `"Android"`,
        "User-Agent": ua,
        "sec-ch-ua": `"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"`,
        "Content-Type": "application/json",
        "sec-ch-ua-mobile": "?1",
        Accept: "*/*",
        Origin: BASE,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        Referer: `${BASE}/chat-deepseek`,
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "ar,en;q=0.9",
        Cookie: cookieHeader,
        priority: "u=1, i",
      },
    },
  );

  let rawBody = "";
  res.data.setEncoding("utf8");

  res.data.on("data", (chunk) => {
    rawBody += chunk;
  });

  return await new Promise((resolve) => {
    res.data.on("end", () => {
      const parsed = parseSSE(rawBody);

      resolve({
        status: res.status,
        success: Boolean(parsed.answer || parsed.reasoning),
        conversation_id: conversationId,
        model: payload.model,
        chat_mode: payload.chat_mode,
        prompt,
        answer: parsed.answer,
        reasoning: parsed.reasoning,
        raw: parsed.answer || parsed.reasoning ? undefined : rawBody,
      });
    });

    res.data.on("error", (error) => {
      resolve({
        status: res.status,
        success: false,
        conversation_id: conversationId,
        model: payload.model,
        chat_mode: payload.chat_mode,
        prompt,
        answer: "",
        reasoning: "",
        error: error.message,
      });
    });
  });
}

async function splitAndSend(conn, chat, text, quoted) {
  const MAX_LENGTH = 4000;
  if (text.length <= MAX_LENGTH) {
    return conn.sendMessage(chat, { text }, { quoted });
  }

  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MAX_LENGTH);
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > MAX_LENGTH / 2) {
      chunk = chunk.slice(0, lastNewline);
    }
    parts.push(chunk);
    remaining = remaining.slice(chunk.length);
  }

  for (let i = 0; i < parts.length; i++) {
    const header = parts.length > 1 ? `📄 *جزء ${i + 1}/${parts.length}*\n\n` : '';
    await conn.sendMessage(chat, { text: header + parts[i] }, { quoted: i === 0 ? quoted : null });
  }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const prompt = text?.trim();

  if (!prompt) {
    return conn.sendMessage(m.chat, {
      text: theme.build([
        { type: 'title', text: '🤖 DeepSeek V4' },
        { type: 'divider' },
        { type: 'line', text: '💭 ذكاء اصطناعي يفكر أولاً ثم يجيب' },
        { type: 'spacer' },
        { type: 'info', label: '📌 الاستخدام', value: `${usedPrefix + command} <سؤال>` },
        { type: 'info', label: '📋 مثال', value: `${usedPrefix + command} ما هو الثقب الأسود؟` },
        { type: 'divider' },
        { type: 'tip', text: '💡 البوت سيفكر أولاً ثم يرسل الإجابة' }
      ])
    }, { quoted: m });
  }

  await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

  try {
    const result = await DeepSeekThinking(prompt);

    if (!result.success) {
      await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
      return m.reply(theme.build([
        { type: 'title', text: '❌ فشل الاتصال' },
        { type: 'error', text: 'تعذر الحصول على رد من DeepSeek' }
      ]));
    }

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

    let reply = '';
    let hasReasoning = false;

    if (result.reasoning && result.reasoning.length > 10) {
      hasReasoning = true;
      const reasoningPreview =
        result.reasoning.length > 600
          ? result.reasoning.slice(0, 600) + '...'
          : result.reasoning;
      reply += `💭 *عملية التفكير:*\n${reasoningPreview}\n\n`;
    }

    if (result.answer) {
      if (hasReasoning) reply += `🤖 *الإجابة:*\n`;
      reply += result.answer;
    }

    if (!reply.trim()) {
      return m.reply(theme.build([
        { type: 'title', text: '⚠️ رد فارغ' },
        { type: 'line', text: 'لم يتم استلام رد من النموذج' }
      ]));
    }

    await splitAndSend(conn, m.chat, reply, m);

  } catch (e) {
    console.error('[DeepSeek] Error:', e);
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
    return m.reply(theme.build([
      { type: 'title', text: '❌ خطأ' },
      { type: 'error', text: e.message?.slice(0, 200) || 'حدث خطأ غير معروف' }
    ]));
  }
};

handler.help = ['deepseek', 'ds', 'dsv4', 'deepthink', 'ديبسيك', 'تفكير_عميق'];
handler.tags = ['ai'];
handler.command = /^(deepseek|ds|dsv4|deepthink|ديبسيك|تفكير_عميق)$/i;

export default handler;