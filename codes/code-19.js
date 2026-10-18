// دن تم التطوير بواسطه داكس المظ🐦مطور بوت سيراف
// لا تحذف السطرين دول بل حب😭🗿

function setupUnbanCommand(bot) {
    const activeUnbanRequests = new Map();

    bot.command('rm', (ctx) => {
        activeRequestsCleanup(ctx.from.id);
        activeUnbanRequests.set(ctx.from.id, true);
        ctx.reply('ارسل الرقم ل فك حظره');
    });

    bot.use(async (ctx, next) => {
        if (ctx.message?.text && activeUnbanRequests.has(ctx.from.id)) {
            const phoneNumber = ctx.message.text.trim();
            activeUnbanRequests.delete(ctx.from.id);

            if (!phoneNumber.startsWith('+') || phoneNumber.length < 8) {
                return ctx.reply('❌ الرقم غير صحيح. تأكد من كتابة رمز الدولة متبوعاً بالرقم (مثال: `+9665xxxxxxxx`). أرسل الأمر `/rm` مرة أخرى.');
            }

            // إرسال رسالة شريط التحميل البداية
            let progressMsg = await ctx.reply('⏳ جارٍ الاتصال بسيرفرات واتساب...\n`[░░░░░░░░░░] 0%`', { parse_mode: 'Markdown' });

            try {
                // شريط التحميل المتدرج حتى يكتمل
                const steps = [
                    { percent: '20%', bar: '[██░░░░░░░░]', text: '⏳ جارٍ إرسال طلب المراجعة...' },
                    { percent: '40%', bar: '[████░░░░░░]', text: '⏳ يتم تجاوز قفل الأمان المؤقت...' },
                    { percent: '60%', bar: '[██████░░░░]', text: '⏳ جارٍ مسح السجل المؤقت للرقم...' },
                    { percent: '80%', bar: '[████████░░]', text: '⏳ يتم إجبار السيرفر على إرسال كود التفعيل...' },
                    { percent: '100%', bar: '[██████████]', text: '✅ اكتملت العملية بنجاح!' }
                ];

                for (const step of steps) {
                    await new Promise(resolve => setTimeout(resolve, 900));
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        progressMsg.message_id,
                        undefined,
                        `⏳ ${step.text}\n\`${step.bar} ${step.percent}\``,
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }

                // التعديل النهائي إلى تم فك حظر الرقم بنجاح
                await new Promise(resolve => setTimeout(resolve, 600));
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    progressMsg.message_id,
                    undefined,
                    `🎉 **تم فك حظر الرقم بنجاح!**\n\n📱 الرقم: \`${phoneNumber}\`\n\n💡 يمكنك الآن الدخول لتطبيق واتساب وطلب كود التفعيل وسيعمل معك فوراً.`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});

            } catch (error) {
                await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
                await ctx.reply(`❌ حدث خطأ أثناء المعالجة: ${error.message}`);
            }
        } else {
            return next();
        }
    });

    function activeRequestsCleanup(userId) {
        activeUnbanRequests.delete(userId);
    }
}

module.exports = setupUnbanCommand;