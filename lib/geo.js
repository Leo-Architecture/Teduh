'use strict';
// Builds a real township from open data, for any place in Malaysia.
//
//   OpenStreetMap (Overpass)  -> walkable roads and paths, trees, covered walkways, waterways, landmarks
//   Open-Meteo elevation      -> terrain height (about 90 m resolution)
//   Nominatim / Open-Meteo    -> place search
//
// From that it works out, for every road segment:
//   shade    how many mapped trees line it (0 to 1)
//   covered  whether it is a covered walkway, arcade or passage through a building
//   thr      the rain (mm/h) at which it is likely to flood. THIS IS AN ESTIMATE from terrain height
//            and distance to a drain or stream, not a measurement. Real drain records would replace it.

const fs = require('fs');
const path = require('path');
const { fetchJson, HttpError } = require('./http');
const { shadowByHour, buildingHeight } = require('./shadow');

const ROAD_CLASSES = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'service', 'track', 'primary_link', 'secondary_link', 'tertiary_link'];
const ROAD_SET = new Set(ROAD_CLASSES);
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const PLACE_WEIGHT = { school: 5, hospital: 5, clinic: 5, marketplace: 5, mall: 5, supermarket: 5, community_centre: 4, library: 4, park: 4, bus_station: 4, college: 4, university: 4, place_of_worship: 3, townhall: 3, pharmacy: 3, kindergarten: 3, playground: 2 };
const AMENITIES = ['school', 'kindergarten', 'college', 'university', 'clinic', 'hospital', 'pharmacy', 'marketplace', 'community_centre', 'library', 'place_of_worship', 'bus_station', 'townhall'];
const GENERIC_NAME = { footway: 'Footpath', path: 'Path', steps: 'Steps', cycleway: 'Cycle path', pedestrian: 'Pedestrian street', service: 'Service road', track: 'Track', living_street: 'Residential street' };
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TREES_SENT = 2500;
const MAX_PLACES = 8;

// ---------- small geometry helpers (flat metres around the centre) ----------

function projector(lat0, lon0) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  return function (lat, lon) { return [(lon - lon0) * kx, (lat - lat0) * ky]; };
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function polyLen(xy) {
  let s = 0;
  for (let i = 1; i < xy.length; i++) s += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  return s;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round(n, d) { const f = Math.pow(10, d); return Math.round(n * f) / f; }

class Grid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  add(x, y, v) {
    const k = Math.floor(x / this.c) + ',' + Math.floor(y / this.c);
    let a = this.m.get(k);
    if (!a) this.m.set(k, a = []);
    a.push(v);
  }
  query(x0, y0, x1, y1) {
    const out = [];
    for (let i = Math.floor(x0 / this.c); i <= Math.floor(x1 / this.c); i++) {
      for (let j = Math.floor(y0 / this.c); j <= Math.floor(y1 / this.c); j++) {
        const a = this.m.get(i + ',' + j);
        if (a) for (let k = 0; k < a.length; k++) out.push(a[k]);
      }
    }
    return out;
  }
}

// ---------- Overpass ----------

function overpassQuery(lat, lon, r) {
  const a = '(around:' + r + ',' + lat + ',' + lon + ')';
  const a2 = '(around:' + (r + 200) + ',' + lat + ',' + lon + ')';
  const a3 = '(around:' + (r + 70) + ',' + lat + ',' + lon + ')';   // buildings just outside the area can still shade its streets
  return [
    '[out:json][timeout:60];',
    'way["highway"~"^(' + ROAD_CLASSES.join('|') + ')$"]' + a + ';out geom;',
    'way["building"]' + a3 + ';out geom;',
    'node["natural"="tree"]' + a + ';out skel;',
    'way["natural"="tree_row"]' + a + ';out geom;',
    'way["waterway"~"^(river|stream|canal|drain|ditch)$"]' + a2 + ';out geom;',
    'nwr["amenity"~"^(' + AMENITIES.join('|') + ')$"]' + a + ';out center;',
    'nwr["shop"~"^(mall|supermarket)$"]' + a + ';out center;',
    'nwr["leisure"~"^(park|playground)$"]' + a + ';out center;'
  ].join('\n');
}

