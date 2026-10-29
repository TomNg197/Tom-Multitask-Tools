'use strict';
/* global mt */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#7c4dff', '#e91e63', '#ff7043', '#f9a825', '#43a047', '#00897b', '#1e88e5', '#5e35b1', '#6d4c41', '#546e7a'];
// window material (vibrancy / mica / none) + OS from main, for the translucent columns and the macOS title bar area
{ const q = new URLSearchParams(location.search); document.documentElement.dataset.mat = q.get('mat') || 'none'; document.documentElement.dataset.os = q.get('os') || ''; }
let S = null;            // app state
let GS = null;           // git state
let cur = { profileId: null, tab: 'slack' };
let panel = 'web';       // web | git | feed | settings | projects | empty
let lastPrepare = null;
let logId = null;

async function call(ch, arg) {
  const r = await mt.call(ch, arg);
  if (!r.ok) { toast(r.error, true); throw new Error(r.error); }
  return r.data;
}

function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 2500);
}

function initials(name) {
  const w = String(name || '?').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

function prof(id) { return S && S.profiles.find((p) => p.id === id); }
// avatar of a profile: its logo when it has one, else initials on its colour
function avatarHtml(p) { return p.logo ? `<img class="logo" src="${esc(p.logo)}" alt="">` : esc(initials(p.name)); }
function setAvatar(el, p) { el.innerHTML = avatarHtml(p); el.style.background = p.logo ? 'var(--card)' : p.color; el.classList.toggle('hasLogo', !!p.logo); }
// picked file -> square PNG (centre crop), at most 128 px, so the profile file stays small
function readLogo(file) {
  return new Promise((ok, bad) => {
    if (!file || !/^image\//.test(file.type)) return bad(new Error('Chọn một file ảnh (PNG, JPG, WebP…).'));
    // read as data: URL (the page CSP allows data: images, not blob:)
    const fr = new FileReader(); const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), n = Math.min(128, s) || 128;
      const c = document.createElement('canvas'); c.width = c.height = n;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, n, n);
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => bad(new Error('Không đọc được ảnh này.'));
    fr.onload = () => { img.src = fr.result; }; fr.onerror = () => bad(new Error('Không đọc được file ảnh.'));
    fr.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------ main state + layout
async function refresh() {
  S = await call('app:state');
  if (!cur.profileId && S.profiles[0]) cur.profileId = S.profiles[0].id;
  if (cur.profileId && !prof(cur.profileId)) cur.profileId = S.profiles[0] ? S.profiles[0].id : null;
  render();
}

// 2.7.0: main gửi sẵn bảng số tin theo từng app của từng hồ sơ: badges[pid] = { total, dot, slack: {n, dot}, google, trello, discord }
const APPS = [['slack', 'Slack'], ['google', 'Gmail'], ['trello', 'Trello'], ['discord', 'Discord']];
function unreadOf(pid) { const r = (S.badges || {})[pid]; return r ? { n: r.total, dot: !r.total && r.dot } : { n: 0, dot: false }; }
function cntHtml(n, dot, cls) {
  if (n) return `<span class="${cls}">${n > 99 ? '99+' : n}</span>`;
  if (dot) return `<span class="${cls} dot">•</span>`;
  return '';
}
function badgeOf(pid) { const { n, dot } = unreadOf(pid); return cntHtml(n, dot, 'cnt'); }
// dòng hồ sơ trong bảng trượt: số tin riêng từng app (chỉ app đang có tin)
function appChips(pid) {
  const r = (S.badges || {})[pid]; if (!r) return '';
  const chips = APPS.filter(([k]) => r[k] && (r[k].n || r[k].dot)).map(([k, label]) => `<span class="ach a-${k}" title="${label}: ${r[k].n || 'có tin mới'}"><i></i>${label} ${r[k].n ? (r[k].n > 99 ? '99+' : r[k].n) : '•'}</span>`);
  return chips.length ? `<span class="achs">${chips.join('')}</span>` : '';
}

const TAB_NAMES = { slack: 'Slack', google: 'Drive / Gmail', trello: 'Trello', discord: 'Discord', web: 'Web', git: 'Git' };

function render() {
  const focusedBub = document.activeElement && document.activeElement.classList.contains('bub') ? document.activeElement.dataset.id : null;
  // 2.6.0: hồ sơ nằm trong bảng trượt (#profFly); mỗi dòng = ảnh/chữ tắt + tên + số tin chưa đọc
  $('profs').innerHTML = S.profiles.map((p, i) => { const on = p.id === cur.profileId && (panel === 'web' || panel === 'git');
    return `<div class="bub ${on ? 'on' : ''}" role="button" tabindex="0" aria-current="${on ? 'true' : 'false'}" aria-label="${esc(p.name)}" data-id="${p.id}" title="${esc(p.name)}${i < 9 ? ' · Ctrl+' + (i + 1) : ''}"><span class="bAva" style="background:${p.logo ? 'var(--card)' : esc(p.color)}">${avatarHtml(p)}</span><span class="bTxt"><span class="bName">${esc(p.name)}</span>${appChips(p.id)}</span>${badgeOf(p.id)}</div>`; }).join('');
  { const cp = prof(cur.profileId); const a = $('profBtnAva');
    if (cp) { setAvatar(a, cp); a.classList.remove('empty'); } else { a.innerHTML = '＋'; a.style.background = ''; a.classList.add('empty'); }
    let tn = 0, td = false; S.profiles.forEach((x) => { const u = unreadOf(x.id); tn += u.n; td = td || u.dot; });
    $('profCnt').textContent = tn ? (tn > 99 ? '99+' : tn) : '•'; $('profCnt').classList.toggle('hidden', !tn && !td); $('profCnt').classList.toggle('dot', !tn && td);
    $('profBtn').classList.toggle('on', panel === 'web' || panel === 'git' || panel === 'empty');
    $('projBtn').classList.toggle('on', panel === 'projects');
    const late = (S.projects || []).filter((x) => x.status !== 'done' && dueState(x.due) !== '').length;
    $('projCnt').textContent = late; $('projCnt').classList.toggle('hidden', !late); $('projCnt').title = late ? `${late} dự án quá hạn / sắp tới hạn` : ''; }
  if (focusedBub) { const b = document.querySelector(`.bub[data-id="${focusedBub}"]`); if (b) b.focus(); }   // keyboard users keep their place
  const totalNew = Object.values(S.news).reduce((a, b) => a + b, 0);
  $('feedCnt').textContent = totalNew; $('feedCnt').classList.toggle('hidden', !totalNew);
  const p = prof(cur.profileId);
  if (!p && panel !== 'settings' && panel !== 'feed' && panel !== 'projects') panel = 'empty';
  else if (p && panel === 'empty') panel = cur.tab === 'git' ? 'git' : 'web';
  const showTabs = p && (panel === 'web' || panel === 'git');
  $('pname').textContent = panel === 'feed' ? 'Tin mới' : panel === 'settings' ? 'Cài đặt' : panel === 'projects' ? 'Quản lý dự án' : showTabs ? `${p.name} · ${TAB_NAMES[cur.tab] || ''}` : (p ? p.name : 'Tom Multitask');
  // profile column -> vertical tab column (only while a profile's tabs are shown) -> content
  $('tabcol').classList.toggle('hidden', !showTabs); document.body.classList.toggle('withTabs', !!showTabs);
  if (showTabs) { setAvatar($('tcAva'), p); $('tcAva').title = p.name; $('tcAva').setAttribute('aria-label', p.name); }   // icon-only column: name stays in the top bar + tooltip
  $('navs').classList.toggle('hidden', panel !== 'web');
  document.querySelectorAll('#tabs button').forEach((b) => {
    const on = b.dataset.tab === cur.tab;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    // số tin riêng của app này trong hồ sơ đang chọn
    const r = p && (S.badges || {})[p.id] && S.badges[p.id][b.dataset.tab]; let c = b.querySelector('.tcnt');
    const html = r ? cntHtml(r.n, r.dot, 'tcnt') : '';
    if (c) c.remove();
    if (html) b.insertAdjacentHTML('beforeend', html);
  });
  for (const [id, k] of [['pWeb', 'web'], ['pGit', 'git'], ['pFeed', 'feed'], ['pSet', 'settings'], ['pProj', 'projects'], ['pEmpty', 'empty']]) $(id).classList.toggle('hidden', panel !== k);
  if (panel === 'git') renderGit();
  if (panel === 'feed') renderFeed();
  if (panel === 'settings') renderSettings();
  if (panel === 'projects') renderProjects();
  updDot();
  syncMain();
}

let markNext = false;
let focusNext = false;   // move the keyboard focus into the web view (mouse picks only; keyboard users stay in the lists)
function syncMain() {
  const overlay = !$('modal').classList.contains('hidden') || panel !== 'web';
  mt.call('app:show', { profileId: cur.profileId, tab: panel === 'web' ? cur.tab : 'none', overlay, markRead: markNext, focus: focusNext });
  markNext = false; focusNext = false;
}

function selectProfile(id, viaKey) { cur.profileId = id; panel = cur.tab === 'git' ? 'git' : 'web'; markNext = true; focusNext = !viaKey; closeFly(true); render(); }
function selectTab(tab, viaKey) { cur.tab = tab; panel = tab === 'git' ? 'git' : 'web'; markNext = true; focusNext = !viaKey; render(); }

// ------------------------------------------------------------------ modal helpers
function openModal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); syncMain(); }
function closeModal() { $('modal').classList.add('hidden'); syncMain(); }
function colorPicker(id, val) {
  return `<div class="colors" id="${id}">${COLORS.map((c) => `<span data-c="${c}" class="${c === val ? 'on' : ''}" style="background:${c}"></span>`).join('')}</div>`;
}
function pickedColor(id) { const on = document.querySelector(`#${id} span.on`); return on ? on.dataset.c : COLORS[0]; }
document.addEventListener('click', (e) => {
  const sw = e.target.closest('.colors span');
  if (sw) { sw.parentElement.querySelectorAll('span').forEach((x) => x.classList.remove('on')); sw.classList.add('on'); }
  const sg = e.target.closest('.seg button');
  if (sg) { sg.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('on')); sg.classList.add('on'); sg.parentElement.dispatchEvent(new Event('change')); }
});
function segVal(id) { const on = document.querySelector(`#${id} button.on`); return on ? on.dataset.v : null; }
function seg(id, opts, val) { return `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`; }

