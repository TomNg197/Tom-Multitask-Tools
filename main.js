'use strict';
// MetaTools 2 — one desktop app (macOS / Windows): many Slack accounts, each with its own Google (Drive/Gmail) tab and
// git accounts + pairs (pull newest branch -> push one snapshot commit, no personal history). No browser needed.
const { app, BrowserWindow, WebContentsView, ipcMain, Tray, Menu, Notification, nativeImage, nativeTheme, shell, session, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./lib/store');
const G = require('./lib/git');
const { translate } = require('./lib/translate');
const U = require('./lib/updater');
const PS = require('./lib/projsync');

const SIDEBAR = 76;        // profile column
const TABCOL = 64;        // vertical tab column of the selected profile (always shown next to a web view)
const TOPBAR = 52;
const IS_MAC = process.platform === 'darwin';
// 2.5.0: tên hiển thị đổi thành "Tom Multitask"; productName trong package.json vẫn là MetaTools để thư mục dữ liệu
// (hồ sơ, phiên đăng nhập, khoá mã hoá, bản cập nhật) giữ nguyên chỗ cũ trên máy đã cài
const APP_NAME = 'Tom Multitask';
const START_HIDDEN = process.argv.includes('--hidden');

// bootstrap.js (packaged entry) already took the single-instance lock and chose bundled code vs a downloaded payload
const BOOT = global.__mtBoot || { shellVersion: app.getVersion(), version: app.getVersion(), payload: null, trial: false, markGood: () => false };
if (process.env.METATOOLS_USERDATA) app.setPath('userData', process.env.METATOOLS_USERDATA);   // tests / portable use
if (!global.__mtBoot && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let tray = null;
let store = null;
let quitting = false;
let flushed = false;
const views = {};          // profileId -> { slack, google, trello, discord, web: WebContentsView }
const unread = {};         // 2.7.0: profileId -> { slack, google, trello, discord: number | '•' } (đọc từ tiêu đề trang / feed Gmail)
const events = [];         // notification feed: { id, p: profileId, k: kind, t, b, at, read }
let evSeq = 0;
let current = { profileId: null, tab: 'slack', overlay: false, peek: 0 };   // peek: bảng hồ sơ đang trượt ra → web view tạm thay bằng ảnh chụp
const gitStatus = {};      // accId -> {ok, who, expires, msg, at}
const prepared = {};       // pairId -> prepare result
let task = null;           // { id, title, lines: [], done, ok }
const logHistory = [];     // last lines of every git task (shown again when the Git tab re-renders)
function pushLog(line) { logHistory.push(line); if (logHistory.length > 600) logHistory.splice(0, logHistory.length - 600); sendUI('git:line', line); }

// Chrome user agent without the Electron / app tokens (Slack treats Electron UA as an unsupported browser)
function cleanUA(ua) {
  return ua.replace(/\sElectron\/\S+/, '').replace(/\sMetaTools\/\S+/i, '').replace(/\smetatools\/\S+/i, '');
}

function iconPath(name) { return path.join(__dirname, 'assets', name); }

// ------------------------------------------------------------------ window + layout
// Translucent side columns (macOS 26 / Windows 11 look): vibrancy on macOS, Mica on Windows 11 22H2+ (build 22621),
// solid colours elsewhere. The UI gets the choice as ?mat=... and only makes its columns see-through when it is real.
function material() {
  if (process.env.METATOOLS_MATERIAL) return process.env.METATOOLS_MATERIAL;   // tests
  if (IS_MAC) return 'vibrancy';
  if (process.platform === 'win32' && Number(require('os').release().split('.')[2] || 0) >= 22621) return 'mica';
  return 'none';
}

function createWindow() {
  const mat = material();
  const glass = mat === 'vibrancy' || mat === 'mica';
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 600, show: false, title: APP_NAME,
    backgroundColor: glass ? '#00000000' : (nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7'), icon: iconPath('icon.png'),
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 20 } } : {}),
    ...(mat === 'vibrancy' ? { vibrancy: 'sidebar', visualEffectState: 'followWindow' } : {}),
    ...(mat === 'mica' ? { backgroundMaterial: 'mica' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { mat, os: process.platform } });
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
  // a freshly updated payload counts as good once the window is up and nothing crashed for a few seconds
  win.webContents.once('did-finish-load', () => setTimeout(confirmStart, Number(process.env.METATOOLS_UPDATE_GOOD_MS) || 10000));
  win.on('resize', layout);
  win.on('focus', () => sendUI('ui:focus', true));
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!store.cfg.settings.trayHintShown) {
      store.cfg.settings.trayHintShown = true; store.save();
      notify(`${APP_NAME} vẫn đang chạy`, 'App chạy ngầm ở khay hệ thống để nhận tin Slack. Thoát hẳn: chuột phải biểu tượng → Thoát.');
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function showWindow(profileId) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (profileId) sendUI('ui:select', profileId);
}

function sendUI(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function contentBounds() {
  const [w, h] = win.getContentSize();
  const left = SIDEBAR + TABCOL;
  return { x: left, y: TOPBAR, width: Math.max(100, w - left), height: Math.max(100, h - TOPBAR) };
}

// Attach only the visible web view. Idempotent on purpose: the UI calls this on every render (badge counts change
// whenever Slack's title does), and detaching + re-attaching the view that is already shown takes the keyboard focus
// away from it. That broke typing mid-word, which UniKey on Windows shows first: its Backspace + new letters landed
// outside the Slack box (v2.4 fix, test/selftest-ime.js).
function layout(focusView) {
  if (!win) return;
  const cv = win.contentView;
  const p = profile(current.profileId);
  const want = p && !current.overlay && !current.peek && WEB_KINDS.includes(current.tab) ? ensureView(p, current.tab) : null;
  for (const pid of Object.keys(views)) {
    for (const k of WEB_KINDS) {
      const v = views[pid][k];
      if (v && v !== want && cv.children.includes(v)) cv.removeChildView(v);
    }
  }
  if (!want) return;
  seen(p.id, current.tab);
  if (!cv.children.includes(want)) cv.addChildView(want);
  want.setBounds(contentBounds());
  if (focusView) want.webContents.focus();   // the user picked this profile / tab: typing goes straight there
}

let peekSeq = 0;
function shownView() {
  const cv = win && win.contentView; if (!cv) return null;
  for (const pid of Object.keys(views)) for (const k of WEB_KINDS) { const v = views[pid][k]; if (v && cv.children.includes(v)) return v; }
  return null;
}

// ------------------------------------------------------------------ profiles + web views
function profile(id) { return store.cfg.profiles.find((p) => p.id === id); }
function partitionOf(p) { return `persist:p-${p.id}`; }

const WEB_KINDS = ['slack', 'google', 'trello', 'discord', 'web'];
// ứng dụng có thông báo + số tin chưa đọc riêng (2.7.0); 'web' = tab mở mọi link khác ngay trong app, không báo tin
const NOTIFY_KINDS = ['slack', 'google', 'trello', 'discord'];
const KIND_LABEL = { slack: 'Slack', google: 'Gmail', trello: 'Trello', discord: 'Discord', web: 'Web' };
const TRELLO_RE = /^https:\/\/([a-z0-9-]+\.)*(trello\.com|trellocdn\.com)\//i;
const DISCORD_RE = /^https:\/\/([a-z0-9-]+\.)*(discord\.com|discordapp\.com|discord\.gg|discordapp\.net|discord\.media)\//i;
const LOGIN_RE = /^https:\/\/(accounts\.google\.com|id\.atlassian\.com|appleid\.apple\.com|login\.microsoftonline\.com)\//i;
const GOOGLE_RE = /^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com|gstatic\.com|forms\.gle|goo\.gl)\//i;
const SLACK_RE = /^https:\/\/([a-z0-9-]+\.)*(slack\.com|slack-edge\.com|slack-files\.com|slack-redir\.net)\//i;

