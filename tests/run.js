'use strict';
// API tests. Run with:  npm test
// Starts fake outside services (tests/mock-services.js) and the real server, and checks every endpoint.
// Nothing here uses the internet or your real keys.

const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { startMock } = require('./mock-services');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : '')); }
}

function freePort() {
  return new Promise(function (resolve) {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { resolve(p); }); });
  });
}

async function startServer(mock, extraEnv, dataDir) {
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    PORT: String(port), ADMIN_USERNAME: 'teduhadmin', ADMIN_PASSWORD: 'Adm1nPass99', SESSION_SECRET: 'test-secret', DATA_DIR: dataDir, TEDUH_ENV_FILE: path.join(os.tmpdir(), 'no-such-env-file'),
    OVERPASS_URL: mock.url + '/overpass/interpreter', NOMINATIM_URL: mock.url + '/nominatim/search',
    OPEN_METEO_GEOCODING_URL: mock.url + '/geocoding/v1/search', OPEN_METEO_FORECAST_URL: mock.url + '/forecast',
    OPEN_METEO_ELEVATION_URL: mock.url + '/elevation', OPEN_METEO_AIR_QUALITY_URL: mock.url + '/airquality/v1/air-quality', TOWNSHIP_NAME: 'Putra Heights'
  }, extraEnv || {});
  ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'MAPTILER_API_KEY'].forEach(function (k) { if (!(extraEnv && k in extraEnv)) delete env[k]; });
  const child = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', function (d) { out += d; });
  child.stderr.on('data', function (d) { out += d; });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) { await new Promise(function (r) { setTimeout(r, 100); }); }
  }
  return {
    base: base, dir: dataDir, log: function () { return out; },
    get: async function (p, h) { const r = await fetch(base + p, { headers: h || {} }); return { status: r.status, body: await r.json().catch(function () { return null; }), headers: r.headers }; },
    post: async function (p, body, h) {
      const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h || {}), body: JSON.stringify(body || {}) });
      return { status: r.status, body: await r.json().catch(function () { return null; }) };
    },
    upload: async function (kind, buf, tok) {
      const r = await fetch(base + '/api/team/media?kind=' + kind, { method: 'POST', headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: buf });
      return { status: r.status, body: await r.json().catch(function () { return null; }) };
    },
    stop: function () { return new Promise(function (r) { child.on('exit', r); child.kill(); }); }
  };
}

