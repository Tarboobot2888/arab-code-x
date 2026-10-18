const axios = require('axios');

// ═══════════════════════════════════════════
// 📖 كِتَابُ ڤَانِيتَاسْ - Vanitas no Carte Style
// ═══════════════════════════════════════════

const VANITAS_BANNER = `
╔══════════════════════════════════════════╗
║  📖 كِتَابُ ڤَانِيتَاسْ  ║  Vanitas Book  ║
╚══════════════════════════════════════════╝`;

const vanitasQuotes = [
    "🌙 *\"القمر يشرق على الحقيقة المخفية...\"*",
    "⚗️ *\"أنا طبيب مصاصي الدماء، وأنت تبحث عن العلاج...\"*",
    "📖 *\"في صفحات الكتاب المقدس، تكمن الإجابات...\"*",
    "🦇 *\"الظلال تحتضن الأسرار، وسأكشفها لك...\"*",
    "🔮 *\"مصيرك مكتوب بين النجوم، وبحثك يبدأ الآن...\"*",
    "🌹 *\"كل سر له ثمنه، وكل بحث له نهايته...\"*",
    "⚰️ *\"من الظلام نأتي، وإليه نعود بالحقائق...\"*"
];

const getRandomQuote = () => vanitasQuotes[Math.floor(Math.random() * vanitasQuotes.length)];

// ─── Search Engines ───
const searchWikipedia = async (query, lang = 'ar') => {
    try {
        const res = await axios.get(
            `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
            { timeout: 8000 }
        );
        if (res.data.extract) return res.data;
        throw new Error('No extract');
    } catch {
        try {
            const search = await axios.get(
                `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
                { timeout: 8000 }
            );
            if (search.data.query?.search?.length > 0) {
                const title = search.data.query.search[0].title;
                const sum = await axios.get(
                    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
                    { timeout: 8000 }
                );
                return sum.data;
            }
        } catch { return null; }
    }
};

const searchDuckDuckGo = async (query) => {
    try {
        const res = await axios.get(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
            { headers: { 'Accept': 'application/json' }, timeout: 10000 }
        );
        return res.data;
    } catch { return null; }
};

// ─── Main Handler ───
const handler = async (sock, msg, text, sender) => {
    const args = text.slice(text.indexOf(' ') + 1).trim();

    // ═══ No Query → Show Menu ═══
    if (!args || args === text) {
        const buttons = [
            { 
                name: "single_select", 
                buttonParamsJson: JSON.stringify({
                    title: "📖 اختر موضوعاً من كتاب المصائر",
                    sections: [{
                        title: "✨ مواضيع مقترحة",
                        rows: [
                            { title: "🤖 الذكاء الاصطناعي", description: "آخر تطورات الذكاء الاصطناعي", id: "suggest_ai" },
                            { title: "🌌 الفضاء", description: "اكتشافات فضائية حديثة", id: "suggest_space" },
                            { title: "📜 التاريخ", description: "أحداث تاريخية مهمة", id: "suggest_history" },
                            { title: "💻 التكنولوجيا", description: "أحدث التقنيات", id: "suggest_tech" },
                            { title: "⚗️ الطب", description: "اكتشافات طبية", id: "suggest_medicine" }
                        ]
                    }]
                })
            },
            {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({ display_text: "🔍 مثال: الذكاء الاصطناعي", id: "search_example_ai" })
            },
            {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({ display_text: "🌙 مثال: القمر", id: "search_example_moon" })
            }
        ];

        await sock.sendMessage(sender, {
            text: `${VANITAS_BANNER}\n\n${getRandomQuote()}\n\n*⚗️ مرحباً بك في أرشيف الظلال...*\n\nأنا *ڤَانِيتَاسْ*، حامي كتاب المصائر، وطبيب الأسرار المنسية...\n\n🌙 *للبدء في رحلة البحث، أرسل لي استعلامك بعد الأمر:*\n> *.بحث [موضوع البحث]*\n\n*📖 أمثلة:*\n> *.بحث الذكاء الاصطناعي*\n> *.بحث تاريخ مصر القديمة*\n> *.بحث أحدث التقنيات*\n\n🔮 *أو اختر من قائمة المصائر المقترحة...*`,
            footer: "🦇 Vanitas no Carte | Sovereign X",
            buttons: buttons,
            headerType: 1
        });
        return;
    }

    // ═══ Loading ═══
    const loadingMsg = await sock.sendMessage(sender, {
        text: `🌙 *جاري البحث في أرشيف الظلال...*\n\n⚗️ يبحث ڤَانِيتَاسْ عن: *"${args}"*\n\n📖 *\"الحقيقة تكمن بين صفحات الكتاب...\"*\n\n⏳ *الرجاء الانتظار قليلاً...*`
    });

    try {
        // Parallel Search
        const [wikiResult, ddgResult] = await Promise.all([
            searchWikipedia(args, 'ar').catch(() => searchWikipedia(args, 'en')),
            searchDuckDuckGo(args)
        ]);

        let resultText = `${VANITAS_BANNER}\n\n`;
        resultText += `${getRandomQuote()}\n\n`;
        resultText += `🔮 *الاستعلام:* _${args}_\n`;
        resultText += `🌙 *التاريخ:* ${new Date().toLocaleString('ar-EG')}\n`;
        resultText += `⚗️ *الباحث:* ڤَانِيتَاسْ | *Vanitas*\n`;
        resultText += `🦇 *المصدر:* كتاب الظلال\n`;
        resultText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        let hasResults = false;

        // Wikipedia
        if (wikiResult?.extract) {
            hasResults = true;
            resultText += `📖 *الملخص من أرشيف المعرفة (Wikipedia):*\n\n`;
            resultText += `> ${wikiResult.extract}\n\n`;
            if (wikiResult.content_urls?.desktop?.page) {
                resultText += `🔗 *رابط المصدر:* ${wikiResult.content_urls.desktop.page}\n\n`;
            }
        }

        // DuckDuckGo
        if (ddgResult?.AbstractText) {
            hasResults = true;
            resultText += `🦇 *من ظلال الإنترنت (DuckDuckGo):*\n\n`;
            resultText += `> ${ddgResult.AbstractText}\n\n`;
            if (ddgResult.AbstractURL) {
                resultText += `🔗 *رابط المصدر:* ${ddgResult.AbstractURL}\n\n`;
            }
        }

        // Related Topics
        if (ddgResult?.RelatedTopics?.length > 0) {
            hasResults = true;
            resultText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n✨ *مواضيع ذات صلة من كتاب المصائر:*\n\n`;
            const topics = ddgResult.RelatedTopics.slice(0, 5);
            let i = 0;
            topics.forEach((t) => {
                if (t.Text && i < 5) {
                    resultText += `${['🌙','⚗️','📖','🔮','🌹'][i]} ${t.Text}\n`;
                    i++;
                }
            });
            resultText += `\n`;
        }

        if (!hasResults) {
            resultText += `⚰️ *\"لم أجد شيئاً في صفحات الكتاب...\"*\n\n`;
            resultText += `❌ *لم يتم العثور على نتائج واضحة لـ:* _${args}_\n\n`;
            resultText += `💡 *حاول البحث بكلمات مختلفة أو أكثر تحديداً...*\n\n`;
        }

        resultText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        resultText += `🌹 *\"${hasResults ? 'كل سر له ثمنه، وكل بحث له نهايته...' : 'حتى الظلام يخفي أسراره عن البعض...'}\"*\n`;
        resultText += `📖 *- ڤَانِيتَاسْ*`;

        // ═══ Interactive Buttons ═══
        const buttons = [
            { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🔍 بحث جديد", id: "search_new" }) },
            { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "📖 تفاصيل أكثر", id: "search_more" }) },
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🌐 البحث في Google", url: `https://www.google.com/search?q=${encodeURIComponent(args)}` }) },
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📚 Wikipedia", url: `https://ar.wikipedia.org/wiki/${encodeURIComponent(args)}` }) }
        ];

        await sock.sendMessage(sender, {
            text: resultText,
            footer: "🦇 Vanitas no Carte | Sovereign X",
            buttons: buttons,
            headerType: 1
        });

        await sock.sendMessage(sender, { delete: loadingMsg.key });

    } catch (error) {
        console.error('Vanitas Search Error:', error);
        await sock.sendMessage(sender, {
            text: `${VANITAS_BANNER}\n\n${getRandomQuote()}\n\n🌙 *\"حتى الظلال تواجه عوائقها...\"*\n\n❌ *حدث خطأ في أرشيف الظلال:*\n\`\`\`${error.message}\`\`\`\n\n⚗️ *حاول مرة أخرى لاحقاً...*\n\n📖 *\"المصير لا يستسلم بسهولة...\"*`,
            footer: "🦇 Vanitas no Carte | Sovereign X"
        });
    }
};

