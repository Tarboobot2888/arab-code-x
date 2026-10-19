# مصفوفة المتطلبات — خطة تطوير ARAB code

تربط كل بند من وثيقة `خطة_تطوير_ARAB_code.docx` (الإصدار 1.0) بالملفات المعنية
والإصلاح المنفَّذ والاختبار الذي يُثبته وحالته.

**الحالات:** ✅ منفَّذ ومُختبَر · ⚠️ منفَّذ جزئياً (السبب مذكور) ·
🔒 يحتاج صلاحيات تشغيلية · ⬜ لم يُنفَّذ (السبب مذكور)

**الحصيلة:** 118 بنداً — ✅ 88 · ⚠️ 12 · 🔒 10 · ⬜ 8

**الاختبارات:** 418 حالة — 415 ناجحة، 0 فاشلة، 3 متوقّفة (تحتاج `DATABASE_URL`).

---

## القسم 1 — الملخص التنفيذي: أهم خمس أولويات

| # | بند الخطة | الملفات | الإصلاح | الاختبار | الحالة |
| --- | --- | --- | --- | --- | --- |
| 1.1 | احتواء انكشاف بيانات شخصية ورموز تحقق في `data/users.json`؛ الرمز يمكنه تفعيل حساب لأن `verify` لا يفرض انتهاء | `api/_tokens.js`، `api/_h/verify.js`، `scripts/revoke-legacy-tokens.js`، `.vercelignore`، `vercel.json` | رموز مجزّأة بانتهاء إلزامي واستخدام واحد؛ أُبطلت 33+12 رمزاً فعلياً؛ `data/` غير منشور | `tests/tokens.test.js` (24)، `tests/data-schema.test.js`، `tests/auth-flows.test.js` "a legacy no-expiry verification token is refused" | ✅ |
| 1.2 | منع تنفيذ HTML مرفوع على نطاق المنصة؛ المعاينة معزولة فعلياً | `.vercelignore`، `vercel.json`، `api/_h/raw.js`، `api/_h/submit.js`، `code.html` | `codes/` غير منشور ومحجوب؛ تقديم خامل؛ المحتوى القابل للتنفيذ يخضع للمراجعة دائماً؛ sandbox بلا same-origin | `tests/content-security.test.js`، `tests/deploy-seo.test.js` | ✅ |
| 1.3 | إلغاء مفاتيح الرفع المكتوبة في الشيفرة وفرض `JWT_SECRET` قوي وإيقاف الخدمة عند غيابه | `api/_config.js`، `api/_uploads.js` | أُزيلت كل القيم الاحتياطية؛ الإنتاج يرفض العمل بإعداد ناقص | `tests/ratelimit-config.test.js`، `tests/uploads.test.js` "no provider key appears anywhere in the source" | ✅ (التدوير: 🔒) |
| 1.4 | فرض الحظر والصلاحيات وحدود الطلبات في الخادم | `api/_guard.js`، `api/_ratelimit.js`، `api/_lockout.js` | بوابة تفويض واحدة؛ 22 سياسة حدود | `tests/authz.test.js` (95) | ✅ |
| 1.5 | استبدال ملفات JSON بقاعدة معاملاتيّة وتخزين ملفات مستقل | `migrations/`، `scripts/migrate.js`، `scripts/import-json-to-pg.js`، `api/_gh.js` | مخطط + مهاجرات + مستورد + مطابقة؛ `updateJson` معاملاتي للمخزن الحالي | `tests/migration.test.js` (24+3 متوقّفة)، `tests/concurrency.test.js` (13) | ⚠️ البنية جاهزة، الترحيل لم يُنفَّذ (لا `DATABASE_URL`) |

---

## القسم 4.1 — نتائج حرجة (P0)