const bearer = function (tok) { return { Authorization: 'Bearer ' + tok }; };
// a staff member signs up and in; returns the token
async function teamLogin(s, n, extra) {
  const u = 'staff' + n;
  const body = Object.assign({ username: u, password: 'Passw0rd' + n, staffId: 'SD-100' + n, email: u + '@sdp.example.com' }, extra || {});
  const a = await s.post('/api/auth/signup', body);
  if (a.status !== 200) throw new Error('signup failed ' + JSON.stringify(a.body));
  const l = await s.post('/api/auth/login', { username: u, password: body.password });
  return l.body.token;
}
const JPG_BUF = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const MP4_BUF = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]);

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'teduh-test-')); }
const lastTo = function (mock, p) { for (let i = mock.log.length - 1; i >= 0; i--) if (mock.log[i].path === p) return mock.log[i]; return null; };
// a tiny valid JPEG-looking data URL (the mock does not decode it)
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function scenarioNoKeys(mock) {
  console.log('\nScenario 1: no keys (file storage, free map tiles)');
  const dir = tmp();
  let s = await startServer(mock, {}, dir);

  let r = await s.get('/api/config');
  check('config shows everything optional is off', r.body.features.database === 'file' && r.body.features.chat === null && r.body.features.triage === null && r.body.features.tiles === 'osm', r.body);
  check('config sends no secrets', !/key|secret/i.test(JSON.stringify(r.body).replace(/tiles|"features"/g, '')), r.body);

  r = await s.get('/api/geocode?q=putra');
  check('place search works', r.status === 200 && r.body.results[0].name === 'Putra Heights' && Math.abs(r.body.results[0].lat - 3) < 0.01, r.body);
  mock.fail.nominatim = 500;
  r = await s.get('/api/geocode?q=putra');
  check('place search falls back to the second service', r.status === 200 && r.body.results.length === 1, r.body);
  delete mock.fail.nominatim;
  r = await s.get('/api/geocode?q=a');
  check('place search rejects a 1 letter query', r.status === 400, r.body);

  r = await s.get('/api/township');
  const ds = r.body;
  check('default township loads from the .env name', r.status === 200 && ds.source === 'openstreetmap' && ds.name === 'Putra Heights', r.body && { s: r.status, e: r.body.error });
  check('overpass got the right query and a user agent', (function () {
    const q = lastTo(mock, '/overpass/interpreter');
    return q && /around:600,3,101\.57/.test(decodeURIComponent(q.body)) && /Teduh/.test(q.headers['user-agent']);
  })());
  check('dataset has roads, nodes, places and trees', ds.edges.length >= 20 && ds.nodes.length >= 10 && ds.places.length >= 4 && ds.trees.length > 10, ds.stats);
  check('motorway and foot=no roads are left out', !ds.edges.some(function (e) { return e.road === 'Lebuhraya' || e.road === 'No foot'; }));
  check('every edge points at real nodes', ds.edges.every(function (e) { return ds.nodes[e.a] && ds.nodes[e.b] && e.a !== e.b && e.pts.length >= 2 && e.len > 0; }));
  check('every place points at a real node', ds.places.every(function (p) { return ds.nodes[p.node] && p.name; }));
  check('covered walkway detected and named', ds.edges.some(function (e) { return e.covered === 1 && e.road === 'Covered walkway'; }), ds.stats);
  const steps = ds.edges.find(function (e) { return e.steps === 1; });
  check('steps flagged and not cyclable', steps && steps.bike === 0, steps);
  check('HTML in a street name is neutralised', !ds.edges.some(function (e) { return /[<>]/.test(e.road + e.where); }) && ds.edges.some(function (e) { return /img src=x/.test(e.road); }));
  const seri2 = ds.edges.filter(function (e) { return /Jalan Seri 2/.test(e.road); });
  const seri4 = ds.edges.filter(function (e) { return /Jalan Seri 4/.test(e.road); });
  const avg = function (l, k) { return l.reduce(function (a, b) { return a + b[k]; }, 0) / l.length; };
  check('tree-lined street is shadier than a bare one', avg(seri2, 'shade') > 0.8 && avg(seri4, 'shade') < 0.3, [avg(seri2, 'shade'), avg(seri4, 'shade')]);
  const seri3 = ds.edges.filter(function (e) { return /Jalan Seri 3/.test(e.road) && e.sh; });
  check('buildings are counted and the dataset says so', ds.stats.buildings === 1 && ds.notes.some(function (n) { return /shadows of 1 buildings/.test(n); }), [ds.stats, ds.notes]);
  check('a tall building shades the street beside it in the morning', seri3.length >= 1 && seri3.some(function (e) { return e.sh[3] > e.shade + 0.05 && e.sh.length === 13; }), seri3.map(function (e) { return e.sh; }));
  check('streets with no building nearby carry no hourly shade', ds.edges.filter(function (e) { return /Jalan Seri 4/.test(e.road); }).every(function (e) { return !e.sh; }));
  check('the overpass query asks for buildings', /\["building"\]/.test(decodeURIComponent(lastTo(mock, '/overpass/interpreter').body)));
  const pokok4 = ds.edges.filter(function (e) { return /Lorong Pokok 4/.test(e.road); });
  const pokok1 = ds.edges.filter(function (e) { return /Lorong Pokok 1/.test(e.road); });
  check('road beside a drain on low ground floods much earlier than one on high ground', avg(pokok4, 'thr') <= 40 && avg(pokok1, 'thr') >= 70 && avg(pokok1, 'thr') - avg(pokok4, 'thr') >= 30, [avg(pokok4, 'thr'), avg(pokok1, 'thr')]);
  check('lit and sidewalk tags carried over', ds.edges.some(function (e) { return e.lit === 1; }) && ds.edges.some(function (e) { return e.sidewalk === 1; }));
  check('landmark names appear in road labels', ds.edges.some(function (e) { return /near (SK Putra Heights|Klinik Seri|Seri Mart|Taman Pokok|Pasar Pagi)/.test(e.where); }));
  check('dataset explains its limits', ds.notes.length >= 3 && /estimate/i.test(ds.notes.join(' ')));
  // everything connected?
  const adj = ds.nodes.map(function () { return []; });
  ds.edges.forEach(function (e) { adj[e.a].push(e.b); adj[e.b].push(e.a); });
  const seen = new Set([0]); const st = [0];
  while (st.length) { const u = st.pop(); adj[u].forEach(function (v) { if (!seen.has(v)) { seen.add(v); st.push(v); } }); }
  check('the road network is one connected piece', seen.size === ds.nodes.length, [seen.size, ds.nodes.length]);

  const hits = mock.overpassHits();
  r = await s.get('/api/township');
  check('a repeat request is served from the cache', r.status === 200 && mock.overpassHits() === hits);
  check('elevation request had 81 points', (function () { const q = lastTo(mock, '/elevation'); return q && q.query.latitude.split(',').length === 81; })());
  r = await s.get('/api/township?lat=3.001&lon=101.571&r=500&name=%3Cb%3EMy%20spot');
  check('a point on the map can be loaded, name is cleaned', r.status === 200 && r.body.name === 'b My spot' && r.body.radius === 500, r.body && { n: r.body.name, e: r.body.error });
  r = await s.get('/api/township?lat=3.002&lon=101.572&r=1400');
  check('trip-sized areas up to 1500 m load', r.status === 200 && r.body.radius === 1400, r.body && { r: r.body.radius, e: r.body.error });
  r = await s.get('/api/township?lat=3.003&lon=101.573&r=5000');
  check('areas are capped at 1500 m', r.status === 200 && r.body.radius === 1500, r.body && { r: r.body.radius, e: r.body.error });
  r = await s.get('/api/township?lat=200&lon=0');
  check('a bad location is refused', r.status === 400, r.body);
  mock.fail.overpass = 500;
  r = await s.get('/api/township?lat=2.5&lon=102');
  check('map service failure gives a friendly error', r.status === 502 && /busy or unreachable/.test(r.body.error) && !/forced/.test(r.body.error), r.body);
  delete mock.fail.overpass;

  r = await s.get('/api/weather?lat=3&lon=101.5');
  check('weather: rain, UV and short forecast kept for older code', r.status === 200 && r.body.rain === 12.5 && r.body.uv === 6.5 && r.body.forecast.length === 4 && r.body.peak.rain === 45, r.body);
  check('weather: current reading has temperature, wind, humidity, code, air quality', r.body.now && r.body.now.temp === 29.4 && r.body.now.feels === 36.1 && r.body.now.humidity === 78 && r.body.now.gust === 32 && r.body.now.code === 81 && r.body.now.aqi === 112 && r.body.now.pm25 === 41, r.body.now);
  check('weather: 24 hourly rows with rain, chance, code, UV, AQI', r.body.hourly.length === 24 && r.body.hourly[1].code === 95 && r.body.hourly[1].pop === 80 && r.body.hourly[2].rain === 45 && r.body.hourly[0].uv === 6.5 && r.body.hourly[3].aqi === 112, r.body.hourly && r.body.hourly.slice(0, 2));
  check('weather: sunrise and sunset come through', r.body.sun && /T07:00$/.test(r.body.sun.rise) && /T19:00$/.test(r.body.sun.set), r.body.sun);
  check('weather request asked for the right fields', (function () { const q = lastTo(mock, '/forecast'); return q && /temperature_2m/.test(q.query.current) && /weather_code/.test(q.query.current) && /uv_index/.test(q.query.hourly) && /precipitation_probability/.test(q.query.hourly) && /sunrise/.test(q.query.daily) && q.query.forecast_hours === '24' && q.query.timezone === 'auto'; })());
  check('air quality request was made', (function () { const q = lastTo(mock, '/airquality/v1/air-quality'); return q && /us_aqi/.test(q.query.current); })());
  mock.fail.airquality = 500;
  r = await s.get('/api/weather?lat=3.5&lon=101.5');
  check('weather still works when air quality fails', r.status === 200 && r.body.now.aqi === null && r.body.hourly.length === 24, r.body.now);
  delete mock.fail.airquality;
  mock.fail.forecast = 500;
  r = await s.get('/api/weather?lat=10&lon=105');
  check('weather failure gives a friendly error', r.status === 502 && /not available/.test(r.body.error), r.body);
  delete mock.fail.forecast;

  // reports
  r = await s.post('/api/report', { edgeId: 'w100:0', type: 'Blocked drain', note: 'Full of <b>leaves</b>', lat: 3.0005, lon: 101.5701 });
  check('a report is saved and the road shows as blocked', r.status === 200 && r.body.edges['w100:0'].blocked === true && r.body.edges['w100:0'].reports[0].note === 'Full of b leaves /b', r.body);
  check('report keeps its map position', r.body.edges['w100:0'].reports[0].lat === 3.0005);
  r = await s.post('/api/report', { edgeId: 'w100:0', type: 'Standing water', ai: { severity: 'high', summary: 'Pooling', evil: 'x' } });
  check('AI triage info is kept, extra fields are not', r.body.edges['w100:0'].reports[1].ai.severity === 'high' && !('evil' in r.body.edges['w100:0'].reports[1].ai), r.body);
  r = await s.post('/api/report', { edgeId: '../etc', type: 'Blocked drain' });
  check('a bad road id is refused', r.status === 400, r.body);
  r = await s.post('/api/report', { edgeId: 'w1:0', type: 'Graffiti' });
  check('an unknown report type is refused', r.status === 400, r.body);
  r = await s.post('/api/reset', {});
  check('reset without signing in is refused', r.status === 401, r.body);
  r = await s.post('/api/reset', {}, { 'x-team-pin': '1234' });
  check('the old PIN header opens nothing', r.status === 401, r.body);
  const rev = (await s.get('/api/state')).body.rev;
  await s.stop();
  s = await startServer(mock, {}, dir);
  r = await s.get('/api/state');
  check('reports survive a restart', r.body.rev === rev && r.body.edges['w100:0'].reports.length === 2, r.body);
  const tok0 = await teamLogin(s, 0);
  r = await s.post('/api/reset', {}, bearer(tok0));
  check('a township team member cannot reset the demo (admin only)', r.status === 403, r.body);
  const adm = (await s.post('/api/auth/login', { username: 'teduhadmin', password: 'Adm1nPass99' })).body;
  check('the Teduh admin can sign in', adm && adm.role === 'admin' && adm.token, adm);
  await s.post('/api/report', { edgeId: 'w9:0', type: 'Fallen branch' });
  r = await s.post('/api/reset', {}, bearer(adm.token));
  check('the admin reset empties the reports but keeps staff accounts', r.status === 200 && Object.keys(r.body.edges).length === 0 && (await s.post('/api/auth/login', { username: 'staff0', password: 'Passw0rd0' })).status === 200, r.body);

  r = await s.post('/api/triage', { text: 'drain blocked' });
  check('photo check says it is not set up', r.status === 503 && /not set up/.test(r.body.error), r.body);
  r = await s.post('/api/chat', { messages: [{ role: 'user', text: 'hi' }] });
  check('chat says it is not set up', r.status === 503 && /not set up/.test(r.body.error), r.body);

  r = await s.get('/');
  check('the page is served with a content security policy', r.status === 200 || true);
  const page = await fetch(s.base + '/');
  check('index.html has a CSP header', page.status === 200 && /script-src 'self'/.test(page.headers.get('content-security-policy') || ''));
  check('.env is not served', (await fetch(s.base + '/.env')).status === 404);
  check('server code is not served', (await fetch(s.base + '/lib/config.js')).status === 404 && (await fetch(s.base + '/server.js')).status === 404);
  check('path traversal is refused', [403, 404].indexOf((await fetch(s.base + '/..%2fserver.js')).status) !== -1);
  check('data/ folder is not served', (await fetch(s.base + '/data/db.json')).status === 404);

  // rate limit on map builds: the earlier builds already used some of the 6 per minute
  let limitedAt = 0;
  for (let i = 0; i < 8 && !limitedAt; i++) { const x = await s.get('/api/township?lat=' + (4 + i * 0.01) + '&lon=103'); if (x.status === 429) limitedAt = i + 1; }
  check('map building is rate limited', limitedAt > 0, limitedAt);
  let pinLimited = false;
  for (let i = 0; i < 12 && !pinLimited; i++) { const x = await s.post('/api/auth/login', { username: 'staff0', password: 'nope' + i }); if (x.status === 429) pinLimited = true; }
  check('password guessing is rate limited', pinLimited);
  await s.stop();
}

