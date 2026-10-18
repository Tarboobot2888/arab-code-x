// plugins/post.js
// ♡ Raiden Shogun - Plane of Euthymia - نظام البوست 📢
// يدعم: تخصيص الإيموجي والاسم، الجمهور (عام/خاص/قائمة)، 16 لون

import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import { theme } from '../core/theme.js'

// 🎨 16 لون
const COLORS = [
    0xFFF44336, 0xFFE91E63, 0xFF9C27B0, 0xFF673AB7, 0xFF3F51B5,
    0xFF2196F3, 0xFF03A9F4, 0xFF00BCD4, 0xFF009688, 0xFF4CAF50,
    0xFF8BC34A, 0xFFCDDC39, 0xFFFFEB3B, 0xFFFFC107, 0xFFFF9800, 0xFFFF5722
]

let handler = async (m, { conn, text }) => {

    let q = m.quoted
    let mime = q ? ((q.msg || q).mimetype || '') : ''
    let isImage = mime.includes('image')
    let isVideo = mime.includes('video')
    let isAudio = mime.includes('audio')
    let isVoice = mime.includes('audio/ogg') || q?.msg?.audioMessage?.ptt

    // القيم الافتراضية
    let audienceType = 1
    let listEmoji = '🛸'
    let listName = '𝐋𝐎𝐘𝐃'
    let postText = ''
    let colorIndex = -1
    let remainingText = text ? text.trim() : ''

    // ────────── تحليل الأمر ──────────
    if (remainingText) {
        let parts = remainingText.split(' ')
        let firstWord = parts[0]?.toLowerCase()

        // 1. تحديد نوع الجمهور
        if (firstWord === 'عام') {
            audienceType = 0
            listEmoji = ''
            listName = ''
            remainingText = parts.slice(1).join(' ')
        } else if (firstWord === 'خاص' || firstWord === 'اقارب' || firstWord === 'اصدقاء') {
            audienceType = 2
            listEmoji = '⭐'
            listName = 'الأقارب'
            remainingText = parts.slice(1).join(' ')
        } else if (firstWord === 'قائمة' && parts.length >= 3) {
            // تنسيق: قائمة <ايموجي> <اسم> [نص]
            audienceType = 1
            listEmoji = parts[1]
            listName = parts[2]
            remainingText = parts.slice(3).join(' ')
        }

        // 2. استخراج اللون من remainingText (رقم 0-15)
        if (remainingText) {
            let colorParts = remainingText.split(' ')
            let potentialColor = parseInt(colorParts[0])
            if (!isNaN(potentialColor) && potentialColor >= 0 && potentialColor <= 15) {
                colorIndex = potentialColor
                remainingText = colorParts.slice(1).join(' ')
            }
        }

        postText = remainingText
    }

    // اللون النهائي (عشوائي إذا لم يحدد)
    const finalColor = (colorIndex >= 0 && colorIndex < COLORS.length)
        ? COLORS[colorIndex]
        : COLORS[Math.floor(Math.random() * COLORS.length)]

    // ────────── مساعدة ──────────
    if (!postText && !isImage && !isVideo && !isAudio && !isVoice) {
        return m.reply(theme.build([
            { type: 'title', text: '🎨 بـوسـت مُخصص' },
            { type: 'divider' },
            { type: 'line', text: '👥 *أنواع الجمهور:*' },
            { type: 'info', label: 'عام', value: 'للجميع (بدون أيقونة)' },
            { type: 'info', label: 'خاص ⭐', value: 'للأقارب (أيقونة ثابتة)' },
            { type: 'info', label: 'قائمة', value: 'تخصيص <ايموجي> <اسم>' },
            { type: 'divider' },
            { type: 'line', text: '🎨 *الألوان (0-15):*' },
            { type: 'info', label: '0', value: 'أحمر' },
            { type: 'info', label: '1', value: 'وردي' },
            { type: 'info', label: '2', value: 'بنفسجي' },
            { type: 'info', label: '3', value: 'نيلي غامق' },
            { type: 'info', label: '...', value: 'حتى 15 (برتقالي)' },
            { type: 'divider' },
            { type: 'line', text: '✏️ *أمثلة:*' },
            { type: 'info', label: 'عام + لون', value: '.بوست عام 5 مرحبا' },
            { type: 'info', label: 'قائمة مخصصة', value: '.بوست قائمة 💎 جواهر 12' },
            { type: 'info', label: 'وسائط', value: 'رد على صورة/فيديو + الأمر' }
        ]))
    }

    try {
        // ⭐ حالة وسائط (صورة/فيديو/صوت)
        if (isImage || isVideo || isAudio || isVoice) {
            let media = await q.download()
            let mediaType = isImage ? 'image' : isVideo ? 'video' : 'audio'
            let mediaOptions = { [mediaType]: media }
            if (isVoice) mediaOptions = { audio: media, mimetype: 'audio/ogg; codecs=opus', ptt: false }

            let prepared = await prepareWAMessageMedia(mediaOptions, { upload: conn.waUploadToServer })
            let messageKey = isImage ? 'imageMessage' : isVideo ? 'videoMessage' : 'audioMessage'

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
            }

            const webMsg = proto.Message.fromObject(contentMsg)
            const waMsg = generateWAMessageFromContent(m.chat, webMsg, { userJid: conn.user.jid, quoted: m })
            await conn.relayMessage(m.chat, waMsg.message, { messageId: waMsg.key.id })
            await m.react('✅')
            return
        }

        // ⭐ حالة نصية (group status)
        const groupMetadata = await conn.groupMetadata(m.chat)
        const statusJidList = groupMetadata.participants.map(p => p.id)

        await conn.relayMessage(m.chat, {
            statusJidList,
            messageContextInfo: {
                messageSecret: Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256)))
            },
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: `${global.watermark}\n\n${postText}`,
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
                                audienceType: audienceType,
                                ...(listEmoji && { listEmoji }),
                                ...(listName && { listName })
                            }
                        },
                        inviteLinkGroupTypeV2: 0
                    }
                }
            }
        }, {})

        await m.react('✅')
    } catch (e) {
        console.error('❌ بوست:', e)
        await m.react('❌')
        m.reply('حصل خطأ: ' + e.message)
    }
}

handler.help = ['بوست']
handler.tags = ['group']
handler.command = /^(بوست|post)$/i
handler.group = true
handler.admin = false 

export default handler