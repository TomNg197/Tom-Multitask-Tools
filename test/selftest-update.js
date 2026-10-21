'use strict';
// In-app part of the updater end-to-end test (test/update.e2e.js runs the real app several times, one step each).
// METATOOLS_UPDATE_SELFTEST=<outdir>, METATOOLS_UPDATE_STEP=A|B|D. Writes <outdir>/result.json, then quits.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async function selftestUpdate(ctx) {
  const out = process.env.METATOOLS_UPDATE_SELFTEST;
  const step = process.env.METATOOLS_UPDATE_STEP;
  fs.mkdirSync(out, { recursive: true });
  const res = [];
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', `[${step}]`, n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = (js) => ctx.win.webContents.executeJavaScript(js, true);
  const shot = async (name) => { try { fs.writeFileSync(path.join(out, name + '.png'), (await ctx.win.webContents.capturePage()).toPNG()); } catch (e) { console.log('shot failed', e.message); } };
  const call = (ch, a) => ctx.handlers[ch](a || {});
  try {
    ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await wait(800);
    chk('UI preload works', await ui("typeof mt === 'object' && typeof mt.call === 'function'"));
    const st = await call('app:state');
    if (step === 'A') {
      chk('runs bundled 2.3.0', st.version === '2.3.0' && !st.update.fromPayload, st.version);
      const c = await call('upd:check');
      chk('check finds 2.3.1', c.state === 'available' && c.latest.version === '2.3.1', c.state + ' ' + c.error);
      await ui("panel='settings'; refresh()"); await wait(600);
      chk('settings shows new version + notes', /2\.3\.1/.test(await ui("document.getElementById('updCard').textContent")) && /Bản thử e2e/.test(await ui("document.getElementById('updCard').textContent")));
      chk('update dot on settings button', await ui("!document.getElementById('updDot').classList.contains('hidden')"));
      await shot('A1_available');
      await ui("document.getElementById('u_dl').click()");
      let s = null;
      for (let i = 0; i < 100; i++) { await wait(200); s = (await call('upd:state')).state; if (s === 'ready') break; }
      chk('download -> ready', s === 'ready', s);
      await wait(400);
      chk('restart button shown', await ui("!!document.getElementById('u_restart')"));
      await shot('A2_ready');
      const bs = ctx.BOOT.boot.readState(app.getPath('userData'));
      chk('pending staged', bs.pending && bs.pending.version === '2.3.1');
    } else if (step === 'B') {
      chk('runs payload 2.3.1 on trial', st.version === '2.3.1' && st.shellVersion === '2.3.0' && ctx.BOOT.payload && ctx.BOOT.trial, `${st.version} ${ctx.BOOT.payload}`);
      chk('UI loaded from the payload', /2\.3\.1\.asar[\\/]ui[\\/]index\.html/.test(decodeURIComponent(ctx.win.webContents.getURL())), ctx.win.webContents.getURL());
      chk('main.js loaded from the payload', __dirname.includes('2.3.1.asar'), __dirname);
      for (let i = 0; i < 40 && ctx.BOOT.trial; i++) await wait(200);
      const bs = ctx.BOOT.boot.readState(app.getPath('userData'));
      chk('confirmed good after start', !ctx.BOOT.trial && bs.good && bs.tries === 0, JSON.stringify(bs));
      await ui("panel='settings'; refresh()"); await wait(600);
      await shot('B1_updated');
    } else if (step === 'D') {
      chk('rolled back to 2.3.1 after broken 2.3.2', st.version === '2.3.1' && ctx.BOOT.payload, st.version);
      chk('rollback notice', st.update.notice && st.update.notice.from === '2.3.2' && st.update.notice.to === '2.3.1', JSON.stringify(st.update.notice));
      await ui("panel='settings'; refresh()"); await wait(600);
      chk('rollback notice shown in settings', /2\.3\.2/.test(await ui("document.getElementById('updCard').textContent")));
      const bs = ctx.BOOT.boot.readState(app.getPath('userData'));
      chk('2.3.2 marked bad', bs.bad.includes('2.3.2'));
      await shot('D1_rollback');
    }
  } catch (e) {
    chk('selftest crashed', false, e.stack || e.message);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('UPDATE SELFTEST', step, res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
