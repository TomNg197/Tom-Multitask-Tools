'use strict';
/* global mt */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#7c4dff', '#e91e63', '#ff7043', '#f9a825', '#43a047', '#00897b', '#1e88e5', '#5e35b1', '#6d4c41', '#546e7a'];
let S = null;            // app state
let GS = null;           // git state
let cur = { profileId: null, tab: 'slack' };
let panel = 'web';       // web | git | feed | settings | empty
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

// ------------------------------------------------------------------ main state + layout
async function refresh() {
  S = await call('app:state');
  if (!cur.profileId && S.profiles[0]) cur.profileId = S.profiles[0].id;
  if (cur.profileId && !prof(cur.profileId)) cur.profileId = S.profiles[0] ? S.profiles[0].id : null;
  render();
}

function badgeOf(pid) {
  const u = S.unread[pid]; const n = Math.max(typeof u === 'number' ? u : 0, S.news[pid] || 0);
  if (n) return `<span class="cnt">${n > 99 ? '99+' : n}</span>`;
  if (u === '•') return '<span class="cnt dot">•</span>';
  return '';
}

function render() {
  $('profs').innerHTML = S.profiles.map((p) => `<div class="bub ${p.id === cur.profileId && panel !== 'feed' && panel !== 'settings' ? 'on' : ''}" data-id="${p.id}" style="background:${esc(p.color)}" title="${esc(p.name)}">${esc(initials(p.name))}${badgeOf(p.id)}</div>`).join('');
  const totalNew = Object.values(S.news).reduce((a, b) => a + b, 0);
  $('feedCnt').textContent = totalNew; $('feedCnt').classList.toggle('hidden', !totalNew);
  const p = prof(cur.profileId);
  if (!p && panel !== 'settings' && panel !== 'feed') panel = 'empty';
  else if (p && panel === 'empty') panel = cur.tab === 'git' ? 'git' : 'web';
  $('pname').textContent = panel === 'feed' ? 'Tin mới' : panel === 'settings' ? 'Cài đặt' : (p ? p.name : 'MetaTools');
  const showTabs = p && (panel === 'web' || panel === 'git');
  $('tabs').classList.toggle('hidden', !showTabs); $('editProf').classList.toggle('hidden', !showTabs);
  $('navs').classList.toggle('hidden', panel !== 'web');
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur.tab));
  for (const [id, k] of [['pWeb', 'web'], ['pGit', 'git'], ['pFeed', 'feed'], ['pSet', 'settings'], ['pEmpty', 'empty']]) $(id).classList.toggle('hidden', panel !== k);
  if (panel === 'git') renderGit();
  if (panel === 'feed') renderFeed();
  if (panel === 'settings') renderSettings();
  syncMain();
}

let markNext = false;
function syncMain() {
  const overlay = !$('modal').classList.contains('hidden') || panel !== 'web';
  mt.call('app:show', { profileId: cur.profileId, tab: panel === 'web' ? cur.tab : 'none', overlay, markRead: markNext });
  markNext = false;
}

