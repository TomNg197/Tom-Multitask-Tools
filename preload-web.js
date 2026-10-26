'use strict';
// Runs in the Slack / Gmail / Trello / Discord views (2.7.0: trước chỉ Slack). Trang gọi window.Notification /
// ServiceWorkerRegistration.showNotification in the PAGE world; with context isolation the hook is injected there and talks back through window.postMessage + a nonce.
// The page never gets ipcRenderer.
const { ipcRenderer, webFrame } = require('electron');

const NONCE = Math.random().toString(36).slice(2) + Date.now().toString(36);

window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (ev.source !== window || !d || d.__mt !== NONCE) return;
  ipcRenderer.send('web:notify', { t: String(d.t || '').slice(0, 200), b: String(d.b || '').slice(0, 500) });
});

const HOOK = `(() => {
  if (window.__mtHook) return; window.__mtHook = 1;
  const send = (t, o) => { try { window.postMessage({ __mt: ${JSON.stringify(NONCE)}, t: String(t || ''), b: String((o && o.body) || '') }, '*'); } catch (e) {} };
  // MetaTools shows the OS notification itself (click -> right profile), so the page notification is a silent stub
  function MTNotification(title, opts) {
    send(title, opts);
    this.title = title; this.body = (opts && opts.body) || ''; this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
    setTimeout(() => { try { this.onshow && this.onshow(); } catch (e) {} }, 0);
  }
  MTNotification.prototype.close = function () { try { this.onclose && this.onclose(); } catch (e) {} };
  MTNotification.prototype.addEventListener = function () {};
  MTNotification.prototype.removeEventListener = function () {};
  MTNotification.requestPermission = (cb) => { cb && cb('granted'); return Promise.resolve('granted'); };
  Object.defineProperty(MTNotification, 'permission', { get: () => 'granted' });
  MTNotification.maxActions = 0;
  window.Notification = MTNotification;
  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
    ServiceWorkerRegistration.prototype.showNotification = function (t, o) { send(t, o); return Promise.resolve(); };
  }
})();`;

webFrame.executeJavaScript(HOOK).catch(() => {});
window.addEventListener('DOMContentLoaded', () => { webFrame.executeJavaScript(HOOK).catch(() => {}); });
