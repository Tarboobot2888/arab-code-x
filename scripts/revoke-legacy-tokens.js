#!/usr/bin/env node
// Incident containment for SEC-01 (plan 6.1 step 3: "إبطال رموز التفعيل
// المخزنة، وإضافة expiry وone-time-use server-side").
//
// The audited data/users.json carried 33 plaintext verification tokens with NO
// expiry and 12 reset tokens. Because the file is tracked in Git, every one of
// those values must be treated as disclosed. This script revokes them.
//
//   node scripts/revoke-legacy-tokens.js            # dry run (default)
//   node scripts/revoke-legacy-tokens.js --write     # apply (takes a backup first)
//   node scripts/revoke-legacy-tokens.js --write --purge-phone
//
// What it changes:
//   * verification_token / reset_token / pending_email_token  -> removed
//   * reset_expires / pending_email_* leftovers               -> removed
//   * session_version                                         -> bumped (every
//     existing session cookie stops working, as a secret rotation requires)
//   * --purge-phone: removes the `phone` column. No feature ever read it, so it
//     was personal data held with no purpose (plan 9.3). Signup no longer
//     collects it.
//
// What it does NOT do: it cannot rewrite Git history. Removing a value from the
// current file does not remove it from earlier commits — see
// AUDIT_FINAL_ARAB_CODE.md for the history-rewrite / key-rotation runbook that
// needs repository-owner access.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const USERS = path.join(ROOT, 'data', 'users.json');

const TOKEN_FIELDS = [
  'verification_token', 'verification_token_hash', 'verification_token_expires',
  'reset_token', 'reset_token_hash', 'reset_expires',
  'pending_email_token', 'pending_email_token_hash', 'pending_email_expires',
];

const has = (flag) => process.argv.includes(flag);

function revoke(users, { purgePhone }) {
  const stats = {
    users: users.length,
    verification_tokens_revoked: 0,
    reset_tokens_revoked: 0,
    email_change_tokens_revoked: 0,
    phones_purged: 0,
    sessions_rotated: 0,
    unverified_needing_resend: 0,
  };

  for (const u of users) {
    let touched = false;

    if (u.verification_token || u.verification_token_hash) {
      stats.verification_tokens_revoked += 1;
      touched = true;
    }
    if (u.reset_token || u.reset_token_hash) {
      stats.reset_tokens_revoked += 1;
      touched = true;
    }
    if (u.pending_email_token || u.pending_email_token_hash) {
      stats.email_change_tokens_revoked += 1;
      touched = true;
    }

    for (const f of TOKEN_FIELDS) {
      if (f in u) { delete u[f]; touched = true; }
    }
    // A pending email change whose token is gone must not stay half-applied.
    if (u.pending_email) { delete u.pending_email; touched = true; }
    if ('pending_email_at' in u) { delete u.pending_email_at; touched = true; }

    if (purgePhone && 'phone' in u) {
      if (String(u.phone || '').trim()) stats.phones_purged += 1;
      delete u.phone;
      touched = true;
    }

    if (touched) {
      u.session_version = (Number(u.session_version) || 0) + 1;
      stats.sessions_rotated += 1;
    } else if (u.session_version === undefined) {
      u.session_version = 0;
    }

    if (!u.verified) stats.unverified_needing_resend += 1;
    u.tokens_revoked_at = u.tokens_revoked_at || new Date().toISOString();
  }

  return stats;
}

function main() {
  const write = has('--write');
  const purgePhone = has('--purge-phone');

  if (!fs.existsSync(USERS)) {
    console.error(`[revoke] ${USERS} not found`);
    process.exit(1);
  }

  const original = fs.readFileSync(USERS, 'utf8');
  const parsed = JSON.parse(original);
  if (!Array.isArray(parsed.users)) {
    console.error('[revoke] unexpected shape: expected { users: [...] }');
    process.exit(1);
  }

  if (write) {
    // Never destroy source data without a verified backup first.
    const { main: backup } = require('./backup-data');
    const dir = backup();
    console.log(`[revoke] backup taken at ${dir}`);
  }

  const stats = revoke(parsed.users, { purgePhone });

  console.log(`[revoke] mode: ${write ? 'WRITE' : 'DRY RUN (pass --write to apply)'}`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);

  if (!write) {
    console.log('[revoke] nothing written.');
    return stats;
  }

  fs.writeFileSync(USERS, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`[revoke] wrote ${USERS}`);
  console.log('[revoke] NEXT STEPS (need operator access):');
  console.log('  1. Rotate JWT_SECRET in the platform settings (invalidates all remaining sessions).');
  console.log('  2. Rotate the external upload key at the provider (UPLOADS_API_KEY).');
  console.log(`  3. ${stats.unverified_needing_resend} unverified account(s) must use /api/resend-verification.`);
  console.log('  4. Decide on Git-history rewrite + user notification (see AUDIT_FINAL_ARAB_CODE.md).');
  return stats;
}

if (require.main === module) main();
module.exports = { revoke, TOKEN_FIELDS, main };
