import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 🌑 تخزين مؤقت للروابط والبحث (مع تنظيف تلقائي)
const tempStorage = new Map();
const userSessions = new Map();

// تنظيف الذاكرة كل 30 دقيقة
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of userSessions) {
        if (now - val.time > 30 * 60 * 1000) {
            userSessions.delete(key);
            // clean associated tempStorage
            for (const [k] of tempStorage) {
                if (k.includes(key)) tempStorage.delete(k);
            }
        }
    }
}, 10 * 60 * 1000);

// 🌐 اكتشاف اللغة
function detectLanguage(input) {
    const arabicRegex = /[\u0600-\u06FF]/;
    if (!input) return 'ar';
    if (arabicRegex.test(input)) return 'ar';
    return 'en';
}

// 🔍 كشف المنصة
function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube ▶️';
    if (url.includes('tiktok.com')) return 'TikTok 🎵';
    if (url.includes('instagram.com')) return 'Instagram 📸';
    if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook 📘';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'Twitter/X 🐦';
    return 'موقع الويب 🌐';
}

// 🎬 البحث بطريقة 1: yt-dlp
async function searchWithYtdlp(query) {
    try {
        const args = ['--dump-json', '--playlist-end', '10', '--no-warnings', `ytsearch10:${query}`];
        const result = await ytDlpExec(args);
        return result.map(item => ({
            title: item.title,
            url: item.webpage_url || item.url || item.original_url,
            thumbnail: item.thumbnail,
            duration: item.duration ? formatSeconds(item.duration) : '0:00',
            views: item.view_count || 0,
            channel: item.uploader || item.channel || 'Unknown',
            source: 'ytdlp'
        }));
    } catch (e) {
        console.log("ytdlp failed:", e.message);
        return [];
    }
}

// 🎬 البحث بطريقة 2: Web Scraping (YouTube HTML)
async function searchWithScraping(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 10000
        });

        const $ = cheerio.load(data);
        const results = [];

        const scriptTag = $('script').filter((i, el) => {
            return $(el).html()?.includes('var ytInitialData');
        }).first();

        if (scriptTag.length) {
            const html = scriptTag.html();
            const match = html.match(/var ytInitialData = (.+?);<\/script>/);
            if (!match) return [];
            const jsonData = JSON.parse(match[1]);
            const videos = jsonData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents || [];

            videos.forEach((item, idx) => {
                if (idx >= 10) return;
                const video = item.videoRenderer;
                if (video) {
                    results.push({
                        title: video.title?.runs?.[0]?.text || 'Unknown',
                        url: `https://youtube.com/watch?v=${video.videoId}`,
                        thumbnail: video.thumbnail?.thumbnails?.pop()?.url || '',
                        duration: video.lengthText?.simpleText || '0:00',
                        views: video.viewCountText?.simpleText || '0',
                        channel: video.ownerText?.runs?.[0]?.text || 'Unknown',
                        source: 'scraping'
                    });
                }
            });
        }
        return results;
    } catch (e) {
        console.log("scraping failed:", e.message);
        return [];
    }
}

// 🎬 البحث بطريقة 3: Invidious API
async function searchWithInvidious(query) {
    const instances = [
        'https://vid.puffyan.us',
        'https://inv.riverside.rocks',
        'https://yt.artemislena.eu',
        'https://iv.nboeck.de',
        'https://iv.datura.network'
    ];

    const results = [];

    for (const instance of instances) {
        try {
            const { data } = await axios.get(`${instance}/api/v1/search`, {
                params: { q: query },
                timeout: 8000
            });

            data.slice(0, 10).forEach(video => {
                results.push({
                    title: video.title,
                    url: `https://youtube.com/watch?v=${video.videoId}`,
                    thumbnail: video.videoThumbnails?.[0]?.url || '',
                    duration: formatSeconds(video.lengthSeconds),
                    views: video.viewCount || 0,
                    channel: video.author || 'Unknown',
                    source: 'invidious'
                });
            });

            if (results.length > 0) break;
        } catch (e) { continue; }
    }
    return results;
}

