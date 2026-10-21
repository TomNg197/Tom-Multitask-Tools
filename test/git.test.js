'use strict';
// node test/git.test.js  -- fake repos, METATOOLS_GIT_TEST=1 (local paths, accounts on host test.local)
process.env.METATOOLS_GIT_TEST = '1';
const { execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const G = require('../lib/git');

let ok = 0, tot = 0;
const chk = (n, c, x = '') => { tot++; if (c) ok++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'mt2git-'));
const sh = (c, cwd = D, env = {}) => execSync(c, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const me = { GIT_AUTHOR_NAME: 'me', GIT_AUTHOR_EMAIL: 'me@personal.com', GIT_COMMITTER_NAME: 'me', GIT_COMMITTER_EMAIL: 'me@personal.com' };
sh('git init -q --bare src.git && git init -q --bare -b main tgt.git && git init -q -b main src');
sh('echo a>a.txt && git add a.txt && git commit -qm "my secret work" && git push -q ../src.git main', path.join(D, 'src'), me);

const src = { id: 's', label: 'canhan', host: 'test.local', user: 'me', email: 'me@personal.com', auth: 'pat' };
const dst = { id: 'd', label: 'congty', host: 'test.local', user: 'cty', email: 'dev@congty.vn', auth: 'pat' };
const logs = [];
const ctx = { src, dst, srcToken: 'x', dstToken: 'y', workDir: path.join(D, 'work'), log: (m) => logs.push(m) };
const pair = { id: 'p1', srcUrl: path.join(D, 'src.git'), dstUrl: path.join(D, 'tgt.git') };

(async () => {
  // url forms
  chk('normUrl ssh->https for PAT', G.normUrl('git@github.com:org/repo.git', { auth: 'pat' }) === 'https://github.com/org/repo.git');
  chk('normUrl https->ssh for SSH', G.normUrl('https://gitlab.com/a/b', { auth: 'ssh' }) === 'git@gitlab.com:a/b.git');
  let threw = false; try { G.auth({ label: 'x', host: 'github.com', user: 'u', auth: 'pat' }, 't', 'https://gitlab.com/a/b.git'); } catch (e) { threw = /không phải máy chủ/.test(e.message); }
  chk('auth refuses wrong host', threw);
  const a = G.auth({ label: 'x', host: 'github.com', user: 'u', auth: 'pat' }, 'tok', 'https://github.com/a/b.git');
  chk('PAT per-command header, no helper', a.args.includes('credential.helper=') && a.args.some((x) => x.startsWith('http.https://github.com/.extraheader=Authorization: Basic ')));
  chk('scrub hides token', !G.scrub('Authorization: Basic abc= tok tok', 'tok').includes('tok') && !G.scrub('Authorization: Basic abc=', '').includes('abc='));
  // branch rules
  const list = [{ name: 'release/2.0', sha: '1'.repeat(40) }, { name: 'main', sha: '2'.repeat(40) }, { name: 'release/1.0', sha: '3'.repeat(40) }];
  chk('pick newest', G.pickSource(list, {}).b.name === 'release/2.0');
  chk('pick pattern', G.pickSource(list, { srcMode: 'pattern', srcBranch: 'release/*' }).b.name === 'release/2.0');
  chk('pick fixed', G.pickSource(list, { srcMode: 'fixed', srcBranch: 'main' }).b.name === 'main');
  chk('target prefix', G.targetBranch({ dstMode: 'prefix', dstBranch: 'sync/' }, 'main') === 'sync/main');
  chk('message tpl', G.commitMessage({ message: '[{date}] {branch}#{sha}' }, { branch: 'main', sha: 'abcdef1234', date: '2026-10-08T00:00' }) === '[2026-10-08] main#abcdef12');

  // T1 first push to empty target
  let p = await G.prepare(pair, ctx);
  chk('T1 prepare new branch', !p.noChange && p.newBranch && p.fileCount === 1, p.stat);
  await G.push(p, ctx);
  const log = sh('git log --all --format="%an %ae %cn %ce %B"', path.join(D, 'tgt.git'));
  chk('T1 pushed as target, no personal leak', log.includes('cty dev@congty.vn') && !log.includes('personal') && !log.includes('secret'));
  // T2 no change
  p = await G.prepare(pair, ctx); chk('T2 noChange', p.noChange);
  // T3 newest branch auto
  sh('git checkout -qb feature && echo f>f.txt && git add f.txt && git commit -qm feat && git push -q ../src.git feature && git checkout -q main', path.join(D, 'src'),
    { ...me, GIT_COMMITTER_DATE: '2030-01-01T00:00:00' });
  p = await G.prepare(pair, ctx); await G.push(p, ctx);
  chk('T3 newest branch -> same name', p.srcBranch === 'feature' && sh("git branch --format='%(refname:short)'", path.join(D, 'tgt.git')).split('\n').includes('feature'));
  // T4 target moved meanwhile -> refused, untouched
  const fixed = { ...pair, srcMode: 'fixed', srcBranch: 'main', dstMode: 'fixed', dstBranch: 'main' };
  sh('echo z>z.txt && git add z.txt && git commit -qm z && git push -q ../src.git main', path.join(D, 'src'), me);
  p = await G.prepare(fixed, ctx);
  sh('rm -rf tc && git clone -q tgt.git tc && cd tc && git checkout -q main && echo col>col.txt && git add col.txt && git -c user.name=col -c user.email=col@x commit -qm colleague && git push -q origin main');
  const before = sh('git rev-parse main', path.join(D, 'tgt.git'));
  let refused = false; try { await G.push(p, ctx); } catch (e) { refused = /từ chối/.test(e.message); }
  chk('T4 refuse when target moved', refused && before === sh('git rev-parse main', path.join(D, 'tgt.git')));
  // T5 re-prepare keeps colleague commit as parent, tree == source
  p = await G.prepare(fixed, ctx); await G.push(p, ctx);
  const tgtTree = sh('git rev-parse main^{tree}', path.join(D, 'tgt.git')); const srcTree = sh('git rev-parse main^{tree}', path.join(D, 'src.git'));
  chk('T5 tree == source, colleague kept in history', tgtTree === srcTree && sh('git log --format=%s main', path.join(D, 'tgt.git')).includes('colleague'));
  // T6 prefix target branch
  p = await G.prepare({ ...pair, srcMode: 'fixed', srcBranch: 'main', dstMode: 'prefix', dstBranch: 'sync/' }, ctx); await G.push(p, ctx);
  chk('T6 prefix branch created', sh("git branch --format='%(refname:short)'", path.join(D, 'tgt.git')).split('\n').includes('sync/main'));
  // T7 commit message edited in the confirm box before push: same tree, new message, still the target nick
  sh('echo w>w.txt && git add w.txt && git commit -qm w && git push -q ../src.git main', path.join(D, 'src'), me);
  p = await G.prepare(fixed, ctx);
  const treeBefore = sh(`git rev-parse ${p.commit}^{tree}`, path.join(D, 'work', 'dst'));
  p = await G.rewordPrepared(p, 'Sửa tay: cập nhật màn chơi\n\nchi tiết dòng 2', ctx); await G.push(p, ctx);
  chk('T7 edited commit message pushed, tree unchanged', sh('git log -1 --format=%B main', path.join(D, 'tgt.git')).startsWith('Sửa tay: cập nhật màn chơi') && sh('git rev-parse main^{tree}', path.join(D, 'tgt.git')) === treeBefore && sh('git log -1 --format=%ae main', path.join(D, 'tgt.git')) === 'dev@congty.vn');
  let empty = false; try { await G.rewordPrepared(p, '   ', ctx); } catch { empty = true; }
  chk('T8 empty commit message refused', empty);
  console.log(ok, '/', tot);
  fs.rmSync(D, { recursive: true, force: true });
  process.exit(ok === tot ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
