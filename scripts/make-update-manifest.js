'use strict';
// Build metatools-update.json for the in-app updater (lib/updater.js). Used by .github/workflows/release.yml.
// node scripts/make-update-manifest.js --payload MetaTools-payload-2.3.0.asar --base-url https://github.com/<repo>/releases/download/v2.3.0/ --out metatools-update.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const payload = arg('payload');
const base = arg('base-url');
if (!payload || !base) { console.error('need --payload and --base-url'); process.exit(2); }
const buf = fs.readFileSync(payload);

// in-app notes: RELEASE_NOTES.md up to the download section, without markdown bold
function notes() {
  let t = '';
  try { t = fs.readFileSync(path.join(root, arg('notes', 'RELEASE_NOTES.md')), 'utf8'); } catch (_) { return ''; }
  const cut = t.search(/^\*\*Tải về\*\*|^#+\s*Tải về/m);
  return (cut > 0 ? t.slice(0, cut) : t).replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
}

const b = base.endsWith('/') ? base : base + '/';
const m = {
  schema: 1,
  version: pkg.version,
  date: new Date().toISOString(),
  notes: notes(),
  minShell: pkg.updateMinShell || pkg.version,   // oldest installed build (bootstrap) able to run this payload
  electron: parseInt(require(path.join(root, 'node_modules/electron/package.json')).version, 10),
  payload: { url: b + path.basename(payload), sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length },
  full: { 'win32-x64': b + 'TomMultitask-Windows-x64.zip', 'darwin-arm64': b + 'TomMultitask-Mac-AppleChip.zip', 'darwin-x64': b + 'TomMultitask-Mac-Intel.zip' },
};
fs.writeFileSync(arg('out', 'metatools-update.json'), JSON.stringify(m, null, 2));
console.log(JSON.stringify({ ...m, notes: m.notes.slice(0, 80) + '…' }, null, 2));
