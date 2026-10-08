'use strict';
// Translate selected text with Google Translate (public web endpoints, no key). Only the text the user selected and
// explicitly asked to translate is sent. Several endpoints are tried in turn (one may be rate-limited: HTTP 429).
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('hết thời gian chờ')));
    req.on('error', reject);
  });
}

const ENDPOINTS = [
  { url: (q, tl) => `https://translate.google.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=${tl}&q=${q}`, parse: gtx },
  { url: (q, tl) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=${tl}&q=${q}`, parse: gtx },
  { url: (q, tl) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}&q=${q}`, parse: dict },
];

function gtx(body) {
  const j = JSON.parse(body);
  return { text: (j[0] || []).map((seg) => seg[0] || '').join(''), from: j[2] || 'auto' };
}

function dict(body) {
  const j = JSON.parse(body);
  // [["text","vi"]]  or  ["text"]  or [["seg1"],["seg2"]] depending on input
  const parts = Array.isArray(j) ? j.map((x) => (Array.isArray(x) ? x[0] : x)) : [];
  const from = Array.isArray(j[0]) && j[0][1] ? j[0][1] : 'auto';
  return { text: parts.join(''), from };
}

async function translate(text, target = 'en') {
  const raw = String(text || '').trim().slice(0, 4500);
  if (!raw) throw new Error('Chưa chọn đoạn chữ nào.');
  const q = encodeURIComponent(raw);
  const tl = encodeURIComponent(target);
  let lastErr = '';
  for (const ep of ENDPOINTS) {
    try {
      const r = await get(ep.url(q, tl));
      if (r.status !== 200) { lastErr = `HTTP ${r.status}`; continue; }
      const out = ep.parse(r.body);
      if (out.text) return { text: out.text, from: out.from, to: target, source: raw };
      lastErr = 'kết quả rỗng';
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(`Google Dịch đang không phản hồi (${lastErr}). Thử lại sau ít phút.`);
}

module.exports = { translate };
