// One-time, expiring, hashed tokens for email verification, password reset and
// email change (plan: SEC-01, 5.3 "تخزين رمز استعادة/تفعيل كـ hash ... مع
// صلاحية وانتهاء ومحاولة واحدة").
//
// Design:
//   * The plaintext token exists only inside the email link. The store keeps
//     sha256(token) so a leaked data file cannot be replayed.
//   * Every token carries a mandatory absolute expiry. A record without one is
//     treated as expired, so legacy rows can never be used.
//   * consume() clears the stored hash before the operation succeeds, making the
//     token single-use; replaying it fails with "expired or already used".
//   * Comparison is constant-time.
//   * Tokens are never written to logs or error messages.
const crypto = require('crypto');

const DEFAULT_TTL = {
  verify: 24 * 60 * 60 * 1000,      // 24h
  reset: 60 * 60 * 1000,            // 1h
  email_change: 2 * 60 * 60 * 1000, // 2h
};

/** Field names used on the user record for each token purpose. */
const FIELDS = {
  verify: { hash: 'verification_token_hash', exp: 'verification_token_expires', legacy: 'verification_token' },
  reset: { hash: 'reset_token_hash', exp: 'reset_expires', legacy: 'reset_token' },
  email_change: { hash: 'pending_email_token_hash', exp: 'pending_email_expires', legacy: 'pending_email_token' },
};

function purposeFields(purpose) {
  const f = FIELDS[purpose];
  if (!f) throw new Error(`unknown token purpose: ${purpose}`);
  return f;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Create a token for `purpose`, store its hash + expiry on `user`, and return
 * the plaintext (to be emailed, never stored or logged).
 */
function issue(user, purpose, ttlMs) {
  const f = purposeFields(purpose);
  const token = crypto.randomBytes(32).toString('hex');
  user[f.hash] = hashToken(token);
  user[f.exp] = Date.now() + (Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL[purpose]);
  // Legacy plaintext column is cleared on every issue so old values die out.
  if (f.legacy in user) user[f.legacy] = null;
  return token;
}

/** Remove any token of this purpose from the record. */
function clear(user, purpose) {
  const f = purposeFields(purpose);
  user[f.hash] = null;
  user[f.exp] = null;
  if (f.legacy in user) user[f.legacy] = null;
}

/**
 * Validate and immediately invalidate a token.
 * @returns {{ok:true}|{ok:false,reason:'missing'|'expired'|'mismatch'}}
 *
 * A record with a hash but no (or a past) expiry is rejected as expired: this is
 * what closes SEC-01 for the 33 legacy verification tokens that had no expiry.
 */
function consume(user, purpose, token) {
  const f = purposeFields(purpose);
  if (!user) return { ok: false, reason: 'missing' };

  const stored = user[f.hash];
  const legacy = user[f.legacy];
  if (!stored && !legacy) return { ok: false, reason: 'missing' };
  if (!token) return { ok: false, reason: 'missing' };

  const exp = Number(user[f.exp]);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    // Expired (or an unexpiring legacy row): burn it so it can never be used.
    clear(user, purpose);
    return { ok: false, reason: 'expired' };
  }

  // Only the hash is ever accepted. A legacy plaintext column with no hash
  // cannot authenticate anything — it is cleared and rejected.
  if (!stored) {
    clear(user, purpose);
    return { ok: false, reason: 'expired' };
  }
  if (!safeEqual(stored, hashToken(token))) return { ok: false, reason: 'mismatch' };

  clear(user, purpose);
  return { ok: true };
}

/** True when a token of this purpose is present and still valid. */
function isActive(user, purpose) {
  const f = purposeFields(purpose);
  if (!user || !user[f.hash]) return false;
  const exp = Number(user[f.exp]);
  return Number.isFinite(exp) && exp > Date.now();
}

module.exports = { issue, consume, clear, isActive, hashToken, safeEqual, FIELDS, DEFAULT_TTL };