// ------------------------------------------------------------------ profile form
// giống notifyOn() bên main: chưa chỉnh lần nào thì Slack bật, Gmail bật khi có Gmail; Trello/Discord phải tick (2.7.1, đỡ RAM)
function notifyDefault(p, k) {
  const a = p.notifyApps || {};
  if (typeof a[k] === 'boolean') return a[k];
  return k === 'slack' || (k === 'google' && !!p.gmail);
}
function profileForm(p) {
  p = p || { color: COLORS[(S.profiles.length) % COLORS.length], notify: true };
  openModal(`<h3>${p.id ? 'Sửa hồ sơ' : 'Hồ sơ mới'}</h3>
  <div class="mute small">Mỗi hồ sơ có phiên đăng nhập Slack, Google, Trello và Discord riêng, không lẫn với hồ sơ khác.</div>
  <label>Tên hồ sơ</label><input id="f_name" value="${esc(p.name || '')}" placeholder="Công ty / Khách A / Cá nhân">
  <label>Workspace Slack</label><input id="f_slack" value="${esc(p.slackUrl || '')}" placeholder="https://tencongty.slack.com (để trống = chọn khi đăng nhập)">
  <label>Gmail đi kèm (mở Drive/Docs đúng tài khoản)</label><input id="f_gmail" value="${esc(p.gmail || '')}" placeholder="ten@congty.com">
  <label>Trello (tuỳ chọn: link bảng hoặc workspace mở sẵn)</label><input id="f_trello" value="${esc(p.trelloUrl || '')}" placeholder="https://trello.com/w/tencongty (để trống = trang chủ Trello)">
  <label>Discord (tuỳ chọn: link server/kênh mở sẵn)</label><input id="f_discord" value="${esc(p.discordUrl || '')}" placeholder="https://discord.com/channels/... (để trống = trang chủ Discord)">
  <label>Logo (tuỳ chọn)</label>
  <div class="row"><div class="logoPrev" id="f_logoPrev"></div><button id="f_logoPick">Chọn ảnh…</button><button class="ghost" id="f_logoDel">Bỏ logo</button><input type="file" id="f_logoFile" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden"></div>
  <label>Màu (khi không có logo)</label>${colorPicker('f_color', p.color)}
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="f_notify" style="width:auto" ${p.notify !== false ? 'checked' : ''}> Báo tin mới (chạy ngầm cả khi đóng cửa sổ)</label>
  <div class="napps" id="f_napps">${APPS.map(([k, label]) => `<label><input type="checkbox" class="f_napp" value="${k}" ${notifyDefault(p, k) ? 'checked' : ''}> ${label}</label>`).join('')}</div>
  <div class="mute small">Slack, Trello, Discord được tick sẽ chạy ngầm để báo tin (mỗi app ~150–300 MB RAM). Gmail chỉ đọc số thư mới qua feed, gần như không tốn RAM.</div>
  <div class="row" style="margin-top:16px">${p.id ? '<button class="err" id="f_del">Xoá hồ sơ</button>' : ''}<span class="grow"></span><button id="f_cancel">Huỷ</button><button class="pri" id="f_save">Lưu</button></div>`);
  let logo = p.logo || '';
  const showLogo = () => { setAvatar($('f_logoPrev'), { name: $('f_name').value || p.name || '?', color: pickedColor('f_color') || p.color, logo }); $('f_logoDel').classList.toggle('hidden', !logo); };
  showLogo(); $('f_name').addEventListener('input', showLogo); $('f_color').addEventListener('click', () => setTimeout(showLogo));
  const syncNapps = () => document.querySelectorAll('.f_napp').forEach((c) => { c.disabled = !$('f_notify').checked; });
  $('f_notify').addEventListener('change', syncNapps); syncNapps();
  $('f_logoPick').onclick = () => $('f_logoFile').click();
  $('f_logoFile').onchange = async (e) => { try { logo = await readLogo(e.target.files[0]); showLogo(); } catch (err) { toast(err.message, true); } e.target.value = ''; };
  $('f_logoDel').onclick = () => { logo = ''; showLogo(); };
  $('f_cancel').onclick = closeModal;
  $('f_save').onclick = async () => {
    const r = await call('prof:save', { id: p.id, name: $('f_name').value, slackUrl: $('f_slack').value, gmail: $('f_gmail').value, trelloUrl: $('f_trello').value, discordUrl: $('f_discord').value, color: pickedColor('f_color'), notify: $('f_notify').checked, logo,
      notifyApps: Object.fromEntries([...document.querySelectorAll('.f_napp')].map((c) => [c.value, c.checked])) });
    closeModal(); cur.profileId = r.id; if (!p.id) { cur.tab = 'slack'; panel = 'web'; } await refresh();
  };
  if (p.id) $('f_del').onclick = async () => {
    if (!confirm(`Xoá hồ sơ "${p.name}"?`)) return;
    const wipe = confirm('Xoá luôn dữ liệu đăng nhập Slack/Google của hồ sơ này trên máy?\n(OK = xoá, Cancel = giữ)');
    await call('prof:delete', { id: p.id, wipe }); closeModal(); cur.profileId = null; await refresh();
  };
  setTimeout(() => $('f_name').focus(), 50);
}

// ------------------------------------------------------------------ feed
async function renderFeed() {
  const evs = await call('feed:list');
  $('pFeed').innerHTML = `<div class="card"><h2>Tin mới của mọi hồ sơ <span class="grow"></span><button class="sm" id="fd_read">Đánh dấu đã đọc</button><button class="sm" id="fd_clear">Xoá danh sách</button></h2>
  ${evs.length ? evs.map((e) => { const p = prof(e.p); return `<div class="ev ${e.read ? '' : 'new'}" data-ev="${e.id}"><div class="who" style="color:${esc(p ? p.color : '#888')}">${esc(p ? p.name : '?')}<div class="app a-${esc(e.k || 'slack')}">${esc((APPS.find(([k]) => k === (e.k || 'slack')) || [0, 'Slack'])[1])}</div></div><div class="msg"><div><b>${esc(e.t || '(không tiêu đề)')}</b></div><div class="b">${esc(e.b)}</div></div><div class="tm">${new Date(e.at).toLocaleTimeString()}</div></div>`; }).join('') : '<div class="mute" style="padding:20px;text-align:center">Chưa có tin. Tin nhắn riêng, nhắc tên, tin mới của các hồ sơ sẽ hiện ở đây.</div>'}</div>`;
  $('fd_read').onclick = async () => { await call('feed:readAll'); await refresh(); };
  $('fd_clear').onclick = async () => { await call('feed:clear'); await refresh(); };
  document.querySelectorAll('[data-ev]').forEach((el) => { el.onclick = async () => { await call('feed:open', { id: +el.dataset.ev }); }; });
}

