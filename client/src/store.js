// The app's state and actions, shared by every page. This is the logic of the classic page without any
// page markup: the pages (React) only read `ui` and call the actions below, and the journey, the clock
// and the weather keep running while you move between pages.
import { L, Wx, Nav, Api, TMap, Sample } from './engines.js';

// ---------- small helpers ----------

export function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
export function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
export function round1(n) { return Math.round(n * 10) / 10; }
export function shortHour(h) { const t = ((Math.round(h) % 24) + 24) % 24; return (t % 12 || 12) + (t >= 12 ? ' pm' : ' am'); }
function friendlyError(e) { return e && e.message ? e.message : 'Something went wrong'; }

export const ui = {
  profile: 'pedestrian',
  start: null, dest: null, pick: 'teduh',
  tool: null, notice: '', showAll: false,
  online: false, rev: -1, lastState: null, tiles: null, features: {},
  wx: null, wxErr: '', wxAt: 0, wxBusy: false, preview: null, sim: null,
  clock: Wx.klNow(), c: null, cur: { S: null, T: null, line: null, stats: null }, tripW: null, tripMin: null,
  areaMsg: '', planMsg: '', loading: false, ready: false, dataNotes: [],
  report: null, chat: [], chatBusy: false,
  pin: '', teamNote: '', teamErr: false,
  me: null, nav: null, follow: false, voice: (function () { try { return localStorage.getItem('teduhVoice') !== '0'; } catch (e) { return true; } })(), locating: false,
  mapMode: 'plan',
  auth: (function () { try { const o = JSON.parse(localStorage.getItem('teduhAuth') || 'null'); return o && o.token && o.x > Date.now() ? o : null; } catch (e) { return null; } })(),
  authView: 'login', authBusy: false, authMsg: '', authErr: false, resetToken: '', accounts: [], clears: {}, cleared: [], clearForm: null,
  paths: [], pathDraw: null, pathSel: null, satellite: false, satTiles: null, pathNote: '', pathBusy: false
};
let G = null, TRIPS = [], USAGE = {}, INITIAL = [], tmap = null, mapEl = null, fitPending = false;
export function getG() { return G; }
export function getTrips() { return TRIPS; }
export function getUsage() { return USAGE; }
export function profile() { return L.PROFILES[ui.profile]; }

// ---------- subscriptions (React reads through these) ----------

let version = 0;
const subs = new Set(), clockSubs = new Set();
export function subscribe(fn) { subs.add(fn); return function () { subs.delete(fn); }; }
export function getVersion() { return version; }
export function subscribeClock(fn) { clockSubs.add(fn); return function () { clockSubs.delete(fn); }; }
let clockVersion = 0;
export function getClockVersion() { return clockVersion; }
// bump(): something changed, redraw the pages. update(): also work out the routes, flood risk and map again.
export function bump() { version++; subs.forEach(function (f) { f(); }); }

function nodeOf(pt) { return pt && pt.node !== undefined ? pt.node : -1; }

// ---------- wording ----------

export function sunWord(c) {
  if (c.dark > 0.6) return 'dark';
  const s = c.sunLoad;
  return s < 0.12 ? 'little direct sun' : s < 0.4 ? 'moderate sun' : s < 0.75 ? 'strong sun' : 'peak sun';
}

// ---------- the clock and the weather at this moment ----------

export function liveClock() { return { h: ui.clock.h, dateKey: ui.clock.dateKey }; }
export function viewClock() { return ui.preview ? { h: ui.preview.h, dateKey: ui.preview.day } : liveClock(); }
export function curSample() {
  if (!ui.wx) return null;
  if (ui.preview) {
    const s = Wx.sample(ui.wx, ui.preview.day, ui.preview.h);
    return s ? Object.assign({ isDay: Wx.isDayAt(ui.wx, ui.preview.h) }, s) : null;
  }
  return Wx.nowSample(ui.wx);
}

function computeConds() {
  const sun = Wx.sunHours(ui.wx), p = curSample(), vc = viewClock();
  L.viewHour = vc.h;
  const uv = p && p.uv !== null && p.uv !== undefined ? p.uv : null;
  let rain = ui.sim !== null ? ui.sim : (p ? p.rain || 0 : 0);
  ui.tripW = null; ui.tripMin = null;
  const a = nodeOf(ui.start), b = nodeOf(ui.dest);
  if (G && ui.wx && ui.sim === null && a >= 0 && b >= 0 && a !== b) {
    const c0 = L.conditions(rain, vc.h, uv, sun);
    const S0 = L.route(G, a, b, 'standard', c0, ui.profile);
    if (S0) {
      ui.tripMin = L.stats(S0, c0, ui.profile).min;
      ui.tripW = Wx.tripWeather(ui.wx, vc, ui.tripMin, 3, 0, !ui.preview);
      rain = Math.max(rain, ui.tripW.maxRain);       // flood risk follows the worst rain during the walk
    }
  }
  return L.conditions(rain, vc.h, uv, sun);
}
export function conds() { return ui.c || computeConds(); }

// ---------- the map (one map, kept alive while pages come and go) ----------

function buildMapEl() {
  const box = document.createElement('div');
  box.className = 'mapbox'; box.id = 'mapbox';
  box.innerHTML = '<canvas id="mapc" tabindex="0" role="img" aria-label="Map of the township"></canvas>' +
    '<div class="map-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">&minus;</button>' +
    '<button type="button" id="locate" aria-label="Show my location" title="My location"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></button></div>' +
    '<div class="map-msg" id="mapMsg" hidden></div><div class="map-attrib"></div>';
  return box;
}
export function attachMap(host) {
  if (!mapEl) return function () {};
  host.appendChild(mapEl);
  requestAnimationFrame(function () {
    if (!tmap) return;
    if (fitPending && G) { tmap.fit(); fitPending = false; }
    tmap.redraw();
  });
  return function () { if (mapEl.parentNode === host) host.removeChild(mapEl); };
}
export function mapView() { return tmap; }
function showMapMsg(text) { const m = mapEl && mapEl.querySelector('#mapMsg'); if (m) { m.hidden = !text; m.textContent = text || ''; } }
function setCursor() { const c = mapEl && mapEl.querySelector('canvas'); if (c) c.style.cursor = ui.tool ? 'crosshair' : ''; }
function fitNow() {
  if (!tmap) return;
  if (mapEl.isConnected && mapEl.clientWidth > 0) tmap.fit(); else fitPending = true;
}

// Which page owns the map right now: the walk planner, the report page or the township team page.
export function setMapMode(mode) {
  if (ui.mapMode === mode) return;
  ui.mapMode = mode; ui.tool = null; ui.notice = '';
  if (mode !== 'paths') ui.pathDraw = null;
  applyTiles();
  setCursor();
  update();
}

// ---------- loading a township ----------

function resolvePoint(pt) {
  if (!pt || !G) return;
  const nn = L.nearestNode(G, pt.lat, pt.lon);
  pt.node = nn.node >= 0 && nn.dist <= 250 ? nn.node : -1;
  pt.snap = nn.dist;
}

function setDataset(ds, keepPoints) {
  G = L.buildGraph(ds, verifiedOf(ui.paths));
  verifiedSig = sigOf(ui.paths);
  const sampleOnline = ds.source === 'sample' && ui.online;
  INITIAL = G.edges.map(function (e) { return { thr: sampleOnline ? e.base : e.thr, blocked: sampleOnline ? false : e.blocked }; });
  G.edges.forEach(function (e, i) { e.thr = INITIAL[i].thr; e.blocked = INITIAL[i].blocked; });
  TRIPS = L.makeTrips(G);
  USAGE = L.usageCounts(G, TRIPS);
  ui.tool = null; ui.report = null; ui.showAll = false; ui.notice = ''; ui.impact = null;
  if (keepPoints) { resolvePoint(ui.start); resolvePoint(ui.dest); }
  else { ui.start = null; ui.dest = null; ui.planMsg = ''; }
  tmap.setGraph(G);
  applyTiles();
  fitNow();
  setCursor();
  if (ui.lastState) applyState(ui.lastState);
  ui.dataNotes = ds.notes || [];
  ui.ready = true;
  update();
}

function areaSummary(ds) {
  if (ds.source === 'sample') return 'Showing the sample township. Its roads and numbers are invented.';
  const s = ds.stats;
  return 'Loaded ' + ds.name + ': ' + plural(s.roads, 'road segment') + ', ' + plural(s.trees, 'mapped tree') + ', ' +
    plural(s.covered, 'covered walkway') + ', ' + plural(s.places, 'landmark') + '.' +
    (s.trees < 15 ? ' Few trees are mapped here, so shade may be underestimated.' : '');
}

async function loadArea(p, opts) {
  ui.loading = true;
  showMapMsg('Loading roads, trees and terrain. This can take up to a minute the first time.');
  bump();
  let qs = '';
  if (p && p.lat !== undefined) qs = '?lat=' + p.lat + '&lon=' + p.lon + (p.r ? '&r=' + Math.round(p.r) : '') + (p.name ? '&name=' + encodeURIComponent(p.name) : '');
  let ok = false;
  try {
    const ds = await Api.get('/api/township' + qs);
    showMapMsg('');
    setDataset(ds, !!(opts && opts.keepPoints));
    ui.areaMsg = areaSummary(ds);
    ok = true;
    pullWeather();
  } catch (e) {
    showMapMsg('');
    ui.areaMsg = friendlyError(e) + (G ? '' : ' Showing the sample township instead.');
    if (!G) setDataset(Sample.build());
  }
  ui.loading = false;
  update();
  return ok;
}