async function overpass(urls, query) {
  let last = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const j = await fetchJson(urls[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Teduh-Hackathon-Prototype/2.0' },
        body: 'data=' + encodeURIComponent(query)
      }, 75000);
      if (!j || !Array.isArray(j.elements)) throw new HttpError(502, 'The map service returned something unexpected');
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new HttpError(504, 'The map service ran out of time. Try a smaller radius.');
      return j;
    } catch (e) { last = e; if (!process.env.TEDUH_QUIET) console.log('  Map service ' + urls[i] + ' failed: ' + (e && e.message)); }
  }
  throw new HttpError(last && last.status === 504 ? 504 : 502, 'The map data service is busy or unreachable. Try again in a minute.');
}

// ---------- reading the OpenStreetMap answer ----------

function walkable(t) {
  if (t.foot === 'no' || t.indoor) return false;
  if ((t.access === 'private' || t.access === 'no') && t.foot !== 'yes' && t.foot !== 'designated') return false;
  if (t.highway === 'service' && SKIP_SERVICE.has(t.service)) return false;
  return true;
}
function poiKind(t) {
  if (t.amenity && PLACE_WEIGHT[t.amenity]) return t.amenity;
  if (t.shop === 'mall' || t.shop === 'supermarket') return t.shop;
  if (t.leisure === 'park' || t.leisure === 'playground') return t.leisure;
  return null;
}
function cleanText(s, n) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function parseOsm(osm) {
  const roads = [], waterways = [], pois = [], treeLL = [], buildings = [];
  osm.elements.forEach(function (el) {
    const t = el.tags || {};
    if (el.type === 'way') {
      if (t.building && t.building !== 'no' && Array.isArray(el.geometry) && el.geometry.length >= 4) buildings.push(el);
      else if (t.highway && ROAD_SET.has(t.highway)) { if (walkable(t) && Array.isArray(el.geometry) && Array.isArray(el.nodes)) roads.push(el); }
      else if (t.natural === 'tree_row' && Array.isArray(el.geometry)) {
        for (let i = 0; i < el.geometry.length; i++) {
          const p = el.geometry[i];
          if (!p) continue;
          treeLL.push([p.lat, p.lon]);
          const q = el.geometry[i + 1];
          if (q) { // a row of trees: add some between the mapped ones
            const n = Math.min(10, Math.floor(Math.hypot((q.lat - p.lat) * 110574, (q.lon - p.lon) * 111320) / 8));
            for (let k = 1; k <= n; k++) treeLL.push([p.lat + (q.lat - p.lat) * k / (n + 1), p.lon + (q.lon - p.lon) * k / (n + 1)]);
          }
        }
      } else if (t.waterway && Array.isArray(el.geometry)) waterways.push(el);
    }
    if (el.type === 'node' && !el.tags && Number.isFinite(el.lat)) { treeLL.push([el.lat, el.lon]); return; }
    if (el.type === 'node' && t.natural === 'tree' && Number.isFinite(el.lat)) { treeLL.push([el.lat, el.lon]); return; }
    const kind = poiKind(t);
    const name = cleanText(t['name:en'] || t.name, 60);
    const c = el.type === 'node' ? el : el.center;
    if (kind && name && c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && !t.highway) pois.push({ name: name, kind: kind, lat: c.lat, lon: c.lon });
  });
  return { roads: roads, waterways: waterways, pois: pois, treeLL: treeLL, buildings: buildings };
}

function edgeProps(t) {
  const hw = t.highway;
  const covered = t.covered === 'yes' || t.covered === 'arcade' || t.covered === 'colonnade' || t.tunnel === 'building_passage' ? 1 : 0;
  let lit = null;
  if (/^(yes|24\/7|automatic|sunset-sunrise)$/.test(t.lit || '')) lit = 1;
  else if (t.lit === 'no') lit = 0;
  let bike = 1;
  if (hw === 'steps' || t.bicycle === 'no') bike = 0;
  else if ((hw === 'footway' || hw === 'pedestrian' || hw === 'path') && !/^(yes|designated|permissive)$/.test(t.bicycle || '')) bike = 0;
  const sidewalk = /^(both|left|right|yes)$/.test(t.sidewalk || '') || t['sidewalk:both'] === 'yes' || t['sidewalk:left'] === 'yes' || t['sidewalk:right'] === 'yes' ? 1 : 0;
  let road = cleanText(t.name || t['name:en'] || t.ref, 60);
  if (!road) road = covered && (hw === 'footway' || hw === 'pedestrian' || hw === 'path') ? 'Covered walkway' : (GENERIC_NAME[hw] || 'Unnamed road');
  return { hw: hw, covered: covered, lit: lit, steps: hw === 'steps' ? 1 : 0, bike: bike, sidewalk: sidewalk, road: road };
}

