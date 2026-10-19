// Upload validation: real content type, size caps, zip-slip and bomb-like
// archives, hostile filenames (plan 8 and 13).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const h = require('./helpers/harness');
const content = require('../api/_content');

const ctx = (extra = {}) => h.loadApi({ files: h.baseFiles(extra.base || {}), env: extra.env });

// ---------------------------------------------------------------------------
// Image sniffing
// ---------------------------------------------------------------------------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(16)]);

test('sniffImage identifies the supported formats from their bytes', () => {
  assert.deepEqual(content.sniffImage(PNG), { ok: true, mime: 'image/png', ext: 'png' });
  assert.deepEqual(content.sniffImage(JPEG), { ok: true, mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(content.sniffImage(GIF), { ok: true, mime: 'image/gif', ext: 'gif' });
  assert.deepEqual(content.sniffImage(WEBP), { ok: true, mime: 'image/webp', ext: 'webp' });
});

test('sniffImage refuses markup, SVG and an empty buffer', () => {
  for (const payload of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from('<!doctype html><script>alert(1)</script>'),
    Buffer.from('GIF87'), // truncated
    Buffer.alloc(0),
    Buffer.from('%PDF-1.4'),
  ]) {
    assert.equal(content.sniffImage(payload).ok, false, `accepted ${payload.subarray(0, 12).toString('latin1')}`);
  }
});

const avatar = (c, u, body) => h.call(c.routes['upload-avatar'], {
  method: 'POST', url: '/api/upload-avatar', body, cookies: h.sessionFor(c, u),
});

test('upload-avatar refuses a declared type that disagrees with the bytes', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key' } });
  const res = await avatar(c, u, { data_url: `data:image/png;base64,${JPEG.toString('base64')}` });
  assert.equal(res.statusCode, 415);
  assert.match(String(res.body.error), /لا يطابق محتواها/);
});

test('upload-avatar refuses SVG outright', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key' } });
  const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  const res = await avatar(c, u, { data_url: `data:image/svg+xml;base64,${svg}` });
  assert.equal(res.statusCode, 415);
});

test('upload-avatar refuses a disguised HTML payload', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key' } });
  const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>').toString('base64');
  const res = await avatar(c, u, { data_url: `data:image/png;base64,${html}` });
  assert.equal(res.statusCode, 415);
});

test('upload-avatar enforces the size cap with 413 before buffering the whole body', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key', MAX_AVATAR_BYTES: '1024' } });
  const big = Buffer.concat([PNG, Buffer.alloc(8192)]);
  const res = await h.call(c.routes['upload-avatar'], {
    method: 'POST',
    url: '/api/upload-avatar',
    body: JSON.stringify({ data_url: `data:image/png;base64,${big.toString('base64')}` }),
    headers: { 'content-type': 'application/json' },
    cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 413);
});

test('upload-avatar fails closed when no provider key is configured (SEC-03)', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: '' } });
  const res = await avatar(c, u, { data_url: `data:image/png;base64,${PNG.toString('base64')}` });
  assert.equal(res.statusCode, 503, 'uploads must refuse rather than fall back to a hardcoded key');
});

test('no provider key appears anywhere in the source', () => {
  const fs = require('fs');
  const path = require('path');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'codes', 'backups'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|json|html|md|yaml|yml)$/.test(e.name)) files.push(p);
    }
  };
  walk(h.ROOT);
  // The exact key shape the audit found hardcoded in two handlers.
  const pattern = /\bnzk_[0-9a-f]{32,}\b/;
  const offenders = files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [], 'a provider key is still embedded in the source');
});

