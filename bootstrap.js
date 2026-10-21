'use strict';
// Entry point of the packaged app (package.json "main"). Picks which app code to run:
//   - a newer payload downloaded by the in-app updater (userData/updates/payloads/<ver>.asar, sha256-checked), or
//   - the bundled main.js (always kept as the fallback).
// A payload that throws while loading, or crashes before it confirms a good start (lib/boot.js markGood), is rolled back.
// Keep this file tiny and stable: it can only change with a full reinstall.
const { app } = require('electron');
const path = require('path');

if (process.env.METATOOLS_USERDATA) app.setPath('userData', process.env.METATOOLS_USERDATA);   // tests / portable use
// lock first, so a second launch does not touch the update state of the running instance
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const boot = require('./lib/boot');
const shellVersion = app.getVersion();
let pick = { payload: null, version: shellVersion, trial: false };
if (!process.env.METATOOLS_NO_PAYLOAD) {
  try { pick = boot.choose(app.getPath('userData'), shellVersion); } catch (e) { console.error('[update] state error, using bundled app:', e.message); }
}

function failed(e) {
  console.error('[update] payload', pick.version, 'failed, rolling back:', e && (e.stack || e));
  try { boot.reportCrash(app.getPath('userData'), pick.version); } catch (_) { /* best effort */ }
  if (!process.env.METATOOLS_NO_RELAUNCH) app.relaunch();
  app.exit(1);
}

global.__mtBoot = {
  shellVersion, version: pick.version, payload: pick.payload, trial: pick.trial, boot,
  // main.js calls this once the new version is up and running (window shown, no crash for a few seconds)
  markGood() {
    if (!this.trial) return false;
    this.trial = false;
    process.removeListener('uncaughtException', failed);
    return boot.markGood(app.getPath('userData'), this.version);
  },
};

if (pick.payload) {
  if (pick.trial) process.on('uncaughtException', failed);   // only while on trial: removed by markGood
  try { require(path.join(pick.payload, 'main.js')); } catch (e) { failed(e); }
} else {
  require('./main.js');
}
