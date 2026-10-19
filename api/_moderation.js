// Publication states and the moderator audit trail (plan 7.1 P0 "نشر آمن
// ومراجعة", 5.2 ModerationCase/AuditLog).
//
// States: draft → pending → approved | rejected
//   draft     the author saved it but has not submitted it for review
//   pending   waiting for a moderator; stored under pending/<id>.json
//   approved  listed in data/manifest.json and readable through /api/raw
//   rejected  removed from the queue; the author is told why
//
// Every moderator decision is appended to data/moderation_log.json so a ban,
// delete or approval can be traced back to who did it and when.
const { updateJson } = require('./_gh');

const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const ALL_STATUSES = Object.freeze(Object.values(STATUS));

const TRANSITIONS = Object.freeze({
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: ['pending'],
});

function canTransition(from, to) {
  const allowed = TRANSITIONS[String(from || '').toLowerCase()];
  return Array.isArray(allowed) && allowed.includes(String(to || '').toLowerCase());
}

const LOG_PATH = 'data/moderation_log.json';
const MAX_LOG_ENTRIES = 5000;

/**
 * Append one decision to the audit log. Never stores content bodies, emails or
 * tokens — only who, what, which object, and why.
 */
async function logDecision({ actor, action, target, from, to, reason, meta }) {
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    actor: String(actor || 'system').slice(0, 40),
    action: String(action || '').slice(0, 40),
    target: String(target || '').slice(0, 120),
    from: from ? String(from).slice(0, 20) : null,
    to: to ? String(to).slice(0, 20) : null,
    reason: reason ? String(reason).slice(0, 400) : null,
    meta: meta && typeof meta === 'object' ? meta : null,
  };
  try {
    await updateJson(LOG_PATH, { entries: [] }, (data) => {
      if (!Array.isArray(data.entries)) data.entries = [];
      data.entries.unshift(entry);
      if (data.entries.length > MAX_LOG_ENTRIES) data.entries.length = MAX_LOG_ENTRIES;
      return null;
    }, `audit: ${entry.action} ${entry.target}`);
  } catch (e) {
    // The audit write must never break the operation it records, but a failure
    // has to be visible.
    // eslint-disable-next-line no-console
    console.error('[moderation] audit log write failed:', e.message);
  }
  return entry;
}

async function readLog(limit = 200) {
  const { readJson } = require('./_gh');
  const { data } = await readJson(LOG_PATH, { entries: [] });
  return (Array.isArray(data.entries) ? data.entries : []).slice(0, Math.min(limit, MAX_LOG_ENTRIES));
}

module.exports = { STATUS, ALL_STATUSES, TRANSITIONS, canTransition, logDecision, readLog, LOG_PATH };
