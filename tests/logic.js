'use strict';
// Tests for the route logic (public/js/logic.js and sample.js). Run with:  node tests/logic.js

const Logic = require('../public/js/logic.js');
const Sample = require('../public/js/sample.js');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

// a tiny graph from edge descriptions: [from, to, road, len, overrides]
function graph(nodeCount, edges) {
  const nodes = []; for (let i = 0; i < nodeCount; i++) nodes.push([3 + i * 1e-4, 101.5]);
  return Logic.buildGraph({
    name: 't', nodes: nodes, places: [],
    edges: edges.map(function (d, i) {
      return Object.assign({ id: 'e' + i, a: d[0], b: d[1], road: d[2], len: d[3], shade: 0, covered: 0, thr: 90, hw: 'residential', lit: null, steps: 0, bike: 1, sidewalk: 1, pts: [nodes[d[0]], nodes[d[1]]] }, d[4] || {});
    })
  });
}
const names = function (r) { return r ? r.edges.map(function (e) { return e.road; }).join('>') : null; };
const noon = Logic.conditions(0, 13, null), night = Logic.conditions(0, 21, null);

console.log('\nSample township');
const ds = Sample.build();
const G = Logic.buildGraph(ds);
const node = function (name) { return G.places.find(function (p) { return p.name === name; }).node; };
const c20 = Logic.conditions(20, 14, null);
let S = Logic.route(G, node('Residences'), node('School'), 'standard', c20, 'pedestrian');
let T = Logic.route(G, node('Residences'), node('School'), 'teduh', c20, 'pedestrian');
check('shortest route is the same as before', Logic.stats(S, c20, 'pedestrian').dist === 1085 && S.edges[0].id === 'e13');
check('teduh route is the same as before and avoids the rising road', Logic.stats(T, c20, 'pedestrian').dist === 1115 && Logic.stats(T, c20, 'pedestrian').risk.length === 0 && Logic.stats(S, c20, 'pedestrian').risk.length === 1);
const heavy = Logic.conditions(40, 15, null);
T = Logic.route(G, node('Residences'), node('School'), 'teduh', heavy, 'pedestrian');
check('in heavy rain teduh finds a fully dry route', Logic.stats(T, heavy, 'pedestrian').flooded.length === 0 && Logic.stats(T, heavy, 'pedestrian').risk.length === 0);
const noSun = Logic.conditions(0, 12, 0);
const Sn = Logic.route(G, node('Residences'), node('School'), 'standard', noSun, 'pedestrian'), Tn = Logic.route(G, node('Residences'), node('School'), 'teduh', noSun, 'pedestrian');
check('with no sun and no rain the routes agree unless a blocked drain is on the shortest route', Logic.sameRoute(Sn, Tn) || Sn.edges.some(function (e) { return e.blocked; }));
check('route to the same place is null', Logic.route(G, 0, 0, 'teduh', noon, 'pedestrian') === null);
check('trips and usage are computed', (function () { const t = Logic.makeTrips(G); const u = Logic.usageCounts(G, t); return t.length === 21 && Object.keys(u).length === 22 && Object.values(u).some(function (n) { return n >= 3; }); })());
check('default trip uses two different places', (function () { const t = Logic.defaultTrip(G); return t[0] !== t[1]; })());
check('every profile finds a route in the sample', Logic.PROFILE_ORDER.every(function (p) { return Logic.route(G, node('Residences'), node('School'), 'teduh', c20, p); }));

console.log('\nShortest path against a slow reference');
(function () {
  let seed = 7; const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = 120, edges = [];
  for (let i = 1; i < n; i++) edges.push([i, Math.floor(rnd() * i), 'r' + i, 10 + Math.floor(rnd() * 90)]);
  for (let i = 0; i < 200; i++) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); if (a !== b) edges.push([a, b, 'x' + i, 10 + Math.floor(rnd() * 90)]); }
  const g = graph(n, edges);
  const ref = function (from) {
    const d = new Array(n).fill(Infinity), done = new Array(n).fill(false); d[from] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || d[i] < d[u])) u = i;
      if (u === -1 || d[u] === Infinity) break; done[u] = true;
      g.adj[u].forEach(function (p) { if (d[u] + p[0].len < d[p[1]]) d[p[1]] = d[u] + p[0].len; });
    }
    return d;
  };
  let ok = true;
  for (let from = 0; from < 10; from++) {
    const d = ref(from);
    for (let to = 0; to < n; to++) {
      if (to === from) continue;
      const r = Logic.route(g, from, to, 'standard', noon, 'pedestrian');
      const len = r.edges.reduce(function (s, e) { return s + e.len; }, 0);
      if (len !== d[to]) ok = false;
    }
  }
  check('heap Dijkstra matches the reference on 1200 random trips', ok);
})();

console.log('\nProfiles');
// 0 --steps(50)-- 1 ; 0 --road(60)-- 2 --road(60)-- 1
const stepsG = graph(3, [[0, 1, 'Steps', 50, { hw: 'steps', steps: 1, bike: 0 }], [0, 2, 'Road A', 60], [2, 1, 'Road B', 60]]);
check('pedestrian takes the steps (shortest)', names(Logic.route(stepsG, 0, 1, 'teduh', noon, 'pedestrian')) === 'Steps');
check('senior citizens avoid steps', names(Logic.route(stepsG, 0, 1, 'teduh', noon, 'senior')) === 'Road A>Road B');
check('a bicyclist cannot use steps, even on the shortest route', names(Logic.route(stepsG, 0, 1, 'standard', noon, 'cyclist')) === 'Road A>Road B');
const onlySteps = graph(2, [[0, 1, 'Steps', 50, { hw: 'steps', steps: 1, bike: 0 }]]);
check('no way at all for a bicyclist gives null, not a crash', Logic.route(onlySteps, 0, 1, 'teduh', noon, 'cyclist') === null && Logic.route(onlySteps, 0, 1, 'teduh', noon, 'pedestrian') !== null);
const footG = graph(3, [[0, 1, 'Footpath', 50, { hw: 'footway', bike: 0 }], [0, 2, 'Road A', 70], [2, 1, 'Road B', 70]]);
check('a bicyclist avoids footpaths where cycling is not allowed', names(Logic.route(footG, 0, 1, 'teduh', noon, 'cyclist')) === 'Road A>Road B');