// ---------- server state (shared reports) ----------

const LIVE_MS = 3 * 3600 * 1000;   // a resident's flood report counts for 3 hours
function liveOf(types, ats) {
  let live = null;
  const now = Date.now();
  types.forEach(function (t, i) {
    if (ats && ats[i] && now - ats[i] > LIVE_MS) return;
    if (t === 'Flooded road') live = 'flooded';
    else if ((t === 'Water rising' || t === 'Standing water') && live !== 'flooded') live = 'risk';
  });
  return live;
}
function applyState(st) {
  ui.lastState = st; ui.rev = st.rev;
  setPaths(st.paths || []);
  ui.clears = st.clears || {}; ui.cleared = st.cleared || [];
  ui.cleared.forEach(function (c) { const e = G.edges.find(function (x) { return x.id === c.edgeId; }); if (e && INITIAL[e.idx] && INITIAL[e.idx].blocked) { INITIAL[e.idx].blocked = false; INITIAL[e.idx].thr = e.base; } });
  G.edges.forEach(function (e, i) {
    const s = st.edges[e.id];
    if (s) {
      e.blocked = !!s.blocked;
      e.reports = s.reports.map(function (r) { return r.type; });
      e.live = liveOf(e.reports, s.reports.map(function (r) { return r.at; }));
      e.thr = e.blocked ? (INITIAL[i].blocked ? INITIAL[i].thr : Math.round(e.base * 0.6)) : e.base;
    } else {
      e.blocked = INITIAL[i].blocked; e.thr = INITIAL[i].thr; e.reports = []; e.live = null;
    }
  });
}
// ---------- map pictures: street map or satellite ----------

function applyTiles() {
  if (!tmap || !G) return;
  const sample = G.ds.source === 'sample';
  if (ui.satellite && ui.satTiles && !sample) tmap.setTiles({ url: ui.satTiles.url, maxZoom: ui.satTiles.maxZoom, veil: false }, ui.satTiles.attribution);
  else tmap.setTiles(sample ? null : ui.tiles, ui.tiles ? ui.tiles.attribution : '');
}
export function toggleSatellite() {
  if (!ui.satTiles) { ui.pathNote = 'Satellite view needs the MapTiler key in the .env file.'; bump(); return; }
  ui.satellite = !ui.satellite;
  applyTiles(); update();
}

// ---------- resident paths (Path Discovery) ----------

let verifiedSig = '';
function verifiedOf(paths) { return (paths || []).filter(function (p) { return p.status === 'verified'; }); }
function sigOf(paths) { return verifiedOf(paths).map(function (p) { return p.id; }).sort().join(','); }
export function deviceId() {
  try {
    let d = localStorage.getItem('teduhDevice');
    if (!d) { d = 'dev' + Math.random().toString(36).slice(2, 12); localStorage.setItem('teduhDevice', d); }
    return d;
  } catch (e) { return ui.devFallback || (ui.devFallback = 'dev' + Math.random().toString(36).slice(2, 12)); }
}
// Verified paths become part of the road network, so the graph is built again when the set changes.
function setPaths(paths) {
  ui.paths = paths;
  const sig = sigOf(paths);
  if (G && sig !== verifiedSig && !ui.nav) {
    verifiedSig = sig;
    const oldIdx = {}; G.edges.forEach(function (e, i) { oldIdx[e.id] = i; });
    const old = INITIAL;
    G = L.buildGraph(G.ds, verifiedOf(paths));
    const sampleOnline = G.ds.source === 'sample' && ui.online;
    INITIAL = G.edges.map(function (e) {
      const o = oldIdx[e.id] !== undefined ? old[oldIdx[e.id]] : null;
      return o || { thr: sampleOnline ? e.base : e.thr, blocked: sampleOnline ? false : e.blocked };
    });
    G.edges.forEach(function (e, i) { e.thr = INITIAL[i].thr; e.blocked = INITIAL[i].blocked; });
    TRIPS = L.makeTrips(G);
    USAGE = L.usageCounts(G, TRIPS);
    ui.impact = null;
    resolvePoint(ui.start); resolvePoint(ui.dest);
    tmap.setGraph(G);
  }
  if (G) {
    const used = G.community ? G.community.used : [];
    paths.forEach(function (p) { p.connected = p.status === 'verified' ? used.indexOf(p.id) !== -1 : undefined; });
  }
}
export function pathById(id) { return ui.paths.filter(function (p) { return p.id === id; })[0] || null; }
export function pathMetres(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const dy = (pts[i][0] - pts[i - 1][0]) * 111320, dx = (pts[i][1] - pts[i - 1][1]) * 111320 * Math.cos(pts[i][0] * Math.PI / 180);
    t += Math.hypot(dx, dy);
  }
  return Math.round(t);
}
export function startTrace() {
  ui.pathDraw = ui.pathDraw || { pts: [], snapped: [], surface: 'mud', kind: 'trail', note: '', photo: null, ai: null, aiMsg: '', busy: false };
  ui.tool = 'path'; ui.pathSel = null; ui.pathNote = '';
  setCursor();
  setNotice('Tap along the path, from one end to the other. Tap near a road to join it. Up to 24 points.');
  update();
}
export function editPath(id) {
  const p = pathById(id);
  if (!p || p.owner !== deviceId()) return;
  ui.pathDraw = { editId: id, pts: p.pts.map(function (q) { return [q[0], q[1]]; }), snapped: p.pts.map(function () { return false; }), surface: p.surface, kind: p.kind, note: p.note || '', photo: null, ai: null, aiMsg: '', busy: false };
  ui.tool = 'path'; ui.pathSel = id; ui.pathNote = '';
  setCursor();
  setNotice('Editing your path. Tap the map to extend it from its last point, or use Reverse to extend from the other end. Undo removes the last point.');
  update();
}
export function reverseDraft() { const d = ui.pathDraw; if (!d) return; d.pts.reverse(); d.snapped.reverse(); update(); }
export function stopTrace() { ui.tool = null; setCursor(); setNotice(''); update(); }
export function undoPoint() { const d = ui.pathDraw; if (!d) return; d.pts.pop(); d.snapped.pop(); update(); }
export function cancelPath() { ui.pathDraw = null; ui.tool = null; setCursor(); setNotice(''); update(); }
export function setPathField(k, v) { if (ui.pathDraw) { ui.pathDraw[k] = v; if (k === 'surface' || k === 'kind') ui.pathDraw.ai = null; bump(); } }
export function selectPath(id) {
  ui.pathSel = id === ui.pathSel ? null : id;
  const p = pathById(id);
  if (p && ui.pathSel) tmap.fitPoints(p.pts, 80);
  update();
}
function addTracePoint(h) {
  const d = ui.pathDraw;
  if (!d) return;
  if (d.pts.length >= 24) { setNotice('That is the most points one path can have. Send it, or undo a point.'); return; }
  let lat = h.lat, lon = h.lon, snapped = false;
  const nn = L.nearestNode(G, lat, lon);
  if (nn.node >= 0 && nn.node < G.ds.nodes.length && nn.dist <= 35) { lat = G.ds.nodes[nn.node][0]; lon = G.ds.nodes[nn.node][1]; snapped = true; }
  d.pts.push([Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]); d.snapped.push(snapped);
  ui.notice = ''; update();
}
export async function choosePathPhoto(file) {
  const d = ui.pathDraw;
  if (!file || !d) return;
  if (!/^image\//.test(file.type)) { d.aiMsg = 'Please choose a photo.'; bump(); return; }
  try { d.photo = await downscale(file); d.ai = null; d.aiMsg = ''; }
  catch (e) { d.aiMsg = 'That photo format is not supported here. Try a JPEG or PNG.'; }
  bump();
}
export function clearPathPhoto() { if (ui.pathDraw) { ui.pathDraw.photo = null; ui.pathDraw.ai = null; bump(); } }
export async function checkPathPhoto() {
  const d = ui.pathDraw;
  if (!d || d.busy) return;
  if (!d.photo) { d.aiMsg = 'Add a photo first.'; bump(); return; }
  if (!ui.online) { d.aiMsg = 'The photo check needs the server (npm start).'; bump(); return; }
  d.busy = true; d.aiMsg = 'Checking'; d.ai = null; bump();
  try {
    const a = await Api.post('/api/path-check', { image: d.photo, kind: d.kind, surface: d.surface, note: d.note });
    d.ai = a; d.aiMsg = '';
  } catch (e) { d.aiMsg = friendlyError(e); }
  d.busy = false; bump();
}
export async function sendPath(extra) {
  const d = ui.pathDraw;
  if (!d || d.busy) return;
  if (d.pts.length < 2) { ui.pathNote = 'Trace the path on the map first: at least 2 points.'; bump(); return; }
  const len = pathMetres(d.pts);
  if (len < 8 || len > 800) { ui.pathNote = len < 8 ? 'That path is very short. Trace a longer one.' : 'Paths can be up to 800 m. Trace a shorter one.'; bump(); return; }
  const ai = d.ai ? { severity: d.ai.walkable === false ? 'high' : (d.ai.condition === 'poor' ? 'medium' : 'low'), summary: d.ai.summary || '' } : null;
  if (d.editId) {
    const old = pathById(d.editId);
    const geom = !old || JSON.stringify(old.pts) !== JSON.stringify(d.pts) || old.surface !== d.surface || old.kind !== d.kind;
    const msg = geom ? 'Path saved. Because the line, kind or surface changed, it needs a new check: one other person confirms it, or the township team approves it.' : 'Description saved.';
    if (ui.online) {
      d.busy = true; bump();
      try {
        applyState(await Api.post('/api/path/edit', { id: d.editId, pts: d.pts, surface: d.surface, kind: d.kind, note: d.note.trim(), by: deviceId(), ai: ai }));
        ui.pathDraw = null; ui.tool = null; setCursor(); ui.notice = ''; ui.pathNote = msg;
      } catch (err) { d.busy = false; ui.pathNote = 'Could not save the changes: ' + friendlyError(err); }
      update(); return;
    }
    const np = Object.assign({}, old, { pts: d.pts, surface: d.surface, kind: d.kind, note: d.note.trim(), length: len });
    if (geom) { np.confirmers = []; np.status = 'unverified'; np.via = null; }
    ui.pathDraw = null; ui.tool = null; setCursor(); ui.notice = '';
    setPaths(ui.paths.map(function (x) { return x.id === np.id ? np : x; }));
    ui.pathNote = msg; update(); return;
  }
  if (ui.online) {
    d.busy = true; bump();
    try {
      const st = await Api.post('/api/path', { pts: d.pts, surface: d.surface, kind: d.kind, note: d.note.trim(), by: deviceId(), ai: ai });
      const id = st.id;
      ui.pathDraw = null; ui.tool = null; setCursor();
      applyState(st);
      ui.pathSel = id;
      ui.pathNote = 'Path sent. It shows on the map as unverified. When one more person confirms it, or the township team approves it, Teduh can use it for routes.';
      ui.notice = '';
    } catch (err) {
      d.busy = false;
      ui.pathNote = err.status === 429 ? 'Too many paths sent. Try again in a minute.' : 'Could not send the path: ' + friendlyError(err);
    }
    update(); return;
  }
  const p = { id: 'path-' + Math.random().toString(36).slice(2, 10), pts: d.pts, surface: d.surface, kind: d.kind, note: d.note.trim(), owner: deviceId(), confirmers: [], status: 'unverified', via: null, sim: false, ai: ai, at: Date.now(), length: len };
  ui.pathDraw = null; ui.tool = null; setCursor(); setNotice('');
  setPaths(ui.paths.concat([p]));
  ui.pathSel = p.id;
  ui.pathNote = 'Path added on this device only (demo). Start the server to share paths.';
  update();
}
export async function confirmPath(id) {
  const p = pathById(id);
  if (!p) return;
  if (ui.online) {
    try { applyState(await Api.post('/api/path/confirm', { id: id, by: deviceId() })); ui.pathNote = 'Thanks. Your confirmation was added.'; }
    catch (err) { ui.pathNote = friendlyError(err); }
    update(); return;
  }
  if (p.owner === deviceId()) { ui.pathNote = 'You traced this path, so someone else needs to confirm it.'; bump(); return; }
  p.confirmers = p.confirmers.concat([deviceId()]); p.status = 'verified'; p.via = 'residents';
  setPaths(ui.paths.slice());
  update();
}
export function pathDecide(id, decision) {
  if (!isTeam()) return;
  teamAction('/api/path/decide', { id: id, decision: decision }, decision === 'approve' ? 'Path approved. Teduh can route along it.' : 'Path rejected and removed.');
}

// Demo: two simulated paths between roads that are close in a straight line but far apart by road. Clearly labelled simulated.
export async function addDemoPaths() {
  if (!G || ui.pathBusy) return;
  const ds = G.ds, N = ds.nodes.length;
  const cand = [];
  const metres = function (a, b) { return pathMetres([a, b]); };
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const d = metres(ds.nodes[i], ds.nodes[j]);
    if (d < 90 || d > 220) continue;
    const r = L.route(G, i, j, 'standard', computeConds(), 'pedestrian');
    if (!r) continue;
    const roadLen = r.edges.reduce(function (t, e) { return t + (e.len || 0); }, 0);
    cand.push({ i: i, j: j, d: d, detour: roadLen / d });
  }
  cand.sort(function (a, b) { return b.detour - a.detour; });
  const picks = [];
  cand.forEach(function (c) { if (picks.length < 2 && picks.every(function (p) { return p.i !== c.i && p.j !== c.i && p.i !== c.j && p.j !== c.j; })) picks.push(c); });
  if (!picks.length) { ui.pathNote = 'No good spot for a demo path in this area.'; bump(); return; }
  ui.pathBusy = true; bump();
  const kinds = [{ kind: 'shortcut', surface: 'mud', note: 'Simulated: worn dirt shortcut' }, { kind: 'footbridge', surface: 'concrete', note: 'Simulated: small footbridge' }];
  try {
    for (let k = 0; k < picks.length; k++) {
      const a = ds.nodes[picks[k].i], b = ds.nodes[picks[k].j];
      const pts = [[a[0], a[1]], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [b[0], b[1]]];
      const body = { pts: pts, surface: kinds[k].surface, kind: kinds[k].kind, note: kinds[k].note, by: 'demo-resident-' + k, sim: true };
      if (ui.online) {
        const st = await Api.post('/api/path', body);
        if (k === 0) applyState(await Api.post('/api/path/confirm', { id: st.id, by: 'demo-neighbour-0' })); else applyState(st);
      } else {
        const p = { id: 'path-' + Math.random().toString(36).slice(2, 10), pts: pts, surface: body.surface, kind: body.kind, note: body.note, owner: body.by, confirmers: k === 0 ? ['demo-neighbour-0'] : [], status: k === 0 ? 'verified' : 'unverified', via: k === 0 ? 'residents' : null, sim: true, ai: null, at: Date.now(), length: pathMetres(pts) };
        setPaths(ui.paths.concat([p]));
      }
    }
    ui.pathNote = 'Added 2 simulated paths (labelled simulated): one verified, one still waiting for a second person.';
  } catch (err) { ui.pathNote = friendlyError(err); }
  ui.pathBusy = false; update();
}