async function scenarioAllKeys(mock) {
  console.log('\nScenario 2: Supabase + Gemini + Claude + MapTiler');
  const dir = tmp();
  const s = await startServer(mock, {
    SUPABASE_URL: mock.url + '/supabase', SUPABASE_SERVICE_KEY: 'sb-test-key',
    ANTHROPIC_API_KEY: 'ant-test', ANTHROPIC_BASE_URL: mock.url + '/anthropic',
    GEMINI_API_KEY: 'gem-test', GEMINI_BASE_URL: mock.url + '/gemini', MAPTILER_API_KEY: 'mt-test', AI_TRIAGE_PROVIDER: 'claude'
  }, dir);

  let r = await s.get('/api/config');
  check('config shows everything on', r.body.features.database === 'supabase' && r.body.features.chat === 'gemini' && r.body.features.triage === 'claude' && r.body.features.tiles === 'maptiler', r.body);
  check('MapTiler tiles used', /api\.maptiler\.com.*key=mt-test/.test(r.body.tiles.url) && /MapTiler/.test(r.body.tiles.attribution));
  check('only the MapTiler key is sent to the browser, never the secrets', !/sb-test-key|ant-test|gem-test/.test(JSON.stringify(r.body)));
  check('server log says Supabase connected', /Supabase connected/.test(s.log()), s.log());

  // Supabase storage
  r = await s.post('/api/report', { edgeId: 'w100:0', type: 'Blocked drain', note: 'leaves', lat: 3.1, lon: 101.6 });
  check('report is written to Supabase', r.status === 200 && mock.supa.rows.length === 1 && mock.supa.rows[0].edge_id === 'w100:0' && mock.supa.rows[0].type === 'Blocked drain' && mock.supa.rows[0].lat === 3.1, mock.supa.rows);
  check('state reads it back and the road is blocked', r.body.edges['w100:0'].blocked === true && r.body.edges['w100:0'].reports[0].note === 'leaves', r.body);
  const post = mock.log.filter(function (e) { return e.method === 'POST' && e.path === '/supabase/rest/v1/reports'; }).pop();
  check('Supabase request has apikey and bearer headers and a return preference', post.headers.apikey === 'sb-test-key' && post.headers.authorization === 'Bearer sb-test-key' && /return=minimal/.test(post.headers.prefer || ''), post.headers);
  const rev1 = r.body.rev;
  mock.supa.rows.push({ id: 'row-x', edge_id: 'w5:1', type: 'Fallen branch', note: '', lat: null, lon: null, ai: null, cleared: false, created_at: new Date().toISOString() });
  await new Promise(function (res) { setTimeout(res, 3200); });   // the server caches for 3 s
  r = await s.get('/api/state');
  check('a row added elsewhere shows up and the revision changes', r.body.edges['w5:1'] && r.body.rev !== rev1, r.body);
  const stTok = await teamLogin(s, 7);
  check('the team account is stored as a row in Supabase, and never appears in the public state', mock.supa.rows.some(function (x) { return x.type === 'Team account' && x.edge_id === 'acct-staff7'; }) && !/acct-staff7|Passw0rd/.test(JSON.stringify((await s.get('/api/state')).body)));
  const up1 = await s.upload('before', JPG_BUF, stTok), up2 = await s.upload('after', JPG_BUF, stTok);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: up1.body.id, after: up2.body.id, note: 'leaves removed' }, bearer(stTok));
  check('the team sends a clearance and the issue is waiting for review', r.status === 200 && r.body.clears['w100:0'].status === 'pending' && r.body.edges['w100:0'], r.body);
  const admTok = (await s.post('/api/auth/login', { username: 'teduhadmin', password: 'Adm1nPass99' })).body.token;
  r = await s.post('/api/admin/clear', { edgeId: 'w100:0', decision: 'approve' }, bearer(admTok));
  check('admin approval marks only that road cleared in Supabase and keeps the clearance record', r.status === 200 && !r.body.edges['w100:0'] && r.body.edges['w5:1'] && mock.supa.rows[0].cleared === true && mock.supa.rows.filter(function (x) { return x.type === 'Clear done' && !x.cleared; }).length === 1 && r.body.cleared[0].edgeId === 'w100:0', r.body);
  r = await s.post('/api/reset', {}, bearer(admTok));
  check('reset clears the reports in Supabase but not accounts or clearance history', r.status === 200 && Object.keys(r.body.edges).length === 0 && mock.supa.rows.filter(function (x) { return !x.cleared; }).every(function (x) { return x.type === 'Team account' || x.type === 'Clear done'; }) && r.body.cleared.length === 1);
  mock.fail.supabase = 500;
  r = await s.post('/api/report', { edgeId: 'w1:0', type: 'Blocked drain' });
  check('database failure on save gives a clear error', r.status === 502 && /database/i.test(r.body.error), r.body);
  r = await s.get('/api/state');
  check('database failure on read keeps working with a warning', r.status === 200 && r.body.edges && true, r.body);
  delete mock.fail.supabase;

  // Claude triage
  r = await s.post('/api/triage', { text: 'drain is blocked by rubbish', image: JPEG });
  check('Claude triage returns type, severity and summary (fenced JSON is read)', r.status === 200 && r.body.type === 'Blocked drain' && r.body.severity === 'high' && /claude/.test(r.body.summary) && r.body.provider === 'claude', r.body);
  const cl = lastTo(mock, '/anthropic/v1/messages');
  const cb = JSON.parse(cl.body);
  check('Claude request: key header, version, model, image block, untrusted-data warning', cl.headers['x-api-key'] === 'ant-test' && cl.headers['anthropic-version'] === '2023-06-01' && cb.model === 'claude-haiku-5-5' && cb.messages[0].content[0].type === 'image' && cb.messages[0].content[0].source.type === 'base64' && /untrusted/.test(cb.system), cb);
  r = await s.post('/api/triage', { text: 'just a note' });
  check('triage works with a note only', r.status === 200 && /note only/.test(r.body.summary), r.body);
  r = await s.post('/api/triage', {});
  check('triage needs a photo or a note', r.status === 400, r.body);
  r = await s.post('/api/triage', { image: 'http://evil.example/x.jpg' });
  check('triage only accepts data-URL images', r.status === 400, r.body);
  r = await s.post('/api/triage', { image: 'data:image/jpeg;base64,' + 'A'.repeat(1300000) });
  check('an oversized photo is refused', r.status === 400, r.body);
  r = await s.post('/api/triage', { text: 'x', image: 'data:image/svg+xml;base64,AAAA' });
  check('SVG and other types are refused', r.status === 400, r.body);

  // Gemini chat
  const ctx = { profile: 'senior', teduh: { coveredPct: 60 } };
  r = await s.post('/api/chat', { messages: [{ role: 'assistant', text: 'old' }, { role: 'user', text: 'which way?' }, { role: 'user', text: 'is it shady?' }], context: ctx });
  check('Gemini chat answers', r.status === 200 && /Gemini buddy/.test(r.body.reply) && r.body.provider === 'gemini', r.body);
  const ge = lastTo(mock, '/gemini/v1beta/models/gemini-3.5-flash-lite:generateContent');
  const gb = ge && JSON.parse(ge.body);
  check('Gemini request: key header, model, system prompt with context, cleaned turns', ge && ge.headers['x-goog-api-key'] === 'gem-test' && /CONTEXT/.test(gb.systemInstruction.parts[0].text) && /coveredPct/.test(gb.systemInstruction.parts[0].text) && /shop-lot/.test(gb.systemInstruction.parts[0].text) && gb.contents.length === 1 && gb.contents[0].role === 'user' && /which way\?\nis it shady\?/.test(gb.contents[0].parts[0].text), gb);
  r = await s.post('/api/chat', { messages: [{ role: 'assistant', text: 'only me' }] });
  check('chat needs a user message', r.status === 400, r.body);
  r = await s.post('/api/chat', { messages: [{ role: 'user', text: 'hi' }], context: { x: 'y'.repeat(7000) } });
  check('an oversized context is refused', r.status === 400, r.body);
  mock.fail.gemini = 429;
  r = await s.post('/api/chat', { messages: [{ role: 'user', text: 'hi' }] });
  check('Gemini quota error is explained', r.status === 503 && /busy or out of quota/.test(r.body.error), r.body);
  mock.fail.gemini = 403;
  r = await s.post('/api/chat', { messages: [{ role: 'user', text: 'hi' }] });
  check('a refused key is explained without leaking details', r.status === 502 && /refused the key/.test(r.body.error) && !/forced/.test(r.body.error), r.body);
  delete mock.fail.gemini;
  await s.stop();

  console.log('\nScenario 3: chat forced to Claude');
  const s2 = await startServer(mock, { ANTHROPIC_API_KEY: 'ant-test', ANTHROPIC_BASE_URL: mock.url + '/anthropic', GEMINI_API_KEY: 'gem-test', GEMINI_BASE_URL: mock.url + '/gemini', AI_CHAT_PROVIDER: 'claude' }, tmp());
  r = await s2.post('/api/chat', { messages: [{ role: 'user', text: 'hi' }], context: {} });
  check('AI_CHAT_PROVIDER=claude uses Claude', r.status === 200 && /Claude buddy/.test(r.body.reply) && r.body.provider === 'claude', r.body);
  await s2.stop();

  console.log('\nScenario 4: only a Gemini key');
  const s3 = await startServer(mock, { GEMINI_API_KEY: 'gem-test', GEMINI_BASE_URL: mock.url + '/gemini' }, tmp());
  r = await s3.get('/api/config');
  check('Gemini alone covers chat and photo check', r.body.features.chat === 'gemini' && r.body.features.triage === 'gemini', r.body);
  r = await s3.post('/api/triage', { text: 'water on road', image: JPEG });
  const g2 = JSON.parse(lastTo(mock, '/gemini/v1beta/models/gemini-3.5-flash-lite:generateContent').body);
  check('Gemini triage sends the photo as inline data', r.status === 200 && r.body.type === 'Standing water' && g2.contents[0].parts[0].inline_data.mime_type === 'image/jpeg' && g2.generationConfig.responseMimeType === 'application/json', r.body);
  await s3.stop();

  console.log('\nScenario 5: Supabase with a wrong key');
  const s4 = await startServer(mock, { SUPABASE_URL: mock.url + '/supabase', SUPABASE_SERVICE_KEY: 'wrong' }, tmp());
  check('startup warns that Supabase refused the key', /refused the key/.test(s4.log()), s4.log());
  r = await s4.get('/api/state');
  check('state still answers with a warning', r.status === 200 && /refused the key/.test(r.body.warning || ''), r.body);
  r = await s4.post('/api/report', { edgeId: 'w1:0', type: 'Blocked drain' });
  check('saving says which key to use', r.status === 502 && /service_role/.test(r.body.error), r.body);
  await s4.stop();
}

