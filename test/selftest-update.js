'use strict';
// In-app part of the updater end-to-end test (test/update.e2e.js runs the real app several times, one step each).
// METATOOLS_UPDATE_SELFTEST=<outdir>, METATOOLS_UPDATE_STEP=A|B|D. Writes <outdir>/result.json, then quits.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// versions relative to the app under test: V0 = installed shell, V1 = next patch (good), V2 = the one after (broken)
const bump = (v, n) => v.replace(/(\d+)$/, (d) => String(+d + n));
const rx = (v) => new RegExp(v.replace(/\./g, '\\.'));

module.exports = async function selftestUpdate(ctx) {
  const V0 = ctx.BOOT.shellVersion; const V1 = bump(V0, 1); const V2 = bump(V0, 2);
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
      chk(`runs bundled ${V0}`, st.version === V0 && !st.update.fromPayload, st.version);
      const c = await call('upd:check');
      chk(`check finds ${V1}`, c.state === 'available' && c.latest.version === V1, c.state + ' ' + c.error);
      await ui("panel='settings'; refresh()"); await wait(600);
      chk('settings shows new version + notes', rx(V1).test(await ui("document.getElementById('updCard').textContent")) && rx('Bản thử ' + V1).test(await ui("document.getElementById('updCard').textContent")));
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
      chk('pending staged', bs.pending && bs.pending.version === V1);
    } else if (step === 'B') {
      chk(`runs payload ${V1} on trial`, st.version === V1 && st.shellVersion === V0 && ctx.BOOT.payload && ctx.BOOT.trial, `${st.version} ${ctx.BOOT.payload}`);
      chk('UI loaded from the payload', new RegExp(rx(V1).source + '\\.asar[\\\\/]ui[\\\\/]index\\.html').test(decodeURIComponent(ctx.win.webContents.getURL())), ctx.win.webContents.getURL());
      chk('main.js loaded from the payload', __dirname.includes(V1 + '.asar'), __dirname);
      for (let i = 0; i < 40 && ctx.BOOT.trial; i++) await wait(200);
      const bs = ctx.BOOT.boot.readState(app.getPath('userData'));
      chk('confirmed good after start', !ctx.BOOT.trial && bs.good && bs.tries === 0, JSON.stringify(bs));
      await ui("panel='settings'; refresh()"); await wait(600);
      await shot('B1_updated');
    } else if (step === 'G') {   // repo private again: public manifest URL answers 404 -> optional token fallback
      const T = process.env.METATOOLS_E2E_TOKEN;
      const card = () => ui("document.getElementById('updCard').innerHTML");
      chk('channel = the (private-looking) manifest URL', /\/private\/metatools-update\.json$/.test(st.update.url), st.update.url);
      await ui("panel='settings'; refresh()"); await wait(500);
      let c = await call('upd:check');
      chk('404 without token -> message suggests a token', c.state === 'error' && /404/.test(c.error) && /token/.test(c.error), c.error);
      await wait(300);
      chk('optional token box present (collapsed)', /GitHub token để cập nhật/.test(await card()) && /không bắt buộc/.test(await card()) && !(await ui("document.querySelector('#updCard details').open")));
      await shot('G1_no_token');
      await call('upd:setToken', { token: 'github_pat_WRONG_0000000000000000' });
      c = await call('upd:check');
      chk('wrong token -> "Token không đọc được repo"', c.state === 'error' && /Token không đọc được repo/.test(c.error), c.error);
      let bad = false; try { await call('upd:setToken', { token: 'abc' }); } catch (e) { bad = /không đúng dạng/.test(e.message); }
      chk('malformed token rejected', bad);
      // paste the real token through the UI, like the owner would
      await ui(`document.getElementById('u_token').value = ${JSON.stringify(T)}; document.getElementById('u_tsave').click()`); await wait(800);
      const s2 = await call('upd:state');
      chk('token saved (own)', s2.token.source === 'own' && s2.token.hasOwn);
      chk('token never shown back in the UI', !(await card()).includes(T) && (await ui("document.getElementById('u_token').value")) === '' && !JSON.stringify(s2).includes(T));
      c = await call('upd:check');
      chk('check via private release works', c.state === 'available' && c.latest.version === V1 && rx('releases/tag/v' + V1).test(c.latest.fullUrl), c.state + ' ' + c.error);
      // bonus: use the PAT of a github.com Git nick instead
      await call('upd:clearToken');
      const acc = await call('git:saveAccount', { label: 'Github sếp', host: 'github.com', user: 'TomNg197', email: 'tom@example.com', auth: 'pat', token: T });
      await ui('refresh()'); await wait(400);
      chk('nick offered as token source', /Dùng token của nick Github sếp/.test(await card()));
      await call('upd:useAcc', { id: acc.id });
      c = await call('upd:check');
      chk('check with the nick token works', c.state === 'available' && (await call('upd:state')).token.source === 'acc', c.state + ' ' + c.error);
      await call('upd:download');
      chk('download via asset API (302) -> ready', (await call('upd:state')).state === 'ready');
      await ui('refresh()'); await wait(500);
      await shot('G2_github_ready');
    } else if (step === 'D') {
      chk(`rolled back to ${V1} after broken ${V2}`, st.version === V1 && ctx.BOOT.payload, st.version);
      chk('rollback notice', st.update.notice && st.update.notice.from === V2 && st.update.notice.to === V1, JSON.stringify(st.update.notice));
      await ui("panel='settings'; refresh()"); await wait(600);
      chk('rollback notice shown in settings', rx(V2).test(await ui("document.getElementById('updCard').textContent")));
      const bs = ctx.BOOT.boot.readState(app.getPath('userData'));
      chk(`${V2} marked bad`, bs.bad.includes(V2));
      await shot('D1_rollback');
    }
  } catch (e) {
    chk('selftest crashed', false, e.stack || e.message);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('UPDATE SELFTEST', step, res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
