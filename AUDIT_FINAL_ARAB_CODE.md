# تقرير التدقيق النهائي — منصة ARAB code

| | |
| --- | --- |
| **التاريخ** | 18 أكتوبر 2026 |
| **وثيقة الخطة المرجعية** | `خطة_تطوير_ARAB_code.docx` (+ نسخة PDF مطابقة) — الإصدار 1.0، بتاريخ 13 أكتوبر 2026 |
| **الفرع** | `ccr-271cf5b0-4mybgm` |
| **خط الأساس** | الوسم `174318f` — «Initial project upload» |
| **نطاق الفحص** | 216 ملفاً (قبل التعديل)، منها 148 JavaScript و30 HTML و11 JSON، إضافة إلى 133 ملفاً داخل `codes/` |
| **نتيجة الاختبارات** | 418 حالة اختبار: **415 ناجحة، 0 فاشلة، 3 متوقّفة** (تحتاج `DATABASE_URL` حقيقياً) |

> **ملاحظة على اسم الملف:** الوثيقة المطلوبة في المهمة كانت
> `خطة_تطوير_ARAB_code-1.docx`. الملف المتاح فعلياً هو
> `خطة_تطوير_ARAB_code.docx` (بدون `-1`) ومعه نسخة PDF مطابقة. قُرئت الوثيقة
> كاملة من نسخة docx (593 سطراً بعد التحويل، 10 أقسام + ملحقان)، وقُوبلت بنسخة
> PDF (25 صفحة) للتأكد من عدم وجود محتوى إضافي. لا فرق في المحتوى.

---

## 1. الملخص التنفيذي

أُغلقت **جميع نتائج P0 و P1** الواردة في خطة التطوير (SEC-01 إلى SEC-11)،
وأُغلقت نتائج P2/P3 (APP-01 إلى APP-09) عدا ما يحتاج صلاحيات تشغيلية.

أهم ما تغيّر:

1. **بيانات التشغيل لم تبقَ قابلة للتقديم كملفات عامة.** `data/` و`pending/`
   و`codes/` مستثناة من النشر ومحجوبة بقواعد تُطبَّق قبل نظام الملفات.
2. **33 رمز تفعيل و12 رمز إعادة تعيين كانت مخزَّنة بنص صريح وبلا انتهاء — أُبطلت
   فعلياً**، واستُبدلت الآلية برموز مجزّأة (SHA-256) بانتهاء إلزامي واستخدام
   واحد. 32 رقم هاتف أُزيلت لأن أي ميزة لم تكن تقرأها.
3. **لا يمكن تنفيذ HTML مرفوع على أصل المنصة.** المحتوى القابل للتنفيذ يخضع
   للمراجعة دائماً، ويُقدَّم كنص خامل فقط.
4. **أُزيل مفتاح خدمة الرفع من الشيفرة**، وأُلغيت كل القيم الاحتياطية غير
   الآمنة. الخدمة ترفض العمل في الإنتاج بإعداد ناقص بدل العمل بقيم ثابتة.
5. **طبقة تفويض واحدة** تُطبَّق في الخادم على كل عملية حسّاسة، مع 95 حالة اختبار
   تهاجم المسارات مباشرةً كما يفعل المهاجم.
6. **أُصلحت عيوب وظيفية مؤكّدة** كانت تُسقط ميزات كاملة بصمت: مسار الإعجابات
   غير الموجود، إحصاءات تقرأ ملفات غير موجودة، بلاغات لا يمكن إرسالها، وحذف
   أكواد المحظور الذي لم يكن ينفَّذ أبداً.

### ما لا يزال يحتاج تدخلاً تشغيلياً

| # | الإجراء | السبب |
| --- | --- | --- |
| 1 | تدوير `JWT_SECRET` في إعدادات المنصة | لا أملك صلاحية على إعدادات Vercel |
| 2 | تدوير مفتاح الرفع لدى المزوّد | لا أملك حساب المزوّد |
| 3 | قرار إعادة كتابة تاريخ Git + إشعار المتأثرين | قرار مالك المستودع |
| 4 | تجهيز قاعدة PostgreSQL وتنفيذ الترحيل | لا يوجد `DATABASE_URL` |
| 5 | تجهيز `UNTRUSTED_CONTENT_ORIGIN` و`UPSTASH_*` | يحتاج نطاقاً وحساباً |