| ID | بند الخطة | الملفات | الإصلاح | الاختبار | الحالة |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | 187 سجلاً مع `password_hash` وهاتف و33 `verification_token`؛ `.gitignore` لا يستثني `data`؛ `verify.js` بلا فحص انتهاء | `api/_tokens.js`، `_h/verify.js`، `_h/resend-verification.js`، `scripts/revoke-legacy-tokens.js` | تجزئة + انتهاء + استخدام واحد؛ سجل بلا انتهاء يُعامل منتهياً؛ 192 جلسة دُوِّرت | `tests/tokens.test.js`، `tests/data-schema.test.js` | ✅ |
| SEC-01a | افصل بيانات الهوية عن Git | `migrations/001`، `scripts/` | مخطط DB جاهز؛ `data/` غير منشور | `tests/migration.test.js` | ⚠️ يُغلق بالترحيل |
| SEC-01b | عطّل/أبطل الرموز الحالية | `scripts/revoke-legacy-tokens.js` | نُفِّذ: 33 + 12 أُبطلت | `tests/data-schema.test.js` "no plaintext token remains" | ✅ |
| SEC-01c | افحص `/data/*` علناً | — | **لم يُنفَّذ: لا بيئة حيّة.** الحجب مُثبَت على مستوى الإعداد | `tests/deploy-seo.test.js` | 🔒 |
| SEC-01d | راجع تاريخ Git وأشعِر المتأثرين | `scripts/scan-secrets.js --history` | الفحص يبلّغ عن 5 نتائج؛ القرار للمالك | — | 🔒 |
| SEC-02 | `submit.js` يأخذ الامتداد من `language`؛ `auto_approve=true`، `filter_enabled=false`؛ `codes` عام | `api/_content.js`، `_h/submit.js`، `_h/raw.js`، `.vercelignore`، `vercel.json`، `data/settings.json` | قائمة سماح في الخادم؛ مراجعة إلزامية للتنفيذي؛ عزل نشري؛ إعدادات آمنة | `tests/content-security.test.js` | ✅ |
| SEC-02a | عزل في نطاق منفصل بلا Cookie | `api/_config.js` (`UNTRUSTED_CONTENT_ORIGIN`) | الإعداد يرفض نطاقاً مساوياً؛ النموذج الحالي: لا تنفيذ إطلاقاً | `tests/ratelimit-config.test.js` | ⚠️ النطاق غير مجهَّز |
| SEC-03 | مفتاح مزوّد كقيمة احتياطية في `upload-avatar.js:5` و`zips.js` | `api/_uploads.js`، `api/_config.js` | بلا قيمة افتراضية؛ `503` عند الغياب | `tests/uploads.test.js` | ✅ |
| SEC-03a | ألغِ المفتاح الحالي ودوّره لدى المزوّد | — | **لا صلاحية؛ لم أُلغِه** | — | 🔒 |

---

## القسم 4.2 — نتائج عالية (P1)

| ID | بند الخطة | الملفات | الإصلاح | الاختبار | الحالة |
| --- | --- | --- | --- | --- | --- |
| SEC-04 | `SECRET = process.env.JWT_SECRET \|\| "change-me"` | `api/_config.js`، `api/_auth.js` | إلزامي ≥32 في الإنتاج؛ `change-me` مرفوض دائماً؛ مفتاح تطوير مؤقت | `tests/ratelimit-config.test.js` | ✅ |
| SEC-04a | دوّر المفتاح لإبطال الجلسات القديمة | `api/_auth.js` (`session_version`) | التدوير مُنفَّذ برمجياً (192 جلسة)؛ تدوير المتغيّر 🔒 | `tests/authz.test.js` "a session whose version is stale is rejected" | ✅ / 🔒 |
| SEC-05 | الحظر في `bans.json` و`currentUser` لا يفحصه؛ `submit`/`comments` لا يرفضان المحظور؛ فحص `u.banned` في `zips` غير مرتبط | `api/_guard.js` وكل `_h/` | بوابة واحدة؛ `bans.json` مصدر الحقيقة؛ فشل مُغلق | `tests/authz.test.js` | ✅ |
| SEC-05a | مصفوفة اختبار للأدوار الستة | `tests/authz.test.js` | 95 حالة لكل الأدوار والمسارات | — | ✅ |
| SEC-05b | المحظور لا يتجاوز المنع باستدعاء API مباشرة | `api/_guard.js` | مُثبَت لكل مسار كتابة | `tests/authz.test.js` "banned member is refused even calling the API directly" | ✅ |
| SEC-06 | `decodeIdToken` بلا تحقق من التوقيع/issuer/audience/nonce؛ `email_verified !== false` | `api/_google_verify.js`، `_h/google.js` | JWKS + RS256 + iss/aud/exp + nonce + `=== true` | `tests/oauth-google.test.js` (23) | ✅ |
| SEC-06a | راجع `state` وحماية callback من CSRF | `api/_h/google.js` | `state` في ملف ارتباط HttpOnly + مقارنة بزمن ثابت | `tests/oauth-google.test.js` | ✅ |
| SEC-07 | Turnstile يُرجع `skipped` بلا سر؛ `forgot-password` بلا حماية | `api/_turnstile.js`، `_h/forgot-password.js` | فشل مُغلق في الإنتاج؛ Turnstile + حدود على المسار | `tests/ratelimit-config.test.js` | ✅ |
| SEC-07a | وثّق كل المتغيرات | `.env.example`، `README.md` | 20 متغيّراً موثّقاً | `tests/deploy-seo.test.js` ".env.example lists the required variables" | ✅ |
| SEC-07b | rate limiting موزّع + قفل مؤقت | `api/_ratelimit.js`، `_lockout.js` | Upstash + قفل مُخزَّن؛ الحالة معلنة | `tests/ratelimit-config.test.js`، `tests/auth-flows.test.js` | ⚠️ يحتاج `UPSTASH_*` |
| SEC-08 | `_gh.js:115-123` يعيد قراءة SHA ثم يكتب كائناً قديماً | `api/_gh.js` (`updateJson`) | إعادة تطبيق الدالة المعدِّلة على المحتوى الأحدث | `tests/concurrency.test.js` (13) | ✅ |
| SEC-09 | `readBody` بلا حدّ؛ `upload-avatar` يفحص الحجم بعد القراءة | `api/_http.js` | حدّ أثناء البثّ؛ 400/413/415؛ حدود لكل مسار | `tests/http-limits.test.js` (17) | ✅ |
| SEC-10 | كلمة مرور مولَّدة تُرسل بالبريد | `api/_h/google.js`، `_mail.js` | حساب جوجل بلا كلمة سر؛ لا إرسال بيانات اعتماد | `tests/oauth-google.test.js` | ✅ |
| SEC-11 | لا رؤوس CSP/nosniff/Referrer/Permissions | `vercel.json` | 7 رؤوس أمنية؛ `no-store`+`noindex` للإدارة | `tests/deploy-seo.test.js` | ✅ |
| SEC-11a | اختبر توافق الرؤوس مع CDN وCodeMirror | `tests/deploy-seo.test.js` | اختبار يستخرج مصادر الموارد الفعلية ويطابقها مع CSP | — | ✅ |
| SEC-11b | يجب ألا تسمح السياسة بتنفيذ HTML غير موثوق على أصل المنصة | `.vercelignore`، `vercel.json` | العزل نشري لا بـ CSP | `tests/deploy-seo.test.js` | ✅ |