// ------------------------------------------------------------------ settings
function renderSettings() {
  $('pSet').innerHTML = `<div class="card"><h2>Cài đặt</h2>
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="s_login" style="width:auto" ${S.settings.openAtLogin ? 'checked' : ''}> Tự chạy ngầm khi mở máy (để không lỡ tin)</label>
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink);margin-top:10px">Ngủ app không dùng sau
    <select id="s_sleep" style="width:auto">${[[0, 'Không ngủ'], [5, '5 phút'], [10, '10 phút'], [20, '20 phút'], [30, '30 phút'], [60, '1 giờ']].map(([v, l]) => `<option value="${v}" ${S.settings.sleepMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <div class="mute small">Đỡ RAM: app không mở quá thời gian này và không bật báo tin sẽ tắt hẳn, bấm vào lại thì mở lại đúng trang cũ (mất 2–4 giây).</div>
  <div class="row" style="margin-top:14px"><button id="s_export">Xuất danh sách hồ sơ</button><button id="s_import">Nhập danh sách hồ sơ</button></div>
  <div class="mute small" style="margin-top:6px">Dùng để chuyển sang máy Mac/Windows khác. File chỉ có tên, workspace, Gmail, nick và cặp Git; <b>không có</b> token, SSH key hay phiên đăng nhập (mỗi máy đăng nhập/nhập token lại 1 lần).</div>
  <div class="row" style="margin-top:18px"><button class="err" id="s_quit">Thoát hẳn Tom Multitask</button><span class="mute small">Đóng cửa sổ thì app vẫn chạy ở khay để nhận tin.</span></div>
  <div class="brandRow"><img src="logo.svg" alt="" width="40" height="40"><div><b>Tom Multitask</b><div class="mute small">${esc(S.version)} · ${esc(S.platform)}</div></div></div></div>
  <div class="card" id="updCard"></div>`;
  $('s_login').onchange = async (e) => { await call('app:setLogin', { on: e.target.checked }); await refresh(); };
  $('s_sleep').onchange = async (e) => { await call('app:setSleep', { min: +e.target.value }); toast('Đã lưu'); await refresh(); };
  $('s_export').onclick = async () => { const f = await call('app:export'); if (f) toast('Đã lưu ' + f); };
  $('s_import').onclick = async () => { const r = await call('app:import'); if (r) { toast(`Đã nhập: thêm ${r.added}, cập nhật ${r.updated}`); await refresh(); } };
  $('s_quit').onclick = () => call('app:quit');
  renderUpdate();
}

// ------------------------------------------------------------------ in-app update
function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }
function renderUpdate() {
  const box = $('updCard'); const u = S.update; if (!box || !u) return;
  const L = u.latest;
  const head = { idle: '', checking: '<span class="badge">đang kiểm tra…</span>', latest: '<span class="badge b-ok">✓ đang là bản mới nhất</span>',
    available: `<span class="badge b-warn">có bản ${esc(L && L.version)}</span>`, downloading: '<span class="badge">đang tải…</span>',
    ready: '<span class="badge b-ok">đã tải xong, chờ khởi động lại</span>', needFull: '<span class="badge b-warn">cần tải bản đầy đủ</span>',
    bad: '<span class="badge b-err">bản mới lỗi trên máy này</span>', error: '<span class="badge b-err">lỗi</span>' }[u.state] || '';
  const pct = u.total ? Math.min(100, Math.round((u.got / u.total) * 100)) : 0;
  box.innerHTML = `<h2>Cập nhật ${head}</h2>
  <div class="mute small">Đang chạy <b>${esc(u.version)}</b>${u.fromPayload ? ` (bản cập nhật trong app, bộ cài gốc ${esc(u.shellVersion)})` : ''}${u.checkedAt ? ` · kiểm tra lúc ${esc(new Date(u.checkedAt).toLocaleString())}` : ''}</div>
  ${u.notice ? `<div class="warnbox">Bản ${esc(u.notice.from)} ${u.notice.type === 'corrupt' ? 'bị hỏng file' : 'lỗi khi khởi động'} nên app đã tự quay về ${esc(u.notice.to)}.</div>` : ''}
  ${L && u.state !== 'latest' ? `<div style="margin-top:10px"><b>Tom Multitask ${esc(L.version)}</b> <span class="mute small">${esc(String(L.date).slice(0, 10))}</span></div>
    ${L.notes ? `<div class="trSrc" id="u_notes" style="margin-top:6px;max-height:180px">${esc(L.notes)}</div>` : ''}
    ${L.reason ? `<div class="warnbox">${esc(L.reason)}</div>` : ''}` : ''}
  ${u.state === 'downloading' ? `<div class="prog" style="margin-top:10px"><div id="u_bar" style="width:${pct}%"></div></div><div class="mute small" id="u_pct">${pct}% · ${fmtMB(u.got)}${u.total ? ' / ' + fmtMB(u.total) : ''}</div>` : ''}
  ${u.error ? `<div class="warnbox" id="u_err">${esc(u.error)}</div>` : ''}
  <div class="row" style="margin-top:12px">
    ${u.state === 'available' ? '<button class="pri" id="u_dl">Tải bản cập nhật</button>' : ''}
    ${u.state === 'ready' ? '<button class="ok" id="u_restart">Khởi động lại để cập nhật</button>' : ''}
    ${(u.state === 'needFull' || u.state === 'bad') && L && L.fullUrl ? '<button class="pri" id="u_full">Tải bản đầy đủ</button>' : ''}
    ${['checking', 'downloading', 'ready'].includes(u.state) ? '' : '<button id="u_check">Kiểm tra cập nhật</button>'}
  </div>
  <details style="margin-top:10px" ${u.token.source !== 'none' ? 'open' : ''}><summary class="mute small" style="cursor:pointer">GitHub token (không bắt buộc, chỉ cần khi repo app để private)</summary>${tokenBox(u)}</details>
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink);margin-top:12px"><input type="checkbox" id="u_auto" style="width:auto" ${S.settings.autoUpdate ? 'checked' : ''}> Tự kiểm tra bản mới (tối đa 6 giờ một lần)</label>
  <div class="mute small" style="margin-top:6px">Bản cập nhật được kiểm tra mã sha256 trước khi cài; nếu bản mới không chạy được, app tự quay về bản trước. Kênh: <span class="mono">${esc(u.url)}</span></div>`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('u_check', () => call('upd:check').catch(() => {}));
  on('u_dl', () => call('upd:download').catch(() => {}));
  on('u_restart', () => call('upd:restart').catch(() => {}));
  on('u_full', () => call('upd:openFull').catch(() => {}));
  on('u_tsave', async () => { const t = $('u_token').value; $('u_token').value = ''; if (await call('upd:setToken', { token: t }).catch(() => null)) toast('Đã lưu token (mã hoá trong máy)'); });
  on('u_tdel', () => call('upd:clearToken').catch(() => {}));
  if ($('u_tsrc')) $('u_tsrc').onchange = (e) => call('upd:useAcc', { id: e.target.value === 'own' ? null : e.target.value }).catch(() => {});
  $('u_auto').onchange = async (e) => { await call('upd:setAuto', { on: e.target.checked }); S.settings.autoUpdate = e.target.checked; };
}

// optional token for a private repo: own PAT (masked, never shown back) or the PAT of a github.com Git nick
function tokenBox(u) {
  const t = u.token; const usingAcc = t.source === 'acc';
  const opts = [`<option value="own" ${usingAcc ? '' : 'selected'}>Token riêng ${t.hasOwn ? '(đã lưu ••••••••)' : '(chưa có)'}</option>`]
    .concat(u.accs.map((a) => `<option value="${esc(a.id)}" ${t.acc === a.id ? 'selected' : ''}>Dùng token của nick ${esc(a.label)} (${esc(a.user)})</option>`));
  return `<label>GitHub token để cập nhật <span class="mute small">(fine-grained PAT, chỉ đọc Contents của repo app)</span></label>
  <div class="mute small" style="margin-bottom:6px">Repo công khai thì để trống. Chỉ khi kênh cập nhật báo 404/401 app mới dùng token, gửi riêng tới api.github.com, cất mã hoá trong Keychain/DPAPI.</div>
  ${u.accs.length ? `<select id="u_tsrc" style="margin-bottom:6px">${opts.join('')}</select>` : ''}
  ${usingAcc ? '' : `<div class="row"><input id="u_token" type="password" autocomplete="off" placeholder="${t.hasOwn ? 'đã lưu, dán token mới để thay' : 'github_pat_…'}" style="flex:1;width:auto"><button id="u_tsave">Lưu token</button>${t.hasOwn ? '<button class="err" id="u_tdel">Xoá</button>' : ''}</div>`}`;
}

function updDot() { $('updDot').classList.toggle('hidden', !(S && S.update && ['available', 'ready', 'needFull'].includes(S.update.state))); }

// ------------------------------------------------------------------ git
function accLabel(id) { const a = GS.accounts.find((x) => x.id === id); return a ? `${esc(a.label)} <span class="mute">(${esc(a.host)} / ${esc(a.user)})</span>` : '<span style="color:var(--err)">nick đã xoá</span>'; }
function statusBadge(a) {
  if (a.auth === 'pat' && !a.hasToken) return '<span class="badge b-warn">chưa có token</span>';
  if (!a.status) return '<span class="badge">chưa kiểm tra</span>';
  if (!a.status.ok) return '<span class="badge b-err">lỗi</span>';
  let exp = '';
  if (a.status.expires) { const days = Math.round((new Date(a.status.expires) - Date.now()) / 864e5); exp = days <= 7 ? ` <span class="badge b-warn">token còn ${days} ngày</span>` : ` <span class="mute small">hết hạn ${esc(String(a.status.expires).slice(0, 10))}</span>`; }
  return `<span class="badge b-ok">✓ ${esc(a.status.who)}</span>${exp}`;
}
function branchDesc(p) {
  const s = p.srcMode === 'fixed' ? `nhánh ${esc(p.srcBranch)}` : p.srcMode === 'pattern' ? `mới nhất khớp ${esc(p.srcBranch)}` : 'nhánh mới nhất';
  const d = p.dstMode === 'fixed' ? `vào ${esc(p.dstBranch)}` : p.dstMode === 'prefix' ? `vào ${esc(p.dstBranch)}&lt;nhánh&gt;` : 'trùng tên nhánh';
  return `${s} → ${d}`;
}

async function renderGit() {
  GS = await call('git:state');
  const pid = cur.profileId;
  const accs = GS.accounts.filter((a) => a.profileId === pid);
  const others = GS.accounts.filter((a) => a.profileId !== pid);
  const pairs = GS.pairs.filter((x) => x.profileId === pid);
  const gp = (GS.profilePairs && GS.profilePairs[pid]) || {}; const hasGp = !!(gp.srcAcc && gp.dstAcc);
  const accOpts = (sel) => GS.accounts.map((a) => { const pr = prof(a.profileId); return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.label)} (${esc(a.host)} / ${esc(a.user)})${pr && pr.id !== pid ? ' · ' + esc(pr.name) : ''}</option>`; }).join('');
  const busy = GS.task && !GS.task.done;
  $('pGit').innerHTML = `${GS.gitVersion ? '' : '<div class="warnbox">Máy chưa có <b>Git</b>. Mac: chạy <span class="mono">xcode-select --install</span>. Windows: cài Git for Windows (git-scm.com) rồi mở lại app.</div>'}
  <div class="grid2"><div>
    <div class="card"><h2>Nick Git của hồ sơ này <span class="grow"></span><button class="pri sm" id="g_addAcc">+ Thêm nick</button></h2>
    ${accs.length ? accs.map((a) => `<div class="acc"><div class="row"><b>${esc(a.label)}</b><span class="badge">${a.auth === 'ssh' ? 'SSH key' : 'PAT'}</span>${statusBadge(a)}<span class="grow"></span>
      <button class="sm" data-verify="${a.id}">Kiểm tra</button><button class="sm" data-editacc="${a.id}">Sửa</button></div>
      <div class="mute small">${esc(a.host)} · ${esc(a.user)} · ${esc(a.email)}</div>
      ${a.status && !a.status.ok ? `<div class="small" style="color:var(--err)">${esc(a.status.msg)}</div>` : ''}
      ${a.auth === 'ssh' && a.pub ? `<details><summary class="small mute">Public key (dán lên trang SSH keys của nick)</summary><div class="pub mono">${esc(a.pub)}</div><button class="sm" data-copy="${esc(a.pub)}">Copy</button></details>` : ''}</div>`).join('') : '<div class="mute">Chưa có nick nào gắn với hồ sơ này.</div>'}
    ${others.length ? `<div class="mute small" style="margin-top:8px">Nick ở hồ sơ khác vẫn chọn được khi tạo cặp (${others.length} nick).</div>` : ''}</div>
    <div class="card"><h2>Nhật ký <span class="badge ${GS.task ? (GS.task.done ? (GS.task.ok ? 'b-ok' : 'b-err') : '') : ''}" id="g_state">${GS.task ? (GS.task.done ? (GS.task.ok ? 'xong' : 'lỗi') : 'đang chạy…') : 'chưa chạy'}</span><span class="grow"></span><button class="sm" id="g_clearLog">Xoá</button></h2><div id="log"></div></div>
  </div><div>
    <div class="card"><h2>Cặp nick của hồ sơ</h2>
      <div class="row"><div class="grow"><label>Nick nguồn (pull về)</label><select id="g_srcAcc"><option value="">— chọn —</option>${accOpts(gp.srcAcc)}</select></div><div class="arrow" style="align-self:flex-end;padding:0 6px 8px">➜</div>
      <div class="grow"><label>Nick đích (push lên, đứng tên commit)</label><select id="g_dstAcc"><option value="">— chọn —</option>${accOpts(gp.dstAcc)}</select></div></div>
      <div class="row" style="margin-top:8px"><span class="mute small grow">Mọi dự án của hồ sơ dùng cặp nick này. Commit đẩy lên chỉ đứng tên nick đích, không mang nhánh, mã commit, tên hay email nick nguồn.</span><button class="sm pri" id="g_savePair">Lưu cặp nick</button></div></div>
    <div class="card"><h2>Dự án (${pairs.length}) <span class="grow"></span><button class="pri sm" id="g_addPair" ${hasGp ? '' : 'disabled title="Chọn và lưu cặp nick trước"'}>+ Thêm dự án</button></h2>
    ${pairs.length ? pairs.map((p) => { const l = p.last || {}; const pr = GS.prepared[p.id]; const off = hasGp && (p.srcAcc !== gp.srcAcc || p.dstAcc !== gp.dstAcc); const h = p.history || []; return `<div class="pair"><div class="row"><span class="chip" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b>${off ? '<span class="badge b-err" title="Dự án này đang dùng nick khác với cặp nick của hồ sơ. Bấm Lưu cặp nick để áp dụng cho mọi dự án.">nick khác cặp</span>' : ''}<span class="grow"></span>
      <button class="sm" data-pull="${p.id}" ${busy ? 'disabled' : ''}>Pull</button><button class="sm pri" data-prep="${p.id}" ${busy ? 'disabled' : ''}>Pull + Push</button>${pr && !pr.noChange ? `<button class="sm ok" data-review="${p.id}">Xem & đẩy</button>` : ''}<button class="sm" data-hist="${p.id}">Lịch sử (${h.length})</button><button class="sm" data-editpair="${p.id}">Sửa</button></div>
      <div class="flow"><div class="side"><div class="mono">${esc(p.srcUrl)}</div></div><div class="arrow">➜</div><div class="side"><div class="mono">${esc(p.dstUrl)}</div></div></div>
      <div class="small mute">${branchDesc(p)} · mẫu commit "${esc(p.message)}"</div>
      <div class="small mute">${l.sha ? `Pull gần nhất: <b>${esc(l.branch)}</b> @ ${esc(l.sha.slice(0, 8))} (${new Date(l.pulledAt).toLocaleString()})` : 'Chưa pull lần nào.'}${h[0] ? ` · Đẩy gần nhất ${new Date(h[0].at).toLocaleString()}: "${esc(h[0].message.split('\n')[0].slice(0, 60))}"` : (l.pushedAt ? ` · Đẩy gần nhất ${new Date(l.pushedAt).toLocaleString()}` : '')}${l.pushedSha && l.sha && l.pushedSha !== l.sha ? ' · <b style="color:var(--warn)">nguồn có code mới chưa đẩy</b>' : ''}</div></div>`; }).join('') : `<div class="mute">${hasGp ? 'Chưa có dự án. Mỗi dự án = 1 repo nguồn + 1 repo đích, pull/push bằng cặp nick ở trên.' : 'Chọn cặp nick nguồn → đích ở trên, rồi thêm dự án.'}</div>`}</div>
  </div></div>`;
  $('g_addAcc').onclick = () => accountForm(null);
  $('g_addPair').onclick = () => pairForm(null);
  $('g_savePair').onclick = async () => {
    const r = await call('git:saveProfilePair', { profileId: pid, srcAcc: $('g_srcAcc').value, dstAcc: $('g_dstAcc').value });
    toast(r.moved ? `Đã lưu cặp nick, áp dụng cho ${r.moved} dự án` : 'Đã lưu cặp nick'); renderGit();
  };
  document.querySelectorAll('[data-hist]').forEach((b) => { b.onclick = () => showHistory(GS.pairs.find((a) => a.id === b.dataset.hist)); });
  $('g_clearLog').onclick = async () => { await call('git:clearLog'); $('log').innerHTML = ''; };
  document.querySelectorAll('[data-verify]').forEach((b) => { b.onclick = async () => { b.disabled = true; const r = await call('git:verify', { id: b.dataset.verify }); toast(r.ok ? `Đúng nick: ${r.who}` : r.msg, !r.ok); renderGit(); }; });
  document.querySelectorAll('[data-editacc]').forEach((b) => { b.onclick = () => accountForm(GS.accounts.find((a) => a.id === b.dataset.editacc)); });
  document.querySelectorAll('[data-editpair]').forEach((b) => { b.onclick = () => pairForm(GS.pairs.find((a) => a.id === b.dataset.editpair)); });
  document.querySelectorAll('[data-pull]').forEach((b) => { b.onclick = () => runGit(b.dataset.pull, 'pull'); });
  document.querySelectorAll('[data-prep]').forEach((b) => { b.onclick = () => runGit(b.dataset.prep, 'prepare'); });
  document.querySelectorAll('[data-review]').forEach((b) => { b.onclick = () => showConfirm(GS.prepared[b.dataset.review]); });
  document.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Đã copy public key'); }; });
  const lg = await call('git:log', { all: true });
  lg.lines.forEach(addLine);
}

