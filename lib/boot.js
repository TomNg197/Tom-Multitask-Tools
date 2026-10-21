'use strict';
// Update state + payload choice at startup (asar-level update).
// The packaged app ("shell" = Electron + the bundled app.asar) never changes; a newer app payload (main.js, lib, ui...)
// lives in userData/updates/payloads/<version>.asar and bootstrap.js loads it instead of the bundled main.js.
// Bootstrap runs THIS file from the shell, so: no Electron APIs, no dependencies, and keep state.json backward-compatible
// (an old shell must still read a state written by a newer payload).
//
// state.json: { current, previous, pending: {version, file, sha256} | null, good, tries, bad: [version], notice }
//   pending  -> downloaded + verified, used at the next start
//   current  -> the payload being run; good=false until the app confirms it started fine (markGood)
//   previous -> last payload that was confirmed good (rollback target; the bundled shell is the final fallback)
let fs; try { fs = require('original-fs'); } catch (_) { fs = require('fs'); }   // original-fs: Electron's fs treats *.asar as a folder
const path = require('path');
const crypto = require('crypto');

const MAX_TRIES = 2;            // starts allowed without markGood before rolling back
const FILE_RE = /^[0-9A-Za-z._-]+\.asar$/;

function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null;
}

// semver compare (x.y.z, x.y.z-pre < x.y.z); invalid versions sort lowest
function cmpVer(a, b) {
  const x = parseVer(a); const y = parseVer(b);
  if (!x || !y) return !x && !y ? 0 : !x ? -1 : 1;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function dirs(userData) {
  const root = path.join(userData, 'updates');
  return { root, payloads: path.join(root, 'payloads'), state: path.join(root, 'state.json') };
}

function validEntry(e) { return !!(e && parseVer(e.version) && FILE_RE.test(e.file || '') && /^[a-f0-9]{64}$/.test(e.sha256 || '')); }

function readState(userData) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(dirs(userData).state, 'utf8')) || {}; } catch (_) { s = {}; }
  return {
    current: validEntry(s.current) ? s.current : null,
    previous: validEntry(s.previous) ? s.previous : null,
    pending: validEntry(s.pending) ? s.pending : null,
    good: s.good !== false, tries: Number(s.tries) || 0,
    bad: Array.isArray(s.bad) ? s.bad.filter((v) => typeof v === 'string').slice(-20) : [],
    notice: s.notice || null,
  };
}

function writeState(userData, st) {
  const d = dirs(userData);
  fs.mkdirSync(d.root, { recursive: true });
  const tmp = d.state + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8');
  fs.renameSync(tmp, d.state);
}

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function payloadPath(userData, e) { return path.join(dirs(userData).payloads, e.file); }

function intact(userData, e) {
  try { return sha256File(payloadPath(userData, e)) === e.sha256; } catch (_) { return false; }
}

function markBad(st, v) { if (!st.bad.includes(v)) st.bad.push(v); st.bad = st.bad.slice(-20); }

// fall back from `current` to `previous` (or to the bundled shell)
function rollback(st, why, shellVersion) {
  const from = st.current.version;
  markBad(st, from);
  st.current = st.previous; st.previous = null; st.good = true; st.tries = 0;
  st.notice = { type: why, from, to: st.current ? st.current.version : shellVersion, at: Date.now() };
}

// Called once per start by bootstrap.js. Returns { payload: <abs .asar> | null, version, trial }.
function choose(userData, shellVersion) {
  const st = readState(userData);
  if (st.pending) {
    const p = st.pending; st.pending = null;
    if (cmpVer(p.version, shellVersion) > 0 && !st.bad.includes(p.version)) {
      if (st.current && st.good) st.previous = st.current;
      st.current = p; st.good = false; st.tries = 0;
    }
  }
  // the user installed a full build that is as new as the payload: the bundled code wins
  if (st.previous && cmpVer(st.previous.version, shellVersion) <= 0) st.previous = null;
  if (st.current && cmpVer(st.current.version, shellVersion) <= 0) { st.current = st.previous; st.previous = null; st.good = true; st.tries = 0; }
  if (st.current && !st.good && st.tries >= MAX_TRIES) rollback(st, 'rollback', shellVersion);
  while (st.current && !intact(userData, st.current)) rollback(st, 'corrupt', shellVersion);
  if (st.current && !st.good) st.tries++;
  writeState(userData, st);
  return st.current
    ? { payload: payloadPath(userData, st.current), version: st.current.version, trial: !st.good }
    : { payload: null, version: shellVersion, trial: false };
}

// the payload started fine: keep it, forget older files
function markGood(userData, version) {
  const st = readState(userData);
  if (!st.current || st.current.version !== version) return false;
  if (!st.good) { st.good = true; st.tries = 0; writeState(userData, st); }
  cleanup(userData, st);
  return true;
}

// the payload threw while loading / crashed on trial: make the next start roll back right away
function reportCrash(userData, version) {
  const st = readState(userData);
  if (st.current && st.current.version === version) { st.good = false; st.tries = MAX_TRIES; writeState(userData, st); }
}

function stage(userData, entry) {
  if (!validEntry(entry)) throw new Error('payload entry không hợp lệ');
  const st = readState(userData);
  st.pending = { version: entry.version, file: entry.file, sha256: entry.sha256 };
  writeState(userData, st);
}

function takeNotice(userData) {
  const st = readState(userData);
  if (!st.notice) return null;
  const n = st.notice; st.notice = null; writeState(userData, st);
  return n;
}

function cleanup(userData, st) {
  const keep = new Set([st.current, st.previous, st.pending].filter(Boolean).map((e) => e.file));
  let names = [];
  try { names = fs.readdirSync(dirs(userData).payloads); } catch (_) { return; }
  for (const n of names) {
    if (keep.has(n) || n.endsWith('.part')) continue;   // .part = a download in progress
    try { fs.unlinkSync(path.join(dirs(userData).payloads, n)); } catch (_) { /* in use (Windows) -> next time */ }
  }
}

module.exports = { MAX_TRIES, cmpVer, parseVer, dirs, readState, writeState, sha256File, choose, markGood, reportCrash, stage, takeNotice, cleanup, fs };