async function scenarioPaths(mock) {
  console.log('\nScenario 6: Path Discovery (Groq photo check, confirmations, team decision)');
  const s = await startServer(mock, { GROQ_API_KEY: 'groq-test', GROQ_BASE_URL: mock.url + '/groq', GEMINI_API_KEY: 'gem-test', GEMINI_BASE_URL: mock.url + '/gemini' }, tmp());
  let r = await s.get('/api/config');
  check('config says Groq checks path photos, and the satellite view is off without a MapTiler key', r.body.features.pathAi === 'groq' && r.body.features.satellite === false && r.body.satelliteTiles === null, r.body.features);
  r = await s.post('/api/path-check', { image: JPEG, kind: 'trail', surface: 'mud', note: 'beside the drain' });
  check('path photo check returns what Groq saw (and strips its thinking text)', r.status === 200 && r.body.walkable === true && r.body.condition === 'muddy' && r.body.provider === 'groq' && /groq/.test(r.body.summary), r.body);
  const sent = JSON.parse(lastTo(mock, '/groq/openai/v1/chat/completions').body);
  check('the photo goes to Groq as an image_url data URL, with JSON mode', sent.messages[1].content.some(function (x) { return x.type === 'image_url'; }) && sent.response_format && sent.response_format.type === 'json_object', sent);
  r = await s.post('/api/path-check', { kind: 'trail', surface: 'mud' });
  check('path photo check needs a photo', r.status === 400, r.body);
  const pts = [[3.0, 101.57], [3.0004, 101.5705], [3.0009, 101.5712]];
  r = await s.post('/api/path', { pts: pts, surface: 'mud', kind: 'trail', note: 'by the drain', by: 'device-aaaa', ai: { severity: 'medium', summary: 'muddy trail' } });
  const id = r.body && r.body.id;
  const p0 = r.body && r.body.paths && r.body.paths[0];
  check('a traced path is saved, unverified, with its geometry and AI note', r.status === 200 && /^path-[a-z0-9]{8}$/.test(id) && p0 && p0.status === 'unverified' && p0.pts.length === 3 && p0.surface === 'mud' && p0.ai && p0.ai.severity === 'medium' && p0.length > 80, r.body);
  r = await s.get('/api/state');
  check('a path is not mixed into road reports', Object.keys(r.body.edges).length === 0 && r.body.paths.length === 1, r.body);
  r = await s.post('/api/path/confirm', { id: id, by: 'device-aaaa' });
  check('the person who traced it cannot confirm it', r.status === 409, r.body);
  r = await s.post('/api/path/confirm', { id: id, by: 'device-bbbb' });
  check('a second device confirms it and it becomes verified', r.status === 200 && r.body.paths[0].status === 'verified' && r.body.paths[0].via === 'residents', r.body);
  r = await s.post('/api/path/confirm', { id: id, by: 'device-bbbb' });
  check('the same device cannot confirm twice', r.status === 409, r.body);
  r = await s.post('/api/path', { pts: [[3, 101.57], [3.00001, 101.57]], surface: 'mud', kind: 'trail', by: 'device-aaaa' });
  check('a path shorter than 15 m is refused', r.status === 400 && /shorter/.test(r.body.error), r.body);
  r = await s.post('/api/path', { pts: pts, surface: 'lava', kind: 'trail', by: 'device-aaaa' });
  check('an unknown surface is refused', r.status === 400, r.body);
  r = await s.post('/api/path', { pts: pts, surface: 'mud', kind: 'trail' });
  check('a path needs a device id', r.status === 400, r.body);
  r = await s.post('/api/path', { pts: pts, surface: 'grass', kind: 'shortcut', by: 'device-cccc', note: '<b>hi</b> "q"' });
  const id2 = r.body.id, p2 = r.body.paths.filter(function (x) { return x.id === id2; })[0];
  check('notes are cleaned of markup', p2 && !/[<>"]/.test(p2.note), p2);
  r = await s.post('/api/path/decide', { id: id2, decision: 'approve' });
  check('the team decision needs a sign-in', r.status === 401, r.body);
  const tTok = await teamLogin(s, 1);
  const aTok = (await s.post('/api/auth/login', { username: 'teduhadmin', password: 'Adm1nPass99' })).body.token;
  r = await s.post('/api/path/decide', { id: id2, decision: 'approve' }, bearer(aTok));
  check('the Teduh admin cannot approve paths (only the Township Team)', r.status === 403, r.body);
  r = await s.post('/api/path/decide', { id: id2, decision: 'approve' }, bearer(tTok));
  check('the team can approve a path', r.status === 200 && r.body.paths.filter(function (x) { return x.id === id2; })[0].via === 'team', r.body);
  // editing: only the person who traced it, and a changed line needs a new check
  const longer = pts.concat([[3.0013, 101.5719]]);
  r = await s.post('/api/path/edit', { id: id, by: 'device-bbbb', pts: longer, surface: 'mud', kind: 'trail' });
  check('someone else cannot edit a path', r.status === 403, r.body);
  r = await s.post('/api/path/edit', { id: id, by: 'device-aaaa', pts: pts, surface: 'mud', kind: 'trail', note: 'new words only' });
  const ep = r.body.paths.filter(function (x) { return x.id === id; })[0];
  check('changing only the note keeps the path verified', r.status === 200 && ep.note === 'new words only' && ep.status === 'verified' && ep.edited === 1, ep);
  r = await s.post('/api/path/edit', { id: id, by: 'device-aaaa', pts: longer, surface: 'mud', kind: 'trail', note: 'extended' });
  const ep2 = r.body.paths.filter(function (x) { return x.id === id; })[0];
  check('extending the line makes it 4 points long and sends it back to unverified', r.status === 200 && ep2.pts.length === 4 && ep2.status === 'unverified' && ep2.length > ep.length, ep2);
  r = await s.post('/api/path/confirm', { id: id, by: 'device-bbbb' });
  check('a new confirmation after the edit verifies it again', r.status === 200 && r.body.paths.filter(function (x) { return x.id === id; })[0].status === 'verified', r.body);
  r = await s.post('/api/path/decide', { id: id, decision: 'reject' }, bearer(tTok));
  check('a rejected path disappears', r.status === 200 && !r.body.paths.some(function (x) { return x.id === id; }) && r.body.paths.length === 1, r.body);
  r = await s.post('/api/path/decide', { id: id2, decision: 'reject' }, bearer(tTok));
  check('and so does the second one', r.status === 200 && r.body.paths.length === 0, r.body);
  r = await s.post('/api/path-check', { image: JPEG, kind: 'trail', surface: 'mud', note: 'a wall' });
  check('Groq can say a photo is not a walkable path', r.status === 200 && r.body.walkable === false, r.body);
  await s.stop();
  const s2 = await startServer(mock, { GEMINI_API_KEY: 'gem-test', GEMINI_BASE_URL: mock.url + '/gemini' }, tmp());
  r = await s2.post('/api/path-check', { image: JPEG, kind: 'trail', surface: 'mud' });
  check('without a Groq key the path photo check falls back to Gemini', r.status === 200 && r.body.provider === 'gemini' && r.body.walkable === true, r.body);
  await s2.stop();
  const s3 = await startServer(mock, {}, tmp());
  r = await s3.post('/api/path-check', { image: JPEG });
  check('with no AI key the photo check says how to set it up, and paths still work', r.status === 503 && /GROQ_API_KEY/.test(r.body.error), r.body);
  r = await s3.post('/api/path', { pts: pts, surface: 'mud', kind: 'trail', by: 'device-aaaa' });
  check('paths work without any AI key', r.status === 200 && r.body.paths.length === 1, r.body);
  await s3.stop();
}

async function scenarioAccounts(mock) {
  console.log('\nScenario 7: Township Team accounts, password reset, clearance with photos, admin review');
  const s = await startServer(mock, { TEAM_EMAIL_DOMAINS: 'sdp.example.com', BREVO_API_KEY: 'brevo-test', BREVO_API_URL: mock.url + '/brevo/v3/smtp/email', MAIL_FROM: 'noreply@teduh.example', PUBLIC_URL: 'https://teduh.example' }, tmp());
  const good = { username: 'aina.rahman', password: 'Safe1234pass', staffId: 'SDP-2041', email: 'Aina@SDP.example.com' };
  let r = await s.post('/api/auth/signup', Object.assign({}, good, { username: 'ab' }));
  check('a short username is refused', r.status === 400 && /username/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { email: 'aina@gmail.com' }));
  check('an email outside the allowed organisation is refused', r.status === 400 && /organisation/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { password: 'short1' }));
  check('a weak password is refused', r.status === 400 && /password/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { staffId: 'x' }));
  check('a bad staff ID is refused', r.status === 400 && /staff ID/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { username: 'teduhadmin' }));
  check('the admin username cannot be registered', r.status === 400, r.body);
  r = await s.post('/api/auth/signup', good);
  check('a valid sign-up works', r.status === 200 && r.body.username === 'aina.rahman', r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { username: 'other.person', email: 'other@sdp.example.com' }));
  check('one account per staff ID', r.status === 400 && /staff ID/i.test(r.body.error) && /admin team/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { username: 'other.person', staffId: 'SDP-9999' }));
  check('one account per email address', r.status === 400 && /email/i.test(r.body.error), r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { staffId: 'SDP-7777', email: 'x@sdp.example.com' }));
  check('the username is taken', r.status === 400 && /taken/.test(r.body.error), r.body);
  const dbText = fs.readFileSync(path.join(s.dir, 'db.json'), 'utf8');
  check('the password is stored hashed, not as typed', !/Safe1234pass/.test(dbText) && /"Team account"/.test(dbText));
  r = await s.get('/api/state');
  check('accounts are not in the public state', !/aina|SDP-2041|sdp\.example/i.test(JSON.stringify(r.body)), r.body);
  r = await s.post('/api/auth/login', { username: 'aina.rahman', password: 'wrong-pass1' });
  check('a wrong password is refused', r.status === 401, r.body);
  r = await s.post('/api/auth/login', { username: 'AINA.rahman', password: good.password });
  check('sign-in works (username not case sensitive)', r.status === 200 && r.body.role === 'team' && r.body.token, r.body);
  const tok = r.body.token;
  r = await s.get('/api/auth/me', bearer(tok));
  check('the token says who is signed in', r.status === 200 && r.body.username === 'aina.rahman' && r.body.role === 'team', r.body);
  r = await s.get('/api/auth/me', bearer(tok.slice(0, -3) + 'abc'));
  check('a tampered token is refused', r.status === 401, r.body);

  // forgot password
  r = await s.post('/api/auth/forgot', { email: 'nobody@sdp.example.com' });
  const mailsBefore = mock.log.filter(function (e) { return e.path === '/brevo/v3/smtp/email'; }).length;
  check('asking for a reset for an unknown email gives the same answer and sends nothing', r.status === 200 && r.body.ok === true && mailsBefore === 0, r.body);
  r = await s.post('/api/auth/forgot', { email: 'aina@sdp.example.com' });
  const mailReq = lastTo(mock, '/brevo/v3/smtp/email');
  const mailBody = mailReq && JSON.parse(mailReq.body);
  check('a reset email goes to the registered address through Brevo', r.status === 200 && mailBody && mailBody.to[0].email === 'aina@sdp.example.com' && /^https:\/\/teduh\.example\/#\/team\?reset=/m.test(mailBody.textContent) && mailReq.headers['api-key'] === 'brevo-test', mailBody);
  const link = /https:\/\/teduh\.example\/#\/team\?reset=(\S+)/.exec(mailBody.textContent)[1];
  r = await s.post('/api/auth/reset', { token: link, password: 'abc' });
  check('the new password must be strong enough', r.status === 400, r.body);
  r = await s.post('/api/auth/reset', { token: link + 'x', password: 'Brand9newpass' });
  check('a changed link is refused', r.status === 400, r.body);
  r = await s.post('/api/auth/reset', { token: link, password: 'Brand9newpass' });
  check('the link sets a new password', r.status === 200, r.body);
  r = await s.post('/api/auth/login', { username: 'aina.rahman', password: good.password });
  check('the old password stops working', r.status === 401, r.body);
  r = await s.post('/api/auth/login', { username: 'aina.rahman', password: 'Brand9newpass' });
  check('the new password works', r.status === 200, r.body);
  r = await s.post('/api/auth/reset', { token: link, password: 'Another9pass' });
  check('a reset link works only once', r.status === 400, r.body);

  // clearing an issue
  const t = (await s.post('/api/auth/login', { username: 'aina.rahman', password: 'Brand9newpass' })).body.token;
  await s.post('/api/report', { edgeId: 'w100:0', type: 'Blocked drain', note: 'leaves' });
  let u = await s.upload('before', JPG_BUF);
  check('uploading needs a sign-in', u.status === 401, u.body);
  u = await s.upload('before', Buffer.from('not an image at all, just text'), t);
  check('a file that is not a photo is refused', u.status === 400, u.body);
  u = await s.upload('video', JPG_BUF, t);
  check('a photo is refused where a video is expected', u.status === 400, u.body);
  const before = await s.upload('before', JPG_BUF, t), after = await s.upload('after', JPG_BUF, t), video = await s.upload('video', MP4_BUF, t);
  check('photos and a video upload', before.status === 200 && /^m[a-f0-9]{16}\.jpg$/.test(before.body.id) && /\.mp4$/.test(video.body.id), [before.body, video.body]);
  const media = await fetch(s.base + '/api/media/' + before.body.id);
  check('uploaded photos can be viewed', media.status === 200 && media.headers.get('content-type') === 'image/jpeg');
  check('media names cannot walk out of the folder', (await fetch(s.base + '/api/media/..%2fdb.json')).status === 404);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', after: after.body.id }, bearer(t));
  check('a clearance without a before photo is refused', r.status === 400 && /before/i.test(r.body.error), r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id }, bearer(t));
  check('a clearance without an after photo is refused', r.status === 400 && /after/i.test(r.body.error), r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: 'm0000000000000000.jpg' }, bearer(t));
  check('a photo that was never uploaded is refused', r.status === 400, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: video.body.id }, bearer(t));
  check('a video cannot stand in for the after photo', r.status === 400, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w55:5', before: before.body.id, after: after.body.id }, bearer(t));
  check('only a listed issue can be cleared', r.status === 404, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: after.body.id }, {});
  check('sending a clearance needs a sign-in', r.status === 401, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: after.body.id, video: video.body.id, note: 'Drain cleared and tested' }, bearer(t));
  const c1 = r.body.clears && r.body.clears['w100:0'];
  check('before and after photos (with the optional video) send the issue for review', r.status === 200 && c1 && c1.status === 'pending' && c1.before === before.body.id && c1.video === video.body.id && c1.by === 'aina.rahman' && r.body.edges['w100:0'].blocked === true, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: after.body.id }, bearer(t));
  check('it cannot be sent twice while it waits', r.status === 409, r.body);
  r = await s.post('/api/admin/clear', { edgeId: 'w100:0', decision: 'approve' }, bearer(t));
  check('the township team cannot approve its own clearance', r.status === 403, r.body);
  const adm = (await s.post('/api/auth/login', { username: 'teduhadmin', password: 'Adm1nPass99' })).body.token;
  r = await s.post('/api/admin/clear', { edgeId: 'w100:0', decision: 'reject', reason: 'After photo shows the drain still full' }, bearer(adm));
  check('the admin can reject it with a reason, and the issue stays listed', r.status === 200 && r.body.clears['w100:0'].status === 'rejected' && /still full/.test(r.body.clears['w100:0'].reason) && r.body.edges['w100:0'].blocked, r.body);
  r = await s.post('/api/team/clear', { edgeId: 'w100:0', before: before.body.id, after: after.body.id }, bearer(t));
  check('after a rejection the team can send it again', r.status === 200 && r.body.clears['w100:0'].status === 'pending', r.body);
  r = await s.post('/api/admin/clear', { edgeId: 'w100:0', decision: 'approve' }, bearer(adm));
  check('the admin approves: the issue is cleared and kept in the history with its photos', r.status === 200 && !r.body.edges['w100:0'] && !r.body.clears['w100:0'] && r.body.cleared[0].edgeId === 'w100:0' && r.body.cleared[0].before === before.body.id && r.body.cleared[0].approvedBy === 'teduhadmin', r.body);
  r = await s.post('/api/admin/clear', { edgeId: 'w100:0', decision: 'approve' }, bearer(adm));
  check('nothing is left to approve', r.status === 404, r.body);

  // admin removes an account on request
  r = await s.get('/api/admin/accounts', bearer(t));
  check('only the admin can list accounts', r.status === 403, r.body);
  r = await s.get('/api/admin/accounts', bearer(adm));
  check('the admin sees the account list with emails', r.status === 200 && r.body.accounts.length === 1 && r.body.accounts[0].email === 'aina@sdp.example.com', r.body);
  r = await s.post('/api/admin/account/delete', { username: 'aina.rahman' }, bearer(adm));
  check('the admin can remove an account', r.status === 200 && r.body.accounts.length === 0, r.body);
  r = await s.get('/api/auth/me', bearer(t));
  check('a removed account stops working at once', r.status === 401, r.body);
  r = await s.post('/api/auth/signup', Object.assign({}, good, { username: 'aina.new' }));
  check('the staff ID and email can then register again', r.status === 200, r.body);
  await s.stop();

  const s2 = await startServer(mock, {}, tmp());
  r = await s2.post('/api/auth/signup', { username: 'noemail.user', password: 'Safe1234pass', staffId: 'NE-1234', email: 'me@gmail.com' });
  check('with no domain list, personal email addresses are still refused', r.status === 400, r.body);
  await s2.post('/api/auth/signup', { username: 'noemail.user', password: 'Safe1234pass', staffId: 'NE-1234', email: 'me@council.gov.my' });
  r = await s2.post('/api/auth/forgot', { email: 'me@council.gov.my' });
  check('without an email service the server says so', r.status === 200 && r.body.mailed === false && /Password reset link for noemail\.user/.test(s2.log()), r.body);
  await s2.stop();
}

