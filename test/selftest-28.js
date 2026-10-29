'use strict';
// 2.8.0 — Git: one nick pair per profile, many projects, push history, no source trace in the pushed commit.
// Run: METATOOLS_USERDATA=<tmp> METATOOLS_GIT_TEST=1 METATOOLS_NO_TRAY=1 METATOOLS_28_SELFTEST=<dir> elx.sh <app>
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { app } = require('electron');

module.exports = async function selftest(ctx) {
  const out = process.env.METATOOLS_28_SELFTEST; fs.mkdirSync(out, { recursive: true });
  const res = [];
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (ch, arg) => ctx.handlers[ch](arg || {});
  const done = async () => { for (let i = 0; i < 120; i++) { const l = await call('git:log', {}); if (l.done) return l; await wait(250); } return call('git:log', {}); };
  const shot = async (n) => { const img = await ctx.win.webContents.capturePage(); fs.writeFileSync(path.join(out, n + '.png'), img.toPNG()); };
  const D = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mt28-'));
  const sh = (c, cwd = D, env = {}) => execSync(c, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' }).toString().trim();
  try {
    ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await wait(800);
    const p1 = await call('prof:save', { name: 'MetaX', notifyApps: { slack: false } });
    const me = { GIT_AUTHOR_NAME: 'tomng', GIT_AUTHOR_EMAIL: 'tom@personal.com', GIT_COMMITTER_NAME: 'tomng', GIT_COMMITTER_EMAIL: 'tom@personal.com' };
    sh('git init -q --bare secret-game.git && git init -q --bare secret-tool.git && git init -q --bare -b main cty.git && git init -q -b main w1 && git init -q -b main w2');
    sh('echo a>a.txt && git add . && git commit -qm "wip from tomng personal" && git push -q ../secret-game.git main:feature/x', path.join(D, 'w1'), me);
    sh('echo t>t.txt && git add . && git commit -qm "tool wip" && git push -q ../secret-tool.git main', path.join(D, 'w2'), me);
    const a1 = await call('git:saveAccount', { profileId: p1.id, label: 'Github cá nhân', host: 'test.local', user: 'tomng', email: 'tom@personal.com', auth: 'pat', token: 'tok-p' });
    const a2 = await call('git:saveAccount', { profileId: p1.id, label: 'Gitlab công ty', host: 'test.local', user: 'cty', email: 'dev@metax.vn', auth: 'pat', token: 'tok-c' });
    let err = ''; try { await call('git:savePair', { profileId: p1.id, name: 'X', srcUrl: path.join(D, 'secret-game.git'), dstUrl: path.join(D, 'cty.git') }); } catch (e) { err = e.message; }
    chk('project needs the profile nick pair first', /cặp nick/.test(err), err);
    const gp = await call('git:saveProfilePair', { profileId: p1.id, srcAcc: a1.id, dstAcc: a2.id });
    chk('profile nick pair saved', gp.gitPair.srcAcc === a1.id && gp.gitPair.dstAcc === a2.id);
    const g1 = await call('git:savePair', { profileId: p1.id, name: 'Game', srcUrl: path.join(D, 'secret-game.git'), dstUrl: path.join(D, 'cty.git'), dstMode: 'fixed', dstBranch: 'game' });
    const g2 = await call('git:savePair', { profileId: p1.id, name: 'Tool', srcUrl: path.join(D, 'secret-tool.git'), dstUrl: path.join(D, 'cty.git'), dstMode: 'fixed', dstBranch: 'tool' });
    chk('2 projects on 1 profile use the profile pair', [g1, g2].every((g) => g.srcAcc === a1.id && g.dstAcc === a2.id) && g1.message === 'Cập nhật {branch} {date}', g1.message);
    await ctx.ui(`selectProfile(${JSON.stringify(p1.id)})`); await ctx.ui("selectTab('git')"); await wait(800);
    console.log('RENDER', JSON.stringify(await ctx.ui("(async()=>{try{await renderGit();return 'ok '+document.getElementById('pGit').textContent.replace(/\\s+/g,' ').slice(0,300)}catch(e){return 'ERR '+e.stack}})()")));
    chk('Git tab shows nick pair card + 2 projects', await ctx.ui("document.getElementById('pGit').textContent.includes('Cặp nick của hồ sơ') && document.getElementById('pGit').textContent.includes('Dự án (2)')"));
    await shot('01_git_tab');
    // project 1: default message
    await call('git:run', { pairId: g1.id, kind: 'prepare' }); await done();
    let st = await call('git:state'); const pr1 = st.prepared[g1.id];
    chk('prepare ok, default message has target branch + today, nothing from source', pr1 && /^Cập nhật game \d{4}-\d\d-\d\d$/.test(pr1.message) && !pr1.message.includes(pr1.sha.slice(0, 7)) && !/feature/.test(pr1.message), pr1 && pr1.message);
    console.log('CONF', JSON.stringify(await ctx.ui(`(async()=>{try{await renderGit();showConfirm(GS.prepared[${JSON.stringify(g1.id)}]);return 'ok'}catch(e){return 'ERR '+e.stack}})()`))); await wait(400); await shot('02_confirm');
    await ctx.ui("closeModal()");
    // trace guard: source nick / repo name / sha in the typed message are refused, nothing pushed
    for (const bad of ['merge from tomng', 'sync secret-game', 'from ' + pr1.sha.slice(0, 7)]) {
      await call('git:push', { pairId: g1.id, message: bad }); const l = await done();
      chk(`blocked: "${bad.replace(pr1.sha.slice(0, 7), '<sha>')}"`, !l.ok && l.lines.some((x) => /dấu vết nguồn/.test(x.m)), JSON.stringify(l.lines.slice(-1)));
    }
    chk('nothing pushed while blocked', !sh("git branch --format='%(refname:short)'", path.join(D, 'cty.git')).split('\n').includes('game'));
    await call('git:push', { pairId: g1.id, message: 'Cập nhật màn chơi 1–30\n\nSửa softlock vòng rỗng' }); const lp = await done();
    chk('typed multi-line message pushed', lp.ok, JSON.stringify(lp.lines.slice(-1)));
    // project 2: default message
    await call('git:run', { pairId: g2.id, kind: 'prepare' }); await done();
    await call('git:push', { pairId: g2.id }); const lp2 = await done();
    chk('second project pushed with the same nick pair', lp2.ok, JSON.stringify(lp2.lines.slice(-1)));
    const log = sh("git log --all --format='%an|%ae|%cn|%ce|%B'", path.join(D, 'cty.git'));
    const srcShas = [sh('git rev-parse feature/x', path.join(D, 'secret-game.git')), sh('git rev-parse main', path.join(D, 'secret-tool.git'))];
    chk('target history: only company nick', log.split('\n').filter((l) => l.includes('|')).every((l) => l.startsWith('cty|dev@metax.vn|cty|dev@metax.vn|')), log);
    chk('target history: no source nick / email / repo / branch / sha', !/tomng|personal|secret|feature\/x|wip/.test(log) && srcShas.every((x) => !log.includes(x.slice(0, 7))), log);
    const objs = sh('git cat-file --batch-all-objects --batch-check', path.join(D, 'cty.git'));
    chk('target repo has no source commit objects', srcShas.every((x) => !objs.includes(x)), objs.split('\n').length + ' objects');
    st = await call('git:state');
    const h1 = st.pairs.find((x) => x.id === g1.id).history || []; const h2 = st.pairs.find((x) => x.id === g2.id).history || [];
    chk('push history per project', h1.length === 1 && h1[0].branch === 'game' && /màn chơi/.test(h1[0].message) && h2.length === 1 && h2[0].branch === 'tool', JSON.stringify([h1, h2]));
    await ctx.ui('renderGit()'); await wait(500);
    await ctx.ui(`showHistory(GS.pairs.find((x) => x.id === ${JSON.stringify(g1.id)}))`); await wait(400);
    chk('history modal lists the push', await ctx.ui("document.getElementById('modalBox').textContent.includes('Sửa softlock vòng rỗng')"));
    await shot('03_history'); await ctx.ui('closeModal()');
    // switching the profile pair re-points every project
    const a3 = await call('git:saveAccount', { profileId: p1.id, label: 'Gitlab khách', host: 'test.local', user: 'khach', email: 'k@kh.vn', auth: 'pat', token: 'tok-k' });
    const sw = await call('git:saveProfilePair', { profileId: p1.id, srcAcc: a1.id, dstAcc: a3.id });
    st = await call('git:state');
    chk('changing the nick pair applies to all projects', sw.moved === 2 && st.pairs.filter((x) => x.profileId === p1.id).every((x) => x.dstAcc === a3.id));
    let derr = ''; try { await call('git:deleteAccount', { id: a3.id }); } catch (e) { derr = e.message; }
    chk('nick used by a profile pair cannot be deleted', /cặp/.test(derr), derr);
    chk('export carries no tokens', !JSON.stringify(ctx.store.exportData()).includes('tok-'));
  } catch (e) {
    chk('selftest crashed', false, e.stack || e.message);
  }
  fs.rmSync(D, { recursive: true, force: true });
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('SELFTEST28', res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
