'use strict';
// Township Team accounts, Teduh admin login and signed login tokens. No npm packages.
//
// An account is one row in the reports table (so it lives wherever reports live):
//   type 'Team account', edge_id "acct-<username>", note = JSON { p: password hash, s: salt, i: staff ID hash, e: organisation email }
// The newest row for a username wins (a password change adds a row). Staff ID and email are unique across accounts.
// Nothing here ever leaves the server: lib/store.js hides these rows from /api/state.

const crypto = require('crypto');

const USER_RE = /^[a-z][a-z0-9_.]{3,19}$/;
const STAFF_RE = /^[A-Za-z0-9-]{4,20}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,40}@[A-Za-z0-9.-]{1,38}\.[A-Za-z]{2,}$/;
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.my', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'mail.com', 'gmx.com', 'yandex.com', 'qq.com', '163.com'];
const TOKEN_HOURS = 12, RESET_MINUTES = 30;

function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function same(a, b) { const x = sha(a), y = sha(b); return crypto.timingSafeEqual(x, y); }

function hashPassword(pw, salt) {
  salt = salt || b64(crypto.randomBytes(16));
  const h = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return { p: b64(h), s: salt };
}
function checkPassword(pw, acct) {
  const h = crypto.scryptSync(String(pw), acct.s, 32, { N: 16384, r: 8, p: 1 });
  const real = Buffer.from(acct.p, 'base64url');
  return real.length === h.length && crypto.timingSafeEqual(real, h);
}
function staffHash(id) { return b64(sha('staff:' + String(id).toUpperCase())).slice(0, 22); }

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use a password of at least 8 characters.';
  if (pw.length > 100) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number in the password.';
  return '';
}