// ═══════════════════════════════════════════
// Button Handler
// ═══════════════════════════════════════════
const buttonHandler = async (sock, msg, buttonId, sender) => {
    const map = {
        'search_new': async () => {
            await sock.sendMessage(sender, {
                text: `🌙 *\"افتح صفحة جديدة من الكتاب...\"*\n\nأرسل لي استعلامك الآن:\n> *.بحث [موضوعك]*\n\n📖 *مثال:*\n> *.بحث تاريخ الأندلس*`,
                footer: "🦇 Vanitas no Carte"
            });
        },
        'search_more': async () => {
            await sock.sendMessage(sender, {
                text: `📖 *\"التفاصيل تكمن في أعماق الأرشيف...\"*\n\nللحصول على تفاصيل أكثر:\n\n1️⃣ زيارة الروابط المرفقة\n2️⃣ البحث في Google عبر الزر المتاح\n3️⃣ طلب ملخص موسع بـ *.بحث [الموضوع]*\n\n🔮 *\"العلم نور في ظلمة الجهل...\"*`,
                footer: "🦇 Vanitas no Carte"
            });
        },
        'search_example_ai': async () => await handler(sock, msg, '.بحث الذكاء الاصطناعي', sender),
        'search_example_moon': async () => await handler(sock, msg, '.بحث القمر', sender),
        'suggest_ai': async () => await handler(sock, msg, '.بحث الذكاء الاصطناعي', sender),
        'suggest_space': async () => await handler(sock, msg, '.بحث الفضاء', sender),
        'suggest_history': async () => await handler(sock, msg, '.بحث الحرب العالمية الثانية', sender),
        'suggest_tech': async () => await handler(sock, msg, '.بحث أحدث التقنيات 2026', sender),
        'suggest_medicine': async () => await handler(sock, msg, '.بحث الطب التجددي', sender)
    };

    if (map[buttonId]) await map[buttonId]();
};

module.exports = {
    name: 'بحث',
    command: ['.بحث', '.search', '.فانيتاس', '.vanitas', '.كتاب'],
    description: 'البحث في الإنترنت بأسلوب Vanitas no Carte',
    category: 'search',
    handler,
    buttonHandler
};