> client.relayMessage(
  m.chat,
  {
    messageContextInfo: {
      messageSecret: "v/3VN8Gfr2dbKzgt1GKDEU7ovyYW+nswh4Duwq6KDuU="
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({
              "response_id": "742a451a-0c33-45ca-a205-42c2b1666bca",
              "sections": [
                {
                  "view_model": {
                    "primitive": {
                      "__typename": "FOATextPrimitive",
                      "text": "# let me know~"
                    },
                    "__typename": "GenAISingleLayoutViewModel"
                  }
                },
                {
                  "view_model": {
                    "primitive": {
                      "text": "im here~",
                      "__typename": "GenAIMarkdownTextUXPrimitive"
                    },
                    "__typename": "GenAISingleLayoutViewModel"
                  }
                },
                {
                  "view_model": {
                    "primitive": {
                      "__typename": "GenAIImagePrimitive",
                      "preview_image": {
                        "__typename": "GenAIMediaItem",
                        "mime_type": "image/jpeg",
                        "url": "https://files.catbox.moe/1itw6e.jpg"
                      },
                      "full_image": {
                        "__typename": "GenAIMediaItem",
                        "mime_type": "image/jpeg",
                        "url": "https://files.catbox.moe/1itw6e.jpg"
                      }
                    },
                    "__typename": "GenAISingleLayoutViewModel"
                  }
                },
                {
                  "view_model": {
                    "primitives": [
                      {
                        "__typename": "GenAI3PExtWidgetPrimitive",
                        "header": {
                          "__typename": "GenAI3PExtWidgetStandardHeader",
                          "title": "LIST-X"
                        },
                        "body": {
                          "__typename": "GenAI3PExtCalendarEventList",
                          "sections": [],
                          "ctas": [
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "menu",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "00",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            },
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "profile",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "01",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            },
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "script",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "02",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            }
                          ]
                        }
                      },
                      {
                        "__typename": "GenAI3PExtWidgetPrimitive",
                        "header": {
                          "__typename": "GenAI3PExtWidgetStandardHeader",
                          "title": "PX-T"
                        },
                        "body": {
                          "__typename": "GenAI3PExtCalendarEventList",
                          "sections": [],
                          "ctas": [
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "𝗣𝗜𝗫𝗘𝗟",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "10",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            },
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "PIXEL",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "11",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            },
                            {
                              "__typename": "GenAI3PExtWidgetCTA",
                              "label": "FIORA",
                              "state": "PENDING",
                              "kind": "OTHER",
                              "tool_call_id": "12",
                              "toast": {
                                "__typename": "GenAI3PExtWidgetToast",
                                "label": "PIX"
                              }
                            }
                          ]
                        }
                      }
                    ],
                    "__typename": "GenAIHScrollLayoutViewModel"
                  }
                },
                {
                  "view_model": {
                    "primitives": [
                      {
                        "__typename": "GenAIFooterActionPrimitive",
                        "cta_text": "WhatsApp Group",
                        "cta_type": "OPEN_URL",
                        "cta_url": "https://chat.whatsapp.com/J7OzqKB7Bl2AGIcNEYsdch?s=cl&p=a&ilr=0"
                      },
                      {
                        "__typename": "GenAIFooterActionPrimitive",
                        "cta_text": "WhatsApp Channel",
                        "cta_type": "OPEN_URL",
                        "cta_url": "https://whatsapp.com/channel/0029VbCV1ck8fewpdNb2TY2k"
                      }
                    ],
                    "__typename": "GenAIHScrollLayoutViewModel"
                  }
                }
              ]
            })).toString('base64')
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardOrigin: 4
          }
        }
      }
    }
  },
  {}
)