async function refresh() {
  try {
    const st = await Api.get('/api/state');
    if (!G) return;
    if (!ui.online || st.rev !== ui.rev) { ui.online = true; applyState(st); update(); }
  } catch (e) {
    if (ui.online) { ui.online = false; update(); }
  }
}

// ---------- live weather ----------

// Where the person is right now, for the weather. A quick, low-power fix is enough (a few hundred metres).
function quickPos() {
  return new Promise(function (res, rej) {
    if (!navigator.geolocation) return rej({ code: 0 });
    if (window.isSecureContext === false) return rej({ code: -1 });
    navigator.geolocation.getCurrentPosition(function (p) { res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); }, rej, { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10000 });
  });
}
async function refreshHere() {
  if (ui.hereDenied) return;
  try { ui.here = await quickPos(); ui.hereMsg = ''; }
  catch (e) {
    if (e && e.code === 1) { ui.hereDenied = true; ui.hereMsg = 'Location is off for this page, so the weather is for the middle of ' + (G ? G.name : 'the loaded area') + '. Allow location in your browser to get the weather where you are.'; }
    else if (!ui.here) ui.hereMsg = 'Could not find your location, so the weather is for the middle of ' + (G ? G.name : 'the loaded area') + '.';
  }
}
export function canLive() { return ui.online && G && G.ds.source !== 'sample'; }
async function pullWeather() {
  if (!canLive() || ui.wxBusy) return;
  ui.wxBusy = true;
  if (!(ui.nav && ui.nav.pos && !ui.nav.sim)) await refreshHere();
  // the weather is for where the person is: the live GPS fix while walking, else the last known position, else the middle of the loaded area
  const at = ui.nav && ui.nav.pos && !ui.nav.sim ? ui.nav.pos : ui.here ? ui.here : G.ds.center;
  try {
    ui.wx = await Api.get('/api/weather?lat=' + Number(at.lat).toFixed(4) + '&lon=' + Number(at.lon !== undefined ? at.lon : at.lng).toFixed(4));
    ui.wxErr = ''; ui.wxAt = Date.now();
  } catch (e) {
    ui.wxErr = 'Live weather is not available right now.' + (ui.wx ? ' Showing the last reading.' : '');
  }
  ui.wxBusy = false;
  update();
}

// On start: find where the person is. If that is outside the loaded township, load the roads around them.
async function locateOnStart() {
  await refreshHere();
  if (!ui.here || !G || !canLive() || ui.start || ui.dest) { pullWeather(); return; }
  const nn = L.nearestNode(G, ui.here.lat, ui.here.lon);
  if (nn.dist > 700) {
    const ok = await loadArea({ lat: Number(ui.here.lat.toFixed(5)), lon: Number(ui.here.lon.toFixed(5)), name: 'Your area' });
    if (ok) { ui.areaMsg = 'Loaded the roads around where you are. ' + ui.areaMsg; ui.wx = null; }
  }
  pullWeather();
}

// ---------- the clock ----------

export function tick() {
  const n = Wx.klNow(), minuteChanged = n.mm !== ui.clock.mm || n.hh !== ui.clock.hh;
  ui.clock = n;
  clockVersion++; clockSubs.forEach(function (f) { f(); });
  if (minuteChanged && G) update();                       // the sun, darkness and walk weather follow the clock every minute
  if (G && canLive() && !document.hidden && Date.now() - ui.wxAt > 6 * 60 * 1000) pullWeather();
}

