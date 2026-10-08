'use strict';
// Git pair engine: pull a branch with a SOURCE account, push one snapshot commit with a TARGET account.
// Each account authenticates with a Personal Access Token (HTTPS) or its own SSH key, given to EACH git command
// (never stored in .git/config, URLs or ~/.ssh/config, no credential helper).
// The snapshot commit is built with commit-tree from the source tree: source history, names and emails never travel.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TEST_MODE = process.env.METATOOLS_GIT_TEST === '1';   // allows file:// / local paths for the test-suite

function hostKind(host) {
  return /github/i.test(host) ? 'github' : 'gitlab';
}

// any pasted repo address -> the form this account uses (https for PAT, git@host:path for SSH)
function normUrl(url, acc) {
  url = (url || '').trim();
  if (TEST_MODE && (url.startsWith('/') || url.startsWith('file://'))) return url;
  let host, repo;
  let m = url.match(/^(?:ssh:\/\/)?git@([^:/]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/);
  if (m) { host = m[1]; repo = m[2]; }
  m = m || url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m && !host) { host = m[1]; repo = m[2]; }
  if (!host) throw new Error(`Không hiểu địa chỉ repo: ${url} (dán link HTTPS hoặc SSH của repo)`);
  if (acc && acc.auth === 'ssh') return `git@${host}:${repo}.git`;
  return `https://${host}/${repo}.git`;
}

function urlHost(url) {
  const m = url.match(/^https:\/\/([^/]+)\//) || url.match(/^git@([^:]+):/);
  return m ? m[1].toLowerCase() : null;
}

function sshCommand(keyPath) {
  const k = keyPath.replace(/\\/g, '/');
  return `ssh -i "${k}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=20`;
}

function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(opts.env || {}) },
      maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout || '', err: stderr || '' }));
  });
}

function scrub(text, token) {
  if (!text) return '';
  let t = String(text);
  if (token) t = t.split(token).join('***');
  return t.replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: Basic ***');
}

// {args, env} that authenticate THIS command only
function auth(acc, token, url) {
  if (TEST_MODE && !/^(https:|git@)/.test(url)) return { args: [], env: {} };
  const host = urlHost(url);
  if (!host) throw new Error(`Địa chỉ repo không hợp lệ: ${url}`);
  if (host !== acc.host.toLowerCase()) throw new Error(`Repo ${url} nằm trên ${host}, không phải máy chủ của nick "${acc.label}" (${acc.host}). Dừng để tránh nhầm tài khoản.`);
  if (acc.auth === 'ssh') {
    if (!acc.keyPath || !fs.existsSync(acc.keyPath)) throw new Error(`Nick "${acc.label}" chưa có file SSH key (${acc.keyPath || 'trống'}).`);
    return { args: ['-c', 'core.sshCommand=' + sshCommand(acc.keyPath)], env: { GIT_SSH_COMMAND: sshCommand(acc.keyPath) } };
  }
  if (!token) throw new Error(`Nick "${acc.label}" chưa có token.`);
  const basic = Buffer.from(`${acc.user}:${token}`).toString('base64');
  return { args: ['-c', 'credential.helper=', '-c', `http.https://${host}/.extraheader=Authorization: Basic ${basic}`], env: {} };
}