---

## القسم 4.3 — نتائج متوسطة ومنخفضة (P2/P3)

| ID | بند الخطة | الملفات | الإصلاح | الاختبار | الحالة |
| --- | --- | --- | --- | --- | --- |
| APP-01 | `popular.html` يطلب `/api/likes` غير المسجَّل | `api/_h/likes.js`، `api/index.js`، `popular.html` | مسار كامل؛ تفرّد بنيوي `(user, code)`؛ مجاميع محسوبة | `tests/features.test.js` (8) | ✅ |
| APP-02 | `stats.js` يقرأ ملفات غير موجودة؛ `new_codes_week` من `published_at` | `api/_h/stats.js`، `scripts/normalize-manifest.js` | المصادر الصحيحة؛ قبول الحقلَين؛ backfill | `tests/features.test.js` "stats reads the real sources and the real timestamp field" | ✅ |
| APP-03 | `app.js` يمنح شارة الإدارة لـ `username=ziad` | `app.js`، `api/_enrich.js` | شارات من الخادم فقط؛ إسقاط شارة المؤلف غير الموجود | `tests/features.test.js` (3) | ✅ |
| APP-04 | `sitemap.xml` يضم `/search` غير الموجود ولا يضم صفحات المحتوى | `search.html`، `api/_h/sitemap.js` | صفحة بحث كاملة؛ sitemap ديناميكي بـ lastmod | `tests/deploy-seo.test.js` (6) | ✅ |
| APP-05 | `PUBLIC_BASE_URL` مختلف عن canonical؛ fallback domain قديم؛ متغيرات غير موثّقة | `api/_config.js`، `_report.js`، `_h/ban.js`، `_mail.js`، `README.md` | config واحد؛ أُزيلت كل القيم القديمة | `tests/deploy-seo.test.js` "no stale fallback domain or support address" | ✅ |
| APP-06 | ملفا قفل؛ لا scripts؛ لا CI | `package.json`، `.nvmrc`، `.github/workflows/ci.yml` | npm فقط؛ Node 22 مثبّت؛ 12 script؛ CI بوظيفتَين | `tests/deploy-seo.test.js` (5) | ✅ |
| APP-07 | أسماء بلا امتدادات؛ ZIP بالامتداد فقط بلا فحص | `api/_content.js`، `scripts/normalize-manifest.js`، `_h/zips.js` | قائمة سماح؛ 11 إعادة تسمية + aliases؛ بصمات + ZIP + SHA-256 | `tests/content-security.test.js`، `tests/uploads.test.js` (22) | ✅ |
| APP-08 | `app_orig.js` قديم؛ تكرار JS؛ `innerHTML` يدوي | `app.js`، `user.html`، `zip-item.html`، `zips.html` | حُذف `app_orig.js`؛ تهريب حسب السياق؛ markdown يفشل مُغلقاً | `tests/content-security.test.js` (4) | ⚠️ توحيد المكوّنات لم يُنفَّذ |
| APP-09 | fallbacks متباينة؛ `e.message` يُعاد للعميل | `api/_http.js`، `api/_config.js` | أخطاء موحّدة + `request-id`؛ التفاصيل في سجل الخادم | `tests/http-limits.test.js` (3) | ✅ |

