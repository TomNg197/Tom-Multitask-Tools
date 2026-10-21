'use strict';
// node test/update.e2e.js  -- real Electron app (Xvfb via ~/workspace/tools/elx.sh), local HTTP update server:
//   A: bundled 2.3.0 finds 2.3.1, downloads + verifies it   B: next start runs payload 2.3.1, confirms good
//   C: a broken 2.3.2 payload (throws on load) exits        D: next start is back on 2.3.1 with a rollback notice
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const asar = require('@electron/asar');
const boot = require('../lib/boot');

const ROOT = path.join(__dirname, '..');
const ELX = process.env.ELX || path.join(os.homedir(), 'workspace/tools/elx.sh');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'mt2e2e-'));
const OUT = process.env.E2E_OUT || path.join(D, 'out');
const UD = path.join(D, 'userData');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let ok = 0, tot = 0;
const chk = (n, c, x = '') => { tot++; if (c) ok++; console.log(c ? 'PASS' : 'FAIL', n, x); };

async function payloadFrom(version, patchMain) {
  const st = path.join(D, 'stage-' + version);
  const keep = /^(bootstrap\.js|main\.js|preload-.*\.js|package\.json|lib|ui|assets|test)$/;
  for (const n of fs.readdirSync(ROOT)) if (keep.test(n)) fs.cpSync(path.join(ROOT, n), path.join(st, n), { recursive: true });
  const pj = JSON.parse(fs.readFileSync(path.join(st, 'package.json'), 'utf8')); pj.version = version;
  fs.writeFileSync(path.join(st, 'package.json'), JSON.stringify(pj, null, 2));
  if (patchMain) fs.writeFileSync(path.join(st, 'main.js'), patchMain);
  const out = path.join(D, `MetaTools-payload-${version}.asar`);
  await asar.createPackage(st, out);
  return fs.readFileSync(out);
}

function runApp(step, extra = {}) {
  // E2E_CMD: run a packaged build instead (a script that starts the app binary with no app-dir argument)
  const r = spawnSync(process.env.E2E_CMD || ELX, process.env.E2E_CMD ? [] : [ROOT], {
    env: { ...process.env, METATOOLS_USERDATA: UD, METATOOLS_NO_TRAY: '1', METATOOLS_UPDATE_SELFTEST: path.join(OUT, step), METATOOLS_UPDATE_STEP: step,
      METATOOLS_UPDATE_GOOD_MS: '1500', METATOOLS_NO_RELAUNCH: '1', ...extra },
    encoding: 'utf8', timeout: 90000,
  });
  const log = (r.stdout || '') + (r.stderr || '');
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, step + '.log'), log);
  let res = [];
  try { res = JSON.parse(fs.readFileSync(path.join(OUT, step, 'result.json'), 'utf8')); } catch (_) { /* no result */ }
  return { code: r.status, log, res };
}

function report(step, r) {
  if (!r.res.length) chk(`[${step}] app produced a result`, false, r.log.split('\n').slice(-15).join('\n'));
  for (const x of r.res) chk(`[${step}] ${x.n}`, x.ok, x.x);
}

(async () => {
  const P231 = await payloadFrom('2.3.1');
  const P232 = await payloadFrom('2.3.2', "'use strict';\nthrow new Error('broken payload for the rollback test');\n");
  // spawnSync (runApp) blocks this event loop, so the update server runs in a child process
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; probe.close();
  const url = `http://127.0.0.1:${port}/metatools-update.json`;
  const child = spawn(process.execPath, ['-e', `
    const http = require('http'); const fs = require('fs');
    const P = fs.readFileSync(${JSON.stringify(path.join(D, 'MetaTools-payload-2.3.1.asar'))});
    const man = ${JSON.stringify(JSON.stringify({ schema: 1, version: '2.3.1', date: '2026-10-21', notes: 'Bản thử e2e\n- dòng 2', minShell: '2.3.0', electron: parseInt(require('electron/package.json').version, 10), payload: { url: 'MetaTools-payload-2.3.1.asar', sha256: sha(P231), size: P231.length } }))};
    http.createServer((req, res) => {
      if (req.url === '/metatools-update.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(man); return; }
      if (req.url !== '/MetaTools-payload-2.3.1.asar') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Length': P.length });
      let i = 0; const tick = () => { if (i >= P.length) { res.end(); return; } res.write(P.subarray(i, i + 65536)); i += 65536; setTimeout(tick, 5); }; tick();
    }).listen(${port}, '127.0.0.1', () => console.log('up'));`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => child.stdout.once('data', r));
  try {
    report('A', runApp('A', { METATOOLS_UPDATE_URL: url }));
    report('B', runApp('B', { METATOOLS_UPDATE_URL: url }));
    // C: stage a broken 2.3.2 by hand (as if downloaded + verified), start -> load throws -> exit 1, rollback recorded
    fs.writeFileSync(path.join(boot.dirs(UD).payloads, '2.3.2.asar'), P232);
    boot.stage(UD, { version: '2.3.2', file: '2.3.2.asar', sha256: sha(P232) });
    const c = runApp('C', { METATOOLS_UPDATE_URL: url });
    const st = boot.readState(UD);
    chk('[C] broken payload exits instead of running', c.code === 1 && /broken payload for the rollback test/.test(c.log), 'exit ' + c.code);
    chk('[C] crash recorded for rollback', st.current.version === '2.3.2' && !st.good && st.tries >= boot.MAX_TRIES, JSON.stringify(st));
    report('D', runApp('D', { METATOOLS_UPDATE_URL: url }));
  } finally {
    child.kill();
  }
  console.log(`\n${ok}/${tot} passed  (screens + logs: ${OUT})`);
  if (!process.env.E2E_OUT) fs.rmSync(D, { recursive: true, force: true });
  process.exit(ok === tot ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
