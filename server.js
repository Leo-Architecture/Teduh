'use strict';
// Teduh server. No npm packages needed, just Node 18 or newer.
//   - serves the page in /public
//   - builds a real township map for any place in Malaysia (lib/geo.js)
//   - stores resident reports, shared between devices (lib/store.js)
//   - signs the township team and the Teduh admin team in, fetches live weather, and talks to the AI (lib/weather.js, lib/ai.js)
// Settings and keys come from the .env file (see .env.example).

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const cfg = require('./lib/config');
const { HttpError } = require('./lib/http');
const { createStore } = require('./lib/store');
const { createGeoService } = require('./lib/geo');
const { createWeather } = require('./lib/weather');
const { createAi } = require('./lib/ai');
const { createAuth } = require('./lib/auth');
const { createMail } = require('./lib/mail');

const store = createStore(cfg);
const geo = createGeoService(cfg);
const weather = createWeather(cfg);
const ai = createAi(cfg);
const auth = createAuth(cfg);
const mail = createMail(cfg);
const MEDIA_DIR = path.join(cfg.dataDir, 'media');
const MEDIA_RE = /^m[a-f0-9]{16}\.(jpg|png|webp|mp4|webm)$/;
const IMAGE_MAX = 3 * 1024 * 1024, VIDEO_MAX = 20 * 1024 * 1024, MEDIA_FILES_MAX = 400;

const REPORT_TYPES = ['Blocked drain', 'Flooded road', 'Water rising', 'Standing water', 'Fallen branch'];
const paths = require('./lib/paths');
const EDGE_ID_RE = /^[A-Za-z0-9:_.\-]{1,80}$/;
const SMALL_BODY = 12 * 1024;
const PHOTO_BODY = 1.6 * 1024 * 1024;

// ---------- helpers ----------

function send(req, res, status, body, extra) {
  const isText = typeof body === 'string';
  let data = Buffer.from(isText ? body : JSON.stringify(body));
  const headers = Object.assign({
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {});
  if (data.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    data = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
}

function readJson(req, max) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'That is too large to send')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clientId(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now);
  hits.set(key, list);
  return false;
}
setInterval(function () { hits.clear(); }, 10 * 60 * 1000).unref();
function guard(req, name, max, windowMs) {
  if (limited(name + ':' + clientId(req), max, windowMs)) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
}

// Who is asking? Township Team and admin sign in and send their token as "Authorization: Bearer ...".
async function requireRole(req, roles) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  const who = m ? auth.who(m[1], await store.all()) : null;
  if (!who) throw new HttpError(401, 'Please sign in on the Township Team page.');
  if (roles.indexOf(who.role) === -1) throw new HttpError(403, roles[0] === 'admin' ? 'Only the Teduh admin team can do this.' : 'Only the Township Team can do this.');
  return who;
}

function readRaw(req, max) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'That file is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}
// What kind of file is it really? Look at the first bytes, not the name.
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', video: false };
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { ext: 'png', video: false };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', video: false };
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') return { ext: 'mp4', video: true };
  if (buf.length > 12 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', video: true };
  return null;
}
function originOf(req) {
  if (cfg.auth.publicUrl) return cfg.auth.publicUrl;
  const host = String(req.headers.host || 'localhost:' + cfg.port);
  const proto = /^https?$/.test(String(req.headers['x-forwarded-proto'] || '')) ? req.headers['x-forwarded-proto'] : 'http';
  return /^[A-Za-z0-9.\-:]{1,80}$/.test(host) ? proto + '://' + host : 'http://localhost:' + cfg.port;
}

