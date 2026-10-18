=> conn.relayMessage(
  m.chat,
  {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [
            {
              messageType: 2,
              messageText: "- table: 📊 جدول المقارنة"
            },
            {
              messageType: 4,
              tableMetadata: {
                title: "📊 جدول المقارنة",
                subtitle: "تفاصيل التقنيات والأداء",
                rows: [
                  {
                    isHeading: true,
                    items: ["المحرك", "Node.js", "Bun"]
                  },
                  {
                    isHeading: false,
                    items: ["البيئة", "V8 (C++)", "JavaScriptCore"]
                  },
                  {
                    isHeading: false,
                    items: ["الأداء", "عالي", "سريع جداً"]
                  }
                ]
              }
            }
          ],
          contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            forwardOrigin: 4,
            forwardedAiBotMessageInfo: {
              botJid: "867051314767696@bot"
            }
          }
        }
      }
    }
  },
  { messageId: conn.generateMessageTag() }
)