// 0 --unlit(100)-- 1 ; 0 --lit(130 in two parts)-- 1
const litG = graph(3, [[0, 1, 'Dark lane', 100, { lit: 0 }], [0, 2, 'Lit A', 65, { lit: 1 }], [2, 1, 'Lit B', 65, { lit: 1 }]]);
check('women prefer the lit street after dark', names(Logic.route(litG, 0, 1, 'teduh', night, 'women')) === 'Lit A>Lit B');
check('women take the short street in daylight', names(Logic.route(litG, 0, 1, 'teduh', noon, 'women')) === 'Dark lane');
check('a pedestrian cares much less about lighting', names(Logic.route(litG, 0, 1, 'teduh', night, 'pedestrian')) === 'Dark lane');
const rLit = Logic.route(litG, 0, 1, 'teduh', night, 'women');
check('lit share is reported', Logic.stats(rLit, night, 'women').litPct === 100 && Logic.stats(Logic.route(litG, 0, 1, 'standard', night, 'women'), night, 'women').litPct === 0);

const busyG = graph(3, [[0, 1, 'Busy road', 100, { hw: 'primary', sidewalk: 0 }], [0, 2, 'Quiet A', 70], [2, 1, 'Quiet B', 70]]);
check('children avoid a busy road without a pavement', names(Logic.route(busyG, 0, 1, 'teduh', noon, 'children')) === 'Quiet A>Quiet B');
check('a pedestrian takes the busy road when it is much shorter', names(Logic.route(busyG, 0, 1, 'teduh', noon, 'pedestrian')) === 'Busy road');

const shadeG = graph(3, [[0, 1, 'Sunny', 100], [0, 2, 'Arcade A', 70, { covered: 1 }], [2, 1, 'Arcade B', 70, { covered: 1 }]]);
check('senior citizens take a covered walkway in the midday sun', names(Logic.route(shadeG, 0, 1, 'teduh', noon, 'senior')) === 'Arcade A>Arcade B');
check('nobody detours for shade at night', names(Logic.route(shadeG, 0, 1, 'teduh', night, 'senior')) === 'Sunny');
check('covered share is reported', Logic.stats(Logic.route(shadeG, 0, 1, 'teduh', noon, 'senior'), noon, 'senior').coveredPct === 100);
check('a bicyclist is faster than a walker', Logic.stats(Logic.route(shadeG, 0, 1, 'standard', noon, 'cyclist'), noon, 'cyclist').min < Logic.stats(Logic.route(shadeG, 0, 1, 'standard', noon, 'pedestrian'), noon, 'pedestrian').min / 2);

console.log('\nFlooding');
const floodG = graph(3, [[0, 1, 'Low road', 100, { thr: 30 }], [0, 2, 'High A', 80, { thr: 90 }], [2, 1, 'High B', 80, { thr: 90 }]]);
const rain35 = Logic.conditions(35, 14, null);
check('the shortest route walks into the flood, teduh does not', Logic.stats(Logic.route(floodG, 0, 1, 'standard', rain35, 'pedestrian'), rain35, 'pedestrian').flooded.length === 1 && names(Logic.route(floodG, 0, 1, 'teduh', rain35, 'pedestrian')) === 'High A>High B');
check('when every way floods teduh still returns the least bad route', (function () { const g = graph(2, [[0, 1, 'Only road', 100, { thr: 10 }]]); const r = Logic.route(g, 0, 1, 'teduh', Logic.conditions(50, 14, null), 'pedestrian'); return r && Logic.stats(r, Logic.conditions(50, 14, null), 'pedestrian').flooded.length === 1; })());
check('real UV index replaces the clock curve', Logic.conditions(0, 7, 8).sunLoad > 0.7 && Logic.conditions(0, 13, 0).sunLoad === 0);
check('night is dark and noon is not', Logic.darkness(22) === 1 && Logic.darkness(13) === 0 && Logic.darkness(19) > 0 && Logic.darkness(19) < 1);

console.log('\nImpact');
const impG = graph(4, [[0, 1, 'Sunny short', 100, { thr: 30 }], [0, 2, 'Arcade A', 70, { covered: 1, thr: 90 }], [2, 1, 'Arcade B', 70, { covered: 1, thr: 90 }]]);
const imp = Logic.impact(impG, [[0, 1]]);
check('impact: shade saves sun minutes for a small extra walk', imp.sun && imp.sun.savedMin > 0 && imp.sun.extraMin > 0 && imp.sun.savedPct > 0 && imp.sun.savedPct <= 100);
check('impact: trips through a flooding road are kept dry', imp.rain.wet === 5 && imp.rain.kept === 5);
check('impact: no trips gives an empty result', Logic.impact(impG, []).sun === null);
const sampG = Logic.buildGraph(Sample.build()); const sampImp = Logic.impact(sampG, Logic.makeTrips(sampG));
check('impact: works on the sample township', sampImp.pairs > 0 && sampImp.rain.kept <= sampImp.rain.wet);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