---

## القسم 5 — الرؤية المعمارية

| البند | الملفات | الحالة | ملاحظة |
| --- | --- | --- | --- |
| 5.1 واجهة/CDN: لا أسرار ولا بيانات خاصة في build | `.vercelignore` | ✅ | |
| 5.1 middleware: جلسة، صلاحيات، حظر، CSRF، معدل، مخطط | `api/_guard.js`، `_http.js`، `_ratelimit.js` | ✅ | |
| 5.1 رفض افتراضي + `request-id` + حدود + أخطاء موحّدة + فحص Origin | `api/_http.js` | ✅ | |
| 5.1 خدمات مجال منفصلة | `api/_h/` | ⚠️ | التجميع بالمسار لا بالمجال؛ قيد Vercel على عدد الدوال |
| 5.1 PostgreSQL مُدارة | `migrations/001` | ⚠️ | المخطط جاهز، غير مطبَّق |
| 5.1 تخزين كائنات عام/خاص + SHA-256 + MIME من المحتوى + signed URLs | `api/_content.js`، `_uploads.js`، `migrations/001` (`upload_assets`) | ⚠️ | البصمات والMIME مُنفَّذان؛ تخزين الكائنات الخاص 🔒 |
| 5.1 Queue + workers (بريد، فحص، idempotency، DLQ) | `migrations/001` (`mail_outbox`) | ⬜ | المخطط جاهز؛ العامل لم يُنفَّذ (يحتاج بنية) |
| 5.1 Observability + تدقيق الإدارة + إخفاء البيانات الحساسة | `api/_moderation.js`، `_h/health.js`، `_http.js` | ⚠️ | السجلات والتدقيق مُنفَّذان؛ APM خارجي 🔒 |
| 5.2 `User`: حقول خاصة منفصلة | `migrations/001` (`users`, `user_profiles`, `user_private_contacts`) | ✅ | |
| 5.2 `Code`: slug، owner، license، moderation_status، visibility، current_version | `migrations/001` (`codes`) | ✅ | |
| 5.2 `CodeVersion`: checksum، change_summary، يدعم المقارنة والإرجاع | `migrations/001` (`code_versions`) | ⚠️ | المخطط جاهز؛ الواجهة لم تُنفَّذ |
| 5.2 `Tags` / `Collections` | `migrations/001` | ⚠️ | المخطط جاهز؛ الواجهة لم تُنفَّذ |
| 5.2 `Comment`/`Reaction`/`Report` + حدود طول + حذف منطقي | `migrations/001` | ✅ | |
| 5.2 `ModerationCase`/`AuditLog` | `api/_moderation.js`، `migrations/001` (`audit_log`) | ✅ | |
| 5.2 `UploadAsset`: object_key، sha256، scan_status، expiry | `migrations/001` | ✅ | |
| 5.2 `AppSetting`/`Outbox` | `migrations/001` | ✅ | المخطط |
| 5.3 جلسات قابلة للإبطال + تدوير بعد تغييرات حسّاسة | `api/_auth.js` | ✅ | |
| 5.3 رمز استعادة/تفعيل كـ hash بانتهاء ومحاولة واحدة | `api/_tokens.js` | ✅ | |
| 5.3 أدوار مُدارة | `api/_guard.js`، `migrations/001` (`user_role`) | ⚠️ | admin/member فعليان؛ moderator في المخطط فقط |
| 5.3 MFA لحسابات الإدارة | — | ⬜ | يحتاج قراراً على مزوّد TOTP/WebAuthn |
| 5.3 سجل تدقيق لكل حظر/حذف/تغيير إعداد | `api/_moderation.js` | ✅ | |
| 5.3 عدم تقديم HTML المرفوع على أصل التطبيق + sandbox بلا same-origin + CSP | `.vercelignore`، `vercel.json`، `code.html` | ✅ | |
| 5.3 Turnstile يفشل مُغلقاً + حدود حسب المستخدم وIP | `api/_turnstile.js`، `_ratelimit.js` | ✅ | |
| 5.3 أسرار الإنتاج خارج المستودع + منع طباعتها | `api/_config.js`، `scripts/scan-secrets.js` | ✅ | |
| 5.3 اختبار استعادة دوري + RPO/RTO | `scripts/backup-data.js`، `README.md` | ⚠️ | الأدوات والخطة جاهزة؛ التنفيذ 🔒 |

