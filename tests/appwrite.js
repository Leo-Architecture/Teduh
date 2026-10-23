'use strict';
// Tests the Appwrite storage against a small stand-in for the Appwrite REST API (new "tables" style and old "collections" style).
const http = require('http');
process.env.TEDUH_ENV_FILE = '/nonexistent';
const { createStore } = require('../lib/store');

let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); } }

function fakeAppwrite(flavor) {
  const rows = [], log = []; let n = 0;
  const srv = http.createServer(function (req, res) {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      const u = new URL(req.url, 'http://x');
      log.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body: body ? JSON.parse(body) : null });
      function out(code, o) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); }
      if (req.headers['x-appwrite-key'] !== 'good-key') return out(401, { message: 'No permissions provided for action' });
      const tbl = '/v1/tablesdb/db1/tables/reports/rows', col = '/v1/databases/db1/collections/reports/documents';
      const root = flavor === 'tables' ? tbl : col;
      if (u.pathname.indexOf(root) !== 0) return out(404, { message: 'The requested route could not be found.' });
      const id = u.pathname.slice(root.length + 1);
      if (req.method === 'GET' && !id) { const key = flavor === 'tables' ? 'rows' : 'documents'; return out(200, { total: rows.length, [key]: rows }); }
      if (req.method === 'POST') {
        const b = JSON.parse(body);
        if (!b.data || typeof b.data.edge_id !== 'string') return out(400, { message: 'Invalid document structure' });
        const row = Object.assign({ $id: 'r' + (++n), $createdAt: new Date().toISOString() }, b.data);
        rows.push(row); return out(201, row);
      }
      if (req.method === 'DELETE' && id) { const i = rows.findIndex(function (r) { return r.$id === id; }); if (i < 0) return out(404, { message: 'not found' }); rows.splice(i, 1); return out(204, {}); }
      out(400, { message: 'unsupported' });
    });
  });
  return new Promise(function (r) { srv.listen(0, '127.0.0.1', function () { r({ srv: srv, rows: rows, log: log, url: 'http://127.0.0.1:' + srv.address().port + '/v1' }); }); });
}

function cfgFor(url, key, api) {
  return { appwrite: { endpoint: url, project: 'proj1', key: key, database: 'db1', table: 'reports', api: api || 'auto' }, supabase: { url: '', key: '' }, dataDir: '/tmp/x' };
}

(async function () {
  for (const flavor of ['tables', 'legacy']) {
    console.log('\nAppwrite, ' + flavor + ' style API');
    const a = await fakeAppwrite(flavor);
    const s = createStore(cfgFor(a.url, 'good-key'));
    check('uses the Appwrite store', s.kind === 'appwrite');
    await s.init();
    let st = await s.state();
    check('starts empty and finds the right API style automatically', Object.keys(st.edges).length === 0 && !st.warning, st);
    await s.add({ edgeId: 'w1:0', type: 'Flooded road', note: 'knee deep', lat: 3.1, lon: 101.6, ai: { severity: 'high', summary: 'water over road' }, at: Date.now() });
    await s.add({ edgeId: 'w2:1', type: 'Blocked drain', note: '', lat: null, lon: null, ai: null, at: Date.now() });
    check('rows are written with the right fields', a.rows.length === 2 && a.rows[0].edge_id === 'w1:0' && a.rows[0].type === 'Flooded road' && a.rows[0].lat === 3.1, a.rows);
    const post = a.log.filter(function (e) { return e.method === 'POST'; })[0];
    check('requests carry the project id and API key', post.headers['x-appwrite-project'] === 'proj1' && post.headers['x-appwrite-key'] === 'good-key', post.headers);
    check('body uses ' + (flavor === 'tables' ? 'rowId' : 'documentId'), flavor === 'tables' ? post.body.rowId === 'unique()' : post.body.documentId === 'unique()', post.body);
    st = await s.state();
    check('state groups reports by road and flags blocked drains', st.edges['w1:0'].reports[0].type === 'Flooded road' && st.edges['w1:0'].reports[0].ai.severity === 'high' && st.edges['w2:1'].blocked === true, st);
    await s.clear('w1:0');
    st = await s.state();
    check('clear removes only that road', !st.edges['w1:0'] && st.edges['w2:1'] && a.rows.length === 1, st);
    await s.reset();
    st = await s.state();
    check('reset removes everything', Object.keys(st.edges).length === 0 && a.rows.length === 0, st);
    a.srv.close();
  }

  console.log('\nAppwrite errors');
  const a = await fakeAppwrite('tables');
  const bad = createStore(cfgFor(a.url, 'wrong-key'));
  await bad.init();
  let st = await bad.state();
  check('a wrong key gives a clear warning', /refused the API key/.test(st.warning || ''), st);
  let err = null; try { await bad.add({ edgeId: 'x', type: 'Blocked drain', at: Date.now() }); } catch (e) { err = e; }
  check('saving with a wrong key fails with 502 and a clear message', err && err.status === 502 && /refused the API key/.test(err.message), err && err.message);
  const miss = createStore(Object.assign(cfgFor(a.url, 'good-key'), {}));
  miss.kind; const c2 = cfgFor(a.url, 'good-key'); c2.appwrite.table = 'nope';
  const s2 = createStore(c2); await s2.init(); st = await s2.state();
  check('a wrong table id says the table was not found', /could not find the database or table/.test(st.warning || ''), st);
  a.srv.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
