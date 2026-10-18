let handler = async (m, { conn, args, usedPrefix, command }) => {
  const nickname = args.join(' ').trim()

  if (!nickname) {
    return m.reply(
      `◠⿻ *لوبي فري فاير مزيف* 🎀⃝⃕𝆺𝅥𝆹𝅥\n\n> اكتب الاسم اللي عايز تعمل بيه الصورة\n\n\`مثال: ${usedPrefix}${command} Nexa\``
    )
  }

  await conn.sendMessage(m.chat, { react: { text: '🎮', key: m.key } })

  try {
    await conn.sendMessage(
      m.chat,
      {
        image: { url: `https://apii.nexadev.my.id/fakeff?usn=${encodeURIComponent(nickname)}` },
        caption: `◠⿻ *لوبي فري فاير مزيف* 🎀⃝⃕𝆺𝅥𝆹𝅥\n\n> الاسم: \`${nickname}\`\n\n◠⿻ Elizabeth Bot 🎀⃝⃕𝆺𝅥𝆹𝅥`
      },
      { quoted: m }
    )

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
  } catch (error) {
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    m.reply(`◠⿻ *خطأ* 🎀⃝⃕𝆺𝅥𝆹𝅥\n\n> ${error.message}`)
  }
}

handler.help = ['fakeff <الاسم>']
handler.tags = ['canvas']
handler.command = /^(fakeff|fakelobyff|lobyff|fakelobby)$/i

export default handler