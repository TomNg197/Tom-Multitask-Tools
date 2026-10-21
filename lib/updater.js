'use strict';
// In-app update (asar-level): read a small PUBLIC JSON manifest, download the new app payload (.asar), verify its sha256
// (mandatory) + that it really is a MetaTools payload of that version, then stage it for the next start (lib/boot.js).
// No GitHub token or any secret is used or embedded: the manifest and payload must be reachable without login.
//
// manifest (metatools-update.json, built by scripts/make-update-manifest.js in the release workflow):
//   { schema: 1, version: "2.3.1", date, notes, minShell: "2.3.0", electron: 44,
//     payload: { url, sha256, size },  full: { "win32-x64": url, "darwin-arm64": url, "darwin-x64": url } }
// A payload only replaces JS/UI; a new Electron (or minShell above the installed shell) needs the full zip -> "needFull".
const path = require('path');
const crypto = require('crypto');
const boot = require('./boot');
const { fs, cmpVer, parseVer } = boot;

// Default channel: latest release of a PUBLIC releases-only repo (the source repo stays private). Override:
// env METATOOLS_UPDATE_URL (tests, another channel). Change the constant if the owner picks another place.
const DEFAULT_MANIFEST_URL = 'https://github.com/TomNg197/MetaTools-releases/releases/latest/download/metatools-update.json';
const MAX_PAYLOAD = 200 * 1024 * 1024;
const CHECK_EVERY = 6 * 3600 * 1000;   // automatic check at most every 6 hours

function manifestUrl() { return (process.env.METATOOLS_UPDATE_URL || '').trim() || DEFAULT_MANIFEST_URL; }

// https only; plain http is accepted for localhost (tests / local mirror)
function safeUrl(u, base) {
  let x;
  try { x = new URL(u, base); } catch (_) { throw new Error(`URL không hợp lệ: ${u}`); }
  if (x.protocol === 'https:') return x.toString();
  if (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)) return x.toString();
  throw new Error(`Chỉ nhận link https: ${u}`);
}

function parseManifest(obj, base) {
  if (!obj || typeof obj !== 'object') throw new Error('Manifest không phải JSON object');
  if (obj.schema !== undefined && obj.schema !== 1) throw new Error(`Manifest schema ${obj.schema} chưa hỗ trợ, cần tải bản đầy đủ mới`);
  if (!parseVer(obj.version)) throw new Error('Manifest thiếu version dạng x.y.z');
  const p = obj.payload || {};
  if (!p.url) throw new Error('Manifest thiếu payload.url');
  const sha = String(p.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Manifest thiếu payload.sha256 (64 ký tự hex)');
  const size = p.size === undefined ? null : Number(p.size);
  if (size !== null && !(Number.isInteger(size) && size > 0 && size <= MAX_PAYLOAD)) throw new Error('payload.size không hợp lệ');
  const full = {};
  for (const [k, v] of Object.entries(obj.full || {})) { try { full[k] = safeUrl(v, base); } catch (_) { /* skip bad link */ } }
  if (obj.minShell !== undefined && !parseVer(obj.minShell)) throw new Error('minShell không hợp lệ');
  return {
    version: String(obj.version).replace(/^v/, ''), date: String(obj.date || ''), notes: String(obj.notes || '').slice(0, 20000),
    minShell: obj.minShell ? String(obj.minShell) : null, electron: obj.electron ? Number(obj.electron) : null,
    payload: { url: safeUrl(p.url, base), sha256: sha, size }, full,
  };
}

function defaultFetch() {
  if (process.versions.electron) { try { return require('electron').net.fetch; } catch (_) { /* not in main */ } }   // net.fetch follows the system proxy
  return globalThis.fetch;
}

async function getJson(url, fetchImpl) {
  const res = await (fetchImpl || defaultFetch())(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (res.status === 404) throw new Error('Kênh cập nhật chưa có bản nào (404). Xem TIEN_DO.md mục Cập nhật trong app.');
  if (!res.ok) throw new Error(`Không tải được manifest (HTTP ${res.status})`);
  const txt = await res.text();
  if (txt.length > 1e6) throw new Error('Manifest quá lớn');
  try { return JSON.parse(txt); } catch (_) { throw new Error('Manifest không phải JSON'); }
}

// env: { currentVersion, shellVersion, electronMajor, platform, arch, bad: [] }
async function check(env, opts = {}) {
  const url = opts.url || manifestUrl();
  const m = parseManifest(await getJson(url, opts.fetch), url);
  const key = `${env.platform}-${env.arch}`;
  const r = { manifest: m, current: env.currentVersion, fullUrl: m.full[key] || null };
  if (cmpVer(m.version, env.currentVersion) <= 0) return { ...r, status: 'latest' };
  if (env.bad && env.bad.includes(m.version)) return { ...r, status: 'bad', reason: `Bản ${m.version} đã lỗi khi khởi động trên máy này nên app đã quay về. Hãy tải bản đầy đủ.` };
  if (m.minShell && cmpVer(env.shellVersion, m.minShell) < 0) return { ...r, status: 'needFull', reason: `Bản ${m.version} cần cài bản đầy đủ (từ ${m.minShell} trở lên).` };
  if (m.electron && env.electronMajor && m.electron !== env.electronMajor) return { ...r, status: 'needFull', reason: `Bản ${m.version} đổi lõi Electron ${m.electron}, cần tải bản đầy đủ.` };
  return { ...r, status: 'available' };
}

// ---- minimal asar reader: check the payload has main.js and its package.json says the expected version
function readAsarHeader(fd) {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4); const jsonLen = head.readUInt32LE(12);
  if (head.readUInt32LE(0) !== 4 || jsonLen > headerSize || jsonLen > 32 * 1024 * 1024) throw new Error('không phải file asar');
  const buf = Buffer.alloc(jsonLen);
  fs.readSync(fd, buf, 0, jsonLen, 16);
  return { header: JSON.parse(buf.toString('utf8')), base: 8 + headerSize };
}

function inspectPayload(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { header, base } = readAsarHeader(fd);
    const files = header.files || {};
    if (!files['main.js'] || !files['package.json'] || files['package.json'].unpacked) throw new Error('payload thiếu main.js / package.json');
    const pj = files['package.json'];
    const buf = Buffer.alloc(pj.size);
    fs.readSync(fd, buf, 0, pj.size, base + Number(pj.offset));
    const pkg = JSON.parse(buf.toString('utf8'));
    return { name: pkg.name, version: pkg.version };
  } finally { fs.closeSync(fd); }
}