function num(v) {
  if (v === undefined || v === null || v === '') return NaN;
  return Number(v);
}
function cleanNote(s) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  const q = url.searchParams;

  if (route === 'GET /api/health') return send(req, res, 200, { ok: true });
  if (route === 'GET /api/config') return send(req, res, 200, cfg.publicConfig());
  if (req.method === 'GET' && /^\/api\/media\//.test(url.pathname)) {
    const name = url.pathname.slice(11);
    if (!MEDIA_RE.test(name)) throw new HttpError(404, 'Not found');
    let buf; try { buf = fs.readFileSync(path.join(MEDIA_DIR, name)); } catch (e) { throw new HttpError(404, 'Not found'); }
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' }[name.split('.')[1]];
    return sendBuffer(req, res, buf, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  }
  if (route === 'GET /api/state') return send(req, res, 200, await store.state());

  if (route === 'GET /api/geocode') {
    guard(req, 'geo', 20, 60 * 1000);
    return send(req, res, 200, { results: await geo.geocode(q.get('q')) });
  }

  if (route === 'GET /api/township') {
    let lat = num(q.get('lat')), lon = num(q.get('lon')), name = q.get('name') || '';
    const radius = num(q.get('r')) || cfg.township.radius;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (q.get('q')) {
        guard(req, 'geo', 20, 60 * 1000);
        const hit = (await geo.geocode(q.get('q')))[0];
        if (!hit) throw new HttpError(404, 'Could not find that place in Malaysia');
        lat = hit.lat; lon = hit.lon; name = name || hit.name;
      } else if (cfg.township.lat !== null && cfg.township.lon !== null) {
        lat = cfg.township.lat; lon = cfg.township.lon; name = name || cfg.township.name;
      } else {
        guard(req, 'geo', 20, 60 * 1000);
        const hit = (await geo.geocode(cfg.township.name))[0];
        if (!hit) throw new HttpError(404, 'Could not find "' + cfg.township.name + '". Check TOWNSHIP_NAME in the .env file.');
        lat = hit.lat; lon = hit.lon; name = name || cfg.township.name;
      }
    }
    if (!geo.isCached(lat, lon, radius)) guard(req, 'town', 6, 60 * 1000);
    return send(req, res, 200, await geo.township({ lat: lat, lon: lon, radius: radius, name: name }));
  }

  if (route === 'GET /api/weather') {
    let lat = num(q.get('lat')), lon = num(q.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { lat = cfg.township.lat === null ? 3.0 : cfg.township.lat; lon = cfg.township.lon === null ? 101.57 : cfg.township.lon; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new HttpError(400, 'Bad location');
    guard(req, 'wx', 30, 60 * 1000);
    try {
      return send(req, res, 200, await weather.get(lat, lon));
    } catch (e) {
      throw new HttpError(502, 'Live weather is not available right now');
    }
  }

  if (route === 'POST /api/report') {
    guard(req, 'rep', 20, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.edgeId !== 'string' || !EDGE_ID_RE.test(b.edgeId)) throw new HttpError(400, 'Unknown road');
    if (REPORT_TYPES.indexOf(b.type) === -1) throw new HttpError(400, 'Unknown report type');
    const lat = num(b.lat), lon = num(b.lon);
    let aiInfo = null;
    if (b.ai && typeof b.ai === 'object' && ai.SEVERITIES.indexOf(b.ai.severity) !== -1) {
      aiInfo = { severity: b.ai.severity, summary: cleanNote(b.ai.summary).slice(0, 160) };
    }
    await store.add({
      edgeId: b.edgeId, type: b.type, note: cleanNote(b.note),
      lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
      lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null,
      ai: aiInfo, at: Date.now()
    });
    return send(req, res, 200, await store.state());
  }

  if (route === 'POST /api/path') {
    guard(req, 'path', 10, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    const id = paths.newId();
    const made = paths.makeRow(b, id);
    if (!made.ok) throw new HttpError(400, made.error);
    await store.add(made.row);
    return send(req, res, 200, Object.assign({ id: id }, await store.state()));
  }

  if (route === 'POST /api/path/confirm') {
    guard(req, 'pathc', 30, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.id !== 'string' || !paths.ID_RE.test(b.id)) throw new HttpError(400, 'Unknown path');
    if (typeof b.by !== 'string' || !paths.DEVICE_RE.test(b.by)) throw new HttpError(400, 'Missing device id');
    const st = await store.state();
    const p = st.paths.filter(function (x) { return x.id === b.id; })[0];
    if (!p) throw new HttpError(404, 'That path is not on the map any more');
    if (p.owner === b.by) throw new HttpError(409, 'You traced this path, so someone else needs to confirm it');
    if (p.confirmers.indexOf(b.by) !== -1) throw new HttpError(409, 'You already confirmed this path');
    await store.add({ edgeId: b.id, type: 'Path confirm', note: b.by, lat: null, lon: null, ai: null, at: Date.now() });
    return send(req, res, 200, await store.state());
  }

  if (route === 'POST /api/path/decide') {
    const who = await requireRole(req, ['team']);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.id !== 'string' || !paths.ID_RE.test(b.id)) throw new HttpError(400, 'Unknown path');
    if (b.decision !== 'approve' && b.decision !== 'reject') throw new HttpError(400, 'Choose approve or reject');
    const st = await store.state();
    if (!st.paths.some(function (x) { return x.id === b.id; })) throw new HttpError(404, 'That path is not on the map any more');
    await store.add({ edgeId: b.id, type: b.decision === 'approve' ? 'Path approve' : 'Path reject', note: 'team:' + who.username, lat: null, lon: null, ai: null, at: Date.now() });
    return send(req, res, 200, await store.state());
  }

  if (route === 'POST /api/path/edit') {
    guard(req, 'pathe', 20, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.id !== 'string' || !paths.ID_RE.test(b.id)) throw new HttpError(400, 'Unknown path');
    const st = await store.state();
    const p = st.paths.filter(function (x) { return x.id === b.id; })[0];
    if (!p) throw new HttpError(404, 'That path is not on the map any more');
    if (typeof b.by !== 'string' || p.owner !== b.by) throw new HttpError(403, 'Only the person who traced this path can edit it from this device.');
    if ((p.edited || 0) >= 15) throw new HttpError(409, 'This path has been edited too many times. Trace a new one.');
    const made = paths.editRow(b, b.id);
    if (!made.ok) throw new HttpError(400, made.error);
    await store.add(made.row);
    return send(req, res, 200, await store.state());
  }

  if (route === 'POST /api/path-check') {
    guard(req, 'pathai', 10, 60 * 1000);
    const b = await readJson(req, PHOTO_BODY);
    return send(req, res, 200, await ai.pathCheck(b));
  }

  if (route === 'POST /api/triage') {
    guard(req, 'triage', 10, 60 * 1000);
    const b = await readJson(req, PHOTO_BODY);
    return send(req, res, 200, await ai.triage(b.text, b.image));
  }

  if (route === 'POST /api/chat') {
    guard(req, 'chat', 20, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    return send(req, res, 200, await ai.chat(b.messages, b.context));
  }

  // ---- Township Team sign-up, sign-in and password reset ----

  if (route === 'POST /api/auth/signup') {
    guard(req, 'signup', 30, 60 * 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    const made = auth.makeAccountRow(b, await store.all());
    if (made.error) throw new HttpError(400, made.error);
    await store.add(made.row);
    return send(req, res, 200, { ok: true, username: made.user });
  }

  if (route === 'POST /api/auth/login') {
    guard(req, 'login', 15, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    const user = String(b.username || '').trim().toLowerCase().slice(0, 40);
    if (limited('loginuser:' + user, 8, 10 * 60 * 1000)) throw new HttpError(429, 'Too many tries for this username. Wait 10 minutes or reset the password.');
    const r = auth.login(user, b.password, await store.all());
    if (!r) throw new HttpError(401, 'Wrong username or password.');
    hits.delete('loginuser:' + user);
    return send(req, res, 200, r);
  }

  if (route === 'GET /api/auth/me') {
    const who = await requireRole(req, ['team', 'admin']);
    return send(req, res, 200, who);
  }

  if (route === 'POST /api/auth/forgot') {
    guard(req, 'forgot', 6, 10 * 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 90);
    const reply = { ok: true, mailed: !!mail.provider() };
    const acct = email && !limited('forgotmail:' + email, 3, 60 * 60 * 1000) ? auth.byEmail(email, await store.all()) : null;
    if (acct) {
      const link = originOf(req) + '/#/team?reset=' + auth.resetToken(acct);
      const text = 'Hello ' + acct.user + ',\n\nUse this link to choose a new Teduh password. It works once and expires in 30 minutes:\n' + link + '\n\nIf you did not ask for this, ignore this email. Your password stays the same.';
      if (!mail.provider()) console.log('Password reset link for ' + acct.user + ' (email is not set up, so it is only shown here): ' + link);
      else { try { await mail.send(acct.e, 'Reset your Teduh password', text); } catch (e) { console.warn('Reset email not sent: ' + e.message); } }
    }
    return send(req, res, 200, reply);
  }

  if (route === 'POST /api/auth/reset') {
    guard(req, 'reset', 10, 10 * 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    const pp = auth.passwordProblem(b.password); if (pp) throw new HttpError(400, pp);
    const acct = auth.readReset(b.token, await store.all());
    if (!acct) throw new HttpError(400, 'This reset link is not valid any more. Ask for a new one.');
    await store.add(auth.passwordRow(acct, b.password));
    return send(req, res, 200, { ok: true, username: acct.user });
  }

  // ---- clearing an issue: the team sends before and after photos, the Teduh admin team decides ----

  if (route === 'POST /api/team/media') {
    await requireRole(req, ['team']);
    guard(req, 'media', 20, 60 * 1000);
    const kind = q.get('kind');
    if (['before', 'after', 'video'].indexOf(kind) === -1) throw new HttpError(400, 'Unknown file kind');
    const buf = await readRaw(req, kind === 'video' ? VIDEO_MAX : IMAGE_MAX);
    const t = sniff(buf);
    if (!t || t.video !== (kind === 'video')) throw new HttpError(400, kind === 'video' ? 'Choose an MP4 or WebM video.' : 'Choose a JPEG, PNG or WebP photo.');
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    if (fs.readdirSync(MEDIA_DIR).length >= MEDIA_FILES_MAX) throw new HttpError(507, 'The photo storage is full. Tell the Teduh admin team.');
    const name = 'm' + crypto.randomBytes(8).toString('hex') + '.' + t.ext;
    fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
    return send(req, res, 200, { id: name });
  }

  if (route === 'POST /api/team/clear') {
    const who = await requireRole(req, ['team']);
    guard(req, 'clearreq', 20, 60 * 1000);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.edgeId !== 'string' || !EDGE_ID_RE.test(b.edgeId)) throw new HttpError(400, 'Unknown road');
    const okMedia = function (n, video) { return typeof n === 'string' && MEDIA_RE.test(n) && /\.(mp4|webm)$/.test(n) === video && fs.existsSync(path.join(MEDIA_DIR, n)); };
    if (!okMedia(b.before, false)) throw new HttpError(400, 'A photo from before the work is required.');
    if (!okMedia(b.after, false)) throw new HttpError(400, 'A photo from after the work is required.');
    if (b.video && !okMedia(b.video, true)) throw new HttpError(400, 'That video was not uploaded.');
    const st = await store.state();
    if (!st.edges[b.edgeId]) throw new HttpError(404, 'That issue is not listed any more');
    if (st.clears[b.edgeId] && st.clears[b.edgeId].status === 'pending') throw new HttpError(409, 'This issue already has a clearance waiting for the Teduh admin team.');
    const j = { u: who.username, b: b.before, a: b.after };
    if (b.video) j.v = b.video;
    const n = cleanNote(b.note).slice(0, 60); if (n) j.n = n;
    await store.add({ edgeId: b.edgeId, type: 'Clear request', note: JSON.stringify(j), lat: null, lon: null, ai: null, at: Date.now() });
    return send(req, res, 200, await store.state());
  }

  if (route === 'POST /api/admin/clear') {
    const who = await requireRole(req, ['admin']);
    const b = await readJson(req, SMALL_BODY);
    if (typeof b.edgeId !== 'string' || !EDGE_ID_RE.test(b.edgeId)) throw new HttpError(400, 'Unknown road');
    if (b.decision !== 'approve' && b.decision !== 'reject') throw new HttpError(400, 'Choose approve or reject');
    const st = await store.state(), c = st.clears[b.edgeId];
    if (!c || c.status !== 'pending') throw new HttpError(404, 'There is no clearance waiting for review on this issue');
    const j = { u: c.by, b: c.before, a: c.after };
    if (c.video) j.v = c.video;
    if (c.note) j.n = c.note;
    if (b.decision === 'approve') {
      j.adm = who.username;
      await store.clear(b.edgeId, ['Clear done']);
      await store.add({ edgeId: b.edgeId, type: 'Clear done', note: JSON.stringify(j), lat: null, lon: null, ai: null, at: Date.now() });
    } else {
      const why = cleanNote(b.reason).slice(0, 60); if (why) j.r = why;
      await store.add({ edgeId: b.edgeId, type: 'Clear reject', note: JSON.stringify(j), lat: null, lon: null, ai: null, at: Date.now() });
    }
    return send(req, res, 200, await store.state());
  }

  if (route === 'GET /api/admin/accounts') {
    await requireRole(req, ['admin']);
    return send(req, res, 200, { accounts: auth.publicList(await store.all()) });
  }

  if (route === 'POST /api/admin/account/delete') {
    await requireRole(req, ['admin']);
    const b = await readJson(req, SMALL_BODY);
    const user = String(b.username || '').toLowerCase();
    if (!/^[a-z][a-z0-9_.]{3,19}$/.test(user) || !auth.accounts(await store.all())[user]) throw new HttpError(404, 'No such account');
    await store.clear('acct-' + user);
    return send(req, res, 200, { accounts: auth.publicList(await store.all()) });
  }

  if (route === 'POST /api/reset') {
    await requireRole(req, ['admin']);
    await store.reset();
    return send(req, res, 200, await store.state());
  }

  if (/^\/api\/(health|config|state|geocode|township|weather|report|path|path\/confirm|path\/decide|path\/edit|path-check|triage|chat|reset|auth\/signup|auth\/login|auth\/me|auth\/forgot|auth\/reset|team\/media|team\/clear|admin\/clear|admin\/accounts|admin\/account\/delete)$/.test(url.pathname)) {
    throw new HttpError(405, 'Method not allowed');
  }
  throw new HttpError(404, 'Not found');
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://tile.openstreetmap.org https://api.maptiler.com",
  "connect-src 'self'",
  "frame-ancestors 'none'"
].join('; ');

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(req, res, 400, 'Bad request'); }
  if (rel.indexOf('\0') !== -1) return send(req, res, 400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(cfg.publicDir, rel));
  if (file !== cfg.publicDir && file.indexOf(cfg.publicDir + path.sep) !== 0) return send(req, res, 403, 'Forbidden');
  fs.readFile(file, function (err, buf) {
    if (err) return send(req, res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    sendBuffer(req, res, buf, headers);
  });
}

// Whole file or a byte range. Video needs ranges (Safari on iPhone will not play it without them).
function sendBuffer(req, res, buf, headers) {
  headers['Accept-Ranges'] = 'bytes';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : buf.length - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
    start = Math.max(0, start); end = Math.min(end, buf.length - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + buf.length }); return res.end(); }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + buf.length;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

// ---------- start ----------

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.indexOf('/api/') === 0) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(req, res, e.status, { error: e.message });
    console.error(e);
    return send(req, res, 500, { error: 'Server error' });
  }
});

