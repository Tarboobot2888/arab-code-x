// The mail layer, exercised against the REAL nodemailer (no network).
//
// Why this suite exists: `npm audit` reported a HIGH advisory chain against
// nodemailer 6.x (SMTP command injection, CRLF header injection, recipient
// domain-validation bypasses). The dependency was upgraded to 10.1.2, which is
// a major bump, so the paths this project actually uses are pinned down here —
// and the application now validates the recipient itself rather than trusting
// the library's parser.
//
// jsonTransport builds a complete message without opening a socket, so every
// assertion below is about real output, not a stub.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const h = require('./helpers/harness');

const SMTP_ENV = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'no-reply@example.invalid',
  SMTP_PASS: 'test-password',
};

function mailModule(env = {}) {
  const ctx = h.loadApi({ files: h.baseFiles(), env: { ...SMTP_ENV, ...env }, mail: false });
  return ctx.require('_mail.js');
}

/** Render a message through jsonTransport and return the parsed result. */
async function build(message) {
  const t = nodemailer.createTransport({ jsonTransport: true });
  const info = await t.sendMail(message);
  return JSON.parse(info.message);
}

// ---------------------------------------------------------------------------
// Dependency surface
// ---------------------------------------------------------------------------
test('the installed nodemailer is the version with the advisories fixed', () => {
  const installed = require('nodemailer/package.json').version;
  const [major] = installed.split('.').map(Number);
  assert.ok(major >= 10, `nodemailer ${installed} is below the fixed 10.x line`);
  const declared = require('../package.json').dependencies.nodemailer;
  assert.equal(declared, installed, 'package.json must pin the installed version exactly');
});

