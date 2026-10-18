// commands/عبود.js
// 🤖 رسالة غنية - عبود بوت مع فقاعات اقتراح

export default {
    name: 'عبود',
    aliases: ['aboud', 'abo'],
    category: 'tools',
    description: '📤 رسالة ترحيبية غنية من عبود بوت',

    async execute(sock, m, args, { cfg }) {
        const chatJid = m.key.remoteJid;
        const sender = m.key.participant || m.participant || m.key.remoteJid;
        const comando = 'عبود';

        // ✅ التحقق من النخبة والمطور
        const isOwner = cfg.ownerNumber === sender;
        const isElite = (cfg.eliteNumbers || []).includes(sender);

        if (!isOwner && !isElite) {
            return sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: m });
        }

        try {
            const content = {
                messageContextInfo: {
                    messageSecret: Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256))).toString('base64')
                },
                botForwardedMessage: {
                    message: {
                        richResponseMessage: {
                            messageType: 1,
                            unifiedResponse: {
                                data: Buffer.from(JSON.stringify({
                                    "response_id": `abo_${Date.now()}`,
                                    "sections": [
                                        {
                                            "view_model": {
                                                "primitive": {
                                                    "__typename": "FOATextPrimitive",
                                                    "text": "# بـــوت عــبــود "
                                                },
                                                "__typename": "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        {
                                            "view_model": {
                                                "primitive": {
                                                    "text": "وظننتني شخصاً يُستهان به.. لا والذي جعل الكرامة في دمي أنا لا أُذل ولا أُهان ولا أنحني، أنا كالشمس أعميك ولا أنعمي.",
                                                    "__typename": "GenAIMarkdownTextUXPrimitive"
                                                },
                                                "__typename": "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        // ✅ الصورة
                                        {
                                            "view_model": {
                                                "primitive": {
                                                    "__typename": "GenAIImagePrimitive",
                                                    "preview_image": {
                                                        "__typename": "GenAIMediaItem",
                                                        "mime_type": "image/jpeg",
                                                        "url": "https://n.uguu.se/GxiuHLrK.jpg"
                                                    },
                                                    "full_image": {
                                                        "__typename": "GenAIMediaItem",
                                                        "mime_type": "image/jpeg",
                                                        "url": "https://n.uguu.se/GxiuHLrK.jpg"
                                                    }
                                                },
                                                "__typename": "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        // ✅ الفيديو
                                        {
                                            "view_model": {
                                                "primitive": {
                                                    "__typename": "GenAIImaginePrimitive",
                                                    "media": {
                                                        "__typename": "GenAIMediaItem",
                                                        "mime_type": "video/mp4",
                                                        "url": "https://h.uguu.se/GngZHioF.mp4",
                                                        "file_length": 0,
                                                        "duration": 0
                                                    },
                                                    "imagine_type": "ANIMATE",
                                                    "status": { "status": "READY" },
                                                    "thumbnail": { "raw_media": "" }
                                                },
                                                "__typename": "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        // ✅ فقاعات اقتراح (مثل أمر صور)
                                        {
                                            "view_model": {
                                                "primitives": [
                                                    {
                                                        "prompt_text": "📋 القائمة",
                                                        "prompt_type": "SUGGESTED_PROMPT",
                                                        "__typename": "GenAIFollowUpSuggestionPillPrimitive"
                                                    },
                                                    {
                                                        "prompt_text": "📊 الحالة",
                                                        "prompt_type": "SUGGESTED_PROMPT",
                                                        "__typename": "GenAIFollowUpSuggestionPillPrimitive"
                                                    },
                                                    {
                                                        "prompt_text": "🖼️ صور",
                                                        "prompt_type": "SUGGESTED_PROMPT",
                                                        "__typename": "GenAIFollowUpSuggestionPillPrimitive"
                                                    }
                                                ],
                                                "__typename": "GenAIHScrollLayoutViewModel"
                                            }
                                        },
                                        // ✅ جدول الأزرار الستة (بدون toast)
                                        {
                                            "view_model": {
                                                "primitives": [
                                                    {
                                                        "__typename": "GenAI3PExtWidgetPrimitive",
                                                        "header": {
                                                            "__typename": "GenAI3PExtWidgetStandardHeader",
                                                            "title": "AD-L"
                                                        },
                                                        "body": {
                                                            "__typename": "GenAI3PExtCalendarEventList",
                                                            "sections": [],
                                                            "ctas": [
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "hello",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "00"
                                                                },
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "story",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "01"
                                                                },
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "kode",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "02"
                                                                }
                                                            ]
                                                        }
                                                    },
                                                    {
                                                        "__typename": "GenAI3PExtWidgetPrimitive",
                                                        "header": {
                                                            "__typename": "GenAI3PExtWidgetStandardHeader",
                                                            "title": "AD-R"
                                                        },
                                                        "body": {
                                                            "__typename": "GenAI3PExtCalendarEventList",
                                                            "sections": [],
                                                            "ctas": [
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "ABOUD",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "10"
                                                                },
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "WR5",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "11"
                                                                },
                                                                {
                                                                    "__typename": "GenAI3PExtWidgetCTA",
                                                                    "label": "BOT",
                                                                    "state": "PENDING",
                                                                    "kind": "OTHER",
                                                                    "tool_call_id": "12"
                                                                }
                                                            ]
                                                        }
                                                    }
                                                ],
                                                "__typename": "GenAIHScrollLayoutViewModel"
                                            }
                                        },
                                        // ✅ الأزرار (Footer Actions)
                                        {
                                            "view_model": {
                                                "primitives": [
                                                    {
                                                        "__typename": "GenAIFooterActionPrimitive",
                                                        "cta_text": "👥 Group",
                                                        "cta_type": "OPEN_URL",
                                                        "cta_url": "https://chat.whatsapp.com/BwECElXBVFMDwBrMe3n4WA?s=cl&p=a&ilr=1"
                                                    },
                                                    {
                                                        "__typename": "GenAIFooterActionPrimitive",
                                                        "cta_text": "📢 Channel",
                                                        "cta_type": "OPEN_URL",
                                                        "cta_url": "https://whatsapp.com/channel/0029VbCqgIdHbFVCbKjlzU1b"
                                                    },
                                                    {
                                                        "__typename": "GenAIFooterActionPrimitive",
                                                        "cta_text": "👤 Owner",
                                                        "cta_type": "OPEN_URL",
                                                        "cta_url": "https://wa.me/966573945450"
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
            };

            await sock.relayMessage(chatJid, content, {});
            await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });

        } catch (error) {
            console.error('❌ عبود Error:', error);
            await sock.sendMessage(chatJid, {
                text: `❌ حدث خطأ: ${error.message}`
            }, { quoted: m });
        }
    }
};