function trelloHome(p) { return p.trelloUrl || 'https://trello.com/'; }
function discordHome(p) { return p.discordUrl || 'https://discord.com/app'; }
function homeOf(p, kind) { return kind === 'slack' ? (p.slackUrl || 'https://app.slack.com/client') : kind === 'trello' ? trelloHome(p) : kind === 'discord' ? discordHome(p) : kind === 'web' ? 'about:blank' : googleHome(p); }
// bật báo tin hệ điều hành cho từng app của hồ sơ; chưa chỉnh lần nào: Slack bật, app khác bật khi hồ sơ đã điền link/Gmail của app đó
function notifyOn(p, kind) {
  if (!p || p.notify === false || !NOTIFY_KINDS.includes(kind)) return false;
  const a = p.notifyApps || {};
  if (typeof a[kind] === 'boolean') return a[kind];
  // 2.7.1: Trello/Discord chạy ngầm tốn 150–300 MB mỗi cái → mặc định tắt, chỉ chạy ngầm khi sếp tick. Gmail đọc feed, gần như không tốn RAM.
  return kind === 'slack' || (kind === 'google' && !!p.gmail);
}

function googleHome(p) {
  return p.gmail ? `https://drive.google.com/drive/my-drive?authuser=${encodeURIComponent(p.gmail)}` : 'https://drive.google.com/drive/my-drive';
}

// make Google pick this profile's company account even if several Google accounts are signed in here
function withAuthUser(url, p) {
  if (!p.gmail) return url;
  try {
    const u = new URL(url);
    if (/(^|\.)(docs|drive|mail|sheets|slides)\.google\.com$/i.test(u.hostname) && !u.searchParams.has('authuser')) u.searchParams.set('authuser', p.gmail);
    return u.toString();
  } catch (_) { return url; }
}

function setupSession(p) {
  const ses = session.fromPartition(partitionOf(p));
  if (ses.__mtReady) return ses;
  ses.__mtReady = true;
  ses.setUserAgent(cleanUA(ses.getUserAgent()));
  const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture', 'speaker-selection']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm));
  try { ses.setSpellCheckerLanguages(['en-US', 'vi']); } catch (_) { try { ses.setSpellCheckerLanguages(['en-US']); } catch (__) { /* no dictionaries */ } }
  return ses;
}

function ensureView(p, kind) {
  views[p.id] = views[p.id] || {};
  if (views[p.id][kind]) return views[p.id][kind];
  setupSession(p);
  const v = new WebContentsView({
    webPreferences: {
      partition: partitionOf(p), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: !(kind === 'slack' || kind === 'discord' || (kind === 'trello' && notifyOn(p, 'trello'))),   // app báo tin vẫn nhận khi ẩn / nằm khay
      preload: NOTIFY_KINDS.includes(kind) ? path.join(__dirname, 'preload-web.js') : undefined,
    },
  });
  const wc = v.webContents;
  wc.__mtProfile = p.id;
  wc.__mtKind = kind;
  wc.setWindowOpenHandler(({ url }) => routeLink(p, url, kind));
  wc.on('page-title-updated', (e, title) => {
    if (kind === 'slack' || kind === 'discord') setUnread(p.id, kind, parseUnread(title));
    else if (kind === 'google' && /^https:\/\/mail\.google\.com\//.test(wc.getURL())) setUnread(p.id, 'google', parseGmailTitle(title));   // tab đang ở Drive thì giữ số của feed Gmail
  });
  wc.on('did-finish-load', () => sendUI('ui:viewState', { profileId: p.id, kind, url: wc.getURL(), title: wc.getTitle() }));
  wc.on('did-navigate', () => sendUI('ui:viewState', { profileId: p.id, kind, url: wc.getURL(), title: wc.getTitle() }));
  wc.on('context-menu', (e, params) => contextMenu(p, wc, params));
  wc.on('before-input-event', (e, input) => {
    // Ctrl/Cmd + Shift + E: translate the selected text to English
    if (input.type === 'keyDown' && input.shift && (input.control || input.meta) && String(input.key).toLowerCase() === 'e') {
      e.preventDefault();
      wc.executeJavaScript(`(() => { const a = document.activeElement; let s = String(getSelection());
        if (!s && a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) s = a.value.slice(a.selectionStart, a.selectionEnd);
        return { s, ed: !!(a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) }; })()`, true)
        .then((r) => { if (r && r.s && r.s.trim()) doTranslate(p, wc, r.s, 'en', r.ed); }).catch(() => {});
    }
  });
  const back = slept[p.id] && slept[p.id][kind];
  if (back) delete slept[p.id][kind];
  wc.loadURL(back || homeOf(p, kind));
  views[p.id][kind] = v;
  seen(p.id, kind);
  return v;
}

// ------------------------------------------------------------------ ngủ app không dùng (2.7.1)
// Mỗi app web là một trình duyệt riêng (150–300 MB). App nào không hiện trên màn hình quá N phút, không bật báo tin và không
// đang phát tiếng (gọi thoại/huddle) thì đóng hẳn; bấm vào lại thì mở lại đúng trang cũ. N = Cài đặt → "Ngủ app" (0 = tắt).
const lastSeen = {};   // profileId -> { kind: ms }
const slept = {};      // profileId -> { kind: url lúc ngủ }
function seen(pid, kind) { (lastSeen[pid] = lastSeen[pid] || {})[kind] = Date.now(); }
function sleepMinutes() { const m = store.cfg.settings.sleepMin; return typeof m === 'number' ? m : 10; }
function sleepIdle(now = Date.now()) {
  const min = sleepMinutes(); if (!min) return [];
  const cv = win && win.contentView; const done = [];
  for (const pid of Object.keys(views)) {
    const p = profile(pid); if (!p) continue;
    for (const k of WEB_KINDS) {
      const v = views[pid][k]; if (!v) continue;
      if (cv && cv.children.includes(v)) continue;                       // đang hiện
      if (current.profileId === pid && current.tab === k) continue;      // đang chọn (vd bảng hồ sơ đang mở đè lên)
      if (k !== 'google' && notifyOn(p, k)) continue;                    // app báo tin phải chạy ngầm (Gmail báo tin bằng feed nên ngủ được)
      if (now - ((lastSeen[pid] || {})[k] || 0) < min * 60000) continue;
      const wc = v.webContents;
      if (wc.isCurrentlyAudible()) continue;                             // đang gọi / phát nhạc
      const url = wc.getURL();
      (slept[pid] = slept[pid] || {})[k] = url && url !== 'about:blank' ? url : '';
      delete views[pid][k]; wc.close();
      if (k === 'slack' || k === 'discord') { const u = unread[pid]; if (u) delete u[k]; }   // ngủ rồi thì số trên tiêu đề không còn đúng
      done.push(`${pid}:${k}`);
    }
  }
  if (done.length) refreshBadge();
  return done;
}

function popupInProfile(p) {
  return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath('icon.png'), webPreferences: { partition: partitionOf(p), sandbox: true, contextIsolation: true } } };
}