---

## القسم 6 — خارطة الطريق

### 6.1 أول 48 ساعة

| # | البند | الحالة | الدليل |
| --- | --- | --- | --- |
| 1 | تأكّد: هل المستودع عام؟ هل `/data/users.json` قابل للتنزيل؟ | 🔒 | يحتاج وصولاً للنطاق وإعدادات المستودع |
| 2 | تعطيل `auto_approve` ونشر HTML؛ كل محتوى جديد Pending | ✅ | `data/settings.json` + سياسة في `_h/submit.js` + اختبار |
| 3 | إبطال رموز التفعيل + إضافة expiry وone-time-use | ✅ | `scripts/revoke-legacy-tokens.js` نُفِّذ؛ `api/_tokens.js` |
| 4 | إلغاء مفتاح الرفع وتوليد جديد وحذفه من التاريخ | ⚠️ / 🔒 | أُزيل من الشيفرة؛ التدوير والتاريخ يحتاجان صلاحيات |
| 5 | `JWT_SECRET` قوي + إزالة fallback | ✅ / 🔒 | الـ fallback أُزيل؛ الضبط يحتاج صلاحية |
| 6 | قاعدة تمنع نشر أي ملف تنفيذي على أصل التطبيق | ✅ | `.vercelignore` + `redirects` + `_h/raw.js` + اختبارات |
| 7 | افحص السجلات والـ commits بحثاً عن استخدام غير متوقع | ⚠️ | `scan-secrets --history` مُنفَّذ؛ سجلات المزوّد 🔒 |

### 6.2 خطة الترحيل

| # | البند | الحالة | الملف |
| --- | --- | --- | --- |
| 1 | جمّد مخطط كل ملف JSON وأنشئ جداول مكافئة بقيود | ✅ | `migrations/001_initial_schema.sql` |
| 2 | importer idempotent + تقرير سجلات/تكرار/حقول غير صالحة | ✅ | `scripts/import-json-to-pg.js` |
| 3 | اختبر على staging مع بيانات منزوعة الحساسية وقارن النتائج | 🔒 | `--plan` و`reconcile` يعملان بلا قاعدة |
| 4 | الكتابة أولاً ثم القراءة؛ تجنّب dual-write | ⬜ | **لا dual-write حالياً** — مصدر الحقيقة ملفات `data/` فقط |
| 5 | امنع الكتابة إلى Git بعد التحول + rollback | ⚠️ | `rollback` جاهز؛ المنع بعد نجاح الترحيل |

### المراحل 0–6

| المرحلة | الحالة | ملاحظة |
| --- | --- | --- |
| 0. احتواء المخاطر | ✅ برمجياً | 3 بنود تحتاج صلاحيات |
| 1. تحصين الخدمة | ✅ | كل بنودها منفَّذة ومُختبَرة |
| 2. تثبيت البيانات | ⚠️ | البنية جاهزة، التنفيذ 🔒 |
| 3. جودة النشر والمحتوى | ✅ | حالات + فحوص + تراخيص + إعجابات + إحصاءات |
| 4. تجربة المستخدم وSEO | ⚠️ | بحث وsitemap وcanonical ووصولية ✅؛ توحيد المكوّنات ⬜ |
| 5. المجتمع والتميّز | ⬜ | المخطط جاهز للمجموعات؛ السمعة وonboarding لم تُنفَّذ |
| 6. ميزات متقدمة | ⬜ | المختبر والمساعد يحتاجان بنية وقراراً |

---

## القسم 7 — التطوير الوظيفي والإبداعي

