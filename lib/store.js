'use strict';
// Where resident reports are kept.
//   - Supabase, when SUPABASE_URL and SUPABASE_SERVICE_KEY are set (survives restarts and free hosting)
//   - a JSON file otherwise (data/db.json)
// Both give the same four operations: state, add, clear, reset.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchJson, HttpError } = require('./http');
const paths = require('./paths');

const MAX_OPEN = 2000;
const KEEP_ON_RESET = ['Team account', 'Clear done'];   // a demo reset never deletes staff accounts or the clearance history
const MAX_PER_ROAD = 50;

// The shape the page reads: { rev, edges: { roadId: { blocked, reports: [...] } } }
const PRIVATE_TYPES = ['Team account'];
const CLEAR_TYPES = ['Clear request', 'Clear reject', 'Clear done'];
function jparse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function toState(rev, reports) {
  const edges = {}, clears = {}, cleared = [];
  const isPathRow = function (r) { return paths.PATH_TYPES.indexOf(r.type) !== -1 && paths.ID_RE.test(r.edgeId || ''); };
  reports.forEach(function (r) {
    if (isPathRow(r)) return;           // traced paths are listed separately below
    if (PRIVATE_TYPES.indexOf(r.type) !== -1) return;   // team accounts never leave the server
    if (CLEAR_TYPES.indexOf(r.type) !== -1) {
      const j = jparse(r.note) || {};
      if (r.type === 'Clear done') cleared.push({ edgeId: r.edgeId, by: j.u || '', approvedBy: j.adm || '', before: j.b || '', after: j.a || '', video: j.v || '', note: j.n || '', at: r.at });
      else if (!clears[r.edgeId] || (r.at || 0) >= clears[r.edgeId].at) clears[r.edgeId] = { status: r.type === 'Clear request' ? 'pending' : 'rejected', by: j.u || '', before: j.b || '', after: j.a || '', video: j.v || '', note: j.n || '', reason: j.r || '', at: r.at || 0 };
      return;
    }
    const e = edges[r.edgeId] || (edges[r.edgeId] = { blocked: false, reports: [] });
    if (r.type === 'Blocked drain') e.blocked = true;
    const item = { type: r.type, at: r.at };
    if (r.note) item.note = r.note;
    if (r.lat != null && r.lon != null) { item.lat = r.lat; item.lon = r.lon; }
    if (r.ai) item.ai = r.ai;
    e.reports.push(item);
  });
  cleared.sort(function (a, b) { return b.at - a.at; });
  return { rev: rev, edges: edges, paths: paths.buildPaths(reports), clears: clears, cleared: cleared.slice(0, 30) };
}

function fileStore(cfg) {
  const file = path.join(cfg.dataDir, 'db.json');
  let db = { rev: 0, reports: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && typeof saved.rev === 'number' && Array.isArray(saved.reports)) db = saved;
  } catch (e) { /* first run */ }

  function save() {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }

  return {
    kind: 'file',
    async init() { /* nothing to connect to */ },
    async state() { return toState(db.rev, db.reports); },
    async all() { return db.reports.slice(); },
    async add(r) {
      db.reports.push(Object.assign({ id: crypto.randomUUID() }, r));
      const same = db.reports.filter(function (x) { return x.edgeId === r.edgeId; });
      if (same.length > MAX_PER_ROAD) db.reports.splice(db.reports.indexOf(same[0]), 1);
      if (db.reports.length > MAX_OPEN) db.reports.shift();
      db.rev++; save();
    },
    async clear(edgeId, keep) {
      db.reports = db.reports.filter(function (x) { return x.edgeId !== edgeId || (keep && keep.indexOf(x.type) !== -1); });
      db.rev++; save();
    },
    async reset() { db.reports = db.reports.filter(function (x) { return KEEP_ON_RESET.indexOf(x.type) !== -1; }); db.rev++; save(); }
  };
}

function keepQuery(keep) { return keep && keep.length ? '&type=not.in.(' + keep.map(function (t) { return '"' + t + '"'; }).join(',') + ')' : ''; }

