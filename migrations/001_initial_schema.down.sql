-- التراجع عن 001_initial_schema.sql (خطة rollback — الخطة 6.2 الخطوة 5).
--
-- تحذير: هذا السكربت يحذف جميع الجداول وبياناتها. لا يُنفّذ إلا بعد:
--   1) أخذ نسخة احتياطية مؤكدة (pg_dump) والتحقق من إمكانية استعادتها،
--   2) التأكد من أن ملفات JSON في المستودع ما زالت مصدر الحقيقة،
--   3) إعادة توجيه التطبيق إلى المخزن القديم (DATABASE_URL فارغ).
--
-- الترتيب من الأبعد تبعية إلى الأقرب حتى لا تُكسر المفاتيح الأجنبية.

BEGIN;

DROP VIEW IF EXISTS public_codes;

DROP TRIGGER IF EXISTS codes_touch ON codes;
DROP TRIGGER IF EXISTS users_touch ON users;
DROP FUNCTION IF EXISTS touch_updated_at();

DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS mail_outbox;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS package_downloads;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS upload_assets;
DROP TABLE IF EXISTS delete_requests;
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS code_likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS collection_items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS code_tags;
DROP TABLE IF EXISTS tags;

-- codes يحمل مفتاحاً أجنبياً إلى code_versions، فيُفك أولاً.
ALTER TABLE IF EXISTS codes DROP CONSTRAINT IF EXISTS codes_current_version_fk;
DROP TABLE IF EXISTS code_versions;
DROP TABLE IF EXISTS code_aliases;
DROP TABLE IF EXISTS codes;

DROP TABLE IF EXISTS bans;
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS user_private_contacts;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS scan_status;
DROP TYPE IF EXISTS token_purpose;
DROP TYPE IF EXISTS moderation_status;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;

DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
