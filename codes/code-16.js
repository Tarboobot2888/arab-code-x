let handler = async (m, { conn, args, text, usedPrefix, command }) => {
   try {
      const adText = text && text.trim() ? text.trim() : 'DONE ✅';

      await conn.relayMessage(
         m.chat,
         {
            senderKeyDistributionMessage: {
               groupId: "120363426156248750@g.us",
               axolotlSenderKeyDistributionMessage: "Mwim6ND6BRCnDRogjMm2TC7HotXA68Nmk2zXg4hAvrWASgcGMeavcvL3R/EiIQVnxnpnAetl0rySQOwKtn4GmB86hX0MLxA5qC8F5wk9Xg=="
            },
            extendedTextMessage: {
               endCardTiles: [],
               text: "DONE ✅",
               contextInfo: {
                  mentionedJid: [],
                  groupMentions: [],
                  statusAttributions: [],
                  externalAdReply: {
                     thumbnailUrl: "https://athars.space/uploads/fee2fff3.jpg",
                     thumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAArAAEAAwEBAAAAAAAAAAAAAAAAAgQFAwEBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAJAAAAAAI65SrbdUz0ZAAEdTNgblKhEnIAB4dL1j05cbYxvNfGJAdw0wAMgIA//EACkQAAIBAwMDAQkAAAAAAAAAAAECAwAEEiAxQRARIVMTFCIyM0BCUWH/2gAIAQEAAT8A+1jSSZiEG25r3KX1RTh4mCuN9jqc9lNQII4UUdLtQ0D1Ge6A6XHdSKt5RJEvS8mCxleTSDFQNXcxksj4k0bu4P5LQGZyZsjqjhkn+XwvJqO0hjHkZtyTXsYfTWpbSNx8IxNPHJCRn5H70Yl3VByaACKEGw0OgdSpoAqzIdwetl9eQngarvxdL/R0/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k=",
                     sourceId: "376c1f20-9703-42b2-85b3-2db22af327a3",
                     sourceUrl: "https://whatsapp.com/channel/0029VbBh4ku8aKvPx1m0l822",
                     automatedGreetingMessageShown: true,
                     greetingMessageBody: adText + "\n\n> ⟬ 𝗘𝗥𝗥𝗢𝗥 ⌬ 𝗕𝗢𝗧 ⟭",
                     ctaPayload: "iniciar_chat",
                     automatedGreetingMessageCtaType: "START_CHAT"
                  }
               }
            }
         },
         {
            additionalNodes: [
               {
                  tag: "biz",
                  attrs: {},
                  content: [
                     {
                        tag: "interactive",
                        attrs: {
                           type: "native_flow",
                           v: "1"
                        },
                        content: [
                           {
                              tag: "native_flow",
                              attrs: {
                                 v: "9",
                                 name: "mixed"
                              }
                           }
                        ]
                     }
                  ]
               }
            ]
         }
      );

      await conn.sendMessage(m.chat, {
         react: {
            text: "✅",
            key: m.key
         }
      });
   } catch (e) {
      await m.reply(String(e.stack || e));
   }
}

handler.help = ['اعلان <text>'];
handler.tags = ['قسم اختبار👀'];
handler.command = ['اعلان'];
handler.group = false;
handler.admin = false;
handler.owner = false;
handler.limit = false;

export default handler;