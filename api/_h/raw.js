const { getFile } = require('../_gh');
const { resolveFilename } = require('../_resolve');

const TYPES = { txt: 'text/plain' };

module.exports = async (req, res) => {
  const { file } = req.query || {};
  if (!file || !/^[a-zA-Z0-9._-]{1,80}$/.test(file)) return res.status(400).json({ error: 'اسم غير صالح' });
  let name = file;
  let f = await getFile(`codes/${name}`);
  if (!f) {
    const resolved = await resolveFilename(file);
    if (resolved && resolved !== name) {
      name = resolved;
      f = await getFile(`codes/${name}`);
    }
  }
  if (!f) return res.status(404).json({ error: 'غير موجود' });
  // Always plain text — the browser must never execute a stored code file.
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Code-Filename', name);
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).send(f.content);
};
