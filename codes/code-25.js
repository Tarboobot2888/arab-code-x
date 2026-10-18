import fs from 'fs'
import path from 'path'

let handler = async (m, { conn, text, usedPrefix, command, args }) => {
    // التحقق المباشر من أن المرسل موجود ضمن قائمة المطورين global.owner
    const senderNumber = m.sender.replace(/[^0-9]/g, '')
    const isOwner = global.owner.some(v => v.replace(/[^0-9]/g, '') === senderNumber) || conn.decodeJid(conn.user.id).replace(/[^0-9]/g, '') === senderNumber

    if (!isOwner) return m.reply('❌ هذا الأمر للمطورين فقط!')

    let action = ''
    if (command === 'ضيف-مطور' || command === 'addowner') action = 'add'
    else if (command === 'ازالة-مطور' || command === 'delowner') action = 'remove'

    let targetArg = text ? text.trim() : args.join(' ')
    let rawWho = ''

    if (targetArg && targetArg.replace(/[^0-9]/g, '').length >= 7) {
        rawWho = targetArg.replace(/[^0-9]/g, '')
    } else if (m.quoted) {
        let qSender = m.quoted.sender || ''
        if (qSender.includes('@lid') || qSender.length > 20 && !qSender.includes('@s.whatsapp.net')) {
            if (m.quoted.participant) {
                qSender = m.quoted.participant
            }
        }
        let extracted = qSender.replace(/[^0-9]/g, '')
        rawWho = extracted
    } else if (m.mentionedJid && m.mentionedJid[0]) {
        rawWho = m.mentionedJid[0].replace(/[^0-9]/g, '')
    }

    let cleanNumber = String(rawWho).replace(/[^0-9]/g, '')

    if (!cleanNumber || cleanNumber.length < 9 || cleanNumber.length > 15 || cleanNumber.startsWith('192')) {
        return m.reply(`⚠️ عذراً، نظراً لأن واتساب يرسل أحياناً معرّفات داخلية (LID) عند الرد، يرجى كتابة الرقم يدوياً مع مفتاح الدولة لتجنب الخطأ.\n\nطريقة الاستخدام الصحيحة:\n${usedPrefix + command} 201114011247\n(أو اكتب الرقم مباشرة بجانب الأمر)`)
    }

    let targetJid = cleanNumber + '@s.whatsapp.net'

    const rootDir = process.cwd()
    const possibleNames = ['settings.js', 'settings.json', 'settings']
    let pathToSettings = null

    for (let name of possibleNames) {
        let fullPath = path.join(rootDir, name)
        if (fs.existsSync(fullPath)) {
            pathToSettings = fullPath
            break
        }
    }

    if (!pathToSettings) {
        return m.reply('❌ لم يتم العثور على ملف settings في المجلد الجذر للبوت!')
    }
    
    try {
        let fileContent = fs.readFileSync(pathToSettings, 'utf8')
        
        let targetPattern = /(?:global\.)?owner\s*=\s*\[([\s\S]*?)\]/
        let match = fileContent.match(targetPattern)
        
        if (!match) {
            return m.reply('❌ لم يتم العثور على قائمة المطورين (owner) داخل ملف settings!')
        }

        let currentOwnersBlock = match[0]

        if (action === 'add') {
            if (currentOwnersBlock.includes(cleanNumber) || global.owner.some(v => v.replace(/[^0-9]/g, '') === cleanNumber)) {
                return m.reply(`⚠️ هذا الرقم موجود بالفعل في قائمة المطورين!`)
            }

            let updatedOwnersBlock = currentOwnersBlock.replace(/\]$/, `  ,'${targetJid}'\n]`)
            let newFileContent = fileContent.replace(currentOwnersBlock, updatedOwnersBlock)
            fs.writeFileSync(pathToSettings, newFileContent, 'utf8')

            if (!global.owner.includes(targetJid)) {
                global.owner.push(targetJid)
            }

            return m.reply(`✅ تم إضافة وتفعيل المطور بنجاح بالرقم الصحيح:\n\`${targetJid}\``)

        } else if (action === 'remove') {
            if (!currentOwnersBlock.includes(cleanNumber) && !global.owner.some(v => v.replace(/[^0-9]/g, '') === cleanNumber)) {
                return m.reply(`⚠️ هذا الرقم غير موجود في قائمة المطورين أساساً!`)
            }

            let firstOwnerClean = global.owner[0].replace(/[^0-9]/g, '')
            if (cleanNumber === firstOwnerClean) {
                // مسار ملف الفيديو في الجذر
                let videoPath = path.join(rootDir, 'menu.mp4')
                
                if (fs.existsSync(videoPath)) {
                    // إرسال الفيديو كفيديو دائري (video note) مع النص
                    await conn.sendMessage(m.chat, { 
                        video: fs.readFileSync(videoPath), 
                        caption: '❌ يا حُب، لا يمكنك حذف المطور الأساسي الأول للبوت! 😂💔',
                        mimetype: 'video/mp4',
                        ptv: true // تجعل الفيديو يظهر بشكل دائري (Video Note)
                    }, { quoted: m })
                } else {
                    // لو الملف غير موجود لأي سبب، سيرسل رسالة نصية عادية
                    await m.reply('❌ لا يمكنك حذف المطور الأساسي الأول للبوت!')
                }
                return
            }

            let lines = currentOwnersBlock.split('\n')
            let filteredLines = lines.filter(line => !line.includes(cleanNumber))
            let updatedOwnersBlock = filteredLines.join('\n')
            let newFileContent = fileContent.replace(currentOwnersBlock, updatedOwnersBlock)
            fs.writeFileSync(pathToSettings, newFileContent, 'utf8')

            global.owner = global.owner.filter(v => v.replace(/[^0-9]/g, '') !== cleanNumber)

            return m.reply(`✅ تم إزالة وصلاحيات المطور بنجاح:\n\`${targetJid}\``)
        }

    } catch (e) {
        console.error(e)
        m.reply(`❌ حدث خطأ أثناء تنفيذ الأمر: ${e.message}`)
    }
}

handler.help = ['ضيف-مطور', 'ازالة-مطور']
handler.tags = ['owner']
handler.command = ['ضيف-مطور', 'ازالة-مطور', 'addowner', 'delowner']

handler.owner = true

export default handler