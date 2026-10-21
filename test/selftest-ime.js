'use strict';
// Vietnamese typing (UniKey-style) inside the real app. METATOOLS_IME_SELFTEST=<outdir>. UniKey (Windows) eats the
// tone/vowel key and re-sends "N x Backspace + the rewritten letters" with SendInput; here the same sequence goes in
// with webContents.sendInputEvent, into a page loaded in a profile's Slack view and into the app's own form input,
// while badge/layout refreshes happen in between (they used to detach + re-attach the web view).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Telex "Tieengs Vieetj" as UniKey sends it: plain chars, and for each modifier key BS x n + new letters
const TELEX = [
  ['T'], ['i'], ['e'], ['bs', 'ê'], ['n'], ['g'], ['bs', 'bs', 'bs', 'ế', 'n', 'g'], [' '],
  ['V'], ['i'], ['e'], ['bs', 'ê'], ['t'], ['bs', 'bs', 'ệ', 't'],
];

module.exports = async function selftestIme(ctx) {
  const out = process.env.METATOOLS_IME_SELFTEST;
  fs.mkdirSync(out, { recursive: true });
  const res = [];
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', '[ime]', n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const type = async (wc, between) => {
    for (const group of TELEX) {
      for (const k of group) {
        if (k === 'bs') { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' }); }
        else wc.sendInputEvent({ type: 'char', keyCode: k });
      }
      if (between) await between();
      await wait(15);
    }
    await wait(300);
  };
  try {
    const p = await ctx.handlers['prof:save']({ name: 'IME test', slackUrl: '' });
    ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await ctx.ui(`refresh().then(() => selectProfile(${JSON.stringify(p.id)}))`);
    await wait(800);
    const v = ctx.ensureView(ctx.store.cfg.profiles.find((x) => x.id === p.id), 'slack');
    const wc = v.webContents;
    const page = path.join(__dirname, 'ime-page.html');
    await wc.loadFile(page).catch(() => wc.loadFile(page));   // may abort the Slack load still in flight
    await wait(400);
    chk('test page is in the visible profile view', ctx.win.contentView.children.includes(v));

    let layouts = 0;
    const refresh = async () => { ctx.refreshBadge(); layouts++; await wait(5); };   // what an unread-count change does
    for (const id of ['ta', 'ce', 'inp']) {
      wc.focus();
      await wc.executeJavaScript(`document.getElementById('${id}').focus(); true`);
      await type(wc, refresh);
      const val = await wc.executeJavaScript(`(() => { const e = document.getElementById('${id}'); return e.value !== undefined ? e.value : e.innerText; })()`);
      chk(`UniKey-style Telex into ${id} = "Tiếng Việt"`, val.trim() === 'Tiếng Việt', JSON.stringify(val));
    }
    chk('web view kept keyboard focus through badge refreshes', wc.isFocused(), `refreshes=${layouts}`);
    chk('web view never detached during refreshes', ctx.win.contentView.children.includes(v));
    // Ctrl+Shift (UniKey's default V/E switch) and other Ctrl+Shift keys pass through; only Ctrl/Cmd+Shift+E is ours
    await wc.executeJavaScript("window.__keys = []; document.getElementById('ta').focus(); true");
    for (const k of ['Shift', 'Z', 'E']) wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control', 'shift'] });
    await wait(300);
    const keys = await wc.executeJavaScript('window.__keys');
    chk('Ctrl+Shift / Ctrl+Shift+Z reach the page, Ctrl+Shift+E is the translate shortcut', keys.includes('ta:Shift') && keys.includes('ta:Z') && !keys.includes('ta:E'), keys.join(','));
    // the app's own form input
    await ctx.ui("profileForm(null)"); await wait(300);
    const uwc = ctx.win.webContents; uwc.focus();
    await ctx.ui("document.getElementById('f_name').focus(); true");
    await type(uwc);
    const fv = await ctx.ui("document.getElementById('f_name').value");
    chk('UniKey-style Telex into the app\'s own input', fv === 'Tiếng Việt', JSON.stringify(fv));
    await ctx.ui('closeModal()');
  } catch (e) {
    chk('ime selftest crashed', false, e.stack || e.message);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('IME SELFTEST', res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
