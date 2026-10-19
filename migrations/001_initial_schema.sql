-- ARAB code — المخطط الأولي لقاعدة بيانات PostgreSQL
--
-- الخطة: القسم 5.2 (نموذج البيانات المقترح) والقسم 6.2 (خطة الترحيل الآمن).
-- الهدف: إيقاف استخدام GitHub كمخزن تشغيلي لبيانات المستخدمين، مع معاملات
-- وقيود uniqueness وفهارس حقيقية بدل ملفات JSON تُكتب عبر commits.
--
-- التشغيل:  npm run db:migrate         (يتطلب DATABASE_URL)
-- التراجع:  migrations/001_initial_schema.down.sql
--
-- ملاحظة مهمة: هذا الملف جاهز للتنفيذ لكنه لم يُنفّذ على قاعدة بيانات حقيقية
-- في هذه الدورة لعدم توفر DATABASE_URL. راجع AUDIT_FINAL_ARAB_CODE.md.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- مقارنة بريد/اسم مستخدم بلا حساسية حالة
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- بحث جزئي سريع

-- ---------------------------------------------------------------------------
-- أنواع محصورة بدل سلاسل حرة
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('member', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'unverified', 'banned', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE moderation_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE token_purpose AS ENUM ('verify', 'reset', 'email_change');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_status AS ENUM ('unknown', 'signature-only', 'structure-checked', 'clean', 'infected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- المستخدمون
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username          CITEXT NOT NULL,
  email             CITEXT NOT NULL,
  -- NULL مسموح: حسابات جوجل بلا كلمة سر محلية (SEC-10).
  password_hash     TEXT,
  display_name      TEXT NOT NULL DEFAULT '',
  role              user_role NOT NULL DEFAULT 'member',
  status            user_status NOT NULL DEFAULT 'unverified',
  verified_at       TIMESTAMPTZ,
  is_verified_badge BOOLEAN NOT NULL DEFAULT FALSE,
  provider          TEXT,
  provider_subject  TEXT,
  -- تدوير الجلسات: زيادة الرقم تُبطل كل ملفات الارتباط القائمة.
  session_version   INTEGER NOT NULL DEFAULT 0,
  lock_until        TIMESTAMPTZ,
  lock_strikes      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  CONSTRAINT users_email_format CHECK (position('@' IN email) > 1 AND length(email) <= 254),
  CONSTRAINT users_session_version_nonneg CHECK (session_version >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_subject_key
  ON users (provider, provider_subject) WHERE provider_subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

-- الملف العام منفصل عن الحقول الخاصة (الخطة 5.2: "تُفصل الحقول الخاصة").
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio         TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  banner_url  TEXT,
  location    TEXT NOT NULL DEFAULT '',
  website     TEXT,
  links       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profile_links_is_array CHECK (jsonb_typeof(links) = 'array'),
  CONSTRAINT profile_website_https CHECK (website IS NULL OR website ~* '^https://'),
  CONSTRAINT profile_avatar_https CHECK (avatar_url IS NULL OR avatar_url ~* '^https://'),
  CONSTRAINT profile_banner_https CHECK (banner_url IS NULL OR banner_url ~* '^https://')
);

-- بيانات اتصال خاصة، منفصلة ومحدودة الوصول. لا تُقرأ من أي مسار عام.
CREATE TABLE IF NOT EXISTS user_private_contacts (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الرموز: تجزئة فقط، وانتهاء إلزامي، واستخدام مرة واحدة (SEC-01).
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     token_purpose NOT NULL,
  token_hash  TEXT NOT NULL,
  payload     JSONB,                 -- مثال: البريد الجديد عند تغيير البريد
  expires_at  TIMESTAMPTZ NOT NULL,  -- NOT NULL: لا يوجد رمز بلا انتهاء
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_tokens_hash_len CHECK (length(token_hash) = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_hash_key ON auth_tokens (token_hash);
-- رمز نشط واحد فقط لكل (مستخدم، غرض): إصدار رمز جديد يُبطل القديم.
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_active_key
  ON auth_tokens (user_id, purpose) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- الحظر
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned      BOOLEAN NOT NULL DEFAULT TRUE,
  reason      TEXT NOT NULL DEFAULT 'أسباب أمنية',
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  unbanned_at TIMESTAMPTZ,
  decided_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bans_active_key ON bans (user_id) WHERE banned;

-- ---------------------------------------------------------------------------
-- الأكواد والإصدارات
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                CITEXT NOT NULL,          -- اسم الملف المنشور
  owner_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  language            TEXT NOT NULL,
  license_spdx        TEXT,
  moderation_status   moderation_status NOT NULL DEFAULT 'pending',
  is_executable       BOOLEAN NOT NULL DEFAULT FALSE,
  current_version_id  UUID,
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT codes_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{0,78}[a-z0-9]$'),
  CONSTRAINT codes_title_len CHECK (length(title) BETWEEN 1 AND 120),
  -- محتوى قابل للتنفيذ لا يُنشر إلا بقرار مراجعة صريح (SEC-02).
  CONSTRAINT codes_executable_requires_review
    CHECK (NOT is_executable OR moderation_status <> 'approved' OR approved_by IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS codes_slug_key ON codes (slug);
CREATE INDEX IF NOT EXISTS codes_owner_idx ON codes (owner_id);
CREATE INDEX IF NOT EXISTS codes_status_idx ON codes (moderation_status);
CREATE INDEX IF NOT EXISTS codes_language_idx ON codes (language);
CREATE INDEX IF NOT EXISTS codes_published_idx ON codes (published_at DESC NULLS LAST);
-- بحث عربي/إنجليزي: الفهرس على الشكل المطبّع الذي يبنيه api/_search.js.
CREATE INDEX IF NOT EXISTS codes_title_trgm_idx ON codes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS codes_description_trgm_idx ON codes USING gin (description gin_trgm_ops);

-- أسماء قديمة محفوظة حتى لا تنكسر الروابط المنشورة (APP-07).
CREATE TABLE IF NOT EXISTS code_aliases (
  alias      CITEXT PRIMARY KEY,
  code_id    UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id           UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  source_object_key TEXT NOT NULL,          -- مفتاح الكائن في تخزين الملفات
  checksum_sha256   TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL DEFAULT 0,
  change_summary    TEXT NOT NULL DEFAULT '',
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_versions_checksum_len CHECK (length(checksum_sha256) = 64),
  CONSTRAINT code_versions_version_pos CHECK (version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS code_versions_unique ON code_versions (code_id, version);

ALTER TABLE codes
  DROP CONSTRAINT IF EXISTS codes_current_version_fk;
ALTER TABLE codes
  ADD CONSTRAINT codes_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES code_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- الوسوم والمجموعات
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       CITEXT NOT NULL,
  -- الشكل المطبّع (بلا همزات/تشكيل) حتى يطابق البحث العربي
  normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_key ON tags (name);
CREATE INDEX IF NOT EXISTS tags_normalized_idx ON tags (normalized);

CREATE TABLE IF NOT EXISTS code_tags (
  code_id UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (code_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        CITEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_owner_slug_key ON collections (owner_id, slug);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  code_id       UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, code_id)
);

-- ---------------------------------------------------------------------------
-- التفاعلات
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id    UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  line_no    INTEGER,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comments_body_len CHECK (length(body) BETWEEN 1 AND 1000),
  CONSTRAINT comments_line_range CHECK (line_no IS NULL OR line_no BETWEEN 1 AND 1000000)
);
CREATE INDEX IF NOT EXISTS comments_code_idx ON comments (code_id, created_at DESC);

-- الإعجاب: القيد الفريد هو ما يمنع التكرار بنيوياً (APP-01).
CREATE TABLE IF NOT EXISTS code_likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id    UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_id)
);
CREATE INDEX IF NOT EXISTS code_likes_code_idx ON code_likes (code_id);

CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  code_id      UUID REFERENCES codes(id) ON DELETE SET NULL,
  comment_id   UUID REFERENCES comments(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  resolved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_status_values CHECK (status IN ('open', 'dismissed', 'actioned'))
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_body_len CHECK (length(body) BETWEEN 1 AND 2000)
);

CREATE TABLE IF NOT EXISTS delete_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id     UUID NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delete_requests_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS delete_requests_open_key
  ON delete_requests (code_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- الملفات المرفوعة والحزم
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key    TEXT NOT NULL,
  uploader_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  size_bytes    BIGINT NOT NULL,
  detected_mime TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  scan          scan_status NOT NULL DEFAULT 'unknown',
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT upload_assets_sha_len CHECK (length(sha256) = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS upload_assets_object_key ON upload_assets (object_key);
CREATE INDEX IF NOT EXISTS upload_assets_sha_idx ON upload_assets (sha256);

CREATE TABLE IF NOT EXISTS packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        CITEXT NOT NULL,
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  readme      TEXT NOT NULL DEFAULT '',
  version     TEXT NOT NULL DEFAULT '',
  asset_id    UUID REFERENCES upload_assets(id) ON DELETE SET NULL,
  thumb_id    UUID REFERENCES upload_assets(id) ON DELETE SET NULL,
  download_count BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT packages_readme_len CHECK (length(readme) <= 30000),
  CONSTRAINT packages_downloads_nonneg CHECK (download_count >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS packages_slug_key ON packages (slug);

-- عدّاد تنزيلات حقيقي ومحمي من التلاعب (الخطة 7.1 P2).
CREATE TABLE IF NOT EXISTS package_downloads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS package_downloads_pkg_idx ON package_downloads (package_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- الإعدادات، التدقيق، وصندوق البريد الصادر
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  status_from TEXT,
  status_to  TEXT,
  reason     TEXT,
  metadata   JSONB,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);

-- بريد صادر حتى لا تضيع رسالة عند انتهاء مهلة الدالة (الخطة 5.2 Outbox).
CREATE TABLE IF NOT EXISTS mail_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient     CITEXT NOT NULL,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  idempotency_key TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_outbox_idem_key
  ON mail_outbox (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_outbox_pending_idx ON mail_outbox (created_at) WHERE sent_at IS NULL;

-- حدود الطلبات موزعة عبر القاعدة (بديل مقبول لـ Redis).
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,
  hits       INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at);

-- ---------------------------------------------------------------------------
-- جدول تتبّع المهاجرات
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- updated_at تلقائي
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS codes_touch ON codes;
CREATE TRIGGER codes_touch BEFORE UPDATE ON codes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- عرض عام للأكواد المنشورة فقط (يُستخدم للفهرسة وsitemap)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public_codes AS
SELECT c.id, c.slug, c.title, c.description, c.language, c.license_spdx,
       c.is_executable, c.published_at, u.username AS author,
       p.avatar_url AS author_avatar, u.is_verified_badge AS author_verified
FROM codes c
LEFT JOIN users u ON u.id = c.owner_id
LEFT JOIN user_profiles p ON p.user_id = u.id
WHERE c.moderation_status = 'approved';

COMMIT;
