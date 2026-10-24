'use strict';
// node test/projsync.test.js — đồng bộ dự án qua repo Git cục bộ (METATOOLS_GIT_TEST=1 cho phép đường dẫn thường)
process.env.METATOOLS_GIT_TEST = '1';
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const PS = require('../lib/projsync');
let pass = 0, fail = 0;
const chk = (n, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' ' + extra : ''}`); };
(async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-'));
  const bare = path.join(T, 'remote.git'); execFileSync('git', ['init', '-q', '--bare', bare]);
  const acc = { auth: 'https', host: 'local', label: 'test', user: 'u' };
  const dev = (name) => ({ acc, token: '', url: bare, branch: 'main', workDir: path.join(T, name), device: name });
  const now = Date.now();
  // máy A có p1, đẩy lên repo trống
  let A = { projects: [{ id: 'p1', name: 'Ride a Pet', updatedAt: now, createdAt: now }], tombstones: {} };
  let r = await PS.sync(dev('A'), A); A = r;
  chk('A: first sync into an empty repo pushes', r.pushed && r.projects.length === 1);
  // máy B có p2, kéo về thấy p1, đẩy p1+p2
  let B = { projects: [{ id: 'p2', name: 'Hospital Pet', updatedAt: now + 1, createdAt: now + 1 }], tombstones: {} };
  r = await PS.sync(dev('B'), B); B = r;
  chk('B: gets A\'s project and keeps its own', r.projects.map((x) => x.id).join(',') === 'p1,p2');
  // A sửa p1 (mới hơn), B sửa p1 cũ hơn → bản mới nhất thắng
  A = await PS.sync(dev('A'), A);
  A.projects = A.projects.map((x) => x.id === 'p1' ? { ...x, name: 'Ride a Pet 1.2', updatedAt: now + 100 } : x);
  B.projects = B.projects.map((x) => x.id === 'p1' ? { ...x, name: 'cũ', updatedAt: now + 50 } : x);
  A = await PS.sync(dev('A'), A); B = await PS.sync(dev('B'), B);
  chk('newest edit wins on both machines', B.projects.find((x) => x.id === 'p1').name === 'Ride a Pet 1.2');
  // B xoá p2 → A đồng bộ thì p2 biến mất, không hồi sinh
  B.projects = B.projects.filter((x) => x.id !== 'p2'); B.tombstones = { ...B.tombstones, p2: Date.now() + 1000 };
  B = await PS.sync(dev('B'), B); A = await PS.sync(dev('A'), A);
  chk('deleted project stays deleted on the other machine', !A.projects.some((x) => x.id === 'p2') && A.tombstones.p2 > 0);
  // không đổi gì thì không đẩy commit mới
  r = await PS.sync(dev('A'), A);
  chk('no change → nothing pushed', r.pushed === false);
  // file trên repo đọc được, đúng định dạng
  const txt = execFileSync('git', ['--git-dir', bare, 'show', 'main:projects.json']).toString();
  const j = JSON.parse(txt); chk('projects.json on the repo is valid JSON with version 1', j.version === 1 && Array.isArray(j.projects));
  // merge thuần
  const m = PS.merge({ projects: [{ id: 'x', updatedAt: 5 }], tombstones: { y: 9 } }, { projects: [{ id: 'y', updatedAt: 3 }, { id: 'x', updatedAt: 7, n: 2 }], tombstones: {} });
  chk('merge: tombstone beats older edit, newer edit wins', m.projects.length === 1 && m.projects[0].n === 2);
  console.log(`${pass} / ${pass + fail}`); fs.rmSync(T, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
