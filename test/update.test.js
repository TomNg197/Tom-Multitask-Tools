'use strict';
// node test/update.test.js  -- in-app updater: version compare, manifest parsing, download + sha256 verify (local HTTP
// server), boot choice, markGood, rollback, cleanup. Temp dirs only.
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
const asar = require('@electron/asar');
const boot = require('../lib/boot');
const U = require('../lib/updater');
const FAKE = require('./fake-update-server');

let ok = 0, tot = 0;
const chk = (n, c, x = '') => { tot++; if (c) ok++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const rejects = async (p, re) => { try { await p; return false; } catch (e) { if (!re.test(e.message)) console.log('   got:', e.message); return re.test(e.message); } };
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'mt2upd-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function makePayload(version, name = 'metatools', withMain = true) {
  const src = fs.mkdtempSync(path.join(D, 'src-'));
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name, version, main: 'bootstrap.js' }));
  if (withMain) fs.writeFileSync(path.join(src, 'main.js'), `module.exports = ${JSON.stringify(version)};`);
  fs.mkdirSync(path.join(src, 'ui')); fs.writeFileSync(path.join(src, 'ui', 'index.html'), '<p>' + 'x'.repeat(200000) + '</p>');
  const out = path.join(D, `p-${version}-${crypto.randomBytes(3).toString('hex')}.asar`);
  await asar.createPackage(src, out);
  return fs.readFileSync(out);
}