تفصيلها في [القسم 6](#6-ما-يحتاج-صلاحيات-أو-إعدادات-إنتاجية).

---

## 2. منهج الفحص وحدوده

### ما نُفِّذ

* قراءة وثيقة الخطة كاملة (كل الأقسام والجداول والخلايا والملحقين)، وتحويل كل
  بند إلى صف في [`AUDIT_REQUIREMENTS.md`](AUDIT_REQUIREMENTS.md).
* جرد كامل للشجرة بما يشمل الملفات المخفية (عُثر على ملفَين مخفيَّين داخل
  `codes/` هما `.js` و`.Telegram-sticker` لم يكونا مذكورَين في أي تقرير سابق).
* قراءة كل ملفات `api/` و`*.html` و`app.js` و`submit.js` و`ts.js` وملفات
  الإعداد والقفل.
* تحليل مخططات ملفات `data/` وعدد السجلات وفحص التكرار والتناسق المرجعي.
* تحليل ثابت: صياغة، `await` مفقود، DOM sinks، أسرار، تاريخ Git.
* 403 حالة اختبار تُنفِّذ المعالجات الحقيقية ضد مخزن في الذاكرة.

### ما لم يُنفَّذ، ولماذا

| البند | السبب |
| --- | --- |
| اختبار النطاق الحي (`https://www.arab-code.cv`) | لا توجد بيئة إنتاج أو staging متاحة لهذه الدورة. **لم أتحقق من إمكانية تنزيل `/data/users.json` من النطاق الحي ولا أدّعي ذلك.** الحجب مُثبَت على مستوى ملفات الإعداد ومُغطّى باختبارات. |
| تطبيق مخطط قاعدة البيانات | لا يوجد `DATABASE_URL`. السكربتات ترفض العمل وتُرجع رمز خروج 2 بدل التظاهر بالنجاح. |
| التحقق من صلاحيات GitHub الفعلية للتوكن | لا أملك التوكن. |
| فحص برمجيات خبيثة حقيقي للأرشيفات | يحتاج خدمة فحص. المنفَّذ: بصمات الملفات وبنية ZIP ومنع zip-slip وzip bombs. |
| اختبار اختراق ديناميكي وحمولة | يحتاج بيئة مصرّحاً بها. |
| تدوير أي مفتاح لدى مزوّد | لا صلاحية. |

### ضوابط التعامل مع `codes/`

ملفات `codes/` تُعامل بيانات غير موثوقة: **لم تُشغَّل ولم تُثبَّت تبعياتها ولم
تُحلَّل صياغتها**. `scripts/lint.js` يستثني المجلد صراحةً ويطبع ذلك. التعديل
الوحيد عليها كان **إعادة تسمية 11 ملفاً** (بلا أي تغيير في المحتوى) لأن أسماءها
لم تكن تمرّ على قائمة السماح الجديدة؛ وحُفظ الاسم القديم كـ alias حتى لا تنكسر
الروابط المنشورة.

---

## 3. سجل المخاطر: الحالة النهائية

مفتاح الأدلة: الملف:السطر يشير إلى **خط الأساس `174318f`** حين يصف المشكلة.

### 3.1 حرج (P0)

---

#### SEC-01 — انكشاف بيانات شخصية ورموز تحقق قابلة للاستخدام

**الحالة: مُغلق برمجياً · يحتاج إجراءً تشغيلياً (إعادة كتابة التاريخ)**

**الدليل المؤكَّد:**
* `data/users.json` — 192 سجلاً (الخطة ذكرت 187؛ العدد زاد بين الأرشيف والنسخة
  المفحوصة)، كلها تحمل `password_hash`، و**33 سجلاً يحمل `verification_token`
  بنص صريح**، و**12 يحمل `reset_token`**، و**32 يحمل رقم هاتف**.
* `.gitignore` (خط الأساس) لم يستثنِ `data/` → الملف متتبَّع في Git.
* `api/_h/verify.js:8` كان يقارن الرمز **دون أي فحص انتهاء صلاحية**، ثم يضبط
  `verified = true` ويصدر جلسة. أي نسخة من الملف كانت تكفي لتفعيل 33 حساباً
  وتسجيل الدخول بها.

**ما نُفِّذ:**
1. `api/_tokens.js` — رموز مجزّأة SHA-256، انتهاء **إلزامي**، استخدام واحد
   (يُمحى المخزَّن قبل نجاح العملية)، مقارنة بزمن ثابت.
   سجلٌّ بتجزئة وبلا انتهاء يُعامل **منتهياً** ويُمحى، فلا تُقبل أي حالة قديمة.
2. `scripts/revoke-legacy-tokens.js` — نُفِّذ فعلياً بعد نسخة احتياطية:

   ```
   users: 192
   verification_tokens_revoked: 33
   reset_tokens_revoked: 12
   phones_purged: 32
   sessions_rotated: 192
   ```
3. `api/_h/resend-verification.js` — مسار جديد، لأن إبطال الرموز كان سيترك 33
   حساباً بلا طريقة للتفعيل. يُرجع ردّاً واحداً دائماً فلا يكشف وجود البريد.
4. حجب تقديم `data/` و`pending/` و`codes/`: `.vercelignore` + قواعد `redirects`
   في `vercel.json` (و`redirects` تُطبَّق **قبل** نظام الملفات بخلاف `rewrites`،
   فهي الوسيلة الموثوقة للحجب).
5. `backups/` مُضاف إلى `.gitignore` حتى لا تُرفع نسخة بيانات.

**الدليل على الإغلاق:**
```
tests/data-schema.test.js  — "no plaintext verification or reset token remains"
                            "no token field of any kind is stored in clear"
                            "phone numbers are no longer stored"
tests/tokens.test.js       — 24 حالة: انتهاء، إعادة استخدام، سجل قديم بلا انتهاء
tests/auth-flows.test.js   — "a legacy no-expiry verification token is refused"
tests/deploy-seo.test.js   — "the deployment excludes data/, pending/ and codes/"
                            "redirects block the private paths before the filesystem"
```

**ما يتبقّى:** الرموز الملغاة **لا تزال موجودة في تاريخ Git** (commit واحد
يحملها). `node scripts/scan-secrets.js --history` يبلّغ عن ذلك. القرار (إعادة
كتابة التاريخ أو تدوير شامل + إشعار) يحتاج مالك المستودع.

---

#### SEC-02 — إمكانية تنفيذ HTML مرفوع على أصل الموقع

**الحالة: مُغلق**

**الدليل المؤكَّد:**
* `api/_h/submit.js:12-14` (خط الأساس): `const lang = String(language || 'txt').slice(0, 20)`
  ثم `filename = ${base}.${lang}` — **الامتداد يأتي من الطلب مباشرة**.
* `data/settings.json` (خط الأساس): `auto_approve: true` و`filter_enabled: false`
  و`direct_delete: true`.
* `data/manifest.json`: **18 مدخلاً بلغة `html`** منشورة فعلاً.
* `codes/` كان جزءاً من ملفات الموقع العامة → `/codes/<file>.html` كان ينفَّذ على
  أصل المنصة ومعه ملف ارتباط الجلسة.

**ما نُفِّذ:**
1. **عزل على مستوى النشر:** `codes/` مستثنى من `.vercelignore` ومحجوب بـ
   `redirects`. لا توجد أي طريقة للوصول إلى ملف مرفوع كمستند.
2. **تقديم خامل فقط** (`api/_h/raw.js`): `text/plain` + `nosniff` +
   `Content-Disposition: attachment` + ترويسة CSP خاصة
   (`sandbox; default-src 'none'; script-src 'none'`).
3. **قائمة سماح للغات في الخادم** (`api/_content.js`): 21 لغة، والامتداد يُشتق من
   القائمة لا من الطلب.
4. **المحتوى القابل للتنفيذ (HTML/SVG) يخضع للمراجعة دائماً** — أياً كان
   `auto_approve` أو شارة الناشر. غير الإدارة لا يستطيع نشره مباشرة.
5. `data/settings.json` صُحّح إلى `auto_approve: false` و`filter_enabled: true`،
   والقيم الافتراضية في `api/_settings.js` هي الآمنة، فملف إعدادات تالف لا يفتح
   البوابة.
6. **تشديد المعاينة:** `code.html` — `sandbox="allow-scripts"` فقط (بلا
   `allow-same-origin` ولا `allow-popups` ولا `allow-modals`)، مع
   `referrerpolicy="no-referrer"`، ومع CSP داخل مستند المعاينة يمنع الشبكة
   (`connect-src 'none'`) فلا يمكن تسريب ما يُلصق فيها.
7. مرشّح الكلمات موثَّق في الشيفرة بأنه **مساعدة إشراف لا ضمان أمني**.

**الدليل على الإغلاق:**
```
tests/content-security.test.js — "an HTML contribution is ALWAYS queued for review,
                                  even with auto_approve on"
                                 "an SVG contribution is queued too"
                                 "the stored extension cannot be chosen by the caller"
                                 "raw serves stored HTML as inert text/plain
                                  with an attachment disposition"
tests/deploy-seo.test.js       — "the preview iframe is sandboxed without
                                  same-origin access"
                                 "no page links to a raw executable path"
```

**ملاحظة صريحة:** `UNTRUSTED_CONTENT_ORIGIN` مُعرَّف ومُتحقَّق منه في الإعداد
(ويُرفض إن ساوى نطاق المنصة)، لكن **لم يُجهَّز نطاق فعلي**. حتى يُجهَّز، النموذج
المعمول به هو «لا تنفيذ على الإطلاق» — وهو أكثر تحفّظاً من العزل بنطاق مستقل.

---

#### SEC-03 — مفتاح خدمة رفع خارجي مكتوب داخل الشيفرة

**الحالة: مُغلق برمجياً · يحتاج تدوير المفتاح لدى المزوّد**

**الدليل المؤكَّد:**
* `api/_h/upload-avatar.js:5` (خط الأساس):
  `process.env.NEZUKO_API_KEY || 'nzk_<64 حرفاً>'`
* `api/_h/zips.js:71` (خط الأساس): القيمة نفسها مكرّرة داخل استدعاء `fetch`.

**ما نُفِّذ:**
* `api/_uploads.js` — عميل واحد، المفتاح من الإعداد المتحقَّق منه فقط، **بلا أي
  قيمة افتراضية**. غياب المفتاح → `503` من مسارات الرفع (لا تجاوز صامت).
* مهلة زمنية، حدّ لحجم ردّ المزوّد، والتحقق من أن الرابط العائد من أصل المزوّد.
* ردّ المزوّد الخام يُسجَّل في الخادم ولا يُعاد للعميل (كان يُعاد في `detail`).

**الدليل على الإغلاق:**
```
tests/uploads.test.js    — "no provider key appears anywhere in the source"
                           "upload-avatar fails closed when no provider key is configured"
                           "zip-upload fails closed with no provider key"
tests/deploy-seo.test.js — "no secret-shaped literal is committed anywhere in the source"
npm run secrets:scan     — clean
```

**ما يتبقّى:** المفتاح المكشوف **لا يزال في تاريخ Git** ويجب اعتباره منكشفاً.
`scan-secrets --history` يبلّغ عنه. **لا أملك صلاحية إلغائه لدى المزوّد ولا
أدّعي أنني ألغيته.**

---

### 3.2 عالٍ (P1)

---

#### SEC-04 — مفتاح JWT افتراضي معروف

**الحالة: مُغلق برمجياً · يحتاج تدوير `JWT_SECRET`**

**الدليل:** `api/_auth.js:6` (خط الأساس):
`const SECRET = process.env.JWT_SECRET || 'change-me'` — ومعه
`ADMIN_EMAIL || '3rab_top_devs@top.com'` في السطر 7.

**ما نُفِّذ:** `api/_config.js` كوحدة إعداد مركزية:
* `JWT_SECRET` إلزامي في الإنتاج بطول ≥ 32، و**قيم مثل `change-me` مرفوضة في كل
  البيئات**.
* غياب أي متغيّر إلزامي ⇒ الموجّه يُرجع `503` برسالة عامة، والسبب يُسجَّل في
  الخادم فقط (`/api/health` و`/sitemap.xml` تبقى متاحة للتشخيص).
* في التطوير: مفتاح عشوائي **مؤقت لكل عملية** مع تحذير — لا ثابت مشترك.
* `.env.example` بأسماء المتغيرات وقيم توضيحية.
* أُزيلت كل القيم الاحتياطية المتباينة: `_report.js` و`_h/ban.js` كانا يحملان
  `mzmlzip@gmail.com` و`https://monte-top-v.vercel.app`، و`_mail.js` كان يحمل
  رقمَي واتساب وبريداً شخصياً.
* **تدوير الجلسات:** `session_version` في كل سجل؛ زيادته تُبطل كل ملفات الارتباط
  القائمة. تزداد عند إعادة تعيين كلمة السر وتغيير البريد وتغيير الاسم والحظر.

**الدليل:**
```
tests/ratelimit-config.test.js — "production requires JWT_SECRET, ADMIN_EMAIL, …"
                                 "a placeholder secret is rejected in every environment"
                                 "an ephemeral development key is generated,
                                  never a shared constant"
tests/http-limits.test.js      — "the router gates every route when the
                                  configuration is incomplete"
tests/authz.test.js            — "a session whose version is stale is rejected"
                                 "a forged session (wrong secret) is rejected"
tests/deploy-seo.test.js       — "no stale fallback domain or support address"
```

---

#### SEC-05 — الحظر والصلاحيات غير مفروضة في الخادم

**الحالة: مُغلق**

**الدليل المؤكَّد:** ثلاثة تعريفات متناقضة لمعنى «محظور»:
* `data/bans.json` هو المخزن الفعلي، و`api/_h/me.js` يقرؤه ليعرض طبقة في الواجهة.
* `api/_auth.js` `currentUser()` **لا يفحص الحظر إطلاقاً**.
* `api/_h/zips.js:28` يفحص `u.banned` على سجل المستخدم — **حقل غير موجود في
  `users.json`**، فالفحص لم يكن ينجح أبداً.
* `api/_h/submit.js` و`api/_h/comments.js` لم يرفضا المحظور.

النتيجة: محظور يستدعي `/api/submit` مباشرة كان ينشر بنجاح.

**ما نُفِّذ:** `api/_guard.js` كبوابة واحدة تفحص بالترتيب: الهوية ← صلاحية
الجلسة ← الحظر ← تأكيد البريد ← الدور ← الملكية. `data/bans.json` هو مصدر الحقيقة
الوحيد (مع احترام حقل `banned` القديم احتياطاً). فشل قراءة ملف الحظر ⇒ `503`
(فشل مُغلق) لا «غير محظور». الحظر أيضاً **يُبطل جلسة العضو فوراً**.

**الدليل:** `tests/authz.test.js` — 95 حالة، منها لكل مسار كتابة:
«anonymous → 401»، «banned member is refused even calling the API directly»،
«unconfirmed email is refused»، ولكل مسار إداري: «ordinary member → 403».
وفي `tests/concurrency.test.js`: «a banned member's existing cookie stops
working immediately».

---

#### SEC-06 — تسجيل دخول جوجل بلا تحقق من التوقيع

**الحالة: مُغلق**

**الدليل المؤكَّد:** `api/_h/google.js:56-62` (خط الأساس) —
`decodeIdToken()` يفكّ ترميز base64 للحمولة فقط، ثم السطر 97:
`if (!email || claims.email_verified === false)`. لا تحقق من التوقيع ولا من
`iss`/`aud`/`exp`، و`email_verified` الغائب كان **يُقبل**.

**ما نُفِّذ:** `api/_google_verify.js` — تحقق حقيقي بلا أي تبعية جديدة:
JWKS من جوجل (مع cache ومهلة وإعادة جلب عند تغيير المفتاح)، استيراد JWK عبر
`node:crypto`، `jwt.verify` بـ RS256 والمصدر والجمهور والانتهاء، رفض
`alg: none`، اشتراط `email_verified === true` صراحةً، ومطابقة `nonce`.
و`state` مربوط بملف ارتباط HttpOnly ومقارَن بزمن ثابت.

**الدليل:** `tests/oauth-google.test.js` — 23 حالة بزوج مفاتيح RSA حقيقي يُولَّد
لكل تشغيل: «an unsigned token (alg=none) is refused»، «a token signed by a
different key is refused»، «a wrong audience/issuer is refused»،
«email_verified must be exactly true, not merely "not false"»، «the callback
refuses a forged id_token even with a valid state».

---

#### SEC-07 — Turnstile يُتجاوز بصمت، ولا حدود للطلبات

**الحالة: مُغلق برمجياً · الحدود الموزّعة تحتاج إعداد Upstash**

**الدليل:** `api/_turnstile.js:5` (خط الأساس):
`if (!secret) return { ok: true, skipped: true }` — غياب المفتاح يعطّل الحماية
بصمت. و`/api/forgot-password` لم يكن يطبّق Turnstile ولا أي حدّ طلبات.

**ما نُفِّذ:**
* Turnstile **يفشل مُغلقاً في الإنتاج**؛ `_config` يرفض التهيئة أصلاً فيُرجع
  الموجّه `503`. وفي التطوير يُتجاوز مع تحذير واحد واضح.
* `api/_ratelimit.js` — 22 سياسة مسمّاة، وتصنيف **مزدوج** بالـ IP وبهوية الفاعل
  (فتغيير الـ IP لا يُصفّر ميزانية الحساب). الواجهة الخلفية Upstash Redis عبر
  REST (بلا تبعية npm)، وبديل داخلي **موصوف صراحةً بأنه غير موزّع** ومعروض في
  `/api/health`.
* `api/_lockout.js` — قفل تدريجي للحساب يُخزَّن في المخزن المشترك (فيصمد أمام
  تغيير الـ IP)، ويُكتب عند تجاوز العتبة فقط حتى لا يتحوّل التخمين إلى سيل من
  الـ commits.
* Turnstile أُضيف إلى `/api/forgot-password` و`/api/resend-verification`
  في الخادم والواجهة.

**الدليل:**
```
tests/ratelimit-config.test.js — "Turnstile FAILS CLOSED in production when unconfigured"
                                 "forgot-password is rate limited (it had no protection at all)"
                                 "the limiter buckets by actor as well as IP"
                                 "the backend is reported honestly so the gap is visible"
tests/auth-flows.test.js       — "login locks the account after repeated failures"
```

**ما يتبقّى:** بلا `UPSTASH_*` تبقى الحدود غير موزّعة. القفل على مستوى الحساب
موزّع فعلاً. `/api/health` يُظهر `rate_limit_distributed: false` بوضوح.

---

#### SEC-08 — فقد التحديثات عند الكتابة المتزامنة

**الحالة: مُغلق (للمخزن الحالي)**

**الدليل:** `api/_gh.js:115-123` (خط الأساس) — `writeJson` يعيد قراءة `sha`
الطازج **لكنه يكتب الكائن الذي بناه المستدعي من نسخة قديمة**. فمن يكتب ثانياً
يمحو تعديل الأول بصمت.

**ما نُفِّذ:** `updateJson(path, fallback, mutate, message)` — تزامن تفاؤلي
حقيقي: الدالة المعدِّلة تُستدعى على **المحتوى الأحدث**، وعند تعارض 409/422
تُعاد قراءة الملف و**تُعاد الدالة** عليه (حتى 4 محاولات مع backoff). استُبدلت كل
عمليات «اقرأ ثم عدّل ثم اكتب» بها. وملف JSON تالف يُرفع خطأً بدل أن يُستبدل
بالقيمة الاحتياطية ويُكتب فوق البيانات.

**الدليل:** `tests/concurrency.test.js` — 13 حالة:
«updateJson replays the mutator after a conflict instead of overwriting»،
«two profile updates in flight do not erase each other»،
«concurrent comments on the same code all survive»،
«two signups racing for the same username: exactly one wins»،
«the same member cannot like the same code twice, even concurrently»،
«two concurrent publishes never collide on a filename».

---

#### SEC-09 — لا حدّ لحجم جسم الطلب

**الحالة: مُغلق**

**الدليل:** `api/_auth.js:74-83` (خط الأساس) — `readBody` يجمع
`d += c` بلا حدّ. و`api/_h/upload-avatar.js:25` يفحص حجم الصورة **بعد** قراءة
JSON كاملة.

**ما نُفِّذ:** `api/_http.js`:
* `readRawBody` يفرض الحدّ **أثناء البثّ** ويقطع الاتصال بـ `413` فوراً، مع
  رفض مبكر عند `Content-Length` كبير.
* التحقق من `Content-Type` (`415`) وJSON غير صالح (`400`) ورفض مصفوفة/قيمة في
  الجذر.
* حدود مستقلة لكل مسار (من 2 كيلوبايت للحذف إلى 1 ميغابايت للنشر).
* `methodGuard` مع ترويسة `Allow`.
* `request-id` في كل استجابة، ورسائل خطأ موحّدة: تفاصيل الاستثناء الداخلي
  **لا تُعاد للعميل** (كان يُعاد `e.message` في معظم المعالجات).

**الدليل:** `tests/http-limits.test.js` — 17 حالة، منها «readRawBody rejects an
oversized body with 413 and destroys the request»، «an internal failure returns
a generic message and a request id»، «upload-avatar enforces the size cap with
413 before buffering the whole body».

---

#### SEC-10 — إرسال كلمة مرور مولَّدة بالبريد

**الحالة: مُغلق**

**الدليل:** `api/_h/google.js:106` (خط الأساس) — `plainPassword = genPassword()`
ثم `sendWelcomeCredentials({ ..., password: plainPassword })`، و`_mail.js`
يضعها في جدول داخل الرسالة.

**ما نُفِّذ:** حساب جوجل يُنشأ **بلا كلمة سر محلية** (`password_hash: null`)،
ورسالة الترحيب خالية من أي بيانات اعتماد وتدعو لتعيين كلمة سر عبر تدفّق
الاستعادة الآمن إن رغب العضو. العمليات الحسّاسة لحساب بلا كلمة سر تطلب تأكيداً
بديلاً (كتابة اسم المستخدم) بدل قبول كلمة سر لا وجود لها.

**الدليل:** `tests/oauth-google.test.js` — «the callback creates an account with
NO password and emails no credential». و`tests/auth-flows.test.js` —
«a Google-only account deletes by typing its username instead of a password».

---

#### SEC-11 — غياب الرؤوس الأمنية

**الحالة: مُغلق (CSP مرحلة أولى)**

**الدليل:** `vercel.json` (خط الأساس) — قاعدة `headers` واحدة للـ cache فقط.

**ما نُفِّذ:** `Content-Security-Policy` (مع `object-src 'none'`،
`base-uri 'self'`، `form-action 'self'`، `frame-ancestors 'self'`)،
`X-Content-Type-Options: nosniff`، `Referrer-Policy`، `Permissions-Policy`،
`Strict-Transport-Security`، `X-Frame-Options`، `Cross-Origin-Opener-Policy`.
و`no-store` + `noindex` على `/admin`، و`noindex` على `/api/*`.

**الدليل:** `tests/deploy-seo.test.js` — «global security headers are present»،
«the CSP locks down the dangerous directives»، «every CDN the pages actually
load is allowed by the CSP, and nothing more» (الاختبار يقرأ الصفحات ويستخرج
مصادر الموارد الفعلية).

**قيد مُعلَن:** CSP تسمح بـ `'unsafe-inline'` للسكربتات لأن الصفحات تحتوي مقاطع
مضمّنة كبيرة. هذه مرحلة أولى مقصودة، والخطوة التالية نقل المقاطع إلى ملفات
واستخدام `nonce`. ما يحمي الأصل من محتوى المستخدمين ليس CSP بل عزل `codes/`.

---

### 3.3 متوسط ومنخفض (P2/P3)

| ID | الحالة | الدليل والإصلاح |
| --- | --- | --- |
| **APP-01** إعجابات بلا مسار | **مُغلق** | **مؤكَّد:** `popular.html:56,73` و`app_orig.js:143,146` تستدعي `/api/likes`، وهو غير مسجَّل في الموجّه (44 مساراً، لا يوجد بينها `likes`)، مع وجود مخطط `likes`/`likeTotals` في `interactions.json`. **الإصلاح:** `api/_h/likes.js` — التفرّد **بنيوي** عبر مفتاح `<username>\|<filename>`، والمجاميع تُحسب من المفاتيح فلا تنحرف. `popular.html` أُعيد ربطها بالشكل الصحيح للرد. |
| **APP-02** إحصاءات غير دقيقة | **مُغلق** | **مؤكَّد:** `api/_h/stats.js:12-13` يقرأ `data/pending.json` و`data/delete-requests.json` — **غير موجودَين** (الطلبات ملفات في `pending/`، والحذف في `data/delete_requests.json` بشرطة سفلية)، والسطر 28 يحسب `new_codes_week` من `published_at` بينما 132 مدخلاً كلها تستخدم `approved_at` فقط ⇒ القيمة كانت **صفراً دائماً**. **الإصلاح:** المصادر الصحيحة، وقبول الحقلَين، وكتابة الحقلَين معاً للمنشور الجديد، وترحيل `published_at` للمدخلات القديمة. |
| **APP-03** شارة إدارة مربوطة باسم مستخدم | **مُغلق** | **مؤكَّد:** `app.js:85` — `username.toLowerCase() === 'ziad'` يمنح شارة الإدارة. **الإصلاح:** الشارات من حقول الخادم فقط، و`_enrich.js` يُسقط أي شارة لمؤلف غير موجود أو فقد شارته. اختبار يفشل إن ظهر اسم مستخدم مميّز في `app.js`. |
| **APP-04** sitemap يحتوي مساراً غير موجود | **مُغلق** | **مؤكَّد:** `sitemap.xml` كان يحتوي `/search` ولا يوجد `search.html` ولا rewrite ⇒ 404 مضمون. **الإصلاح:** صفحة `search.html` كاملة (بحث عربي، فلاتر، ترقيم، اقتراحات عند عدم وجود نتائج، حقول مُسمّاة، `aria-live`)، وsitemap **ديناميكي** يسرد الصفحات العامة والأكواد المعتمدة والملفات الشخصية التي لها محتوى منشور، ويستثني الإدارة وAPI و`codes/` وغير المعتمد. حُذف `sitemap.xml` الثابت لأنه كان سيحجب الديناميكي (`rewrites` تُطبَّق بعد نظام الملفات). |
| **APP-05 / APP-09** إعدادات متناقضة وتسريب أخطاء | **مُغلق** | **مؤكَّد:** `_report.js:11-12` و`_h/ban.js:11-12` يحملان `mzmlzip@gmail.com` و`monte-top-v.vercel.app`، و`_auth.js:7` يحمل `3rab_top_devs@top.com`، وREADME يذكر `arab-code-web.vercel.app`، والصفحات canonical على `www.arab-code.cv` — **أربع قيم مختلفة**. و`e.message` يُعاد للعميل في معظم المعالجات. **الإصلاح:** `api/_config.js` كمصدر وحيد، و`baseUrl()` لا يستخدم ترويسة `Host` عند توفّر نطاق موثوق، وأخطاء موحّدة مع `request-id`. اختبار يمنع عودة أي قيمة قديمة. |
| **APP-06** ملفا قفل وغياب CI | **مُغلق** | **مؤكَّد:** `package-lock.json` و`pnpm-lock.yaml` معاً، ولا scripts اختبار، ولا CI. **الإصلاح:** حُذف `pnpm-lock.yaml`، وثُبِّتت Node 22 (`.nvmrc` + `engines` + `packageManager`)، وثُبِّتت التبعيات بإصدارات دقيقة، و12 script، وCI بوظيفتَين. |
| **APP-07** أسماء ملفات ولغات غير متسقة | **مُغلق** | **مؤكَّد:** 10 مدخلات بلا امتداد، 8 بحروف كبيرة، و**ملفان مخفيان** (`.js` و`.Telegram-sticker`) لم يُذكرا في أي تقرير سابق. **الإصلاح:** قائمة سماح في الخادم، و`scripts/normalize-manifest.js` نُفِّذ فعلياً: 11 إعادة تسمية + backfill للمخطط على 132 مدخلاً، مع حفظ الاسم القديم كـ alias ودعم فكّه في `_resolve.js` حتى لا تنكسر الروابط. |
| **APP-08** تكرار الواجهة وسينكات DOM | **مُغلق جزئياً** | **مؤكَّد:** `app_orig.js` نسخة قديمة (حُذفت)، و`user.html:81` كان `DOMPurify ? sanitize(raw) : raw` ⇒ **فشل مفتوح**: CDN محجوب = Stored XSS في README العضو. **الإصلاح:** `renderMarkdown()` مشترك **يفشل مُغلقاً**، وقائمة سماح صريحة للوسوم والسمات، ودوال تهريب **حسب السياق** (`esc`/`escUrl`/`escCss`). **ما يتبقّى:** توحيد مكوّنات الصفحات لم يُنفَّذ (تحسين صيانة، لا خطر مؤكَّد). |

---

## 4. عيوب اكتشفتها بنفسي (لم تُذكر في الخطة)

| # | العيب | الدليل | الإصلاح |
| --- | --- | --- | --- |
| **NEW-01** | **البلاغات كانت معطّلة كلياً.** `_report.js:62,86,105` تستدعي `scanForCurses(text)` **بلا `await`**، وهي `async` ⇒ الناتج Promise دائماً truthy ⇒ `blocked = true` دائماً عند تشغيل المرشّح. أي بلاغ كان يُرفض. | `api/_report.js` + `api/_interact.js:38` | أُضيف `await`، و`scripts/lint.js` يكتشف هذا النمط تحديداً (تحقّقت بإعادة إدخال العيب: اكتُشف في سطرين). |
| **NEW-02** | **حذف أكواد المحظور لم يكن ينفَّذ أبداً.** `_h/ban.js:53` ينادي `deleteFile('codes/'+name, msg)` **بلا `sha`**، وGitHub يرفض الحذف بـ 422، والخطأ يُلتهم في `catch`. الإدارة ترى «نجاح» والأكواد باقية. | `api/_h/ban.js:53,64` | `_gh.deleteFile` يجلب الـ sha بنفسه، والمعالج يُعيد `failed_deletions` الحقيقية. اختبار: «ban cleanup removes the stored files (the sha bug made this a no-op)». |
| **NEW-03** | **تعليقات مفصولة عن أكوادها.** `code.html` يأخذ اسم الملف من المسار، وVercel `cleanUrls` يحذف `.html` ⇒ 17 تعليقاً خُزِّن بـ `planet-earth` بينما الفهرس يقول `planet-earth.html`. التعليقات لم تظهر مرة أخرى. | `data/interactions.json` | التخزين يفكّ الاسم عبر الفهرس أولاً، و`scripts/normalize-interactions.js` أصلح 17 تعليقاً و3 إعجابات معلّقة. |
| **NEW-04** | **ثقب CSS injection في دالة كتبتها أنا.** النسخة الأولى من `escCss` كانت تحذف علامات التنصيص **بعد** تهريب HTML، فيبقى `&#39;` الذي يفكّه المتصفح قبل تحليل CSS ⇒ خروج من `url('…')`. | `app.js` | أُعيدت الكتابة لترفض القيمة أصلاً إن احتوت أي محرف يُنهي الوحدة، قبل التهريب. اكتشفه اختبار كتبته في الدورة نفسها. |
| **NEW-05** | **مفاتيح إعجاب مشوّهة تُنشئ أكواداً وهمية.** `recomputeTotals` كانت تستخدم `key.slice(key.indexOf('\|') + 1)`؛ ومفتاح بلا فاصل يُعيد `indexOf = -1` ⇒ `slice(0)` ⇒ يُحسب المفتاح كله اسمَ كود. | `api/_h/likes.js` | يُتحقَّق من وجود الفاصل. اختبار: «recomputeTotals ignores falsy and malformed keys». |
| **NEW-06** | **فحص تاريخ Git كان يُبلّغ «نظيف» زائفاً** في سكربتي: جمع كل الأنماط في تعبير `-E` واحد، وبعضها بصيغة Perl ⇒ `git grep` يفشل ⇒ `catch` واحد يلتهم كل الحلقة. | `scripts/scan-secrets.js` | كل قاعدة تُشغَّل وحدها بـ `-P` مع معالجة خطأ مستقلة. بعد الإصلاح: 5 نتائج حقيقية في التاريخ. |
| **NEW-07** | `data/interactions.json` يحتوي إعجابات لحساب `vex` **غير موجود** في `users.json`، تُضخّم المجاميع. | `data/interactions.json` | تُحذف في `normalize-interactions`، ويُبلّغ عنها `verify-data`. |
| **NEW-08** | ردّ المزوّد الخام كان يُعاد للعميل في `detail` عند فشل رفع الصورة — تسريب معلومات بنية داخلية. | `api/_h/upload-avatar.js:39` | يُسجَّل في الخادم فقط. |
| **NEW-09** | `api/_gh.js:46` يحتوي `if (false) { ... }` — شيفرة ميتة كانت معدّة لإعادة المحاولة عند التعارض ولم تُفعَّل قط. | `api/_gh.js` | أُزيلت، واستُبدلت بآلية التعارض الحقيقية في `updateJson`. |
| **NEW-10** | `setSessionCookie` و`google.js` كلاهما يستدعي `res.setHeader('Set-Cookie', …)`، فكان الثاني يمحو الأول في بعض المسارات. | `api/_auth.js` | `appendCookie()` يضيف بلا محو. |
| **NEW-11** | `api/image.js` المذكور في المهمة **غير موجود** في هذه النسخة؛ مسارات الصور كلها في `_h/upload-avatar.js`. | — | مسجَّل كفرق بين النسخة المفحوصة وقائمة المهمة. |
| **NEW-12** | **تبعية `nodemailer@6.10.1` تحمل سلسلة تنبيهات بشدة HIGH**: حقن أوامر SMTP، وحقن ترويسات عبر CRLF، وتجاوز التحقق من نطاق المستلم (IDN/punycode وتعليقات RFC 5322)، وحجب خدمة في `addressparser`. لم تذكرها الخطة لأن الفحص الثابت لا يقرأ قواعد التنبيهات. | `package.json` | **قُيِّم التوافق ثم رُقِّيت إلى `10.1.2`** (ترقية رئيسية). الواجهة المستخدمة في المشروع (`createTransport` + `sendMail`) دُقِّقت عبر `jsonTransport` بلا شبكة. وأُضيف `assertRecipient()` في `api/_mail.js` كطبقة دفاع لا تعتمد على محلّل المكتبة: عنوان واحد صريح فقط، ورفض CR/LF والفواصل والتعليقات والأقواس. النتيجة: `npm audit --omit=dev` ⇒ **0 vulnerabilities**. |
| **NEW-13** | **فحص الأسرار كان يُبلّغ عن نص توضيحي كأنه سرّ** (`postgres://user:pass@…` في رسالة مساعدة). إبلاغ زائف يُفقد الفحص قيمته. | `scripts/scan-secrets.js`، `scripts/migrate.js` | القاعدة تستثني النصوص النائبة (`<…>`, `***`, `REPLACE…`)، والمثال استُبدل بأقواس زاوية. **تحقّقت بشاهد موجب:** ملف يحتوي رابطَي اتصال حقيقيَّين ⇒ اكتُشفا بشدة HIGH. |

---

## 5. الميزات المنفَّذة من القسم 7 من الخطة

نُفِّذت **بعد** إغلاق المخاطر الحرجة والعالية، لا قبلها.

| الميزة (مرجع الخطة) | الحالة | الملفات |
| --- | --- | --- |
| نظام حالات Draft/Pending/Approved/Rejected + سبب الرفض + سجل قرارات (7.1 P0) | **منفَّذ** | `api/_moderation.js`، `_h/submit.js`، `_h/approve.js`، `_h/reject.js`، `_h/moderation-log.js` |
| بحث عربي/إنجليزي مع تطبيع الهمزات والتشكيل والمسافات والأرقام (7.1 P0) | **منفَّذ** | `api/_search.js`، `_h/search.js`، `search.html` |
| فلاتر اللغة والوسوم والترخيص والمؤلف + ترقيم حقيقي + اقتراحات عند الفراغ (7.1 P0) | **منفَّذ** | نفس الملفات |
| صفحة كود بوصف وترخيص ووسوم وتاريخ ومعاينة معزولة (7.1 P0) | **منفَّذ جزئياً** | `code.html`، `_content.js` — الترخيص والوسوم مخزَّنة ومعروضة؛ «متطلبات التشغيل» لم تُضَف كحقل |
| بطاقة جودة قبل النشر (7.2.ج) | **منفَّذ** | `api/_content.js` (`qualityCard`)، `_h/quality-check.js` |
| كشف الأسرار في المساهمات قبل النشر | **منفَّذ** | `_content.js` (`scanForSecrets`) — 8 أنماط، والنتيجة معرّف لا قيمة |
| checksum وحالة فحص للحزم + عدّاد تنزيلات (7.1 P2) | **منفَّذ للجديد** | `_h/zips.js` — SHA-256 وحالة الفحص تُخزَّنان؛ **11 حزمة قديمة بلا checksum** (مُبلَّغ عنها) |
| سجل تدقيق لكل قرار إشراف (5.2) | **منفَّذ** | `api/_moderation.js`، `data/moderation_log.json` |
| health check لا يكشف الإعدادات + مراقبة (9.2) | **منفَّذ** | `api/_h/health.js` |
| مجموعات وحفظ عام/خاص (7.1 P1) | **المخطط جاهز، الواجهة لا** | `migrations/001` (`collections`, `collection_items`) |
| مقارنة الإصدارات والتراجع (7.1 P1) | **المخطط جاهز، الواجهة لا** | `migrations/001` (`code_versions`) |
| مساعد عربي لشرح الكود (7.2.ب) | **لم يُنفَّذ** | يحتاج قراراً على مزوّد نموذج + موافقة صريحة قبل إرسال أي كود خاص |
| مختبر تشغيل آمن (7.2.أ) | **لم يُنفَّذ** | يحتاج بنية containers معزولة ومراجعة أمنية — والخطة نفسها تضعه آخر المراحل |
| مسارات تعلّم (7.2.د) | **لم يُنفَّذ** | عمل محتوى، لا شيفرة |

---

## 6. ما يحتاج صلاحيات أو إعدادات إنتاجية

| # | الإجراء | من يملكه | ما أنجزته برمجياً |
| --- | --- | --- | --- |
| 1 | **تدوير `JWT_SECRET`** بقيمة عشوائية ≥ 32 | مالك مشروع Vercel | الشيفرة ترفض العمل في الإنتاج بدونه وترفض `change-me`. التوقّع: تسجيل دخول جديد لكل الأعضاء (الجلسات أُبطلت أصلاً عبر `session_version`). |
| 2 | **تدوير مفتاح الرفع** لدى المزوّد وضبط `UPLOADS_API_KEY` | مالك حساب المزوّد | أُزيل المفتاح من الشيفرة؛ غيابه يُرجع `503`. **المفتاح القديم ما زال في تاريخ Git ويجب اعتباره منكشفاً — لم أُلغِه.** |
| 3 | **قرار إعادة كتابة تاريخ Git** + إشعار المتأثرين | مالك المستودع | `scan-secrets --history` يبلّغ عن 5 نتائج. الخيارات: `git filter-repo` + إعادة كتابة منسّقة، أو اعتبار كل القيم منكشفة والاعتماد على التدوير. |
| 4 | **تجهيز PostgreSQL مُدارة** + تخزين كائنات، وتنفيذ الترحيل | Ops | مخطط كامل + مهاجرات + مستورد idempotent + تقرير مطابقة + خطة rollback. **لم يُطبَّق على قاعدة حقيقية.** |
| 5 | **ضبط `UNTRUSTED_CONTENT_ORIGIN`** على نطاق مستقل | مالك النطاق | الإعداد يرفض نطاقاً مساوياً لنطاق المنصة. حتى تجهيزه: لا تنفيذ على الإطلاق. |
| 6 | **ضبط `UPSTASH_REDIS_REST_URL/TOKEN`** | Ops | الواجهة الخلفية مُنفَّذة؛ `/api/health` يُظهر `rate_limit_distributed: false`. |
| 7 | **خدمة فحص برمجيات خبيثة** للأرشيفات | Ops | المنفَّذ: بصمات + بنية ZIP + منع zip-slip وbombs. الحالة تُخزَّن كـ `signature-only` بصدق. |
| 8 | **تقييم الحاجة لإشعار المستخدمين** بحادث البيانات | مالك المنصة + قانوني | المعطيات: 192 سجلاً، 33 رمز تفعيل قابل للاستخدام، 32 رقم هاتف، كلها في ملف متتبَّع في Git. |
| 9 | **تنفيذ `ADMIN_EMAIL`** الحقيقي في إعدادات المنصة | Ops | القيمة الافتراضية أُزيلت؛ غيابها يوقف الخدمة. |
| 10 | **اختبار دوري للاستعادة** | Ops | `backup-data.js` + `verify-data.js --dir` + RPO/RTO مقترحة في README. |

---

## 7. نتائج الاختبارات الحقيقية

### الأوامر المشغَّلة

```
$ npm test
# tests 418
# pass 415
# fail 0
# skipped 3

$ npm run lint
[lint] 89 JS file(s), 13 page(s) checked
[lint] codes/ skipped on purpose: user-submitted files are untrusted data
[lint] no problems found

$ npm run verify:data
users: 192 | codes: 132 | executable: 18 | comments: 23 | likes: 8
reports: 5 | bans: 1 | zips: 11 | delete_requests: 3 | messages: 1
[verify-data] 14 warning(s)
[verify-data] all invariants hold

$ npm run secrets:scan
[scan-secrets] clean

$ node scripts/scan-secrets.js --history
findings in git history: 5   (مفتاح الرفع ×2، قيم احتياطية غير آمنة ×3)

$ npm audit --omit=dev --audit-level=high
found 0 vulnerabilities      (كانت: 1 high في nodemailer@6.10.1)

$ node scripts/migrate.js --dry-run
would apply 001_initial_schema.sql (428 lines)
  rollback: 001_initial_schema.down.sql
[migrate] dry run only — no database connection was made

$ node scripts/import-json-to-pg.js --plan
users 192→192 | codes 132→132 | code_likes 8→8 | packages 11→11 | reports 5→5
comments 23→20 | delete_requests 3→1 | bans 2→1
skipped rows: 5  (كلها بسبب أكواد محذوفة — مُفصَّلة بالاسم والسبب)
```

### الاختبارات المتوقّفة (3) وسببها

| الاختبار | السبب |
| --- | --- |
| live schema apply + rollback | يحتاج `DATABASE_URL`. تطبيق DDL على مخزن وهمي لا يُثبت شيئاً، فلم أُحاكِه. |
| live concurrent-write transaction test | يحتاج محرّك حقيقي لإثبات التسلسل المعاملاتي. |
| live backup and restore drill | يحتاج `pg_dump` وقاعدة معزولة. |

### تحذيرات `verify-data` المتبقية (14) — كلها معروفة ومقصودة

* **3 تعليقات** على أكواد حُذفت فعلاً (`eaht.js`، `code.txt` ×2). التعليقات
  **محتوى كتبه أعضاء**، فلم أحذفها؛ المستورد يتخطّاها بسبب معلن.
* **11 حزمة** بلا checksum: نُشرت قبل وجود الميزة. لا يمكن حساب البصمة بلا
  تنزيل الملفات من المزوّد (يحتاج صلاحية). الحزم الجديدة تُخزَّن بـ SHA-256.

---

## 8. جرد التغييرات

**118 ملفاً تغيّر**: 70 معدَّل، 38 جديد، 3 محذوف، 11 معاد التسمية (داخل
`codes/`، بلا تغيير محتوى).

### وحدات جديدة في `api/`

| الملف | الدور |
| --- | --- |
| `_config.js` | مصدر الإعداد الوحيد + تحقق عند التشغيل + فشل مُغلق |
| `_http.js` | حدود الجسم، نوع المحتوى، CSRF/Origin، أخطاء موحّدة، `request-id` |
| `_guard.js` | طبقة الهوية/الحظر/الصلاحيات/الملكية الوحيدة |
| `_tokens.js` | رموز مجزّأة منتهية تُستخدم مرة واحدة |
| `_lockout.js` | قفل تدريجي للحساب |
| `_ratelimit.js` | 22 سياسة، Upstash أو احتياطي معلَن |
| `_content.js` | قوائم السماح، أسماء الملفات، البصمات، ZIP، كشف الأسرار، بطاقة الجودة |
| `_search.js` | تطبيع عربي + ترتيب + ترقيم + اقتراحات |
| `_moderation.js` | حالات النشر + سجل التدقيق |
| `_google_verify.js` | تحقق ID token عبر JWKS |
| `_uploads.js` | عميل الرفع بلا مفاتيح مضمّنة |
| `_page.js` | صفحة تأكيد مشتركة (كانت مكرّرة في معالجَين) |

### مسارات جديدة (6)

`likes`، `resend-verification`، `quality-check`، `moderation-log`، `health`،
`sitemap`.

### ملفات محذوفة

`app_orig.js` (نسخة قديمة تدرّج بعيداً عن `app.js`)،
`pnpm-lock.yaml` (ملف قفل ثانٍ)،
`sitemap.xml` (كان سيحجب الديناميكي).

### ملفات التسليم

| الملف | المحتوى |
| --- | --- |
| `AUDIT_FINAL_ARAB_CODE.md` | هذا التقرير |
| `AUDIT_REQUIREMENTS.md` | مصفوفة كل بنود الخطة ← ملفات ← إصلاح ← اختبار ← حالة |
| `.env.example` | أسماء المتغيرات فقط |
| `README.md` | الإعداد والتشغيل والاختبار والنشر والترحيل |
| `.vercelignore`, `.nvmrc`, `.github/workflows/ci.yml` | النشر وCI |
| `migrations/` (2) | المخطط والتراجع |
| `scripts/` (9) | lint، verify-data، scan-secrets، backup، revoke-tokens، normalize ×2، migrate، import، reconcile |
| `tests/` (14 + harness) | 315 حالة اختبار |

---

## 9. المخاطر المتبقية المعروفة

| # | الخطر | الشدة | الوضع |
| --- | --- | --- | --- |
| R-1 | المفاتيح والرموز المكشوفة لا تزال في تاريخ Git | **عالٍ** | يحتاج قراراً تشغيلياً (بند 3 أعلاه) |
| R-2 | بيانات الهوية ما زالت في مستودع Git (غير منشورة، لكن موجودة) | **عالٍ** | يُغلق بالترحيل (بند 4) |
| R-3 | حدود الطلبات غير موزّعة بلا Upstash | متوسط | القفل على مستوى الحساب موزّع؛ الحالة معلنة في `/api/health` |
| R-4 | CSP تسمح `'unsafe-inline'` للسكربتات | متوسط | مرحلة أولى؛ العزل الحقيقي ليس CSP |
| R-5 | فحص الأرشيفات بالبصمة والبنية فقط | متوسط | يحتاج خدمة فحص (بند 7) |
| R-6 | 11 حزمة قديمة بلا checksum | منخفض | لا يمكن حسابها بلا تنزيلها |
| R-7 | تكرار JavaScript بين الصفحات | منخفض | صيانة، لا خطر مؤكَّد |
| R-8 | 3 تعليقات معلّقة على أكواد محذوفة | منخفض | مقصود: لا تُحذف مساهمات الأعضاء |
| R-9 | `UNTRUSTED_CONTENT_ORIGIN` غير مجهَّز | منخفض الآن | النموذج الحالي (لا تنفيذ) أكثر تحفّظاً |
| R-10 | ترقية `nodemailer` إلى 10.x ترقية رئيسية | منخفض | الواجهة المستخدمة مُغطّاة بـ 15 اختباراً على المكتبة الحقيقية؛ يبقى **اختبار إرسال فعلي واحد على staging** قبل الإنتاج (يحتاج بيانات SMTP) |

---

## 10. شرط الإطلاق التالي

الخطة تشترط: «يجب إغلاق النتائج SEC-01 إلى SEC-07 واختبارها على بيئة Staging، ثم
توثيق أدلة الإصلاح، قبل العودة إلى النشر التلقائي العام».

| الشرط | الحالة |
| --- | --- |
| SEC-01 إلى SEC-07 مُغلقة برمجياً ومُختبَرة | **نعم** — 415 اختبار ناجح |
| أدلة الإصلاح موثّقة | **نعم** — هذا التقرير + مصفوفة المتطلبات |
| اختبار على Staging | **لا** — لا توجد بيئة staging في هذه الدورة |
| تدوير المفاتيح | **لا** — يحتاج صلاحيات المزوّدين |

**الخلاصة:** الشيفرة والإعدادات جاهزة للنشر على staging. **لا يُنصح بالعودة إلى
النشر التلقائي العام قبل تنفيذ البنود 1 و2 و3 من القسم 6** (تدوير `JWT_SECRET`،
تدوير مفتاح الرفع، وقرار تاريخ Git). النشر التلقائي للمحتوى القابل للتنفيذ
مُلغى في الشيفرة نفسها، فلا يعتمد على إعداد يمكن تغييره من لوحة الإدارة.
