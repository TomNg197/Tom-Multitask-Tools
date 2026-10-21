'use strict';
// UI layout checks + screenshots for the 2.4 look. METATOOLS_UI_SELFTEST=<outdir>, METATOOLS_UI_THEME=light|dark.
// Saves <scene>.ui.png (app UI) and, when a web view is shown, <scene>.view.png + bounds in shots.json, so
// test/compose_shots.py can paste the view into the window picture (capturePage only sees one webContents).
const fs = require('fs');
const path = require('path');
const { app, nativeTheme } = require('electron');

module.exports = async function selftestUi(ctx) {
  const out = process.env.METATOOLS_UI_SELFTEST;
  fs.mkdirSync(out, { recursive: true });
  nativeTheme.themeSource = process.env.METATOOLS_UI_THEME === 'dark' ? 'dark' : 'light';
  const res = []; const shots = {};
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', '[ui]', n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = (js) => ctx.win.webContents.executeJavaScript(js, true);
  const shot = async (name) => {
    fs.writeFileSync(path.join(out, name + '.ui.png'), (await ctx.win.webContents.capturePage()).toPNG());
    const v = ctx.win.contentView.children.find((c) => c.webContents && c.webContents !== ctx.win.webContents);
    if (v) { fs.writeFileSync(path.join(out, name + '.view.png'), (await v.webContents.capturePage()).toPNG()); shots[name] = v.getBounds(); } else shots[name] = null;
  };
  try {
    ctx.win.setContentSize(1320, 820); ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await wait(600);
    await shot('01_empty');
    const p1 = await ctx.handlers['prof:save']({ name: 'Công ty MetaX', color: '#7c4dff' });
    await ctx.handlers['prof:save']({ name: 'Khách A', color: '#e91e63' });
    await ctx.handlers['prof:save']({ name: 'Studio B', color: '#00897b' });
    await ui(`refresh().then(() => selectProfile(${JSON.stringify(p1.id)}))`);
    await wait(500);
    const lay = JSON.parse(await ui(`JSON.stringify({ tc: !document.getElementById('tabcol').classList.contains('hidden'),
      tcR: document.getElementById('tabcol').getBoundingClientRect().right, topL: document.getElementById('top').getBoundingClientRect().left,
      tabs: [...document.querySelectorAll('#tabs [role=tab]')].map((b) => b.dataset.tab + ':' + b.getAttribute('aria-selected')),
      vertical: document.getElementById('tabs').getAttribute('aria-orientation'),
      stacked: (() => { const r = [...document.querySelectorAll('#tabs button')].map((b) => b.getBoundingClientRect()); return r.every((x, i) => !i || x.top > r[i - 1].top && x.left === r[0].left); })() })`));
    chk('vertical tab column shown next to the profile column', lay.tc && lay.vertical === 'vertical' && lay.stacked, JSON.stringify(lay));
    chk('tabs: Slack selected, 4 tabs', lay.tabs.join(',') === 'slack:true,google:false,trello:false,git:false', lay.tabs.join(','));
    const v = ctx.views[p1.id] && ctx.views[p1.id].slack;
    chk('web view starts right after the tab column', v && v.getBounds().x === Math.round(lay.tcR) && Math.round(lay.topL) === v.getBounds().x, JSON.stringify(v && v.getBounds()) + ' tcR=' + lay.tcR);
    let txt = '';   // wait until Slack's sign-in page has drawn (network)
    for (let i = 0; i < 40 && v && txt.length < 40; i++) { await wait(500); txt = await v.webContents.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => ''); }
    await wait(1500);
    await shot('02_slack');
    // keyboard: ArrowDown in the tab list selects the next tab and keeps focus in the list
    await ui("document.querySelector('#tabs button.on').focus()");
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await wait(500);
    const k = JSON.parse(await ui("JSON.stringify({ sel: document.querySelector('#tabs button.on').dataset.tab, foc: document.activeElement.dataset.tab })"));
    chk('ArrowDown moves to Drive / Gmail, focus stays in the list', k.sel === 'google' && k.foc === 'google', JSON.stringify(k));
    await ui("selectTab('git')"); await wait(800);
    await shot('03_git');
    // profile bubbles: focusable, Enter selects
    const p2id = ctx.store.cfg.profiles[1].id;
    await ui(`document.querySelector('.bub[data-id="${p2id}"]').focus()`);
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); ctx.win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    await wait(500);
    chk('Enter on a profile bubble selects it', (await ui("document.querySelector('.bub.on').dataset.id")) === p2id);
    await ui("panel = 'settings'; render()"); await wait(500);
    chk('no tab column outside profile tabs', await ui("document.getElementById('tabcol').classList.contains('hidden')"));
    await shot('04_settings');
    await ui('profileForm(prof(cur.profileId))'); await wait(400);
    await shot('05_edit_profile');
    await ui('closeModal()');
    const font = await ui("getComputedStyle(document.body).fontFamily");
    chk('system font stack (SF / Segoe UI Variable)', /SF Pro/.test(font) && /Segoe UI Variable/.test(font), font);
    chk('theme follows nativeTheme', (await ui("matchMedia('(prefers-color-scheme: dark)').matches")) === (process.env.METATOOLS_UI_THEME === 'dark'));
  } catch (e) {
    chk('ui selftest crashed', false, e.stack || e.message);
  }
  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify(shots, null, 2));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('UI SELFTEST', res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