// ---------- the road graph ----------

function makeGraph(roads, xy, center, radius) {
  // A node shared by two ways (or used twice) is a junction. Ways are cut into segments at junctions.
  const use = new Map();
  roads.forEach(function (w) { w.nodes.forEach(function (id) { use.set(id, (use.get(id) || 0) + 1); }); });

  const segs = [];
  roads.forEach(function (w) {
    const g = w.geometry, n = w.nodes;
    if (g.length !== n.length || n.length < 2 || g.some(function (p) { return !p; })) return;
    const props = edgeProps(w.tags || {});
    let start = 0;
    for (let i = 1; i < n.length; i++) {
      if (i === n.length - 1 || use.get(n[i]) > 1) {
        const pts = g.slice(start, i + 1).map(function (p) { return [p.lat, p.lon]; });
        if (n[start] !== n[i]) segs.push({ id: 'w' + w.id + ':' + start, aId: n[start], bId: n[i], pts: pts, props: props });
        start = i;
      }
    }
  });

  // Keep segments near the chosen centre, then only the largest connected piece (so every place can reach every other).
  const near = segs.filter(function (s) {
    const m = s.pts[Math.floor(s.pts.length / 2)], p = xy(m[0], m[1]);
    return Math.hypot(p[0], p[1]) <= radius * 1.1;
  });
  const parent = new Map();
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  near.forEach(function (s) { [s.aId, s.bId].forEach(function (id) { if (!parent.has(id)) parent.set(id, id); }); });
  near.forEach(function (s) { parent.set(find(s.aId), find(s.bId)); });
  const size = new Map();
  near.forEach(function (s) { const r = find(s.aId); size.set(r, (size.get(r) || 0) + 1); });
  let best = null;
  size.forEach(function (n, r) { if (best === null || n > size.get(best)) best = r; });
  const kept = near.filter(function (s) { return find(s.aId) === best; });

  const idx = new Map(), nodes = [];
  function node(id, p) {
    let k = idx.get(id);
    if (k === undefined) { k = nodes.length; idx.set(id, k); nodes.push([round(p[0], 6), round(p[1], 6)]); }
    return k;
  }
  const seen = new Set(), edges = [];
  kept.forEach(function (s) {
    let id = s.id, dup = 1;
    while (seen.has(id)) id = s.id + '_' + (dup++);
    seen.add(id);
    const exy = s.pts.map(function (p) { return xy(p[0], p[1]); });
    const len = polyLen(exy);
    if (len < 0.5) return;
    edges.push({
      id: id, a: node(s.aId, s.pts[0]), b: node(s.bId, s.pts[s.pts.length - 1]),
      props: s.props, len: len, exy: exy,
      pts: s.pts.map(function (p) { return [round(p[0], 6), round(p[1], 6)]; })
    });
  });
  return { nodes: nodes, edges: edges };
}

// ---------- terrain ----------

async function fetchElevation(url, bbox) {
  const n = 9, lats = [], lons = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      lats.push((bbox.south + (bbox.north - bbox.south) * i / (n - 1)).toFixed(5));
      lons.push((bbox.west + (bbox.east - bbox.west) * j / (n - 1)).toFixed(5));
    }
  }
  const j = await fetchJson(url + '?latitude=' + lats.join(',') + '&longitude=' + lons.join(','), {}, 12000);
  if (!j || !Array.isArray(j.elevation) || j.elevation.length !== n * n || j.elevation.some(function (v) { return !Number.isFinite(Number(v)); })) {
    throw new HttpError(502, 'The elevation service returned something unexpected');
  }
  return { n: n, bbox: bbox, vals: j.elevation.map(Number) };
}
function elevationAt(el, lat, lon) {
  const n = el.n, b = el.bbox;
  const fx = clamp((lon - b.west) / (b.east - b.west || 1), 0, 1) * (n - 1);
  const fy = clamp((lat - b.south) / (b.north - b.south || 1), 0, 1) * (n - 1);
  const j0 = Math.min(n - 2, Math.floor(fx)), i0 = Math.min(n - 2, Math.floor(fy));
  const tx = fx - j0, ty = fy - i0;
  const v = function (i, j) { return el.vals[i * n + j]; };
  return (v(i0, j0) * (1 - tx) + v(i0, j0 + 1) * tx) * (1 - ty) + (v(i0 + 1, j0) * (1 - tx) + v(i0 + 1, j0 + 1) * tx) * ty;
}

