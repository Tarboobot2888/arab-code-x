/*
░▒▓█ 𝑵𝒆𝒙𝒂𝒓𝒐 𝑩𝒐𝒕 🦋 █▓▒░
✧ Dev: Axious
✧ Phone: +201284042708
✧ Command: ملصق2 – جلب ملصقات تيليجرام (ثابتة ومتحركة)
*/

import axios from 'axios'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
import path from 'path'
import sharp from 'sharp'

const TELEGRAM_TOKEN = '8658798286:AAGW1009yl0yvH4DEWyUVgTPLINMhWFFnHA'
const TMP_DIR = path.join(process.cwd(), 'tmp')
if (!existsSync(TMP_DIR)) {
  import('fs').then(fs => fs.mkdirSync(TMP_DIR, { recursive: true }))
}

// تحويل إلى webp ثابت
async function toStaticWebp(buffer) {
  return sharp(buffer)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toBuffer()
}

// تحويل animated إلى animated webp
function toAnimatedWebp(buffer, id) {
  const inputPath = path.join(TMP_DIR, `anim_${id}.webm`)
  const outputPath = path.join(TMP_DIR, `anim_${id}.webp`)
  try {
    writeFileSync(inputPath, buffer)
    execSync(`ffmpeg -y -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15" -loop 0 -q:v 80 -preset default -an "${outputPath}"`, { stdio: 'pipe' })
    const result = readFileSync(outputPath)
    return result
  } catch {
    return null
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath) } catch {}
    try { if (existsSync(outputPath)) unlinkSync(outputPath) } catch {}
  }
}

const handler = async (m, { conn, args, usedPrefix, command }) => {
  const allowed = [...global.owner.map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net'), '201284042708@s.whatsapp.net']
  if (!allowed.includes(m.sender)) {
    return conn.sendMessage(m.chat, { text: '🦋 ❌ هذا الأمر للمطور فقط.' }, { quoted: m })
  }

  if (!args[0]) {
    return m.reply(`🦋 *يرجى إدخال رابط حزمة تيليجرام.*\n*مثال:* ${usedPrefix + command} https://t.me/addstickers/xxxxx`)
  }

  const url = args[0].trim()
  const packMatch = url.match(/addstickers\/(.+)/)
  if (!packMatch) return m.reply('🦋 ❌ رابط غير صالح.')

  const tgPackName = packMatch[1]
  await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } })

  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getStickerSet?name=${tgPackName}`)
    if (!data.ok || !data.result?.stickers) return m.reply('🦋 ❌ حزمة غير موجودة.')

    const stickers = data.result.stickers
    if (stickers.length === 0) return m.reply('🦋 ❌ لا توجد ملصقات.')

    await m.reply(`🦋 *تم العثور على ${stickers.length} ملصق.* جاري الإرسال...`)

    for (let i = 0; i < stickers.length; i++) {
      const s = stickers[i]
      try {
        const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${s.file_id}`)
        if (!fileRes.data.ok) continue
        const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileRes.data.result.file_path}`
        const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' })
        let buffer = Buffer.from(imgRes.data)

        let stickerBuffer = null
        let isAnimated = false

        if (s.is_animated) {
          stickerBuffer = toAnimatedWebp(buffer, i)
          if (stickerBuffer) isAnimated = true
        } else {
          stickerBuffer = await toStaticWebp(buffer)
        }

        if (!stickerBuffer) continue

        await conn.sendMessage(m.chat, {
          sticker: stickerBuffer,
          packname: '𝑵𝒆𝒙𝒂𝒓𝒐 𝑩𝒐𝒕 🦋',
          author: '𝑨𝒙𝒊𝒐𝒖𝒔',
          isAnimated
        }, { quoted: m })

        await new Promise(resolve => setTimeout(resolve, 300))
      } catch (e) {
        console.error(`فشل الملصق ${i}:`, e.message)
      }
    }

    await conn.sendMessage(m.chat, { text: '🦋 ✅ تم إرسال جميع الملصقات.' }, { quoted: m })
    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
  } catch (e) {
    console.error(e)
    m.reply(`🦋 ❌ خطأ: ${e.message}`)
  }
}

handler.command = ['ملصق2']
handler.tags = ['owner']
handler.help = ['ملصق2 <رابط>']

export default handler