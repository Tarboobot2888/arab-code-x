let handler = async (m, { conn, usedPrefix, command }) => {
  try {
    let chat = global.db.data.chats[m.chat]

    if (!chat || !chat.primaryBot) {
      return conn.reply(
        m.chat,
`*╮──────────────────⟢ـ*
*⧉┆⚠️ لا يـوجـد بـوت أسـاسـي مـعـيـن هـنـا*
*╯──────────────────⟢ـ*`,
        m
      )
    }

    // إزالة التعيين
    chat.primaryBot = null

    await conn.sendMessage(
      m.chat,
      {
        text:
`*╮──────────────────⟢ـ*
*⧉┆✅ تـم إزالـة الـبـوت الأسـاسـي*
*⧉┆↜ الان سـتـقـوم جـمـيـع الـبـوتـات بالـرد*
*╯──────────────────⟢ـ*`
      },
      { quoted: m }
    )
  } catch (e) {
    console.error(e)
    m.reply( ❌ حدث خطأ أثناء تنفيذ الأمر. )
  }
}

handler.help = [ حذف_اساسي ]
handler.tags = [ jadibot ]
handler.command = /^(حذف_اساسي|إلغاء_اساسي|الغاء_اساسي)$/i
handler.group = true
handler.admin = true

export default handler