// ---------- points: where from and where to ----------

export function pointOf(which) { return which === 'from' ? ui.start : ui.dest; }
function setPointRaw(which, pt) { if (which === 'from') ui.start = pt; else ui.dest = pt; }

function mapPoints() {
  const out = [];
  [ui.start, ui.dest].forEach(function (p) { if (p) out.push([p.lat, p.lon]); });
  return out;
}

// A pin far from any road still works: the route starts or ends at the nearest road, and the gap is drawn as a dotted line.
function widen(p) {
  const nn = L.nearestNode(G, p.lat, p.lon);
  if (nn.node >= 0 && nn.dist <= 1500) { p.node = nn.node; p.snap = nn.dist; }
}
function legNotes(pts) {
  const far = pts.filter(function (p) { return p.snap > 250; });
  ui.planMsg = far.length ? far.map(function (p) { return '"' + p.label + '" is about ' + Math.round(p.snap) + ' m from the nearest road, so the route ' + (p === ui.start ? 'starts' : 'ends') + ' at that road. The dotted line is the gap to walk across open ground yourself.'; }).join(' ') : '';
}
async function ensureArea() {
  const pts = [ui.start, ui.dest].filter(Boolean);
  if (!pts.length || !G || ui.loading) return false;
  if (pts.every(function (p) { return p.node >= 0; })) { legNotes(pts); return true; }
  if (!ui.online) { ui.planMsg = 'That place is outside the sample map. Run npm start to use real maps.'; return false; }
  const key = pts.map(function (p) { return p.lat.toFixed(4) + ',' + p.lon.toFixed(4); }).join('|');
  if (key === ui.areaKey) {   // the roads around these points are already loaded: join the nearest road however far it is
    pts.forEach(function (p) { if (p.node < 0) widen(p); });
    if (pts.every(function (p) { return p.node >= 0; })) { legNotes(pts); return true; }
  }
  let lat, lon, r = 600;
  if (pts.length === 2) {
    const d = Nav.dist([pts[0].lat, pts[0].lon], [pts[1].lat, pts[1].lon]);
    if (d > 2600) { ui.planMsg = 'These two places are ' + (d / 1000).toFixed(1) + ' km apart. Teduh plans walks up to about 2.5 km. Pick closer places.'; return false; }
    lat = (pts[0].lat + pts[1].lat) / 2; lon = (pts[0].lon + pts[1].lon) / 2;
    r = clamp(Math.round(d / 2 * 1.25 + 300), 500, 1500);
  } else { lat = pts[0].lat; lon = pts[0].lon; }
  ui.planMsg = 'Loading roads for this trip.'; bump();
  const ok = await loadArea({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), r: r, name: pts[pts.length - 1].label }, { keepPoints: true });
  if (!ok) { ui.planMsg = ui.areaMsg; return false; }
  ui.areaKey = key;
  pts.forEach(function (p) { if (p.node < 0) widen(p); });
  const bad = pts.filter(function (p) { return p.node < 0; })[0];
  if (bad) { ui.planMsg = 'No walkable road found within 1.5 km of "' + bad.label + '". Try a spot closer to a road.'; return false; }
  legNotes(pts);
  return true;
}

async function pointsChanged() {
  if (ui.nav) endNav(true);
  ui.planMsg = '';
  if (ui.start && ui.dest && ui.start.lat === ui.dest.lat && ui.start.lon === ui.dest.lon) ui.planMsg = 'Start and destination are the same place.';
  else if (ui.start || ui.dest) await ensureArea();
  update();
  const pts = mapPoints();
  if (pts.length > 1) tmap.fitPoints(pts, 46);
  else if (pts.length === 1) tmap.setView(pts[0][0], pts[0][1], Math.max(tmap.center().z, 16));
}

export async function setPoint(which, pt) {
  resolvePoint(pt);
  setPointRaw(which, pt);
  ui.pick = 'teduh';
  await pointsChanged();
}
export function clearPoint(which) { setPointRaw(which, null); pointsChanged(); }
// the person started typing over a chosen place: forget the place until they pick another
export function forgetPoint(which) {
  if (!pointOf(which)) return;
  setPointRaw(which, null);
  if (ui.nav) endNav(true);
  update();
}
export function swapPoints() { const t = ui.start; ui.start = ui.dest; ui.dest = t; pointsChanged(); }

function nodeLabel(n, fallback) {
  const e = G.edges.filter(function (x) { return x.a === n || x.b === n; })[0];
  return e ? e.road + ' (junction)' : fallback;
}
export async function demoTrip() {
  if (!G) return;
  // Pick the trip where Teduh differs most from the shortest route right now (shade, or dodging water); fall back to a far-apart pair
  const best = L.bestContrast(G, ui.c || computeConds(), ui.profile);
  const t = best ? [best.a, best.b] : L.defaultTrip(G);
  const a = G.nodes[t[0]], b = G.nodes[t[1]];
  const pa = G.places.filter(function (p) { return p.node === t[0]; })[0], pb = G.places.filter(function (p) { return p.node === t[1]; })[0];
  ui.start = { lat: a[0], lon: a[1], label: pa ? pa.name : nodeLabel(t[0], 'Start'), kind: pa ? 'place' : 'pin' };
  ui.dest = { lat: b[0], lon: b[1], label: pb ? pb.name : nodeLabel(t[1], 'Destination'), kind: pb ? 'place' : 'pin' };
  resolvePoint(ui.start); resolvePoint(ui.dest);
  ui.pick = 'teduh';
  const msg = best
    ? 'A trip where Teduh differs most right now: ' + (best.floodAvoided > 0 ? 'it avoids ' + plural(best.floodAvoided, 'flooded road') + '. ' : 'about ' + Math.max(1, Math.round(best.sunSaved)) + ' fewer minutes in the sun' + (best.extraMin >= 0.5 ? ' for about ' + Math.round(best.extraMin) + ' extra minute' + (Math.round(best.extraMin) === 1 ? '' : 's') : ' for almost no extra walking time') + '. ')
    : 'No trip in this area differs right now. Try the midday preview, another walker type, or the storm simulator on the Weather page.';
  await pointsChanged();
  ui.planMsg = msg;
  bump();
}

export function setProfile(id) { ui.profile = id; update(); }
export function setPick(kind) { ui.pick = kind; update(); }

// ---------- GPS ----------

function gpsMessage(e) {
  const c = e && e.code;
  if (c === -1) return 'Location needs a secure page. Open Teduh on localhost or an https address (a plain http address on your Wi-Fi will not work).';
  if (c === 0) return 'This browser cannot share your location.';
  if (c === 1) return 'Location is blocked for this page. Allow location in your browser settings, then try again.';
  if (c === 2) return 'No GPS signal right now. Try again outside or near a window.';
  if (c === 3) return 'GPS is taking too long. Try again.';
  return 'Could not get your location.';
}
// The first GPS fix is often rough (Wi-Fi or cell based). Listen for up to 10 s and keep the most accurate one.
function getPos() {
  return new Promise(function (res, rej) {
    if (!navigator.geolocation) return rej({ code: 0 });
    if (window.isSecureContext === false) return rej({ code: -1 });
    let best = null, done = false, id = null, timer = null;
    function finish(ok, v) {
      if (done) return; done = true;
      if (id !== null) navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      ok ? res(v) : rej(v);
    }
    id = navigator.geolocation.watchPosition(function (p) {
      if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
      if (p.coords.accuracy <= 25) finish(true, best);
    }, function (e) { best ? finish(true, best) : finish(false, e); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    timer = setTimeout(function () { best ? finish(true, best) : finish(false, { code: 3 }); }, 10000);
  });
}
function accNote(f) {
  return f.acc > 60 ? 'Your position is only accurate to about ' + Math.round(f.acc) + ' m. Laptops and desktops use Wi-Fi, which is rough. A phone outdoors is usually within 5 to 20 m.' : '';
}
function fixFrom(p) {
  const c = p.coords;
  return { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, heading: Number.isFinite(c.heading) ? c.heading : null, speed: Number.isFinite(c.speed) ? c.speed : null, ts: p.timestamp };
}

export async function useMyLocation(which) {
  ui.planMsg = 'Finding your location.'; bump();
  try {
    const f = fixFrom(await getPos());
    ui.me = f;
    ui.planMsg = accNote(f);
    await setPoint(which, { lat: f.lat, lon: f.lon, label: 'Your location', kind: 'gps' });
  } catch (e) { ui.planMsg = gpsMessage(e); update(); }
}

export async function locateMe() {
  if (ui.locating) return;
  ui.locating = true; setNotice('Finding your location.');
  try {
    const f = fixFrom(await getPos());
    ui.me = f; setNotice(accNote(f));
    const nn = G ? L.nearestNode(G, f.lat, f.lon) : null;
    tmap.setView(f.lat, f.lon, Math.max(tmap.center().z, 16));
    if (nn && nn.dist > 400 && canLive()) setNotice('You are outside the loaded roads. Choose "Load roads here" to load this area.');
  } catch (e) { setNotice(gpsMessage(e)); }
  ui.locating = false; update();
}

export function loadHere() {
  if (!ui.online) { ui.areaMsg = 'Loading a real area needs the server. Run npm start and open the page from there.'; bump(); return; }
  const c = tmap.center();
  ui.start = null; ui.dest = null;
  loadArea({ lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)) });
}

