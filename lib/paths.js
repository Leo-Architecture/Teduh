'use strict';
// Resident-traced walking paths ("Path Discovery").
//
// A path is kept in the same table as resident reports, so Appwrite, Supabase and the file store need no new columns:
//   'New path'      edge_id "path-xxxxxxxx", note = compact JSON { g: encoded line, s: surface, k: kind, n: note, by: device, m: 1 if simulated }
//   'Path confirm'  same edge_id, note = the confirming device id
//   'Path edit'     same edge_id, same JSON as 'New path'; the newest edit from the person who traced it replaces the path.
//                   Changing the line, kind or surface asks for a new check (earlier confirmations and approvals stop counting).
//   'Path approve'  / 'Path reject'  same edge_id, from the township team (signed in)
// A path is "verified" once one other device confirms it or the team approves it. Verified paths join the routes.
// Unverified paths only show on the map.

const PATH_TYPES = ['New path', 'Path edit', 'Path confirm', 'Path approve', 'Path reject'];
const SURFACES = ['paved', 'concrete', 'boardwalk', 'gravel', 'mud', 'grass'];
const KINDS = ['trail', 'shortcut', 'footbridge', 'stairs'];
const ID_RE = /^path-[a-z0-9]{8}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MIN_POINTS = 2, MAX_POINTS = 24;
const MIN_LEN_M = 15, MAX_LEN_M = 800;
const NEED_CONFIRMS = 1;           // other devices that must confirm (the person who traced it is the first)
const MAX_NOTE = 290;              // the table's note column holds 300 characters

// Google's encoded polyline format, precision 1e-5 (about 1 m): a point costs about 6 characters
function encode(pts) {
  let out = '', plat = 0, plon = 0;
  function one(v) {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  }
  pts.forEach(function (p) {
    const la = Math.round(p[0] * 1e5), lo = Math.round(p[1] * 1e5);
    out += one(la - plat) + one(lo - plon);
    plat = la; plon = lo;
  });
  return out;
}
function decode(str) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  function next() {
    let r = 0, shift = 0, b;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5;
    } while (b >= 0x20 && shift < 35);
    return r & 1 ? ~(r >> 1) : r >> 1;
  }
  while (i < str.length) {
    const a = next(), o = next();
    if (a === null || o === null) return null;
    lat += a; lon += o;
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

function dist(a, b) {
  const k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 111320 * k);
}
function lengthOf(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }

function cleanText(s, n) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : ''; }

// Checks what a resident sent. Returns { ok, error, row } where row is what the store saves.
function makeRow(b, id) {
  const bad = function (error) { return { ok: false, error: error }; };
  if (!b || !Array.isArray(b.pts)) return bad('Trace the path on the map first');
  const pts = b.pts.filter(function (p) { return Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) && Math.abs(Number(p[0])) <= 90 && Math.abs(Number(p[1])) <= 180; })
    .map(function (p) { return [Math.round(Number(p[0]) * 1e5) / 1e5, Math.round(Number(p[1]) * 1e5) / 1e5]; });
  if (pts.length < MIN_POINTS) return bad('A path needs at least 2 points');
  if (pts.length > MAX_POINTS) return bad('Use at most ' + MAX_POINTS + ' points');
  const len = lengthOf(pts);
  if (len < MIN_LEN_M) return bad('That path is shorter than ' + MIN_LEN_M + ' m');
  if (len > MAX_LEN_M) return bad('Paths can be up to ' + MAX_LEN_M + ' m. Trace a shorter one');
  if (SURFACES.indexOf(b.surface) === -1) return bad('Choose what the path is made of');
  if (KINDS.indexOf(b.kind) === -1) return bad('Choose what kind of path it is');
  if (typeof b.by !== 'string' || !DEVICE_RE.test(b.by)) return bad('Missing device id');
  const j = { g: encode(pts), s: b.surface, k: b.kind };
  const n = cleanText(b.note, 80); if (n) j.n = n;
  j.by = b.by;
  if (b.sim) j.m = 1;
  const note = JSON.stringify(j);
  if (note.length > MAX_NOTE) return bad('That path has too many bends. Use fewer points');
  let ai = null;
  if (b.ai && typeof b.ai === 'object' && ['low', 'medium', 'high'].indexOf(b.ai.severity) !== -1) ai = { severity: b.ai.severity, summary: cleanText(b.ai.summary, 160) };
  return { ok: true, row: { edgeId: id, type: 'New path', note: note, lat: pts[0][0], lon: pts[0][1], ai: ai, at: Date.now() }, length: len };
}

