/* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
 * امر: مارد
 * ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎-𝐁𝐎𝐓 ❄️ 〕⌬ ╄╾ ━
 * By : 𝐘𝐎𝐍𝐎 𝐃𝐄𝐕 212775630435
 */

import axios from "axios";
import pkg from "@whiskeysockets/baileys";
const { generateWAMessageFromContent, proto, prepareWAMessageMedia} = pkg;

const api_obito = "https://mr-obito-api.vercel.app/api";

let handler = async function (m, { text, conn}) {
  if (!conn.aki) conn.aki = {};
  const sessionKey = `${m.chat}-${m.sender}`;
  const session = conn.aki[sessionKey];

  // القائمة
  if (!text) {
    const buttons = [
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "📘 المساعدة", id: ".مارد المساعدة"})},
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎮 بدء اللعبة", id: ".مارد ابدا"})},
    ];

    const msg = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: `* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 🕴🏻 الـمـارد الازرق┊ ˼‏ 🔮˹ ↶〕*

*🪖 ──¤﹝الـسـؤال ↶ 🕸️﹞*
> *🥷🏻┊هل تريد بدء لعبة المارد؟*
> *🥷🏻┊* فـكـر فـي شـخـصـيـة مـشـهـورة وانـا غـادي نـعـرفـهـا

* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎 〕⌬ ╄╾ ━ *`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: "اختر احد الخيارات:"
            }),
            header: proto.Message.InteractiveMessage.Header.create({
              hasMediaAttachment: false,
              title: "🕴🏻 المارد الازرق"
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons }),
          }),
        },
      },
    }, {});
    return await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id});
  }

  // المساعدة
  if (text === "المساعدة") {
    return m.reply(`* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 📘 شـرح اوامـر الـمـارد┊ ˼‏ 🕸️˹ ↶〕*

*🪖 ──¤﹝الاوامـر ↶ 🕸️﹞*
> *🥷🏻┊*.مارد ابدا → بدء اللعبة
> *🥷🏻┊*.مارد نعم / لا / لا أعرف / ربما / ربما لا → إجابة
> *🥷🏻┊*.مارد رجوع → الرجوع للسؤال السابق
> *🥷🏻┊*.مارد حذف → حذف الجلسة

* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎-𝐁𝐎𝐓 ❄️ 〕⌬ ╄╾ ━ *`);
  }

  // بدء
  if (text === "ابدا") {
    try {
      const { data} = await axios.post(`${api_obito}/akinator_start`);
      if (!data.session ||!data.signature) return m.reply("*❌ فشل بدء الجلسة*");

      conn.aki[sessionKey] = {
        session: data.session,
        signature: data.signature,
        step: 0,
        progression: 0,
      };
      return sendQuestion(m.chat, data.question, data.akitude_url || null, m, conn);
    } catch (err) {
      console.error(err);
      return m.reply("*❌ حدث خطأ أثناء بدء اللعبة*");
    }
  }

  // حذف
  if (text === "حذف") {
    if (!session) return m.reply("*❌ لا توجد جلسة نشطة*");
    delete conn.aki[sessionKey];
    return m.reply("*✅ تم حذف الجلسة بنجاح*");
  }

  // رجوع
  if (text === "رجوع") {
    if (!session) return m.reply("*❌ لا توجد جلسة نشطة*");
    try {
      const { data} = await axios.post(`${api_obito}/akinator_back`, {
        session: session.session,
        signature: session.signature,
        step: session.step,
        progression: session.progression,
        cm: "false",
      });
      conn.aki[sessionKey].step = data.step;
      conn.aki[sessionKey].progression = data.progression;
      return sendQuestion(m.chat, data.question, data.akitude_url || null, m, conn);
    } catch (err) {
      console.error(err);
      return m.reply("*❌ لا يمكن الرجوع حالياً*");
    }
  }

  // الاجابة
  const answers = { "نعم": 0, "لا": 1, "لا أعرف": 2, "ربما": 3, "ربما لا": 4};
  if (answers.hasOwnProperty(text)) {
    if (!session) return m.reply("*❌ لا توجد جلسه نشطه. ابدأ بـ.مارد ابدا*");

    try {
      const { data} = await axios.post(`${api_obito}/akinator_answer`, {
        session: session.session,
        signature: session.signature,
        step: session.step,
        progression: session.progression,
        answer: answers[text],
        cm: "false",
        sid: "NaN",
        question_filter: "string",
      });

      if (data.name_proposition) {
        delete conn.aki[sessionKey];
        return conn.sendMessage(m.chat, {
          image: { url: data.photo},
          caption: `* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 ✅ وجـدتـك┊ ˼‏ 🕴🏻˹ ↶〕*

*🪖 ──¤﹝الـنـتـيـجـة ↶ 🕸️﹞*
> *🥷🏻┊الـشـخـصـيـة:* ${data.name_proposition}
> *🥷🏻┊الـوصـف:* ${data.description_proposition || "بدون وصف"}

* ━ ╼╃ ⌬〔 𝐆𝐎𝐉𝐎-𝐁𝐎𝐓 ❄️ 〕⌬ ╄╾ ━ *`,
        }, { quoted: m});
      }

      conn.aki[sessionKey].step = data.step;
      conn.aki[sessionKey].progression = data.progression;
      return sendQuestion(m.chat, data.question, data.akitude_url || null, m, conn);

    } catch (err) {
      console.error(err);
      return m.reply("*❌ حدث خطأ أثناء الإجابة*");
    }
  }

  // ارسال السؤال بالازرار
  async function sendQuestion(jid, question, imgUrl, quoted, conn) {
    const buttons = [
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "✅ نعم", id: ".مارد نعم" }) },
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "❌ لا", id: ".مارد لا" }) },
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🤔 لا أعرف", id: ".مارد لا أعرف" }) },
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🤷 ربما", id: ".مارد ربما" }) },
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🤨 ربما لا", id: ".مارد ربما لا" }) },
    ];

    const message = {
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text: `* ━ ╼╃ ⌬〔﷽〕⌬ ╄╾ ━ *
> *〔 سـؤال رقـم: ${conn.aki[sessionKey].step + 1}┊ ˼‏ 🕸️˹ ↶〕*

*🪖 ──¤﹝الـمـارد يـسـأل ↶ 🕸️﹞*
> *🥷🏻┊* ${question}`
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
          text: ".مارد رجوع |.مارد حذف"
        }),
        header: proto.Message.InteractiveMessage.Header.create({
          hasMediaAttachment:!!imgUrl,
        ...(imgUrl? { imageMessage: (await prepareWAMessageMedia({ image: { url: imgUrl } }, { upload: conn.waUploadToServer })).imageMessage } : { title: "🕴🏻 المارد يسأل" })
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons }),
      }),
    };

    const msg = generateWAMessageFromContent(jid, { viewOnceMessage: { message } }, { quoted });
    return await conn.relayMessage(jid, msg.message, { messageId: msg.key.id });
  }
};

handler.help = ['مارد'];
handler.tags = ['🎮 العاب'];
handler.command = /^مارد$/i;
handler.limit = true;

export default handler;