function supabaseStore(cfg) {
  const base = cfg.supabase.url + '/rest/v1/' + cfg.supabase.table;
  const headers = { apikey: cfg.supabase.key, Authorization: 'Bearer ' + cfg.supabase.key, 'Content-Type': 'application/json' };
  const cache = { at: 0, reports: [], sig: '', rev: 0, error: '' };

  function fromRow(r) {
    return { id: r.id, edgeId: r.edge_id, type: r.type, note: r.note || '', lat: r.lat, lon: r.lon, ai: r.ai || null, at: Date.parse(r.created_at) || Date.now() };
  }
  function explain(e) {
    if (e.status === 404 || /relation .*does not exist|Could not find the table/i.test(e.message || '')) {
      return 'The reports table is missing. Run supabase/schema.sql in the Supabase SQL Editor.';
    }
    if (e.status === 401 || e.status === 403) return 'Supabase refused the key. Use the service_role key in SUPABASE_SERVICE_KEY.';
    return 'Could not reach the database. ' + (e.message || '');
  }

  async function pull(force) {
    if (!force && Date.now() - cache.at < 3000) return;
    try {
      const rows = await fetchJson(base + '?select=id,edge_id,type,note,lat,lon,ai,created_at&cleared=eq.false&order=created_at.asc&limit=' + MAX_OPEN, { headers: headers }, 10000);
      const reports = (Array.isArray(rows) ? rows : []).map(fromRow);
      const sig = crypto.createHash('md5').update(reports.map(function (r) { return r.id; }).join(',')).digest('hex');
      if (sig !== cache.sig) { cache.sig = sig; cache.rev++; }
      cache.reports = reports;
      cache.error = '';
    } catch (e) {
      cache.error = explain(e);   // keep showing the last known reports
    }
    cache.at = Date.now();
  }

  async function write(method, url, body) {
    try {
      await fetchJson(url, { method: method, headers: Object.assign({ Prefer: 'return=minimal' }, headers), body: body ? JSON.stringify(body) : undefined }, 10000);
    } catch (e) {
      throw new HttpError(502, explain(e));
    }
    await pull(true);
  }

  return {
    kind: 'supabase',
    async init() {
      await pull(true);
      if (cache.error) console.warn('Supabase: ' + cache.error);
      else console.log('Supabase connected (' + cache.reports.length + ' open reports).');
    },
    async state() {
      await pull(false);
      const s = toState(cache.rev, cache.reports);
      if (cache.error) s.warning = cache.error;
      return s;
    },
    async all() { await pull(false); return cache.reports.slice(); },
    async add(r) {
      await write('POST', base, { edge_id: r.edgeId, type: r.type, note: r.note || null, lat: r.lat == null ? null : r.lat, lon: r.lon == null ? null : r.lon, ai: r.ai || null });
    },
    async clear(edgeId, keep) {
      await write('PATCH', base + '?edge_id=eq.' + encodeURIComponent(edgeId) + '&cleared=eq.false' + keepQuery(keep), { cleared: true });
    },
    async reset() {
      await write('PATCH', base + '?cleared=eq.false' + keepQuery(KEEP_ON_RESET), { cleared: true });
    }
  };
}