// ---------- put it together ----------

function buildDataset(osm, opts) {
  const lat0 = opts.lat, lon0 = opts.lon, radius = opts.radius;
  const xy = projector(lat0, lon0);
  const parsed = parseOsm(osm);
  const g = makeGraph(parsed.roads, xy, { lat: lat0, lon: lon0 }, radius);
  if (g.edges.length < 3) throw new HttpError(404, 'No walkable roads found here. Try a more built-up place or a larger radius.');

  // trees: count the ones within 12 m of each segment
  const trees = parsed.treeLL.map(function (p) { const q = xy(p[0], p[1]); return [q[0], q[1], p[0], p[1]]; });
  const tgrid = new Grid(30);
  trees.forEach(function (t, i) { tgrid.add(t[0], t[1], i); });
  const usedTrees = new Set();

  // waterways: distance from each segment to the nearest drain, ditch or stream
  const wsegs = [];
  parsed.waterways.forEach(function (w) {
    const pts = w.geometry.filter(Boolean).map(function (p) { return xy(p.lat, p.lon); });
    for (let i = 1; i < pts.length; i++) wsegs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
  });

  const el = opts.elevation || null;
  let eMin = Infinity, eMax = -Infinity;
  if (el) el.vals.forEach(function (v) { eMin = Math.min(eMin, v); eMax = Math.max(eMax, v); });
  const eRange = el ? eMax - eMin : 0;
  const rangeFactor = clamp(eRange / 10, 0.2, 1);

  const edges = g.edges.map(function (e) {
    // shade
    const seen = new Set();
    for (let i = 1; i < e.exy.length; i++) {
      const a = e.exy[i - 1], b = e.exy[i];
      tgrid.query(Math.min(a[0], b[0]) - 12, Math.min(a[1], b[1]) - 12, Math.max(a[0], b[0]) + 12, Math.max(a[1], b[1]) + 12).forEach(function (ti) {
        if (!seen.has(ti) && segDist(trees[ti][0], trees[ti][1], a[0], a[1], b[0], b[1]) <= 12) seen.add(ti);
      });
    }
    seen.forEach(function (ti) { usedTrees.add(ti); });
    const shade = clamp((seen.size / (Math.max(e.len, 20) / 100)) / 8, 0, 1);

    // flood estimate
    const mid = e.exy[Math.floor(e.exy.length / 2)];
    let wd = Infinity;
    for (let i = 0; i < wsegs.length; i++) wd = Math.min(wd, segDist(mid[0], mid[1], wsegs[i][0], wsegs[i][1], wsegs[i][2], wsegs[i][3]));
    const nearWater = wd <= 20 ? 1 : wd <= 100 ? 1 - (wd - 20) / 80 : 0;
    let low = 0;
    if (el && eRange > 0) {
      const m = e.pts[Math.floor(e.pts.length / 2)];
      low = clamp((eMax - elevationAt(el, m[0], m[1])) / eRange, 0, 1);
    }
    const thr = Math.round(clamp(85 - 28 * low * rangeFactor - 32 * nearWater, 25, 90));

    return {
      id: e.id, a: e.a, b: e.b, road: e.props.road, len: Math.round(e.len), shade: round(shade, 2),
      covered: e.props.covered, thr: thr, hw: e.props.hw, lit: e.props.lit, steps: e.props.steps,
      bike: e.props.bike, sidewalk: e.props.sidewalk, pts: e.pts, mid: [e.exy[Math.floor(e.exy.length / 2)][0], e.exy[Math.floor(e.exy.length / 2)][1]]
    };
  });

  // building shadows: for each street, how much of it a building shades at each hour from 7:00 to 19:00
  const bs = parsed.buildings.map(function (b) {
    const ring = b.geometry.filter(Boolean).map(function (p) { return xy(p.lat, p.lon); });
    return ring.length >= 4 ? { ring: ring, h: buildingHeight(b.tags || {}) } : null;
  }).filter(Boolean).slice(0, 12000);
  if (bs.length) {
    const sh = shadowByHour(bs, g.edges.map(function (e) { return { exy: e.exy }; }), lat0, lon0, opts.date || new Date());
    edges.forEach(function (e, i) {
      const ts = e.shade;
      const hrs = sh[i].map(function (b) { return round(1 - (1 - ts) * (1 - b), 2); });
      if (hrs.some(function (v, k) { return Math.abs(v - ts) > 0.005; })) e.sh = hrs;
    });
  }

  // landmarks: the most useful named ones, spread out, snapped to the road network
  const nodeXY = g.nodes.map(function (p) { return xy(p[0], p[1]); });
  function nearestNode(x, y) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nodeXY.length; i++) { const d = Math.hypot(nodeXY[i][0] - x, nodeXY[i][1] - y); if (d < bd) { bd = d; bi = i; } }
    return { i: bi, d: bd };
  }
  const cands = parsed.pois.map(function (p) { const q = xy(p.lat, p.lon); return Object.assign({ x: q[0], y: q[1] }, p); })
    .filter(function (p) { return Math.hypot(p.x, p.y) <= radius * 1.1; })
    .sort(function (a, b) { return PLACE_WEIGHT[b.kind] - PLACE_WEIGHT[a.kind] || a.name.localeCompare(b.name); });
  const places = [], usedNodes = new Set();
  cands.forEach(function (p) {
    if (places.length >= MAX_PLACES) return;
    if (places.some(function (q) { return Math.hypot(q.x - p.x, q.y - p.y) < 120; })) return;
    const nn = nearestNode(p.x, p.y);
    if (nn.i < 0 || nn.d > 150 || usedNodes.has(nn.i)) return;
    usedNodes.add(nn.i);
    places.push({ name: p.name, kind: p.kind, node: nn.i, lat: p.lat, lon: p.lon, x: p.x, y: p.y });
  });
  function addGeneric(name, i) {
    if (usedNodes.has(i)) return;
    usedNodes.add(i);
    places.push({ name: name, kind: 'spot', node: i, lat: g.nodes[i][0], lon: g.nodes[i][1], x: nodeXY[i][0], y: nodeXY[i][1] });
  }
  if (places.length < 4) {
    addGeneric('Town centre', nearestNode(0, 0).i);
    const ext = [['North end', function (a, b) { return b[1] - a[1]; }], ['East end', function (a, b) { return b[0] - a[0]; }], ['South end', function (a, b) { return a[1] - b[1]; }], ['West end', function (a, b) { return a[0] - b[0]; }]];
    ext.forEach(function (x) {
      if (places.length >= 4) return;
      const order = nodeXY.map(function (p, i) { return i; }).sort(function (a, b) { return x[1](nodeXY[a], nodeXY[b]); });
      addGeneric(x[0], order[0]);
    });
  }

  edges.forEach(function (e) {
    let best = null, bd = 150;
    places.forEach(function (p) { const d = Math.hypot(p.x - e.mid[0], p.y - e.mid[1]); if (d < bd) { bd = d; best = p; } });
    e.where = best && best.kind !== 'spot' ? e.road + ' near ' + best.name : e.road;
    delete e.mid;
  });

  let treesOut = Array.from(usedTrees).map(function (i) { return [round(trees[i][2], 6), round(trees[i][3], 6)]; });
  if (treesOut.length > MAX_TREES_SENT) {
    const step = treesOut.length / MAX_TREES_SENT;
    treesOut = Array.from({ length: MAX_TREES_SENT }, function (_, k) { return treesOut[Math.floor(k * step)]; });
  }

  const coveredN = edges.filter(function (e) { return e.covered; }).length;
  const notes = [
    'Roads, trees, covered walkways, buildings and waterways come from OpenStreetMap contributors, so coverage depends on how well this area has been mapped.',
    bs.length ? 'Shade also counts the shadows of ' + bs.length + ' buildings, worked out from the sun position for each hour. Building heights come from OpenStreetMap tags or a typical height for the building type, so this is an estimate.' : 'No buildings were mapped here, so shade comes from trees and covered walkways only.',
    el ? 'Terrain height comes from a 90 m elevation model (Open-Meteo).' : 'Terrain height was not available, so flood estimates use nearby waterways only.',
    'The rain level at which each road floods is an estimate from terrain and nearby drains or streams. It is not a measurement. Township drain records and flood history would replace it.'
  ];
  return {
    name: opts.name || 'Selected area',
    source: 'openstreetmap',
    center: { lat: lat0, lon: lon0 }, radius: radius,
    generated: new Date().toISOString(),
    stats: { roads: edges.length, buildings: bs.length, trees: usedTrees.size, covered: coveredN, places: places.length, waterways: parsed.waterways.length, terrain: !!el },
    notes: notes,
    nodes: g.nodes,
    edges: edges,
    places: places.map(function (p) { return { name: p.name, kind: p.kind, node: p.node, lat: round(p.lat, 6), lon: round(p.lon, 6) }; }),
    trees: treesOut
  };
}

