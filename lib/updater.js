'use strict';
// In-app update (asar-level): read the JSON manifest, download the new app payload (.asar), verify its sha256
// (mandatory) + that it really is a MetaTools payload of that version, then stage it for the next start (lib/boot.js).
// Channel: the PUBLIC release assets of GH_REPO (latest/download/metatools-update.json, no token), or any manifest URL
// from env METATOOLS_UPDATE_URL. Optional fallback, only if that manifest answers 401/403/404 (repo made private again)
// AND the owner saved a read-only PAT in Settings: read the latest release through api.github.com with the token.
// The token goes to the API host only: asset downloads answer 302 -> signed storage URL, followed WITHOUT it.
//
// manifest (metatools-update.json, built by scripts/make-update-manifest.js in the release workflow):
//   { schema: 1, version: "2.3.1", date, notes, minShell: "2.3.0", electron: 44,
//     payload: { url, sha256, size },  full: { "win32-x64": url, "darwin-arm64": url, "darwin-x64": url } }
// A payload only replaces JS/UI; a new Electron (or minShell above the installed shell) needs the full zip -> "needFull".
const path = require('path');
const crypto = require('crypto');
const boot = require('./boot');
const { fs, cmpVer, parseVer } = boot;

const GH_REPO = 'TomNg197/Tom-Multitask-Tools';
const MANIFEST_ASSET = 'metatools-update.json';
const MAX_PAYLOAD = 200 * 1024 * 1024;
const CHECK_EVERY = 6 * 3600 * 1000;   // automatic check at most every 6 hours
const NO_TOKEN = 'Chưa có token để kiểm tra cập nhật';
const BAD_TOKEN = 'Token không đọc được repo';

const DEFAULT_MANIFEST_URL = `https://github.com/${GH_REPO}/releases/latest/download/${MANIFEST_ASSET}`;

function manifestUrl() { return (process.env.METATOOLS_UPDATE_URL || '').trim() || DEFAULT_MANIFEST_URL; }
function ghApi() { return safeUrl((process.env.METATOOLS_GH_API || '').trim() || 'https://api.github.com').replace(/\/$/, ''); }   // env: tests only
function channel() { return manifestUrl(); }

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

async function readJson(res) {
  const txt = await res.text();
  if (txt.length > 1e6) throw new Error('Manifest quá lớn');
  try { return JSON.parse(txt); } catch (_) { throw new Error('Manifest không phải JSON'); }
}

async function getJson(url, fetchImpl) {
  const res = await (fetchImpl || defaultFetch())(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const e = new Error(res.status === 404
      ? 'Không thấy bản cập nhật (404): release mới nhất chưa có metatools-update.json, hoặc repo đang private (khi đó dán GitHub token ở Cài đặt → Cập nhật).'
      : `Không tải được manifest (HTTP ${res.status})`);
    e.status = res.status;
    throw e;
  }
  return readJson(res);
}

// ---- GitHub API with the token. The Authorization header is only ever sent to the API origin; a redirect elsewhere
// (asset download -> signed S3/objects URL) is followed with a plain request. Node's fetch (undici) is used here because
// it hands back the 3xx response itself with redirect: 'manual'. Error messages never contain the token.
async function ghGet(url, token, accept, opts = {}) {
  const api = new URL(ghApi());
  const fetchImpl = opts.fetch || globalThis.fetch;
  let u = new URL(url);
  if (u.origin !== api.origin) throw new Error('Chặn: chỉ gửi token tới ' + api.origin);
  let res = await fetchImpl(u.toString(), {
    redirect: 'manual', cache: 'no-store', signal: opts.signal,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MetaTools-updater' },
  });
  let authed = true;
  for (let hop = 0; res.status >= 300 && res.status < 400 && hop < 5; hop++) {
    const loc = res.headers.get('location');
    if (!loc) break;
    u = new URL(safeUrl(loc, u.toString()));
    // the token follows only while we stay on the API host; once we left it, it is gone for good
    authed = authed && u.origin === api.origin;
    const headers = { Accept: accept, 'User-Agent': 'MetaTools-updater' };
    if (authed) { headers.Authorization = `Bearer ${token}`; headers['X-GitHub-Api-Version'] = '2022-11-28'; }
    res = await fetchImpl(u.toString(), { redirect: 'manual', cache: 'no-store', signal: opts.signal, headers });
  }
  if (authed && [401, 403, 404].includes(res.status)) throw new Error(`${BAD_TOKEN} (HTTP ${res.status})`);
  return res;
}

// latest release of GH_REPO -> manifest (payload.url = the asset's API URL, downloaded with the token via ghGet)
async function ghManifest(token, opts = {}) {
  if (!token) throw new Error(NO_TOKEN);
  const api = ghApi();
  const rel = await ghGet(`${api}/repos/${GH_REPO}/releases/latest`, token, 'application/vnd.github+json', { ...opts, signal: AbortSignal.timeout(20000) });
  if (!rel.ok) throw new Error(`GitHub trả lỗi HTTP ${rel.status}`);
  const r = await readJson(rel);
  const assets = Array.isArray(r.assets) ? r.assets : [];
  const asset = (name) => assets.find((a) => a && a.name === name);
  const ma = asset(MANIFEST_ASSET);
  if (!ma) throw new Error(`Release ${r.tag_name || ''} chưa có ${MANIFEST_ASSET} (bản build cũ?)`);
  const mres = await ghGet(ma.url, token, 'application/octet-stream', { ...opts, signal: AbortSignal.timeout(30000) });
  if (!mres.ok) throw new Error(`Không tải được manifest (HTTP ${mres.status})`);
  const raw = await readJson(mres);
  const want = path.posix.basename(new URL(String((raw.payload || {}).url || 'x:'), 'https://x/').pathname);
  const pa = asset(want);
  if (!pa) throw new Error(`Release ${r.tag_name || ''} thiếu file ${want}`);
  if (new URL(String(pa.url)).origin !== new URL(api).origin) throw new Error('Link asset lạ, không tải');
  raw.payload = { ...raw.payload, url: pa.url };
  const m = parseManifest(raw, api);
  m.payload.github = true;
  m.releaseUrl = typeof r.html_url === 'string' && /^https:\/\/github\.com\//.test(r.html_url) ? r.html_url : null;
  return m;
}

// env: { currentVersion, shellVersion, electronMajor, platform, arch, bad: [] }
// opts: { url, token, fetch }. The token is only used for the private-repo fallback described at the top.
async function loadManifest(opts) {
  const url = opts.url || manifestUrl();
  try {
    return parseManifest(await getJson(url, opts.fetch), url);
  } catch (e) {
    if (opts.token && [401, 403, 404].includes(e.status)) return ghManifest(opts.token, opts);
    throw e;
  }
}

async function check(env, opts = {}) {
  const m = await loadManifest(opts);
  const key = `${env.platform}-${env.arch}`;
  // private repo: zip links need a login, so open the release page in the browser instead
  const r = { manifest: m, current: env.currentVersion, fullUrl: m.releaseUrl || m.full[key] || null };
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
    const res = m.payload.github
      ? await ghGet(m.payload.url, opts.token, 'application/octet-stream', { fetch: opts.fetch, signal: ctrl.signal })
      : await (opts.fetch || defaultFetch())(m.payload.url, { redirect: 'follow', cache: 'no-store', signal: ctrl.signal });
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

module.exports = { GH_REPO, DEFAULT_MANIFEST_URL, CHECK_EVERY, NO_TOKEN, BAD_TOKEN, manifestUrl, channel, safeUrl, parseManifest, ghGet, ghManifest, check, download, inspectPayload };