// Appwrite (Cloud or self-hosted), through its REST API with a server API key.
// Newer projects call the data "tables and rows", older ones "collections and documents".
// APPWRITE_API=auto tries tables first and falls back to collections.
function appwriteStore(cfg) {
  const a = cfg.appwrite;
  const base = a.endpoint;
  const headers = { 'X-Appwrite-Project': a.project, 'X-Appwrite-Key': a.key, 'Content-Type': 'application/json' };
  const cache = { at: 0, reports: [], sig: '', rev: 0, error: '' };
  let mode = a.api === 'auto' ? 'tables' : a.api;
  let settled = a.api !== 'auto';

  function url(m, id) {
    const p = m === 'tables'
      ? '/tablesdb/' + encodeURIComponent(a.database) + '/tables/' + encodeURIComponent(a.table) + '/rows'
      : '/databases/' + encodeURIComponent(a.database) + '/collections/' + encodeURIComponent(a.table) + '/documents';
    return base + p + (id ? '/' + encodeURIComponent(id) : '');
  }
  // One call. If the first style is not found, try the other one once and remember which works.
  async function call(method, id, body, query) {
    const order = settled ? [mode] : [mode, mode === 'tables' ? 'legacy' : 'tables'];
    let last;
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      try {
        const data = await fetchJson(url(m, id) + (query || ''), { method: method, headers: headers, body: body ? JSON.stringify(m === 'tables' ? Object.assign({ rowId: 'unique()' }, body) : Object.assign({ documentId: 'unique()' }, body)) : undefined }, 10000);
        mode = m; settled = true;
        return data;
      } catch (e) { last = e; if (e.status !== 404 || settled) throw e; }
    }
    throw last;
  }
  function fromRow(r) {
    let ai = null;
    if (r.ai) { try { ai = typeof r.ai === 'string' ? JSON.parse(r.ai) : r.ai; } catch (e) { ai = null; } }
    return { id: r.$id, edgeId: r.edge_id, type: r.type, note: r.note || '', lat: typeof r.lat === 'number' ? r.lat : null, lon: typeof r.lon === 'number' ? r.lon : null, ai: ai, at: Date.parse(r.$createdAt) || Date.now() };
  }
  function explain(e) {
    if (e.status === 401 || e.status === 403) return 'Appwrite refused the API key. Give it the Databases scopes (read and write) and check APPWRITE_PROJECT_ID.';
    if (e.status === 404) return 'Appwrite could not find the database or table. Check APPWRITE_DATABASE_ID and APPWRITE_TABLE_ID, and that the table has the columns listed in the README.';
    if (e.status === 400) return 'Appwrite rejected the data: ' + (e.message || '') + ' Check the table columns in the README.';
    return 'Could not reach Appwrite. ' + (e.message || '');
  }
  async function list() {
    const data = await call('GET', null, null, '?queries[0]=' + encodeURIComponent('{"method":"limit","values":[' + MAX_OPEN + ']}'));
    const rows = data && (data.rows || data.documents) || [];
    return rows.map(fromRow).sort(function (x, y) { return x.at - y.at; });
  }
  async function pull(force) {
    if (!force && Date.now() - cache.at < 3000) return;
    try {
      const reports = await list();
      const sig = crypto.createHash('md5').update(reports.map(function (r) { return r.id; }).join(',')).digest('hex');
      if (sig !== cache.sig) { cache.sig = sig; cache.rev++; }
      cache.reports = reports; cache.error = '';
    } catch (e) { cache.error = explain(e); }
    cache.at = Date.now();
  }
  async function guard(fn) {
    try { await fn(); } catch (e) { throw new HttpError(502, explain(e)); }
    await pull(true);
  }

  return {
    kind: 'appwrite',
    async init() {
      await pull(true);
      if (cache.error) console.warn('Appwrite: ' + cache.error);
      else console.log('Appwrite connected (' + cache.reports.length + ' open reports, ' + mode + ' API).');
    },
    async state() {
      await pull(false);
      const s = toState(cache.rev, cache.reports);
      if (cache.error) s.warning = cache.error;
      return s;
    },
    async all() { await pull(false); return cache.reports.slice(); },
    async add(r) {
      await guard(function () {
        return call('POST', null, { data: { edge_id: r.edgeId, type: r.type, note: r.note || '', lat: r.lat == null ? null : r.lat, lon: r.lon == null ? null : r.lon, ai: r.ai ? JSON.stringify(r.ai) : '' } });
      });
    },
    async clear(edgeId, keep) {
      await guard(async function () {
        const rows = await list();
        for (const x of rows) if (x.edgeId === edgeId && !(keep && keep.indexOf(x.type) !== -1)) await call('DELETE', x.id);
      });
    },
    async reset() {
      await guard(async function () {
        const rows = await list();
        for (const x of rows) if (KEEP_ON_RESET.indexOf(x.type) === -1) await call('DELETE', x.id);
      });
    }
  };
}

function createStore(cfg) {
  if (cfg.appwrite.endpoint && cfg.appwrite.project && cfg.appwrite.key && cfg.appwrite.database) return appwriteStore(cfg);
  return cfg.supabase.url && cfg.supabase.key ? supabaseStore(cfg) : fileStore(cfg);
}

module.exports = { createStore, toState };