// ---------------------------------------------------------------------------
// Archive inspection
// ---------------------------------------------------------------------------
/** Build a minimal but structurally valid ZIP from the given entries. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, compressedSize, uncompressedSize } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = data || Buffer.alloc(0);
    const cSize = compressedSize === undefined ? body.length : compressedSize;
    const uSize = uncompressedSize === undefined ? body.length : uncompressedSize;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(cSize, 18);
    local.writeUInt32LE(uSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(cSize, 20);
    central.writeUInt32LE(uSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

test('a normal ZIP passes inspection', () => {
  const zip = makeZip([{ name: 'src/index.js', data: Buffer.from('console.log(1)') }]);
  const r = content.inspectArchive(zip, 'pack.zip');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.type, 'zip');
  assert.equal(r.findings.entries, 1);
});

test('a zip-slip path is refused', () => {
  for (const name of ['../../etc/passwd', '/etc/passwd', 'C:\\windows\\win.ini', 'a\\..\\b', 'ok/../../x']) {
    const zip = makeZip([{ name, data: Buffer.from('x') }]);
    const r = content.inspectArchive(zip, 'pack.zip');
    assert.equal(r.ok, false, `accepted entry ${name}`);
    assert.match(r.error, /مسارات غير آمنة/);
  }
});

test('a bomb-like compression ratio is refused', () => {
  const zip = makeZip([{ name: 'big.bin', data: Buffer.alloc(100), compressedSize: 100, uncompressedSize: 100 * 1000 }]);
  const r = content.inspectArchive(zip, 'pack.zip');
  assert.equal(r.ok, false);
  assert.match(r.error, /ZIP bomb|نسبة ضغط/);
});

test('an excessive expanded size is refused', () => {
  const zip = makeZip([{ name: 'a.bin', data: Buffer.alloc(1000), compressedSize: 1000, uncompressedSize: 500 * 1024 * 1024 }]);
  const r = content.inspectArchive(zip, 'pack.zip');
  assert.equal(r.ok, false);
});

test('a truncated or non-archive payload is refused', () => {
  assert.equal(content.inspectArchive(Buffer.from('PK\x03\x04 not really a zip at all'), 'x.zip').ok, false);
  assert.equal(content.inspectArchive(Buffer.from('<!doctype html><script>alert(1)</script>'), 'x.zip').ok, false);
  assert.equal(content.inspectArchive(Buffer.alloc(4), 'x.zip').ok, false);
});

test('a declared extension that disagrees with the real format is refused', () => {
  const zip = makeZip([{ name: 'a.js', data: Buffer.from('x') }]);
  const r = content.inspectArchive(zip, 'pack.rar');
  assert.equal(r.ok, false);
  assert.match(r.error, /لا يطابق امتداده/);
});

test('gzip and 7z are recognised by signature', () => {
  const gz = zlib.gzipSync(Buffer.from('hello'));
  assert.equal(content.inspectArchive(gz, 'pack.tar.gz').ok, true);
  const sevenZ = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(32)]);
  const r = content.inspectArchive(sevenZ, 'pack.7z');
  assert.equal(r.ok, true);
  assert.equal(r.findings.inspected, 'signature-only', 'the limited depth must be reported honestly');
});

// ---------------------------------------------------------------------------
// zip-upload route
// ---------------------------------------------------------------------------
const zipUpload = (c, u, name, body) => h.call(c.routes['zip-upload'], {
  method: 'POST', url: `/api/zip-upload?name=${encodeURIComponent(name)}`, body,
  cookies: h.sessionFor(c, u), headers: { 'content-type': 'application/octet-stream' },
});

test('zip-upload refuses an unsupported extension before reading the body', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key' } });
  for (const name of ['payload.exe', 'x.php', 'noext', '../x.zip']) {
    const res = await zipUpload(c, u, name, Buffer.from('PK'));
    assert.equal(res.statusCode, 415, `accepted ${name}`);
  }
});

test('zip-upload refuses a zip-slip archive with 422 and logs the decision', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key' } });
  const zip = makeZip([{ name: '../../../etc/passwd', data: Buffer.from('x') }]);
  const res = await zipUpload(c, u, 'evil.zip', zip);
  assert.equal(res.statusCode, 422);
  const log = c.store.json('data/moderation_log.json');
  assert.ok(log && log.entries.some((e) => e.action === 'archive-rejected'));
});

test('zip-upload enforces the size cap with 413', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key', MAX_ARCHIVE_BYTES: '512' } });
  const res = await zipUpload(c, u, 'big.zip', Buffer.alloc(4096));
  assert.equal(res.statusCode, 413);
});

test('zip-upload fails closed with no provider key', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: '' } });
  const zip = makeZip([{ name: 'a.js', data: Buffer.from('x') }]);
  const res = await zipUpload(c, u, 'pack.zip', zip);
  assert.equal(res.statusCode, 503);
});

test('zip-publish refuses a URL that is not from our provider', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { UPLOADS_API_KEY: 'test-key', UPLOADS_PUBLIC_ORIGIN: 'https://uploads.example.invalid' } });
  for (const url of ['https://evil.example.invalid/file/1', 'javascript:alert(1)', '', 'https://uploads.example.invalid/other/1']) {
    const res = await h.call(c.routes['zip-publish'], {
      method: 'POST', url: '/api/zip-publish', body: { title: 'Pack', url }, cookies: h.sessionFor(c, u),
    });
    assert.equal(res.statusCode, 400, `accepted ${url}`);
  }
});

test('zip-publish records the checksum and scan status', async () => {
  const u = h.user();
  const c = ctx({
    base: { users: [u], settings: { filter_enabled: false } },
    env: { UPLOADS_API_KEY: 'test-key', UPLOADS_PUBLIC_ORIGIN: 'https://uploads.example.invalid' },
  });
  const res = await h.call(c.routes['zip-publish'], {
    method: 'POST', url: '/api/zip-publish', cookies: h.sessionFor(c, u),
    body: {
      title: 'My Pack', url: 'https://uploads.example.invalid/file/abc',
      filename: 'pack.zip', size: 1234, sha256: 'a'.repeat(64),
      scan_status: 'structure-checked', archive_type: 'zip',
    },
  });
  assert.equal(res.statusCode, 200);
  const z = c.store.json('data/zips.json').zips[0];
  assert.equal(z.sha256, 'a'.repeat(64));
  assert.equal(z.scan_status, 'structure-checked');
  assert.equal(z.downloads, 0);
});

test('zip-publish rejects a forged scan status and a bad checksum', async () => {
  const u = h.user();
  const c = ctx({
    base: { users: [u], settings: { filter_enabled: false } },
    env: { UPLOADS_API_KEY: 'test-key', UPLOADS_PUBLIC_ORIGIN: 'https://uploads.example.invalid' },
  });
  const res = await h.call(c.routes['zip-publish'], {
    method: 'POST', url: '/api/zip-publish', cookies: h.sessionFor(c, u),
    body: {
      title: 'Forged', url: 'https://uploads.example.invalid/file/abc',
      sha256: 'not-a-hash', scan_status: 'clean-trust-me',
    },
  });
  assert.equal(res.statusCode, 200);
  const z = c.store.json('data/zips.json').zips[0];
  assert.equal(z.sha256, null, 'a malformed checksum must be dropped, not stored');
  assert.equal(z.scan_status, 'unknown', 'an unrecognised scan status must not be trusted');
});