function createAuth(cfg) {
  const secret = cfg.auth.secret || crypto.randomBytes(32).toString('hex');
  const admin = { user: cfg.auth.adminUser, pass: cfg.auth.adminPass };

  function sign(obj) {
    const body = b64(JSON.stringify(obj));
    return body + '.' + b64(crypto.createHmac('sha256', secret).update(body).digest());
  }
  function open(tok) {
    if (typeof tok !== 'string' || tok.length > 600) return null;
    const i = tok.indexOf('.');
    if (i < 1) return null;
    const body = tok.slice(0, i), mac = tok.slice(i + 1);
    const good = b64(crypto.createHmac('sha256', secret).update(body).digest());
    if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
    try {
      const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return o && o.x > Date.now() ? o : null;
    } catch (e) { return null; }
  }

  // The accounts as they are right now, from the stored rows
  function accounts(rows) {
    const by = {};
    rows.forEach(function (r) {
      if (r.type !== 'Team account' || !/^acct-/.test(r.edgeId || '')) return;
      let j; try { j = JSON.parse(r.note); } catch (e) { return; }
      if (!j || !j.p || !j.s || !j.i || !j.e) return;
      const u = r.edgeId.slice(5);
      if (!by[u] || (r.at || 0) >= by[u].at) by[u] = { user: u, p: j.p, s: j.s, i: j.i, e: j.e, at: r.at || 0 };
    });
    return by;
  }

  function emailProblem(email) {
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Enter your organisation email address.';
    const dom = email.trim().toLowerCase().split('@')[1];
    if (cfg.auth.emailDomains.length) {
      if (!cfg.auth.emailDomains.some(function (d) { return dom === d || dom.endsWith('.' + d); })) return 'Use your organisation email address (' + cfg.auth.emailDomains.map(function (d) { return '@' + d; }).join(', ') + ').';
    } else if (FREE_MAIL.indexOf(dom) !== -1) return 'Use your organisation email address, not a personal one.';
    return '';
  }

  // Checks a sign-up and returns the row to store, or { error }
  function makeAccountRow(b, rows) {
    const user = String(b && b.username || '').trim().toLowerCase();
    if (!USER_RE.test(user)) return { error: 'Choose a username of 4 to 20 characters: letters, numbers, dot or underscore, starting with a letter.' };
    if (admin.user && user === admin.user.toLowerCase()) return { error: 'That username is taken.' };
    const staff = String(b.staffId || '').trim();
    if (!STAFF_RE.test(staff)) return { error: 'Enter your staff ID (4 to 20 letters, numbers or dashes).' };
    const ep = emailProblem(b.email); if (ep) return { error: ep };
    const email = String(b.email).trim().toLowerCase();
    const pp = passwordProblem(b.password); if (pp) return { error: pp };
    const all = accounts(rows), list = Object.keys(all).map(function (k) { return all[k]; });
    if (all[user]) return { error: 'That username is taken.' };
    if (list.some(function (a) { return a.i === staffHash(staff); })) return { error: 'An account already exists for this staff ID. To change or remove it, message the Teduh admin team.' };
    if (list.some(function (a) { return a.e === email; })) return { error: 'An account already exists for this email address. To change or remove it, message the Teduh admin team.' };
    const h = hashPassword(b.password);
    return { user: user, row: { edgeId: 'acct-' + user, type: 'Team account', note: JSON.stringify({ p: h.p, s: h.s, i: staffHash(staff), e: email }), lat: null, lon: null, ai: null, at: Date.now() } };
  }
  function passwordRow(acct, pw) {
    const h = hashPassword(pw);
    return { edgeId: 'acct-' + acct.user, type: 'Team account', note: JSON.stringify({ p: h.p, s: h.s, i: acct.i, e: acct.e }), lat: null, lon: null, ai: null, at: Date.now() };
  }

  function login(username, password, rows) {
    const user = String(username || '').trim().toLowerCase();
    if (admin.pass && admin.user && user === admin.user.toLowerCase()) {
      if (same(password, admin.pass)) return { token: sign({ u: user, r: 'admin', x: Date.now() + TOKEN_HOURS * 3600000 }), role: 'admin', username: user };
      return null;
    }
    const a = accounts(rows)[user];
    if (!a) { hashPassword(String(password), 'AAAAAAAAAAAAAAAAAAAAAA'); return null; }   // same work either way
    if (!checkPassword(password, a)) return null;
    return { token: sign({ u: user, r: 'team', x: Date.now() + TOKEN_HOURS * 3600000 }), role: 'team', username: user };
  }
  // Who is asking? Team tokens only count while the account still exists.
  function who(tok, rows) {
    const o = open(tok);
    if (!o || o.t) return null;
    if (o.r === 'admin') return admin.pass && admin.user && o.u === admin.user.toLowerCase() ? { username: o.u, role: 'admin' } : null;
    if (o.r === 'team') return accounts(rows)[o.u] ? { username: o.u, role: 'team' } : null;
    return null;
  }
  function resetToken(acct) {
    return sign({ t: 'reset', u: acct.user, f: b64(sha(acct.p)).slice(0, 10), x: Date.now() + RESET_MINUTES * 60000 });
  }
  // Valid once: after the password changes, the fingerprint no longer matches
  function readReset(tok, rows) {
    const o = open(tok);
    if (!o || o.t !== 'reset') return null;
    const a = accounts(rows)[o.u];
    return a && b64(sha(a.p)).slice(0, 10) === o.f ? a : null;
  }
  function byEmail(email, rows) {
    const e = String(email || '').trim().toLowerCase(), all = accounts(rows);
    const k = Object.keys(all).filter(function (u) { return all[u].e === e; })[0];
    return k ? all[k] : null;
  }
  function publicList(rows) {
    const all = accounts(rows);
    return Object.keys(all).sort().map(function (u) { return { username: u, email: all[u].e, since: all[u].at }; });
  }

  return { makeAccountRow: makeAccountRow, passwordRow: passwordRow, login: login, who: who, resetToken: resetToken, readReset: readReset, byEmail: byEmail, publicList: publicList, accounts: accounts, passwordProblem: passwordProblem, adminEnabled: !!(admin.user && admin.pass) };
}

module.exports = { createAuth: createAuth, USER_RE: USER_RE };
