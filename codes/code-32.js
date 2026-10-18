import ws from  ws 

let handler = async (m, { conn, usedPrefix, command, args }) => {
  try {
    if (!args[0] && !m.quoted && (!m.mentionedJid || m.mentionedJid.length === 0)) {
      return m.reply(
`*╮──────────────────⟢ـ*
*⧉┆⚠️ يـرجـى مـنـشـنـة رقـم الـبـوت*
*⧉┆↜ أو الـرد عـلـى رسـالـتـه*
*⧉┆↜ مـثـال ⬳*
*⧉┆↜ ${usedPrefix}${command} @0*
*╯──────────────────⟢ـ*`
      )
    }

    // استخراج الجروب/المحادثة
    if (!global.db.data) global.db.data = { chats: {} }
    if (!global.db.data.chats[m.chat]) global.db.data.chats[m.chat] = {}
    let chat = global.db.data.chats[m.chat]

    // تحديد JID البوت المستهدف من المنشن أو الرد أو النص
    let targetJid =   
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetJid = m.mentionedJid[0]
    } else if (m.quoted) {
      targetJid = m.quoted.sender
    } else {
      let cleanNum = args[0].replace(/[^0-9]/g,   )
      targetJid = cleanNum ? `${cleanNum}@s.whatsapp.net` :   
    }

    if (!targetJid) {
      return m.reply( ❌ لم يتم التعرف على رقم البوت. )
    }

    // استخراج الرقم المجرد (Digits Only) للتأكد من المطابقة بغض النظر عن النطاق @s.whatsapp.net أو @lid
    let targetNum = targetJid.split( @ )[0].replace(/:.*/,   )

    // تجميع كافة البوتات النشطة (البوت الرئيسي + البوتات الفرعية)
    const allBots = [global.conn, ...(global.conns || [])].filter(
      (c) => c && c.user && (c.ws?.socket ? c.ws.socket.readyState !== ws.CLOSED : true)
    )

    // البحث عن البوت المطلوب داخل قائمة البوتات المتصلة
    let selectedBot = allBots.find((c) => {
      let botJid = c.user?.jid ||   
      let botLid = c.user?.lid ||   
      let botNum1 = botJid.split( @ )[0].replace(/:.*/,   )
      let botNum2 = botLid.split( @ )[0].replace(/:.*/,   )

      return (
        botJid === targetJid ||
        botLid === targetJid ||
        botNum1 === targetNum ||
        botNum2 === targetNum
      )
    })

    if (!selectedBot) {
      return conn.reply(
        m.chat,
`*╮──────────────────⟢ـ*
*⧉┆⚠️ هـذا الـبـوت لـيـس مـن نـفـس الـجـلـسـة*
*⧉┆↜ تـأكـد مـن الـبـوتـات الـمـتـصـلـة*
*⧉┆↜ اسـتـخـدم ⬳*
*⧉┆↜ ${usedPrefix}البوتات*
*╯──────────────────⟢ـ*`,
        m
      )
    }

    // الحصول على المعرف الرسمي المعين للبوت المختار
    let officialBotJid = selectedBot.user.jid

    if (chat.primaryBot === officialBotJid) {
      return conn.reply(
        m.chat,
`*╮──────────────────⟢ـ*
*⧉┆⚠️ هـذا الـبـوت هـو الـرئـيـسـي بـالـفـعـل*
*╯──────────────────⟢ـ*`,
        m
      )
    }

    // تحديث البوت الأساسي بالمعرف الجديد
    chat.primaryBot = officialBotJid

    await conn.sendMessage(
      m.chat,
      {
        text:
`*╮──────────────────⟢ـ*
*⧉┆✅ تـم تـعـيـيـن الـبـوت كـبـوت رئـيـسـي*
*⧉┆↜ الـبـوتـات الأخـرى لـن تـرد هـنـا*
*╯──────────────────⟢ـ*`
      },
      { quoted: m }
    )
  } catch (e) {
    console.error( Error in primaryBot handler: , e)
    m.reply( ❌ حدث خطأ أثناء تنفيذ الأمر. )
  }
}

handler.help = [ تعيين_اساسي <@منشن> ]
handler.tags = [ jadibot ]
handler.command = /^(تعيين_اساسي|بوت_اساسي)$/i
handler.group = true
handler.admin = true

export default handler