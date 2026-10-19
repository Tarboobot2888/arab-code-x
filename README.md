# ARAB code

منصة نشر الأكواد العربية. واجهة HTML/CSS/JavaScript خالصة مع Vercel Serverless
Functions، وبيانات تشغيلية مخزّنة حالياً عبر GitHub Contents API (مرحلة انتقالية
— انظر [الترحيل إلى قاعدة بيانات](#الترحيل-إلى-قاعدة-بيانات)).

> **قبل النشر:** اقرأ [`AUDIT_FINAL_ARAB_CODE.md`](AUDIT_FINAL_ARAB_CODE.md).
> يوجد إجراءات أمنية لا يمكن إكمالها إلا بصلاحيات تشغيلية (تدوير `JWT_SECRET`،
> تدوير مفتاح الرفع، وتقييم إعادة كتابة تاريخ Git).

---

## المتطلبات

| العنصر | الإصدار |
| --- | --- |
| Node.js | **22.x** (مثبّت في `.nvmrc` و`engines`) |
| مدير الحزم | **npm 10+** فقط (`package-lock.json` هو ملف القفل الوحيد) |
| قاعدة بيانات | PostgreSQL 15+ — اختيارية حتى تنفيذ الترحيل |

```bash
nvm use            # يقرأ .nvmrc
npm ci             # تثبيت مطابق للقفل تماماً
```

> **لا تستخدم pnpm أو yarn.** كان المشروع يحتوي `package-lock.json`
> و`pnpm-lock.yaml` معاً (APP-06)؛ أُزيل ملف pnpm وأصبح npm هو المدير المعتمد.

### التبعيات

التبعيات مثبّتة بإصدارات **دقيقة** (بلا `^`) حتى لا يتغيّر شيء دون قرار:

| الحزمة | الإصدار | ملاحظة |
| --- | --- | --- |
| `bcryptjs` | 2.4.3 | لم تُرقَّ — 0 تنبيهات |
| `jsonwebtoken` | 9.0.3 | لم تُرقَّ — 0 تنبيهات |
| `nodemailer` | 10.1.2 | **رُقِّيت من 6.10.1** لإغلاق سلسلة تنبيهات HIGH (حقن أوامر SMTP، حقن ترويسات CRLF، تجاوز التحقق من نطاق المستلم). ترقية رئيسية قُيِّم توافقها ومُغطّاة بـ `tests/mail.test.js`. |
| `pg` | 8.13.1 | اختيارية — للترحيل فقط |

`npm audit --omit=dev` ⇒ **0 vulnerabilities**.

> **قبل الإنتاج:** نفّذ إرسال بريد تجريبي واحد على staging للتأكد من إعدادات
> SMTP مع nodemailer 10 (الاختبارات تغطي بناء الرسالة بلا شبكة، لا الاتصال).

---

## التشغيل محلياً

واجهات API مكتوبة بأسلوب Vercel Serverless. أسهل طريقة للتشغيل المحلي:

```bash
cp .env.example .env          # ثم عدّل القيم
npx vercel dev                # يشغّل الموجّه والصفحات معاً
```

بدون `vercel dev` يمكن تشغيل الاختبارات والفحوص كاملة، لأنها لا تحتاج شبكة:

```bash
npm run check                 # lint + كل الاختبارات
```

### السلوك في بيئة التطوير

| الإعداد | الإنتاج | التطوير |
| --- | --- | --- |
| `JWT_SECRET` مفقود | **الخدمة ترفض العمل (503)** | مفتاح عشوائي مؤقت لكل عملية + تحذير |
| `TURNSTILE_SECRET_KEY` مفقود | **الخدمة ترفض العمل (503)** | يتم تخطّي التحقق مع تحذير واضح |
| `UPLOADS_API_KEY` مفقود | مسارات الرفع تُرجع 503 | مسارات الرفع تُرجع 503 |
| حدود الطلبات بلا Upstash | عدّاد داخلي + تحذير في `/api/health` | عدّاد داخلي |

لا يوجد أي قيمة سرية افتراضية في الشيفرة. راجع [`api/_config.js`](api/_config.js).

---

## متغيرات البيئة

القائمة الكاملة مع قيم توضيحية في [`.env.example`](.env.example). الإلزامية في
الإنتاج:

| المتغير | الوصف |
| --- | --- |
| `JWT_SECRET` | سلسلة عشوائية ≥ 32 حرفاً. تغييرها يُبطل كل الجلسات. |
| `ADMIN_EMAIL` | بريد حساب الإدارة الوحيد؛ الصلاحيات تُشتق منه في الخادم. |
| `PUBLIC_BASE_URL` | النطاق الموثوق لبناء روابط التفعيل وOAuth (لا يُشتق من `Host`). |
| `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` | مخزن البيانات الحالي. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | البريد. |
| `TURNSTILE_SECRET_KEY` | التحقق من الروبوتات — غيابه في الإنتاج يوقف الخدمة. |

اختيارية:

| المتغير | الوصف |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | تسجيل الدخول بجوجل (يُعطَّل بأمان عند غيابهما). |
| `UPLOADS_API_KEY` / `UPLOADS_API_URL` / `UPLOADS_PUBLIC_ORIGIN` | خدمة رفع الملفات. |
| `UNTRUSTED_CONTENT_ORIGIN` | نطاق مستقل لتقديم محتوى المستخدمين القابل للتنفيذ. **يجب أن يختلف عن `PUBLIC_BASE_URL`.** |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | حدود طلبات موزّعة (مطلوبة فعلياً في الإنتاج). |
| `SUPPORT_WHATSAPP` | رقم/رقمان للدعم في رسائل البريد (بدلاً من قيم مكتوبة في الشيفرة). |
| `DATABASE_URL` | هدف الترحيل. |
| `EXTRA_ALLOWED_ORIGINS` | أصول إضافية مسموحة لفحص CSRF. |

للتحقق من التهيئة في أي وقت:

```bash
curl -s https://<domain>/api/health | jq
```

يُرجع قيماً منطقية فقط (موجود/غير موجود) ولا يكشف أي قيمة سرية. تسجيل الدخول
بحساب الإدارة يُظهر أيضاً **أسماء** المتغيرات الناقصة (لا قيمها).

---

## المسارات

### الصفحات

| المسار | الملف | الفهرسة |
| --- | --- | --- |
| `/` | `index.html` | نعم |
| `/search` | `search.html` | نعم |
| `/popular` | `popular.html` | نعم |
| `/info` | `info.html` | نعم |
| `/auth` | `auth.html` | نعم |
| `/c/:filename` | `code.html` | نعم (canonical ديناميكي) |
| `/u/:username` | `user.html` | نعم (canonical ديناميكي) |
| `/submit` | `submit.html` | لا (يتطلب جلسة) |
| `/zip`, `/zip/new`, `/zip/:slug` | `zips.html`, `zip-new.html`, `zip-item.html` | لا (يتطلب جلسة) |
| `/admin` | `admin.html` | لا |
| `/sitemap.xml` | `api/_h/sitemap.js` | يُولّد من البيانات الحيّة |

### مسارات محجوبة

`/data/*` و`/pending/*` و`/codes/*` **لا تُنشر** إطلاقاً:

1. مستثناة من النشر في [`.vercelignore`](.vercelignore)،
2. ومحجوبة بقواعد `redirects` في [`vercel.json`](vercel.json) — وهي تُطبَّق
   **قبل** نظام الملفات، بخلاف `rewrites`.

الأكواد تُقدَّم حصراً عبر `GET /api/raw?file=…` بترويسة
`text/plain` + `nosniff` + `Content-Disposition: attachment` + CSP خاصة، فلا
يمكن تنفيذ HTML مرفوع على أصل المنصة.

### واجهات API

50 مساراً خلف موجّه واحد (`api/index.js`) للبقاء تحت حد دوال Vercel. أهمها:

```
الهوية      login signup logout me verify resend-verification
            forgot-password reset-password google google-callback
            change-email confirm-email change-username delete-account
المحتوى     list search raw submit quality-check approve reject pending
            delete-code delete-request delete-requests resolve-delete
الملفات     user update-profile upload-avatar
التفاعل     comments likes reports report-check report-dismiss messages
الحزم       zips zip zip-upload zip-publish zip-delete
الإدارة     users settings public-settings toggle-verify ban broadcast
            stats moderation-log
التشغيل     health sitemap
```

كل مسار حسّاس يمرّ عبر [`api/_guard.js`](api/_guard.js) الذي يفحص بالترتيب:
الهوية → صلاحية الجلسة → الحظر → تأكيد البريد → الدور → الملكية.

---

## الاختبارات

```bash
npm test                 # كل الاختبارات
npm run lint             # صياغة + await مفقود + DOM sinks
npm run verify:data      # تقرير سلامة ملفات البيانات
npm run secrets:scan     # فحص أسرار في شجرة العمل
node scripts/scan-secrets.js --history   # فحص تاريخ Git (تقرير فقط)
npm run check            # lint + test
```

الحزم:

| الملف | ما يغطّيه |
| --- | --- |
| `tests/data-schema.test.js` | صحة JSON والمخططات وثوابت الاحتواء الأمني |
| `tests/authz.test.js` | مصفوفة الصلاحيات للأدوار الستة + CSRF + تدوير الجلسات |
| `tests/tokens.test.js` | التجزئة والانتهاء ومنع إعادة الاستخدام |
| `tests/auth-flows.test.js` | التسجيل والدخول والتفعيل والاستعادة وتغيير البريد/الاسم والحذف |
| `tests/oauth-google.test.js` | تحقق ID token (توقيع/مصدر/جمهور/انتهاء/nonce) |
| `tests/http-limits.test.js` | حدود الحجم ونوع المحتوى وإخفاء تفاصيل الأخطاء |
| `tests/ratelimit-config.test.js` | حدود الطلبات وTurnstile وتحقق البيئة |
| `tests/content-security.test.js` | قوائم السماح وأسماء الملفات وStored XSS والعزل |
| `tests/uploads.test.js` | فحص الصور وZIP bombs وzip-slip والأسماء الخبيثة |
| `tests/concurrency.test.js` | عدم فقد التحديثات عند الكتابة المتزامنة |
| `tests/features.test.js` | الإعجابات والإحصاءات والبحث العربي وبطاقة الجودة والبلاغات |
| `tests/deploy-seo.test.js` | الرؤوس الأمنية وحجب المسارات وsitemap وcanonical والوصولية |
| `tests/migration.test.js` | المخطط والمهاجرات والمستورد والمطابقة |
| `tests/mail.test.js` | طبقة البريد على nodemailer الحقيقي (بلا شبكة): التحقق من المستلم ومنع حقن الترويسات وتهريب القوالب |

الاختبارات لا تلمس الشبكة: `tests/helpers/harness.js` يستبدل `api/_gh.js`
بمخزن في الذاكرة، ويستبدل البريد بمسجّل. جميع بيانات الاختبار مصطنعة
(`example.invalid`). **ملفات `codes/` لا تُشغَّل ولا تُحلَّل في الاختبارات** —
هي بيانات غير موثوقة.

ثلاثة اختبارات تظهر `skipped` لأنها تحتاج `DATABASE_URL` حقيقياً (تطبيق المخطط
والتراجع، اختبار التزامن المعاملاتي، وتجربة النسخ والاستعادة).

---

## النشر

النشر عبر Vercel. ما يضبطه [`vercel.json`](vercel.json):

* **الرؤوس الأمنية** على كل الاستجابات: `Content-Security-Policy`،
  `X-Content-Type-Options: nosniff`، `Referrer-Policy`، `Permissions-Policy`،
  `Strict-Transport-Security`، `X-Frame-Options`، `Cross-Origin-Opener-Policy`.
* **`no-store`** على `/admin`، و`X-Robots-Tag: noindex` على `/admin` و`/api/*`.
* **حجب** `/data`، `/pending`، `/codes`.
* إعادة كتابة `/api/*` و`/sitemap.xml` إلى الموجّه.

> **ملاحظة على CSP:** السياسة الحالية تسمح بـ `'unsafe-inline'` للسكربتات، لأن
> الصفحات تحتوي مقاطع JavaScript مضمّنة. هذه مرحلة أولى مقصودة؛ الخطوة التالية
> نقل المقاطع إلى ملفات واستخدام `nonce`. ما يحمي الأصل من محتوى المستخدمين ليس
> CSP بل عزل `codes/` عن النشر.

CI في [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint، سلامة
البيانات، فحص الأسرار (شجرة العمل يُفشل البناء، والتاريخ تقرير)، الاختبارات،
`npm audit`، وبوابة تتحقق أن الخدمة ترفض العمل بإعداد ناقص.

---

## الترحيل إلى قاعدة بيانات

الهدف (الخطة، القسم 5–6): إيقاف استخدام GitHub كمخزن تشغيلي لبيانات المستخدمين،
والاحتفاظ به للشيفرة وCI/CD فقط.

### الملفات

| الملف | الدور |
| --- | --- |
| `migrations/001_initial_schema.sql` | المخطط: جداول، قيود، فهارس، أنواع محصورة، عرض عام |
| `migrations/001_initial_schema.down.sql` | التراجع الكامل |
| `scripts/migrate.js` | مُشغّل المهاجرات (معاملة واحدة + checksum لكل ملف) |
| `scripts/import-json-to-pg.js` | مستورد idempotent + تقرير مطابقة |
| `scripts/reconcile.js` | مقارنة counts قبل/بعد |
| `scripts/backup-data.js` | نسخة احتياطية من `data/` مع SHA-256 لكل ملف |
| `scripts/verify-data.js` | تقرير سلامة (يعمل على `data/` أو على نسخة احتياطية) |

### الخطوات

```bash
# 0) مراجعة بلا أي اتصال — تعمل اليوم وفي CI
node scripts/migrate.js --dry-run
node scripts/import-json-to-pg.js --plan     # تقرير التحويل والمطابقة
node scripts/reconcile.js                    # عدد الصفوف المتوقع لكل جدول

# 1) نسخة احتياطية موثّقة قبل أي شيء
npm run backup:data
node scripts/verify-data.js --dir backups/<timestamp>

# 2) على staging أولاً
export DATABASE_URL="postgres://…?sslmode=require"
npm run db:migrate
node scripts/migrate.js --status
npm run db:import
npm run db:reconcile -- --db                 # بوابة العبور

# 3) الكتابة أولاً إلى القاعدة، ثم القراءة بعد مطابقة النتائج
#    (تجنّب dual-write غير المحكوم — الخطة 6.2 الخطوة 4)

# 4) التراجع إن لزم
node scripts/migrate.js --down
```

### ما لم يُنفَّذ بعد

`DATABASE_URL` غير متوفر في هذه الدورة، لذلك:

* **لم يُطبَّق المخطط على قاعدة بيانات حقيقية**، ولم تُنفَّذ اختبارات التزامن
  المعاملاتي ولا تجربة الاستعادة.
* الكود الحالي ما زال يقرأ ويكتب عبر GitHub Contents API. **لا يوجد
  dual-write**: مصدر الحقيقة في هذه المرحلة هو ملفات `data/` فقط.
* الخطوة التالية التي تحتاج صلاحيات: تجهيز قاعدة PostgreSQL مُدارة + تخزين
  كائنات، ثم تنفيذ الخطوات 2 و3 أعلاه على staging.

### خطة النسخ والاستعادة

| العنصر | القيمة المقترحة |
| --- | --- |
| RPO | 15 دقيقة (PITR على قاعدة مُدارة) |
| RTO | ساعتان |
| دورية اختبار الاستعادة | شهرياً، إلى قاعدة معزولة، ثم `npm run db:reconcile -- --db` |
| الاحتفاظ | 30 يوماً للنسخ اليومية، 12 شهراً للنسخ الشهرية |

---

## صيانة البيانات

```bash
npm run backup:data                              # نسخة احتياطية (إلى backups/ المستثنى من Git)
npm run verify:data                              # تقرير سلامة
node scripts/revoke-legacy-tokens.js             # تجربة
node scripts/revoke-legacy-tokens.js --write --purge-phone
node scripts/normalize-manifest.js --write        # تصحيح أسماء الملفات + مخطط الفهرس
node scripts/normalize-interactions.js --write    # إعادة ربط التعليقات والإعجابات
```

كل سكربت يكتب نسخة احتياطية قبل التعديل، ويعمل في وضع تجربة افتراضياً، ولا
يحذف بيانات مصدر دون نسخة مؤكدة.

---

## هيكل المشروع

```
api/
  index.js            الموجّه + بوابة التهيئة
  _config.js          مصدر الإعداد الوحيد + تحقق عند التشغيل
  _http.js            حدود الجسم، نوع المحتوى، CSRF، أخطاء موحّدة، request-id
  _guard.js           طبقة الهوية/الحظر/الصلاحيات/الملكية
  _auth.js            الجلسات ومخزن المستخدمين
  _tokens.js          رموز مجزّأة، منتهية، تُستخدم مرة واحدة
  _lockout.js         قفل مؤقت للحساب بعد محاولات دخول متكررة
  _ratelimit.js       حدود الطلبات (Upstash أو احتياطي داخلي)
  _content.js         قوائم السماح، أسماء الملفات، فحص الملفات، بطاقة الجودة
  _search.js          تطبيع عربي + بحث وترقيم
  _moderation.js      حالات النشر + سجل التدقيق
  _google_verify.js   تحقق ID token عبر JWKS
  _gh.js              مخزن GitHub + updateJson المعاملاتي
  _uploads.js         عميل خدمة الرفع
  _mail.js _page.js _enrich.js _resolve.js _settings.js _interact.js _report.js
  _h/                 المعالجات (مسار واحد لكل ملف)
data/                 بيانات التشغيل — غير منشورة
codes/                مكتبة أكواد المستخدمين — غير منشورة، تُقدَّم كنص عبر /api/raw
pending/              المساهمات قيد المراجعة — غير منشورة
migrations/ scripts/ tests/
```

---

## الأمن

* **الإبلاغ عن ثغرة:** راسل بريد الإدارة المضبوط في `ADMIN_EMAIL`. لا تفتح
  تذكرة عامة بتفاصيل ثغرة غير معالجة.
* سجل المخاطر والإصلاحات: [`AUDIT_FINAL_ARAB_CODE.md`](AUDIT_FINAL_ARAB_CODE.md).
* مصفوفة المتطلبات: [`AUDIT_REQUIREMENTS.md`](AUDIT_REQUIREMENTS.md).
