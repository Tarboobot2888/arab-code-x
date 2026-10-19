// Account-level lockout for password guessing (plan: SEC-07 "تدرجاً/قفل مؤقت
// على الدخول وإعادة التعيين والتسجيل").
//
// Why this exists next to _ratelimit.js: the rate limiter buckets by IP and by
// actor, which stops a single source. A lockout persisted on the user record is
// the control that survives an attacker rotating IPs, because the state lives in
// the shared store every instance reads.
//
// Commit cost is deliberately bounded: failed attempts are counted in-process
// and the store is written only when a lock is actually applied or cleared —
// never once per attempt. That keeps a guessing attack from turning into commit
// spam against the repository.
const { updateUsers, findUser } = require('./_auth');

const ATTEMPTS = new Map(); // key -> { n, firstAt }
const WINDOW_MS = 15 * 60 * 1000;
const THRESHOLD = 5;              // local failures before a lock is persisted
const LOCK_STEPS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];

function keyFor(identifier) { return String(identifier || '').toLowerCase(); }

/** Remaining lock in ms, or 0. Reads the record the caller already loaded. */
function lockedFor(user) {
  if (!user) return 0;
  const until = Number(user.lock_until);
  if (!Number.isFinite(until)) return 0;
  const left = until - Date.now();
  return left > 0 ? left : 0;
}

/**
 * Register a failed attempt. Persists a lock once the local threshold is hit.
 * @returns {Promise<{locked:boolean, retryAfterSec:number}>}
 */
async function registerFailure(identifier) {
  const key = keyFor(identifier);
  if (!key) return { locked: false, retryAfterSec: 0 };

  const now = Date.now();
  let e = ATTEMPTS.get(key);
  if (!e || now - e.firstAt > WINDOW_MS) e = { n: 0, firstAt: now };
  e.n += 1;
  ATTEMPTS.set(key, e);

  if (e.n < THRESHOLD) return { locked: false, retryAfterSec: 0 };

  // Threshold reached: escalate and persist.
  let retryAfterSec = 0;
  await updateUsers((data) => {
    const u = findUser(data.users, key) || data.users.find((x) => String(x.email || '').toLowerCase() === key);
    if (!u) return null;
    const strikes = (Number(u.lock_strikes) || 0) + 1;
    const step = LOCK_STEPS_MS[Math.min(strikes - 1, LOCK_STEPS_MS.length - 1)];
    u.lock_strikes = strikes;
    u.lock_until = Date.now() + step;
    retryAfterSec = Math.ceil(step / 1000);
    return null;
  }, 'security: temporary account lock after repeated failed sign-ins');

  ATTEMPTS.set(key, { n: 0, firstAt: now });
  return { locked: retryAfterSec > 0, retryAfterSec };
}

/** Clear counters after a successful sign-in. Only writes when state exists. */
async function registerSuccess(identifier, user) {
  const key = keyFor(identifier);
  ATTEMPTS.delete(key);
  if (!user || (!user.lock_until && !user.lock_strikes)) return;
  await updateUsers((data) => {
    const u = findUser(data.users, user.username);
    if (!u) return null;
    delete u.lock_until;
    delete u.lock_strikes;
    return null;
  }, 'security: clear account lock after successful sign-in');
}

function _reset() { ATTEMPTS.clear(); }

module.exports = { lockedFor, registerFailure, registerSuccess, THRESHOLD, WINDOW_MS, LOCK_STEPS_MS, _reset };