// ---- SSH keys
function fixKeyAcl(p) {
  // Windows OpenSSH refuses keys readable by others ("Bad owner or permissions" / "UNPROTECTED PRIVATE KEY")
  if (process.platform !== 'win32' || !p || !fs.existsSync(p)) {
    try { if (p && fs.existsSync(p)) fs.chmodSync(p, 0o600); } catch (_) { /* ignore */ }
    return Promise.resolve();
  }
  const user = process.env.USERNAME || require('os').userInfo().username;
  const steps = [['/inheritance:r'], ['/remove', '*S-1-3-4'], ['/grant:r', `${user}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F']];
  return steps.reduce((pr, a) => pr.then(() => new Promise((res) => execFile('icacls', [p, ...a], { windowsHide: true }, () => res()))), Promise.resolve());
}

function genKey(keyPath, comment) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    if (fs.existsSync(keyPath)) return fixKeyAcl(keyPath).then(() => resolve(readPub(keyPath)));
    execFile('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-C', comment, '-f', keyPath], { windowsHide: true }, (err, so, se) => {
      if (err || !fs.existsSync(keyPath)) return reject(new Error('Không tạo được SSH key (máy có ssh-keygen chưa? Windows: cài Git for Windows hoặc OpenSSH). ' + (se || '')));
      fixKeyAcl(keyPath).then(() => resolve(readPub(keyPath)));
    });
  });
}

function readPub(keyPath) {
  const p = keyPath + '.pub';
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
}

function sshWhoami(acc) {
  return new Promise((resolve, reject) => {
    fixKeyAcl(acc.keyPath).then(() => {
      execFile('ssh', ['-T', '-i', acc.keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=20', `git@${acc.host}`], { windowsHide: true, timeout: 30000 }, (err, so, se) => {
        const text = `${so || ''} ${se || ''}`;
        for (const re of [/Hi ([^!\s]+)!/, /Welcome to GitLab, @([^!\s]+)!/, /logged in as (\S+?)\.?\s/, /Hi there, ([^!\s]+)!/]) {
          const m = text.match(re);
          if (m) return resolve({ login: m[1], expires: null });
        }
        if (/Bad owner or permissions|UNPROTECTED PRIVATE KEY|bad permissions/i.test(text)) return reject(new Error('SSH từ chối file key vì quyền truy cập sai. Thử Kiểm tra lại; nếu còn lỗi, xem mục SSH trong Hướng dẫn.'));
        if (/Permission denied \(publickey\)/i.test(text)) return reject(new Error('Máy chủ chưa nhận key này. Đã dán public key lên trang SSH keys của nick chưa?'));
        reject(new Error('Không đăng nhập SSH được: ' + text.trim().slice(0, 300)));
      });
    });
  });
}

function apiGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'MetaTools', Accept: 'application/json', ...headers }, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, headers: res.headers, json, raw: body.slice(0, 300) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Hết thời gian chờ máy chủ')));
    req.on('error', reject);
  });
}

// Who does this token belong to? -> {login, expires}
async function whoami(acc, token) {
  if (TEST_MODE && acc.host === 'test.local') return { login: acc.user, expires: null };
  if (acc.auth === 'ssh') return sshWhoami(acc);
  if (!token) throw new Error(`Nick "${acc.label}" chưa có token.`);
  const host = acc.host.toLowerCase();
  if (hostKind(host) === 'github') {
    const base = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
    const r = await apiGet(`${base}/user`, { Authorization: `Bearer ${token}` });
    if (r.status !== 200 || !r.json) throw new Error(r.status === 401 ? 'Token sai hoặc đã hết hạn (GitHub trả 401).' : `GitHub trả lỗi ${r.status}: ${r.raw}`);
    return { login: r.json.login, expires: r.headers['github-authentication-token-expiration'] || null };
  }
  const base = `https://${host}/api/v4`;
  const r = await apiGet(`${base}/user`, { 'PRIVATE-TOKEN': token });
  if (r.status !== 200 || !r.json) throw new Error(r.status === 401 ? 'Token sai, hết hạn hoặc thiếu quyền read_user (GitLab trả 401).' : `GitLab trả lỗi ${r.status}: ${r.raw}`);
  let expires = null;
  try {
    const s = await apiGet(`${base}/personal_access_tokens/self`, { 'PRIVATE-TOKEN': token });
    if (s.status === 200 && s.json) expires = s.json.expires_at || null;
  } catch (_) { /* optional */ }
  return { login: r.json.username, expires };
}

async function verify(acc, token, log) {
  log && log(`Kiểm tra nick "${acc.label}" trên ${acc.host}...`);
  const who = await whoami(acc, token);
  if (String(who.login).toLowerCase() !== String(acc.user).toLowerCase()) {
    throw new Error(`Token của nick "${acc.label}" đăng nhập là "${who.login}", KHÔNG phải "${acc.user}". Dừng để tránh nhầm tài khoản.`);
  }
  log && log(`Đúng nick: ${acc.host} / ${who.login}${who.expires ? ` (token hết hạn ${who.expires})` : ''}`, 'ok');
  return who;
}

async function must(p, what, token) {
  const r = await p;
  if (r.code !== 0) throw new Error(`${what} thất bại: ${scrub((r.err || r.out).trim(), token).slice(0, 400)}`);
  return r.out;
}

async function ensureRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'HEAD')) && !fs.existsSync(path.join(dir, '.git'))) {
    await must(run(['init', '--bare', '-q', dir]), 'Tạo repo làm việc');
  }
}