function addLine(l) {
  const box = $('log'); if (!box) return;
  const d = document.createElement('div'); d.className = 'k-' + l.k; d.textContent = `${l.t}  ${l.m}`; box.appendChild(d); box.scrollTop = box.scrollHeight;
}

async function runGit(pairId, kind) {
  await call('git:run', { pairId, kind });
  renderGit();
}

function accountForm(a) {
  a = a || { auth: 'pat', profileId: cur.profileId };
  openModal(`<h3>${a.id ? 'Sửa nick Git' : 'Thêm nick Git'}</h3>
  <label>Tên gợi nhớ</label><input id="a_label" value="${esc(a.label || '')}" placeholder="Github cá nhân / Gitlab công ty">
  <div class="row"><div class="grow"><label>Máy chủ</label><input id="a_host" value="${esc(a.host || 'github.com')}" placeholder="github.com / gitlab.com / gitlab.congty.vn"></div>
  <div class="grow"><label>Username</label><input id="a_user" value="${esc(a.user || '')}"></div></div>
  <label>Email (đứng tên commit khi nick này là nick ĐÍCH)</label><input id="a_email" value="${esc(a.email || '')}">
  <label>Cách đăng nhập</label>${seg('a_auth', [['pat', '🔑 Token (PAT)'], ['ssh', '🗝️ SSH key']], a.auth)}
  <div id="a_patBox"><label>Personal Access Token ${a.hasToken ? '<span class="badge b-ok">đã lưu, để trống = giữ</span>' : ''}</label><input id="a_token" type="password" placeholder="ghp_… / glpat-…">
    <div class="mute small">Quyền tối thiểu: GitHub fine-grained → Contents (Read, hoặc Read and write cho nick đích), chỉ chọn repo cần. GitLab → read_repository (+ write_repository cho nick đích) + read_user. Token cất trong kho bảo mật của máy (Keychain / DPAPI), không ghi ra file.</div></div>
  <div id="a_sshBox"><label>SSH key</label><div class="row"><span class="mono grow" id="a_keyPath">${esc(a.keyPath || 'Tự tạo key riêng cho nick này (khuyên dùng)')}</span><button class="sm" id="a_pick">Chọn key có sẵn…</button></div>
    <div class="mute small">Lưu xong, app hiện public key để dán lên trang SSH keys của nick. Key chỉ dùng cho nick này, không đụng ~/.ssh/config.</div></div>
  <div class="row" style="margin-top:16px">${a.id ? '<button class="err" id="a_del">Xoá nick</button>' : ''}<span class="grow"></span><button id="a_cancel">Huỷ</button><button class="pri" id="a_save">Lưu</button></div>`);
  let keyPath = a.keyPath || '';
  const sw = () => { const ssh = segVal('a_auth') === 'ssh'; $('a_patBox').classList.toggle('hidden', ssh); $('a_sshBox').classList.toggle('hidden', !ssh); };
  $('a_auth').addEventListener('change', sw); sw();
  $('a_pick').onclick = async () => { const k = await call('git:chooseKey'); if (k) { keyPath = k; $('a_keyPath').textContent = k; } };
  $('a_cancel').onclick = closeModal;
  $('a_save').onclick = async () => {
    const r = await call('git:saveAccount', { id: a.id, profileId: a.profileId || cur.profileId, label: $('a_label').value, host: $('a_host').value, user: $('a_user').value, email: $('a_email').value, auth: segVal('a_auth'), token: $('a_token').value, keyPath });
    closeModal(); toast('Đã lưu nick'); await renderGit();
    if (r.pub) openModal(`<h3>Dán public key này lên nick</h3><div class="mute small">GitHub: Settings → SSH and GPG keys → New SSH key. GitLab: Preferences → SSH Keys.</div><div class="pub mono">${esc(r.pub)}</div><div class="row" style="margin-top:12px"><span class="grow"></span><button id="k_copy">Copy</button><button class="pri" id="k_ok">Xong, kiểm tra nick</button></div>`),
    $('k_copy') && ($('k_copy').onclick = () => { navigator.clipboard.writeText(r.pub); toast('Đã copy'); }),
    $('k_ok') && ($('k_ok').onclick = async () => { closeModal(); const v = await call('git:verify', { id: r.id }); toast(v.ok ? `Đúng nick: ${v.who}` : v.msg, !v.ok); renderGit(); });
  };
  if (a.id) $('a_del').onclick = async () => { if (!confirm(`Xoá nick "${a.label}"?`)) return; await call('git:deleteAccount', { id: a.id }); closeModal(); renderGit(); };
}

