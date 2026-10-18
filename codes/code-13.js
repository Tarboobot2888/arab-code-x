// commands/ج.js
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getNumber = (jid) => {
    if (!jid) return '';
    return jid.split('@')[0].replace(/[^0-9]/g, '');
};

export default {
    name: 'ج',
    aliases: ['تنفيذ', 'run'],
    description: '📂 تنفيذ أوامر في مجموعات أخرى',
    category: 'tools',

    async execute(sock, msg, args, { cfg, cmds }) {
        const chatJid = msg.key.remoteJid;
        const sender = msg.key.participant || msg.participant || chatJid;
        const senderNumber = getNumber(sender);
        const comando = 'ج'; // اسم الأمر للرسائل

        // ✅ التحقق من النخبة باستخدام cfg.msgs.elite
        const eliteList = [
            cfg.ownerNumber?.replace(/[^0-9]/g, ''),
            ...(cfg.eliteNumbers || []).map(n => n.replace(/[^0-9]/g, ''))
        ].filter(Boolean);

        if (!eliteList.includes(senderNumber)) {
            // ✅ استخدام الرسالة من config
            return sock.sendMessage(chatJid, {
                text: cfg.msgs.elite(comando)
            }, { quoted: msg });
        }

        const indexOrCommand = args[0];
        const commandText = args.slice(1).join(' ');

        // ✅ جلب كل القروبات
        const allChats = await sock.groupFetchAllParticipating();
        const groups = Object.values(allChats);

        // ✅ عرض القروبات
        if (!indexOrCommand || indexOrCommand === 'عرض') {
            const list = groups.map((g, i) => `*${i + 1}.* ${g.subject}`).join('\n');
            return sock.sendMessage(chatJid, {
                text: `╭━━━ 📋 *المجموعات* ╮\n\n${list}\n\n╰━━━━━━━━━━╯\n\n⚙️ *.ج [رقم] [أمر]*\nمثال: *.ج 3 .اوامر*\n\n⚡ *.ج 0 [أمر]* = كل القروبات`,
                contextInfo: {
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363409350797874@newsletter",
                        serverMessageId: '',
                        newsletterName: '𝙰𝙱𝙾𝚄𝙳 ꒰🔆⃝꒱ 𝐁𝐎𝐓'
                    }
                }
            });
        }

        const index = parseInt(indexOrCommand);
        if (isNaN(index) || !commandText) {
            return sock.sendMessage(chatJid, {
                text: '⚠️ الاستخدام: *.ج [رقم] [أمر]*\nمثال: *.ج 2 .منشن*\n⚡ *.ج 0 [أمر] = كل القروبات'
            });
        }

        // ✅ استخراج الأمر
        const cmdName = commandText.trim().split(/\s+/)[0].replace(/^\./, '').toLowerCase();
        const cmdArgs = commandText.trim().split(/\s+/).slice(1);

        const cmd = cmds.get(cmdName);
        if (!cmd) {
            return sock.sendMessage(chatJid, {
                text: `🚫 الأمر غير موجود: ${cmdName}`
            });
        }

        // ✅ تنفيذ في كل القروبات
        if (index === 0) {
            await sock.sendMessage(chatJid, {
                text: `🔄 *جاري تنفيذ "${commandText}" في ${groups.length} مجموعة...*\n⏳ انتظر...`
            });

            let success = 0;
            let failed = 0;

            for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                try {
                    const fakeMsg = {
                        key: {
                            remoteJid: group.id,
                            participant: sender,
                            fromMe: false,
                            id: msg.key.id + i
                        },
                        message: {
                            extendedTextMessage: {
                                text: commandText,
                                contextInfo: {
                                    participant: sender,
                                    mentionedJid: [sender]
                                }
                            }
                        },
                        participant: sender
                    };

                    await cmd.execute(sock, fakeMsg, cmdArgs, { cmds, cfg });
                    success++;
                    console.log(`✅ ${group.subject}`);
                } catch (err) {
                    failed++;
                    console.log(`❌ ${group.subject}: ${err.message}`);
                }
                await sleep(2000);
            }

            return sock.sendMessage(chatJid, {
                text: `✅ *تم التنفيذ في كل القروبات*\n\n📊 *ناجح:* ${success}\n❌ *فشل:* ${failed}\n📦 *المجموع:* ${groups.length}`,
                contextInfo: {
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363409350797874@newsletter",
                        serverMessageId: '',
                        newsletterName: '𝙰𝙱𝙾𝚄𝙳 ꒰🔆⃝꒱ 𝐁𝐎𝐓'
                    }
                }
            });
        }

        // ✅ تنفيذ في مجموعة واحدة
        const group = groups[index - 1];
        if (!group) {
            return sock.sendMessage(chatJid, {
                text: `❌ لا يوجد مجموعة بالرقم: ${index}`
            });
        }

        const fakeMsg = {
            key: {
                remoteJid: group.id,
                participant: sender,
                fromMe: false,
                id: msg.key.id
            },
            message: {
                extendedTextMessage: {
                    text: commandText,
                    contextInfo: {
                        participant: sender,
                        mentionedJid: [sender]
                    }
                }
            },
            participant: sender
        };

        try {
            const start = Date.now();
            await cmd.execute(sock, fakeMsg, cmdArgs, { cmds, cfg });
            const duration = ((Date.now() - start) / 1000).toFixed(1);

            await sock.sendMessage(chatJid, {
                text: `✅ تم التنفيذ في *${group.subject}*\n🕒 ${duration} ثانية`,
                contextInfo: {
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363409350797874@newsletter",
                        serverMessageId: '',
                        newsletterName: '𝙰𝙱𝙾𝚄𝙳 ꒰🔆⃝꒱ 𝐁𝐎𝐓'
                    }
                }
            });
        } catch (err) {
            console.error('خطأ:', err);
            await sock.sendMessage(chatJid, {
                text: '⚠️ حدث خطأ أثناء تنفيذ الأمر.'
            });
        }
    }
};