function selectProfile(id) { cur.profileId = id; panel = cur.tab === 'git' ? 'git' : 'web'; markNext = true; render(); }
function selectTab(tab) { cur.tab = tab; panel = tab === 'git' ? 'git' : 'web'; markNext = true; render(); }

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
function profileForm(p) {
  p = p || { color: COLORS[(S.profiles.length) % COLORS.length], notify: true };
  openModal(`<h3>${p.id ? 'Sửa hồ sơ' : 'Hồ sơ mới'}</h3>
  <div class="mute small">Mỗi hồ sơ có phiên đăng nhập Slack, Google và Trello riêng, không lẫn với hồ sơ khác.</div>
  <label>Tên hồ sơ</label><input id="f_name" value="${esc(p.name || '')}" placeholder="Công ty / Khách A / Cá nhân">
  <label>Workspace Slack</label><input id="f_slack" value="${esc(p.slackUrl || '')}" placeholder="https://tencongty.slack.com (để trống = chọn khi đăng nhập)">
  <label>Gmail đi kèm (mở Drive/Docs đúng tài khoản)</label><input id="f_gmail" value="${esc(p.gmail || '')}" placeholder="ten@congty.com">
  <label>Trello (tuỳ chọn: link bảng hoặc workspace mở sẵn)</label><input id="f_trello" value="${esc(p.trelloUrl || '')}" placeholder="https://trello.com/w/tencongty (để trống = trang chủ Trello)">
  <label>Màu</label>${colorPicker('f_color', p.color)}
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="f_notify" style="width:auto" ${p.notify !== false ? 'checked' : ''}> Báo tin mới (chạy ngầm cả khi đóng cửa sổ)</label>
  <div class="row" style="margin-top:16px">${p.id ? '<button class="err" id="f_del">Xoá hồ sơ</button>' : ''}<span class="grow"></span><button id="f_cancel">Huỷ</button><button class="pri" id="f_save">Lưu</button></div>`);
  $('f_cancel').onclick = closeModal;
  $('f_save').onclick = async () => {
    const r = await call('prof:save', { id: p.id, name: $('f_name').value, slackUrl: $('f_slack').value, gmail: $('f_gmail').value, trelloUrl: $('f_trello').value, color: pickedColor('f_color'), notify: $('f_notify').checked });
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
  ${evs.length ? evs.map((e) => { const p = prof(e.p); return `<div class="ev ${e.read ? '' : 'new'}" data-ev="${e.id}"><div class="who" style="color:${esc(p ? p.color : '#888')}">${esc(p ? p.name : '?')}</div><div class="msg"><div><b>${esc(e.t || '(không tiêu đề)')}</b></div><div class="b">${esc(e.b)}</div></div><div class="tm">${new Date(e.at).toLocaleTimeString()}</div></div>`; }).join('') : '<div class="mute" style="padding:20px;text-align:center">Chưa có tin. Tin nhắn riêng, nhắc tên, tin mới của các hồ sơ sẽ hiện ở đây.</div>'}</div>`;
  $('fd_read').onclick = async () => { await call('feed:readAll'); await refresh(); };
  $('fd_clear').onclick = async () => { await call('feed:clear'); await refresh(); };
  document.querySelectorAll('[data-ev]').forEach((el) => { el.onclick = async () => { await call('feed:open', { id: +el.dataset.ev }); }; });
}

// ------------------------------------------------------------------ settings
function renderSettings() {
  $('pSet').innerHTML = `<div class="card"><h2>Cài đặt</h2>
  <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="s_login" style="width:auto" ${S.settings.openAtLogin ? 'checked' : ''}> Tự chạy ngầm khi mở máy (để không lỡ tin)</label>
  <div class="row" style="margin-top:14px"><button id="s_export">Xuất danh sách hồ sơ</button><button id="s_import">Nhập danh sách hồ sơ</button></div>
  <div class="mute small" style="margin-top:6px">Dùng để chuyển sang máy Mac/Windows khác. File chỉ có tên, workspace, Gmail, nick và cặp Git; <b>không có</b> token, SSH key hay phiên đăng nhập (mỗi máy đăng nhập/nhập token lại 1 lần).</div>
  <div class="row" style="margin-top:18px"><button class="err" id="s_quit">Thoát hẳn MetaTools</button><span class="mute small">Đóng cửa sổ thì app vẫn chạy ở khay để nhận tin.</span></div>
  <div class="mute small" style="margin-top:14px">MetaTools ${esc(S.version)} · ${esc(S.platform)}</div></div>`;
  $('s_login').onchange = async (e) => { await call('app:setLogin', { on: e.target.checked }); await refresh(); };
  $('s_export').onclick = async () => { const f = await call('app:export'); if (f) toast('Đã lưu ' + f); };
  $('s_import').onclick = async () => { const r = await call('app:import'); if (r) { toast(`Đã nhập: thêm ${r.added}, cập nhật ${r.updated}`); await refresh(); } };
  $('s_quit').onclick = () => call('app:quit');
}

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
    <div class="card"><h2>Cặp pull → push <span class="grow"></span><button class="pri sm" id="g_addPair" ${GS.accounts.length < 2 ? 'disabled title="Cần ít nhất 2 nick"' : ''}>+ Thêm cặp</button></h2>
    ${pairs.length ? pairs.map((p) => { const l = p.last || {}; const pr = GS.prepared[p.id]; return `<div class="pair"><div class="row"><span class="chip" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b><span class="grow"></span>
      <button class="sm" data-pull="${p.id}" ${busy ? 'disabled' : ''}>Pull</button><button class="sm pri" data-prep="${p.id}" ${busy ? 'disabled' : ''}>Pull + Push</button>${pr && !pr.noChange ? `<button class="sm ok" data-review="${p.id}">Xem & đẩy</button>` : ''}<button class="sm" data-editpair="${p.id}">Sửa</button></div>
      <div class="flow"><div class="side"><div>${accLabel(p.srcAcc)}</div><div class="mono">${esc(p.srcUrl)}</div></div><div class="arrow">➜</div><div class="side"><div>${accLabel(p.dstAcc)}</div><div class="mono">${esc(p.dstUrl)}</div></div></div>
      <div class="small mute">${branchDesc(p)} · commit "${esc(p.message)}"</div>
      <div class="small mute">${l.sha ? `Pull gần nhất: <b>${esc(l.branch)}</b> @ ${esc(l.sha.slice(0, 8))} (${new Date(l.pulledAt).toLocaleString()})` : 'Chưa pull lần nào.'}${l.pushedAt ? ` · Đẩy gần nhất ${new Date(l.pushedAt).toLocaleString()}${l.pushedSha && l.sha && l.pushedSha !== l.sha ? ' · <b style="color:var(--warn)">nguồn có code mới chưa đẩy</b>' : ''}` : ''}</div></div>`; }).join('') : '<div class="mute">Chưa có cặp. Một cặp = nick nguồn pull về → nick đích đẩy lên thành 1 commit (không mang lịch sử, tên, email cá nhân).</div>'}</div>
  </div></div>`;
  $('g_addAcc').onclick = () => accountForm(null);
  $('g_addPair').onclick = () => pairForm(null);
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
  p = p || { srcMode: 'newest', dstMode: 'same', message: 'Sync {branch} @ {sha}', color: COLORS[5], profileId: cur.profileId };
  const opts = (sel) => GS.accounts.map((a) => { const pr = prof(a.profileId); return `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.label)} (${esc(a.host)} / ${esc(a.user)})${pr && pr.id !== cur.profileId ? ' · ' + esc(pr.name) : ''}</option>`; }).join('');
  openModal(`<h3>${p.id ? 'Sửa cặp' : 'Cặp mới'}</h3>
  <label>Tên cặp</label><input id="p_name" value="${esc(p.name || '')}" placeholder="Game A → repo công ty">
  <label>Trello (tuỳ chọn: link bảng hoặc workspace mở sẵn)</label><input id="f_trello" value="${esc(p.trelloUrl || '')}" placeholder="https://trello.com/w/tencongty (để trống = trang chủ Trello)">
  <label>Màu</label>${colorPicker('p_color', p.color)}
  <div class="card" style="margin-top:12px"><h2>Nguồn (pull về)</h2>
    <label>Nick nguồn</label><select id="p_srcAcc"><option value="">— chọn —</option>${opts(p.srcAcc)}</select>
    <label>Repo nguồn</label><input id="p_srcUrl" value="${esc(p.srcUrl || '')}" placeholder="https://github.com/ten/repo hoặc git@github.com:ten/repo.git">
    <label>Lấy nhánh nào</label>${seg('p_srcMode', [['newest', 'Mới nhất (tự động)'], ['fixed', 'Cố định'], ['pattern', 'Mới nhất theo mẫu']], p.srcMode)}
    <input id="p_srcBranch" value="${esc(p.srcBranch || '')}" placeholder="main  hoặc  release/*" style="margin-top:6px"></div>
  <div class="card"><h2>Đích (push lên)</h2>
    <label>Nick đích</label><select id="p_dstAcc"><option value="">— chọn —</option>${opts(p.dstAcc)}</select>
    <label>Repo đích</label><input id="p_dstUrl" value="${esc(p.dstUrl || '')}" placeholder="https://gitlab.congty.vn/team/repo">
    <label>Đẩy vào nhánh</label>${seg('p_dstMode', [['same', 'Trùng tên nhánh nguồn'], ['fixed', 'Nhánh cố định'], ['prefix', 'Thêm tiền tố']], p.dstMode)}
    <input id="p_dstBranch" value="${esc(p.dstBranch || '')}" placeholder="main  hoặc tiền tố  sync/" style="margin-top:6px">
    <label>Nội dung commit</label><input id="p_msg" value="${esc(p.message || '')}"><div class="mute small">Biến: {branch} = nhánh nguồn, {sha} = mã commit nguồn, {date} = ngày commit nguồn.</div></div>
  <div class="row" style="margin-top:12px">${p.id ? '<button class="err" id="p_del">Xoá cặp</button>' : ''}<span class="grow"></span><button id="p_cancel">Huỷ</button><button class="pri" id="p_save">Lưu</button></div>`);
  const upd = () => { $('p_srcBranch').classList.toggle('hidden', segVal('p_srcMode') === 'newest'); $('p_dstBranch').classList.toggle('hidden', segVal('p_dstMode') === 'same'); };
  $('p_srcMode').addEventListener('change', upd); $('p_dstMode').addEventListener('change', upd); upd();
  $('p_cancel').onclick = closeModal;
  $('p_save').onclick = async () => {
    await call('git:savePair', { id: p.id, profileId: p.profileId || cur.profileId, name: $('p_name').value, color: pickedColor('p_color'), srcAcc: $('p_srcAcc').value, srcUrl: $('p_srcUrl').value, srcMode: segVal('p_srcMode'), srcBranch: $('p_srcBranch').value, dstAcc: $('p_dstAcc').value, dstUrl: $('p_dstUrl').value, dstMode: segVal('p_dstMode'), dstBranch: $('p_dstBranch').value, message: $('p_msg').value });
    closeModal(); toast('Đã lưu cặp'); renderGit();
  };
  if (p.id) $('p_del').onclick = async () => { if (!confirm(`Xoá cặp "${p.name}"?`)) return; await call('git:deletePair', { id: p.id }); closeModal(); renderGit(); };
}

function showConfirm(pr) {
  if (!pr) return;
  openModal(`<h3>Xác nhận đẩy lên repo đích</h3>
  ${pr.noChange ? '<div class="warnbox">Repo đích đã giống hệt code nguồn, không có gì để đẩy.</div>' : ''}
  <div class="kv"><div>Nick đích</div><div><b>${esc(pr.dstUser)}</b> · ${esc(pr.dstHost)} ✓ đã kiểm tra</div>
  <div>Repo đích</div><div class="mono">${esc(pr.dstUrl)}</div><div>Nhánh đích</div><div><b>${esc(pr.dstBranch)}</b>${pr.newBranch ? ' (nhánh mới)' : ''}</div>
  <div>Code lấy từ</div><div>nhánh <b>${esc(pr.srcBranch)}</b> @ ${esc(pr.sha.slice(0, 8))} (${esc(String(pr.srcDate).slice(0, 16))})</div>
  <div>Commit sẽ tạo</div><div>"${esc(pr.message)}", đứng tên <b>${esc(pr.dstUser)} &lt;${esc(pr.dstEmail)}&gt;</b></div>
  <div>Thay đổi</div><div><b>${esc(pr.stat || '—')}</b> (${pr.fileCount} file)</div></div>
  ${pr.lfs ? '<div class="warnbox">Repo nguồn dùng Git LFS: chỉ chép file con trỏ LFS, file lớn sẽ không có trên repo đích.</div>' : ''}
  <div class="mute small">Không mang lịch sử commit, tên hay email cá nhân sang. Toàn bộ file trên nhánh đích được thay bằng code nguồn. Không bao giờ ghi đè (force push).</div>
  ${pr.files && pr.files.length ? `<div class="files mono">${pr.files.map(esc).join('<br>')}${pr.fileCount > pr.files.length ? '<br>…' : ''}</div>` : ''}
  <div class="row" style="margin-top:14px"><span class="grow"></span><button id="c_cancel">Huỷ</button>${pr.noChange ? '' : '<button class="ok" id="c_push">Đẩy lên</button>'}</div>`);
  $('c_cancel').onclick = async () => { closeModal(); await call('git:cancel', { pairId: pr.pairId }); renderGit(); };
  if (!pr.noChange) $('c_push').onclick = async () => { closeModal(); await call('git:push', { pairId: pr.pairId }); renderGit(); };
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

// ------------------------------------------------------------------ events from main
mt.on('ui:select', (id) => { cur.profileId = id; if (panel !== 'git') panel = 'web'; refresh(); });
mt.on('ui:tab', (t) => { cur.tab = t; panel = t === 'git' ? 'git' : 'web'; render(); });
mt.on('ui:badges', (b) => { if (!S) return; S.unread = b.unread; S.news = b.news; render(); });
mt.on('ui:event', () => { if (panel === 'feed') renderFeed(); });
mt.on('ui:viewState', (v) => { if (v.profileId === cur.profileId) $('webHint').textContent = 'Đang tải…'; });
mt.on('git:task', (t) => { logId = t.id; const st = $('g_state'); if (st) { st.className = 'badge'; st.textContent = 'đang chạy…'; } });
mt.on('git:line', addLine);
mt.on('ui:translate', showTranslate);
mt.on('git:done', async (d) => {
  if (panel === 'git') await renderGit();
  if (d.kind === 'prepare' && d.ok && d.prepared) showConfirm(d.prepared);
  if (d.kind === 'push' && d.ok) toast('Đã đẩy lên repo đích ✓');
  if (!d.ok) toast('Việc Git bị lỗi, xem Nhật ký', true);
});

// ------------------------------------------------------------------ wiring
$('profs').addEventListener('click', (e) => { const b = e.target.closest('.bub'); if (b) selectProfile(b.dataset.id); });
$('profs').addEventListener('contextmenu', (e) => { const b = e.target.closest('.bub'); if (b) { e.preventDefault(); profileForm(prof(b.dataset.id)); } });
$('addProf').onclick = () => profileForm(null);
$('emptyAdd').onclick = () => profileForm(null);
$('editProf').onclick = () => profileForm(prof(cur.profileId));
$('feedBtn').onclick = () => { panel = 'feed'; render(); };
$('setBtn').onclick = () => { panel = 'settings'; render(); };
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => selectTab(b.dataset.tab); });
document.querySelectorAll('#navs button').forEach((b) => { b.onclick = () => mt.call('app:nav', { profileId: cur.profileId, kind: cur.tab, action: b.dataset.nav }); });
$('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });
refresh();
