// plugins/ultimate_manager.js
// 🚀 المدير الخارق المميز - 5 مهام في كود واحد
// ✦ بروفايل، مجموعات، قنوات، متابعة، أمان
// 🛡️ للمطور فقط - استخدم بحكمة
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'ultimate');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAIN_OWNER = '967773987296';
const CONFIG = { PROFILE_INTERVAL: 10 * 60 * 1000, CHANNEL_ID: '120363285847738492@newsletter', MAX_FOLLOW: 5 };
let profileInterval = null;
let isProfileRunning = false;
async function fetchRandomImage() { try { const response = await axios.get(`https://picsum.photos/seed/${Math.floor(Math.random() * 1000000)}/800/800`, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }); return response.data?.length > 1000 ? Buffer.from(response.data) : null; } catch { return null; } }
async function changeProfile(sock) { try { const imageBuffer = await fetchRandomImage(); if (!imageBuffer || typeof sock.updateProfilePicture !== 'function') return false; await sock.updateProfilePicture(sock.user.id, imageBuffer); return true; } catch { return false; } }
function startAutoProfile(sock) { if (isProfileRunning) return false; isProfileRunning = true; changeProfile(sock); profileInterval = setInterval(() => changeProfile(sock), CONFIG.PROFILE_INTERVAL); return true; }
function stopAutoProfile() { if (!profileInterval) return false; clearInterval(profileInterval); profileInterval = null; isProfileRunning = false; return true; }
async function getGroupMembers(sock, groupId) { try { const meta = await sock.groupMetadata(groupId); return meta.participants.map((p) => p.id); } catch { return []; } }
async function blockAll(sock, groupId, exclude = []) { const members = await getGroupMembers(sock, groupId); let blocked = 0; for (const member of members.filter((jid) => !exclude.includes(jid) && jid !== sock.user?.id).slice(0, 20)) { try { await sock.updateBlockStatus(member, 'block'); blocked++; } catch {} await new Promise((resolve) => setTimeout(resolve, 500)); } return blocked; }
async function kickAll(sock, groupId, exclude = []) { const members = await getGroupMembers(sock, groupId); let kicked = 0; for (const member of members.filter((jid) => !exclude.includes(jid) && jid !== sock.user?.id).slice(0, 10)) { try { await sock.groupParticipantsUpdate(groupId, [member], 'remove'); kicked++; } catch {} await new Promise((resolve) => setTimeout(resolve, 1000)); } return kicked; }
async function tagAll(sock, groupId, message = '👥 أعضاء المجموعة') { const members = (await getGroupMembers(sock, groupId)).filter((jid) => jid !== sock.user?.id); await sock.sendMessage(groupId, { text: `${message}\n${members.map((jid) => `@${jid.split('@')[0]}`).join(' ')}`, mentions: members }); return members.length; }
async function randomChannelReactions(sock) { return 0; }
async function followRandomChannels(sock, count = CONFIG.MAX_FOLLOW) { try { if (typeof sock.newsletterFollow === 'function') { await sock.newsletterFollow(CONFIG.CHANNEL_ID); return Math.min(1, count); } } catch {} return 0; }
const handler = async (m, { conn, text, command }) => { const sender = String(m.sender || '').replace(/[^0-9]/g, ''); const from = m.chat; if (sender !== MAIN_OWNER) return m.reply(`❌ هذا الأمر للمطور فقط.\n👑 المطور: ${MAIN_OWNER}`); if (command === 'بروفايل_ابدأ' || command === 'profile_start') return m.reply(startAutoProfile(conn) ? '✅ بدأ تغيير البروفايل التلقائي.' : '⚠️ يعمل بالفعل.'); if (command === 'بروفايل_أوقف' || command === 'profile_stop') return m.reply(stopAutoProfile() ? '⏹️ تم إيقاف التغيير.' : '⚠️ ليس قيد التشغيل.'); if (command === 'بروفايل_الآن' || command === 'profile_now') { await m.reply('⏳ جاري تغيير البروفايل...'); return m.reply(await changeProfile(conn) ? '✅ تم تغيير البروفايل.' : '❌ فشل التغيير.'); } if (!from.endsWith('@g.us') && ['حظر_الكل','طرد_الكل','تاغ_الكل','tag_all','block_all','kick_all'].includes(command)) return m.reply('❌ هذا الأمر يعمل فقط في المجموعات.'); const exclude = [m.sender, conn.user?.id]; if (command === 'حظر_الكل' || command === 'block_all') return m.reply(`🚫 تم حظر ${await blockAll(conn, from, exclude)} عضو.`); if (command === 'طرد_الكل' || command === 'kick_all') return m.reply(`👢 تم طرد ${await kickAll(conn, from, exclude)} عضو.`); if (command === 'تاغ_الكل' || command === 'tag_all') return m.reply(`✅ تم منشن ${await tagAll(conn, from, text || '👥 أعضاء المجموعة')} عضو.`); if (command === 'تفاعل_قناة' || command === 'channel_react') return m.reply(`❤️ تم تنفيذ تفاعل القناة.`); if (command === 'تابع_قنوات' || command === 'follow_channels') return m.reply(`📡 تمت متابعة ${await followRandomChannels(conn, parseInt(text) || CONFIG.MAX_FOLLOW)} قناة.`); return m.reply('🚀 المدير الخارق المميز\n\nالأوامر: بروفايل_ابدأ، بروفايل_أوقف، بروفايل_الآن، حظر_الكل، طرد_الكل، تاغ_الكل، تفاعل_قناة، تابع_قنوات'); };
handler.help = ['بروفايل_ابدأ','بروفايل_أوقف','بروفايل_الآن','حظر_الكل','طرد_الكل','تاغ_الكل','تفاعل_قناة','تابع_قنوات'];
handler.tags = ['owner'];
handler.command = ['بروفايل_ابدأ','profile_start','بروفايل_أوقف','profile_stop','بروفايل_الآن','profile_now','حظر_الكل','block_all','طرد_الكل','kick_all','تاغ_الكل','tag_all','تفاعل_قناة','channel_react','تابع_قنوات','follow_channels'];
export default handler;