store.init().catch(function (e) { console.warn('Storage: ' + e.message); }).then(function () {
  server.listen(cfg.port, '0.0.0.0', function () {
    const f = cfg.publicConfig().features;
    console.log('Teduh is running on http://localhost:' + cfg.port);
    console.log('  Reports saved in : ' + (f.database === 'appwrite' ? 'Appwrite' : f.database === 'supabase' ? 'Supabase' : 'a local file (data/db.json)'));
    console.log('  Map pictures     : ' + (f.tiles === 'maptiler' ? 'MapTiler' : 'OpenStreetMap'));
    console.log('  Walking buddy    : ' + (f.chat || 'off (add GEMINI_API_KEY or ANTHROPIC_API_KEY)'));
    console.log('  Photo check      : ' + (f.triage || 'off (add GEMINI_API_KEY)'));
    console.log('  Path photo check : ' + (cfg.pathAi() || 'off (add GROQ_API_KEY)'));
    console.log('  Satellite view   : ' + (cfg.satellite() ? 'on (MapTiler)' : 'off (needs MAPTILER_API_KEY)'));
    console.log('  Team accounts    : sign-up and sign-in on the Township Team page' + (cfg.auth.emailDomains.length ? ' (only @' + cfg.auth.emailDomains.join(', @') + ')' : ' (any organisation email; set TEAM_EMAIL_DOMAINS to limit it)'));
    console.log('  Reset emails     : ' + (mail.provider() || 'off (links are printed here; add BREVO_API_KEY and MAIL_FROM)'));
    console.log('  Admin sign-in    : username ' + cfg.auth.adminUser + (cfg.auth.adminPassGenerated ? ', password ' + cfg.auth.adminPass + ' (made up for this run; set ADMIN_PASSWORD in .env to keep one)' : ', password from ADMIN_PASSWORD'));
  });
});
