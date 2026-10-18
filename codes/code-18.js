const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const archiver = require('archiver');
const { URL } = require('url');

// دن تم التطوير بواسطه داكس المظ🐦مطور بوت سيراف
// لا تحذف السطرين دول بل حب😭🗿

async function downloadFile(url, outputPath, cookies = '', retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
                    'Cookie': cookies
                }
            });
            ensureDir(path.dirname(outputPath));
            fs.writeFileSync(outputPath, response.data);
            return true;
        } catch (_) {
            if (i === retries - 1) return false;
        }
    }
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function toAbsoluteUrl(baseUrl, relative) {
    if (!relative || relative.startsWith('data:') || relative.startsWith('javascript:') || relative.startsWith('#')) return null;
    try {
        return new URL(relative, baseUrl).href;
    } catch (_) {
        return null;
    }
}

module.exports = (bot) => {
    const activeRequests = new Map();

    bot.command('MOK', (ctx) => {
        activeRequests.set(ctx.from.id, true);
        ctx.reply(
            '📥 **تم تفعيل وضع الاستنساخ الشامل (بأسماء الملفات الأصلية بدون تعديل)!**\n' +
            'أرسل رابط الموقع للبدء في تحميل جميع الملفات والمجلدات بأسمائها الحقيقية.\n\n' +
            '💡 *ملاحظة:* أرسل الرابط متبوعاً بـ `COOKIE:` إن كان الموقع يتطلب تسجيل دخول.'
        );
    });

    bot.use(async (ctx, next) => {
        if (ctx.message?.text && activeRequests.has(ctx.from.id)) {
            const input = ctx.message.text.trim();
            activeRequests.delete(ctx.from.id);

            let url = input;
            let userCookies = '';
            if (input.includes('COOKIE:')) {
                const parts = input.split('COOKIE:');
                url = parts[0].trim();
                userCookies = parts[1].trim();
            }

            let statusMsg = await ctx.reply('⏳ جاري جلب ملفات الموقع بأسمائها الأصلية وبدون أي تعديل...');

            const tempDir = path.join(__dirname, 'temp_' + Date.now());
            ensureDir(tempDir);

            try {
                const { data: htmlContent } = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
                        'Cookie': userCookies
                    },
                    timeout: 25000
                });

                const baseUrl = url;
                const $ = cheerio.load(htmlContent);
                const downloadedResources = new Map();

                function getLocalPathAndRelative(absoluteUrl, currentFilePath) {
                    const parsed = new URL(absoluteUrl);
                    let pathname = parsed.pathname;

                    let cleanPath = pathname.replace(/^\/+/, '');
                    if (!cleanPath || cleanPath.endsWith('/')) {
                        cleanPath += 'main_page.html';
                    }

                    const localPath = path.join(tempDir, cleanPath);
                    const relativePath = path.relative(path.dirname(currentFilePath), localPath).replace(/\\/g, '/');

                    return { localPath, relativePath };
                }

                const parsedMainUrl = new URL(baseUrl);
                let mainFileName = path.basename(parsedMainUrl.pathname);
                if (!mainFileName || !mainFileName.includes('.')) {
                    mainFileName = 'index_original.html';
                }
                const mainHtmlPath = path.join(tempDir, mainFileName);

                async function processResource(absoluteUrl, currentFilePath) {
                    if (downloadedResources.has(absoluteUrl)) {
                        return downloadedResources.get(absoluteUrl);
                    }

                    const { localPath, relativePath } = getLocalPathAndRelative(absoluteUrl, currentFilePath);
                    const success = await downloadFile(absoluteUrl, localPath, userCookies);

                    if (success) {
                        downloadedResources.set(absoluteUrl, relativePath);

                        const ext = path.extname(localPath).toLowerCase();

                        if (ext === '.css') {
                            try {
                                let cssText = fs.readFileSync(localPath, 'utf8');
                                const urlRegex = /url\((['"]?)([^'"]+?)\1\)/g;
                                let match;

                                while ((match = urlRegex.exec(cssText)) !== null) {
                                    const subUrl = match[2];
                                    const absSubUrl = toAbsoluteUrl(absoluteUrl, subUrl);
                                    if (absSubUrl) {
                                        const subRelPath = await processResource(absSubUrl, localPath);
                                        if (subRelPath) {
                                            cssText = cssText.replace(match[0], `url("${subRelPath}")`);
                                        }
                                    }
                                }
                                fs.writeFileSync(localPath, cssText, 'utf8');
                            } catch (_) {}
                        }

                        return relativePath;
                    }
                    return null;
                }

                const promises = [];

                const selectors = [
                    { selector: 'link', attr: 'href' },
                    { selector: 'script', attr: 'src' },
                    { selector: 'img', attr: 'src' },
                    { selector: 'img', attr: 'data-src' },
                    { selector: 'img', attr: 'srcset' },
                    { selector: 'source', attr: 'src' },
                    { selector: 'video', attr: 'src' },
                    { selector: 'audio', attr: 'src' },
                    { selector: 'iframe', attr: 'src' },
                    { selector: '[style]', attr: 'style' }
                ];

                selectors.forEach(({ selector, attr }) => {
                    $(selector).each((_, el) => {
                        let val = $(el).attr(attr);
                        if (!val) return;

                        if (attr === 'style') {
                            const bgMatch = val.match(/url\((['"]?)([^'"]+?)\1\)/);
                            if (bgMatch) val = bgMatch[2];
                            else return;
                        }

                        if (attr === 'srcset') {
                            val = val.split(',')[0].trim().split(' ')[0];
                        }

                        const absoluteUrl = toAbsoluteUrl(baseUrl, val);
                        if (absoluteUrl) {
                            promises.push(
                                processResource(absoluteUrl, mainHtmlPath).then(newRelPath => {
                                    if (newRelPath) {
                                        if (attr === 'style') {
                                            $(el).attr('style', `background-image: url("${newRelPath}")`);
                                        } else {
                                            $(el).attr(attr, newRelPath);
                                        }
                                    }
                                })
                            );
                        }
                    });
                });

                await Promise.all(promises);

                fs.writeFileSync(mainHtmlPath, $.html(), 'utf8');

                const zipPath = path.join(__dirname, `site_original_${Date.now()}.zip`);
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                await new Promise((resolve, reject) => {
                    output.on('close', resolve);
                    archive.on('error', reject);
                    archive.pipe(output);
                    archive.directory(tempDir, false);
                    archive.finalize();
                });

                await ctx.replyWithDocument(
                    { source: zipPath, filename: `original_site_${Date.now()}.zip` },
                    { caption: '✅ **تم استنساخ جميع الملفات والمجلدات بالأسمآء الأصلية دون أي تعديل بنجاح!**' }
                );

                fs.rmSync(tempDir, { recursive: true, force: true });
                fs.unlinkSync(zipPath);
                await bot.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

            } catch (error) {
                await bot.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
                await ctx.reply(`❌ حدث خطأ أثناء الاستنساخ: ${error.message}`);
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        } else {
            return next();
        }
    });
};