// ---------- suggestions (the dropdown under the From and To boxes) ----------

export function suggestItems(which, text, geo, busy, geoQ) {
  const q = pointOf(which) ? '' : String(text || '').trim().toLowerCase();   // with a place already chosen, show the full list
  const items = [];
  if (!q || 'your location'.indexOf(q) === 0 || 'my location'.indexOf(q) === 0) items.push({ kind: 'gps', label: 'Your location', sub: 'Use GPS' });
  if (!q) items.push({ kind: 'map', label: 'Choose on map', sub: 'Tap a spot on the map' });
  if (G) {
    G.places.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; }).slice(0, q ? 5 : 6)
      .forEach(function (p) { items.push({ kind: 'place', label: p.name, sub: 'Landmark in ' + G.name, lat: p.lat, lon: p.lon }); });
  }
  (geo || []).forEach(function (g) {
    if (items.some(function (i) { return i.label === g.name && Math.abs((i.lat || 0) - g.lat) < 0.0005; })) return;
    items.push({ kind: 'geo', label: g.name, sub: g.label, lat: g.lat, lon: g.lon });
  });
  if (busy) items.push({ kind: 'hint', label: 'Searching all of Malaysia', sub: '' });
  else if (q.length >= 3 && !(geo || []).length && ui.online && geoQ === q) items.push({ kind: 'hint', label: 'No more places found', sub: 'Try another spelling' });
  return items;
}
export async function geocode(q) {
  if (q.length < 3 || !ui.online) return [];
  const r = await Api.get('/api/geocode?q=' + encodeURIComponent(q));
  return r.results;
}
export function chooseSuggest(which, it) {
  if (!it || it.kind === 'hint') return;
  if (it.kind === 'gps') { useMyLocation(which); return; }
  if (it.kind === 'map') { setTool(which); const c = document.getElementById('mapc'); if (c) c.focus(); return; }
  setPoint(which, { lat: it.lat, lon: it.lon, label: it.label, kind: it.kind });
}

// ---------- map taps and tools ----------

export function setTool(t) {
  ui.tool = ui.tool === t ? null : t;
  setCursor();
  if (ui.tool) setNotice(ui.tool === 'path' ? 'Tap along the path.' : ui.tool === 'report' ? 'Tap the road where the problem is.' : 'Tap the map to set the ' + (ui.tool === 'from' ? 'start' : 'destination') + '.');
  else setNotice('');
}
export function setNotice(text) { ui.notice = text || ''; bump(); }