| البند | الملفات | الاختبار | الحالة |
| --- | --- | --- | --- |
| 7.1 P0 نشر آمن: Draft→Pending→Approved/Rejected + سبب الرفض + إشعار + سجل قرار | `api/_moderation.js`، `_h/submit.js`، `_h/approve.js`، `_h/reject.js` | `tests/features.test.js`، `tests/content-security.test.js` | ✅ |
| 7.1 P0 بحث فعلي: عربي/إنجليزي، تطبيع، فلاتر، نتائج فارغة مفيدة | `api/_search.js`، `_h/search.js`، `search.html` | `tests/features.test.js` (8) | ✅ |
| 7.1 P0 صفحة كود: عنوان، وصف، وسوم، لغة، ترخيص، إصدار، تاريخ | `code.html`، `api/_content.js` | `tests/deploy-seo.test.js` | ⚠️ «متطلبات التشغيل» غير مُنفَّذة كحقل |
| 7.1 P1 الإصدارات والمقارنة والإرجاع | `migrations/001` (`code_versions`) | `tests/migration.test.js` | ⬜ المخطط فقط |
| 7.1 P1 المجموعات والحفظ | `migrations/001` (`collections`) | `tests/migration.test.js` | ⬜ المخطط فقط |
| 7.1 P1 مصداقية المجتمع والسمعة | — | — | ⬜ يحتاج قراراً على معايير |
| 7.1 P2 الحزم: checksum، وصف، صور مصغّرة، عدّاد تنزيلات محمي | `api/_h/zips.js`، `migrations/001` (`package_downloads`) | `tests/uploads.test.js` | ⚠️ checksum وحالة الفحص ✅ للجديد؛ العدّاد في المخطط |
| 7.2 أ مختبر تشغيل معزول | — | — | ⬜ يحتاج بنية containers + مراجعة أمنية |
| 7.2 ب مساعد عربي لشرح الكود | — | — | ⬜ يحتاج قراراً على مزوّد + موافقة صريحة |
| 7.2 ج بطاقة جودة قبل النشر | `api/_content.js`، `_h/quality-check.js` | `tests/features.test.js` (4) | ✅ |
| 7.2 د مسارات تعلّم | — | — | ⬜ عمل محتوى |
| 7.2 هـ ربط المساهمة بالأثر | `api/_h/stats.js` | `tests/features.test.js` | ⚠️ الإحصاءات الإدارية ✅؛ ملخص المساهم ⬜ |

---

## القسم 8 — تجربة المستخدم وSEO والوصول

| البند | الملفات | الاختبار | الحالة |
| --- | --- | --- | --- |
| 8.1 تنقل وبحث موحّد | `app.js`، `search.html` | `tests/deploy-seo.test.js` | ⚠️ رابط البحث المتقدّم أُضيف؛ توحيد المكوّنات ⬜ |
| 8.1 RTL للعربية وLTR للكود والبريد | كل الصفحات، `search.html` | `tests/deploy-seo.test.js` "every page declares Arabic and RTL" | ✅ |
| 8.1 الهاتف: أزرار ظاهرة، تأكيد للإجراءات الحسّاسة | `search.html`، `styles.css` | `tests/deploy-seo.test.js` "every page is responsive" | ⚠️ `search.html` مُحسَّنة؛ مراجعة كل الصفحات على جهاز حقيقي 🔒 |
| 8.1 حالات تسجيل واضحة بدل `alert` | `auth.html`، `search.html` | `tests/deploy-seo.test.js` | ⚠️ رسائل حالة + `aria-live`؛ بعض `alert` باقية في `code.html` |
| 8.1 وصولية: labels، تركيز مرئي، ترتيب tab، `aria-live`، بدائل نصية، تباين | `search.html`، `auth.html`، `app.js` | `tests/deploy-seo.test.js` (4) | ⚠️ الصفحات الجديدة والمعدَّلة ✅؛ تدقيق كامل بأداة 🔒 |
| 8.1 لا `hreflang=en` لمحتوى عربي | كل الصفحات | `tests/deploy-seo.test.js` "no page claims an English alternate it does not have" | ✅ |
| 8.2 صفحات عامة قابلة للفهرسة بـ title/description/canonical/OG فريدة | `code.html`، `user.html`، `search.html` | `tests/deploy-seo.test.js` (3) | ✅ |
| 8.2 sitemap من البيانات العامة مع lastmod، واستثناء الخاص والإداري | `api/_h/sitemap.js` | `tests/deploy-seo.test.js` (6) | ✅ |
| 8.2 اختبر كل URL في sitemap آلياً | `tests/deploy-seo.test.js` | "every static sitemap path resolves to a real page" | ✅ |
| 8.2 pagination حقيقية + بحث على الخادم | `api/_search.js`، `search.html` | `tests/features.test.js` | ✅ |
| 8.2 قياس Core Web Vitals + تحميل CodeMirror عند الحاجة + SRI | — | — | ⬜ يحتاج قياساً حياً؛ SRI غير متوافق مع esm.sh الديناميكي |
| 8.2 cache واضح للعام و`no-store` للشخصي | `vercel.json`، `api/_http.js` | `tests/http-limits.test.js` "every per-account response is marked no-store" | ✅ |