function pairForm(p) {
  p = p || { srcMode: 'newest', dstMode: 'same', message: 'Cập nhật {branch} {date}', color: COLORS[5], profileId: cur.profileId };
  const gp = (GS.profilePairs && GS.profilePairs[p.profileId || cur.profileId]) || {};
  const opts = (sel) => GS.accounts.map((a) => { const pr = prof(a.profileId); return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.label)} (${esc(a.host)} / ${esc(a.user)})${pr && pr.id !== cur.profileId ? ' · ' + esc(pr.name) : ''}</option>`; }).join('');
  openModal(`<h3>${p.id ? 'Sửa dự án' : 'Dự án mới'}</h3>
  <div class="mute small">Pull/push bằng cặp nick của hồ sơ: <b>${accLabel(gp.srcAcc)}</b> ➜ <b>${accLabel(gp.dstAcc)}</b></div>
  <label>Tên dự án</label><input id="p_name" value="${esc(p.name || '')}" placeholder="Screw Bubble → repo công ty">
  <label>Trello (tuỳ chọn: link bảng hoặc workspace mở sẵn)</label><input id="f_trello" value="${esc(p.trelloUrl || '')}" placeholder="https://trello.com/w/tencongty (để trống = trang chủ Trello)">
  <label>Màu</label>${colorPicker('p_color', p.color)}
  <div class="card" style="margin-top:12px"><h2>Nguồn (pull về)</h2>
    <label>Repo nguồn</label><input id="p_srcUrl" value="${esc(p.srcUrl || '')}" placeholder="https://github.com/ten/repo hoặc git@github.com:ten/repo.git">
    <label>Lấy nhánh nào</label>${seg('p_srcMode', [['newest', 'Mới nhất (tự động)'], ['fixed', 'Cố định'], ['pattern', 'Mới nhất theo mẫu']], p.srcMode)}
    <input id="p_srcBranch" value="${esc(p.srcBranch || '')}" placeholder="main  hoặc  release/*" style="margin-top:6px"></div>
  <div class="card"><h2>Đích (push lên)</h2>
    <label>Repo đích</label><input id="p_dstUrl" value="${esc(p.dstUrl || '')}" placeholder="https://gitlab.congty.vn/team/repo">
    <label>Đẩy vào nhánh</label>${seg('p_dstMode', [['same', 'Trùng tên nhánh nguồn'], ['fixed', 'Nhánh cố định'], ['prefix', 'Thêm tiền tố']], p.dstMode)}
    <input id="p_dstBranch" value="${esc(p.dstBranch || '')}" placeholder="main  hoặc tiền tố  sync/" style="margin-top:6px">
    <label>Nội dung commit</label><input id="p_msg" value="${esc(p.message || '')}"><div class="mute small">Mẫu điền sẵn khi đẩy (vẫn sửa được ở bước xác nhận). Biến: {branch} = nhánh đích, {date} = ngày đẩy. Không có biến nào lấy thông tin nguồn.</div></div>
  <div class="row" style="margin-top:12px">${p.id ? '<button class="err" id="p_del">Xoá dự án</button>' : ''}<span class="grow"></span><button id="p_cancel">Huỷ</button><button class="pri" id="p_save">Lưu</button></div>`);
  const upd = () => { $('p_srcBranch').classList.toggle('hidden', segVal('p_srcMode') === 'newest'); $('p_dstBranch').classList.toggle('hidden', segVal('p_dstMode') === 'same'); };
  $('p_srcMode').addEventListener('change', upd); $('p_dstMode').addEventListener('change', upd); upd();
  $('p_cancel').onclick = closeModal;
  $('p_save').onclick = async () => {
    await call('git:savePair', { id: p.id, profileId: p.profileId || cur.profileId, name: $('p_name').value, color: pickedColor('p_color'), srcAcc: gp.srcAcc, srcUrl: $('p_srcUrl').value, srcMode: segVal('p_srcMode'), srcBranch: $('p_srcBranch').value, dstAcc: gp.dstAcc, dstUrl: $('p_dstUrl').value, dstMode: segVal('p_dstMode'), dstBranch: $('p_dstBranch').value, message: $('p_msg').value });
    closeModal(); toast('Đã lưu dự án'); renderGit();
  };
  if (p.id) $('p_del').onclick = async () => { if (!confirm(`Xoá dự án "${p.name}"?`)) return; await call('git:deletePair', { id: p.id }); closeModal(); renderGit(); };
}

function showConfirm(pr) {
  if (!pr) return;
  openModal(`<h3>Xác nhận đẩy lên repo đích</h3>
  ${pr.noChange ? '<div class="warnbox">Repo đích đã giống hệt code nguồn, không có gì để đẩy.</div>' : ''}
  <div class="kv"><div>Nick đích</div><div><b>${esc(pr.dstUser)}</b> · ${esc(pr.dstHost)} ✓ đã kiểm tra</div>
  <div>Repo đích</div><div class="mono">${esc(pr.dstUrl)}</div><div>Nhánh đích</div><div><b>${esc(pr.dstBranch)}</b>${pr.newBranch ? ' (nhánh mới)' : ''}</div>
  <div>Code lấy từ</div><div>nhánh <b>${esc(pr.srcBranch)}</b> @ ${esc(pr.sha.slice(0, 8))} (${esc(String(pr.srcDate).slice(0, 16))})</div>
  <div>Đứng tên</div><div><b>${esc(pr.dstUser)} &lt;${esc(pr.dstEmail)}&gt;</b></div>
  <div>Thay đổi</div><div><b>${esc(pr.stat || '—')}</b> (${pr.fileCount} file)</div></div>
  ${pr.noChange ? '' : `<label>Nội dung commit (sửa được trước khi đẩy)</label><textarea id="c_msg" rows="3" spellcheck="false">${esc(pr.message)}</textarea>`}
  ${pr.lfs ? '<div class="warnbox">Repo nguồn dùng Git LFS: chỉ chép file con trỏ LFS, file lớn sẽ không có trên repo đích.</div>' : ''}
  <div class="mute small">Commit chỉ đứng tên nick đích, không mang lịch sử, nhánh, mã commit, tên hay email nick nguồn. Nội dung commit có dấu vết nguồn sẽ bị chặn. Toàn bộ file trên nhánh đích được thay bằng code nguồn. Không bao giờ ghi đè (force push).</div>
  ${pr.files && pr.files.length ? `<div class="files mono">${pr.files.map(esc).join('<br>')}${pr.fileCount > pr.files.length ? '<br>…' : ''}</div>` : ''}
  <div class="row" style="margin-top:14px"><span class="grow"></span><button id="c_cancel">Huỷ</button>${pr.noChange ? '' : '<button class="ok" id="c_push">Đẩy lên</button>'}</div>`);
  $('c_cancel').onclick = async () => { closeModal(); await call('git:cancel', { pairId: pr.pairId }); renderGit(); };
  if (!pr.noChange) $('c_push').onclick = async () => {
    const message = $('c_msg').value.trim();
    if (!message) { toast('Nội dung commit không được để trống.', true); $('c_msg').focus(); return; }
    closeModal(); await call('git:push', { pairId: pr.pairId, message }); renderGit();
  };
}

function showHistory(p) {
  if (!p) return;
  const h = p.history || [];
  openModal(`<h3>Lịch sử đẩy: ${esc(p.name)}</h3><div class="mute small mono">${esc(p.dstUrl)}</div>
  ${h.length ? `<div class="files" style="max-height:50vh">${h.map((x, i) => `<div class="pair"><div class="row"><b>${new Date(x.at).toLocaleString()}</b><span class="badge">${esc(x.branch)}</span><span class="mono small">${esc((x.commit || '').slice(0, 10))}</span><span class="grow"></span><button class="sm" data-hcopy="${i}">Copy nội dung</button></div><div style="white-space:pre-wrap">${esc(x.message)}</div><div class="small mute">${x.files || 0} file thay đổi</div></div>`).join('')}</div>` : '<div class="mute">Chưa đẩy lần nào (lịch sử có từ bản 2.8).</div>'}
  <div class="row" style="margin-top:12px"><span class="grow"></span><button id="h_close">Đóng</button></div>`);
  $('h_close').onclick = closeModal;
  document.querySelectorAll('[data-hcopy]').forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(h[+b.dataset.hcopy].message); toast('Đã copy nội dung commit'); }; });
}

// ------------------------------------------------------------------ translation popup
function showTranslate(t) {
  const lang = { en: 'tiếng Anh', vi: 'tiếng Việt' };
  const body = t.state === 'loading' ? '<div class="mute">Đang dịch…</div>'
    : t.state === 'error' ? `<div class="warnbox">${esc(t.error)}</div>`
      : `<div class="trOut" id="tr_out">${esc(t.text)}</div>`;
  openModal(`<h3>Dịch sang ${lang[t.to] || t.to}</h3>
  <div class="mute small" style="margin-bottom:6px">Đoạn gốc${t.from && t.from !== 'auto' ? ` (${esc(t.from)})` : ''}:</div><div class="trSrc">${esc(t.source)}</div>
  <div class="mute small" style="margin:10px 0 6px">Bản dịch (Google Dịch):</div>${body}
  <div class="row" style="margin-top:14px"><button class="sm" id="tr_swap">${t.to === 'en' ? '⇄ Dịch sang tiếng Việt' : '⇄ Dịch sang tiếng Anh'}</button><span class="grow"></span>
  <button id="tr_close">Đóng</button>${t.state === 'done' ? `<button id="tr_copy">Copy</button>${t.editable ? '<button class="pri" id="tr_rep">Thay bằng bản dịch</button>' : ''}` : ''}</div>`);
  $('tr_close').onclick = closeModal;
  $('tr_swap').onclick = () => call('tr:again', { to: t.to === 'en' ? 'vi' : 'en' });
  if (t.state === 'done') {
    $('tr_copy').onclick = () => { navigator.clipboard.writeText(t.text); toast('Đã copy bản dịch'); };
    if (t.editable) $('tr_rep').onclick = async () => { $('modal').classList.add('hidden'); await call('tr:replace', { text: t.text }); toast('Đã thay vào ô soạn'); };
  }
}

// ------------------------------------------------------------------ bảng hồ sơ trượt (2.6.0)
let flyTimer = null;
function openFly() {
  clearTimeout(flyTimer);
  if (!$('profFly').classList.contains('hidden')) return;
  $('profFly').classList.remove('hidden'); $('profBtn').setAttribute('aria-expanded', 'true');
  mt.call('app:peek', { w: 280 });   // web view nằm trên giao diện: main chụp ảnh trang rồi gỡ view ra để bảng đè lên (2.7.0)
}
function closeFly(now) {
  clearTimeout(flyTimer);
  const go = () => { if ($('profFly').classList.contains('hidden')) return; $('profFly').classList.add('hidden'); $('profBtn').setAttribute('aria-expanded', 'false'); mt.call('app:peek', { w: 0 }); };
  if (now) go(); else flyTimer = setTimeout(() => { if (!$('profFly').matches(':hover') && !$('profBtn').matches(':hover') && !$('profFly').contains(document.activeElement)) go(); }, 300);
}

// ------------------------------------------------------------------ quản lý dự án (2.6.0)
const PJ_STATUS = { doing: 'Đang làm', waiting: 'Chờ', paused: 'Tạm dừng', done: 'Xong' };
let pjFilter = 'open';
function dueState(due) {
  if (!due) return '';
  const d = new Date(due + 'T23:59:59'); const days = Math.ceil((d - Date.now()) / 86400000);
  return days < 0 ? 'late' : days <= 3 ? 'soon' : '';
}
function dueText(due) {
  if (!due) return '';
  const days = Math.ceil((new Date(due + 'T23:59:59') - Date.now()) / 86400000);
  const [y, m, d] = due.split('-'); const s = `${d}/${m}/${y}`;
  return days < 0 ? `${s} · trễ ${-days} ngày` : days === 0 ? `${s} · hôm nay` : days <= 3 ? `${s} · còn ${days} ngày` : s;
}
function miniAva(p) { return `<span title="${esc(p.name)}" style="background:${p.logo ? 'var(--card)' : esc(p.color)}">${p.logo ? `<img class="logo" src="${esc(p.logo)}" alt="">` : esc(initials(p.name))}</span>`; }
function renderProjects() {
  const all = (S.projects || []).slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9999').localeCompare(b.due || '9999') || b.updatedAt - a.updatedAt);
  const list = all.filter((x) => pjFilter === 'all' || (pjFilter === 'open' ? x.status !== 'done' : x.status === 'done'));
  const cards = list.map((x) => {
    const ds = x.status !== 'done' ? dueState(x.due) : ''; const tasks = x.tasks || []; const done = tasks.filter((t) => t.done).length;
    const profs = (x.profileIds || []).map(prof).filter(Boolean);
    return `<div class="pj" data-id="${x.id}" tabindex="0" role="button" aria-label="${esc(x.name)}">
      <div class="row"><h4 class="grow">${esc(x.name)}</h4><span class="pchip ${x.status}">${PJ_STATUS[x.status] || ''}</span></div>
      <div class="mute small">${x.owner ? '👤 ' + esc(x.owner) + ' · ' : ''}${x.due ? `<span class="pchip ${ds === 'late' ? 'late' : ds === 'soon' ? 'waiting' : ''}">📅 ${esc(dueText(x.due))}</span>` : 'Chưa đặt hạn'}</div>
      <div class="pbar" title="${x.progress}%"><i style="width:${x.progress}%"></i></div>
      <div class="row small mute"><span>${x.progress}%${tasks.length ? ` · ${done}/${tasks.length} việc` : ''}</span><span class="grow"></span><div class="pjAvas">${profs.map(miniAva).join('')}</div></div>
    </div>`; }).join('');
  $('pProj').innerHTML = `<div class="pjHead"><h2 style="margin:0" class="grow">Dự án</h2>
    ${seg('pj_filter', [['open', 'Đang theo dõi'], ['done', 'Đã xong'], ['all', 'Tất cả']], pjFilter)}
    <span class="mute small" id="pj_last">${S.projSync && S.projSync.lastSync ? 'Đồng bộ lúc ' + new Date(S.projSync.lastSync).toLocaleString('vi-VN') : S.projSync && S.projSync.url ? 'Chưa đồng bộ lần nào' : 'Chỉ lưu trên máy này'}</span>
    <button id="pj_sync" title="Kéo bản mới từ repo, gộp với máy này rồi đẩy lên">⟳ Đồng bộ</button><button class="ghost" id="pj_scfg" title="Cài đặt đồng bộ (repo + nick Git)" aria-label="Cài đặt đồng bộ">⚙</button>
    <button class="pri" id="pj_new">＋ Dự án mới</button></div>
    ${cards ? `<div class="pjGrid">${cards}</div>` : `<div class="empty"><p class="mute">${all.length ? 'Không có dự án nào trong mục này.' : 'Chưa có dự án. Tạo dự án và gắn với hồ sơ để mở nhanh Slack / Trello / Discord / Git của dự án.'}</p></div>`}`;
  $('pj_new').onclick = () => projectForm(null);
  $('pj_scfg').onclick = () => syncForm();
  $('pj_sync').onclick = async () => {
    if (!S.projSync || !S.projSync.url) return syncForm();
    const b = $('pj_sync'); b.disabled = true; b.textContent = '⟳ Đang đồng bộ…';
    try { const r = await call('proj:sync'); toast(`Đã đồng bộ ${r.count} dự án${r.pushed ? ' (đã đẩy lên)' : ''} ✓`); await refresh(); }
    catch (_) { /* call() đã báo lỗi */ } finally { if ($('pj_sync')) { $('pj_sync').disabled = false; $('pj_sync').textContent = '⟳ Đồng bộ'; } }
  };
  $('pj_filter').addEventListener('change', () => { pjFilter = segVal('pj_filter'); renderProjects(); });
  document.querySelectorAll('#pProj .pj').forEach((c) => {
    const open = () => projectForm((S.projects || []).find((x) => x.id === c.dataset.id));
    c.onclick = open; c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
}
async function syncForm() {
  GS = await call('git:state');
  const c = S.projSync || {};
  const accs = GS.accounts.map((a) => `<option value="${a.id}" ${a.id === c.accId ? 'selected' : ''}>${esc(a.label)} (${esc(a.host)} / ${esc(a.user)})</option>`).join('');
  openModal(`<h3>Đồng bộ dự án giữa các máy</h3>
  <div class="mute small">Dự án được lưu thành file <b>projects.json</b> trong một repo Git riêng (nên để <b>private</b>). Máy nào cùng trỏ vào repo này, bấm Đồng bộ là thấy giống nhau. Hai máy sửa cùng một dự án thì bản sửa sau cùng được giữ.</div>
  <label>Nick Git dùng để đọc / ghi repo</label><select id="s_acc"><option value="">— chọn —</option>${accs}</select>
  ${GS.accounts.length ? '' : '<div class="warnbox small">Chưa có nick Git nào. Vào một hồ sơ → tab Git để thêm nick (token hoặc SSH key) trước.</div>'}
  <label>Repo (tạo sẵn một repo trống, private)</label><input id="s_url" value="${esc(c.url || '')}" placeholder="https://github.com/ten/tom-projects">
  <label>Nhánh</label><input id="s_branch" value="${esc(c.branch || 'main')}">
  <div class="row" style="margin-top:16px"><span class="grow"></span><button id="s_cancel">Huỷ</button><button class="pri" id="s_save">Lưu & đồng bộ ngay</button></div>`);
  $('s_cancel').onclick = closeModal;
  $('s_save').onclick = async () => {
    await call('proj:syncCfg', { accId: $('s_acc').value, url: $('s_url').value, branch: $('s_branch').value });
    closeModal(); await refresh();
    try { const r = await call('proj:sync'); toast(`Đã đồng bộ ${r.count} dự án ✓`); await refresh(); } catch (_) { /* đã báo */ }
  };
}
function projectForm(x) {
  x = x || { status: 'doing', progress: 0, profileIds: cur.profileId ? [cur.profileId] : [], tasks: [] };
  let tasks = (x.tasks || []).map((t) => ({ ...t }));
  const tHtml = () => tasks.map((t, i) => `<div class="titem ${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span class="t">${esc(t.text)}</span><button class="sm ghost" data-del="${i}" title="Xoá việc">✕</button></div>`).join('');
  const linked = (x.profileIds || []).map(prof).filter(Boolean);
  openModal(`<h3>${x.id ? 'Sửa dự án' : 'Dự án mới'}</h3>
  <label>Tên dự án</label><input id="j_name" value="${esc(x.name || '')}" placeholder="Ride a Pet · bản 1.2">
  <label>Trạng thái</label>${seg('j_status', Object.entries(PJ_STATUS), x.status)}
  <div class="row" style="gap:10px"><div class="grow"><label>Hạn chót</label><input type="date" id="j_due" value="${esc(x.due || '')}"></div>
  <div class="grow"><label>Người phụ trách</label><input id="j_owner" value="${esc(x.owner || '')}" placeholder="Tên"></div></div>
  <label>Tiến độ: <b id="j_pv">${x.progress || 0}%</b></label><input type="range" id="j_prog" min="0" max="100" step="5" value="${x.progress || 0}">
  <label>Gắn với hồ sơ</label><div class="pchk">${S.profiles.map((p) => `<label><input type="checkbox" class="j_prof" value="${p.id}" ${(x.profileIds || []).includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('') || '<span class="mute small">Chưa có hồ sơ nào.</span>'}</div>
  ${linked.length ? `<label>Mở nhanh</label><div class="plinks">${linked.map((p) => ['slack', 'trello', 'discord', 'git'].map((k) => `<button class="sm" data-go="${p.id}|${k}">${esc(p.name)} · ${TAB_NAMES[k]}</button>`).join('')).join('')}</div>` : ''}
  <label>Link tài liệu (tuỳ chọn)</label><input id="j_link" value="${esc(x.link || '')}" placeholder="https://… (GDD, sheet, board)">
  <label>Việc cần làm</label><div class="tlist" id="j_tasks">${tHtml()}</div>
  <div class="row" style="margin-top:6px"><input id="j_newt" placeholder="Thêm việc rồi Enter"><button id="j_addt">Thêm</button></div>
  <label>Ghi chú</label><textarea id="j_note" rows="3">${esc(x.note || '')}</textarea>
  <div class="row" style="margin-top:16px">${x.id ? '<button class="err" id="j_del">Xoá dự án</button>' : ''}${x.link ? '<button class="ghost" id="j_open">Mở link ↗</button>' : ''}<span class="grow"></span><button id="j_cancel">Huỷ</button><button class="pri" id="j_save">Lưu</button></div>`);
  const redrawTasks = () => { $('j_tasks').innerHTML = tHtml(); };
  $('j_tasks').addEventListener('change', (e) => { const i = e.target.dataset.i; if (i != null) { tasks[i].done = e.target.checked; redrawTasks(); } });
  $('j_tasks').addEventListener('click', (e) => { const i = e.target.dataset.del; if (i != null) { tasks.splice(+i, 1); redrawTasks(); } });
  const addT = () => { const v = $('j_newt').value.trim(); if (!v) return; tasks.push({ text: v, done: false }); $('j_newt').value = ''; redrawTasks(); $('j_newt').focus(); };
  $('j_addt').onclick = addT; $('j_newt').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addT(); } };
  $('j_prog').oninput = () => { $('j_pv').textContent = $('j_prog').value + '%'; };
  document.querySelectorAll('#modalBox [data-go]').forEach((b) => { b.onclick = () => { const [pid, k] = b.dataset.go.split('|'); closeModal(); cur.profileId = pid; selectTab(k); }; });
  if ($('j_open')) $('j_open').onclick = () => mt.call('app:openExternal', { url: x.link });
  $('j_cancel').onclick = closeModal;
  $('j_save').onclick = async () => {
    await call('proj:save', { id: x.id, name: $('j_name').value, status: segVal('j_status'), due: $('j_due').value, owner: $('j_owner').value, progress: +$('j_prog').value,
      profileIds: [...document.querySelectorAll('.j_prof:checked')].map((c) => c.value), link: $('j_link').value, note: $('j_note').value, tasks });
    closeModal(); await refresh(); toast('Đã lưu dự án');
  };
  if (x.id) $('j_del').onclick = async () => { if (!confirm(`Xoá dự án "${x.name}"?`)) return; await call('proj:delete', { id: x.id }); closeModal(); await refresh(); };
}

// ------------------------------------------------------------------ events from main
mt.on('ui:select', (id) => { cur.profileId = id; if (panel !== 'git') panel = 'web'; refresh(); });
mt.on('ui:tab', (t) => { cur.tab = t; panel = t === 'git' ? 'git' : 'web'; render(); });
mt.on('ui:badges', (b) => { if (!S) return; S.badges = b.badges || {}; S.news = b.news; render(); });
// bảng hồ sơ mở: main gửi ảnh chụp trang web để hiện đúng chỗ cũ (web view tạm gỡ ra cho bảng đè lên, trang không bị co giãn)
mt.on('ui:freeze', (f) => {
  const im = $('frozen');
  if (!f) { im.classList.add('hidden'); im.removeAttribute('src'); return; }
  const b = f.bounds; Object.assign(im.style, { left: b.x + 'px', top: b.y + 'px', width: b.width + 'px', height: b.height + 'px' });
  im.src = f.src; im.classList.remove('hidden');
});
mt.on('ui:event', () => { if (panel === 'feed') renderFeed(); });
mt.on('ui:viewState', (v) => { if (v.profileId === cur.profileId) $('webHint').textContent = 'Đang tải…'; });
mt.on('git:task', (t) => { logId = t.id; const st = $('g_state'); if (st) { st.className = 'badge'; st.textContent = 'đang chạy…'; } });
mt.on('git:line', addLine);
mt.on('ui:translate', showTranslate);
mt.on('ui:update', (u) => {
  if (!S) return;
  const was = S.update && S.update.state; S.update = u;
  if (u.open) { panel = 'settings'; render(); return; }
  if (u.state === 'downloading' && was === 'downloading' && $('u_bar')) {   // progress only: no full re-render
    const pct = u.total ? Math.min(100, Math.round((u.got / u.total) * 100)) : 0;
    $('u_bar').style.width = pct + '%'; $('u_pct').textContent = `${pct}% · ${fmtMB(u.got)}${u.total ? ' / ' + fmtMB(u.total) : ''}`;
    return;
  }
  if (panel === 'settings') renderUpdate();
  updDot();
});
mt.on('git:done', async (d) => {
  if (panel === 'git') await renderGit();
  if (d.kind === 'prepare' && d.ok && d.prepared) showConfirm(d.prepared);
  if (d.kind === 'push' && d.ok) toast('Đã đẩy lên repo đích ✓');
  if (!d.ok) toast('Việc Git bị lỗi, xem Nhật ký', true);
});

// ------------------------------------------------------------------ wiring
$('profs').addEventListener('click', (e) => { const b = e.target.closest('.bub'); if (b) selectProfile(b.dataset.id); });
$('profs').addEventListener('keydown', (e) => {
  const b = e.target.closest('.bub'); if (!b) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProfile(b.dataset.id, true); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? b.nextElementSibling : b.previousElementSibling; if (n) n.focus(); }
});
// vertical tab list: arrows / Home / End move between tabs (roving tabindex), like a native tab list
$('tabs').addEventListener('keydown', (e) => {
  const list = [...document.querySelectorAll('#tabs button')]; const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  const t = list[(j + list.length) % list.length]; selectTab(t.dataset.tab, true); t.focus();
});
$('profs').addEventListener('contextmenu', (e) => { const b = e.target.closest('.bub'); if (b) { e.preventDefault(); profileForm(prof(b.dataset.id)); } });
$('addProf').onclick = () => profileForm(null);
$('emptyAdd').onclick = () => profileForm(null);
$('editProf').onclick = () => profileForm(prof(cur.profileId));
$('feedBtn').onclick = () => { panel = 'feed'; render(); };
$('projBtn').onclick = () => { closeFly(true); panel = 'projects'; render(); };
// bảng hồ sơ: di chuột vào nút Hồ sơ thì mở, rời cả nút lẫn bảng 0,3 s thì đóng; bấm nút để mở/đóng (bàn phím, màn cảm ứng)
$('profBtn').addEventListener('mouseenter', () => openFly());
$('profBtn').addEventListener('mouseleave', () => closeFly());
$('profFly').addEventListener('mouseenter', () => clearTimeout(flyTimer));
$('profFly').addEventListener('mouseleave', () => closeFly());
$('profBtn').onclick = () => { if ($('profFly').classList.contains('hidden')) { openFly(); const f = document.querySelector('#profs .bub.on') || document.querySelector('#profs .bub'); if (f) f.focus(); } else closeFly(true); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('profFly').classList.contains('hidden')) { closeFly(true); $('profBtn').focus(); }
  // Ctrl/Cmd + 1…9: chuyển nhanh sang hồ sơ thứ n
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && S) { const p = S.profiles[+e.key - 1]; if (p) { e.preventDefault(); selectProfile(p.id, true); } }
});
$('setBtn').onclick = () => { panel = 'settings'; render(); };
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => selectTab(b.dataset.tab); });
document.querySelectorAll('#navs button').forEach((b) => { b.onclick = () => mt.call('app:nav', { profileId: cur.profileId, kind: cur.tab, action: b.dataset.nav }); });
$('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });
refresh();
