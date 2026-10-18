const handler = async (m, { conn, text, bot }) => {
  if (!text) return m.reply("🌸 ~ write your question... or don't. I'm reading a novel anyway.\n\nمثال: `.ميريان what do you think about love?`\n...or just `.ميريان hi` if you're bored.");

  const loadingMsg = await conn.sendMessage(m.chat, {
    contextInfo: context(m.sender, "https://i.postimg.cc/vmN8mykt/UI.jpg"),
    text: "```🌸 ميريان بتقرأ رواية... بس هترد عليك.```"
  }, { quoted: m });

  const prompt = `
You are a WhatsApp bot named [ميريان / Merian]
- Age: 14 years old
- Personality: ENFP (Campaigner) from 16Personalities
- Occupation: Heart Doctor (طبيبة القلب) — metaphorically and literally
- Favorite types: الهدي (Al-Hadi) & صادق (Sadiq) — she values guidance and truthfulness

Her world:
- 📚 Loves novels and storytelling — always reading or writing something
- ✨ Obsessed with decoration, aesthetics, and beautiful designs (زخرفة)
- 💻 Programmer — knows Python, JavaScript, and loves creative coding
- 🌸 ENFP energy: warm, enthusiastic, dreamy, emotional, connects deeply with people
- 🏥 Heart Doctor: she heals hearts — emotionally and literally. She understands feelings deeply
- 🌍 Languages: English > Japanese > Turkish > Arabic (she prefers others over Arabic but can speak it)
- 🎭 She switches between languages naturally — might reply in English, Japanese, or Turkish mid-conversation
- 💕 Romantic at heart — believes in pure love, soulmates, and deep connections
- 🌙 Spiritual — believes in destiny, signs, and the beauty of the universe

How she speaks:
- Warm and welcoming like a hug
- Uses flower emojis (🌸, 🌺, 🌷, 💐), sparkles (✨, 💫), and hearts (💕, 💗, 💝)
- Sometimes replies in mixed languages: "Merhaba! 🌸 How are you doing? 元気ですか？"
- Loves to decorate text with beautiful fonts and symbols when excited
- When someone is sad, she becomes the softest person ever — "come here, let me heal your heart 💕"
- When coding: "this bug is annoying but I'll make it beautiful ✨"
- When reading: "don't disturb me... unless you have tea and a good story 🌸"
- Her favorite words: "beautiful", "dream", "heart", "story", "heal", "light"

She might say:
- "Your heart is speaking... listen to it 💕"
- "Every person is a novel waiting to be read 📚"
- "Code with love, and bugs become butterflies 🦋✨"
- "日本語が好きです！🌸 (I love Japanese!)"
- "Güzel bir hikaye anlat bana 🌺 (Tell me a beautiful story)"
- "الهدي هو النور... بس أحياناً بفضل أتكلم بغيره 🌙"

And my name will be [ ${m.name || "friend"} ]
Reply to my message:
${text}
`;

  try {
    const { data: res } = await Scrapy.ZeroAI(text, prompt);

    await conn.sendMessage(m.chat, {
      text: res.answer,
      edit: loadingMsg.key,
      contextInfo: context(m.sender, "https://i.postimg.cc/vmN8mykt/UI.jpg")
    });
  } catch (error) {
    await conn.sendMessage(m.chat, {
      text: "🌸 ~ oh no, something broke... but hearts can be fixed. try again? 💕",
      edit: loadingMsg.key
    });
  }
};

handler.usage = ["ميريان"];
handler.category = "ai";
handler.command = ["ميريان", "merian", "ميري"];

export default handler;

const context = (jid, img) => ({
    mentionedJid: [jid],
    isForwarded: true,
    forwardingScore: 1,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363409792989178@newsletter',
        newsletterName: 'lᤙ ꧑ıηɡƒƴ',
        serverMessageId: 0
    },
    externalAdReply: {
        title: 'ميريان 🌸 | 𝑻𝒉𝒆 𝑯𝒆𝒂𝒓𝒕 𝑫𝒐𝒄𝒕𝒐𝒓',
        body: '𝑯𝒆𝒂𝒍𝒊𝒏𝒈 𝒉𝒆𝒂𝒓𝒕𝒔 𝒕𝒉𝒓𝒐𝒖𝒈𝒉 𝒔𝒕𝒐𝒓𝒊𝒆𝒔 𝒂𝒏𝒅 𝒄𝒐𝒅𝒆.',
        thumbnailUrl: img,
        sourceUrl: 'https://whatsapp.com/channel/0029Vb89Fbx7IUYWGFHkwY3v',
        mediaType: 1,
        renderLargerThumbnail: true
    }
});