// Download -> verify sha256 + size + content -> userData/updates/payloads/<version>.asar -> staged (pending).
// Nothing is staged unless every check passes; a bad download is deleted.
async function download(m, userData, opts = {}) {
  const d = boot.dirs(userData);
  fs.mkdirSync(d.payloads, { recursive: true });
  const file = `${m.version}.asar`;
  const dest = path.join(d.payloads, file);
  const part = dest + '.part';
  try { fs.unlinkSync(part); } catch (_) { /* none */ }
  const ctrl = new AbortController();
  let idle = null;
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), opts.idleMs || 60000); };
  poke();
  let fd = null;
  try {
    const res = await (opts.fetch || defaultFetch())(m.payload.url, { redirect: 'follow', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`Không tải được bản cập nhật (HTTP ${res.status})`);
    const total = m.payload.size || Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    fd = fs.openSync(part, 'w');
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      poke();
      got += value.length;
      if (got > MAX_PAYLOAD || (m.payload.size && got > m.payload.size)) throw new Error('File tải về lớn hơn khai báo, đã huỷ');
      hash.update(value);
      fs.writeSync(fd, value);
      if (opts.onProgress) opts.onProgress({ got, total });
    }
    fs.closeSync(fd); fd = null;
    if (m.payload.size && got !== m.payload.size) throw new Error(`Tải thiếu (${got}/${m.payload.size} byte), thử lại sau`);
    const sha = hash.digest('hex');
    if (sha !== m.payload.sha256) throw new Error('Sai mã sha256: file tải về không khớp manifest, KHÔNG cài');
    const info = inspectPayload(part);
    if (info.name !== 'metatools' || info.version !== m.version) throw new Error(`Payload không đúng (gói ${info.name} ${info.version}, cần metatools ${m.version}), KHÔNG cài`);
    fs.renameSync(part, dest);
    const entry = { version: m.version, file, sha256: sha };
    boot.stage(userData, entry);
    return entry;
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    try { fs.unlinkSync(part); } catch (_) { /* none */ }
    if (e.name === 'AbortError') throw new Error('Mạng đứng quá lâu, đã huỷ tải');
    throw e;
  } finally { clearTimeout(idle); }
}

module.exports = { DEFAULT_MANIFEST_URL, CHECK_EVERY, manifestUrl, safeUrl, parseManifest, check, download, inspectPayload };
