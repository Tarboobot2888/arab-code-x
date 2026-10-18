import axios from 'axios'
import FormData from 'form-data'
import {
    generateWAMessageFromContent,
    prepareWAMessageMedia
} from '@whiskeysockets/baileys'
import { theme } from '../core/theme.js'

const pendingImages = new Map()

async function enhanceImage(buffer, filename = 'fix-image.jpg', scale = 2) {
    const landing = await fetch(
        'https://www.iloveimg.com/id/tingkatkan-gambar',
        {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }
    )

    const html = await landing.text()

    const token = html.match(/"token":"([^"]+)"/)?.[1]
    const taskId = html.match(
        /ilovepdfConfig\.taskId\s*=\s*'([^']+)'/
    )?.[1]

    if (!token || !taskId) {
        throw new Error('تعذر إنشاء جلسة تحسين الصورة')
    }

    const upload = new FormData()

    upload.append('name', filename)
    upload.append('chunk', '0')
    upload.append('chunks', '1')
    upload.append('task', taskId)
    upload.append('preview', '1')
    upload.append('pdfinfo', '0')
    upload.append('pdfforms', '0')
    upload.append('pdfresetforms', '0')
    upload.append('v', 'web.0')

    upload.append('file', buffer, {
        filename,
        contentType: 'image/jpeg'
    })

    const uploaded = await axios.post(
        'https://api1g.iloveimg.com/v1/upload',
        upload,
        {
            headers: {
                ...upload.getHeaders(),
                Authorization: `Bearer ${token}`,
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }
    )

    const serverFile = uploaded.data?.server_filename

    if (!serverFile) {
        throw new Error('تعذر رفع الصورة إلى خدمة التحسين')
    }

    const process = new FormData()

    process.append('packaged_filename', 'fix-enhanced-image')
    process.append('multiplier', String(scale))
    process.append('task', taskId)
    process.append('tool', 'upscaleimage')
    process.append(
        'files[0][server_filename]',
        serverFile
    )
    process.append(
        'files[0][filename]',
        filename
    )

    const processed = await axios.post(
        'https://api1g.iloveimg.com/v1/process',
        process,
        {
            headers: {
                ...process.getHeaders(),
                Authorization: `Bearer ${token}`,
                Origin: 'https://www.iloveimg.com',
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }
    )

    if (processed.data?.status !== 'TaskSuccess') {
        throw new Error('فشلت عملية تحسين الصورة')
    }

    const download = await axios.get(
        `https://api1g.iloveimg.com/v1/download/${taskId}`,
        {
            responseType: 'arraybuffer',
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }
    )

    return Buffer.from(download.data)
}

function savePendingImage(userId, buffer) {
    pendingImages.set(userId, {
        buffer,
        expiresAt: Date.now() + 5 * 60 * 1000
    })

    setTimeout(() => {
        const item = pendingImages.get(userId)

        if (item && item.expiresAt <= Date.now()) {
            pendingImages.delete(userId)
        }
    }, 5 * 60 * 1000)
}

function getPendingImage(userId) {
    const item = pendingImages.get(userId)

    if (!item) return null

    if (item.expiresAt <= Date.now()) {
        pendingImages.delete(userId)
        return null
    }

    return item.buffer
}

const handler = async (m, { usedPrefix, command, conn, text }) => {
    try {
        /*
         * طلب التحسين العالي
         */
        if (text?.trim().toLowerCase() === 'pro') {
            const original = getPendingImage(m.sender)

            if (!original) {
                return m.reply(
                    '⌛ *انتهت جلسة الصورة*\n\nأرسل صورة جديدة ثم استخدم الأمر مرة أخرى.'
                )
            }

            await conn.sendMessage(m.chat, {
                react: {
                    text: '⏳',
                    key: m.key
                }
            })

            await m.reply(
                '✨ *Fix Enhance*\nجاري رفع جودة الصورة إلى 4x...'
            )

            const enhanced = await enhanceImage(
                original,
                `fix_${Date.now()}.jpg`,
                4
            )

            pendingImages.delete(m.sender)

            await conn.sendMessage(
                m.chat,
                {
                    image: enhanced,
                    caption:
                        `✨ *تم تحسين الصورة بنجاح*\n` +
                        `📐 الدقة: *4x*\n` +
                        `⚡ ${global.watermark || 'Fix'}`
                },
                { quoted: m }
            )

            return conn.sendMessage(m.chat, {
                react: {
                    text: '✅',
                    key: m.key
                }
            })
        }

        /*
         * تحديد الصورة
         */
        const source = m.quoted || m
        const mime = (source.msg || source).mimetype || ''

        if (!/^image\//i.test(mime)) {
            return conn.sendMessage(
                m.chat,
                {
                    text: theme.build([
                        {
                            type: 'title',
                            text: '🖼️ تـحـسـيـن الـصـور'
                        },
                        {
                            type: 'divider'
                        },
                        {
                            type: 'line',
                            text: 'قم بالرد على صورة لاستخدام أداة التحسين.'
                        },
                        {
                            type: 'info',
                            label: '📌 الأمر',
                            value: `${usedPrefix}رفع`
                        },
                        {
                            type: 'info',
                            label: '🚀 الوضع',
                            value: '2x + 4x Pro'
                        }
                    ])
                },
                { quoted: m }
            )
        }

        await conn.sendMessage(m.chat, {
            react: {
                text: '⏳',
                key: m.key
            }
        })

        await m.reply(
            '🔧 *Fix Image Enhancer*\nجاري تحسين الصورة إلى 2x...'
        )

        const original = await source.download()

        const enhanced = await enhanceImage(
            original,
            `fix_${Date.now()}.jpg`,
            2
        )

        savePendingImage(m.sender, original)

        const media = await prepareWAMessageMedia(
            {
                image: enhanced
            },
            {
                upload: conn.waUploadToServer
            }
        )

        const interactiveMessage = {
            body: {
                text:
                    '✨ *تم تحسين الصورة إلى 2x*\n\n' +
                    'هل تريد رفع الجودة أكثر إلى 4x؟'
            },

            footer: {
                text: global.watermark || 'Fix • Image Enhancer'
            },

            header: {
                hasMediaAttachment: true,
                imageMessage: media.imageMessage
            },

            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🚀 تحسين 4x Pro',
                            id: `${usedPrefix}${command} pro`
                        })
                    }
                ],

                messageParamsJson: '{}'
            }
        }

        const message = generateWAMessageFromContent(
            m.chat,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage
                    }
                }
            },
            {
                userJid: conn.user.jid,
                quoted: m
            }
        )

        await conn.relayMessage(
            m.chat,
            message.message,
            {
                messageId: `FIX_IMG_${Date.now()}`,

                additionalNodes: [
                    {
                        tag: 'biz',
                        attrs: {},
                        content: [
                            {
                                tag: 'interactive',
                                attrs: {
                                    type: 'native_flow',
                                    v: '1'
                                },
                                content: [
                                    {
                                        tag: 'native_flow',
                                        attrs: {
                                            v: '9',
                                            name: 'mixed'
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
                text: '✅',
                key: m.key
            }
        })
    } catch (error) {
        console.error('[FIX IMAGE]', error)

        await conn.sendMessage(m.chat, {
            react: {
                text: '❌',
                key: m.key
            }
        })

        await m.reply(
            theme.build([
                {
                    type: 'title',
                    text: '❌ تـعـذر تـحـسـيـن الـصـورة'
                },
                {
                    type: 'error',
                    text:
                        error?.message ||
                        'حدث خطأ أثناء معالجة الصورة.'
                }
            ])
        )
    }
}

handler.help = ['رفع', 'fixhd']
handler.tags = ['tools']
handler.command = /^(رفع|fixhd)$/i

export default handler