(async () => {
  // ---- versions
  chk('cmpVer basic', boot.cmpVer('2.3.0', '2.2.9') > 0 && boot.cmpVer('2.10.0', '2.9.0') > 0 && boot.cmpVer('v2.3.0', '2.3.0') === 0);
  chk('cmpVer prerelease < release', boot.cmpVer('2.3.0-beta.1', '2.3.0') < 0 && boot.cmpVer('2.3.1-beta.1', '2.3.0') > 0);
  chk('cmpVer invalid sorts lowest', boot.cmpVer('abc', '0.0.1') < 0);

  // ---- manifest parsing
  const base = 'https://example.com/rel/latest/metatools-update.json';
  const good = { schema: 1, version: '2.3.1', notes: 'n', payload: { url: 'MetaTools-payload-2.3.1.asar', sha256: 'a'.repeat(64), size: 10 }, full: { 'win32-x64': 'https://x/y.zip', 'darwin-arm64': 'http://evil/z.zip' } };
  const m = U.parseManifest(good, base);
  chk('manifest relative url resolved', m.payload.url === 'https://example.com/rel/latest/MetaTools-payload-2.3.1.asar', m.payload.url);
  chk('manifest drops non-https full link', m.full['win32-x64'] && !m.full['darwin-arm64']);
  chk('manifest rejects bad sha256', throws(() => U.parseManifest({ ...good, payload: { ...good.payload, sha256: 'xyz' } }, base), /sha256/));
  chk('manifest rejects missing version', throws(() => U.parseManifest({ ...good, version: 'latest' }, base), /version/));
  chk('manifest rejects http payload (non-local)', throws(() => U.parseManifest({ ...good, payload: { ...good.payload, url: 'http://evil.com/p.asar' } }, base), /https/));
  chk('manifest accepts http on localhost', U.parseManifest({ ...good, payload: { ...good.payload, url: 'http://127.0.0.1:9/p.asar' } }, base).payload.url.startsWith('http://127.0.0.1'));
  chk('manifest rejects unknown schema', throws(() => U.parseManifest({ ...good, schema: 2 }, base), /schema/));
  chk('manifest rejects silly size', throws(() => U.parseManifest({ ...good, payload: { ...good.payload, size: -5 } }, base), /size/));

  // ---- local HTTP server
  const P231 = await makePayload('2.3.1');
  const P232 = await makePayload('2.3.2');
  const routes = {};
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    const r = routes[req.url];
    if (!r) { res.writeHead(404); res.end('nope'); return; }
    if (r.redirect) { res.writeHead(302, { Location: r.redirect }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': r.type || 'application/octet-stream', 'Content-Length': r.body.length });
    res.end(r.body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const H = `http://127.0.0.1:${srv.address().port}`;
  const man = (o) => Buffer.from(JSON.stringify(o));
  routes['/p231.asar'] = { body: P231 };
  routes['/dl/p231'] = { redirect: '/p231.asar' };
  routes['/m.json'] = { body: man({ schema: 1, version: '2.3.1', minShell: '2.3.0', electron: 44, notes: 'Bản thử', payload: { url: '/dl/p231', sha256: sha(P231), size: P231.length }, full: { 'win32-x64': 'https://example.com/w.zip' } }) };
  const env = { currentVersion: '2.3.0', shellVersion: '2.3.0', electronMajor: 44, platform: 'win32', arch: 'x64', bad: [] };
  const o = { url: H + '/m.json', fetch: globalThis.fetch };

  let c = await U.check(env, o);
  chk('check: available', c.status === 'available' && c.manifest.version === '2.3.1' && c.fullUrl === 'https://example.com/w.zip', c.status);
  chk('check: latest when same version', (await U.check({ ...env, currentVersion: '2.3.1' }, o)).status === 'latest');
  chk('check: needFull when shell too old', (await U.check({ ...env, shellVersion: '2.2.0' }, o)).status === 'needFull');
  chk('check: needFull when Electron major differs', (await U.check({ ...env, electronMajor: 45 }, o)).status === 'needFull');
  chk('check: bad version not offered again', (await U.check({ ...env, bad: ['2.3.1'] }, o)).status === 'bad');
  chk('check: 404 gives a clear message', await rejects(U.check(env, { ...o, url: H + '/none.json' }), /404/));
  routes['/junk.json'] = { body: Buffer.from('<html>') };
  chk('check: non-JSON manifest rejected', await rejects(U.check(env, { ...o, url: H + '/junk.json' }), /JSON/));

  // ---- download + verify
  const UD = path.join(D, 'userData');
  const prog = [];
  const entry = await U.download(c.manifest, UD, { fetch: globalThis.fetch, onProgress: (p) => prog.push(p) });
  const dl = path.join(boot.dirs(UD).payloads, '2.3.1.asar');
  chk('download follows redirect + writes payload', fs.existsSync(dl) && sha(fs.readFileSync(dl)) === sha(P231));
  chk('download progress reported', prog.length > 0 && prog[prog.length - 1].got === P231.length && prog[prog.length - 1].total === P231.length, prog.length);
  chk('download staged as pending', boot.readState(UD).pending && boot.readState(UD).pending.version === '2.3.1' && entry.sha256 === sha(P231));
  chk('payload inspect reads version', U.inspectPayload(dl).version === '2.3.1');

  // sha mismatch / size / wrong content -> refused, nothing staged
  const UD2 = path.join(D, 'userData2');
  const tampered = Buffer.from(P231); tampered[tampered.length - 5] ^= 0xff;
  routes['/t.asar'] = { body: tampered };
  const mm = (o2) => U.parseManifest({ version: '2.3.1', payload: { url: H + '/t.asar', sha256: sha(P231), size: P231.length, ...o2 } }, H);
  chk('sha256 mismatch refused', await rejects(U.download(mm({}), UD2, { fetch: globalThis.fetch }), /sha256/));
  chk('mismatch: no file, nothing staged', !fs.existsSync(path.join(boot.dirs(UD2).payloads, '2.3.1.asar')) && !fs.existsSync(path.join(boot.dirs(UD2).payloads, '2.3.1.asar.part')) && !boot.readState(UD2).pending);
  routes['/short.asar'] = { body: P231.subarray(0, 1000) };
  chk('short download refused', await rejects(U.download(mm({ url: H + '/short.asar' }), UD2, { fetch: globalThis.fetch }), /Tải thiếu/));
  chk('oversize download refused', await rejects(U.download(mm({ url: H + '/p231.asar', size: 1000, sha256: sha(P231) }), UD2, { fetch: globalThis.fetch }), /lớn hơn/));
  const NOMAIN = await makePayload('2.3.1', 'metatools', false);
  routes['/nomain.asar'] = { body: NOMAIN };
  chk('payload without main.js refused', await rejects(U.download(mm({ url: H + '/nomain.asar', sha256: sha(NOMAIN), size: NOMAIN.length }), UD2, { fetch: globalThis.fetch }), /main\.js/));
  const OTHER = await makePayload('2.3.1', 'not-metatools');
  routes['/other.asar'] = { body: OTHER };
  chk('payload of another app refused', await rejects(U.download(mm({ url: H + '/other.asar', sha256: sha(OTHER), size: OTHER.length }), UD2, { fetch: globalThis.fetch }), /Payload không đúng/));
  chk('payload whose version differs from manifest refused', await rejects(U.download(U.parseManifest({ version: '2.3.5', payload: { url: H + '/p231.asar', sha256: sha(P231), size: P231.length } }, H), UD2, { fetch: globalThis.fetch }), /Payload không đúng/));
  routes['/notasar'] = { body: Buffer.from('hello world, definitely not an asar file') };
  chk('non-asar file refused', await rejects(U.download(mm({ url: H + '/notasar', sha256: sha(routes['/notasar'].body), size: routes['/notasar'].body.length }), UD2, { fetch: globalThis.fetch }), /asar/));
  chk('still nothing staged after all refusals', !boot.readState(UD2).pending);

  // ---- boot: pending -> trial -> good
  let b = boot.choose(UD, '2.3.0');
  chk('boot: pending promoted, on trial', b.payload === dl && b.version === '2.3.1' && b.trial && boot.readState(UD).tries === 1);
  chk('boot: markGood', boot.markGood(UD, '2.3.1') && boot.readState(UD).good && boot.readState(UD).tries === 0);
  b = boot.choose(UD, '2.3.0');
  chk('boot: good payload stays, no trial', b.version === '2.3.1' && !b.trial && boot.readState(UD).tries === 0);

  // ---- second update 2.3.2 crashes twice before markGood -> back to 2.3.1
  routes['/p232.asar'] = { body: P232 };
  await U.download(U.parseManifest({ version: '2.3.2', payload: { url: H + '/p232.asar', sha256: sha(P232), size: P232.length } }, H), UD, { fetch: globalThis.fetch });
  b = boot.choose(UD, '2.3.0');
  chk('boot: 2.3.2 on trial, 2.3.1 kept as previous', b.version === '2.3.2' && b.trial && boot.readState(UD).previous.version === '2.3.1');
  b = boot.choose(UD, '2.3.0');   // 2nd start, still not confirmed
  chk('boot: second try allowed', b.version === '2.3.2' && boot.readState(UD).tries === 2);
  b = boot.choose(UD, '2.3.0');   // 3rd start -> roll back
  let st = boot.readState(UD);
  chk('boot: rollback after MAX_TRIES', b.version === '2.3.1' && !b.trial && st.bad.includes('2.3.2') && st.notice && st.notice.type === 'rollback' && st.notice.to === '2.3.1', JSON.stringify(st.notice));
  chk('boot: notice taken once', boot.takeNotice(UD).from === '2.3.2' && boot.takeNotice(UD) === null);
  boot.stage(UD, { version: '2.3.2', file: '2.3.2.asar', sha256: sha(P232) });
  chk('boot: bad version never promoted again', boot.choose(UD, '2.3.0').version === '2.3.1');

  // ---- reportCrash (payload threw while loading) -> immediate rollback to the shell
  const UD3 = path.join(D, 'userData3');
  await U.download(c.manifest, UD3, { fetch: globalThis.fetch });
  b = boot.choose(UD3, '2.3.0');
  boot.reportCrash(UD3, '2.3.1');
  b = boot.choose(UD3, '2.3.0');
  chk('boot: crash on load -> bundled shell next start', b.payload === null && b.version === '2.3.0' && boot.readState(UD3).bad.includes('2.3.1'));

  // ---- corrupted payload on disk -> fallback
  const UD4 = path.join(D, 'userData4');
  await U.download(c.manifest, UD4, { fetch: globalThis.fetch });
  boot.choose(UD4, '2.3.0'); boot.markGood(UD4, '2.3.1');
  fs.appendFileSync(path.join(boot.dirs(UD4).payloads, '2.3.1.asar'), 'x');
  b = boot.choose(UD4, '2.3.0');
  chk('boot: corrupted payload not loaded', b.payload === null && boot.readState(UD4).notice.type === 'corrupt');

  // ---- user installed a newer full build: payload ignored
  const UD5 = path.join(D, 'userData5');
  await U.download(c.manifest, UD5, { fetch: globalThis.fetch });
  b = boot.choose(UD5, '2.4.0');
  chk('boot: newer shell wins over older payload', b.payload === null && b.version === '2.4.0');

  // ---- state file broken / missing -> bundled app
  const UD6 = path.join(D, 'userData6');
  fs.mkdirSync(boot.dirs(UD6).root, { recursive: true }); fs.writeFileSync(boot.dirs(UD6).state, '{broken');
  chk('boot: broken state file -> bundled', boot.choose(UD6, '2.3.0').payload === null);
  fs.writeFileSync(boot.dirs(UD6).state, JSON.stringify({ current: { version: '9.9.9', file: '../../evil.asar', sha256: 'a'.repeat(64) } }));
  chk('boot: path traversal in state ignored', boot.choose(UD6, '2.3.0').payload === null);

  // ---- cleanup keeps current/previous/pending only
  fs.writeFileSync(path.join(boot.dirs(UD).payloads, '2.0.0.asar'), 'old');
  boot.cleanup(UD, boot.readState(UD));
  const left = fs.readdirSync(boot.dirs(UD).payloads).sort();
  chk('cleanup removes unreferenced payloads', !left.includes('2.0.0.asar') && left.includes('2.3.1.asar'), left.join(','));

  // ---- env override of the manifest URL
  process.env.METATOOLS_UPDATE_URL = H + '/m.json';
  chk('manifest URL env override', U.manifestUrl() === H + '/m.json');
  delete process.env.METATOOLS_UPDATE_URL;
  chk('default = public release asset of the app repo, no token', U.manifestUrl() === 'https://github.com/TomNg197/Tom-Multitask-Tools/releases/latest/download/metatools-update.json');

  // ---- optional private-repo fallback against a fake GitHub API (public manifest 404 -> API with token, 302 -> other host)
  const TOKEN = 'github_pat_TESTONLY_0123456789abcdef';
  const F = await FAKE.start({ payload: P231, version: '2.3.1', token: TOKEN });
  process.env.METATOOLS_GH_API = F.api;
  const PRIV = F.api + '/private/metatools-update.json';   // answers 404 like a private repo's public download URL
  const go = { url: PRIV, token: TOKEN, fetch: globalThis.fetch };
  c = await U.check(env, go);
  chk('gh: latest release found, available', c.status === 'available' && c.manifest.version === '2.3.1' && c.manifest.payload.github, c.status);
  chk('gh: payload url = asset API url', c.manifest.payload.url === `${F.api}/repos/${FAKE.REPO}/releases/assets/2`, c.manifest.payload.url);
  chk('gh: full link = release page', c.fullUrl === `https://github.com/${FAKE.REPO}/releases/tag/v2.3.1`, c.fullUrl);
  const UDG = path.join(D, 'userDataG');
  await U.download(c.manifest, UDG, go);
  chk('gh: payload downloaded through 302 + staged', boot.readState(UDG).pending && boot.readState(UDG).pending.version === '2.3.1' && sha(fs.readFileSync(path.join(boot.dirs(UDG).payloads, '2.3.1.asar'))) === sha(P231));
  chk('gh: redirect host reached (manifest + payload)', F.seen.filter((e) => e.host === 'cdn').length >= 2);
  chk('gh: Authorization NEVER sent to the redirect host', F.seen.filter((e) => e.host === 'cdn').every((e) => !e.auth), JSON.stringify(F.seen.filter((e) => e.host === 'cdn')));
  chk('gh: Authorization sent to the API host', F.seen.filter((e) => e.host === 'api' && e.path.startsWith('/repos/')).every((e) => e.auth));
  F.seen.length = 0;
  const br = await U.ghGet(`${F.cdn.replace('localhost', '127.0.0.1')}/x`, TOKEN, 'x').then(() => false, (e) => /Chặn/.test(e.message));
  chk('gh: refuses to send the token to a non-API host', br && F.seen.length === 0);
  const bounce = await U.ghGet(`${F.api}/repos/${FAKE.REPO}/releases/assets/9`, TOKEN, 'x').catch((e) => e);
  chk('gh: 404 asset -> token message', bounce instanceof Error && new RegExp(U.BAD_TOKEN).test(bounce.message), bounce && bounce.message);
  const resB = await U.ghGet(`${F.api}/repos/${FAKE.REPO}/releases/latest`, TOKEN, 'application/vnd.github+json');
  chk('gh: release JSON readable with token', resB.ok);
  F.seen.length = 0;
  // simulate a hop api -> cdn/bounce -> api: last hop must be unauthenticated (fake returns 404 without token)
  const fakeFetch = (u, o2) => (u.endsWith('/releases/assets/7')
    ? Promise.resolve(new Response(null, { status: 302, headers: { Location: `${F.cdn}/bounce` } })) : globalThis.fetch(u, o2));
  const rb = await U.ghGet(`${F.api}/repos/${FAKE.REPO}/releases/assets/7`, TOKEN, 'application/octet-stream', { fetch: fakeFetch });
  chk('gh: after leaving the API host the token is not re-sent', F.seen.length >= 2 && F.seen.every((e) => !e.auth) && rb.status === 404, JSON.stringify(F.seen));
  chk('gh: 404 without token -> hint to add a token', await rejects(U.check(env, { url: PRIV, fetch: globalThis.fetch }), /404.*token/));
  chk('gh: wrong token -> "Token không đọc được repo"', await rejects(U.check(env, { url: PRIV, token: 'github_pat_WRONG_000000000000', fetch: globalThis.fetch }), new RegExp(U.BAD_TOKEN)));
  F.seen.length = 0;
  const pub = await U.check(env, { url: F.manifestUrl, token: TOKEN, fetch: globalThis.fetch });
  chk('public manifest works and the token is not used for it', pub.status === 'available' && !pub.manifest.payload.github && F.seen.every((e) => !e.auth), JSON.stringify(F.seen));
  const F2 = await FAKE.start({ payload: P231, version: '2.3.1', token: TOKEN, noManifestAsset: true });
  process.env.METATOOLS_GH_API = F2.api;
  chk('gh: release without manifest asset -> clear error', await rejects(U.check(env, { ...go, url: F2.api + '/private/m.json' }), /chưa có metatools-update\.json/));
  const F3 = await FAKE.start({ payload: P231, version: '2.3.1', token: TOKEN, sha256: 'b'.repeat(64) });
  process.env.METATOOLS_GH_API = F3.api;
  const c3 = await U.check(env, { ...go, url: F3.api + '/private/m.json' });
  const UDG3 = path.join(D, 'userDataG3');
  chk('gh: sha256 mismatch still refused', await rejects(U.download(c3.manifest, UDG3, go), /sha256/) && !boot.readState(UDG3).pending);
  const seenAll = [...F.seen, ...F2.seen, ...F3.seen];
  chk('gh: token never in any request path', seenAll.every((e) => !e.path.includes(TOKEN)));
  [F, F2, F3].forEach((x) => x.close());
  delete process.env.METATOOLS_GH_API;

  srv.close();
  fs.rmSync(D, { recursive: true, force: true });
  console.log(`\n${ok}/${tot} passed`);
  process.exit(ok === tot ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
