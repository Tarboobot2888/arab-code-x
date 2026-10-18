// commands/هات.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateWAMessageFromContent, proto, generateMessageIDV2 } from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(__dirname, '../commands');

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function findClosestMatch(input, options, maxDistance = 3) {
    let closest = null;
    let minDistance = Infinity;
    for (const option of options) {
        const distance = levenshteinDistance(input.toLowerCase(), option.toLowerCase());
        if (distance < minDistance && distance <= maxDistance) {
            minDistance = distance;
            closest = option;
        }
    }
    return closest;
}

export default {
    name: 'هات',
    aliases: ['جلب', 'get', 'هات-امر'],
    category: 'المطور',
    description: 'جلب ملف أمر من مجلد الأوامر بالاسم أو الرقم',

    execute: async (sock, m, args, { cfg }) => {

        const chatJid = m.key.remoteJid;
        const sender = m.key.participant || m.participant || m.key?.remoteJid;
        const comando = 'هات';

        try {
            // ─── التحقق من النخبة والمطور (نفس طريقة أمر خروج) ───
            const isOwner = cfg.ownerNumber === sender;
            const isElite = (cfg.eliteNumbers || []).includes(sender);

            if (!isOwner && !isElite) {
                return sock.sendMessage(chatJid, {
                    text: cfg.msgs.elite(comando)
                }, { quoted: m });
            }

            if (!fs.existsSync(commandsDir)) {
                return sock.sendMessage(chatJid, {
                    text: cfg.msgs.custom?.folderNotFound || '❌ مجلد الأوامر غير موجود.'
                }, { quoted: m });
            }

            const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
            const commandNames = commandFiles.map(f => f.replace('.js', ''));

            if (!commandNames.length) {
                return sock.sendMessage(chatJid, {
                    text: cfg.msgs.custom?.noCommands || '❌ لا يوجد أوامر في المجلد.'
                }, { quoted: m });
            }

            const inputText = args.join(' ').trim();

            // ════════════════〔 📜 القائمة التفاعلية 〕════════════════
            if (!inputText) {

                await sock.sendMessage(chatJid, {
                    react: { text: '📂', key: m.key }
                });

                const chunkSize = 4;
                const sections = [];

                for (let i = 0; i < commandNames.length; i += chunkSize) {
                    const chunk = commandNames.slice(i, i + chunkSize);
                    sections.push({
                        title: `PART ${sections.length + 1}`,
                        rows: chunk.map(name => ({
                            title: name,
                            description: `${cfg.prefix}هات ${name}`,
                            id: `${cfg.prefix}هات ${name}`
                        }))
                    });
                }

                const msg = generateWAMessageFromContent(chatJid, {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                header: { hasMediaAttachment: false },
                                body: {
                                    text: `اختر الأمر لجلب كوده \n\nإجمالي الأوامر: ${commandNames.length}`
                                },
                                footer: { text: 'aboud' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'single_select',
                                            buttonParamsJson: JSON.stringify({
                                                title: '📂 اختر الأمر',
                                                sections
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }, { quoted: m });

                return sock.relayMessage(chatJid, msg.message, {
                    messageId: msg.key.id
                });
            }

            // ════════════════〔 📄 إرسال الكود كامل 〕════════════════
            let selectedCommand = '';

            if (/^\d+$/.test(inputText)) {
                const index = parseInt(inputText) - 1;
                if (index >= 0 && index < commandNames.length) {
                    selectedCommand = commandNames[index];
                } else {
                    return sock.sendMessage(chatJid, {
                        text: cfg.msgs.custom?.invalidNumber || `⚠️ الرقم غير صحيح! بين 1 و ${commandNames.length}`
                    }, { quoted: m });
                }
            } else {
                if (commandNames.includes(inputText)) {
                    selectedCommand = inputText;
                } else {
                    const closestMatch = findClosestMatch(inputText, commandNames);
                    let replyMsg = cfg.msgs.custom?.commandNotFound || `⚠️ الأمر "${inputText}" غير موجود!`;
                    if (closestMatch) replyMsg += `\n🔎 ربما تقصد: ${closestMatch}`;
                    replyMsg += `\n\n📂 أرسل ${cfg.prefix}هات بدون نص لعرض القائمة.`;
                    return sock.sendMessage(chatJid, { text: replyMsg }, { quoted: m });
                }
            }

            const filePath = path.join(commandsDir, `${selectedCommand}.js`);
            const code = fs.readFileSync(filePath, 'utf-8');
            const codeLines = code.split('\n');
            const fileSize = (code.length / 1024).toFixed(2);

            // ─── بناء codeBlocks كاملة بدون slice ───
            const codeBlocks = codeLines.map(line => {
                let highlightType = 1;
                if (line.trim().startsWith('//') || line.trim().startsWith('/*')) highlightType = 2;
                else if (line.trim().startsWith('import')) highlightType = 3;
                else if (line.trim().startsWith('export') || line.trim().startsWith('handler')) highlightType = 4;
                return {
                    highlightType: Math.min(highlightType, 4),
                    codeContent: line + '\n'
                };
            });

            const richMessage = {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [
                        {
                            messageType: 2,
                            messageText: `\n📄 *${selectedCommand}.js*\n📦 الحجم: ${fileSize} KB\n✏️ ${codeLines.length} سطر\n`
                        },
                        {
                            messageType: 5,
                            codeMetadata: {
                                codeLanguage: 'javascript',
                                codeBlocks
                            }
                        }
                    ],
                    contextInfo: {
                        isForwarded: true,
                        forwardingScore: 1,
                        forwardedAiBotMessageInfo: {
                            botJid: '867051314767696@bot'
                        },
                        forwardOrigin: 4
                    }
                }
            };

            const msg = await generateWAMessageFromContent(chatJid, {
                botForwardedMessage: { message: richMessage }
            }, {
                senderId: sock.user.id,
                userJid: sock.user.id,
                messageId: generateMessageIDV2(sock.user.id),
                quoted: m
            });

            await sock.relayMessage(chatJid, msg.message, { messageId: msg.key.id });

        } catch (e) {
            console.error('❌ خطأ في أمر هات:', e);
            await sock.sendMessage(chatJid, {
                text: cfg.msgs.custom?.error || `❌ خطأ: ${e.message || e}`
            }, { quoted: m });
        }
    }
};