function onTap(h) {
  if (!G) return;
  if (ui.tool === 'from' || ui.tool === 'to') {
    const which = ui.tool;   // a pin can go anywhere on the map; the route joins the nearest road
    const label = h.place ? h.place.name : h.edge ? h.edge.road + ' (dropped pin)' : 'Dropped pin';
    ui.tool = null; setCursor(); setNotice('');
    setPoint(which, { lat: h.lat, lon: h.lon, label: label, kind: 'pin' });
    return;
  }
  if (ui.tool === 'path') { addTracePoint(h); return; }
  if (!h.edge && h.pathId && ui.mapMode === 'paths') { ui.pathSel = h.pathId; update(); return; }
  if (ui.tool === 'report') {
    if (!h.edge) { setNotice('No road there. Tap on a road to report a problem.'); return; }
    ui.report = { edge: h.edge, lat: h.lat, lon: h.lon, photo: null, ai: null, aiMsg: '', busy: false, type: 'Blocked drain', note: '' };
    ui.tool = null; ui.notice = ''; setCursor();
    update();
    const f = document.getElementById('reportForm');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ---------- results: the two routes ----------

export function routeStats() {
  const c = ui.c || computeConds(), res = { S: null, T: null, ss: null, ts: null, c: c };
  if (!G) return res;
  const a = nodeOf(ui.start), b = nodeOf(ui.dest);
  if (a >= 0 && b >= 0 && a !== b) {
    res.S = L.route(G, a, b, 'standard', c, ui.profile);
    res.T = L.route(G, a, b, 'teduh', c, ui.profile);
    if (res.S && res.T) { res.ss = L.stats(res.S, c, ui.profile); res.ts = L.stats(res.T, c, ui.profile); }
  }
  return res;
}

export function alertList(c) {
  if (!G) return [];
  return G.edges.map(function (e) { return { e: e, s: L.edgeStatus(e, c.rain) }; })
    .filter(function (x) { return x.s !== 'ok'; })
    .sort(function (a, b) { return (a.s === 'flooded' ? 0 : 1) - (b.s === 'flooded' ? 0 : 1) || a.e.thr - b.e.thr || (USAGE[b.e.id] || 0) - (USAGE[a.e.id] || 0); });
}
export function rainSource() {
  if (ui.sim !== null) return 'the simulated storm';
  if (ui.tripW && ui.tripW.maxRain > 0) return 'the rain during your walk';
  return ui.preview ? 'the rain at ' + Wx.hourText(ui.preview.h) : 'the rain right now';
}

// ---------- everything that follows from the state: conditions, routes and the map ----------

export function update() {
  if (G) {
    ui.c = computeConds();
    const c = ui.c, navOn = !!ui.nav, mode = ui.mapMode, plan = mode === 'plan';
    const rs = !navOn ? routeStats() : { S: null, T: null, ss: null, ts: null };
    if (!navOn) {
      const chosen = ui.pick === 'std' ? rs.S : rs.T;
      ui.cur = { S: rs.S, T: rs.T, ss: rs.ss, ts: rs.ts, line: chosen ? Nav.routeLine(G, chosen) : null, stats: ui.pick === 'std' ? rs.ss : rs.ts };
    }
    const markers = [];
    if (plan && ui.start) markers.push({ label: 'A', lat: ui.start.lat, lon: ui.start.lon });
    if (plan && ui.dest) markers.push({ label: 'B', lat: ui.dest.lat, lon: ui.dest.lon });
    const legs = [];
    if (plan && !navOn) [ui.start, ui.dest].forEach(function (p) { if (p && p.node >= 0 && p.snap > 25) { const nd = G.nodes[p.node]; legs.push([p.lat, p.lon, nd[0], nd[1]]); } });
    tmap.setState({
      legs: legs,
      status: function (e) { return L.edgeStatus(e, c.rain); },
      std: navOn || !plan ? null : rs.S, teduh: navOn ? ui.nav.route : (plan ? rs.T : null), primary: navOn ? 'teduh' : ui.pick,
      markers: markers,
      pin: mode === 'report' && ui.report ? { lat: ui.report.lat, lon: ui.report.lon } : null,
      me: ui.me && mode !== 'team' ? { lat: ui.me.lat, lon: ui.me.lon, acc: ui.me.acc, heading: ui.me.heading } : null,
      trail: navOn && ui.nav.line && plan ? Nav.lineUpTo(ui.nav.line, ui.nav.along) : null,
      paths: mode === 'paths' || mode === 'team' || plan ? ui.paths : [],
      draft: mode === 'paths' ? ui.pathDraw : null,
      selPath: mode === 'paths' ? ui.pathSel : null
    });
    const cv = mapEl.querySelector('canvas');
    cv.setAttribute('aria-label', plan
      ? 'Map of ' + G.name + (ui.start && ui.dest ? ' showing the shortest route and the Teduh route from ' + ui.start.label + ' to ' + ui.dest.label : '')
      : 'Map of ' + G.name + ' showing flooded roads and blocked drains');
  }
  bump();
}

// ---------- journey with live GPS ----------

// Voice guide. Lines are queued, never cut off: the next line starts only when the current one has finished.
// A queue longer than 2 drops the oldest waiting line, so the guide never falls behind. urgent lines (route updated, arrived) go first.
const voiceQ = [];
function voiceBusy() { try { return !!(window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)); } catch (e) { return false; } }
function voiceNext() {
  if (!voiceQ.length) return;
  try {
    const u = new SpeechSynthesisUtterance(voiceQ.shift());
    u.lang = 'en-MY';
    u.onend = u.onerror = function () { voiceNext(); };
    window.speechSynthesis.speak(u);
  } catch (e) { /* no voice available */ }
}
export function say(text, urgent) {
  if (!ui.voice || !('speechSynthesis' in window)) return;
  if (urgent) voiceQ.unshift(text); else voiceQ.push(text);
  while (voiceQ.length > 2) voiceQ.splice(urgent ? voiceQ.length - 1 : 0, 1);
  if (!voiceBusy()) voiceNext();
}
function voiceStop() { voiceQ.length = 0; try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
async function lockScreen() {
  try { if (ui.nav && 'wakeLock' in navigator) ui.nav.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed, fine */ }
}
function unlockScreen() {
  try { if (ui.nav && ui.nav.wake) ui.nav.wake.release(); } catch (e) { /* ignore */ }
}
export function destLabel() { return ui.dest ? ui.dest.label : 'your destination'; }

// Stretches of the route where water is over the road or rising, with where they start and end along the route.
export function hazardsOf(line, c) {
  const out = [];
  if (!line || !line.parts) return out;
  line.parts.forEach(function (pt) {
    let st = L.edgeStatus(pt.edge, c.rain);
    // a reported blocked drain or fallen branch is a problem to warn about even when it is dry
    if (st === 'ok') st = pt.edge.blocked ? 'drain' : (pt.edge.reports || []).indexOf('Fallen branch') !== -1 ? 'branch' : (pt.edge.reports || []).length ? 'old' : 'ok';
    if (st === 'ok') return;
    const a = line.cum[pt.from], b = line.cum[pt.to], last = out[out.length - 1];
    if (last && last.where === pt.edge.where && Math.abs(last.end - a) < 1) { last.end = b; if (st === 'flooded' || (st === 'risk' && last.status !== 'flooded')) last.status = st; return; }
    out.push({ id: pt.edge.id, where: pt.edge.where, status: st, start: a, end: b, community: !!pt.edge.community });
  });
  return out;
}
export function hazardPhrase(h) {
  return h.status === 'flooded' ? 'is flooded' : h.status === 'drain' ? 'has a blocked drain (it floods easily in rain)' : h.status === 'branch' ? 'has a fallen branch' : h.status === 'old' ? 'had a flood or water report earlier, so check it before you walk' : 'is at risk of flooding, with water rising';
}
// Said and shown when the journey starts, if the route still crosses a problem
function startWarning(n) {
  const hs = n.hazards;
  if (!hs.length) return '';
  const names = uniq(hs.map(function (h) { return h.where; }));
  const first = hs[0];
  const flooded = hs.some(function (h) { return h.status === 'flooded'; });
  let t = 'Warning. ' + (names.length === 1 ? names[0] + ' ' + hazardPhrase(first) + ' and is on your route.' : 'Your route crosses ' + names.length + ' problem spots, starting with ' + names[0] + ', which ' + hazardPhrase(first) + '.');
  if (ui.pick === 'std') {
    const alt = ui.cur && ui.cur.T ? hazardsOf(Nav.routeLine(G, ui.cur.T), ui.c || computeConds()) : null;
    t += alt && alt.length < hs.length ? ' The Teduh route avoids ' + (alt.length ? 'most of them' : 'them') + '.' : ' Teduh found no better way.';
  } else {
    t += hs.some(function (h) { return h.status === 'flooded' || h.status === 'risk'; }) ? ' Teduh looked for another way, using roads and verified resident paths, and found none that avoids it.' : ' Teduh found no reasonable way round it.';
  }
  return t + (flooded ? ' Take great care or wait for the water to go down.' : ' Take care.');
}
function checkHazards(n) {
  if (n.arrived) return;
  n.hazards = hazardsOf(n.line, ui.c || computeConds());
  n.zone = null;
  n.hazards.forEach(function (h) {
    if (n.along > h.end) return;
    const to = h.start - n.along;
    if (to <= 0) { n.zone = { h: h, left: Math.max(0, h.end - n.along) }; return; }
    if (to <= 80 && !n.warned[h.id]) {
      n.warned[h.id] = true;
      n.near = { text: h.where + ' ' + hazardPhrase(h) + ', about ' + Nav.metres(to) + ' ahead.' };
      say('Caution. In ' + Nav.metres(to) + ', ' + h.where + ' ' + hazardPhrase(h) + '.', true);
    }
  });
  if (!n.zone && n.near && !n.hazards.some(function (h) { return h.start - n.along > 0 && h.start - n.along <= 80; })) n.near = null;
}

export function startJourney(sim) {
  const r = ui.pick === 'std' ? ui.cur.S : ui.cur.T;
  if (!r || ui.nav) return;
  const line = Nav.routeLine(G, r);
  ui.nav = {
    sim: !!sim, route: r, line: line, steps: Nav.steps(line, destLabel()),
    pos: null, snap: null, along: 0, left: line.total, off: 0, fixes: 0, lastReroute: 0, arrived: false, hazards: [], warned: {}, near: null, zone: null, startWarn: '',
    msg: '', watch: null, wake: null, simTimer: 0, simD: 0, said: {}, started: Date.now(), reroutes: 0
  };
  ui.follow = true; ui.tool = null; ui.report = null; ui.notice = ''; setCursor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const p0 = line.pts[0];
  tmap.setView(p0[0], p0[1], 17);
  if (sim) {
    ui.nav.msg = 'Demo walk with simulated GPS.';
    ui.nav.simTimer = setInterval(simStep, 500);
  } else {
    if (!navigator.geolocation) { ui.nav.msg = gpsMessage({ code: 0 }); }
    else if (window.isSecureContext === false) { ui.nav.msg = gpsMessage({ code: -1 }); }
    else {
      ui.nav.msg = 'Waiting for GPS.';
      ui.nav.watch = navigator.geolocation.watchPosition(function (p) { handleFix(fixFrom(p)); }, function (e) { if (ui.nav) { if (ui.nav.pos) ui.nav.gpsErr = gpsMessage(e); else ui.nav.msg = gpsMessage(e); bump(); } },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    }
  }
  lockScreen();
  ui.nav.hazards = hazardsOf(line, ui.c || computeConds());
  ui.nav.startWarn = startWarning(ui.nav);
  say('Starting. ' + ui.nav.steps[0].text);
  if (ui.nav.startWarn) say(ui.nav.startWarn, true);
  update();
}

export function simStep() {
  const n = ui.nav;
  if (!n || n.arrived) return;
  // Demo walk at a calm pace (about 2 to 5 m/s, so a route takes 1 to 2.5 minutes), and it waits while the voice guide is still speaking
  if (ui.voice && voiceBusy() && (n.simHold = (n.simHold || 0) + 1) <= 16) return;
  n.simHold = 0;
  n.simD += Math.max(1, Math.min(2.5, n.line.total / 300));    // metres per 0.5 s tick
  const p = Nav.pointAt(n.line, n.simD);
  if (p) handleFix({ lat: p.lat, lon: p.lon, acc: 5, heading: p.heading, speed: 2, ts: Date.now(), sim: true });
}

export function handleFix(fix) {
  const n = ui.nav;
  if (!n || n.arrived) return;
  if (fix.heading === null && n.pos) {
    const moved = Nav.dist([n.pos.lat, n.pos.lon], [fix.lat, fix.lon]);
    fix.heading = moved > 4 ? Nav.bearing([n.pos.lat, n.pos.lon], [fix.lat, fix.lon]) : n.pos.heading;
  }
  n.fixes++;
  n.gpsErr = '';
  n.pos = fix; ui.me = fix;
  const sn = Nav.snap(n.line, fix.lat, fix.lon);
  n.snap = sn;
  const tol = Math.max(40, fix.acc * 1.5);
  if (sn.off > tol) {
    n.off++;
    if ((n.fixes === 1 || n.off >= 3) && Date.now() - n.lastReroute > 8000) reroute(fix);
  } else {
    n.off = 0;
    n.along = Math.max(n.along, sn.along);
    n.left = Math.max(0, n.line.total - n.along);
  }
  const near = Nav.dist([fix.lat, fix.lon], [n.line.pts[n.line.pts.length - 1][0], n.line.pts[n.line.pts.length - 1][1]]);
  if (n.off === 0 && (n.left <= Math.max(15, Math.min(fix.acc, 30)) || near <= 12)) { arrive(); return; }
  const pr = Nav.progress(n.steps, n.along);
  // Remind about each turn three times: far (150 m), near (60 m) and at the turn (20 m)
  if (pr.next.kind !== 'arrive') {
    const stage = [20, 60, 150].filter(function (d) { return pr.toNext <= d; })[0];
    const key = pr.index + 1;
    if (stage && !(n.said[key] && n.said[key] <= stage)) {
      n.said[key] = stage;      // the smaller the number, the closer the reminder; farther ones are skipped once a closer one is given
      say(stage === 20 ? 'Now, ' + pr.next.text.charAt(0).toLowerCase() + pr.next.text.slice(1) : 'In ' + Nav.metres(pr.toNext) + ', ' + pr.next.text.charAt(0).toLowerCase() + pr.next.text.slice(1), stage === 20);
    }
  }
  checkHazards(n);
  if (ui.follow && ui.mapMode === 'plan') tmap.setView(fix.lat, fix.lon);
  update();
}

function reroute(fix) {
  const n = ui.nav, dest = nodeOf(ui.dest);
  n.lastReroute = Date.now();
  const a = L.nearestNode(G, fix.lat, fix.lon);
  if (a.dist > 250 || dest < 0) { n.msg = 'You are outside the loaded roads, so Teduh cannot route from here.'; return; }
  const r = L.route(G, a.node, dest, ui.pick === 'std' ? 'standard' : 'teduh', ui.c || computeConds(), ui.profile);
  if (!r) { n.msg = 'No walkable way from here to the destination.'; return; }
  n.route = r; n.line = Nav.routeLine(G, r); n.steps = Nav.steps(n.line, destLabel());
  n.along = 0; n.left = n.line.total; n.off = 0; n.said = {}; n.reroutes++;
  n.warned = {}; n.hazards = hazardsOf(n.line, ui.c || computeConds()); n.near = null; n.zone = null;
  n.startWarn = startWarning(n);
  n.msg = 'New route from where you are.';
  if (n.sim) n.simD = 0;
  say('Route updated.', true);
  if (n.startWarn) say(n.startWarn, true);
}

function arrive() {
  const n = ui.nav;
  n.arrived = true; n.left = 0;
  if (n.watch !== null) navigator.geolocation.clearWatch(n.watch);
  clearInterval(n.simTimer); unlockScreen();
  ui.follow = false;
  say('You have arrived at ' + destLabel(), true);
  update();
}

export function endNav(quiet) {
  const n = ui.nav;
  if (!n) return;
  if (n.watch !== null) navigator.geolocation.clearWatch(n.watch);
  clearInterval(n.simTimer); unlockScreen();
  voiceStop();
  ui.nav = null; ui.follow = false;
  if (n.sim) ui.me = null;
  if (!quiet) update();
}
export function recenter() {
  ui.follow = true;
  const n = ui.nav;
  if (n && n.pos && tmap) tmap.setView(n.pos.lat, n.pos.lon, Math.max(tmap.center().z, 17));
  update();
}
export function toggleVoice() {
  ui.voice = !ui.voice;
  try { localStorage.setItem('teduhVoice', ui.voice ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!ui.voice) voiceStop(); else say('Voice guidance on', true);
  bump();
}

// ---------- weather controls ----------

export function previewHour(i) {
  if (!ui.wx) return;
  const h = ui.wx.hourly[i];
  if (!h || i === 0) ui.preview = null; else ui.preview = { iso: h.time, day: Wx.isoDay(h.time), h: Wx.isoHour(h.time) };
  update();
}
export function previewDaytime() {
  if (!ui.wx) return;
  const hr = ui.wx.hourly;
  let best = -1;
  hr.forEach(function (h, i) { const x = Wx.isoHour(h.time); if (best < 0 && i > 0 && x >= 12 && x <= 15) best = i; });
  if (best >= 0) previewHour(best);
}
export function backToLive() { ui.preview = null; update(); }
export function setSim(v) { ui.sim = v; update(); }
export function toggleShowAll() { ui.showAll = !ui.showAll; update(); }

// ---------- chat ----------

function brief(s) {
  return {
    distanceM: s.dist, minutes: Math.max(1, Math.round(s.min)), shadePct: s.shadedPct, coveredWalkwayPct: s.coveredPct,
    sunExposureMin: Math.round(s.sunMin), litStreetsPct: s.litPct, flightsOfSteps: s.stepsN,
    streets: s.via.slice(0, 5).map(function (x) { return x.slice(0, 50); }),
    floodedRoads: uniq(s.flooded.map(function (e) { return e.where.slice(0, 60); })).slice(0, 3),
    roadsWithRisingWater: uniq(s.risk.map(function (e) { return e.where.slice(0, 60); })).slice(0, 3)
  };
}
function chatContext() {
  const c = conds(), p = curSample();
  const a = nodeOf(ui.start), b = nodeOf(ui.dest);
  const ctx = {
    profile: profile().label, area: G.name.slice(0, 60), time: Wx.hourText(viewClock().h), sun: sunWord(c),
    rain: round1(c.rain) + ' mm/h (' + Wx.rainWord(c.rain) + ')', itIsDark: c.dark > 0.5
  };
  if (ui.start) ctx.from = ui.start.label.slice(0, 60);
  if (ui.dest) ctx.to = ui.dest.label.slice(0, 60);
  if (p) {
    const d = Wx.describe(p.code, p.isDay);
    ctx.weather = { summary: d.label, tempC: p.temp === null ? null : Math.round(p.temp), feelsLikeC: p.feels === null || p.feels === undefined ? null : Math.round(p.feels), uv: p.uv === null || p.uv === undefined ? null : round1(p.uv) };
  }
  if (ui.sim !== null) ctx.simulatedStormMmPerHour = ui.sim;
  if (a >= 0 && b >= 0 && a !== b) {
    const S = L.route(G, a, b, 'standard', c, ui.profile), T = L.route(G, a, b, 'teduh', c, ui.profile);
    if (S && T) { ctx.shortestRoute = brief(L.stats(S, c, ui.profile)); ctx.teduhRoute = brief(L.stats(T, c, ui.profile)); ctx.sameRoute = L.sameRoute(S, T); }
    else ctx.noRoute = true;
  } else ctx.noRouteChosenYet = true;
  if (ui.tripW) ctx.rainDuringWalk = ui.tripW.maxRain >= 0.5 ? (ui.tripW.rainStartsInMin === 0 ? 'raining at the start' : 'starts about ' + ui.tripW.rainStartsInMin + ' min in') : 'none expected';
  ctx.roadsFloodingNow = alertList(c).filter(function (x) { return x.s === 'flooded'; }).slice(0, 3).map(function (x) { return x.e.where.slice(0, 60); });
  if (ui.wx && ui.wx.peak) ctx.forecastPeak = { rainMmPerHour: Math.round(ui.wx.peak.rain), around: Wx.hourText(Wx.isoHour(ui.wx.peak.time)) };
  return ctx;
}
export async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || ui.chatBusy) return;
  ui.chat.push({ role: 'user', text: text });
  ui.chatBusy = true; bump();
  try {
    const r = await Api.post('/api/chat', {
      messages: ui.chat.filter(function (m) { return !m.error; }).slice(-8).map(function (m) { return { role: m.role, text: m.text }; }),
      context: chatContext()
    });
    ui.chat.push({ role: 'assistant', text: r.reply });
  } catch (e) {
    ui.chat.push({ role: 'assistant', text: friendlyError(e), error: true });
  }
  ui.chat = ui.chat.slice(-16);
  ui.chatBusy = false; bump();
}

// ---------- reports ----------

async function downscale(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);   // redrawing also removes the photo's hidden location data
  let q = 0.72, url = cv.toDataURL('image/jpeg', q);
  while (url.length > 1000000 && q > 0.35) { q -= 0.12; url = cv.toDataURL('image/jpeg', q); }
  return url;
}
export function setReportField(k, v) { if (ui.report) { ui.report[k] = v; bump(); } }
export function cancelReport() { ui.report = null; update(); }
export async function choosePhoto(file) {
  if (!file || !ui.report) return;
  if (!/^image\//.test(file.type)) { ui.report.aiMsg = 'Please choose a photo.'; bump(); return; }
  try { ui.report.photo = await downscale(file); ui.report.ai = null; ui.report.aiMsg = ''; }
  catch (e) { ui.report.aiMsg = 'That photo format is not supported here. Try a JPEG or PNG.'; }
  bump();
}
export function clearPhoto() { if (!ui.report) return; ui.report.photo = null; ui.report.ai = null; bump(); }
export async function triage() {
  const r = ui.report;
  if (!r || r.busy) return;
  const note = r.note.trim();
  if (!r.photo && !note) { r.aiMsg = 'Add a photo or a short note first.'; r.ai = null; bump(); return; }
  r.busy = true; r.aiMsg = 'Checking'; r.ai = null; bump();
  try {
    const a = await Api.post('/api/triage', { text: note, image: r.photo });
    r.ai = a; r.aiMsg = '';
    if (a.type) r.type = a.type;
  } catch (e) { r.aiMsg = friendlyError(e); }
  r.busy = false; bump();
}
export async function sendReport() {
  const r = ui.report;
  if (!r || r.busy) return;
  const e = r.edge, type = r.type, note = r.note.trim();
  if (ui.online) {
    r.busy = true; bump();
    try {
      const body = { edgeId: e.id, type: type, note: note, lat: r.lat, lon: r.lon };
      if (r.ai) body.ai = { severity: r.ai.severity, summary: r.ai.summary };
      applyState(await Api.post('/api/report', body));
      ui.report = null;
      ui.notice = 'Report sent. Everyone using the app sees it now.' + (type === 'Blocked drain' ? ' Routes treat ' + e.where + ' as flooding from about ' + e.thr + ' mm/h.' : type === 'Flooded road' ? ' ' + e.where + ' now shows as flooded and routes avoid it for 3 hours.' : type === 'Water rising' ? ' ' + e.where + ' now shows as at risk for 3 hours.' : '');
    } catch (err) {
      r.busy = false;
      ui.notice = err.status === 429 ? 'Too many reports. Try again in a minute.' : 'Could not send the report: ' + friendlyError(err);
    }
    update();
    return;
  }
  e.reports.push(type);
  e.live = liveOf(e.reports, null);
  if (type === 'Blocked drain' && !e.blocked) { e.blocked = true; e.thr = Math.round(e.base * 0.6); }
  ui.report = null;
  ui.notice = 'Report added to the township team queue (demo, this device only).';
  update();
}

// ---------- township team ----------


// ---------- Township Team and Teduh admin sign-in ----------

export function isTeam() { return !!ui.auth && ui.auth.role === 'team'; }
export function isAdmin() { return !!ui.auth && ui.auth.role === 'admin'; }
function saveAuth(a) {
  ui.auth = a ? { token: a.token, role: a.role, username: a.username, x: Date.now() + 11.5 * 3600 * 1000 } : null;
  try { if (ui.auth) localStorage.setItem('teduhAuth', JSON.stringify(ui.auth)); else localStorage.removeItem('teduhAuth'); } catch (e) { /* private mode */ }
}
export function setAuthView(v) { ui.authView = v; ui.authMsg = ''; ui.authErr = false; bump(); }
export function readResetLink() {
  const m = /[?&]reset=([^&]+)/.exec(String(window.location.hash || ''));
  if (m) { ui.resetToken = decodeURIComponent(m[1]); ui.authView = 'reset'; history.replaceState(null, '', location.pathname + location.search + '#/team'); }
}
function authFail(e) { ui.authErr = true; ui.authMsg = friendlyError(e); }
async function authCall(fn) {
  ui.authBusy = true; ui.authMsg = ''; ui.authErr = false; bump();
  try { await fn(); } catch (e) { authFail(e); }
  ui.authBusy = false; update();
}
export function signIn(username, password) {
  return authCall(async function () {
    const r = await Api.post('/api/auth/login', { username: username, password: password });
    saveAuth(r); ui.teamNote = ''; ui.teamErr = false;
    if (r.role === 'admin') await loadAccounts();
  });
}
export function signUp(f) {
  return authCall(async function () {
    if (f.password !== f.password2) throw new Error('The two passwords do not match.');
    await Api.post('/api/auth/signup', { username: f.username, password: f.password, staffId: f.staffId, email: f.email });
    ui.authView = 'login'; ui.authMsg = 'Account created. Sign in with your username and password.'; ui.authErr = false;
  });
}
export function forgotPassword(email) {
  return authCall(async function () {
    const r = await Api.post('/api/auth/forgot', { email: email });
    ui.authMsg = r.mailed ? 'If that email is registered, a reset link has been sent to it. The link works once and lasts 30 minutes.' : 'Email sending is not set up on this server yet, so no email was sent. Ask the Teduh admin team.';
    ui.authErr = !r.mailed;
  });
}
export function resetPassword(password, password2) {
  return authCall(async function () {
    if (password !== password2) throw new Error('The two passwords do not match.');
    await Api.post('/api/auth/reset', { token: ui.resetToken, password: password });
    ui.resetToken = ''; ui.authView = 'login'; ui.authMsg = 'Password changed. Sign in with the new password.'; ui.authErr = false;
  });
}
export function signOut() { saveAuth(null); ui.accounts = []; ui.clearForm = null; ui.teamNote = ''; ui.authView = 'login'; ui.authMsg = ''; update(); }

async function teamAction(path, body, okNote) {
  try {
    applyState(await Api.post(path, body, ui.auth && ui.auth.token));
    ui.teamNote = okNote; ui.teamErr = false;
  } catch (err) {
    ui.teamErr = true;
    if (err.status === 401) { saveAuth(null); ui.authMsg = 'Your sign-in ran out. Please sign in again.'; ui.authErr = true; ui.teamNote = ''; }
    else ui.teamNote = friendlyError(err);
  }
  update();
}
export function resetDemo() {
  if (ui.online) { teamAction('/api/reset', null, 'Demo reset for everyone. Staff accounts and the clearance history are kept.'); return; }
  setDataset(Sample.build());
}
async function loadAccounts() {
  try { ui.accounts = (await Api.get('/api/admin/accounts', ui.auth.token)).accounts; } catch (e) { ui.accounts = []; }
}
export async function removeAccount(username) {
  try { ui.accounts = (await Api.post('/api/admin/account/delete', { username: username }, ui.auth.token)).accounts; ui.teamNote = 'Account ' + username + ' removed. The staff ID and email can register again.'; ui.teamErr = false; }
  catch (e) { ui.teamNote = friendlyError(e); ui.teamErr = true; }
  bump();
}
export function adminReview(edgeId, decision, reason) {
  teamAction('/api/admin/clear', { edgeId: edgeId, decision: decision, reason: reason || '' }, decision === 'approve' ? 'Approved. The issue is cleared and saved in the history.' : 'Sent back to the Township Team with your reason.');
}

// ---------- clearing an issue: before and after photos (video optional) ----------

export function openClear(id) {
  const e = G.edges.find(function (x) { return x.id === id; });
  if (!e) return;
  ui.clearForm = { edgeId: id, where: e.where, before: null, after: null, video: null, videoName: '', note: '', busy: false, msg: '' };
  bump();
  setTimeout(function () { const f = document.getElementById('clearForm'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50);
}
export function closeClear() { ui.clearForm = null; bump(); }
export function setClearNote(v) { if (ui.clearForm) { ui.clearForm.note = v; bump(); } }
export async function pickClearFile(which, file) {
  const f = ui.clearForm;
  if (!f || !file) return;
  try {
    if (which === 'video') {
      if (!/^video\/(mp4|webm)$/.test(file.type)) throw new Error('Choose an MP4 or WebM video.');
      if (file.size > 20 * 1024 * 1024) throw new Error('The video is over 20 MB. Choose a shorter clip.');
      f.video = file; f.videoName = file.name;
    } else {
      if (!/^image\//.test(file.type)) throw new Error('Please choose a photo.');
      f[which] = await downscale(file);
    }
    f.msg = '';
  } catch (e) { f.msg = friendlyError(e); }
  bump();
}
export function removeClearFile(which) { if (ui.clearForm) { ui.clearForm[which] = null; if (which === 'video') ui.clearForm.videoName = ''; bump(); } }
export async function sendClear() {
  const f = ui.clearForm;
  if (!f || f.busy) return;
  if (!f.before || !f.after) { f.msg = 'Both photos are required: one from before the work and one from after.'; bump(); return; }
  f.busy = true; f.msg = 'Uploading'; bump();
  try {
    const tok = ui.auth.token;
    // a data: address cannot be fetched under the page's security policy, so decode it by hand
    const blob = async function (url) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(url), bin = atob(m[2]), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: m[1] });
    };
    const b = await Api.upload('/api/team/media?kind=before', await blob(f.before), tok);
    const a = await Api.upload('/api/team/media?kind=after', await blob(f.after), tok);
    const v = f.video ? await Api.upload('/api/team/media?kind=video', f.video, tok) : null;
    const body = { edgeId: f.edgeId, before: b.id, after: a.id, note: f.note.trim() };
    if (v) body.video = v.id;
    applyState(await Api.post('/api/team/clear', body, tok));
    ui.clearForm = null; ui.teamNote = 'Sent to the Teduh admin team for review. The issue stays listed until they approve it.'; ui.teamErr = false;
  } catch (err) {
    f.busy = false;
    if (err.status === 401) { saveAuth(null); ui.authMsg = 'Your sign-in ran out. Please sign in again.'; ui.authErr = true; ui.clearForm = null; }
    else f.msg = friendlyError(err);
  }
  update();
}

export function reportNotes(e) {
  const st = ui.lastState && ui.lastState.edges[e.id];
  if (!st) return [];
  const lines = [];
  st.reports.forEach(function (r) {
    if (r.ai) lines.push('AI check: ' + r.ai.severity + ' severity' + (r.ai.summary ? ', ' + r.ai.summary : ''));
    if (r.note) lines.push('Resident: ' + r.note);
  });
  return lines.slice(0, 3);
}
export function teamSummary(c) {
  const items = G.edges.filter(function (e) { return e.blocked || e.reports.length; });
  const key = function (e) { return (e.live === 'flooded' ? 20 : e.live ? 12 : 0) + (e.blocked ? 10 : 0) + e.reports.length * 3 + (USAGE[e.id] || 0) * 2 + (e.base - e.thr) / 5; };
  items.sort(function (a, b) { return key(b) - key(a); });
  let hit = 0, kept = 0;
  TRIPS.forEach(function (t) {
    const s = L.route(G, t[0], t[1], 'standard', c, 'pedestrian');
    if (!s) return;
    const a = L.stats(s, c, 'pedestrian');
    if (a.flooded.length || a.risk.length) {
      hit++;
      const q = L.route(G, t[0], t[1], 'teduh', c, 'pedestrian');
      if (q) { const b = L.stats(q, c, 'pedestrian'); if (!b.flooded.length && !b.risk.length) kept++; }
    }
  });
  return { items: items.slice(0, 40), hit: hit, kept: kept, trips: TRIPS.length };
}
export function getImpact() {
  if (!G) return null;
  if (!ui.impact || ui.impact.g !== G) ui.impact = { g: G, v: L.impact(G, TRIPS) };
  return ui.impact.v;
}

// ---------- start ----------

export async function init() {
  mapEl = buildMapEl();
  tmap = TMap.create(mapEl, { onTap: onTap, onUserMove: function () { if (ui.nav && ui.follow) { ui.follow = false; bump(); } } });
  mapEl.querySelector('#locate').addEventListener('click', locateMe);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ui.tool) { ui.tool = null; setCursor(); setNotice(''); } });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { tick(); if (ui.nav && !ui.nav.arrived) lockScreen(); }
  });
  tick(); setInterval(tick, 1000);
  window.__teduh = {
    ui: ui, map: function () { return tmap; }, graph: function () { return G; },
    fix: handleFix, setTool: setTool, setPoint: setPoint, simStep: simStep, update: update, startJourney: startJourney, hazardsOf: hazardsOf, wx: function () { return ui.wx; }, tick: tick
  };   // handy for testing in the console
  let cfg = null;
  try { if (location.protocol !== 'file:') cfg = await Api.get('/api/config'); } catch (e) { cfg = null; }
  if (cfg) {
    readResetLink();
    ui.online = true; ui.features = cfg.features; ui.tiles = cfg.tiles; ui.satTiles = cfg.satelliteTiles || null;
    if (ui.auth) { try { await Api.get('/api/auth/me', ui.auth.token); if (ui.auth.role === 'admin') await loadAccounts(); } catch (e) { if (e.status === 401) saveAuth(null); } }
    await loadArea();
    locateOnStart();
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, 5000);
    setInterval(function () { if (!document.hidden) pullWeather(); }, 5 * 60 * 1000);
  } else {
    ui.online = false;
    setDataset(Sample.build());
    demoTrip();
    ui.areaMsg = 'The server is not running, so this is the sample township and everything stays on this device. Run npm start for real maps.';
    bump();
  }
}