// 🎬 أمر البحث الرئيسي
async function searchCommand(m, { conn, bot, text }) {
    try {
        if (!text) return m.reply("*🌑 ~ اكتب اسم البحث يا ظل ~ 💀*");

        const loadingMsg = await m.reply("👁️ ~ جاري البحث في ظلال يوتيوب بـ 3 طرق...");

        let results = [];

        if (results.length === 0) results = await searchWithYtdlp(text);
        if (results.length === 0) results = await searchWithScraping(text);
        if (results.length === 0) results = await searchWithInvidious(text);

        if (results.length === 0) {
            await conn.sendMessage(m.chat, { delete: loadingMsg.key }).catch(() => {});
            return m.reply("*💀 ~ فشل البحث في جميع الطرق ~*\n*جرب لاحقاً أو غيّر كلمة البحث*");
        }

        await conn.sendMessage(m.chat, { delete: loadingMsg.key }).catch(() => {});

        const sessionId = `${m.chat}_${m.sender}`;
        userSessions.set(sessionId, {
            results: results,
            query: text,
            time: Date.now()
        });

        const cards = results.slice(0, 10).map((item, index) => {
            const linkId = `dl_${sessionId}_${index}`;
            tempStorage.set(linkId, item.url);

            return {
                imageUrl: item.thumbnail || 'https://i.postimg.cc/4yHqxvRQ/IMG-20260530-WA0072.jpg',
                bodyText: `*${item.title || 'Unknown'}*\n\n⏱️ ${item.duration || 'N/A'} • 👁️ ${formatViews(item.views)} • 👤 ${item.channel || 'Unknown'}`,
                footerText: `${detectPlatform(item.url)} • #${index + 1}`,
                buttons: [
                    {
                        name: 'cta_url',
                        params: { display_text: '▶️╎ مـشـاهـدة', url: item.url }
                    },
                    {
                        name: 'cta_copy',
                        params: { display_text: '📋╎ نـسـخ', copy_code: item.url }
                    },
                    {
                        name: 'quick_reply',
                        params: {
                            display_text: '⬇️╎ تـنـزيـل',
                            id: `.يوتيوب ${item.url}`
                        }
                    }
                ]
            };
        });

        return await conn.sendCarousel(m.chat, {
            headerText: `🌑 نتائج بحث ظل الظلام → *[ ${text} ]*`,
            globalFooterText: `◇ 𝑩𝒐𝒕 𝑺𝒉𝒂𝒅𝒐𝒘 ◇`,
            cards: cards,
            mentions: [m.sender],
            newsletter: {
                name: '◇ 𝑺𝒉𝒂𝒅𝒐𝒘 𝑮𝒂𝒕𝒆 ◇',
                jid: '120363409792989178@newsletter'
            }
        });

    } catch (error) {
        console.error(error);
        m.react("💀");
        return m.reply("*💀 ~ خلل في طاقة الظل ~*");
    }
}

// 🛠️ دوال مساعدة
function ytDlpExec(args) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let errorOut = '';

        ytdlp.stdout.on('data', (data) => { output += data.toString(); });
        ytdlp.stderr.on('data', (data) => { errorOut += data.toString(); });

        ytdlp.on('close', (code) => {
            if (code !== 0 && output.trim().length === 0) {
                return reject(new Error(errorOut || 'yt-dlp failed'));
            }
            try {
                const lines = output.trim().split('\n').filter(l => l.trim().startsWith('{'));
                resolve(lines.map(line => JSON.parse(line)));
            } catch (e) {
                resolve([]);
            }
        });

        ytdlp.on('error', (err) => reject(err));
    });
}

function formatSeconds(sec) {
    if (sec === undefined || sec === null) return '0:00';
    const num = parseInt(sec);
    if (isNaN(num)) return '0:00';
    const m = Math.floor(num / 60);
    const s = num % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(count) {
    if (!count) return '0';
    const num = typeof count === 'string' ? parseInt(count.toString().replace(/[^0-9]/g, '')) : parseInt(count);
    if (isNaN(num)) return count.toString();
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// 📋 تعريف الأمر
searchCommand.category = "search";
searchCommand.command = ["بحث", "فيديو", "yt", "search", "youtube", "يوتيوب_بحث"];
searchCommand.desc = "بحث يوتيوب بـ 3 طرق (yt-dlp + Scraping + API)";

export default searchCommand;

