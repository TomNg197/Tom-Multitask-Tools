'use strict';
// Runs inside the real Electron app when METATOOLS_SELFTEST=<outdir>. Drives the UI + IPC handlers, saves screenshots,
// writes <outdir>/result.json, then quits. Used on the build pod (Xvfb) before shipping.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { app } = require('electron');

module.exports = async function selftest(ctx) {
  const out = process.env.METATOOLS_SELFTEST;
  fs.mkdirSync(out, { recursive: true });
  const res = [];
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = (js) => ctx.win.webContents.executeJavaScript(js, true);
  const shot = async (name, wc) => {
    try { const img = await (wc || ctx.win.webContents).capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); } catch (e) { console.log('shot failed', name, e.message); }
  };
  const call = async (ch, arg) => { const r = await ctx.handlers[ch](arg || {}); return r; };
  try {
    ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await wait(1200);
    await shot('01_empty');
    chk('empty state shown', await ui("!document.getElementById('pEmpty').classList.contains('hidden')"));

    // profiles
    const p1 = await call('prof:save', { name: 'Công ty MetaX', slackUrl: '', gmail: 'thomas@metax.vn', color: '#7c4dff' });
    const p2 = await call('prof:save', { name: 'Khách A', slackUrl: 'https://app.slack.com/client', color: '#e91e63' });
    let bad = false; try { await call('prof:save', { name: 'x', slackUrl: 'https://evil.com' }); } catch (e) { bad = /Slack/.test(e.message); }
    chk('reject non-slack url', bad);
    await ui('refresh()'); await wait(400);
    await ui(`selectProfile(${JSON.stringify(p1.id)})`);
    await wait(8000);
    const v1 = ctx.views[p1.id] && ctx.views[p1.id].slack;
    chk('slack view created + attached', v1 && ctx.win.contentView.children.includes(v1));
    const ua = v1.webContents.getUserAgent();
    chk('UA has no Electron token', !/Electron/i.test(ua), ua);
    const url = v1.webContents.getURL();
    chk('slack page loaded', /slack\.com/.test(url), url);
    await shot('02_slack_view', v1.webContents);
    await shot('02_ui_frame');

    // switch to the other profile, then a message arrives on p1 (Slack keeps running hidden)
    await ui(`selectProfile(${JSON.stringify(p2.id)})`); await wait(5000);
    const perm = await v1.webContents.executeJavaScript("new Notification('Nguyễn Văn B', { body: 'Anh ơi build mới lên chưa?' }); Notification.permission");
    await wait(800);
    chk('notification captured from hidden profile', perm === 'granted' && ctx.events.length === 1 && ctx.events[0].p === p1.id && /build/.test(ctx.events[0].b) && !ctx.events[0].read, JSON.stringify(ctx.events[0] || {}));
    await ctx.win.webContents.executeJavaScript('render()'); await wait(300);
    const badge = await ui(`(document.querySelector('.bub[data-id="${p1.id}"] .cnt')||{}).textContent||''`);
    chk('badge on profile 1', badge === '1', badge);
    await shot('03_badge');

    // the visible Slack view (profile 2) really renders Slack, not an "unsupported browser" page
    const v2s = ctx.views[p2.id] && ctx.views[p2.id].slack;
    let txt = '';
    for (let i = 0; i < 40 && v2s && txt.length < 40; i++) { await wait(500); txt = await v2s.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 2000) : ""'); }
    chk('slack renders (no unsupported-browser)', v2s && txt.length > 20 && !/unsupported|not supported|isn.t supported|không được hỗ trợ/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));
    await shot('03b_slack_p2', v2s.webContents);
    // google tab
    await ui("selectTab('google')"); await wait(6000);
    const g = ctx.views[p2.id] && ctx.views[p2.id].google;
    chk('google view loaded', g && /google\.com/.test(g.webContents.getURL()), g && g.webContents.getURL());
    // link routing: window.open to drive from slack view -> google tab of same profile
    const v2 = ctx.views[p2.id].slack;
    await v2.webContents.executeJavaScript("window.open('https://docs.google.com/document/d/test123/edit'); 1");
    await wait(2500);
    chk('google link routed into profile google tab', /docs\.google\.com|accounts\.google\.com/.test(g.webContents.getURL()) && ctx.current().tab === 'google', g.webContents.getURL());

    // translation: select Vietnamese text in an editable box of the visible Slack view, Ctrl+Shift+E, replace
    await ui(`selectProfile(${JSON.stringify(p2.id)})`); await ui("selectTab('slack')"); await wait(1500);
    await v2s.webContents.executeJavaScript(`(() => { const d = document.createElement('div'); d.id = 'mtt'; d.contentEditable = 'true';
      d.textContent = 'Anh ơi build mới lên chưa? Em cần test gấp.'; d.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:#ff0;padding:8px';
      document.body.appendChild(d); d.focus(); const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return String(s); })()`);
    v2s.webContents.focus();
    v2s.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'E', modifiers: ['control', 'shift'] });
    let trText = '';
    for (let i = 0; i < 40 && !trText; i++) { await wait(300); trText = await ui("(document.getElementById('tr_out')||{}).textContent||''"); }
    chk('shortcut translates selection to English', /build|test/i.test(trText) && !/ơi/.test(trText), trText);
    await shot('09_translate');
    await ui("document.getElementById('tr_rep').click()"); await wait(1200);
    const after = await v2s.webContents.executeJavaScript("document.getElementById('mtt').textContent");
    chk('replace puts the translation into the editor', after.trim() === trText.trim(), after);
    const menuSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    chk('right-click menu has translate + edit items', /Dịch sang tiếng Anh/.test(menuSrc) && /role: 'paste'/.test(menuSrc));

    // git: fake repos (METATOOLS_GIT_TEST=1)
    const D = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mt2sel-'));
    const sh = (c, cwd = D, env = {}) => execSync(c, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' }).toString().trim();
    const me = { GIT_AUTHOR_NAME: 'me', GIT_AUTHOR_EMAIL: 'me@personal.com', GIT_COMMITTER_NAME: 'me', GIT_COMMITTER_EMAIL: 'me@personal.com' };
    sh('git init -q --bare src.git && git init -q --bare -b main tgt.git && git init -q -b main src');
    sh('echo a>a.txt && mkdir -p game && echo b>game/b.cs && git add . && git commit -qm "secret wip" && git push -q ../src.git main', path.join(D, 'src'), me);
    const a1 = await call('git:saveAccount', { profileId: p1.id, label: 'Github cá nhân', host: 'test.local', user: 'me', email: 'me@personal.com', auth: 'pat', token: 'tok-personal' });
    const a2 = await call('git:saveAccount', { profileId: p1.id, label: 'Gitlab công ty', host: 'test.local', user: 'cty', email: 'dev@metax.vn', auth: 'pat', token: 'tok-company' });
    chk('token encrypted at rest', !fs.readFileSync(path.join(app.getPath('userData'), 'secrets.json'), 'utf8').includes('tok-company'));
    chk('token readable back', ctx.store.getToken(a2.id) === 'tok-company');
    const a3 = await call('git:saveAccount', { profileId: p2.id, label: 'SSH demo', host: 'github.com', user: 'demo', email: 'd@x.vn', auth: 'ssh' });
    chk('ssh key generated', a3.pub.startsWith('ssh-ed25519 '), a3.pub.slice(0, 40));
    const pr = await call('git:savePair', { profileId: p1.id, name: 'Game A → repo công ty', srcAcc: a1.id, srcUrl: path.join(D, 'src.git'), srcMode: 'newest', dstAcc: a2.id, dstUrl: path.join(D, 'tgt.git'), dstMode: 'prefix', dstBranch: 'sync/', message: 'Sync {branch} @ {sha}' });
    await ui(`selectProfile(${JSON.stringify(p1.id)})`); await ui("selectTab('git')"); await wait(800);
    await shot('04_git_tab');
    await call('git:run', { pairId: pr.id, kind: 'prepare' });
    for (let i = 0; i < 60 && !(ctx.store && (await call('git:log', {})).done); i++) await wait(250);
    await wait(800);
    chk('confirm modal shown', await ui("!document.getElementById('modal').classList.contains('hidden') && document.getElementById('modalBox').textContent.includes('Xác nhận')"));
    await shot('05_confirm_push');
    await ui("document.getElementById('c_push').click()");
    for (let i = 0; i < 60; i++) { await wait(250); const l = await call('git:log', {}); if (l.done && /Push/.test(l.lines[0] ? '' : '') === false) break; }
    await wait(1500);
    const br = sh("git branch --format='%(refname:short)'", path.join(D, 'tgt.git'));
    const lg = sh("git log --all --format='%an %ae %B'", path.join(D, 'tgt.git'));
    chk('pushed to sync/main as company nick', br.split('\n').includes('sync/main') && lg.includes('cty dev@metax.vn') && !lg.includes('secret') && !lg.includes('personal'), br + ' | ' + lg);
    await ui('renderGit()'); await wait(600);
    await shot('06_git_after');

    // feed + settings panels
    await ui("panel='feed'; render()"); await wait(500); await shot('07_feed');
    await ui("panel='settings'; render()"); await wait(400); await shot('08_settings');
    const exp = ctx.store.exportData();
    chk('export has no tokens/keys', !JSON.stringify(exp).includes('tok-') && !JSON.stringify(exp).includes('_ed25519'));
    // tray-hide on close
    ctx.win.close(); await wait(500);
    chk('close hides to tray (app alive)', !ctx.win.isDestroyed() && !ctx.win.isVisible());
    fs.rmSync(D, { recursive: true, force: true });
  } catch (e) {
    chk('selftest crashed', false, e.stack || e.message);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('SELFTEST', res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