// fetch every branch of url into refs/remotes/origin/*
async function fetchAll(dir, acc, token, url, log) {
  log && log(`Tải về từ ${url} ...`, 'cmd');
  const a = auth(acc, token, url);
  await must(run([...a.args, 'fetch', '--prune', '--no-tags', url, '+refs/heads/*:refs/remotes/origin/*'], { cwd: dir, env: a.env }),
    `Tải repo ${url}`, token);
}

function globRe(pattern) {
  return new RegExp('^' + pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

// srcMode: newest | fixed | pattern
function pickSource(list, pair) {
  const mode = pair.srcMode || (pair.srcBranch ? 'fixed' : 'newest');
  if (mode === 'fixed') {
    const b = list.find((x) => x.name === pair.srcBranch);
    if (!b) throw new Error(`Repo nguồn không có nhánh "${pair.srcBranch}". Có: ${list.map((x) => x.name).slice(0, 15).join(', ')}`);
    return { b, why: 'cố định' };
  }
  if (mode === 'pattern') {
    const re = globRe(pair.srcBranch || '*');
    const b = list.find((x) => re.test(x.name));   // list is newest first
    if (!b) throw new Error(`Không có nhánh nào khớp mẫu "${pair.srcBranch}".`);
    return { b, why: `mới nhất khớp "${pair.srcBranch}"` };
  }
  return { b: list[0], why: 'mới nhất' };
}

// dstMode: same | fixed | prefix
function targetBranch(pair, srcBranch) {
  const mode = pair.dstMode || (pair.dstBranch ? 'fixed' : 'same');
  if (mode === 'fixed' && pair.dstBranch) return pair.dstBranch;
  if (mode === 'prefix') return (pair.dstBranch || '') + srcBranch;
  return srcBranch;
}

function commitMessage(pair, s) {
  const tpl = pair.message || 'Sync {branch} @ {sha}';
  return tpl.replace(/\{branch\}/g, s.branch).replace(/\{sha\}/g, s.sha.slice(0, 8)).replace(/\{date\}/g, (s.date || '').slice(0, 10));
}

async function branches(dir) {
  const out = await must(run(['for-each-ref', '--sort=-committerdate', '--format=%(refname:strip=3)\t%(objectname)\t%(committerdate:iso-strict)', 'refs/remotes/origin'], { cwd: dir }), 'Đọc danh sách nhánh');
  return out.split('\n').filter(Boolean).map((l) => { const [name, sha, date] = l.split('\t'); return { name, sha, date }; }).filter((b) => b.name !== 'HEAD');
}

async function pull(pair, ctx) {
  const { src, srcToken, workDir, log } = ctx;
  await verify(src, srcToken, log);
  const url = normUrl(pair.srcUrl, src);
  const dir = path.join(workDir, 'src');
  await ensureRepo(dir);
  await fetchAll(dir, src, srcToken, url, log);
  const list = await branches(dir);
  if (!list.length) throw new Error('Repo nguồn chưa có nhánh nào.');
  const { b, why } = pickSource(list, pair);
  log && log(`Nhánh nguồn (${why}): ${b.name} @ ${b.sha.slice(0, 8)} (${b.date})`, 'ok');
  return { branch: b.name, sha: b.sha, date: b.date, dir };
}

async function prepare(pair, ctx) {
  const { dst, dstToken, workDir, log } = ctx;
  const s = await pull(pair, ctx);
  await verify(dst, dstToken, log);
  const url = normUrl(pair.dstUrl, dst);
  const dir = path.join(workDir, 'dst');
  await ensureRepo(dir);
  await fetchAll(dir, dst, dstToken, url, log);
  const dstBranch = targetBranch(pair, s.branch);
  const list = await branches(dir);
  const existing = list.find((x) => x.name === dstBranch);
  const parent = existing ? existing.sha : (list[0] ? list[0].sha : null);
  // bring the source objects in (local fetch), take only the TREE
  await must(run(['fetch', '-q', '--no-tags', s.dir, s.sha], { cwd: dir }), 'Chép code nguồn sang repo đích');
  const tree = (await must(run(['rev-parse', `${s.sha}^{tree}`], { cwd: dir }), 'Đọc cây thư mục')).trim();
  const parentTree = parent ? (await must(run(['rev-parse', `${parent}^{tree}`], { cwd: dir }), 'Đọc nhánh đích')).trim() : null;
  const noChange = parentTree === tree && !!existing;
  const msg = commitMessage(pair, s);
  const now = new Date().toISOString();
  const env = { GIT_AUTHOR_NAME: dst.user, GIT_AUTHOR_EMAIL: dst.email, GIT_COMMITTER_NAME: dst.user, GIT_COMMITTER_EMAIL: dst.email, GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now };
  let commit = null; let stat = ''; let files = []; let fileCount = 0;
  if (!noChange) {
    commit = (await must(run(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg], { cwd: dir, env }), 'Tạo commit')).trim();
    if (parent) {
      stat = (await must(run(['diff', '--shortstat', parent, commit], { cwd: dir }), 'So khác biệt')).trim();
      const ns = (await must(run(['diff', '--name-status', parent, commit], { cwd: dir }), 'Liệt kê file')).split('\n').filter(Boolean);
      fileCount = ns.length; files = ns.slice(0, 200);
    } else {
      const ls = (await must(run(['ls-tree', '-r', '--name-only', commit], { cwd: dir }), 'Liệt kê file')).split('\n').filter(Boolean);
      fileCount = ls.length; files = ls.slice(0, 200).map((f) => `A\t${f}`); stat = `${fileCount} file (nhánh mới, repo trống)`;
    }
  }
  const attrs = await run(['show', `${s.sha}:.gitattributes`], { cwd: dir });
  const lfs = attrs.code === 0 && /filter=lfs/.test(attrs.out);
  log && log(noChange ? 'Repo đích đã giống hệt code nguồn, không có gì để đẩy.' : `Đã chuẩn bị 1 commit: ${stat}`, 'ok');
  return {
    pairId: pair.id, noChange, commit, parent, dstBranch, newBranch: !existing, srcBranch: s.branch, sha: s.sha, srcDate: s.date,
    message: msg, dstUser: dst.user, dstEmail: dst.email, dstHost: dst.host, dstUrl: url, stat, files, fileCount, lfs,
  };
}

async function push(prepared, ctx) {
  const { dst, dstToken, workDir, log } = ctx;
  if (prepared.noChange || !prepared.commit) throw new Error('Không có gì để đẩy.');
  await verify(dst, dstToken, log);
  const dir = path.join(workDir, 'dst');
  // never force: if the target moved since prepare, git refuses (non-fast-forward)
  const a = auth(dst, dstToken, prepared.dstUrl);
  const r = await run([...a.args, 'push', '--porcelain', prepared.dstUrl, `${prepared.commit}:refs/heads/${prepared.dstBranch}`], { cwd: dir, env: a.env });
  if (r.code !== 0) {
    const t = scrub(r.err + r.out, dstToken);
    if (/rejected|non-fast-forward|fetch first/i.test(t)) throw new Error('Push bị từ chối: repo đích vừa có thay đổi mới. Bấm Pull + Push lại để chuẩn bị bản mới (tool không bao giờ ghi đè).');
    throw new Error(`Push thất bại: ${t.trim().slice(0, 400)}`);
  }
  log && log(`Đã đẩy ${prepared.commit.slice(0, 8)} lên ${prepared.dstBranch}`, 'ok');
  return { pushedAt: new Date().toISOString(), commit: prepared.commit };
}

async function gitVersion() {
  const r = await run(['--version']);
  return r.code === 0 ? r.out.trim() : null;
}

module.exports = { normUrl, hostKind, whoami, verify, pull, prepare, push, gitVersion, scrub, auth, genKey, readPub, fixKeyAcl, pickSource, targetBranch, commitMessage, globRe };
