// commands/ستوري.js
import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';

// 🎨 16 لون
const COLORS = [
    0xFFF44336, 0xFFE91E63, 0xFF9C27B0, 0xFF673AB7, 0xFF3F51B5,
    0xFF2196F3, 0xFF03A9F4, 0xFF00BCD4, 0xFF009688, 0xFF4CAF50,
    0xFF8BC34A, 0xFFCDDC39, 0xFFFFEB3B, 0xFFFFC107, 0xFFFF9800, 0xFFFF5722
];

export default {
    name: 'ستوري',
    aliases: ['story', 'منشور'],
    category: 'group',
    description: '📢 إنشاء منشور مخصص مع ألوان وخيارات',

    async execute(sock, m, args, { cfg }) {
        const chatJid = m.key.remoteJid;
        const sender = m.key.participant || m.participant || m.key.remoteJid;
        const comando = 'ستوري';

        // ✅ التحقق من النخبة والمطور
        const isOwner = cfg.ownerNumber === sender;
        const isElite = (cfg.eliteNumbers || []).includes(sender);

        if (!isOwner && !isElite) {
            return sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: m });
        }

        // ✅ التحقق من وجود رد
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let mime = '';
        let isImage = false;
        let isVideo = false;
        let isAudio = false;
        let isVoice = false;

        if (quoted) {
            if (quoted.imageMessage) {
                isImage = true;
                mime = 'image';
            } else if (quoted.videoMessage) {
                isVideo = true;
                mime = 'video';
            } else if (quoted.audioMessage) {
                isAudio = true;
                mime = 'audio';
                if (quoted.audioMessage.ptt) isVoice = true;
            }
        }

        // ✅ القيم الافتراضية (للكل)
        let audienceType = 0; // ✅ 0 = عام (للجميع)
        let listEmoji = '';
        let listName = '';
        let postText = '';
        let colorIndex = -1;
        let remainingText = args.join(' ').trim();

        // ────────── تحليل الأمر ──────────
        if (remainingText) {
            let parts = remainingText.split(' ');

            // ✅ استخراج اللون من البداية (رقم 0-15)
            if (parts.length > 0) {
                let potentialColor = parseInt(parts[0]);
                if (!isNaN(potentialColor) && potentialColor >= 0 && potentialColor <= 15) {
                    colorIndex = potentialColor;
                    remainingText = parts.slice(1).join(' ');
                } else {
                    remainingText = parts.join(' ');
                }
            }

            postText = remainingText;
        }

        // اللون النهائي (عشوائي إذا لم يحدد)
        const finalColor = (colorIndex >= 0 && colorIndex < COLORS.length)
            ? COLORS[colorIndex]
            : COLORS[Math.floor(Math.random() * COLORS.length)];

        // ────────── مساعدة ──────────
        if (!postText && !isImage && !isVideo && !isAudio) {
            return sock.sendMessage(chatJid, {
                text: `📢 *نظام الاستوري المخصص*

🎨 *الألوان (0-15):*
0-أحمر | 1-وردي | 2-بنفسجي | 3-نيلي
4-أزرق | 5-أزرق فاتح | 6-سماوي | 7-فيروزي
8-أخضر | 9-أخضر فاتح | 10-ليموني | 11-ذهبي
12-أصفر | 13-كهرماني | 14-برتقالي | 15-أحمر برتقالي

✏️ *أمثلة:*
• .ستوري 5 مرحبا
• [رد على صورة] .ستوري 3`

            }, { quoted: m });
        }

        try {
            // ────────── حالة وسائط (صورة/فيديو/صوت) ──────────
            if (isImage || isVideo || isAudio) {
                const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                
                let mediaType = isImage ? 'image' : isVideo ? 'video' : 'audio';
                let mediaMessage = isImage ? quoted.imageMessage : isVideo ? quoted.videoMessage : quoted.audioMessage;
                
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                let mediaOptions = { [mediaType]: buffer };
                if (isVoice) {
                    mediaOptions = { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: false };
                }

                let prepared = await prepareWAMessageMedia(mediaOptions, { upload: sock.waUploadToServer });
                let messageKey = isImage ? 'imageMessage' : isVideo ? 'videoMessage' : 'audioMessage';

                const contentMsg = {
                    [messageKey]: {
                        ...prepared[messageKey],
                        caption: postText || '',
                        contextInfo: {
                            isGroupStatus: true,
                            pairedMediaType: 'NOT_PAIRED_MEDIA',
                            statusAudienceMetadata: {
                                audienceType: audienceType,
                                ...(listEmoji && { listEmoji }),
                                ...(listName && { listName })
                            }
                        }
                    }
                };

                const webMsg = proto.Message.fromObject(contentMsg);
                const waMsg = generateWAMessageFromContent(chatJid, webMsg, { userJid: sock.user.id, quoted: m });
                await sock.relayMessage(chatJid, waMsg.message, { messageId: waMsg.key.id });
                await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });
                return;
            }

            // ────────── حالة نصية ──────────
            const groupMetadata = await sock.groupMetadata(chatJid);
            const statusJidList = groupMetadata.participants.map(p => p.id);

            await sock.relayMessage(chatJid, {
                statusJidList,
                messageContextInfo: {
                    messageSecret: Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256)))
                },
                groupStatusMessageV2: {
                    message: {
                        extendedTextMessage: {
                            text: `${postText}`,
                            thumbnailUrl: 'https://file.garden/aauvg01sjleV_ic1/c2a3bfd6e9fd1db2f5358f8feec9261f.jpg',
                            textArgb: 4294967040,
                            backgroundArgb: finalColor,
                            font: 5,
                            previewType: 0,
                            contextInfo: {
                                statusAttributions: [{ type: 10 }],
                                featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
                                statusSourceType: 4,
                                statusAudienceMetadata: {
                                    audienceType: audienceType
                                }
                            },
                            inviteLinkGroupTypeV2: 0
                        }
                    }
                }
            }, {});

            await sock.sendMessage(chatJid, { react: { text: '✅', key: m.key } });

        } catch (error) {
            console.error('❌ ستوري Error:', error);
            await sock.sendMessage(chatJid, { react: { text: '❌', key: m.key } });
            await sock.sendMessage(chatJid, {
                text: `❌ حدث خطأ: ${error.message}`
            }, { quoted: m });
        }
    }
};
