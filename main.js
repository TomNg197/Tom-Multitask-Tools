'use strict';
// MetaTools 2 — one desktop app (macOS / Windows): many Slack accounts, each with its own Google (Drive/Gmail) tab and
// git accounts + pairs (pull newest branch -> push one snapshot commit, no personal history). No browser needed.
const { app, BrowserWindow, WebContentsView, ipcMain, Tray, Menu, Notification, nativeImage, shell, session, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./lib/store');
const G = require('./lib/git');

const SIDEBAR = 76;
const TOPBAR = 52;
const IS_MAC = process.platform === 'darwin';
const START_HIDDEN = process.argv.includes('--hidden');

if (process.env.METATOOLS_USERDATA) app.setPath('userData', process.env.METATOOLS_USERDATA);   // tests / portable use
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let tray = null;
let store = null;
let quitting = false;
let flushed = false;
const views = {};          // profileId -> { slack: WebContentsView, google: WebContentsView }
const unread = {};         // profileId -> number | '•'
const events = [];         // notification feed
let evSeq = 0;
let current = { profileId: null, tab: 'slack', overlay: false };
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
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600, show: false, title: 'MetaTools',
    backgroundColor: '#1a1420', icon: iconPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
  win.on('resize', layout);
  win.on('focus', () => sendUI('ui:focus', true));
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!store.cfg.settings.trayHintShown) {
      store.cfg.settings.trayHintShown = true; store.save();
      notify('MetaTools vẫn đang chạy', 'App chạy ngầm ở khay hệ thống để nhận tin Slack. Thoát hẳn: chuột phải biểu tượng → Thoát.');
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
  return { x: SIDEBAR, y: TOPBAR, width: Math.max(100, w - SIDEBAR), height: Math.max(100, h - TOPBAR) };
}

function layout() {
  if (!win) return;
  const cv = win.contentView;
  // detach every web view, then attach only the visible one
  for (const pid of Object.keys(views)) {
    for (const k of ['slack', 'google']) {
      const v = views[pid][k];
      if (v && cv.children.includes(v)) cv.removeChildView(v);
    }
  }
  const p = profile(current.profileId);
  if (!p || current.overlay || !['slack', 'google'].includes(current.tab)) return;
  const v = ensureView(p, current.tab);
  cv.addChildView(v);
  v.setBounds(contentBounds());
}

// ------------------------------------------------------------------ profiles + web views
function profile(id) { return store.cfg.profiles.find((p) => p.id === id); }
function partitionOf(p) { return `persist:p-${p.id}`; }

const GOOGLE_RE = /^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com|gstatic\.com)\//i;
const SLACK_RE = /^https:\/\/([a-z0-9-]+\.)*(slack\.com|slack-edge\.com|slack-files\.com|slack-redir\.net)\//i;

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
  return ses;
}

function ensureView(p, kind) {
  views[p.id] = views[p.id] || {};
  if (views[p.id][kind]) return views[p.id][kind];
  setupSession(p);
  const v = new WebContentsView({
    webPreferences: {
      partition: partitionOf(p), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: kind !== 'slack',   // Slack keeps receiving while hidden / in the tray
      preload: kind === 'slack' ? path.join(__dirname, 'preload-slack.js') : undefined,
    },
  });
  const wc = v.webContents;
  wc.__mtProfile = p.id;
  wc.__mtKind = kind;
  wc.setWindowOpenHandler(({ url }) => routeLink(p, url, kind));
  wc.on('page-title-updated', (e, title) => { if (kind === 'slack') setUnread(p.id, parseUnread(title)); });
  wc.on('did-finish-load', () => sendUI('ui:viewState', { profileId: p.id, kind, url: wc.getURL(), title: wc.getTitle() }));
  wc.on('did-navigate', () => sendUI('ui:viewState', { profileId: p.id, kind, url: wc.getURL(), title: wc.getTitle() }));
  wc.loadURL(kind === 'slack' ? (p.slackUrl || 'https://app.slack.com/client') : googleHome(p));
  views[p.id][kind] = v;
  return v;
}

