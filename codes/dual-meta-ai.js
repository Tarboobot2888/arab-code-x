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
              messageText: "إليك الكود:\n\n- code: JavaScript"
            },
            {
              messageType: 5,
              codeMetadata: {
                codeLanguage: "javascript",
                codeBlocks: [
                  {
                    highlightType: 1,
                    codeContent: "console.log('Hello World from Meta UI!');"
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