---

## القسم 9 — الجودة والتشغيل والحوكمة

| البند | الملفات | الحالة |
| --- | --- | --- |
| 9.1 اختبارات وحدات: بريد/اسم/مدخلات، expiry، صلاحيات، حظر، أسماء ملفات | `tests/tokens.test.js`، `content-security.test.js`، `authz.test.js` | ✅ |
| 9.1 اختبارات API لكل route × كل دور × مدخلات خاطئة × حدود | `tests/authz.test.js` (95)، `http-limits.test.js` | ✅ |
| 9.1 اختبارات أمان: OAuth، session fixation، reset/reuse، stored XSS، رفع، CSRF، حدود، headers | `tests/oauth-google.test.js`، `authz.test.js`، `tokens.test.js`، `content-security.test.js`، `uploads.test.js`، `deploy-seo.test.js` | ✅ |
| 9.1 اختبارات جودة المحتوى: HTML/JS/ZIP، MIME، حجم، ترخيص، أسرار، slug، إرجاع إصدار | `tests/uploads.test.js`، `content-security.test.js`، `features.test.js` | ⚠️ الكل ✅ عدا إرجاع الإصدار (غير مُنفَّذ) |
| 9.1 CI: lint، syntax، tests، secret scanning، dependency scanning، preview | `.github/workflows/ci.yml` | ⚠️ الكل ✅؛ معاينة staging تحتاج ربط Vercel |
| 9.1 منع الدمج عند فشل اختبار أو وجود سر في diff | `.github/workflows/ci.yml`، `scripts/scan-secrets.js --staged` | ✅ (يحتاج تفعيل branch protection 🔒) |
| 9.1 اختبار الاستعادة في بيئة معزولة + RPO/RTO | `scripts/backup-data.js`، `verify-data.js`، `README.md` | ⚠️ الأدوات والخطة؛ التنفيذ 🔒 |
| 9.2 لوحة تشغيل: 4xx/5xx، latency، فشل DB، فشل بريد، أخطاء OAuth | `api/_h/health.js` | ⚠️ health جاهز؛ APM خارجي 🔒 |
| 9.2 تنبيه على محاولة نشر HTML غير مسموح وارتفاع المحاولات | `api/_moderation.js` (سجل القرارات) | ⚠️ الأحداث مُسجَّلة؛ التنبيه يحتاج أداة |
| 9.2 سجّل `request-id` والفاعل والإجراء؛ لا تسجّل أسراراً | `api/_http.js`، `_moderation.js` | ✅ |
| 9.2 health check لا يسرّب + readiness | `api/_h/health.js` | ✅ |
| 9.3 سياسة خصوصية وشروط ومحتوى بالعربية | — | ⬜ عمل قانوني/محتوى |
| 9.3 الهاتف اختياري فقط إن كانت له حاجة؛ لا هاتف/بريد/رموز في ملف عام | `_h/signup.js`، `auth.html`، `scripts/revoke-legacy-tokens.js` | ✅ أُزيل الحقل والبيانات |
| 9.3 حذف قابل للتدقيق | `api/_h/account.js` | ✅ التعليقات تُفصَل بـ `[deleted]` ولا تُحذف |
| 9.3 اشترط اختيار ترخيص | `api/_content.js` (12 ترخيصاً) | ⚠️ مدعوم ومعروض في بطاقة الجودة؛ غير إلزامي |
| 9.3 إجراءات الحوادث الأمنية | `AUDIT_FINAL_ARAB_CODE.md` القسم 6 | ⚠️ الخطوات موثّقة؛ الإجراء الرسمي عمل تشغيلي |

---

## القسم 10 — مؤشرات النجاح