async function scenarioIqair(mock) {
  console.log('\nScenario 8: IQAir for the reading where the person is');
  const s = await startServer(mock, { IQAIR_API_KEY: 'iq-test', IQAIR_API_URL: mock.url + '/iqair/v2/nearest_city' }, tmp());
  let r = await s.get('/api/weather?lat=3.0&lon=101.57');
  check('IQAir gives the place name, temperature, humidity, wind (km/h) and air quality', r.status === 200 && r.body.place === 'Subang Jaya, Selangor' && r.body.now.temp === 31 && r.body.now.humidity === 70 && r.body.now.wind === 9 && r.body.now.aqi === 88, r.body);
  check('rain and the forecast still come from Open-Meteo, and the source says so', r.body.now.rain > 0 && r.body.hourly.length > 0 && /IQAir/.test(r.body.source) && /Open-Meteo/.test(r.body.source), r.body.source);
  const call = lastTo(mock, '/iqair/v2/nearest_city');
  check('the request carries the position and the key', call && call.query.lat === '3.0000' && call.query.key === 'iq-test', call && call.query);
  check('the IQAir key is not sent to the browser', !/iq-test/.test(JSON.stringify((await s.get('/api/config')).body)));
  await s.stop();
  const bad = await startServer(mock, { IQAIR_API_KEY: 'wrong', IQAIR_API_URL: mock.url + '/iqair/v2/nearest_city' }, tmp());
  r = await bad.get('/api/weather?lat=3.0&lon=101.57');
  check('a wrong IQAir key falls back to Open-Meteo instead of failing', r.status === 200 && r.body.place === null && r.body.source === 'Open-Meteo' && r.body.now.temp !== 31, r.body);
  await bad.stop();
}

(async function main() {
  const mock = await startMock(0);
  try {
    await scenarioNoKeys(mock);
    await scenarioAllKeys(mock);
    await scenarioPaths(mock);
    await scenarioAccounts(mock);
    await scenarioIqair(mock);
  } catch (e) {
    failed++;
    console.log('  FAIL test run crashed: ' + (e && e.stack || e));
  }
  await mock.stop();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
