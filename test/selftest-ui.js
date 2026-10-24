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
    chk('tabs: Slack selected, 5 tabs', lay.tabs.join(',') === 'slack:true,google:false,trello:false,discord:false,git:false', lay.tabs.join(','));
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
    // 2.6.0: hồ sơ nằm trong bảng trượt; mở bảng thì web view lùi sang phải 280 px
    await ui("selectTab('slack')"); await wait(600);
    const x0 = v.getBounds().x;
    await ui('openFly()'); await wait(500);
    const fl = JSON.parse(await ui("JSON.stringify({ open: !document.getElementById('profFly').classList.contains('hidden'), rows: document.querySelectorAll('#profs .bub').length, names: [...document.querySelectorAll('#profs .bName')].map((n) => n.textContent) })"));
    chk('profile flyout opens with one row per profile', fl.open && fl.rows === 3 && fl.names[0] === 'Công ty MetaX', JSON.stringify(fl));
    chk('web view moves right while the flyout is open', v.getBounds().x === x0 + 280, x0 + ' -> ' + v.getBounds().x);
    await shot('03b_profiles_fly');
    // profile rows: focusable, Enter selects (and closes the flyout)
    const p2id = ctx.store.cfg.profiles[1].id;
    await ui(`document.querySelector('.bub[data-id="${p2id}"]').focus()`);
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); ctx.win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    await wait(500);
    chk('Enter on a profile bubble selects it', (await ui("document.querySelector('.bub.on').dataset.id")) === p2id);
    chk('flyout closes after picking + web view back in place', (await ui("document.getElementById('profFly').classList.contains('hidden')")) && ctx.views[p2id].slack.getBounds().x === x0, String(ctx.views[p2id].slack && ctx.views[p2id].slack.getBounds().x));
    ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '3', modifiers: ['control'] }); ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '3', modifiers: ['control'] });
    await wait(400);
    chk('Ctrl+3 jumps to the 3rd profile', (await ui('cur.profileId')) === ctx.store.cfg.profiles[2].id);
    await ui(`selectProfile(${JSON.stringify(p2id)})`); await wait(300);
    // 2.4.2: profile logo — a picture made in the page goes through readLogo (crop/resize) and prof:save
    const logoLen = await ui(`(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d');
      g.fillStyle = '#ff8a00'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#1e88e5'; g.beginPath(); g.arc(150, 100, 70, 0, 7); g.fill();
      const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const logo = await readLogo(new File([blob], 'l.png', { type: 'image/png' }));
      const p = prof(cur.profileId); await mt.call('prof:save', { ...p, logo }); await refresh(); return logo.length; })()`);
    await wait(400);
    const lg = JSON.parse(await ui(`JSON.stringify({ bub: !!document.querySelector('.bub.on img.logo'), tc: !!document.querySelector('#tcAva img.logo'),
      size: (() => { const i = document.querySelector('.bub.on img.logo'); return i ? i.naturalWidth + 'x' + i.naturalHeight : ''; })() })`));
    chk('profile logo shown in the profile column and the tab column', lg.bub && lg.tc && lg.size === '128x128', JSON.stringify(lg) + ' len=' + logoLen);
    let rejected = false;
    try { await ctx.handlers['prof:save']({ ...ctx.store.cfg.profiles[1], logo: 'data:text/html;base64,PHNjcmlwdD4=' }); } catch { rejected = true; }
    chk('non-image logo is refused', rejected);
    await shot('04b_logo');
    await ui("panel = 'settings'; render()"); await wait(500);
    chk('no tab column outside profile tabs', await ui("document.getElementById('tabcol').classList.contains('hidden')"));
    await shot('04_settings');
    // 2.6.0: quản lý dự án
    const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
    await ctx.handlers['proj:save']({ name: 'Ride a Pet 1.2', status: 'doing', due: iso(new Date(today.getTime() + 2 * 864e5)), owner: 'Thomas', progress: 60, profileIds: [ctx.store.cfg.profiles[0].id, ctx.store.cfg.profiles[1].id], tasks: [{ text: 'Build APK', done: true }, { text: 'Test máy thật' }] });
    await ctx.handlers['proj:save']({ name: 'Hospital Pet', status: 'waiting', due: iso(new Date(today.getTime() - 3 * 864e5)), progress: 30, profileIds: [ctx.store.cfg.profiles[2].id] });
    await ctx.handlers['proj:save']({ name: 'GTA mobile one-pager', status: 'done', progress: 100 });
    let pbad = false; try { await ctx.handlers['proj:save']({ name: ' ' }); } catch { pbad = true; }
    chk('project without a name is refused', pbad);
    await ui("refresh().then(() => { panel = 'projects'; render(); })"); await wait(600);
    const pj = JSON.parse(await ui("JSON.stringify({ cards: document.querySelectorAll('#pProj .pj').length, late: document.getElementById('projCnt').textContent, hasLateChip: !!document.querySelector('#pProj .pchip.late') })"));
    chk('projects panel: open projects shown, overdue / due-soon counted', pj.cards === 2 && pj.late === '2' && pj.hasLateChip, JSON.stringify(pj));
    await shot('05_projects');
    await ui("document.querySelector('#pProj .pj').click()"); await wait(500);
    chk('project form shows quick links for linked profiles', await ui("document.querySelectorAll('#modalBox [data-go]').length === 4 * document.querySelectorAll('.j_prof:checked').length && document.querySelectorAll('#modalBox [data-go]').length > 0"));
    await shot('06_project_form');
    await ui('closeModal()'); await wait(200);
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
