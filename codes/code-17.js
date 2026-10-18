let handler = async (m, { conn, args, text, usedPrefix, command }) => {
  try {
    await conn.sendMessage(m.chat, { react: { text: '🔄', key: m.key } })

    await conn.relayMessage(
      m.chat,
      {
        interactiveMessage: {
          header: {
            title: "PIXE-LBOT",
            imageMessage: {
              interactiveAnnotations: [],
              scanLengths: [
                2591,
                6768,
                1727,
                2197
              ],
              annotations: [],
              url: "https://mmg.whatsapp.net/v/t62.7118-24/770838057_1005019948963047_9040330934791864826_n.enc?ccb=11-4&oh=01_Q5Aa5QFeDRO2aMY_rM_TqHHs3WssueTC9zbQFhg5r4irni_vzw&oe=6AA15C2B&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              caption: text && text.trim() ? text.trim() : "تست",
              fileSha256: "v/nTpjGTbo76BqRBu2HMPwl/2oIlHi7nkq488OTMjP4=",
              fileLength: "13283",
              height: 736,
              width: 736,
              mediaKey: "8rFMjnKm0yLQNs9MjZPZwF5knkjytFVeFbX7I7z6EFA=",
              fileEncSha256: "x5Poxjmueh0f3OPP3ARzAts7ftxOKjEO/9jQpyl4JdU=",
              directPath: "/v/t62.7118-24/770838057_1005019948963047_9040330934791864826_n.enc?ccb=11-4&oh=01_Q5Aa5QFeDRO2aMY_rM_TqHHs3WssueTC9zbQFhg5r4irni_vzw&oe=6AA15C2B&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1786377495",
              jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAArAAEAAwEBAAAAAAAAAAAAAAAAAgQFAwEBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAJAAAAAAI65SrbdUz0ZAAEdTNgblKhEnIAB4dL1kcuNsY3mvjEgO4aYAGQEAf//EACkQAAIBAwMDAQkAAAAAAAAAAAECAwAEEiAxQRARIVMTFCIyM0BCUWH/2gAIAQEAAT8A+1jSSZiEG25r3KX1RTh4mCuN9jqc9lNQII4UUdLtQ0D1Ge6A6XHdSKt5RLEvS8mCxleTSDFQNXcxksj4k0bu4P5LQGZyZsjqjhkn+XwvJqO0hjHkZNyTXsYfTWpbSNx8IxNPHJCRn5H70Yl3VByaACKEGw0OgdSpoAqzIdwetl9eQngarvxdL/R0/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k="
            }
          },
          hasMediaAttachment: true
        },
        body: {
          text: text && text.trim() ? text.trim() : "تست"
        },
        footer: {
          text: "Powered by pixel"
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: "order_status",
              buttonParamsJson: "{\"reference_id\":\"PIXE-LBOT\",\"order\":{\"subtotal\":{\"value\":100000,\"offset\":100},\"tax\":{\"value\":10000,\"offset\":100},\"currency\":\"IDR\"}}"
            }
          ],
          messageParamsJson: ""
        },
        contextInfo: {
          mentionedJid: [],
          groupMentions: [],
          statusAttributions: [],
          forwardingScore: 999,
          isForwarded: true,
          pairedMediaType: 0,
          forwardOrigin: 0
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
    )

    await conn.sendMessage(m.chat, {
      react: {
        text: "✅",
        key: m.key
      }
    })
  } catch (e) {
    await m.reply(`❌ خطأ: ${String(e.message || e)}`)
  }
}

handler.help = ['طلبية <text>']
handler.tags = ['tools']
handler.command = ['طلبية']
handler.group = false
handler.admin = false
handler.owner = false
handler.limit = false

export default handler