test('the transport shape the project builds is accepted', () => {
  const t = nodemailer.createTransport({
    host: 'smtp.example.invalid',
    port: 465,
    secure: true,
    auth: { user: 'no-reply@example.invalid', pass: 'x' },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  assert.equal(typeof t.sendMail, 'function');
});

test('an Arabic RTL message round-trips intact', async () => {
  const m = await build({
    from: '"ARAB code" <no-reply@example.invalid>',
    to: 'member@example.invalid',
    subject: 'تأكيد حسابك في ARAB code',
    html: '<div dir="rtl"><h1>مرحباً 👋</h1><a href="https://x.invalid/api/verify?token=abc">تفعيل</a></div>',
  });
  assert.equal(m.subject, 'تأكيد حسابك في ARAB code');
  assert.ok(m.html.includes('مرحباً 👋'));
  assert.ok(m.html.includes('dir="rtl"'));
  assert.deepEqual(m.to.map((x) => x.address), ['member@example.invalid']);
  assert.ok(m.messageId);
});

// ---------------------------------------------------------------------------
// Recipient validation (our own, in front of the library)
// ---------------------------------------------------------------------------
test('assertRecipient accepts a single plain address', () => {
  const { assertRecipient } = mailModule();
  assert.equal(assertRecipient('member@example.invalid'), 'member@example.invalid');
  assert.equal(assertRecipient('  spaced@example.invalid  '), 'spaced@example.invalid');
  assert.equal(assertRecipient('a.b+tag@sub.example.invalid'), 'a.b+tag@sub.example.invalid');
});

test('assertRecipient refuses header injection and multi-recipient strings', () => {
  const { assertRecipient } = mailModule();
  const attacks = [
    'victim@example.invalid\r\nBcc: attacker@evil.invalid',
    'victim@example.invalid\nX-Injected: yes',
    'a@example.invalid, b@evil.invalid',
    'a@example.invalid; b@evil.invalid',
    '"display" <a@example.invalid>',
    'a@example.invalid (comment)@evil.invalid',
    '<a@example.invalid>',
    'a@[192.0.2.1]',
    'no-at-sign',
    '',
    '   ',
    `${'x'.repeat(250)}@example.invalid`,
  ];
  for (const bad of attacks) {
    assert.throws(() => assertRecipient(bad), /invalid recipient/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('a refused recipient is not exposed to the client', () => {
  const { assertRecipient } = mailModule();
  try {
    assertRecipient('a@example.invalid\r\nBcc: x@y.z');
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.expose, false, 'the reason must stay server-side');
  }
});

test('sendMail refuses an invalid recipient before touching SMTP', async () => {
  const mail = mailModule();
  await assert.rejects(
    () => mail.sendMail({ to: 'victim@example.invalid\r\nBcc: attacker@evil.invalid', subject: 's', html: 'h' }),
    /invalid recipient/,
  );
});

test('sendVerification refuses an invalid recipient too', async () => {
  const mail = mailModule();
  await assert.rejects(
    () => mail.sendVerification({ to: 'a@example.invalid, b@evil.invalid', username: 'u', verifyUrl: 'https://x' }),
    /invalid recipient/,
  );
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
test('sending refuses when SMTP is not configured', async () => {
  const mail = mailModule({ SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' });
  await assert.rejects(
    () => mail.sendMail({ to: 'member@example.invalid', subject: 's', html: 'h' }),
    /SMTP is not configured/,
  );
});

test('the SMTP password never appears in a rendered message', async () => {
  const mail = mailModule();
  const html = mail.shell('<p>body</p>');
  assert.ok(!html.includes(SMTP_ENV.SMTP_PASS));
  const rejection = mail.rejectionHtml({ username: 'u', title: 't', reason: 'r', auto: true });
  assert.ok(!rejection.includes(SMTP_ENV.SMTP_PASS));
});

// ---------------------------------------------------------------------------
// Template escaping — a username or a rejection reason is user input
// ---------------------------------------------------------------------------
test('the welcome mail carries no credential (SEC-10)', () => {
  const mail = mailModule();
  const html = mail.welcomeHtml({
    display: 'Member', loginUrl: 'https://x.invalid/auth', setPasswordUrl: 'https://x.invalid/auth?mode=forgot',
  });
  assert.ok(!/كلمة السر\s*:/.test(html), 'no password row may be rendered');
  assert.ok(html.includes('mode=forgot'), 'the member is pointed at the secure reset flow instead');
  assert.equal(typeof mail.sendWelcome, 'function');
  assert.equal(mail.welcomeHtml.length <= 1, true);
});

test('a username with markup is escaped in every template', () => {
  const mail = mailModule();
  const xss = '<img src=x onerror=alert(1)>';
  const templates = [
    mail.rejectionHtml({ username: xss, title: xss, reason: xss, auto: false }),
    mail.welcomeHtml({ display: xss, loginUrl: 'https://x.invalid', setPasswordUrl: 'https://x.invalid' }),
    mail.passwordResetHtml({ username: xss, resetUrl: 'https://x.invalid' }),
    mail.broadcastHtml({ heading: xss, body: xss, username: xss }),
  ];
  for (const html of templates) {
    assert.ok(!html.includes('<img src=x'), 'raw markup reached a mail template');
    assert.ok(html.includes('&lt;img src=x'), 'the value should appear escaped');
  }
});

test('the rich broadcast body escapes before it builds links', () => {
  const mail = mailModule();
  const out = mail.renderRichBody('<script>alert(1)</script>\nsecond line');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('the reset mail contains the token only inside the link', async () => {
  const mail = mailModule();
  const token = 'a'.repeat(64);
  const html = mail.passwordResetHtml({ username: 'member', resetUrl: `https://x.invalid/auth?token=${token}` });
  const occurrences = html.split(token).length - 1;
  assert.equal(occurrences, 1, 'the token must appear once, in the href, and nowhere else');
});

test('support channels come from configuration, not hardcoded personal values', () => {
  const withNumber = mailModule({ SUPPORT_WHATSAPP: '123456789' });
  const html = withNumber.rejectionHtml({ username: 'u', title: 't', reason: 'r', auto: false });
  assert.ok(html.includes('wa.me/123456789'));
  assert.ok(html.includes('admin@example.invalid'), 'the admin address comes from ADMIN_EMAIL');

  const withoutNumber = mailModule({ SUPPORT_WHATSAPP: '' });
  const plain = withoutNumber.rejectionHtml({ username: 'u', title: 't', reason: 'r', auto: false });
  assert.ok(!plain.includes('wa.me/'), 'no number is invented when none is configured');
  assert.ok(plain.includes('admin@example.invalid'));
});