| المؤشر | الحالة | الدليل |
| --- | --- | --- |
| صفر مخاطر حرجة/عالية مفتوحة | ⚠️ | مُغلقة برمجياً؛ R-1 و R-2 تحتاج صلاحيات |
| صفر فقد تحديث بسبب التزامن | ✅ | `tests/concurrency.test.js` (13) |
| توافر 99.9% | 🔒 | يحتاج قياساً حياً |
| P95 < 300–500ms للقراءة | 🔒 | يحتاج APM |
| نجاح التسجيل/التفعيل | 🔒 | يحتاج أحداث تحليلات |
| زمن مراجعة المحتوى | ⚠️ | البيانات موجودة في `pending/` والسجل؛ اللوحة غير مُنفَّذة |
| صفر روابط sitemap ترجع 404 + canonical صالح | ✅ | `tests/deploy-seo.test.js` |
| الاحتفاظ بالمساهمين / جودة المكتبة | 🔒 | يحتاج تحليلات |
| أحداث تحليلات مجمّعة بلا تسجيل الكود أو البريد | ⬜ | لم تُنفَّذ؛ المبدأ محترم (لا تسجيل بيانات حسّاسة) |

---

## الملحق أ — خريطة ملفات الأولوية من الخطة

| ملف الخطة | الحالة | ما تغيّر |
| --- | --- | --- |
| `api/_auth.js` | ✅ | مفتاح من config؛ `session_version`؛ `updateUsers` معاملاتي؛ `readBody` محدود |
| `api/_gh.js` | ✅ | `updateJson` بإعادة التطبيق؛ مهلات؛ `status` على الأخطاء؛ `deleteFile` يجلب sha؛ حذف شيفرة ميتة |
| `api/_h/verify.js`, `signup.js`, `forgot-password.js`, `reset-password.js` | ✅ | رموز مجزّأة منتهية؛ حدود؛ Turnstile؛ لا تعداد بريد؛ تدوير جلسة |
| `api/_h/google.js` | ✅ | تحقق JWKS كامل؛ nonce؛ لا كلمة سر بالبريد؛ فحص حظر |
| `api/_h/submit.js`, `approve.js`, `raw.js`, `api/index.js` | ✅ | قائمة سماح؛ مراجعة إلزامية؛ تقديم خامل؛ بوابة تهيئة |
| `api/_h/upload-avatar.js`, `zips.js`, `api/image.js` | ✅ | بلا مفاتيح؛ بصمات؛ ZIP؛ حدود. **`api/image.js` غير موجود في هذه النسخة** |
| `data/users.json`, `interactions.json`, `settings.json` | ✅ | رموز وهواتف أُزيلت؛ مفاتيح الإعجاب والتعليقات أُعيد ربطها؛ إعدادات آمنة |
| `admin.html`, `user.html`, `code.html`, `submit.html`, `app.js`, `styles.css` | ⚠️ | تهريب حسب السياق؛ markdown يفشل مُغلقاً؛ canonical؛ وصولية. توحيد المكوّنات ⬜ |
| `vercel.json`, `README.md`, `package.json`, ملفات القفل | ✅ | رؤوس أمنية؛ حجب؛ npm فقط؛ Node مثبّت؛ توثيق كامل |

---

## الملحق ب — ملاحظات التهيئة والنشر

| البند | الحالة | الملف |
| --- | --- | --- |
| `.env.example` بأسماء المتغيرات فقط بلا قيم سرية | ✅ | `.env.example` (20 متغيّراً) |
| config module واحد يتحقق من البيئة بدل fallbacks موزّعة | ✅ | `api/_config.js` |
| احذف fallback domain القديم وبريد الإدارة الافتراضي | ✅ | اختبار يمنع عودتها |
| لا تستخدم `req.headers.host` لبناء روابط أمنية | ✅ | `baseUrl()` + اختبار "the verification link uses the trusted base URL, not the request host" |
| اختر npm أو pnpm وحده وثبّت إصدار Node | ✅ | `package.json`، `.nvmrc` |
| dependency scan على النسخ الفعلية قبل الترقية بلا تحديث عشوائي | ✅ | `npm audit` في CI؛ التبعيات مثبّتة بإصدارات دقيقة. **ترقية واحدة مقصودة بعد تقييم توافق:** `nodemailer` 6.10.1 ⇒ 10.1.2 لإغلاق سلسلة تنبيهات HIGH (حقن SMTP/CRLF وتجاوز التحقق من المستلم). مُغطّاة بـ `tests/mail.test.js` على المكتبة الحقيقية. `bcryptjs` و`jsonwebtoken` **لم تُرقَّ** (0 تنبيهات). |