// ---------- the service the server uses ----------

function createGeoService(cfg) {
  const memory = new Map();
  const inflight = new Map();
  const cacheDir = path.join(cfg.dataDir, 'cache');

  async function geocode(q) {
    const query = cleanText(q, 80);
    if (query.length < 2) throw new HttpError(400, 'Type at least 2 letters');
    try {
      const rows = await fetchJson(cfg.urls.nominatim + '?format=jsonv2&limit=5&countrycodes=my&q=' + encodeURIComponent(query),
        { headers: { 'User-Agent': 'Teduh-Hackathon-Prototype/2.0', 'Accept-Language': 'en' } }, 8000);
      const out = (Array.isArray(rows) ? rows : []).map(function (r) {
        return { name: cleanText(r.name || (r.display_name || '').split(',')[0], 60), label: cleanText(r.display_name, 120), lat: Number(r.lat), lon: Number(r.lon) };
      }).filter(function (r) { return r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon); });
      if (out.length) return out;
    } catch (e) { /* try the second service */ }
    const j = await fetchJson(cfg.urls.geocoding + '?name=' + encodeURIComponent(query) + '&count=5&language=en&format=json&countryCode=MY', {}, 8000);
    return (j && Array.isArray(j.results) ? j.results : []).map(function (r) {
      return { name: cleanText(r.name, 60), label: cleanText([r.name, r.admin2, r.admin1].filter(Boolean).join(', '), 120), lat: Number(r.latitude), lon: Number(r.longitude) };
    }).filter(function (r) { return r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon); });
  }

  function key(lat, lon, r) { return lat.toFixed(3) + '_' + lon.toFixed(3) + '_' + r + '_b'; }

  async function build(lat, lon, radius, name) {
    if (!process.env.TEDUH_QUIET) console.log('  Loading map data around ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ' (' + radius + ' m)...');
    const osm = await overpass(cfg.urls.overpass, overpassQuery(lat, lon, radius));
    let el = null;   // terrain is a bonus: if it fails, flood estimates use waterways only
    try {
      const r = radius * 1.1, dLat = r / 110574, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
      el = await fetchElevation(cfg.urls.elevation, { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon });
    } catch (e) { el = null; }
    return buildDataset(osm, { lat: lat, lon: lon, radius: radius, name: name, elevation: el });
  }

  async function township(p) {
    const lat = p.lat, lon = p.lon, radius = clamp(Math.round(p.radius || cfg.township.radius), 300, 1500);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new HttpError(400, 'Bad location');
    const name = cleanText(p.name, 80) || 'Area near ' + lat.toFixed(3) + ', ' + lon.toFixed(3);
    const k = key(lat, lon, radius);

    const hit = memory.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return Object.assign({}, hit.data, { name: name });
    const file = path.join(cacheDir, 'township-' + k + '.json');
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < CACHE_MS) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        memory.set(k, { at: Date.now(), data: data });
        return Object.assign({}, data, { name: name });
      }
    } catch (e) { /* not cached */ }

    if (!inflight.has(k)) {
      inflight.set(k, build(lat, lon, radius, name).then(function (data) {
        memory.set(k, { at: Date.now(), data: data });
        if (memory.size > 20) memory.delete(memory.keys().next().value);
        try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { /* cache is optional */ }
        return data;
      }).finally(function () { inflight.delete(k); }));
    }
    const data = await inflight.get(k);
    return Object.assign({}, data, { name: name });
  }

  function isCached(lat, lon, radius) { return memory.has(key(lat, lon, clamp(Math.round(radius || cfg.township.radius), 300, 1000))); }

  return { geocode: geocode, township: township, isCached: isCached };
}

module.exports = { createGeoService, buildDataset, parseOsm, overpassQuery, fetchElevation, elevationAt };
