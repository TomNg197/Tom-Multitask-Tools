'use strict';
// 2.6.0: đồng bộ dự án giữa nhiều máy qua một repo Git riêng (file projects.json).
// Bấm Đồng bộ: tải nhánh về → gộp với máy này (theo từng dự án, bản sửa sau cùng thắng; dự án đã xoá ghi "bia mộ" để
// máy kia không hồi sinh nó) → ghi projects.json → commit → push. Bị từ chối vì máy khác vừa đẩy thì tải lại, gộp lại, thử lại.
const fs = require('fs');
const path = require('path');
const G = require('./git');

const FILE = 'projects.json';

// gộp hai danh sách: { projects: [], tombstones: { id: deletedAt } }
function merge(a, b) {
  const tomb = { ...(a.tombstones || {}) };
  for (const [id, t] of Object.entries(b.tombstones || {})) tomb[id] = Math.max(tomb[id] || 0, t || 0);
  const byId = new Map();
  for (const p of [...(a.projects || []), ...(b.projects || [])]) {
    if (!p || !p.id) continue;
    const old = byId.get(p.id);
    if (!old || (p.updatedAt || 0) > (old.updatedAt || 0)) byId.set(p.id, p);
  }
  const projects = [...byId.values()].filter((p) => !(tomb[p.id] && tomb[p.id] >= (p.updatedAt || 0)))
    .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || String(x.id).localeCompare(String(y.id)));
  // bia mộ cũ hơn 180 ngày thì bỏ cho file khỏi phình
  const cut = Date.now() - 180 * 864e5;
  for (const id of Object.keys(tomb)) if (tomb[id] < cut) delete tomb[id];
  return { projects, tombstones: tomb };
}

function stable(d) { return JSON.stringify({ app: 'Tom Multitask', kind: 'projects', version: 1, projects: d.projects, tombstones: d.tombstones }, null, 2) + '\n'; }

async function sh(args, opts, what, token) {
  const r = await G.run(args, opts);
  if (r.code !== 0) throw new Error(`${what} thất bại: ${G.scrub((r.err || r.out).trim(), token).slice(0, 400)}`);
  return r.out;
}

// cfg: { acc, token, url, branch, workDir, device, log }   local: { projects, tombstones }
async function sync(cfg, local) {
  const { acc, token, workDir } = cfg; const branch = (cfg.branch || 'main').trim() || 'main';
  const log = cfg.log || (() => {});
  const url = G.normUrl(cfg.url, acc);
  const a = G.auth(acc, token, url);
  fs.mkdirSync(workDir, { recursive: true });
  if (!fs.existsSync(path.join(workDir, '.git'))) await sh(['init', '-q', workDir], {}, 'Tạo thư mục đồng bộ');
  const git = (args, what) => sh(args, { cwd: workDir, env: a.env }, what, token);
  const gitAuth = (args, what) => sh([...a.args, ...args], { cwd: workDir, env: a.env }, what, token);
  let merged = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // nhánh chưa có (repo mới tạo) thì coi như rỗng
    log(`Tải ${branch} từ ${url} ...`);
    const f = await G.run([...a.args, 'fetch', '--no-tags', url, `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: workDir, env: a.env });
    const hasRemote = f.code === 0;
    if (!hasRemote && !/couldn't find remote ref|not found|does not appear to be|empty/i.test(f.err)) throw new Error('Tải repo đồng bộ thất bại: ' + G.scrub(f.err.trim(), token).slice(0, 400));
    let remote = { projects: [], tombstones: {} };
    if (hasRemote) {
      const s = await G.run(['show', `origin/${branch}:${FILE}`], { cwd: workDir });
      if (s.code === 0) { try { const j = JSON.parse(s.out); remote = { projects: j.projects || [], tombstones: j.tombstones || {} }; } catch (_) { throw new Error(`${FILE} trên repo bị hỏng (không đọc được JSON).`); } }
      await git(['checkout', '-q', '-B', branch, `origin/${branch}`], 'Chuẩn bị nhánh');
    } else {
      const head = await G.run(['rev-parse', '--verify', 'HEAD'], { cwd: workDir });
      if (head.code !== 0) await git(['checkout', '-q', '--orphan', branch], 'Tạo nhánh mới');
    }
    merged = merge(remote, local);
    const text = stable(merged);
    const fp = path.join(workDir, FILE);
    const before = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
    if (hasRemote && before === text) { log('Repo đã giống máy này, không cần đẩy.'); return { ...merged, pushed: false, url }; }
    fs.writeFileSync(fp, text, 'utf8');
    await git(['add', FILE], 'Thêm file');
    await git(['-c', 'user.name=Tom Multitask', '-c', 'user.email=tom-multitask@users.noreply.local', 'commit', '-q', '-m', `Đồng bộ dự án từ ${cfg.device || 'máy'} (${merged.projects.length} dự án)`], 'Commit');
    log('Đẩy lên ...');
    const p = await G.run([...a.args, 'push', url, `HEAD:refs/heads/${branch}`], { cwd: workDir, env: a.env });
    if (p.code === 0) return { ...merged, pushed: true, url };
    if (!/rejected|non-fast-forward|fetch first/i.test(p.err)) throw new Error('Đẩy lên thất bại: ' + G.scrub(p.err.trim(), token).slice(0, 400));
    log('Máy khác vừa đẩy, tải lại và gộp lần nữa ...');
  }
  throw new Error('Đồng bộ thất bại sau 3 lần thử (máy khác đang đẩy liên tục?).');
}

module.exports = { sync, merge, stable, FILE };
