'use strict';
// Route finding and scoring. No page code in here, so it can be tested on its own.
//
// Two routes are compared for every trip:
//   shortest  - just the shortest legal way
//   teduh     - the same, but roads cost more when they are sunny, wet, flooded, dark, steep in
//               traffic or have steps, according to who is walking (the profile)

(function (root) {
  // speed: metres per minute. The other numbers say how much each thing matters to that person.
  const PROFILES = {
    pedestrian: { label: 'Pedestrian',      verb: 'walk', speed: 80,  sun: 1.0, lit: 0.2, road: 0.2, steps: 0,   bike: false },
    women:      { label: 'Women',           verb: 'walk', speed: 80,  sun: 1.0, lit: 1.0, road: 0.3, steps: 0.2, bike: false },
    children:   { label: 'Children',        verb: 'walk', speed: 60,  sun: 1.2, lit: 0.8, road: 2.5, steps: 0.5, bike: false },
    cyclist:    { label: 'Bicyclist',       verb: 'ride', speed: 250, sun: 0.5, lit: 0.4, road: 0.3, steps: 0,   bike: true },
    senior:     { label: 'Senior citizens', verb: 'walk', speed: 60,  sun: 1.5, lit: 0.6, road: 1.0, steps: 3,   bike: false }
  };
  const PROFILE_ORDER = ['pedestrian', 'women', 'children', 'cyclist', 'senior'];

  // ---------- conditions ----------

  // sun is optional: { rise, set } in hours (for example 7.0 and 19.1). Without it, 7:00 and 19:00 are used.
  function riseSet(sun) { return [sun && Number.isFinite(sun.rise) ? sun.rise : 7, sun && Number.isFinite(sun.set) ? sun.set : 19]; }
  function heat(h, sun) {
    const rs = riseSet(sun);
    if (h <= rs[0] || h >= rs[1]) return 0;
    return Math.pow(Math.max(0, Math.sin(Math.PI * (h - rs[0]) / (rs[1] - rs[0]))), 1.5);
  }
  function darkness(h, sun) {
    const rs = riseSet(sun);
    if (h < 12) return Math.max(0, Math.min(1, (rs[0] + 0.5 - h) / 1));
    return Math.max(0, Math.min(1, (h - (rs[1] - 0.5)) / 1));
  }
  // uv is optional: a real UV index replaces the time-of-day curve
  function conditions(rain, hour, uv, sun) {
    const rl = Math.min(rain / 50, 1);
    const dark = darkness(hour, sun);
    let base = uv === null || uv === undefined ? heat(hour, sun) : Math.max(0, Math.min(1, uv / 11));
    if (dark >= 1) base = 0;
    return { rain: rain, hour: hour, rainLevel: rl, sunLoad: base * (1 - 0.8 * rl), dark: dark, uv: uv === undefined ? null : uv };
  }

  // ---------- the graph ----------

  // Resident-traced paths that have been verified become extra edges. They are joined to the nearest existing junction
  // (within 80 m) at each end; a path that cannot be joined at both ends is listed as skipped and not used.
  const PATH_SNAP_M = 80;
  const SURFACE_THR = { mud: 35, grass: 40, gravel: 55, paved: 80, concrete: 80, boardwalk: 70 };
  function metres(a, b) {
    const k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
    return Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 111320 * k);
  }
  function pathLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += metres(pts[i - 1], pts[i]); return s; }
  function nearestIn(nodes, p) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) { const d = metres(nodes[i], p); if (d < bd) { bd = d; best = i; } }
    return { node: best, dist: bd };
  }
  function communityEdges(ds, paths) {
    const nodes = [], edges = [], used = [], skipped = [];
    const total = function () { return ds.nodes.length + nodes.length; };
    paths.forEach(function (p) {
      if (!p || !Array.isArray(p.pts) || p.pts.length < 2) return;
      const a = nearestIn(ds.nodes, p.pts[0]), b = nearestIn(ds.nodes, p.pts[p.pts.length - 1]);
      if (a.node < 0 || b.node < 0 || a.dist > PATH_SNAP_M || b.dist > PATH_SNAP_M || a.node === b.node) { skipped.push(p.id); return; }
      const common = {
        shade: 0, covered: 0, hw: p.kind === 'footbridge' ? 'footway' : 'path', lit: null, steps: p.kind === 'stairs' ? 1 : 0,
        bike: (p.surface === 'paved' || p.surface === 'concrete' || p.surface === 'boardwalk') && p.kind !== 'stairs' ? 1 : 0,
        sidewalk: 0, community: 1, surface: p.surface, thr: SURFACE_THR[p.surface] || 60, blocked: false
      };
      const label = 'Resident ' + (p.kind === 'stairs' ? 'steps' : p.kind);
      let from = a.node, to = b.node;
      // an end that is not on a junction gets its own node and a short link to the nearest junction
      const ends = [[a, p.pts[0]], [b, p.pts[p.pts.length - 1]]].map(function (x, i) {
        if (x[0].dist <= 3) return x[0].node;
        const idx = total(); nodes.push([x[1][0], x[1][1]]);
        edges.push(Object.assign({}, common, { id: p.id + (i ? '-b' : '-a'), a: x[0].node, b: idx, road: 'Resident link', where: 'Resident link to ' + label, len: Math.max(1, Math.round(x[0].dist)), pts: i ? [x[1], ds.nodes[x[0].node]] : [ds.nodes[x[0].node], x[1]] }));
        if (i) { const t = edges[edges.length - 1]; t.a = idx; t.b = x[0].node; }
        return idx;
      });
      from = ends[0]; to = ends[1];
      if (from === to) { skipped.push(p.id); return; }
      edges.push(Object.assign({}, common, { id: p.id, a: from, b: to, road: label, where: label + ' (reported by residents)', len: Math.max(1, Math.round(pathLen(p.pts))), pts: p.pts.map(function (q) { return [q[0], q[1]]; }) }));
      used.push(p.id);
    });
    return { nodes: nodes, edges: edges, used: used, skipped: skipped };
  }

  function buildGraph(ds, paths) {
    const ext = paths && paths.length ? communityEdges(ds, paths) : { nodes: [], edges: [], used: [], skipped: [] };
    const nodes = ext.nodes.length ? ds.nodes.concat(ext.nodes) : ds.nodes;
    const edgesIn = ext.edges.length ? ds.edges.concat(ext.edges) : ds.edges;
    const G = { ds: ds, name: ds.name, nodes: nodes, edges: [], adj: nodes.map(function () { return []; }), places: ds.places || [], community: { used: ext.used, skipped: ext.skipped } };
    edgesIn.forEach(function (d, i) {
      const e = {
        idx: i, id: d.id, a: d.a, b: d.b, road: d.road, where: d.where || d.road, len: d.len,
        shade: d.shade, sh: Array.isArray(d.sh) && d.sh.length === 13 ? d.sh : null, covered: !!d.covered, thr: d.thr, base: d.base === undefined ? d.thr : d.base, blocked: !!d.blocked,
        reports: [], hw: d.hw || 'residential', lit: d.lit === undefined ? null : d.lit, steps: !!d.steps,
        bike: d.bike !== 0, sidewalk: !!d.sidewalk, pts: d.pts, community: !!d.community, surface: d.surface || null
      };
      G.edges.push(e);
      G.adj[e.a].push([e, e.b]);
      G.adj[e.b].push([e, e.a]);
    });
    return G;
  }

  // e.live is set from resident reports: 'flooded' (water over the road now) or 'risk' (rising or standing water)
  function edgeStatus(e, rain) {
    if (e.live === 'flooded' || rain >= e.thr) return 'flooded';
    if (e.live === 'risk' || rain >= 0.6 * e.thr) return 'risk';
    return 'ok';
  }
  // Shade for a street at a clock hour. Streets with building shadows carry 13 hourly values (7:00 to 19:00); others one fixed value.
  function shadeAt(e, hour) {
    if (!e.sh || hour === undefined || hour === null || !Number.isFinite(hour)) return e.shade;
    const x = Math.max(0, Math.min(12, hour - 7)), i = Math.min(11, Math.floor(x)), f = x - i;
    return e.sh[i] + (e.sh[i + 1] - e.sh[i]) * f;
  }
  function exposure(e, hour) { return e.covered ? 0.05 : 1 - 0.9 * shadeAt(e, hour); }
  function roadRisk(e) {
    const h = e.hw;
    if (h === 'primary' || h === 'secondary' || /_link$/.test(h)) return e.sidewalk ? 0.4 : 1;
    if (h === 'tertiary') return e.sidewalk ? 0.15 : 0.4;
    return 0;
  }
  function allowed(e, P) { return !(P.bike && (e.steps || !e.bike)); }

  function cost(e, mode, c, P) {
    if (!allowed(e, P)) return Infinity;
    if (mode === 'standard') return e.community ? Infinity : e.len;   // the shortest route only knows the existing map
    const st = edgeStatus(e, c.rain);
    let pen = st === 'flooded' ? 100000 : st === 'risk' ? e.len * 3 : 0;
    if (!pen && (e.blocked || (e.reports && e.reports.indexOf('Fallen branch') !== -1))) pen = e.len * 0.8;   // a blocked drain or fallen branch: go round if the detour is short
    const unlit = e.lit === 1 ? 0 : e.lit === 0 ? 1.2 : 0.7;
    let k = 1 + (c.sunLoad * 2.2 * P.sun + c.rainLevel * 1.2) * exposure(e, c.hour) + c.dark * P.lit * unlit + P.road * roadRisk(e);
    if (e.steps) k += P.steps * 2;
    if (e.community && (e.surface === 'mud' || e.surface === 'grass' || e.surface === 'gravel')) k += 0.15 + 2.5 * c.rainLevel + 0.4 * P.steps;   // unpaved: slow, and bad in rain
    if (P.bike && e.hw === 'cycleway') k *= 0.85;
    return e.len * k + (e.steps ? P.steps * 120 : 0) + pen;
  }

  // ---------- shortest path with a binary heap ----------

  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    let i = this.k.length;
    this.k.push(key); this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  };
  Heap.prototype.pop = function () {
    const topK = this.k[0], topV = this.v[0];
    const lastK = this.k.pop(), lastV = this.v.pop();
    const n = this.k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
        if (this.k[c] >= lastK) break;
        this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
      }
      this.k[i] = lastK; this.v[i] = lastV;
    }
    return [topK, topV];
  };
  Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.k.length; } });

  // Returns { nodes, edges } or null when there is no way for this profile.
  function route(G, from, to, mode, c, pid) {
    const P = PROFILES[pid] || PROFILES.pedestrian;
    const n = G.nodes.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
    const dist = new Float64Array(n).fill(Infinity);
    const prevN = new Int32Array(n).fill(-1);
    const prevE = new Array(n).fill(null);
    const heap = new Heap();
    dist[from] = 0;
    heap.push(0, from);
    while (heap.size) {
      const top = heap.pop(), d = top[0], u = top[1];
      if (d > dist[u]) continue;
      if (u === to) break;
      const list = G.adj[u];
      for (let i = 0; i < list.length; i++) {
        const e = list[i][0], v = list[i][1];
        const w = cost(e, mode, c, P);
        if (w === Infinity) continue;
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; prevN[v] = u; prevE[v] = e; heap.push(nd, v); }
      }
    }
    if (dist[to] === Infinity) return null;
    const edges = [], nodes = [to];
    for (let cur = to; cur !== from; cur = prevN[cur]) { edges.unshift(prevE[cur]); nodes.unshift(prevN[cur]); }
    return { nodes: nodes, edges: edges };
  }

  function sameRoute(a, b) {
    if (!a || !b) return false;
    return a.edges.length === b.edges.length && a.edges.every(function (e, i) { return e === b.edges[i]; });
  }

  // ---------- numbers for a route ----------

  function viaList(r) {
    const out = [];
    r.edges.forEach(function (e) { if (out[out.length - 1] !== e.road) out.push(e.road); });
    return out;
  }
  function stats(r, c, pid) {
    const P = PROFILES[pid] || PROFILES.pedestrian;
    let dist = 0, shaded = 0, unsh = 0, cov = 0, lit = 0, steps = 0;
    const flooded = [], risk = [];
    r.edges.forEach(function (e) {
      dist += e.len;
      shaded += e.len * (e.covered ? 1 : shadeAt(e, c.hour));
      unsh += e.len * exposure(e, c.hour);
      if (e.covered) cov += e.len;
      if (e.lit === 1) lit += e.len;
      if (e.steps) steps++;
      const s = edgeStatus(e, c.rain);
      if (s === 'flooded') flooded.push(e); else if (s === 'risk') risk.push(e);
    });
    return {
      dist: Math.round(dist), min: dist / P.speed,
      shadedPct: dist ? Math.round(100 * shaded / dist) : 0,
      coveredPct: dist ? Math.round(100 * cov / dist) : 0,
      litPct: dist ? Math.round(100 * lit / dist) : 0,
      stepsN: steps,
      unshadedMin: unsh / P.speed, sunMin: unsh / P.speed * c.sunLoad,
      flooded: flooded, risk: risk, via: viaList(r)
    };
  }

  // ---------- places and trips ----------

  function nearestNode(G, lat, lon) {
    const k = Math.cos(lat * Math.PI / 180);
    let best = -1, bd = Infinity;
    for (let i = 0; i < G.nodes.length; i++) {
      const dy = (G.nodes[i][0] - lat) * 110574, dx = (G.nodes[i][1] - lon) * 111320 * k;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = i; }
    }
    return { node: best, dist: bd };
  }
  // a handful of typical trips between landmarks, to rank which roads matter most
  function makeTrips(G) {
    const nodes = [];
    G.places.forEach(function (p) { if (nodes.indexOf(p.node) === -1) nodes.push(p.node); });
    const trips = [];
    for (let i = 0; i < nodes.length && i < 8; i++) for (let j = i + 1; j < nodes.length && j < 8; j++) trips.push([nodes[i], nodes[j]]);
    return trips;
  }
  function usageCounts(G, trips) {
    const use = {};
    G.edges.forEach(function (e) { use[e.id] = 0; });
    const calm = conditions(0, 12, null);
    trips.forEach(function (t) {
      const r = route(G, t[0], t[1], 'standard', calm, 'pedestrian');
      if (r) r.edges.forEach(function (e) { use[e.id]++; });
    });
    return use;
  }
  // two landmarks far apart make a good first trip
  function defaultTrip(G) {
    const ps = G.places;
    if (ps.length < 2) return [0, Math.min(1, G.nodes.length - 1)];
    let best = [ps[0].node, ps[1].node], bd = -1;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const d = Math.hypot(ps[i].lat - ps[j].lat, ps[i].lon - ps[j].lon);
      if (ps[i].node !== ps[j].node && d > bd) { bd = d; best = [ps[i].node, ps[j].node]; }
    }
    return best;
  }

  // Finds the trip in this area where the Teduh route is most different from the shortest route under the given conditions.
  // Tries every pair of landmarks, then some far-apart junction pairs. Score = sun minutes saved + a bonus for dodging flooded or risky roads.
  function bestContrast(G, c, pid) {
    const cand = [];
    G.places.forEach(function (p, i) { for (let j = i + 1; j < G.places.length; j++) if (p.node !== G.places[j].node) cand.push([p.node, G.places[j].node]); });
    const n = G.nodes.length;
    if (n <= 40) { for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) cand.push([a, b]); }
    else for (let k = 0; k < 150; k++) {                // deterministic spread of junction pairs
      const a = (k * 7919) % n, b = (k * 104729 + 17) % n;
      if (a !== b) cand.push([a, b]);
    }
    let best = null;
    cand.forEach(function (t) {
      const s = route(G, t[0], t[1], 'standard', c, pid), q = route(G, t[0], t[1], 'teduh', c, pid);
      if (!s || !q || sameRoute(s, q)) return;
      const a = stats(s, c, pid), b = stats(q, c, pid);
      if (a.dist < 150 || b.min - a.min > 6) return;      // too short to be a walk, or too long a detour
      const score = (a.sunMin - b.sunMin) + 4 * (a.flooded.length - b.flooded.length) + 1 * (a.risk.length - b.risk.length);
      if (score > 0.05 && (!best || score > best.score)) best = { a: t[0], b: t[1], score: score, sunSaved: a.sunMin - b.sunMin, shadeGain: b.shadedPct - a.shadedPct, extraMin: b.min - a.min, floodAvoided: a.flooded.length - b.flooded.length };
    });
    return best;
  }

  // Modelled impact of Teduh routes against shortest routes over the typical trips, for every walker type.
  // Reference scenarios are fixed assumptions (not measurements): a dry sunny early afternoon and a heavy-rain evening.
  const SCENARIOS = {
    sun:  { label: 'Sunny early afternoon (UV 10, dry)', rain: 0,  hour: 13, uv: 10 },
    rain: { label: 'Heavy rain, evening (30 mm/h)',      rain: 30, hour: 18, uv: 0 }
  };
  function impact(G, trips) {
    const out = { trips: trips.length, pairs: 0, sun: null, rain: null };
    if (!trips.length) return out;
    const cs = conditions(SCENARIOS.sun.rain, SCENARIOS.sun.hour, SCENARIOS.sun.uv);
    const cr = conditions(SCENARIOS.rain.rain, SCENARIOS.rain.hour, SCENARIOS.rain.uv);
    let n = 0, sunStd = 0, sunTed = 0, extra = 0, coverGain = 0, wet = 0, kept = 0;
    PROFILE_ORDER.forEach(function (pid) {
      trips.forEach(function (t) {
        const s = route(G, t[0], t[1], 'standard', cs, pid), q = route(G, t[0], t[1], 'teduh', cs, pid);
        if (s && q) {
          const a = stats(s, cs, pid), b = stats(q, cs, pid);
          n++; sunStd += a.sunMin; sunTed += b.sunMin; extra += b.min - a.min; coverGain += b.shadedPct - a.shadedPct;
        }
        const s2 = route(G, t[0], t[1], 'standard', cr, pid), q2 = route(G, t[0], t[1], 'teduh', cr, pid);
        if (s2 && q2) {
          const a2 = stats(s2, cr, pid), b2 = stats(q2, cr, pid);
          if (a2.flooded.length || a2.risk.length) { wet++; if (!b2.flooded.length && !b2.risk.length) kept++; }
        }
      });
    });
    out.pairs = n;
    if (n) out.sun = { stdMin: sunStd / n, tedMin: sunTed / n, savedMin: (sunStd - sunTed) / n, savedPct: sunStd > 0 ? Math.round(100 * (sunStd - sunTed) / sunStd) : 0, extraMin: extra / n, shadeGain: coverGain / n };
    out.rain = { wet: wet, kept: kept, total: n || trips.length * PROFILE_ORDER.length };
    return out;
  }

  const api = {
    SCENARIOS: SCENARIOS, impact: impact,
    PROFILES: PROFILES, PROFILE_ORDER: PROFILE_ORDER, heat: heat, darkness: darkness, conditions: conditions,
    bestContrast: bestContrast, buildGraph: buildGraph, edgeStatus: edgeStatus, exposure: exposure, shadeAt: shadeAt, viewHour: null, cost: cost, route: route, sameRoute: sameRoute,
    stats: stats, viaList: viaList, nearestNode: nearestNode, makeTrips: makeTrips, usageCounts: usageCounts, defaultTrip: defaultTrip
  };
  root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Logic;
