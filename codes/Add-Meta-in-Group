//~ ⧼ 𝑷𝑹𝑶𝑻𝑶𝑻𝒀𝑷𝑬 ⧽
let handler = async (m, { conn, text }) => {
  try {
    const groupJid = m.chat;

    if (!groupJid.endsWith("@g.us")) {
      return m.reply("جروب فقط.");
    }

    const res = await conn.groupParticipantsUpdate(
      groupJid,
      ["867051314767696@bot"],
      "add",
    );

    m.reply(
      "تم اضافه اغبى ذكاء اصطناعي في العالم ✅"
    );
  } catch (e) {
    console.error(e);
    m.reply(String(e?.stack || e));
  }
};

handler.command = /^(addai)$/i;
export default handler;