// From all stored rows to the list the page reads. Rejected paths are left out.
function buildPaths(rows) {
  const by = {};
  rows.forEach(function (r) {
    if (PATH_TYPES.indexOf(r.type) === -1 || !ID_RE.test(r.edgeId || '')) return;
    (by[r.edgeId] || (by[r.edgeId] = [])).push(r);
  });
  const out = [];
  Object.keys(by).forEach(function (id) {
    const list = by[id].slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    const head = list.filter(function (r) { return r.type === 'New path'; })[0];
    if (!head) return;
    let j; try { j = JSON.parse(head.note); } catch (e) { return; }
    const first = j;
    const valid = function (x) { const g = x && typeof x.g === 'string' ? decode(x.g) : null; return g && g.length >= 2 && SURFACES.indexOf(x.s) !== -1 && KINDS.indexOf(x.k) !== -1 ? g : null; };
    let pts = valid(j);
    if (!pts) return;
    if (list.some(function (r) { return r.type === 'Path reject'; })) return;
    let resetAt = 0, edited = 0, last = head;
    list.forEach(function (r) {
      if (r.type !== 'Path edit') return;
      let x; try { x = JSON.parse(r.note); } catch (e) { return; }
      const g = valid(x);
      if (!g || x.by !== first.by) return;                 // only the person who traced it can edit it
      if (x.g !== j.g || x.s !== j.s || x.k !== j.k) resetAt = r.at || 0;
      j = x; pts = g; last = r; edited++;
    });
    const confirmers = [];
    list.forEach(function (r) {
      if (r.type === 'Path confirm' && (r.at || 0) >= resetAt && DEVICE_RE.test(r.note || '') && r.note !== j.by && confirmers.indexOf(r.note) === -1) confirmers.push(r.note);
    });
    const approved = list.some(function (r) { return r.type === 'Path approve' && (r.at || 0) >= resetAt; });
    const verified = approved || confirmers.length >= NEED_CONFIRMS;
    out.push({
      id: id, pts: pts, surface: j.s, kind: j.k, note: j.n || '', owner: j.by || '', confirmers: confirmers,
      status: verified ? 'verified' : 'unverified', via: approved ? 'team' : verified ? 'residents' : null,
      sim: !!j.m, ai: last.ai || head.ai || null, at: head.at || 0, edited: edited, length: Math.round(lengthOf(pts))
    });
  });
  return out.sort(function (a, b) { return a.at - b.at; });
}

// A path edit: same checks as a new path, stored as a 'Path edit' row
function editRow(b, id) {
  const made = makeRow(b, id);
  if (made.ok) made.row.type = 'Path edit';
  return made;
}

function newId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = require('crypto').randomBytes(8);
  let s = 'path-';
  for (let i = 0; i < 8; i++) s += abc[bytes[i] % abc.length];
  return s;
}

module.exports = { PATH_TYPES: PATH_TYPES, SURFACES: SURFACES, KINDS: KINDS, ID_RE: ID_RE, DEVICE_RE: DEVICE_RE, NEED_CONFIRMS: NEED_CONFIRMS, encode: encode, decode: decode, makeRow: makeRow, editRow: editRow, buildPaths: buildPaths, newId: newId, lengthOf: lengthOf };
