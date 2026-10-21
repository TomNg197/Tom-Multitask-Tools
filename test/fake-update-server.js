'use strict';
// Fake update servers for the updater tests:
//   api  (127.0.0.1)  GitHub-like: /repos/<repo>/releases/latest (needs "Bearer <token>"), asset URLs answer 302 -> cdn
//   cdn  (localhost)  "signed storage": serves the files, records whether an Authorization header ever reached it
//   /pub/metatools-update.json + /pub/<payload> on api: public manifest mode (no token)
// Module: start({ payload, version, token, electron, minShell, noManifestAsset }) -> { api, cdn, manifestUrl, seen, close }
// CLI (e2e): node test/fake-update-server.js <payload.asar> <version> <token> <seenLogFile>  -> prints {api, manifestUrl}
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const REPO = 'TomNg197/Tom-Multitask-Tools';

function listen(srv, host) { return new Promise((r) => srv.listen(0, host, () => r(srv.address().port))); }

async function start(o) {
  const seen = [];   // { host: 'api'|'cdn', path, auth }
  const log = (e) => { seen.push(e); if (o.seenFile) fs.appendFileSync(o.seenFile, JSON.stringify(e) + '\n'); };
  const name = `MetaTools-payload-${o.version}.asar`;
  const manifest = () => Buffer.from(JSON.stringify({
    schema: 1, version: o.version, date: '2026-10-21', notes: o.notes || `Bản thử ${o.version}`, minShell: o.minShell || '2.3.0', electron: o.electron || 44,
    payload: { url: `https://github.com/${REPO}/releases/download/v${o.version}/${name}`, sha256: o.sha256 || crypto.createHash('sha256').update(o.payload).digest('hex'), size: o.payload.length },
  }));
  const files = { 1: manifest, 2: () => o.payload };
  let api = ''; let cdn = '';
  const send = (res, body, type) => {
    res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Content-Length': body.length });
    let i = 0; const tick = () => { if (i >= body.length) { res.end(); return; } res.write(body.subarray(i, i + 65536)); i += 65536; setImmediate(tick); }; tick();
  };
  const A = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    log({ host: 'api', path: req.url, auth: !!auth });
    if (req.url === '/pub/metatools-update.json') { const m = JSON.parse(manifest()); m.payload.url = name; send(res, Buffer.from(JSON.stringify(m)), 'application/json'); return; }
    if (req.url === `/pub/${name}`) { send(res, o.payload); return; }
    if (req.url.startsWith(`/repos/${REPO}/`) && auth !== `Bearer ${o.token}`) { res.writeHead(auth ? 401 : 404, { 'Content-Type': 'application/json' }); res.end('{"message":"Bad credentials"}'); return; }
    if (req.url === `/repos/${REPO}/releases/latest`) {
      const assets = [{ id: 2, name, url: `${api}/repos/${REPO}/releases/assets/2` }];
      if (!o.noManifestAsset) assets.push({ id: 1, name: 'metatools-update.json', url: `${api}/repos/${REPO}/releases/assets/1` });
      send(res, Buffer.from(JSON.stringify({ tag_name: `v${o.version}`, html_url: `https://github.com/${REPO}/releases/tag/v${o.version}`, assets })), 'application/json');
      return;
    }
    const m = /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/.exec(req.url);
    if (m && files[m[1]] && req.headers.accept === 'application/octet-stream') {
      res.writeHead(302, { Location: `${cdn}/s3/${m[1]}?X-Amz-Signature=abc` }); res.end(); return;
    }
    res.writeHead(404); res.end();
  });
  const C = http.createServer((req, res) => {
    log({ host: 'cdn', path: req.url, auth: !!req.headers.authorization });
    const m = /^\/s3\/(\d+)\?/.exec(req.url);
    if (req.url.startsWith('/bounce')) { res.writeHead(302, { Location: `${api}/repos/${REPO}/releases/assets/2` }); res.end(); return; }
    if (!m || !files[m[1]]) { res.writeHead(404); res.end(); return; }
    send(res, files[m[1]]());
  });
  api = `http://127.0.0.1:${await listen(A, '127.0.0.1')}`;
  cdn = `http://localhost:${await listen(C)}`;   // other host name than the API (and dual-stack for "localhost")
  return { api, cdn, manifestUrl: `${api}/pub/metatools-update.json`, seen, close: () => { A.close(); C.close(); } };
}

module.exports = { start, REPO };

if (require.main === module) {
  const [payload, version, token, seenFile] = process.argv.slice(2);
  start({ payload: fs.readFileSync(payload), version, token, seenFile, electron: parseInt(require('electron/package.json').version, 10) })
    .then((s) => console.log(JSON.stringify({ api: s.api, manifestUrl: s.manifestUrl })));
}
