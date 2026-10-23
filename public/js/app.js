'use strict';
// The page. Ties together the map (map.js), the route logic (logic.js), the clock and weather helpers (wx.js),
// the walking navigation maths (nav.js), the server (api.js) and the sample township (sample.js).
// If the server cannot be reached the page still works on the sample township, on this device only.

(function () {
  const L = window.Logic, Wx = window.Wx, Nav = window.Nav;
  const $ = function (s) { return document.querySelector(s); };
  // Everything that came from outside (road names from OpenStreetMap, notes from residents) goes through esc() before it is put in the page.
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function shortHour(h) { const t = ((Math.round(h) % 24) + 24) % 24; return (t % 12 || 12) + (t >= 12 ? ' pm' : ' am'); }

  const ui = {
    view: 'walk', profile: 'pedestrian',
    start: null, dest: null, pick: 'teduh',
    tool: null, notice: '', showAll: false,
    online: false, rev: -1, lastState: null, tiles: null, features: {},
    wx: null, wxErr: '', wxAt: 0, wxBusy: false, preview: null, sim: null,
    clock: Wx.klNow(), c: null, cur: { S: null, T: null }, tripW: null, tripMin: null,
    areaMsg: '', planMsg: '', loading: false,
    report: null, chat: [], chatBusy: false,
    teamNote: '', teamErr: false,
    sg: { from: { items: [], geo: [], busy: false, open: false, active: -1, q: '', timer: 0 }, to: { items: [], geo: [], busy: false, open: false, active: -1, q: '', timer: 0 } },
    me: null, nav: null, follow: false, voice: false, locating: false
  };
  let G = null, TRIPS = [], USAGE = {}, INITIAL = [], tmap = null, chatSig = '';

  // ---------- wording ----------

  function sunWord(c) {
    if (c.dark > 0.6) return 'dark';
    const s = c.sunLoad;
    return s < 0.12 ? 'little direct sun' : s < 0.4 ? 'moderate sun' : s < 0.75 ? 'strong sun' : 'peak sun';
  }
  function friendlyError(e) { return e && e.message ? e.message : 'Something went wrong'; }
  function profile() { return L.PROFILES[ui.profile]; }

  // ---------- the clock and the weather at this moment ----------

  function liveClock() { return { h: ui.clock.h, dateKey: ui.clock.dateKey }; }
  function viewClock() { return ui.preview ? { h: ui.preview.h, dateKey: ui.preview.day } : liveClock(); }
  // the weather reading for the moment on screen: live now, or an hour picked from the forecast
  function curSample() {
    if (!ui.wx) return null;
    if (ui.preview) {
      const s = Wx.sample(ui.wx, ui.preview.day, ui.preview.h);
      return s ? Object.assign({ isDay: Wx.isDayAt(ui.wx, ui.preview.h) }, s) : null;
    }
    return Wx.nowSample(ui.wx);
  }
  function nodeOf(pt) { return pt && pt.node !== undefined ? pt.node : -1; }

  // the conditions the routes and flood warnings are worked out with
  function computeConds() {
    const sun = Wx.sunHours(ui.wx), p = curSample(), vc = viewClock();
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
  function conds() { return ui.c || computeConds(); }

  // ---------- loading a township ----------

  function showMapMsg(text) { const m = $('#mapMsg'); m.hidden = !text; m.textContent = text || ''; }

  function resolvePoint(pt) {
    if (!pt || !G) return;
    const nn = L.nearestNode(G, pt.lat, pt.lon);
    pt.node = nn.node >= 0 && nn.dist <= 250 ? nn.node : -1;
    pt.snap = nn.dist;
  }

  function setDataset(ds, keepPoints) {
    G = L.buildGraph(ds);
    const sampleOnline = ds.source === 'sample' && ui.online;     // with the server, the sample starts with no built-in blocked drain
    INITIAL = G.edges.map(function (e) { return { thr: sampleOnline ? e.base : e.thr, blocked: sampleOnline ? false : e.blocked }; });
    G.edges.forEach(function (e, i) { e.thr = INITIAL[i].thr; e.blocked = INITIAL[i].blocked; });
    TRIPS = L.makeTrips(G);
    USAGE = L.usageCounts(G, TRIPS);
    ui.tool = null; ui.report = null; ui.showAll = false; ui.notice = ''; ui.preview = ui.preview;
    if (keepPoints) { resolvePoint(ui.start); resolvePoint(ui.dest); }
    else { ui.start = null; ui.dest = null; ui.planMsg = ''; syncInputs(); }
    tmap.setGraph(G);
    tmap.setTiles(ds.source === 'sample' ? null : ui.tiles, ui.tiles ? ui.tiles.attribution : '');
    tmap.fit();
    if (ui.lastState) applyState(ui.lastState);
    $('#dataNotes').innerHTML = (ds.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    renderAll();
  }

  function areaSummary(ds) {
    if (ds.source === 'sample') return 'Showing the sample township. Its roads and numbers are invented.';
    const s = ds.stats;
    return 'Loaded ' + ds.name + ': ' + plural(s.roads, 'road segment') + ', ' + plural(s.trees, 'mapped tree') + ', ' +
      plural(s.covered, 'covered walkway') + ', ' + plural(s.places, 'landmark') + '.' +
      (s.trees < 15 ? ' Few trees are mapped here, so shade may be underestimated.' : '');
  }

  // p: { lat, lon, r, name }; opts.keepPoints keeps the chosen start and destination
  async function loadArea(p, opts) {
    ui.loading = true;
    showMapMsg('Loading roads, trees and terrain. This can take up to a minute the first time.');
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
      if (!G) setDataset(window.Sample.build());
    }
    ui.loading = false;
    renderAll();
    return ok;
  }

  // ---------- server state (shared reports) ----------

  function applyState(st) {
    ui.lastState = st; ui.rev = st.rev;
    G.edges.forEach(function (e, i) {
      const s = st.edges[e.id];
      if (s) {
        e.blocked = !!s.blocked;
        e.reports = s.reports.map(function (r) { return r.type; });
        e.thr = e.blocked ? (INITIAL[i].blocked ? INITIAL[i].thr : Math.round(e.base * 0.6)) : e.base;
      } else {
        e.blocked = INITIAL[i].blocked; e.thr = INITIAL[i].thr; e.reports = [];
      }
    });
  }
  async function refresh() {
    try {
      const st = await Api.get('/api/state');
      if (!G) return;
      if (!ui.online || st.rev !== ui.rev) { ui.online = true; applyState(st); renderAll(); }
    } catch (e) {
      if (ui.online) { ui.online = false; renderAll(); }
    }
  }

  // ---------- live weather ----------

  function canLive() { return ui.online && G && G.ds.source !== 'sample'; }
  async function pullWeather() {
    if (!canLive() || ui.wxBusy) return;
    ui.wxBusy = true;
    const at = ui.nav && ui.nav.pos && !ui.nav.sim ? ui.nav.pos : G.ds.center;
    try {
      ui.wx = await Api.get('/api/weather?lat=' + Number(at.lat).toFixed(4) + '&lon=' + Number(at.lon !== undefined ? at.lon : at.lng).toFixed(4));
      ui.wxErr = ''; ui.wxAt = Date.now();
    } catch (e) {
      ui.wxErr = 'Live weather is not available right now.' + (ui.wx ? ' Showing the last reading.' : '');
    }
    ui.wxBusy = false;
    renderAll();
  }

  // ---------- the clock ----------

  function tick() {
    const n = Wx.klNow(), minuteChanged = n.mm !== ui.clock.mm || n.hh !== ui.clock.hh;
    ui.clock = n;
    $('#clockTime').textContent = Wx.clockText(n);
    $('#clockDate').textContent = n.dateLabel + ' · Malaysia time';
    if (minuteChanged && G) renderAll();                       // the sun, darkness and walk weather follow the clock every minute
    if (G && canLive() && !document.hidden && Date.now() - ui.wxAt > 6 * 60 * 1000) pullWeather();
  }

  // ---------- points: where from and where to ----------

  function pointOf(which) { return which === 'from' ? ui.start : ui.dest; }
  function setPointRaw(which, pt) { if (which === 'from') ui.start = pt; else ui.dest = pt; }

  function syncInputs() {
    [['from', ui.start], ['to', ui.dest]].forEach(function (x) {
      const inp = $('#' + x[0] + 'In');
      if (document.activeElement !== inp || x[1]) inp.value = x[1] ? x[1].label : '';
      $('#' + x[0] + 'X').hidden = !inp.value;
    });
  }

  function mapPoints() {
    const out = [];
    [ui.start, ui.dest].forEach(function (p) { if (p) out.push([p.lat, p.lon]); });
    return out;
  }

  // Needs both ends on loaded roads. When one end is outside the loaded area, load an area that covers both.
  async function ensureArea() {
    const pts = [ui.start, ui.dest].filter(Boolean);
    if (!pts.length || !G || ui.loading) return false;
    if (pts.every(function (p) { return p.node >= 0; })) return true;
    if (!ui.online) { ui.planMsg = 'That place is outside the sample map. Run npm start to use real maps.'; return false; }
    let lat, lon, r = 600;
    if (pts.length === 2) {
      const d = Nav.dist([pts[0].lat, pts[0].lon], [pts[1].lat, pts[1].lon]);
      if (d > 2600) { ui.planMsg = 'These two places are ' + (d / 1000).toFixed(1) + ' km apart. Teduh plans walks up to about 2.5 km. Pick closer places.'; return false; }
      lat = (pts[0].lat + pts[1].lat) / 2; lon = (pts[0].lon + pts[1].lon) / 2;
      r = clamp(Math.round(d / 2 * 1.25 + 300), 500, 1500);
    } else { lat = pts[0].lat; lon = pts[0].lon; }
    ui.planMsg = 'Loading roads for this trip.'; renderArea();
    const ok = await loadArea({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)), r: r, name: pts[pts.length - 1].label }, { keepPoints: true });
    if (!ok) { ui.planMsg = ui.areaMsg; return false; }
    const bad = pts.filter(function (p) { return p.node < 0; })[0];
    if (bad) { ui.planMsg = 'No walkable road found near "' + bad.label + '". Try a nearby street or landmark.'; return false; }
    ui.planMsg = '';
    return true;
  }

  async function pointsChanged() {
    if (ui.nav) endNav(true);
    ui.planMsg = '';
    if (ui.start && ui.dest && ui.start.lat === ui.dest.lat && ui.start.lon === ui.dest.lon) ui.planMsg = 'Start and destination are the same place.';
    else if (ui.start || ui.dest) await ensureArea();
    syncInputs(); renderAll();
    const pts = mapPoints();
    if (pts.length > 1) tmap.fitPoints(pts, 46);
    else if (pts.length === 1) tmap.setView(pts[0][0], pts[0][1], Math.max(tmap.center().z, 16));
  }

  async function setPoint(which, pt) {
    resolvePoint(pt);
    setPointRaw(which, pt);
    ui.pick = 'teduh';
    ui.sg[which].open = false;
    syncInputs();
    await pointsChanged();
  }
  function clearPoint(which) {
    setPointRaw(which, null);
    $('#' + which + 'In').value = '';
    syncInputs();
    pointsChanged();
  }

  function demoTrip() {
    if (!G) return;
    const t = L.defaultTrip(G);
    const a = G.nodes[t[0]], b = G.nodes[t[1]];
    const pa = G.places.filter(function (p) { return p.node === t[0]; })[0], pb = G.places.filter(function (p) { return p.node === t[1]; })[0];
    ui.start = { lat: a[0], lon: a[1], label: pa ? pa.name : 'Start', kind: 'place' };
    ui.dest = { lat: b[0], lon: b[1], label: pb ? pb.name : 'Destination', kind: 'place' };
    resolvePoint(ui.start); resolvePoint(ui.dest);
    ui.pick = 'teduh';
    pointsChanged();
  }

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
  function getPos() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej({ code: 0 });
      if (window.isSecureContext === false) return rej({ code: -1 });
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
    });
  }
  function fixFrom(p) {
    const c = p.coords;
    return { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, heading: Number.isFinite(c.heading) ? c.heading : null, speed: Number.isFinite(c.speed) ? c.speed : null, ts: p.timestamp };
  }

  async function useMyLocation(which) {
    ui.planMsg = 'Finding your location.'; renderArea();
    try {
      const f = fixFrom(await getPos());
      ui.me = f;
      ui.planMsg = '';
      await setPoint(which, { lat: f.lat, lon: f.lon, label: 'Your location', kind: 'gps' });
    } catch (e) { ui.planMsg = gpsMessage(e); renderAll(); }
  }

  async function locateMe() {
    if (ui.locating) return;
    ui.locating = true; setNotice('Finding your location.');
    try {
      const f = fixFrom(await getPos());
      ui.me = f; setNotice('');
      const nn = G ? L.nearestNode(G, f.lat, f.lon) : null;
      tmap.setView(f.lat, f.lon, Math.max(tmap.center().z, 16));
      if (nn && nn.dist > 400 && canLive()) setNotice('You are outside the loaded roads. Choose "Load roads here" to load this area.');
    } catch (e) { setNotice(gpsMessage(e)); }
    ui.locating = false; renderAll();
  }

  // ---------- suggestions (the dropdown under the From and To boxes) ----------

  function suggestItems(which) {
    const sg = ui.sg[which], q = pointOf(which) ? '' : $('#' + which + 'In').value.trim().toLowerCase();   // with a place already chosen, show the full list
    const items = [];
    if (!q || 'your location'.indexOf(q) === 0 || 'my location'.indexOf(q) === 0) items.push({ kind: 'gps', label: 'Your location', sub: 'Use GPS' });
    if (!q) items.push({ kind: 'map', label: 'Choose on map', sub: 'Tap a spot on the map' });
    if (G) {
      G.places.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; }).slice(0, q ? 5 : 6)
        .forEach(function (p) { items.push({ kind: 'place', label: p.name, sub: 'Landmark in ' + G.name, lat: p.lat, lon: p.lon }); });
    }
    sg.geo.forEach(function (g) {
      if (items.some(function (i) { return i.label === g.name && Math.abs((i.lat || 0) - g.lat) < 0.0005; })) return;
      items.push({ kind: 'geo', label: g.name, sub: g.label, lat: g.lat, lon: g.lon });
    });
    if (sg.busy) items.push({ kind: 'hint', label: 'Searching all of Malaysia', sub: '' });
    else if (q.length >= 3 && !sg.geo.length && ui.online && sg.q === q) items.push({ kind: 'hint', label: 'No more places found', sub: 'Try another spelling' });
    return items;
  }
  const SG_ICON = {
    gps: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    map: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>',
    place: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z"/></svg>',
    geo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    hint: ''
  };
  function renderSuggest(which) {
    const sg = ui.sg[which], list = $('#' + which + 'List'), inp = $('#' + which + 'In');
    sg.items = suggestItems(which);
    list.hidden = !sg.open || !sg.items.length;
    inp.setAttribute('aria-expanded', String(!list.hidden));
    list.innerHTML = sg.items.map(function (it, i) {
      return '<li role="option" data-i="' + i + '" class="' + (i === sg.active ? 'on ' : '') + (it.kind === 'hint' ? 'hintrow' : '') + '" aria-selected="' + (i === sg.active) + '">' +
        '<span class="sg-ic">' + (SG_ICON[it.kind] || '') + '</span><span class="sg-tx"><b>' + esc(it.label) + '</b>' + (it.sub ? '<span>' + esc(it.sub) + '</span>' : '') + '</span></li>';
    }).join('');
  }
  function openSuggest(which) { ui.sg[which].open = true; ui.sg[which].active = -1; renderSuggest(which); }
  function closeSuggest(which) { ui.sg[which].open = false; renderSuggest(which); }
  function scheduleGeocode(which) {
    const sg = ui.sg[which], q = $('#' + which + 'In').value.trim();
    clearTimeout(sg.timer);
    sg.geo = []; sg.busy = false;
    if (q.length < 3 || !ui.online) return;
    sg.timer = setTimeout(async function () {
      sg.busy = true; renderSuggest(which);
      try {
        const r = await Api.get('/api/geocode?q=' + encodeURIComponent(q));
        if ($('#' + which + 'In').value.trim() !== q) return;
        sg.geo = r.results; sg.q = q.toLowerCase();
      } catch (e) { sg.geo = []; sg.q = ''; }
      sg.busy = false; renderSuggest(which);
    }, 450);
  }
  function chooseSuggest(which, i) {
    const it = ui.sg[which].items[i];
    if (!it || it.kind === 'hint') return;
    ui.sg[which].open = false; renderSuggest(which);
    if (it.kind === 'gps') { useMyLocation(which); return; }
    if (it.kind === 'map') { setTool(which); $('#mapc').focus(); return; }
    setPoint(which, { lat: it.lat, lon: it.lon, label: it.label, kind: it.kind });
  }

  // ---------- map taps and tools ----------

  function setTool(t) {
    ui.tool = ui.tool === t ? null : t;
    renderTools();
    if (ui.tool) setNotice(ui.tool === 'report' ? 'Tap the road where the problem is.' : 'Tap the map to set the ' + (ui.tool === 'from' ? 'start' : 'destination') + '.');
    else setNotice('');
  }
  function setNotice(text) { ui.notice = text || ''; const n = $('#notice'); n.hidden = !ui.notice; n.textContent = ui.notice; }

  function onTap(h) {
    if (!G) return;
    if (ui.tool === 'from' || ui.tool === 'to') {
      const nn = L.nearestNode(G, h.lat, h.lon);
      if (nn.node < 0 || nn.dist > 250) { setNotice('That spot is too far from a mapped road. Tap closer to a road.'); return; }
      const which = ui.tool;
      const label = h.place ? h.place.name : h.edge ? h.edge.road + ' (dropped pin)' : 'Dropped pin';
      ui.tool = null; setNotice('');
      setPoint(which, { lat: h.lat, lon: h.lon, label: label, kind: 'pin' });
      return;
    }
    if (ui.tool === 'report') {
      if (!h.edge) { setNotice('No road there. Tap on a road to report a problem.'); return; }
      ui.report = { edge: h.edge, lat: h.lat, lon: h.lon, photo: null, ai: null, busy: false };
      ui.tool = null; setNotice('');
      resetReportForm(); renderAll();
      $('#reportForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
  }

  // ---------- rendering: routes ----------

  function routeCard(kind, title, s, c) {
    const P = profile();
    const sun = Math.round(s.sunMin);
    const via = s.via.slice(0, 4).map(esc).join(', then ') + (s.via.length > 4 ? ', and ' + (s.via.length - 4) + ' more' : '');
    const extras = [];
    if (s.coveredPct > 0) extras.push('covered walkway ' + s.coveredPct + '%');
    if (c.dark > 0.5) extras.push('lit streets ' + s.litPct + '%');
    if (s.stepsN) extras.push(plural(s.stepsN, 'flight') + ' of steps');
    const flood = s.flooded.length
      ? '<span class="pill p-bad">Flooded</span><span>Crosses ' + plural(s.flooded.length, 'flooded road') + ': ' + uniq(s.flooded.map(function (e) { return e.where; })).slice(0, 3).map(esc).join(', ') + (s.flooded.length > 3 ? ' and more' : '') + '.</span>'
      : s.risk.length
        ? '<span class="pill p-risk">Rising</span><span>Passes ' + plural(s.risk.length, 'road') + ' where water is rising: ' + uniq(s.risk.map(function (e) { return e.where; })).slice(0, 3).map(esc).join(', ') + (s.risk.length > 3 ? ' and more' : '') + '.</span>'
        : '<span class="pill p-ok">Clear</span><span>No flooding or rising water on this route.</span>';
    const icon = kind === 'teduh'
      ? '<svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--accent)" stroke-width="4.5" stroke-linecap="round"/></svg>'
      : '<svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--sun)" stroke-width="4" stroke-linecap="round" stroke-dasharray="6 4"/></svg>';
    const picked = (kind === 'teduh') === (ui.pick !== 'std');
    return '<article class="rc rc-' + kind + (picked ? ' picked' : '') + '" data-route="' + kind + '" role="button" tabindex="0" aria-pressed="' + picked + '"><h3>' + icon + title + (picked ? '<span class="sel">Selected</span>' : '') + '</h3>' +
      '<p class="via">via ' + via + '</p>' +
      '<dl><div><dt>Distance</dt><dd>' + s.dist + ' <small>m</small></dd></div>' +
      '<div><dt>' + (P.verb === 'ride' ? 'Ride' : 'Walk') + '</dt><dd>' + Math.max(1, Math.round(s.min)) + ' <small>min</small></dd></div>' +
      '<div><dt>In shade</dt><dd>' + s.shadedPct + '<small>%</small></dd></div>' +
      '<div><dt>Sun exposure</dt><dd>' + (sun < 1 ? '&lt;1' : sun) + ' <small>min</small></dd></div></dl>' +
      (extras.length ? '<p class="via" style="margin-top:8px">' + extras.join(' · ') + '</p>' : '') +
      '<p class="fl">' + flood + '</p></article>';
  }

  function renderResults(S, T, c) {
    const P = profile();
    const a = nodeOf(ui.start), b = nodeOf(ui.dest);
    $('#startBar').hidden = true; $('#startMsg').hidden = true;
    $('#cardHint').hidden = true;
    ui.cur = { S: S, T: T };
    if (!ui.start || !ui.dest) {
      $('#headline').textContent = ui.start || ui.dest ? 'Now choose ' + (ui.start ? 'a destination' : 'a start') + '.' : 'Where to? Choose a start and destination.';
      $('#cards').innerHTML = '';
      return;
    }
    if (a < 0 || b < 0) { $('#headline').textContent = ui.loading ? 'Loading the roads for this trip.' : 'These places are not on the loaded roads yet.'; $('#cards').innerHTML = ''; return; }
    if (a === b) { $('#headline').textContent = 'Pick two different spots.'; $('#cards').innerHTML = ''; return; }
    if (!T || !S) {
      $('#headline').textContent = 'There is no way between these two spots for ' + P.label.toLowerCase() + '. Try another start or destination.';
      $('#cards').innerHTML = '';
      return;
    }
    const ss = L.stats(S, c, ui.profile), ts = L.stats(T, c, ui.profile);
    let h;
    if (ts.flooded.length) {
      h = 'No fully dry route right now. Teduh picks the least flooded one, but waiting for the rain to ease is safer.';
    } else if (L.sameRoute(S, T)) {
      h = 'The shortest route is also the best one in these conditions. Try the storm simulator under Weather to see Teduh choose differently.';
    } else {
      const parts = [], dd = ts.dist - ss.dist;
      parts.push(dd > 0 ? 'adds ' + dd + ' m' : dd < 0 ? 'saves ' + (-dd) + ' m' : 'keeps the same distance');
      const dsun = Math.round(ss.sunMin - ts.sunMin);
      if (dsun >= 1) parts.push('cuts sun exposure by ' + dsun + ' min');
      if (ts.coveredPct > ss.coveredPct + 4) parts.push('adds ' + (ts.coveredPct - ss.coveredPct) + '% covered walkway');
      const bad = uniq(ss.flooded.concat(ss.risk).map(function (e) { return e.where; }));
      if (bad.length) parts.push('avoids ' + bad.slice(0, 2).join(' and ') + (bad.length > 2 ? ' and ' + (bad.length - 2) + ' more' : ''));
      h = 'Teduh ' + parts.join(', ') + '.';
    }
    $('#headline').textContent = h;
    $('#cards').innerHTML = routeCard('std', 'Shortest route', ss, c) + routeCard('teduh', 'Teduh route', ts, c);
    $('#startBar').hidden = false; $('#cardHint').hidden = false;
    const chosen = ui.pick === 'std' ? S : T;
    $('#startBtn').textContent = 'Start · ' + Math.max(1, Math.round((ui.pick === 'std' ? ss : ts).min)) + ' min';
    ui.cur.line = Nav.routeLine(G, chosen);
    ui.cur.stats = ui.pick === 'std' ? ss : ts;
  }

  function alertList(c) {
    return G.edges.map(function (e) { return { e: e, s: L.edgeStatus(e, c.rain) }; })
      .filter(function (x) { return x.s !== 'ok'; })
      .sort(function (a, b) { return (a.s === 'flooded' ? 0 : 1) - (b.s === 'flooded' ? 0 : 1) || a.e.thr - b.e.thr || (USAGE[b.e.id] || 0) - (USAGE[a.e.id] || 0); });
  }
  function rainSource() {
    if (ui.sim !== null) return 'the simulated storm';
    if (ui.tripW && ui.tripW.maxRain > 0) return 'the rain during your walk';
    return ui.preview ? 'the rain at ' + Wx.hourText(ui.preview.h) : 'the rain right now';
  }
  function renderAlerts(c) {
    const list = alertList(c);
    $('#alertSub').textContent = 'Roads where water is rising, using ' + rainSource() + ' (' + round1(c.rain) + ' mm/h).';
    if (!list.length) {
      $('#alerts').innerHTML = '<li><div class="empty" style="width:100%">No roads at risk at ' + round1(c.rain) + ' mm/h. Pick a storm under Weather to see warnings appear.</div></li>';
      return;
    }
    const shown = ui.showAll ? list : list.slice(0, 5);
    $('#alerts').innerHTML = shown.map(function (x) {
      const f = x.s === 'flooded';
      return '<li><span class="pill ' + (f ? 'p-bad' : 'p-risk') + '">' + (f ? 'Flooded now' : 'Rising') + '</span>' +
        '<div class="txt"><b>' + esc(x.e.where) + '</b><span>' + (f ? 'Water is over the road.' : 'May flood if rain continues.') + ' Floods at about ' + x.e.thr + ' mm/h' + (x.e.blocked ? ', drain blocked' : '') + '.</span></div></li>';
    }).join('') + (list.length > 5 ? '<li><button type="button" class="btn ghost sm" id="moreBtn" aria-expanded="' + ui.showAll + '">' + (ui.showAll ? 'Show fewer' : 'Show ' + (list.length - 5) + ' more') + '</button></li>' : '');
  }

  function renderImpact() {
    if (!G) return;
    if (!ui.impact || ui.impact.g !== G) ui.impact = { g: G, v: L.impact(G, TRIPS) };
    const m = ui.impact.v, sc = L.SCENARIOS, k = [];
    if (m.sun) {
      k.push('<div class="kpi"><b>' + m.sun.savedPct + '%</b><span>less time in direct sun on the Teduh route. ' + round1(m.sun.stdMin) + ' min on the shortest route, ' + round1(m.sun.tedMin) + ' min on Teduh. Reference: ' + esc(sc.sun.label) + '.</span></div>');
      k.push('<div class="kpi"><b>+' + round1(Math.max(0, m.sun.extraMin)) + ' min</b><span>average extra walking time for that shade, across all trips and walker types.</span></div>');
    }
    k.push('<div class="kpi"><b>' + m.rain.kept + ' of ' + m.rain.wet + '</b><span>trips that cross a flooding or rising road on the shortest route, and stay dry on the Teduh route. Reference: ' + esc(sc.rain.label) + '.</span></div>');
    k.push('<div class="kpi"><b>' + m.trips + '</b><span>typical trips between landmarks, each checked for all 5 walker types (' + m.pairs + ' comparisons).</span></div>');
    $('#impKpis').innerHTML = k.join('');
    const w = Math.max(0, Math.min(1000000, Number($('#impWalkers').value) || 0));
    $('#impScale').textContent = m.sun
      ? 'If ' + w.toLocaleString('en-MY') + ' people walk a typical trip each day, that is about ' + Math.round(w * m.sun.savedMin).toLocaleString('en-MY') + ' minutes a day out of the sun (sunny afternoon). This is arithmetic on your assumption, not a forecast.'
      : '';
  }

  function renderTeam(c) {
    renderImpact();
    const items = G.edges.filter(function (e) { return e.blocked || e.reports.length; });
    const key = function (e) { return (e.blocked ? 10 : 0) + e.reports.length * 3 + (USAGE[e.id] || 0) * 2 + (e.base - e.thr) / 5; };
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
    const rr = round1(c.rain);
    $('#teamLine').textContent = hit
      ? 'At ' + rr + ' mm/h, ' + hit + ' of ' + TRIPS.length + ' typical trips between landmarks would cross a road that is flooding or about to. Teduh keeps ' + kept + ' of them dry.'
      : 'At ' + rr + ' mm/h, none of the ' + TRIPS.length + ' typical trips crosses a road at risk. Use the storm simulator under Weather to see the queue matter.';
    if (!items.length) {
      $('#queue').innerHTML = '<li><div class="empty" style="width:100%">No blocked drains right now. Resident reports will appear here, ranked by how many trips they affect.</div></li>';
      return;
    }
    $('#queue').innerHTML = items.slice(0, 40).map(function (e) {
      const fix = e.thr <= 35;
      const types = e.reports.length ? uniq(e.reports).map(function (t) { return t + ' x' + e.reports.filter(function (r) { return r === t; }).length; }).join(', ') : 'Found by inspection';
      const notes = reportNotes(e);
      return '<li><span class="pill ' + (fix ? 'p-bad' : 'p-risk') + '">' + (fix ? 'Fix first' : 'Watch') + '</span>' +
        '<div class="txt"><b>' + esc(e.where) + '</b><span>Floods at about ' + e.thr + ' mm/h (normal ' + e.base + '). On ' + (USAGE[e.id] || 0) + ' of ' + TRIPS.length + ' typical trips.</span><span>' + esc(types) + '</span>' + notes + '</div>' +
        '<button type="button" class="btn ghost sm" data-clear="' + esc(e.id) + '">Mark cleared</button></li>';
    }).join('');
  }
  function reportNotes(e) {
    const st = ui.lastState && ui.lastState.edges[e.id];
    if (!st) return '';
    const lines = [];
    st.reports.forEach(function (r) {
      if (r.ai) lines.push('AI check: ' + r.ai.severity + ' severity' + (r.ai.summary ? ', ' + r.ai.summary : ''));
      if (r.note) lines.push('Resident: ' + r.note);
    });
    return lines.slice(0, 3).map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('');
  }

  function legendHTML(walk) {
    const sw = function (inner) { return '<svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">' + inner + '</svg>'; };
    const items = [
      sw('<circle cx="6" cy="6" r="4" fill="var(--canopy)" opacity=".6"/><circle cx="13" cy="7" r="3.5" fill="var(--canopy)" opacity=".5"/>') + 'Tree shade',
      sw('<line x1="1" y1="6" x2="19" y2="6" stroke="var(--road)" stroke-width="8" stroke-linecap="round"/><line x1="1" y1="6" x2="19" y2="6" stroke="var(--cover)" stroke-width="2.5"/>') + 'Covered walkway',
      sw('<rect x="5" y="1" width="10" height="10" rx="2" fill="var(--warn)"/>') + 'Blocked drain',
      sw('<line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" stroke-width="8" stroke-linecap="round"/>') + 'Flooded',
      sw('<line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" stroke-width="8" stroke-linecap="round" opacity=".28"/><line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" stroke-width="2" stroke-dasharray="3 3"/>') + 'Water rising'
    ];
    if (walk) {
      items.push(sw('<line x1="1" y1="6" x2="19" y2="6" stroke="var(--sun)" stroke-width="5" stroke-linecap="round" stroke-dasharray="6 4"/>') + 'Shortest route');
      items.push(sw('<line x1="1" y1="6" x2="19" y2="6" stroke="var(--accent)" stroke-width="4.5" stroke-linecap="round"/>') + 'Teduh route');
      items.push(sw('<circle cx="10" cy="6" r="4.5" fill="#fff"/><circle cx="10" cy="6" r="3" fill="#2563EB"/>') + 'You');
    }
    return items.map(function (i) { return '<span>' + i + '</span>'; }).join('');
  }

  function renderArea() {
    $('#areaNote').textContent = ui.areaMsg;
    $('#planMsg').textContent = ui.planMsg;
    $('#planMsg').hidden = !ui.planMsg;
    $('#demoRow').hidden = !(G && !ui.start && !ui.dest && !ui.nav);
  }
  function renderTools() {
    document.querySelectorAll('#tools [data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', String(ui.tool === b.getAttribute('data-tool'))); });
    $('#mapc').style.cursor = ui.tool ? 'crosshair' : '';
  }
  function renderReport() {
    const f = $('#reportForm');
    f.hidden = !ui.report;
    $('#repHint').hidden = !!ui.report;
    if (!ui.report) return;
    $('#repSpot').innerHTML = 'Where: <b>' + esc(ui.report.edge.where) + '</b>';
    const prev = $('#repPreview');
    prev.hidden = !ui.report.photo; if (ui.report.photo) prev.src = ui.report.photo;
    $('#repPhotoClear').hidden = !ui.report.photo;
    const aiOn = ui.online && ui.features.triage;
    $('#repAiBtn').classList.toggle('off', !aiOn);
    $('#repAiBtn').disabled = !!ui.report.busy;
    $('#repSend').disabled = !!ui.report.busy;
    const box = $('#repAi');
    const a = ui.report.ai;
    box.hidden = !a && !ui.report.aiMsg;
    box.textContent = a ? 'AI check: ' + (a.type || 'not a drain or water problem') + ', ' + a.severity + ' severity. ' + (a.summary || '') : (ui.report.aiMsg || '');
  }
  function renderChat() {
    const on = ui.online && ui.features.chat;
    $('#chatSec').classList.toggle('off', !on);
    if (!on) return;
    const sig = JSON.stringify([ui.chat, ui.chatBusy, ui.features.chat]);
    if (sig === chatSig) return;          // nothing changed, so leave the chat (and its scroll position) alone
    chatSig = sig;
    $('#chatLog').innerHTML = ui.chat.map(function (m) { return '<p class="bubble ' + (m.role === 'user' ? 'me' : 'bot') + (m.error ? ' err' : '') + '">' + esc(m.text) + '</p>'; }).join('') +
      (ui.chatBusy ? '<p class="bubble bot">Thinking</p>' : '');
    $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
    $('#chatSend').disabled = ui.chatBusy;
    $('#chatSuggest').innerHTML = ui.chat.length ? '' : ['Which way is the shadiest?', 'Will I get wet?', 'Any covered walkways?', 'Should I wait out the rain?'].map(function (q) { return '<button type="button" class="chip" data-ask="' + esc(q) + '">' + esc(q) + '</button>'; }).join('');
    $('#chatSub').textContent = 'A friendly walking buddy powered by ' + (ui.features.chat === 'gemini' ? 'Gemini' : 'Claude') + '. It only talks about the routes above.';
  }

  // ---------- rendering: weather ----------

  function wxCell(label, value, sub) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + value + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</dd></div>';
  }
  function renderWx(c) {
    const W = ui.wx, p = curSample();
    // status line
    let status;
    if (!canLive()) status = ui.online ? 'Live weather is for real areas. This sample map has none.' : 'Live weather needs the server. Run npm start.';
    else if (ui.wxErr) status = ui.wxErr;
    else if (!W) status = 'Loading the weather.';
    else {
      const age = Math.round((Date.now() - ui.wxAt) / 60000);
      status = 'Live · updated ' + (age < 1 ? 'just now' : age + ' min ago') + ' · ' + (W.source || 'Open-Meteo');
    }
    $('#wxStatus').textContent = status;
    $('#wxStatus').classList.toggle('stale', !!ui.wxErr);

    const pv = $('#wxPreview');
    pv.hidden = !ui.preview;
    if (ui.preview) $('#wxPreviewText').textContent = 'Previewing ' + Wx.hourText(ui.preview.h) + (ui.preview.day !== ui.clock.dateKey ? ' tomorrow' : '') + '. Routes and flood risk use this hour.';

    // current conditions
    if (!p) {
      $('#wxNow').innerHTML = '<div class="empty">No weather reading yet. The clock, sun and routes still work.</div>';
    } else {
      const d = Wx.describe(p.code, p.isDay === undefined ? Wx.isDayAt(W, viewClock().h) : p.isDay);
      const cells = [];
      cells.push(wxCell('Rain', round1(ui.sim !== null ? ui.sim : p.rain) + '<small> mm/h</small>', ui.sim !== null ? 'simulated' : Wx.rainWord(p.rain)));
      if (p.pop !== null && p.pop !== undefined) cells.push(wxCell('Chance of rain', Math.round(p.pop) + '<small>%</small>'));
      if (p.humidity !== null && p.humidity !== undefined) cells.push(wxCell('Humidity', Math.round(p.humidity) + '<small>%</small>'));
      if (p.wind !== null && p.wind !== undefined) cells.push(wxCell('Wind', Math.round(p.wind) + '<small> km/h</small>', p.gust ? 'gusts ' + Math.round(p.gust) : ''));
      else if (p.gust !== null && p.gust !== undefined) cells.push(wxCell('Gusts', Math.round(p.gust) + '<small> km/h</small>'));
      if (p.uv !== null && p.uv !== undefined) cells.push(wxCell('UV index', round1(p.uv), Wx.uvWord(p.uv)));
      if (p.aqi !== null && p.aqi !== undefined) cells.push(wxCell('Air quality', Math.round(p.aqi), Wx.aqiWord(p.aqi).replace(' for sensitive groups', '')));
      if (p.cloud !== null && p.cloud !== undefined) cells.push(wxCell('Cloud cover', Math.round(p.cloud) + '<small>%</small>'));
      if (p.vis !== null && p.vis !== undefined) cells.push(wxCell('Visibility', round1(p.vis / 1000) + '<small> km</small>'));
      $('#wxNow').innerHTML =
        '<div class="wx-main"><div class="wx-ic">' + Wx.icon(d.kind, 54) + '</div>' +
        '<div><p class="wx-temp">' + (p.temp === null || p.temp === undefined ? '-' : Math.round(p.temp) + '°C') + '</p>' +
        '<p class="wx-desc">' + esc(d.label) + '</p>' +
        '<p class="wx-feels">' + (p.feels !== null && p.feels !== undefined ? 'Feels like ' + Math.round(p.feels) + '°C' : '') + '</p></div></div>' +
        '<dl class="wx-grid">' + cells.join('') + '</dl>';
    }

    // warnings for every kind of weather, plus flood risk from the township model
    const warn = Wx.warnings(ui.sim !== null ? Object.assign({}, p || {}, { rain: ui.sim }) : p);
    const roads = alertList(c).length;
    if (roads) warn.push({ id: 'flood', level: c.rain >= 25 ? 'bad' : 'warn', text: plural(roads, 'road') + ' may flood at ' + round1(c.rain) + ' mm/h. See Flood early warning below.' });
    if (ui.sim !== null) warn.unshift({ id: 'sim', level: 'info', text: 'Simulated storm of ' + ui.sim + ' mm/h. Real weather is ' + (p ? round1(p.rain) + ' mm/h' : 'unknown') + '.' });
    $('#wxAlerts').innerHTML = warn.map(function (w) { return '<li class="wa wa-' + w.level + '"><b>' + (w.level === 'bad' ? 'Warning' : w.level === 'warn' ? 'Caution' : 'Note') + '</b><span>' + esc(w.text) + '</span></li>'; }).join('');

    renderWxRoute(c);

    // the next 24 hours
    const hrs = (W && W.hourly) || [];
    $('#wxHours').innerHTML = hrs.map(function (h, i) {
      const hh = Wx.isoHour(h.time);
      const d = Wx.describe(h.code, Wx.isDayAt(W, hh));
      const sel = ui.preview ? ui.preview.iso === h.time : i === 0;
      const r = h.rain >= 0.1 ? round1(h.rain) + ' mm' : (h.pop !== null && h.pop !== undefined ? Math.round(h.pop) + '%' : '');
      return '<button type="button" class="wh' + (h.code === 95 || h.code === 96 || h.code === 99 ? ' storm' : '') + '" role="listitem" data-hr="' + i + '" aria-pressed="' + sel + '" aria-label="' + esc(shortHour(hh) + ', ' + d.label) + '">' +
        '<span class="wh-t">' + (i === 0 ? 'Now' : shortHour(hh)) + '</span>' + Wx.icon(d.kind, 26) +
        '<span class="wh-temp">' + (h.temp === null ? '-' : Math.round(h.temp) + '°') + '</span><span class="wh-r">' + r + '</span></button>';
    }).join('');
    const sun = Wx.sunHours(W);
    $('#wxSun').textContent = sun ? 'Sunrise ' + Wx.hourText(sun.rise) + '  ·  Sunset ' + Wx.hourText(sun.set) + '. Shade matters most between these times.' : '';
    $('#wxHours').parentElement.querySelector('.wx-sub').hidden = !hrs.length;

    document.querySelectorAll('#simChips .chip').forEach(function (b) {
      const v = b.getAttribute('data-sim');
      b.setAttribute('aria-pressed', String(v === '' ? ui.sim === null : Number(v) === ui.sim));
    });
    $('#simNote').textContent = ui.sim !== null ? 'Routes and flood warnings are using the simulated rain. Choose Real weather to go back.' : 'Real rain is usually light. Simulate a storm to see Teduh re-route around flooding.';
  }

  function renderWxRoute(c) {
    const box = $('#wxRoute');
    const tw = ui.tripW, line = ui.cur && ui.cur.line, st = ui.cur && ui.cur.stats;
    if (!tw || !tw.points.length || !line || !line.total || !st) { box.hidden = true; return; }
    box.hidden = false;
    const vc = viewClock(), mins = Math.max(1, Math.round(ui.tripMin));
    const rows = tw.points.map(function (pt, i) {
      const frac = i / (tw.points.length - 1 || 1), d = frac * line.total;
      let road = '';
      for (let k = 0; k < line.parts.length; k++) { if (line.cum[line.parts[k].to] >= d - 0.01) { road = line.parts[k].edge.where; break; } }
      const desc = Wx.describe(pt.s.code, Wx.isDayAt(ui.wx, pt.hour));
      const label = i === 0 ? 'Start' : i === tw.points.length - 1 ? 'Arrive' : 'On the way';
      return '<li><span class="wr-t">' + label + '<b>' + Wx.hourText(vc.h + pt.at / 60) + '</b></span>' + Wx.icon(desc.kind, 24) +
        '<span class="wr-d"><b>' + esc(desc.label) + (pt.s.temp !== null && pt.s.temp !== undefined ? ', ' + Math.round(pt.s.temp) + '°C' : '') + '</b><span>' + esc(road) + (pt.s.rain >= 0.1 ? ' · ' + round1(pt.s.rain) + ' mm/h' : '') + '</span></span></li>';
    }).join('');
    let verdict;
    if (tw.maxRain >= 0.5) {
      verdict = tw.rainStartsInMin === 0 ? 'It is raining (' + Wx.rainWord(tw.maxRain).toLowerCase() + ') when you start.' : tw.rainStartsInMin !== null ? 'Rain is forecast about ' + tw.rainStartsInMin + ' min into your walk (' + Wx.rainWord(tw.maxRain).toLowerCase() + ').' : 'Some rain is forecast during your walk (' + Wx.rainWord(tw.maxRain).toLowerCase() + ').';
      if (st.coveredPct > 0) verdict += ' ' + st.coveredPct + '% of this route is under a covered walkway.';
    } else verdict = 'Dry for your whole walk.';
    const hot = tw.points.reduce(function (m, pt) { return Math.max(m, pt.s.feels === null || pt.s.feels === undefined ? (pt.s.temp || 0) : pt.s.feels); }, 0);
    if (hot >= 35) verdict += ' It feels hot (' + Math.round(hot) + '°C), so shade matters: this route is ' + st.shadedPct + '% shaded.';
    let best = '';
    if (tw.maxRain >= 0.5 && ui.sim === null) {
      const bd = Wx.bestDeparture(ui.wx, vc, ui.tripMin, 4, !ui.preview);
      if (bd && bd.offMin > 0 && bd.maxRain < tw.maxRain * 0.5) best = 'Drier if you leave around ' + Wx.hourText(vc.h + bd.offMin / 60) + (bd.maxRain < 0.5 ? ' (no rain expected).' : ' (only light rain).');
    }
    box.innerHTML = '<h3>On your route <small>' + mins + ' min, ' + st.dist + ' m</small></h3><ul class="wr">' + rows + '</ul><p class="wr-v">' + esc(verdict) + '</p>' + (best ? '<p class="wr-best">' + esc(best) + '</p>' : '') +
      '<p class="hint">Forecast squares are a few kilometres wide, so this is the weather around your route at the time you reach each part of it.</p>';
  }

  // ---------- rendering: the page ----------

  function renderAll() {
    if (!G) return;
    ui.c = computeConds();
    const c = ui.c, walk = ui.view === 'walk', navOn = !!ui.nav;
    document.querySelectorAll('[data-view],[data-hide-nav]').forEach(function (el) {
      const v = el.getAttribute('data-view');
      el.hidden = !!((v && v !== ui.view) || (navOn && el.hasAttribute('data-hide-nav')));
    });
    $('#vWalk').setAttribute('aria-pressed', String(walk));
    $('#vTeam').setAttribute('aria-pressed', String(!walk));
    $('#modeTag').textContent = ui.online ? (G.ds.source === 'sample' ? 'Sample, shared live' : 'Live: ' + G.name) : 'Demo data, this device only';
    document.querySelectorAll('#profiles .chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-profile') === ui.profile)); });
    $('#legend').innerHTML = legendHTML(walk);
    renderTools();

    const a = nodeOf(ui.start), b = nodeOf(ui.dest);
    let S = null, T = null;
    if (walk && !navOn && a >= 0 && b >= 0 && a !== b) {
      S = L.route(G, a, b, 'standard', c, ui.profile);
      T = L.route(G, a, b, 'teduh', c, ui.profile);
    }
    if (walk && !navOn) renderResults(S, T, c);
    const chosen = navOn ? ui.nav.route : (ui.pick === 'std' ? S : T);
    const markers = [];
    if (walk && ui.start) markers.push({ label: 'A', lat: ui.start.lat, lon: ui.start.lon });
    if (walk && ui.dest) markers.push({ label: 'B', lat: ui.dest.lat, lon: ui.dest.lon });
    tmap.setState({
      status: function (e) { return L.edgeStatus(e, c.rain); },
      std: navOn ? null : S, teduh: navOn ? ui.nav.route : T, primary: navOn ? 'teduh' : ui.pick,
      markers: markers,
      pin: walk && ui.report ? { lat: ui.report.lat, lon: ui.report.lon } : null,
      me: ui.me && walk ? { lat: ui.me.lat, lon: ui.me.lon, acc: ui.me.acc, heading: ui.me.heading } : null,
      trail: navOn && ui.nav.line ? Nav.lineUpTo(ui.nav.line, ui.nav.along) : null
    });
    void chosen;
    $('#mapc').setAttribute('aria-label', walk
      ? 'Map of ' + G.name + (ui.start && ui.dest ? ' showing the shortest route and the Teduh route from ' + ui.start.label + ' to ' + ui.dest.label : '')
      : 'Map of ' + G.name + ' showing flooded roads and blocked drains');
    if (walk) { renderAlerts(c); renderReport(); renderChat(); } else { renderTeam(c); }
    renderWx(c);
    renderNav();
    $('#pinFld').hidden = !ui.online || walk;
    const tn = $('#teamNote');
    tn.hidden = !ui.teamNote; tn.textContent = ui.teamNote; tn.classList.toggle('err', ui.teamErr);
    renderArea();
  }

  // ---------- journey with live GPS ----------

  const ARROW = '<path d="M20 5 L31 18 H23.5 V35 H16.5 V18 H9 Z"/>';
  function arrowSvg(kind) {
    if (kind === 'arrive') return '<svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 35s-10-8.4-10-16a10 10 0 0 1 20 0c0 7.6-10 16-10 16z" fill="currentColor"/><circle cx="20" cy="19" r="3.6" fill="var(--nav-bg)"/></svg>';
    const rot = { straight: 0, depart: 0, 'slight-right': 45, right: 90, uturn: 180, 'slight-left': -45, left: -90 }[kind] || 0;
    return '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="currentColor" transform="rotate(' + rot + ' 20 20)">' + ARROW + '</g></svg>';
  }
  function say(text) {
    if (!ui.voice || !('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-MY'; window.speechSynthesis.speak(u); } catch (e) { /* no voice available */ }
  }

  async function lockScreen() {
    try { if (ui.nav && 'wakeLock' in navigator) ui.nav.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed, fine */ }
  }
  function unlockScreen() {
    try { if (ui.nav && ui.nav.wake) ui.nav.wake.release(); } catch (e) { /* ignore */ }
  }

  function destLabel() { return ui.dest ? ui.dest.label : 'your destination'; }

  function startJourney(sim) {
    const r = ui.pick === 'std' ? ui.cur.S : ui.cur.T;
    if (!r || ui.nav) return;
    const line = Nav.routeLine(G, r);
    ui.nav = {
      sim: !!sim, route: r, line: line, steps: Nav.steps(line, destLabel()),
      pos: null, snap: null, along: 0, left: line.total, off: 0, fixes: 0, lastReroute: 0, arrived: false,
      msg: '', watch: null, wake: null, simTimer: 0, simD: 0, said: {}, started: Date.now(), reroutes: 0
    };
    ui.follow = true; ui.view = 'walk'; ui.tool = null; ui.report = null; setNotice('');
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
        ui.nav.watch = navigator.geolocation.watchPosition(function (p) { handleFix(fixFrom(p)); }, function (e) { if (ui.nav) { if (ui.nav.pos) ui.nav.gpsErr = gpsMessage(e); else ui.nav.msg = gpsMessage(e); renderNav(); } },
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
      }
    }
    lockScreen();
    say('Starting. ' + ui.nav.steps[0].text);
    renderAll();
  }

  function simStep() {
    const n = ui.nav;
    if (!n || n.arrived) return;
    n.simD += Math.max(6, n.line.total / 60);       // a fast demo walk: any route takes about 30 seconds
    const p = Nav.pointAt(n.line, n.simD);
    if (p) handleFix({ lat: p.lat, lon: p.lon, acc: 5, heading: p.heading, speed: 12, ts: Date.now(), sim: true });
  }

  function handleFix(fix) {
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
    // voice: announce each turn once when it is about 60 m away
    const pr = Nav.progress(n.steps, n.along);
    if (pr.toNext <= 60 && pr.next.kind !== 'arrive' && !n.said[pr.index + 1]) { n.said[pr.index + 1] = true; say('In ' + Nav.metres(pr.toNext) + ', ' + pr.next.text); }
    if (ui.follow) tmap.setView(fix.lat, fix.lon);
    renderAll();
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
    n.msg = 'New route from where you are.';
    if (n.sim) n.simD = 0;
    say('Route updated.');
  }

  function arrive() {
    const n = ui.nav;
    n.arrived = true; n.left = 0;
    if (n.watch !== null) navigator.geolocation.clearWatch(n.watch);
    clearInterval(n.simTimer); unlockScreen();
    ui.follow = false;
    say('You have arrived at ' + destLabel());
    renderAll();
  }

  function endNav(quiet) {
    const n = ui.nav;
    if (!n) return;
    if (n.watch !== null) navigator.geolocation.clearWatch(n.watch);
    clearInterval(n.simTimer); unlockScreen();
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    ui.nav = null; ui.follow = false;
    if (n.sim) ui.me = null;
    if (!quiet) renderAll();
  }

  function renderNav() {
    const el = $('#nav'), n = ui.nav;
    el.hidden = !n;
    $('#navVoice').textContent = ui.voice ? 'Voice on' : 'Voice off';
    $('#navVoice').setAttribute('aria-pressed', String(ui.voice));
    if (!n) return;
    const P = profile();
    const minLeft = n.left / P.speed;
    const clock = ui.clock;
    $('#navMinLbl').textContent = P.verb === 'ride' ? 'Ride' : 'Walk';
    $('#navEta').textContent = n.arrived ? Wx.clockText(clock, false) : Wx.hourText(clock.h + minLeft / 60);
    $('#navMin').textContent = n.arrived ? '0 min' : Math.max(1, Math.round(minLeft)) + ' min';
    $('#navLeft').textContent = Nav.metres(n.left);
    el.classList.toggle('arrived', n.arrived);
    if (n.arrived) {
      $('#navArrow').innerHTML = arrowSvg('arrive');
      $('#navDist').textContent = 'You have arrived';
      $('#navText').textContent = destLabel();
      $('#navThen').textContent = 'Journey took ' + Math.max(1, Math.round((Date.now() - n.started) / 60000)) + ' min.';
      $('#navEnd').textContent = 'Done';
      $('#navWx').textContent = ''; $('#navGps').textContent = '';
      return;
    }
    $('#navEnd').textContent = 'End journey';
    let show, then, distText;
    if (!n.pos && !n.sim) { show = null; }
    else if (n.along < 12 && n.steps.length > 1) { show = n.steps[0]; then = n.steps[1]; distText = Nav.metres(n.steps[1].at - n.along); }
    else {
      const pr = Nav.progress(n.steps, n.along);
      show = pr.next; distText = Nav.metres(pr.toNext);
      then = n.steps[Math.min(pr.index + 2, n.steps.length - 1)];
      if (then === show) then = null;
    }
    if (!show) {
      $('#navArrow').innerHTML = arrowSvg('straight'); $('#navDist').textContent = '...'; $('#navText').textContent = n.msg || 'Waiting for GPS.'; $('#navThen').textContent = 'First turn: ' + n.steps[0].text;
    } else {
      $('#navArrow').innerHTML = arrowSvg(show.kind);
      $('#navDist').textContent = distText;
      $('#navText').textContent = show.text;
      $('#navThen').textContent = then ? 'Then ' + then.text.charAt(0).toLowerCase() + then.text.slice(1) : '';
    }
    // weather and cover ahead
    const bits = [];
    if (ui.sim !== null) bits.push('Simulated storm of ' + ui.sim + ' mm/h');
    else if (ui.wx) {
      const out = Wx.rainOutlook(ui.wx, ui.clock, 30, 0.5), p = Wx.nowSample(ui.wx), d = p ? Wx.describe(p.code, p.isDay) : null;
      if (out && out.inMin === 0) bits.push('Raining now (' + Wx.rainWord(out.rain).toLowerCase() + ')');
      else if (out) bits.push('Rain expected in about ' + out.inMin + ' min');
      else bits.push('Dry for the next 30 min');
      if (d && p.temp !== null) bits.push(Math.round(p.temp) + '°C, ' + d.label.toLowerCase());
    }
    for (let k = 0; k < n.line.parts.length; k++) {
      const pt = n.line.parts[k];
      if (!pt.edge.covered || n.line.cum[pt.to] <= n.along) continue;
      const ahead = n.line.cum[pt.from] - n.along;
      bits.push(ahead <= 5 ? 'Under a covered walkway' : ahead < 400 ? 'Covered walkway in ' + Nav.metres(ahead) : '');
      break;
    }
    $('#navWx').textContent = bits.filter(Boolean).join(' · ');
    if (n.gpsErr) { $('#navGps').textContent = n.gpsErr + ' Showing your last position.'; return; }
    $('#navGps').textContent = n.sim ? 'Simulated GPS (demo walk)' : !n.pos ? (n.msg || 'Waiting for GPS.') :
      (n.msg && n.off ? n.msg + ' ' : '') + 'GPS ' + (n.pos.acc <= 20 ? 'good' : n.pos.acc <= 50 ? 'fair' : 'weak') + ' (within ' + Math.round(n.pos.acc) + ' m)' + (n.reroutes && n.msg ? ' · ' + n.msg : '');
  }

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
  async function sendChat(text) {
    text = String(text || '').trim();
    if (!text || ui.chatBusy) return;
    ui.chat.push({ role: 'user', text: text });
    ui.chatBusy = true; renderChat();
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
    ui.chatBusy = false; renderChat();
  }

  // ---------- reports ----------

  function resetReportForm() {
    $('#repType').value = 'Blocked drain'; $('#repNote').value = ''; $('#repFile').value = '';
    $('#notice').hidden = true;
  }
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
  async function triage() {
    const r = ui.report;
    if (!r || r.busy) return;
    const note = $('#repNote').value.trim();
    if (!r.photo && !note) { r.aiMsg = 'Add a photo or a short note first.'; r.ai = null; renderReport(); return; }
    r.busy = true; r.aiMsg = 'Checking'; r.ai = null; renderReport();
    try {
      const a = await Api.post('/api/triage', { text: note, image: r.photo });
      r.ai = a; r.aiMsg = '';
      if (a.type) $('#repType').value = a.type;
    } catch (e) { r.aiMsg = friendlyError(e); }
    r.busy = false; renderReport();
  }
  async function sendReport(ev) {
    ev.preventDefault();
    const r = ui.report;
    if (!r || r.busy) return;
    const e = r.edge, type = $('#repType').value, note = $('#repNote').value.trim();
    if (ui.online) {
      r.busy = true; renderReport();
      try {
        const body = { edgeId: e.id, type: type, note: note, lat: r.lat, lon: r.lon };
        if (r.ai) body.ai = { severity: r.ai.severity, summary: r.ai.summary };
        applyState(await Api.post('/api/report', body));
        ui.report = null;
        setNotice('Report sent. Everyone using the app sees it now.' + (type === 'Blocked drain' ? ' Routes treat ' + e.where + ' as flooding from about ' + e.thr + ' mm/h.' : ''));
      } catch (err) {
        r.busy = false;
        setNotice(err.status === 429 ? 'Too many reports. Try again in a minute.' : 'Could not send the report: ' + friendlyError(err));
      }
      renderAll();
      return;
    }
    e.reports.push(type);
    if (type === 'Blocked drain' && !e.blocked) { e.blocked = true; e.thr = Math.round(e.base * 0.6); }
    ui.report = null;
    setNotice('Report added to the township team queue (demo, this device only).');
    renderAll();
  }

  // ---------- township team ----------

  async function teamAction(path, body, okNote) {
    try {
      applyState(await Api.post(path, body, $('#teamPin').value));
      ui.teamNote = okNote; ui.teamErr = false;
    } catch (err) {
      ui.teamErr = true;
      ui.teamNote = err.status === 403 ? 'Wrong team PIN. Enter it above the list.' : friendlyError(err);
    }
    renderAll();
  }

  // ---------- events ----------

  function bindCombo(which) {
    const inp = $('#' + which + 'In'), list = $('#' + which + 'List'), sg = ui.sg[which];
    inp.addEventListener('focus', function () { openSuggest(which); try { inp.select(); } catch (e) { /* ignore */ } });
    inp.addEventListener('click', function () { if (!sg.open) openSuggest(which); });
    inp.addEventListener('input', function () {
      if (pointOf(which)) { setPointRaw(which, null); if (ui.nav) endNav(true); renderAll(); }
      $('#' + which + 'X').hidden = !inp.value;
      sg.open = true; sg.active = -1;
      scheduleGeocode(which); renderSuggest(which);
    });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!sg.open) { openSuggest(which); return; }
        const n = sg.items.length; if (!n) return;
        sg.active = ev.key === 'ArrowDown' ? (sg.active + 1) % n : (sg.active - 1 + n) % n;
        renderSuggest(which);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const i = sg.active >= 0 ? sg.active : sg.items.findIndex(function (it) { return it.kind !== 'hint' && it.kind !== 'gps' && it.kind !== 'map'; });
        if (i >= 0) chooseSuggest(which, i);
      } else if (ev.key === 'Escape') { closeSuggest(which); }
    });
    inp.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== inp) closeSuggest(which); }, 180); });
    list.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });      // keep the box focused while choosing
    list.addEventListener('click', function (ev) { const li = ev.target.closest('[data-i]'); if (li) chooseSuggest(which, Number(li.getAttribute('data-i'))); });
    $('#' + which + 'X').addEventListener('click', function () { clearPoint(which); inp.focus(); });
  }

  function bind() {
    $('#vWalk').addEventListener('click', function () { ui.view = 'walk'; renderAll(); });
    $('#vTeam').addEventListener('click', function () { ui.view = 'team'; renderAll(); });

    $('#profiles').innerHTML = L.PROFILE_ORDER.map(function (id) { return '<button type="button" class="chip" data-profile="' + id + '" aria-pressed="false">' + L.PROFILES[id].label + '</button>'; }).join('');
    $('#profiles').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-profile]');
      if (!b) return;
      ui.profile = b.getAttribute('data-profile'); renderAll();
    });

    bindCombo('from'); bindCombo('to');
    $('#swap').addEventListener('click', function () {
      const t = ui.start; ui.start = ui.dest; ui.dest = t;
      syncInputs(); pointsChanged();
    });
    $('#demoTrip').addEventListener('click', demoTrip);

    $('#tools').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-tool]');
      if (b) setTool(b.getAttribute('data-tool'));
    });
    $('#locate').addEventListener('click', locateMe);
    $('#loadHere').addEventListener('click', function () {
      if (!ui.online) { ui.areaMsg = 'Loading a real area needs the server. Run npm start and open the page from there.'; renderArea(); return; }
      const c = tmap.center();
      ui.start = null; ui.dest = null;
      loadArea({ lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)) });
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ui.tool) { ui.tool = null; setNotice(''); renderTools(); } });

    $('#cards').addEventListener('click', function (ev) {
      const a = ev.target.closest('[data-route]'); if (!a) return;
      ui.pick = a.getAttribute('data-route'); renderAll();
    });
    $('#cards').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const a = ev.target.closest('[data-route]'); if (!a) return;
      ev.preventDefault(); ui.pick = a.getAttribute('data-route'); renderAll();
      const again = document.querySelector('#cards [data-route="' + ui.pick + '"]'); if (again) again.focus();
    });
    $('#startBtn').addEventListener('click', function () { startJourney(false); });
    $('#demoBtn').addEventListener('click', function () { startJourney(true); });

    $('#navEnd').addEventListener('click', function () { endNav(); });
    $('#navRecenter').addEventListener('click', function () {
      ui.follow = true;
      const n = ui.nav;
      if (n && n.pos) tmap.setView(n.pos.lat, n.pos.lon, Math.max(tmap.center().z, 17));
      renderAll();
    });
    $('#navVoice').addEventListener('click', function () { ui.voice = !ui.voice; renderNav(); if (ui.voice) say('Voice guidance on'); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { tick(); if (ui.nav && !ui.nav.arrived) lockScreen(); }
    });

    // forecast hours and the storm simulator
    $('#wxHours').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-hr]'); if (!b || !ui.wx) return;
      const i = Number(b.getAttribute('data-hr')), h = ui.wx.hourly[i];
      if (!h || i === 0) { ui.preview = null; } else { ui.preview = { iso: h.time, day: Wx.isoDay(h.time), h: Wx.isoHour(h.time) }; }
      renderAll();
    });
    $('#wxLive').addEventListener('click', function () { ui.preview = null; renderAll(); });
    $('#simChips').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-sim]'); if (!b) return;
      const v = b.getAttribute('data-sim');
      ui.sim = v === '' ? null : Number(v); renderAll();
    });

    $('#alerts').addEventListener('click', function (ev) {
      if (!ev.target.closest('#moreBtn')) return;
      ui.showAll = !ui.showAll; renderAll();
      const b = $('#moreBtn'); if (b) b.focus();
    });

    $('#chatForm').addEventListener('submit', function (ev) { ev.preventDefault(); const t = $('#chatIn').value; $('#chatIn').value = ''; sendChat(t); });
    $('#chatSuggest').addEventListener('click', function (ev) { const b = ev.target.closest('[data-ask]'); if (b) sendChat(b.getAttribute('data-ask')); });

    $('#reportForm').addEventListener('submit', sendReport);
    $('#repCancel').addEventListener('click', function () { ui.report = null; renderAll(); });
    $('#repAiBtn').addEventListener('click', triage);
    $('#repFile').addEventListener('change', async function () {
      const f = this.files && this.files[0];
      if (!f || !ui.report) return;
      if (!/^image\//.test(f.type)) { ui.report.aiMsg = 'Please choose a photo.'; renderReport(); return; }
      try { ui.report.photo = await downscale(f); ui.report.ai = null; ui.report.aiMsg = ''; }
      catch (e) { ui.report.aiMsg = 'That photo format is not supported here. Try a JPEG or PNG.'; }
      renderReport();
    });
    $('#repPhotoClear').addEventListener('click', function () { if (!ui.report) return; ui.report.photo = null; ui.report.ai = null; $('#repFile').value = ''; renderReport(); });

    $('#impWalkers').addEventListener('input', function () { renderImpact(); });
    $('#queue').addEventListener('click', function (ev) {
      const b = ev.target.closest('[data-clear]');
      if (!b) return;
      const e = G.edges.find(function (x) { return x.id === b.getAttribute('data-clear'); });
      if (!e) return;
      if (ui.online) { teamAction('/api/clear', { edgeId: e.id }, e.where + ' marked as cleared.'); return; }
      const i = e.idx;
      e.blocked = false; e.thr = e.base; e.reports = []; INITIAL[i].blocked = false; INITIAL[i].thr = e.base;
      renderAll();
    });
    $('#reset').addEventListener('click', function () {
      if (ui.online) { teamAction('/api/reset', null, 'Demo reset for everyone.'); return; }
      const keepView = ui.view;
      setDataset(window.Sample.build());
      ui.view = keepView; renderAll();
    });
  }

  // ---------- start ----------

  function startSync() {
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, 5000);
    setInterval(function () { if (!document.hidden) pullWeather(); }, 5 * 60 * 1000);
  }

  async function init() {
    tmap = window.TMap.create($('#mapbox'), { onTap: onTap, onUserMove: function () { if (ui.nav && ui.follow) { ui.follow = false; renderNav(); } } });
    bind();
    tick(); setInterval(tick, 1000);
    window.__teduh = {
      ui: ui, map: function () { return tmap; }, graph: function () { return G; },
      fix: handleFix, setPoint: setPoint, simStep: simStep, wx: function () { return ui.wx; }, tick: tick
    };   // handy for testing in the console
    let cfg = null;
    try { if (location.protocol !== 'file:') cfg = await Api.get('/api/config'); } catch (e) { cfg = null; }
    if (cfg) {
      ui.online = true; ui.features = cfg.features; ui.tiles = cfg.tiles;
      await loadArea();
      startSync();
    } else {
      ui.online = false;
      setDataset(window.Sample.build());
      demoTrip();
      ui.areaMsg = 'The server is not running, so this is the sample township and everything stays on this device. Run npm start for real maps.';
      renderArea();
    }
  }
  init();
})();