function openInTab(p, kind, url) {
  const v = ensureView(p, kind);
  v.webContents.loadURL(url);
  current = { ...current, profileId: p.id, tab: kind, overlay: false };
  sendUI('ui:select', p.id); sendUI('ui:tab', kind);
  layout();
  return { action: 'deny' };
}

function routeLink(p, url, fromKind) {
  // sign-in popups ("Continue with Google" on Trello...) must stay a popup of the same session
  if (fromKind !== 'google' && LOGIN_RE.test(url)) return popupInProfile(p);
  if (TRELLO_RE.test(url)) {
    if (fromKind === 'trello') return popupInProfile(p);
    return openInTab(p, 'trello', url);
  }
  if (DISCORD_RE.test(url)) {
    // trong Discord: cửa sổ phụ (đăng nhập, gọi video) dùng chung phiên; từ tab khác: mở vào tab Discord của hồ sơ này
    if (fromKind === 'discord') return popupInProfile(p);
    return openInTab(p, 'discord', url);
  }
  if (GOOGLE_RE.test(url)) {
    const g = ensureView(p, 'google');
    g.webContents.loadURL(withAuthUser(url, p));
    current = { ...current, profileId: p.id, tab: 'google' };
    sendUI('ui:select', p.id); sendUI('ui:tab', 'google');
    layout();
    return { action: 'deny' };
  }
  if (SLACK_RE.test(url)) {
    // huddles, file previews... open in a window that shares this profile's session
    return popupInProfile(p);
  }
  // 2.7.0: link khác (Google Form rút gọn, web bất kỳ…) mở ngay trong app, ở tab Web của hồ sơ, dùng chung phiên đăng nhập
  if (/^https?:\/\//i.test(url)) return openInTab(p, 'web', url);
  return { action: 'deny' };
}

// ------------------------------------------------------------------ right-click menu + translation
function contextMenu(p, wc, params) {
  const items = [];
  const sel = (params.selectionText || '').trim();
  if (params.misspelledWord && params.dictionarySuggestions && params.dictionarySuggestions.length) {
    params.dictionarySuggestions.slice(0, 5).forEach((s) => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    items.push({ type: 'separator' });
  }
  if (sel) {
    items.push({ label: 'Dịch sang tiếng Anh  (Ctrl/Cmd+Shift+E)', click: () => doTranslate(p, wc, sel, 'en', params.isEditable) });
    items.push({ label: 'Dịch sang tiếng Việt', click: () => doTranslate(p, wc, sel, 'vi', params.isEditable) });
    items.push({ type: 'separator' });
  }
  if (params.linkURL) {
    items.push({ label: 'Mở link bằng trình duyệt', click: () => shell.openExternal(params.linkURL) });
    items.push({ label: 'Copy link', click: () => require('electron').clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) items.push({ label: 'Cắt', role: 'cut', enabled: !!sel });
  items.push({ label: 'Copy', role: 'copy', enabled: !!sel });
  if (params.isEditable) items.push({ label: 'Dán', role: 'paste' });
  items.push({ label: 'Chọn tất cả', role: 'selectAll' });
  Menu.buildFromTemplate(items).popup({ window: win });
}

let lastTr = null;   // { wc, text, editable, profileId }
function doTranslate(p, wc, text, to, editable) {
  lastTr = { wc, text, editable: !!editable, profileId: p.id };
  sendUI('ui:translate', { state: 'loading', profileId: p.id, source: text.slice(0, 4500), to, editable: !!editable });
  translate(text, to).then((r) => {
    lastTr.result = r.text;
    sendUI('ui:translate', { state: 'done', profileId: p.id, source: r.source, text: r.text, from: r.from, to, editable: !!editable });
  }).catch((e) => sendUI('ui:translate', { state: 'error', profileId: p.id, source: text, to, error: e.message, editable: !!editable }));
}

function destroyViews(pid) {
  const vs = views[pid];
  if (!vs) return;
  for (const k of WEB_KINDS) {
    const v = vs[k];
    if (v) { if (win && win.contentView.children.includes(v)) win.contentView.removeChildView(v); v.webContents.close(); }
  }
  delete views[pid];
}

// ------------------------------------------------------------------ unread + notifications
function parseUnread(title) {
  const m = (title || '').match(/^\s*(\*|!|\((\d+)\)|\[(\d+)\])/);
  if (!m) return 0;
  const n = m[2] || m[3];
  return n ? parseInt(n, 10) : '•';
}

// Gmail: "Hộp thư đến (12) - ten@congty.com - Gmail" / "Inbox (12) - …"
function parseGmailTitle(title) { const m = (title || '').match(/\((\d+)\)/); return m ? parseInt(m[1], 10) : 0; }

function setUnread(pid, kind, val) {
  const u = unread[pid] = unread[pid] || {};
  if (u[kind] === val) return;
  u[kind] = val;
  refreshBadge();
}

function newCount(pid, kind) { return events.filter((e) => e.p === pid && !e.read && (!kind || (e.k || 'slack') === kind)).length; }

// số hiển thị của một app trong một hồ sơ: số trên tiêu đề trang, hoặc số tin mới app đã báo (lấy cái lớn hơn)
function countOf(pid, kind) {
  const u = (unread[pid] || {})[kind];
  const n = Math.max(typeof u === 'number' ? u : 0, newCount(pid, kind));
  return { n, dot: !n && u === '•' };
}
function badgeTable() {
  const out = {};
  for (const p of store.cfg.profiles) {
    const row = { total: 0, dot: false };
    for (const k of NOTIFY_KINDS) { const c = countOf(p.id, k); row[k] = c; row.total += c.n; row.dot = row.dot || c.dot; }
    out[p.id] = row;
  }
  return out;
}

function refreshBadge() {
  const table = badgeTable();
  let total = 0; let dot = false;
  for (const r of Object.values(table)) { total += r.total; dot = dot || r.dot; }
  if (IS_MAC || process.platform === 'linux') app.setBadgeCount(total);
  if (win && process.platform === 'win32') {
    win.setOverlayIcon(total || dot ? nativeImage.createFromPath(iconPath('badge.png')) : null, total ? `${total} tin chưa đọc` : '');
  }
  if (tray) { tray.setToolTip(total ? `${APP_NAME}: ${total} tin chưa đọc` : APP_NAME); updateTrayMenu(); }
  sendUI('ui:badges', { badges: table, news: Object.fromEntries(store.cfg.profiles.map((p) => [p.id, newCount(p.id)])) });
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath('icon.png'), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

function openApp(pid, kind) {
  current = { ...current, profileId: pid, tab: kind, overlay: false };
  showWindow(pid); sendUI('ui:tab', kind); layout(); refreshBadge();
}

// tin mới của một app trong một hồ sơ: ghi vào danh sách Tin mới + hiện thông báo hệ điều hành (nếu app đó đang bật báo tin)
function pushEvent(pid, kind, t, b) {
  const p = profile(pid);
  if (!p) return null;
  const ev = { id: ++evSeq, p: pid, k: kind, t: String(t || '').slice(0, 200), b: String(b || '').slice(0, 500), at: Date.now(), read: false };
  events.unshift(ev); events.length = Math.min(events.length, 500);
  refreshBadge();
  sendUI('ui:event', ev);
  const looking = win && win.isVisible() && win.isFocused() && current.profileId === pid && current.tab === kind && !current.overlay;
  if (notifyOn(p, kind) && !looking) {
    notify(`${p.name} · ${KIND_LABEL[kind] || kind}${ev.t ? ' · ' + ev.t : ''}`, ev.b, () => { ev.read = true; openApp(pid, kind); });
  }
  return ev;
}

ipcMain.on('web:notify', (e, data) => {
  const kind = e.sender.__mtKind;
  if (!data || !NOTIFY_KINDS.includes(kind)) return;
  // Gmail trong tab Google tự báo tin thì thôi không báo lại từ feed (gmailPoll bỏ qua mail đã thấy)
  pushEvent(e.sender.__mtProfile, kind, data.t, data.b);
});

// ------------------------------------------------------------------ Gmail: đếm thư chưa đọc + báo thư mới qua feed Atom
// Không cần mở Gmail: feed nhẹ, dùng cookie đăng nhập Google của chính hồ sơ (session riêng). Chưa đăng nhập thì feed trả 401 → bỏ qua.
const gmailSeen = {};   // profileId -> Set(id thư đã thấy)
function parseGmailFeed(xml) {
  const full = (String(xml).match(/<fullcount>(\d+)<\/fullcount>/) || [])[1];
  const un = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  const pick = (body, tag) => un((body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1]);
  const entries = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = m[1]; const author = (body.match(/<author>([\s\S]*?)<\/author>/) || [])[1] || '';
    entries.push({ id: pick(body, 'id'), title: pick(body, 'title'), summary: pick(body, 'summary'), from: pick(author, 'name') || pick(author, 'email') });
  }
  return { count: full === undefined ? null : parseInt(full, 10), entries };
}
function gmailFeedUrl(p) {
  if (process.env.METATOOLS_GMAIL_FEED) return process.env.METATOOLS_GMAIL_FEED.replace('{gmail}', encodeURIComponent(p.gmail || '0'));   // tests
  return `https://mail.google.com/mail/u/${p.gmail ? encodeURIComponent(p.gmail) : '0'}/feed/atom`;
}
async function gmailPoll(p) {
  try {
    const r = await setupSession(p).fetch(gmailFeedUrl(p), { credentials: 'include', redirect: 'manual', cache: 'no-store' });
    if (!r.ok) return;
    const f = parseGmailFeed(await r.text());
    if (f.count === null) return;
    setUnread(p.id, 'google', f.count);
    const first = !gmailSeen[p.id]; const seen = gmailSeen[p.id] = gmailSeen[p.id] || new Set();
    const gv = views[p.id] && views[p.id].google;
    const gmailOpen = gv && /^https:\/\/mail\.google\.com\//.test(gv.webContents.getURL());   // Gmail đang mở trong tab: trang tự báo
    for (const e of f.entries.slice().reverse()) {
      if (!e.id || seen.has(e.id)) continue;
      seen.add(e.id);
      if (!first && !gmailOpen) pushEvent(p.id, 'google', e.from ? `${e.from}: ${e.title}` : e.title, e.summary);
    }
  } catch (_) { /* mất mạng / chưa đăng nhập: lần sau thử lại */ }
}
function gmailPollAll() {
  for (const p of store.cfg.profiles) if (p.notify !== false && (p.gmail || notifyOn(p, 'google'))) gmailPoll(p);
}

// ------------------------------------------------------------------ tray
function updateTrayMenu() {
  if (!tray) return;
  const items = store.cfg.profiles.map((p) => {
    const c = NOTIFY_KINDS.map((k) => [k, countOf(p.id, k)]); const n = c.reduce((a, [, x]) => a + x.n, 0); const dot = c.some(([, x]) => x.dot);
    const first = (c.find(([, x]) => x.n || x.dot) || ['slack'])[0];   // bấm tên hồ sơ: mở app đang có tin
    return { label: `${p.name}${n ? `  (${n})` : dot ? '  •' : ''}`, click: () => openApp(p.id, first) };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Mở ${APP_NAME}`, click: () => showWindow() },
    { type: 'separator' }, ...items, { type: 'separator' },
    { label: upd.state === 'ready' ? `Khởi động lại để cập nhật ${upd.check.manifest.version}` : 'Kiểm tra cập nhật…', click: () => (upd.state === 'ready' ? restartToUpdate() : openUpdatePanel()) },
    { label: `Thoát ${APP_NAME}`, click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath(IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(iconPath('icon.png')).resize({ width: 16, height: 16 }) : img);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => showWindow());
  updateTrayMenu();
}

// ------------------------------------------------------------------ IPC: app + profiles
const PROFILE_FIELDS = ['name', 'color', 'slackUrl', 'gmail', 'trelloUrl', 'discordUrl', 'notify', 'notifyApps', 'logo'];

// profile logo: a small square picture the UI already cropped/resized (data URL). Anything else is dropped.
const LOGO_MAX = 400 * 1024;
function cleanLogo(v) {
  v = typeof v === 'string' ? v.trim() : '';
  if (!v) return '';
  if (v.length > LOGO_MAX || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error('Logo phải là ảnh PNG/JPEG/WebP nhỏ hơn 300 KB.');
  return v;
}

function cleanTrelloUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  u = u.replace(/^http:/, 'https:');
  if (!TRELLO_RE.test(u.endsWith('/') ? u : u + '/')) throw new Error('Địa chỉ Trello phải dạng https://trello.com/... (bảng hoặc workspace)');
  return u;
}

function cleanDiscordUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  u = u.replace(/^http:/, 'https:');
  if (!DISCORD_RE.test(u.endsWith('/') ? u : u + '/')) throw new Error('Địa chỉ Discord phải dạng https://discord.com/channels/... hoặc https://discord.gg/...');
  return u;
}

function cleanSlackUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  if (!SLACK_RE.test(u.endsWith('/') ? u : u + '/')) throw new Error('Địa chỉ phải là workspace Slack, ví dụ https://tencongty.slack.com');
  return u;
}

function publicState() {
  return {
    version: BOOT.version, shellVersion: BOOT.shellVersion, platform: process.platform,
    profiles: store.cfg.profiles, projects: store.cfg.projects, projSync: store.cfg.projSync, current, badges: badgeTable(),
    news: Object.fromEntries(store.cfg.profiles.map((p) => [p.id, newCount(p.id)])),
    settings: { openAtLogin: app.getLoginItemSettings().openAtLogin, autoUpdate: store.cfg.settings.autoUpdate !== false, sleepMin: sleepMinutes() },
    update: updPublic(),
  };
}

const handlers = {
  'app:state': () => publicState(),
  'app:show': (a) => {
    current = { profileId: a.profileId ?? current.profileId, tab: a.tab || current.tab, overlay: !!a.overlay };
    if (a.markRead && current.profileId && NOTIFY_KINDS.includes(current.tab) && win && win.isVisible()) {
      // the user opened this app of this profile: its notifications count as read
      let changed = false;
      events.forEach((e) => { if (e.p === current.profileId && (e.k || 'slack') === current.tab && !e.read) { e.read = true; changed = true; } });
      if (changed) refreshBadge();
    }
    layout(!!a.focus && win && win.isFocused());
    return true;
  },
  // bảng hồ sơ (di chuột vào nút Hồ sơ) trượt ra: web view là lớp nằm TRÊN giao diện HTML nên bảng không đè lên được.
  // 2.6.0 đẩy web view sang phải → trang bị co lại rồi giãn ra mỗi lần rê chuột (sếp thấy khó chịu). 2.7.0: chụp ảnh trang,
  // giao diện hiện ảnh đó đúng chỗ cũ, gỡ web view ra cho bảng trượt đè lên; đóng bảng thì gắn lại, kích thước trang không đổi.
  'app:peek': async (a) => {
    const open = !!(a && a.w);
    const seq = ++peekSeq;
    if (!open) {
      if (!current.peek) return true;
      current.peek = 0; layout();
      setTimeout(() => { if (seq === peekSeq) sendUI('ui:freeze', null); }, 80);   // web view gắn lại xong mới bỏ ảnh → không nháy
      return true;
    }
    if (current.peek) return true;
    const v = shownView();
    if (v) {
      try {
        const img = await v.webContents.capturePage();
        if (seq !== peekSeq) return true;   // bảng đã đóng trong lúc chụp
        sendUI('ui:freeze', { src: 'data:image/jpeg;base64,' + img.toJPEG(85).toString('base64'), bounds: v.getBounds() });
      } catch (_) { /* chụp lỗi: vẫn mở bảng, chỉ thiếu ảnh nền */ }
    }
    if (seq !== peekSeq) return true;
    current.peek = 1; layout();
    return true;
  },
  // ---- dự án (2.6.0)
  'proj:save': (a) => {
    const d = a || {};
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Đặt tên cho dự án.');
    const STATUS = ['doing', 'waiting', 'done', 'paused'];
    const due = String(d.due || '').trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Hạn chót dạng năm-tháng-ngày.');
    const ids = new Set(store.cfg.profiles.map((p) => p.id));
    const tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter((t) => t && String(t.text || '').trim()).slice(0, 200)
      .map((t) => ({ id: t.id || Store.id(), text: String(t.text).trim().slice(0, 300), done: !!t.done }));
    const vals = {
      name: name.slice(0, 120), status: STATUS.includes(d.status) ? d.status : 'doing', due, owner: String(d.owner || '').trim().slice(0, 80),
      progress: Math.max(0, Math.min(100, Math.round(Number(d.progress) || 0))), note: String(d.note || '').slice(0, 4000),
      link: String(d.link || '').trim().slice(0, 500), profileIds: (Array.isArray(d.profileIds) ? d.profileIds : []).filter((x) => ids.has(x)), tasks, updatedAt: Date.now(),
    };
    let pr = d.id && store.cfg.projects.find((x) => x.id === d.id);
    if (pr) Object.assign(pr, vals); else { pr = { id: Store.id(), ...vals, createdAt: Date.now() }; store.cfg.projects.push(pr); }
    store.save(); return pr;
  },
  'proj:delete': (a) => { const n = store.cfg.projects.length; store.cfg.projects = store.cfg.projects.filter((x) => x.id !== (a && a.id)); if (a && a.id) store.cfg.projTomb[a.id] = Date.now(); store.save(); return n !== store.cfg.projects.length; },
  'proj:syncCfg': (a) => {
    const acc = store.cfg.gitAccounts.find((x) => x.id === (a && a.accId));
    if (!acc) throw new Error('Chọn nick Git dùng để đồng bộ (tạo nick ở tab Git nếu chưa có).');
    const url = G.normUrl(String(a.url || ''), acc); const branch = String(a.branch || 'main').trim() || 'main';
    if (!/^[\w./-]+$/.test(branch)) throw new Error('Tên nhánh không hợp lệ.');
    store.cfg.projSync = { ...store.cfg.projSync, accId: acc.id, url, branch }; store.save(); return store.cfg.projSync;
  },
  'proj:sync': async () => {
    const c = store.cfg.projSync || {};
    const acc = store.cfg.gitAccounts.find((x) => x.id === c.accId);
    if (!acc || !c.url) throw new Error('Chưa cài đặt đồng bộ: bấm ⚙ cạnh nút Đồng bộ để chọn repo + nick Git.');
    const r = await PS.sync({ acc, token: store.getToken(acc.id), url: c.url, branch: c.branch, workDir: path.join(app.getPath('userData'), 'proj-sync'), device: require('os').hostname() },
      { projects: store.cfg.projects, tombstones: store.cfg.projTomb });
    store.cfg.projects = r.projects; store.cfg.projTomb = r.tombstones; store.cfg.projSync = { ...c, lastSync: Date.now() }; store.save();
    return { count: r.projects.length, pushed: r.pushed, lastSync: store.cfg.projSync.lastSync };
  },
  'app:nav': (a) => {
    const p = profile(a.profileId); if (!p) return false;
    const v = ensureView(p, a.kind); const wc = v.webContents;
    if (a.action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (a.action === 'reload') wc.reload();
    else if (a.action === 'home') wc.loadURL(homeOf(p, a.kind));
    else if (a.action === 'external') shell.openExternal(wc.getURL());
    return true;
  },
  'prof:save': (a) => {
    const d = a || {};
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Đặt tên cho hồ sơ (ví dụ: Công ty, Khách A).');
    const gmail = String(d.gmail || '').trim();
    if (gmail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(gmail)) throw new Error('Gmail không hợp lệ.');
    const vals = { name, color: d.color || '#7c4dff', slackUrl: cleanSlackUrl(d.slackUrl), gmail, trelloUrl: cleanTrelloUrl(d.trelloUrl), discordUrl: cleanDiscordUrl(d.discordUrl), notify: d.notify !== false, logo: cleanLogo(d.logo),
      notifyApps: Object.fromEntries(NOTIFY_KINDS.filter((k) => d.notifyApps && typeof d.notifyApps[k] === 'boolean').map((k) => [k, d.notifyApps[k]])) };
    let p = d.id && profile(d.id);
    if (p) {
      const slackChanged = p.slackUrl !== vals.slackUrl;
      const trelloChanged = (p.trelloUrl || '') !== vals.trelloUrl;
      const discordChanged = (p.discordUrl || '') !== vals.discordUrl;
      PROFILE_FIELDS.forEach((k) => { p[k] = vals[k]; });
      if (slackChanged && views[p.id] && views[p.id].slack) views[p.id].slack.webContents.loadURL(p.slackUrl || 'https://app.slack.com/client');
      if (trelloChanged && views[p.id] && views[p.id].trello) views[p.id].trello.webContents.loadURL(trelloHome(p));
      if (discordChanged && views[p.id] && views[p.id].discord) views[p.id].discord.webContents.loadURL(discordHome(p));
    } else {
      p = { id: Store.id(), ...vals, createdAt: Date.now() };
      store.cfg.profiles.push(p);
    }
    store.save(); updateTrayMenu(); refreshBadge();
    for (const k of ['slack', 'trello', 'discord']) if (notifyOn(p, k)) ensureView(p, k);   // vừa bật báo tin: chạy ngầm luôn
    if (notifyOn(p, 'google')) gmailPoll(p);
    return p;
  },
  'prof:delete': async (a) => {
    const p = profile(a.id); if (!p) return false;
    const usedBy = store.cfg.pairs.filter((x) => x.profileId === p.id).length;
    destroyViews(p.id);
    if (a.wipe) await session.fromPartition(partitionOf(p)).clearStorageData();
    store.cfg.profiles = store.cfg.profiles.filter((x) => x.id !== p.id);
    store.cfg.projects.forEach((pr) => { pr.profileIds = (pr.profileIds || []).filter((x) => x !== p.id); });
    store.cfg.gitAccounts.forEach((g) => { if (g.profileId === p.id) g.profileId = null; });
    store.cfg.pairs.forEach((x) => { if (x.profileId === p.id) x.profileId = null; });
    delete unread[p.id]; delete gmailSeen[p.id];
    store.save(); updateTrayMenu(); refreshBadge();
    if (current.profileId === p.id) current = { ...current, profileId: null };
    layout();
    return { usedBy };
  },
  'prof:move': (a) => {
    const list = store.cfg.profiles; const i = list.findIndex((p) => p.id === a.id); const j = i + (a.dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]]; store.save(); updateTrayMenu();
    return true;
  },
  'feed:list': () => events.slice(0, 300),
  'feed:readAll': (a) => { events.forEach((e) => { if (!a || !a.profileId || e.p === a.profileId) e.read = true; }); refreshBadge(); return true; },
  'feed:clear': () => { events.length = 0; refreshBadge(); return true; },
  'feed:open': (a) => {
    const ev = events.find((e) => e.id === a.id); if (!ev) return false;
    ev.read = true; const k = ev.k || 'slack'; current = { ...current, profileId: ev.p, tab: k, overlay: false };
    sendUI('ui:select', ev.p); sendUI('ui:tab', k); layout(); refreshBadge();
    return true;
  },
  'app:setSleep': (a) => { const m = Math.max(0, Math.min(240, Math.round(Number(a && a.min) || 0))); store.cfg.settings.sleepMin = m; store.save(); return m; },
  'app:setLogin': (a) => { app.setLoginItemSettings({ openAtLogin: !!a.on, openAsHidden: true, args: ['--hidden'] }); return app.getLoginItemSettings().openAtLogin; },
  'app:export': async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'metatools_ho_so.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.exportData(), null, 2), 'utf8');
    return r.filePath;
  },
  'app:import': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    for (const p of (data && Array.isArray(data.profiles) ? data.profiles : [])) { try { p.logo = cleanLogo(p.logo); } catch { p.logo = ''; } }   // bad logo in a file: drop it, keep the profile
    const res = store.importData(data);
    updateTrayMenu(); refreshBadge();
    return res;
  },
  'app:openExternal': (a) => { if (/^https:\/\//.test(a.url)) shell.openExternal(a.url); return true; },
  'tr:again': (a) => { if (!lastTr) return false; const p = profile(lastTr.profileId); if (p) doTranslate(p, lastTr.wc, lastTr.text, a.to || 'en', lastTr.editable); return true; },
  'tr:replace': async (a) => {
    if (!lastTr || !lastTr.editable || lastTr.wc.isDestroyed()) throw new Error('Không còn ô soạn tin để thay chữ.');
    current = { ...current, overlay: false }; layout();
    lastTr.wc.focus();
    await new Promise((r) => setTimeout(r, 60));
    lastTr.wc.replace(String(a.text || lastTr.result || ''));
    return true;
  },
  'app:quit': () => { quitting = true; app.quit(); return true; },
  'upd:state': () => updPublic(),
  'upd:check': () => checkUpdate(false),
  'upd:download': () => downloadUpdate(),
  'upd:restart': () => restartToUpdate(),
  'upd:setAuto': (a) => { store.cfg.settings.autoUpdate = !!a.on; store.save(); return !!a.on; },
  'upd:setToken': (a) => {
    const t = String(a.token || '').trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) throw new Error('Token không đúng dạng (github_pat_… hoặc ghp_…).');
    store.setToken(UPD_SECRET, t);
    store.cfg.settings.updateTokenAcc = null; store.save();
    updSet({ state: 'idle', error: '', check: null });
    return updPublic();
  },
  'upd:clearToken': () => { store.setToken(UPD_SECRET, null); updSet({ state: 'idle', error: '', check: null }); return updPublic(); },
  'upd:useAcc': (a) => {
    if (a.id && !updAccs().some((x) => x.id === a.id)) throw new Error('Nick này không có PAT github.com.');
    store.cfg.settings.updateTokenAcc = a.id || null; store.save();
    updSet({ state: 'idle', error: '', check: null });
    return updPublic();
  },
  'upd:openFull': () => { const u = upd.check && (upd.check.fullUrl || null); if (u) shell.openExternal(u); return !!u; },

  // ---------------------------------------------------------------- git
  'git:state': async () => ({
    gitVersion: await G.gitVersion(),
    accounts: store.cfg.gitAccounts.map((a) => ({ ...a, hasToken: store.hasToken(a.id), pub: a.auth === 'ssh' && a.keyPath ? G.readPub(a.keyPath) : '', status: gitStatus[a.id] || null })),
    pairs: store.cfg.pairs, prepared, task: task && { id: task.id, title: task.title, done: task.done, ok: task.ok, count: task.lines.length },
  }),
  'git:saveAccount': async (a) => {
    const d = a || {};
    const label = String(d.label || '').trim(); const host = String(d.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const user = String(d.user || '').trim(); const email = String(d.email || '').trim();
    if (!label) throw new Error('Đặt tên gợi nhớ cho nick (ví dụ: Github cá nhân, Gitlab công ty).');
    if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) throw new Error('Máy chủ không hợp lệ (github.com, gitlab.com, gitlab.congty.vn...).');
    if (!user) throw new Error('Thiếu username của nick.');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ (email này đứng tên các commit đẩy lên bằng nick này).');
    const auth = d.auth === 'ssh' ? 'ssh' : 'pat';
    let acc = d.id && store.cfg.gitAccounts.find((x) => x.id === d.id);
    if (!acc) { acc = { id: Store.id(), createdAt: Date.now() }; store.cfg.gitAccounts.push(acc); }
    Object.assign(acc, { label, host, user, email, auth, profileId: d.profileId || acc.profileId || null });
    if (auth === 'pat' && d.token) store.setToken(acc.id, String(d.token).trim());
    if (auth === 'ssh') {
      if (d.keyPath) acc.keyPath = d.keyPath;
      if (!acc.keyPath) acc.keyPath = path.join(app.getPath('userData'), 'keys', `${acc.id}_ed25519`);
      await G.genKey(acc.keyPath, `metatools-${label.replace(/\s+/g, '_')} ${email}`);
    }
    delete gitStatus[acc.id];
    store.save();
    return { id: acc.id, pub: auth === 'ssh' ? G.readPub(acc.keyPath) : '' };
  },
  'git:chooseKey': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn file SSH private key (không phải file .pub)', properties: ['openFile', 'showHiddenFiles'] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (r.filePaths[0].endsWith('.pub')) throw new Error('Đây là public key. Hãy chọn file private key (cùng tên, không có .pub).');
    return r.filePaths[0];
  },
  'git:deleteAccount': (a) => {
    const used = store.cfg.pairs.filter((p) => p.srcAcc === a.id || p.dstAcc === a.id).map((p) => p.name);
    if (used.length) throw new Error('Nick đang dùng trong cặp: ' + used.join(', ') + '. Xoá hoặc đổi cặp trước.');
    const acc = store.cfg.gitAccounts.find((x) => x.id === a.id);
    store.cfg.gitAccounts = store.cfg.gitAccounts.filter((x) => x.id !== a.id);
    store.setToken(a.id, null);
    if (acc && acc.keyPath && acc.keyPath.startsWith(path.join(app.getPath('userData'), 'keys'))) {
      for (const f of [acc.keyPath, acc.keyPath + '.pub']) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
    store.save();
    return true;
  },
  'git:verify': async (a) => {
    const acc = store.cfg.gitAccounts.find((x) => x.id === a.id); if (!acc) throw new Error('Không có nick này.');
    try {
      const who = await G.verify(acc, store.getToken(acc.id));
      gitStatus[acc.id] = { ok: true, who: who.login, expires: who.expires, msg: 'Đúng nick', at: Date.now() };
    } catch (e) {
      gitStatus[acc.id] = { ok: false, who: '', msg: e.message, at: Date.now() };
    }
    return gitStatus[acc.id];
  },
  'git:savePair': (a) => {
    const d = a || {};
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Đặt tên cho cặp.');
    const src = store.cfg.gitAccounts.find((x) => x.id === d.srcAcc); const dst = store.cfg.gitAccounts.find((x) => x.id === d.dstAcc);
    if (!src || !dst) throw new Error('Chọn đủ nick nguồn và nick đích.');
    if (src.id === dst.id) throw new Error('Nick nguồn và nick đích phải khác nhau.');
    const srcUrl = G.normUrl(d.srcUrl, src); const dstUrl = G.normUrl(d.dstUrl, dst);
    if (!['newest', 'fixed', 'pattern'].includes(d.srcMode)) d.srcMode = 'newest';
    if (!['same', 'fixed', 'prefix'].includes(d.dstMode)) d.dstMode = 'same';
    if (d.srcMode !== 'newest' && !String(d.srcBranch || '').trim()) throw new Error('Nhập tên nhánh nguồn (hoặc mẫu, ví dụ release/*).');
    if (d.dstMode === 'fixed' && !String(d.dstBranch || '').trim()) throw new Error('Nhập tên nhánh đích.');
    let p = d.id && store.cfg.pairs.find((x) => x.id === d.id);
    if (!p) { p = { id: Store.id(), createdAt: Date.now() }; store.cfg.pairs.push(p); }
    Object.assign(p, {
      name, color: d.color || '#26a69a', profileId: d.profileId || p.profileId || null,
      srcAcc: src.id, srcUrl, srcMode: d.srcMode, srcBranch: String(d.srcBranch || '').trim(),
      dstAcc: dst.id, dstUrl, dstMode: d.dstMode, dstBranch: String(d.dstBranch || '').trim(),
      message: String(d.message || '').trim() || 'Sync {branch} @ {sha}',
    });
    delete prepared[p.id];
    store.save();
    return p;
  },
  'git:deletePair': (a) => { store.cfg.pairs = store.cfg.pairs.filter((x) => x.id !== a.id); delete prepared[a.id]; store.save(); return true; },
  'git:run': (a) => startGitTask(a.pairId, a.kind),
  'git:push': (a) => startGitTask(a.pairId, 'push', { message: a.message }),
  'git:cancel': (a) => { delete prepared[a.pairId]; return true; },
  'git:clearLog': () => { logHistory.length = 0; return true; },
  'git:log': (a) => (a.all ? { lines: logHistory.slice(), done: !task || task.done } : task ? { id: task.id, lines: task.lines.slice(a.since || 0), count: task.lines.length, done: task.done, ok: task.ok } : { lines: [], count: 0, done: true }),
};

for (const [ch, fn] of Object.entries(handlers)) {
  ipcMain.handle(ch, async (e, arg) => {
    if (!win || e.sender !== win.webContents) throw new Error('forbidden');
    try { return { ok: true, data: await fn(arg || {}) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function gitCtx(pair) {
  const src = store.cfg.gitAccounts.find((x) => x.id === pair.srcAcc);
  const dst = store.cfg.gitAccounts.find((x) => x.id === pair.dstAcc);
  if (!src || !dst) throw new Error('Cặp này thiếu nick (nick đã bị xoá?).');
  return {
    src, dst, srcToken: store.getToken(src.id), dstToken: store.getToken(dst.id),
    workDir: path.join(app.getPath('userData'), 'git-work', pair.id),
    log: (m, k) => { const line = { t: new Date().toLocaleTimeString(), m, k: k || 'info' }; task.lines.push(line); pushLog(line); },
  };
}

function startGitTask(pairId, kind, opts) {
  if (task && !task.done) throw new Error('Đang có việc Git khác chạy, chờ xong rồi bấm lại.');
  const pair = store.cfg.pairs.find((x) => x.id === pairId); if (!pair) throw new Error('Không có cặp này.');
  const title = { pull: 'Pull', prepare: 'Chuẩn bị push', push: 'Push' }[kind] + `: ${pair.name}`;
  task = { id: Date.now(), title, lines: [], done: false, ok: false };
  pushLog({ t: '', m: `── ${title} ──`, k: 'head' });
  (async () => {
    const ctx = gitCtx(pair);
    if (kind === 'pull') {
      const r = await G.pull(pair, ctx);
      pair.last = { ...(pair.last || {}), branch: r.branch, sha: r.sha, date: r.date, pulledAt: Date.now() };
    } else if (kind === 'prepare') {
      prepared[pair.id] = await G.prepare(pair, ctx);
      pair.last = { ...(pair.last || {}), branch: prepared[pair.id].srcBranch, sha: prepared[pair.id].sha, date: prepared[pair.id].srcDate, pulledAt: Date.now() };
    } else {
      let pr = prepared[pair.id]; if (!pr) throw new Error('Chưa chuẩn bị. Bấm Pull + Push trước.');
      if (opts && typeof opts.message === 'string') pr = prepared[pair.id] = await G.rewordPrepared(pr, opts.message, ctx);   // message edited in the confirm box
      const r = await G.push(pr, ctx);
      pair.last = { ...(pair.last || {}), pushedAt: Date.now(), pushedSha: pr.sha, pushedBranch: pr.dstBranch };
      delete prepared[pair.id];
    }
    store.save();
    task.ok = true;
  })().catch((e) => {
    const line = { t: new Date().toLocaleTimeString(), m: e.message || String(e), k: 'err' };
    task.lines.push(line); pushLog(line);
  }).finally(() => {
    task.done = true;
    sendUI('git:done', { id: task.id, ok: task.ok, kind, pairId, prepared: prepared[pairId] || null });
  });
  return { id: task.id };
}

// ------------------------------------------------------------------ in-app update (lib/updater.js + lib/boot.js)
// state: idle | checking | latest | available | needFull | bad | downloading | ready | error
const upd = { state: 'idle', check: null, error: '', got: 0, total: 0, notice: null };

// OPTIONAL GitHub token, only for the private-repo fallback (the default channel is public): the owner's own read-only
// PAT (secrets.json via safeStorage, same as Git nicks) or the PAT of a github.com Git nick already in the app.
// Never logged, never sent to the UI, only to api.github.com.
const UPD_SECRET = '__update';
function updAccs() { return store.cfg.gitAccounts.filter((a) => a.auth === 'pat' && a.host === 'github.com' && store.hasToken(a.id)); }
function updTokenSource() {
  const acc = store.cfg.settings.updateTokenAcc && updAccs().find((a) => a.id === store.cfg.settings.updateTokenAcc);
  if (acc) return { kind: 'acc', acc };
  return store.hasToken(UPD_SECRET) ? { kind: 'own' } : { kind: 'none' };
}
function updToken() {
  const src = updTokenSource();
  return src.kind === 'acc' ? store.getToken(src.acc.id) : src.kind === 'own' ? store.getToken(UPD_SECRET) : null;
}

function updPublic() {
  const c = upd.check;
  const src = updTokenSource();
  return {
    state: upd.state, error: upd.error, got: upd.got, total: upd.total, notice: upd.notice,
    version: BOOT.version, shellVersion: BOOT.shellVersion, fromPayload: !!BOOT.payload,
    checkedAt: store.cfg.settings.updateCheckedAt || 0, url: U.channel(),
    token: { source: src.kind, acc: src.acc ? src.acc.id : null, hasOwn: store.hasToken(UPD_SECRET) },
    accs: updAccs().map((a) => ({ id: a.id, label: a.label, user: a.user })),
    latest: c ? { version: c.manifest.version, date: c.manifest.date, notes: c.manifest.notes, reason: c.reason || '', fullUrl: c.fullUrl } : null,
  };
}

function updSet(patch) { Object.assign(upd, patch); sendUI('ui:update', updPublic()); updateTrayMenu(); }

async function checkUpdate(auto) {
  if (['checking', 'downloading', 'ready'].includes(upd.state)) return updPublic();
  const token = updToken();   // null is fine: public channel
  updSet({ state: 'checking', error: '' });
  try {
    const r = await U.check({
      currentVersion: BOOT.version, shellVersion: BOOT.shellVersion, electronMajor: parseInt(process.versions.electron, 10),
      platform: process.platform, arch: process.arch, bad: BOOT.boot ? BOOT.boot.readState(app.getPath('userData')).bad : [],
    }, { token });
    store.cfg.settings.updateCheckedAt = Date.now(); store.save();
    updSet({ state: r.status, check: r });
    if (auto && r.status === 'available') notify(`${APP_NAME} ${r.manifest.version} đã có`, 'Bấm để xem thay đổi và cập nhật ngay trong app.', openUpdatePanel);
  } catch (e) {
    updSet({ state: 'error', error: e.message || String(e) });
  }
  return updPublic();
}

async function downloadUpdate() {
  if (upd.state !== 'available') throw new Error('Không có bản mới để tải (bấm Kiểm tra cập nhật trước).');
  updSet({ state: 'downloading', got: 0, total: upd.check.manifest.payload.size || 0, error: '' });
  let last = 0;
  try {
    await U.download(upd.check.manifest, app.getPath('userData'), {
      token: upd.check.manifest.payload.github ? updToken() : null,
      onProgress: ({ got, total }) => { upd.got = got; upd.total = total; if (Date.now() - last > 200) { last = Date.now(); sendUI('ui:update', updPublic()); } },
    });
    updSet({ state: 'ready' });
    notify('Đã tải xong bản cập nhật', `Khởi động lại ${APP_NAME} để dùng bản ${upd.check.manifest.version}.`, openUpdatePanel);
  } catch (e) {
    updSet({ state: 'available', error: e.message || String(e) });
    throw e;
  }
  return updPublic();
}

function restartToUpdate() {
  if (upd.state !== 'ready') throw new Error('Chưa tải xong bản cập nhật.');
  quitting = true;
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
  app.quit();   // before-quit still flushes cookies / storage
  return true;
}

function openUpdatePanel() { showWindow(); sendUI('ui:update', { ...updPublic(), open: true }); if (upd.state === 'idle' || upd.state === 'error' || upd.state === 'latest') checkUpdate(false); }

function confirmStart() {
  if (!BOOT.trial) return;
  BOOT.markGood();
  console.log('[update] payload', BOOT.version, 'confirmed good');
}

function autoCheck() {
  if (store.cfg.settings.autoUpdate === false || process.env.METATOOLS_SELFTEST || process.env.METATOOLS_UPDATE_SELFTEST) return;
  if (Date.now() - (store.cfg.settings.updateCheckedAt || 0) < U.CHECK_EVERY) return;
  checkUpdate(true);
}

// ------------------------------------------------------------------ app lifecycle
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  app.setAppUserModelId('vn.metax.metatools');
  // bộ cài cũ (MetaTools.app) chạy bản cập nhật trong app vẫn mang icon cũ trong bundle: đặt icon dock lúc chạy cho khớp logo mới
  if (IS_MAC && app.dock) { try { app.dock.setIcon(iconPath('icon.png')); } catch (_) { /* không quan trọng */ } }
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: BOOT.version });
  app.userAgentFallback = cleanUA(app.userAgentFallback);
  store = new Store(app.getPath('userData'), safeStorage);
  createWindow();
  if (!process.env.METATOOLS_NO_TRAY) createTray();
  refreshBadge();
  // "rolled back" / "corrupt payload" notice left by lib/boot.js at this start
  if (BOOT.boot) upd.notice = BOOT.boot.takeNotice(app.getPath('userData'));
  if (upd.notice) notify(`${APP_NAME} đã quay về bản cũ`, `Bản ${upd.notice.from} ${upd.notice.type === 'corrupt' ? 'bị hỏng file' : 'lỗi khi khởi động'}, đang chạy ${upd.notice.to}.`, openUpdatePanel);
  if (process.env.METATOOLS_SELFTEST) require('./test/selftest')({ win, handlers, store, views, events, layout, ensureView, routeLink, current: () => current });
  if (process.env.METATOOLS_UPDATE_SELFTEST) require('./test/selftest-update')({ win, handlers, store, upd, BOOT, confirmStart });
  if (process.env.METATOOLS_UI_SELFTEST) require('./test/selftest-ui')({ win, handlers, store, views });
  if (process.env.METATOOLS_27_SELFTEST) require('./test/selftest-27')({ win, handlers, store, views, events, ensureView, routeLink, gmailPollAll, sleepIdle, current: () => current, ui: (js) => win.webContents.executeJavaScript(js, true) });
  if (process.env.METATOOLS_IME_SELFTEST) require('./test/selftest-ime')({ win, handlers, store, layout, ensureView, refreshBadge, ui: (js) => win.webContents.executeJavaScript(js, true) });
  // automatic update check: 30 s after start, then hourly (each check itself waits 6 h since the last one)
  setTimeout(autoCheck, 30000);
  setInterval(autoCheck, 3600 * 1000);
  // chạy ngầm các app đang bật báo tin (Slack, Trello, Discord) để tin tới mà không phải mở từng cái; Gmail đọc qua feed, không cần mở
  setTimeout(() => {
    for (const p of store.cfg.profiles) for (const k of ['slack', 'trello', 'discord']) if (notifyOn(p, k)) ensureView(p, k);
    gmailPollAll();
  }, 1500);
  setInterval(gmailPollAll, Number(process.env.METATOOLS_GMAIL_POLL_MS) || 60000);
  setInterval(sleepIdle, 60000);
});

app.on('activate', () => showWindow());

app.on('before-quit', (e) => {
  quitting = true;
  if (flushed) return;
  e.preventDefault();
  // write cookies / local storage to disk before exit (avoids "Slack logged me out")
  const jobs = store.cfg.profiles.map((p) => {
    const ses = session.fromPartition(partitionOf(p));
    return Promise.all([ses.cookies.flushStore().catch(() => {}), Promise.resolve(ses.flushStorageData())]);
  });
  Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 3000))]).finally(() => { flushed = true; app.quit(); });
});

app.on('window-all-closed', () => { /* keep running in the tray */ });
