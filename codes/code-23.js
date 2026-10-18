// commands/تيك.js
import axios from 'axios';

export default {
    name: 'تيكتوك',
    aliases: ['tiktok', 'tt', 'تيك'],
    category: 'media',
    description: '🎬 عرض فيديو TikTok بشكل غني مع معلومات',

    async execute(sock, m, args, { cfg }) {
        const chatJid = m.key.remoteJid;
        const sender = m.key.participant || m.participant || m.key.remoteJid;
        const comando = 'تيكتوك';

        // ✅ التحقق من النخبة والمطور
        const isOwner = cfg.ownerNumber === sender;
        const isElite = (cfg.eliteNumbers || []).includes(sender);

        if (!isOwner && !isElite) {
            return sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: m });
        }

        const url = args[0];
        if (!url) {
            return sock.sendMessage(chatJid, {
                text: `🎬 *عرض فيديو TikTok*\n\n📌 *الاستخدام:*\n.تيكتوك <رابط>\n\n📝 *مثال:*\n.تيكتوك https://vt.tiktok.com/xxxxxxx/`
            }, { quoted: m });
        }

        // ✅ تحقق من أن الرابط من TikTok
        if (!url.includes('tiktok.com') && !url.includes('vt.tiktok')) {
            return sock.sendMessage(chatJid, {
                text: '❌ الرابط ليس من TikTok!'
            }, { quoted: m });
        }

        await sock.sendMessage(chatJid, { react: { text: '⏳', key: m.key } });

        try {
            // ✅ جلب بيانات الفيديو من TikTok (استخدام API خارجي)
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl);
            const data = response.data.data;

            if (!data || !data.play) {
                throw new Error('فشل جلب بيانات الفيديو');
            }

            // ✅ استخراج المعلومات
            const videoUrl = data.play;
            const videoHdUrl = data.hdplay || data.play;
            const coverUrl = data.cover || '';
            const title = data.title || 'فيديو TikTok';
            const author = data.author?.unique_id || 'Unknown';
            const authorName = data.author?.nickname || 'Unknown';
            const likes = data.digg_count || 0;
            const comments = data.comment_count || 0;
            const shares = data.share_count || 0;
            const views = data.play_count || 0;
            const duration = data.duration || 0;
            const region = data.region || 'US';

            // ✅ تنسيق المدة
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            // ✅ إرسال الرسالة الغنية
            const content = {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2,
                    botMetadata: {
                        messageDisclaimerText: "",
                        richResponseSourcesMetadata: {}
                    }
                },
                botForwardedMessage: {
                    message: {
                        richResponseMessage: {
                            messageType: 1,
                            submessages: [
                                {
                                    messageType: 2,
                                    messageText: `[ CANNOT_LOAD_PRODUCT - TIKTOK ]`
                                },
                                {
                                    messageType: 2,
                                    messageText: `> المنطقة : ${region}\n> المدة : ${durationStr}\n> المشاهدات : ${formatNumber(views)}\n> التعليقات : ${formatNumber(comments)}\n>  المشاركات : ${formatNumber(shares)}\n> اللايكات : ${formatNumber(likes)}\n> الناشر: ${authorName} (@${author})`
                                },
                                {
                                    messageType: 2,
                                    messageText: `[ CANNOT_LOAD_VIDEO - TIKTOK ]`
                                },
                                {
                                    messageType: 2,
                                    messageText: `${title}`
                                }
                            ],
                            unifiedResponse: {
                                data: Buffer.from(JSON.stringify({
                                    response_id: `tiktok_${Date.now()}`,
                                    sections: [
                                        {
                                            view_model: {
                                                primitive: {
                                                    title: authorName,
                                                    brand: "TIKTOK",
                                                    product_url: `https://tiktok.com/@${author}`,
                                                    image: {
                                                        url: coverUrl || "https://via.placeholder.com/300x300?text=TikTok"
                                                    },
                                                    additional_images: [{}],
                                                    __typename: "GenAIProductItemCardPrimitive"
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        {
                                            view_model: {
                                                primitive: {
                                                    text: `> المنطقة : ${region}\n> المدة : ${durationStr}\n> المشاهدات : ${formatNumber(views)}\n> التعليقات : ${formatNumber(comments)}\n> المشاركات : ${formatNumber(shares)}\n> اللايكات : ${formatNumber(likes)}\n> الناشر : ${authorName} (@${author})`,
                                                    __typename: "GenAIMetadataTextPrimitive"
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        {
                                            view_model: {
                                                primitive: {
                                                    media: {
                                                        url: videoUrl,
                                                        mime_type: "video/mp4",
                                                        file_length: 0,
                                                        duration: duration
                                                    },
                                                    imagine_type: "ANIMATE",
                                                    status: { status: "READY" },
                                                    thumbnail: { raw_media: "" },
                                                    __typename: "GenAIImaginePrimitive"
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        {
                                            view_model: {
                                                primitive: {
                                                    text: `ⓘ ${title}`,
                                                    __typename: "GenAIMetadataTextPrimitive"
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        },
                                        {
                                            view_model: {
                                                primitives: [
                                                    { prompt_text: "#tiktok", prompt_type: "SUGGESTED_PROMPT", __typename: "GenAIFollowUpSuggestionPillPrimitive" },
                                                    { prompt_text: "#viral", prompt_type: "SUGGESTED_PROMPT", __typename: "GenAIFollowUpSuggestionPillPrimitive" },
                                                    { prompt_text: `#${author}`, prompt_type: "SUGGESTED_PROMPT", __typename: "GenAIFollowUpSuggestionPillPrimitive" },
                                                    { prompt_text: "#fyp", prompt_type: "SUGGESTED_PROMPT", __typename: "GenAIFollowUpSuggestionPillPrimitive" }
                                                ],
                                                __typename: "GenAIHScrollLayoutViewModel"
                                            }
                                        }
                                    ]
                                })).toString('base64')
                            },
                            contextInfo: {
                                stanzaId: m.key.id,
                                participant: m.key.participant || m.key.remoteJid,
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedAiBotMessageInfo: { botJid: "0@bot" },
                                forwardOrigin: 4
                            }
                        }
                    }
                }
            };

            await sock.relayMessage(chatJid, content, {});
            await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });

        } catch (error) {
            console.error('❌ TikTok Error:', error);
            await sock.sendMessage(chatJid, {
                text: `❌ فشل جلب الفيديو: ${error.message}`
            }, { quoted: m });
        }
    }
};

// ✅ دالة مساعدة لتنسيق الأرقام
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}
