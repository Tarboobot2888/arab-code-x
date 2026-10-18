# ARAB code

منصة نشر الأكواد العربية. HTML/JS خالص مع Vercel Serverless Functions، والبيانات مخزنة داخل هذا المستودع نفسه.

## Env vars مطلوبة في Vercel
- `GITHUB_TOKEN` — توكن يقدر يقرأ/يكتب في هذا المستودع
- `GITHUB_REPO` — `mzml-gg/arab-web`
- `JWT_SECRET` — سلسلة عشوائية طويلة
- `ADMIN_EMAIL` — `3rab_top_devs@top.com`
- `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS`
- `PUBLIC_BASE_URL` — `https://arab-code-web.vercel.app`

## المسارات
- `/` رئيسية
- `/auth` تسجيل دخول/إنشاء حساب
- `/submit` إضافة كود
- `/admin` لوحة الأدمن
- `/u/:username` صفحة مستخدم
- `/c/:filename` عرض كود
