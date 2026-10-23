'use strict';
// Sun position, building shadows, and how routing uses them.
const { sunPosition } = require('../lib/sun');
const { shadowByHour, buildingHeight } = require('../lib/shadow');
const Logic = require('../public/js/logic.js');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

console.log('Sun position');
const eq = sunPosition(0, 101.6, new Date('2026-03-20T00:00:00Z'), 13.2);
check('equinox solar noon on the equator is almost overhead', eq.el > 85, eq);
const oct = sunPosition(3.0, 101.6, new Date('2026-10-19T00:00:00Z'), 13);
check('Kuala Lumpur mid-October, 1 pm: high sun to the south', oct.el > 70 && oct.az > 150 && oct.az < 210, oct);
const am = sunPosition(3.0, 101.6, new Date('2026-10-19T00:00:00Z'), 9);
const pm = sunPosition(3.0, 101.6, new Date('2026-10-19T00:00:00Z'), 16.5);
check('morning sun is in the east, afternoon sun in the west', am.az > 40 && am.az < 130 && pm.az > 230 && pm.az < 320, [am, pm]);
check('sun is at the horizon at 7 am and set at midnight', sunPosition(3, 101.6, new Date('2026-10-19T00:00:00Z'), 7).el < 5 && sunPosition(3, 101.6, new Date('2026-10-19T00:00:00Z'), 0).el < 0);

console.log('Building heights');
check('height tag wins', buildingHeight({ building: 'house', height: '12 m' }) === 12);
check('levels give about 3.2 m each plus roof', Math.abs(buildingHeight({ building: 'yes', 'building:levels': '3' }) - 10.6) < 0.01);
check('type default, and a safe fallback', buildingHeight({ building: 'apartments' }) === 25 && buildingHeight({ building: 'yes' }) === 6);

console.log('Shadows on streets');
const lat = 3.0, lon = 101.6, day = new Date('2026-10-19T00:00:00Z');
const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const west = { exy: [[-10, 0], [-10, 10]] };      // a street just west of the building
const east = { exy: [[20, 0], [20, 10]] };        // a street just east of it
const out = shadowByHour([{ ring: sq, h: 20 }], [west, east], lat, lon, day);
const H = function (h) { return h - 7; };
check('morning sun (east) throws the shadow west', out[0][H(9)] > 0.5 && out[1][H(9)] === 0, [out[0][H(9)], out[1][H(9)]]);
check('afternoon sun (west) throws the shadow east', out[1][H(16)] > 0.5 && out[0][H(16)] === 0, [out[1][H(16)], out[0][H(16)]]);
check('no buildings means no shadow', shadowByHour([], [west], lat, lon, day)[0].every(function (v) { return v === 0; }));
check('a low building casts a shorter shadow than a tall one', (function () {
  const far = { exy: [[-30, 0], [-30, 10]] };
  const lowB = shadowByHour([{ ring: sq, h: 4 }], [far], lat, lon, day)[0][H(9)];
  const tallB = shadowByHour([{ ring: sq, h: 40 }], [far], lat, lon, day)[0][H(9)];
  return tallB > lowB;
})());
check('street running through a building footprint is not counted as shaded', shadowByHour([{ ring: sq, h: 20 }], [{ exy: [[5, 2], [5, 8]] }], lat, lon, day)[0][H(12)] < 0.5);

console.log('Routing uses the hour');
function graph(edges) {
  const nodes = [[3, 101.5], [3.001, 101.5], [3.002, 101.5]];
  return Logic.buildGraph({ name: 't', nodes: nodes, places: [], edges: edges.map(function (d, i) {
    return Object.assign({ id: 'e' + i, shade: 0, covered: 0, thr: 90, hw: 'residential', lit: null }, d);
  }) });
}
const morningShade = [0.9, 0.9, 0.9, 0.9, 0.9, 0, 0, 0, 0, 0, 0, 0, 0];     // direct street is shaded until 11:00 only
const G = graph([
  { a: 0, b: 1, road: 'Direct', len: 100, sh: morningShade },
  { a: 0, b: 2, road: 'Tree A', len: 55, shade: 0.9 },
  { a: 2, b: 1, road: 'Tree B', len: 55, shade: 0.9 }
]);
const names = function (r) { return r.edges.map(function (e) { return e.road; }).join('>'); };
const c9 = Logic.conditions(0, 9, 10), c15 = Logic.conditions(0, 15, 10);
check('9 am: the shaded direct street is the best', names(Logic.route(G, 0, 1, 'teduh', c9, 'senior')) === 'Direct');
check('3 pm: the same street is now sunny, so the walker detours through trees', names(Logic.route(G, 0, 1, 'teduh', c15, 'senior')) === 'Tree A>Tree B');
check('shortest route never changes', names(Logic.route(G, 0, 1, 'standard', c15, 'senior')) === 'Direct');
check('shade share in the stats follows the hour', Logic.stats(Logic.route(G, 0, 1, 'standard', c9, 'senior'), c9, 'senior').shadedPct === 90 && Logic.stats(Logic.route(G, 0, 1, 'standard', c15, 'senior'), c15, 'senior').shadedPct === 0);
check('values between hours are blended', Math.abs(Logic.shadeAt(G.edges[0], 11.5) - 0.45) < 0.01);

console.log('Finding a trip where Teduh differs');
const G2 = graph([
  { a: 0, b: 1, road: 'Direct', len: 200, sh: morningShade },
  { a: 0, b: 2, road: 'Tree A', len: 110, shade: 0.9 },
  { a: 2, b: 1, road: 'Tree B', len: 110, shade: 0.9 }
]);
const best = Logic.bestContrast(G2, c15, 'senior');
check('finds the trip where the routes differ and says how much sun it saves', best && best.a !== best.b && best.sunSaved > 0 && best.score > 0, best);
const flat = graph([{ a: 0, b: 1, road: 'Only', len: 200 }, { a: 1, b: 2, road: 'Only 2', len: 200 }]);
check('returns nothing when no trip can differ', Logic.bestContrast(flat, c15, 'senior') === null);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