function routeLink(p, url, fromKind) {
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
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath('icon.png'), webPreferences: { partition: partitionOf(p), sandbox: true, contextIsolation: true } } };
  }
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  return { action: 'deny' };
}

function destroyViews(pid) {
  const vs = views[pid];
  if (!vs) return;
  for (const k of ['slack', 'google']) {
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

function setUnread(pid, val) {
  if (unread[pid] === val) return;
  unread[pid] = val;
  refreshBadge();
}

function newCount(pid) { return events.filter((e) => e.p === pid && !e.read).length; }

function refreshBadge() {
  let total = 0; let dot = false;
  for (const p of store.cfg.profiles) {
    const u = unread[p.id];
    const n = Math.max(typeof u === 'number' ? u : 0, newCount(p.id));
    total += n; if (u === '•') dot = true;
  }
  if (IS_MAC || process.platform === 'linux') app.setBadgeCount(total);
  if (win && process.platform === 'win32') {
    win.setOverlayIcon(total || dot ? nativeImage.createFromPath(iconPath('badge.png')) : null, total ? `${total} tin chưa đọc` : '');
  }
  if (tray) { tray.setToolTip(total ? `MetaTools: ${total} tin chưa đọc` : 'MetaTools'); updateTrayMenu(); }
  sendUI('ui:badges', { unread, news: Object.fromEntries(store.cfg.profiles.map((p) => [p.id, newCount(p.id)])) });
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath('icon.png'), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

ipcMain.on('slack:notify', (e, data) => {
  const pid = e.sender.__mtProfile;
  const p = profile(pid);
  if (!p || !data) return;
  const ev = { id: ++evSeq, p: pid, t: String(data.t || '').slice(0, 200), b: String(data.b || '').slice(0, 500), at: Date.now(), read: false };
  events.unshift(ev); events.length = Math.min(events.length, 500);
  refreshBadge();
  sendUI('ui:event', ev);
  const looking = win && win.isVisible() && win.isFocused() && current.profileId === pid && current.tab === 'slack' && !current.overlay;
  if (p.notify !== false && !looking) {
    notify(`${p.name} · ${ev.t || 'Slack'}`, ev.b, () => { ev.read = true; current = { ...current, profileId: pid, tab: 'slack' }; showWindow(pid); sendUI('ui:tab', 'slack'); layout(); refreshBadge(); });
  }
});

// ------------------------------------------------------------------ tray
function updateTrayMenu() {
  if (!tray) return;
  const items = store.cfg.profiles.map((p) => {
    const u = unread[p.id]; const n = Math.max(typeof u === 'number' ? u : 0, newCount(p.id));
    return { label: `${p.name}${n ? `  (${n})` : u === '•' ? '  •' : ''}`, click: () => { current = { ...current, profileId: p.id, tab: 'slack' }; showWindow(p.id); sendUI('ui:tab', 'slack'); layout(); } };
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở MetaTools', click: () => showWindow() },
    { type: 'separator' }, ...items, { type: 'separator' },
    { label: 'Thoát MetaTools', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath(IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(iconPath('icon.png')).resize({ width: 16, height: 16 }) : img);
  tray.setToolTip('MetaTools');
  tray.on('click', () => showWindow());
  updateTrayMenu();
}

// ------------------------------------------------------------------ IPC: app + profiles
const PROFILE_FIELDS = ['name', 'color', 'slackUrl', 'gmail', 'notify'];

function cleanSlackUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  if (!SLACK_RE.test(u.endsWith('/') ? u : u + '/')) throw new Error('Địa chỉ phải là workspace Slack, ví dụ https://tencongty.slack.com');
  return u;
}

function publicState() {
  return {
    version: app.getVersion(), platform: process.platform,
    profiles: store.cfg.profiles, current, unread,
    news: Object.fromEntries(store.cfg.profiles.map((p) => [p.id, newCount(p.id)])),
    settings: { openAtLogin: app.getLoginItemSettings().openAtLogin },
  };
}

const handlers = {
  'app:state': () => publicState(),
  'app:show': (a) => {
    current = { profileId: a.profileId ?? current.profileId, tab: a.tab || current.tab, overlay: !!a.overlay };
    if (a.markRead && current.profileId && current.tab === 'slack' && win && win.isVisible()) {
      // the user opened this profile's Slack: its in-app notifications count as read
      let changed = false;
      events.forEach((e) => { if (e.p === current.profileId && !e.read) { e.read = true; changed = true; } });
      if (changed) refreshBadge();
    }
    layout();
    return true;
  },
  'app:nav': (a) => {
    const p = profile(a.profileId); if (!p) return false;
    const v = ensureView(p, a.kind); const wc = v.webContents;
    if (a.action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (a.action === 'reload') wc.reload();
    else if (a.action === 'home') wc.loadURL(a.kind === 'slack' ? (p.slackUrl || 'https://app.slack.com/client') : googleHome(p));
    else if (a.action === 'external') shell.openExternal(wc.getURL());
    return true;
  },
  'prof:save': (a) => {
    const d = a || {};
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Đặt tên cho hồ sơ (ví dụ: Công ty, Khách A).');
    const gmail = String(d.gmail || '').trim();
    if (gmail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(gmail)) throw new Error('Gmail không hợp lệ.');
    const vals = { name, color: d.color || '#7c4dff', slackUrl: cleanSlackUrl(d.slackUrl), gmail, notify: d.notify !== false };
    let p = d.id && profile(d.id);
    if (p) {
      const slackChanged = p.slackUrl !== vals.slackUrl;
      PROFILE_FIELDS.forEach((k) => { p[k] = vals[k]; });
      if (slackChanged && views[p.id] && views[p.id].slack) views[p.id].slack.webContents.loadURL(p.slackUrl || 'https://app.slack.com/client');
    } else {
      p = { id: Store.id(), ...vals, createdAt: Date.now() };
      store.cfg.profiles.push(p);
    }
    store.save(); updateTrayMenu(); refreshBadge();
    return p;
  },
  'prof:delete': async (a) => {
    const p = profile(a.id); if (!p) return false;
    const usedBy = store.cfg.pairs.filter((x) => x.profileId === p.id).length;
    destroyViews(p.id);
    if (a.wipe) await session.fromPartition(partitionOf(p)).clearStorageData();
    store.cfg.profiles = store.cfg.profiles.filter((x) => x.id !== p.id);
    store.cfg.gitAccounts.forEach((g) => { if (g.profileId === p.id) g.profileId = null; });
    store.cfg.pairs.forEach((x) => { if (x.profileId === p.id) x.profileId = null; });
    delete unread[p.id];
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
    ev.read = true; current = { ...current, profileId: ev.p, tab: 'slack', overlay: false };
    sendUI('ui:select', ev.p); sendUI('ui:tab', 'slack'); layout(); refreshBadge();
    return true;
  },
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
    const res = store.importData(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
    updateTrayMenu(); refreshBadge();
    return res;
  },
  'app:openExternal': (a) => { if (/^https:\/\//.test(a.url)) shell.openExternal(a.url); return true; },
  'app:quit': () => { quitting = true; app.quit(); return true; },

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
  'git:push': (a) => startGitTask(a.pairId, 'push'),
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

function startGitTask(pairId, kind) {
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
      const pr = prepared[pair.id]; if (!pr) throw new Error('Chưa chuẩn bị. Bấm Pull + Push trước.');
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

// ------------------------------------------------------------------ app lifecycle
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  app.setAppUserModelId('vn.metax.metatools');
  app.userAgentFallback = cleanUA(app.userAgentFallback);
  store = new Store(app.getPath('userData'), safeStorage);
  createWindow();
  if (!process.env.METATOOLS_NO_TRAY) createTray();
  refreshBadge();
  if (process.env.METATOOLS_SELFTEST) require('./test/selftest')({ win, handlers, store, views, events, layout, ensureView, current: () => current });
  // start every Slack in the background so notifications arrive without opening each one
  setTimeout(() => {
    for (const p of store.cfg.profiles) if (p.notify !== false) ensureView(p, 'slack');
  }, 1500);
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
