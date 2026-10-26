'use strict';
// 2.7.0 — kiểm luồng (không soi giao diện): báo tin + số tin riêng từng app của từng hồ sơ, Gmail qua feed,
// link lạ mở trong tab Web, bảng hồ sơ trượt ra không làm trang co giãn.
// Chạy: METATOOLS_27_SELFTEST=<thư mục> METATOOLS_GMAIL_FEED=http://127.0.0.1:39177/{gmail} METATOOLS_GMAIL_POLL_MS=3600000 elx.sh <app>
const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, session } = require('electron');

module.exports = async function selftest(ctx) {
  const out = process.env.METATOOLS_27_SELFTEST;
  fs.mkdirSync(out, { recursive: true });
  const res = [];
  const chk = (n, c, x = '') => { res.push({ n, ok: !!c, x: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', n, x); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (ch, arg) => ctx.handlers[ch](arg || {});
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await wait(200); } return false; };
  // feed Gmail giả: chỉ trả thư khi có cookie đăng nhập của đúng hồ sơ (kiểm feed có mang cookie phiên)
  let mails = [['m1', 'Báo giá'], ['m2', 'Lịch họp']]; let sawCookie = '';
  const srv = http.createServer((q, r) => {
    sawCookie = q.headers.cookie || '';
    if (!/SID=ok/.test(sawCookie)) { r.writeHead(401); r.end('login'); return; }
    r.writeHead(200, { 'content-type': 'application/atom+xml' });
    r.end(`<feed><fullcount>${mails.length}</fullcount>${mails.map(([id, t]) => `<entry><title>${t}</title><summary>nội dung ${id}</summary><id>${id}</id><author><name>Khách</name></author></entry>`).join('')}</feed>`);
  });
  await new Promise((r) => srv.listen(39177, '127.0.0.1', r));
  try {
    ctx.win.show();
    await new Promise((r) => (ctx.win.webContents.isLoading() ? ctx.win.webContents.once('did-finish-load', r) : r()));
    await wait(1000);
    const p1 = await call('prof:save', { name: 'MetaX', gmail: 'a@metax.vn', discordUrl: 'https://discord.com/channels/@me', notifyApps: { trello: true } });
    const p2 = await call('prof:save', { name: 'Khách B', notifyApps: { slack: false } });
    chk('lưu bật/tắt báo tin từng app', p1.notifyApps.trello === true && p2.notifyApps.slack === false && !('google' in p1.notifyApps), JSON.stringify([p1.notifyApps, p2.notifyApps]));
    chk('app được bật báo tin chạy ngầm ngay', await until(() => ctx.views[p1.id] && ctx.views[p1.id].discord && ctx.views[p1.id].trello && ctx.views[p1.id].slack), Object.keys(ctx.views[p1.id] || {}).join(','));
    chk('hồ sơ tắt Slack thì không chạy ngầm Slack', !(ctx.views[p2.id] && ctx.views[p2.id].slack));

    // ---- Gmail qua feed
    const S = () => call('app:state');
    ctx.gmailPollAll(); await wait(1500);
    chk('chưa đăng nhập: feed 401 → không đếm', !((await S()).badges[p1.id].google.n));
    await session.fromPartition(`persist:p-${p1.id}`).cookies.set({ url: 'http://127.0.0.1:39177', name: 'SID', value: 'ok' });
    ctx.gmailPollAll();
    chk('Gmail: đếm thư chưa đọc từ feed (mang cookie phiên của hồ sơ)', await until(async () => (await S()).badges[p1.id].google.n === 2), sawCookie);
    chk('lần đọc đầu không báo dồn thư cũ', ctx.events.filter((e) => e.k === 'google').length === 0);
    mails = [['m3', 'Hợp đồng mới'], ...mails]; ctx.gmailPollAll();
    chk('thư mới → 1 tin Gmail của đúng hồ sơ', await until(() => ctx.events.some((e) => e.k === 'google' && e.p === p1.id && /Hợp đồng mới/.test(e.t))), JSON.stringify(ctx.events[0] || {}));
    chk('số Gmail = 3', (await S()).badges[p1.id].google.n === 3);

    // ---- Discord / Trello báo tin qua Notification của trang (đang ẩn)
    for (const k of ['discord', 'trello']) {
      const wc = ctx.views[p1.id][k].webContents;
      await until(() => !wc.isLoading(), 15000);
      await wc.executeJavaScript(`new Notification('Tin ${k}', { body: 'nội dung ${k}' }); 1`);
      chk(`${k}: bắt được tin, ghi đúng app`, await until(() => ctx.events.some((e) => e.k === k && e.p === p1.id)), JSON.stringify(ctx.events.find((e) => e.k === k) || {}));
    }
    const b = (await S()).badges[p1.id];
    chk('số tin tách riêng từng app', b.discord.n === 1 && b.trello.n === 1 && b.google.n === 3 && b.total >= 5, JSON.stringify(b));

    // giao diện: chọn hồ sơ → số trên đúng nút tab; bảng trượt có chip từng app
    await ctx.ui(`refresh().then(() => selectProfile(${JSON.stringify(p1.id)}))`); await wait(800);
    const tabs = await ctx.ui("[...document.querySelectorAll('#tabs button')].map(b => b.dataset.tab + ':' + ((b.querySelector('.tcnt')||{}).textContent||'')).join(' ')");
    chk('nút tab hiện số riêng', /discord:1/.test(tabs) && /trello:1/.test(tabs) && /google:3/.test(tabs), tabs);

    // mở tab Discord → tin Discord thành đã đọc, Gmail vẫn còn
    await ctx.ui("selectTab('discord')"); await wait(800);
    const b2 = (await S()).badges[p1.id];
    chk('mở app nào thì app đó hết số', b2.discord.n === 0 && b2.google.n === 3, JSON.stringify(b2));

    // ---- bảng hồ sơ trượt: trang không co giãn
    const v = ctx.views[p1.id].discord; await wait(500);
    const before = v.getBounds();
    await ctx.ui('openFly()'); await wait(1200);
    const frozen = await ctx.ui("(() => { const i = document.getElementById('frozen'); return !i.classList.contains('hidden') && i.src.startsWith('data:image') ? i.style.width : ''; })()");
    chk('mở bảng: web view gỡ ra, ảnh chụp thay chỗ', !ctx.win.contentView.children.includes(v) && frozen === before.width + 'px', `${frozen} vs ${before.width}`);
    chk('kích thước web view không đổi khi bảng mở', JSON.stringify(v.getBounds()) === JSON.stringify(before), JSON.stringify([before, v.getBounds()]));
    await ctx.win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(out, 'fly_open.png'), img.toPNG()));
    await ctx.ui('closeFly(true)'); await wait(600);
    chk('đóng bảng: gắn lại đúng kích thước cũ, bỏ ảnh', ctx.win.contentView.children.includes(v) && JSON.stringify(v.getBounds()) === JSON.stringify(before) && await ctx.ui("document.getElementById('frozen').classList.contains('hidden')"), JSON.stringify(v.getBounds()));

    // ---- link lạ mở trong app
    const r1 = ctx.routeLink(p1, 'https://example.com/form?id=1', 'slack');
    chk('link web bất kỳ → tab Web trong app (không ra trình duyệt ngoài)', r1.action === 'deny' && ctx.current().tab === 'web' && await until(() => /example\.com/.test(ctx.views[p1.id].web.webContents.getURL())), ctx.views[p1.id].web && ctx.views[p1.id].web.webContents.getURL());
    ctx.routeLink(p1, 'https://forms.gle/abc123', 'discord');
    chk('link Google Form rút gọn → tab Google', ctx.current().tab === 'google');

    // ---- bấm tin trong Tin mới → mở đúng app
    const ev = ctx.events.find((e) => e.k === 'trello');
    await call('feed:open', { id: ev.id });
    chk('bấm tin Trello → mở tab Trello của đúng hồ sơ', ctx.current().tab === 'trello' && ctx.current().profileId === p1.id);
  } catch (e) {
    chk('selftest crashed', false, e.stack || e.message);
  }
  srv.close();
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  console.log('SELFTEST27', res.filter((r) => r.ok).length, '/', res.length);
  app.exit(0);
};
