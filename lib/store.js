'use strict';
// Config (profiles, git accounts, pairs) in userData/config.json; secrets (PAT tokens) encrypted with the OS keystore
// (safeStorage: Keychain on macOS, DPAPI on Windows) in userData/secrets.json. Tokens are never exported.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    this.cfgPath = path.join(dir, 'config.json');
    this.secPath = path.join(dir, 'secrets.json');
    fs.mkdirSync(dir, { recursive: true });
    this.cfg = this._read(this.cfgPath, { version: 2, profiles: [], gitAccounts: [], pairs: [], settings: {} });
    this.cfg.profiles = this.cfg.profiles || [];
    this.cfg.gitAccounts = this.cfg.gitAccounts || [];
    this.cfg.pairs = this.cfg.pairs || [];
    this.cfg.settings = this.cfg.settings || {};
    this.sec = this._read(this.secPath, {});
  }

  _read(p, def) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return def; }
  }

  _write(p, obj) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
  }

  save() { this._write(this.cfgPath, this.cfg); }

  static id() { return crypto.randomBytes(6).toString('hex'); }

  // ---- secrets
  setToken(accId, token) {
    if (!token) { delete this.sec[accId]; this._write(this.secPath, this.sec); return; }
    if (!this.safe || !this.safe.isEncryptionAvailable()) {
      if (process.env.METATOOLS_GIT_TEST === '1') { this.sec[accId] = 'test:' + Buffer.from(token).toString('base64'); this._write(this.secPath, this.sec); return; }
      throw new Error('Máy không có kho bảo mật để cất token (Keychain/DPAPI).');
    }
    this.sec[accId] = this.safe.encryptString(token).toString('base64');
    this._write(this.secPath, this.sec);
  }

  getToken(accId) {
    const v = this.sec[accId];
    if (!v) return null;
    if (v.startsWith('test:')) return process.env.METATOOLS_GIT_TEST === '1' ? Buffer.from(v.slice(5), 'base64').toString() : null;
    try { return this.safe.decryptString(Buffer.from(v, 'base64')); } catch (_) { return null; }
  }

  hasToken(accId) { return !!this.sec[accId]; }

  // ---- export / import (no tokens, no key files)
  exportData() {
    const strip = (a) => { const { keyPath, ...rest } = a; return { ...rest, keyPath: keyPath ? '(key riêng của máy cũ, tạo lại hoặc chọn key)' : undefined }; };
    return { metatools: 2, profiles: this.cfg.profiles, gitAccounts: this.cfg.gitAccounts.map(strip), pairs: this.cfg.pairs.map(({ last, ...p }) => p) };
  }

  importData(d) {
    if (!d || d.metatools !== 2 || !Array.isArray(d.profiles)) throw new Error('File không phải dữ liệu MetaTools 2.');
    let added = 0, updated = 0;
    const merge = (list, items, clean) => {
      for (const it of items || []) {
        if (!it || !it.id) continue;
        const v = clean ? clean(it) : it;
        const i = list.findIndex((x) => x.id === it.id);
        if (i >= 0) { list[i] = { ...list[i], ...v }; updated++; } else { list.push(v); added++; }
      }
    };
    merge(this.cfg.profiles, d.profiles);
    merge(this.cfg.gitAccounts, d.gitAccounts, (a) => { const c = { ...a }; if (!c.keyPath || c.keyPath.startsWith('(')) delete c.keyPath; return c; });
    merge(this.cfg.pairs, d.pairs);
    this.save();
    return { added, updated };
  }
}

module.exports = Store;
