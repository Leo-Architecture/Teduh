'use strict';
// A made-up township. It is shown when the page is opened without the server,
// or when real map data cannot be loaded. It has the same shape as real data from the server.

(function (root) {
  const U = 2e-5;                    // degrees per map unit (about 2.2 m)
  const ll = function (x, y) { return [-(y - 150) * U, (x - 180) * U]; };

  const PLACES = {
    home: [36, 46, 'Residences'], clinic: [184, 50, 'Clinic'], market: [326, 52, 'Market'],
    plaza: [186, 158, 'Plaza'], bus: [38, 258, 'Bus stop'], park: [184, 262, 'Park'], school: [326, 264, 'School']
  };
  const JUNCTIONS = { a: [112, 38], b: [256, 40], c: [44, 152], d: [116, 146], f: [254, 150], g: [322, 158], h: [112, 252], i: [252, 254] };
  // id, from, to, road, label, shade (0-1), covered walkway, floods at (mm/h), blocked drain
  const EDGES = [
    ['e01', 'home', 'a', 'Jalan Seri', 'Jalan Seri near Residences', 0.7, 0, 90, 0],
    ['e02', 'a', 'clinic', 'Jalan Seri', 'Jalan Seri by the Clinic', 0.6, 1, 90, 0],
    ['e03', 'clinic', 'b', 'Jalan Seri', 'Jalan Seri east of Clinic', 0.5, 0, 90, 0],
    ['e04', 'b', 'market', 'Jalan Seri', 'Jalan Seri at the Market arcade', 0.3, 1, 90, 0],
    ['e05', 'c', 'd', 'Jalan Lembah', 'Jalan Lembah west', 0.1, 0, 55, 0],
    ['e06', 'd', 'plaza', 'Jalan Lembah', 'Jalan Lembah near Plaza', 0.15, 0, 28, 1],
    ['e07', 'plaza', 'f', 'Jalan Lembah', 'Jalan Lembah east of Plaza', 0.1, 0, 40, 0],
    ['e08', 'f', 'g', 'Jalan Lembah', 'Jalan Lembah near Market', 0.2, 0, 55, 0],
    ['e09', 'bus', 'h', 'Jalan Taman', 'Jalan Taman near Bus stop', 0.5, 0, 80, 0],
    ['e10', 'h', 'park', 'Jalan Taman', 'Jalan Taman by the Park', 0.8, 0, 80, 0],
    ['e11', 'park', 'i', 'Jalan Taman', 'Jalan Taman east of Park', 0.8, 0, 75, 0],
    ['e12', 'i', 'school', 'Jalan Taman', 'Jalan Taman at School gate', 0.4, 1, 80, 0],
    ['e13', 'home', 'c', 'Lorong Pokok', 'Lorong Pokok north', 0.8, 0, 85, 0],
    ['e14', 'c', 'bus', 'Lorong Pokok', 'Lorong Pokok south', 0.6, 0, 75, 0],
    ['e15', 'a', 'd', 'Lorong Bukit', 'Lorong Bukit north', 0.4, 0, 85, 0],
    ['e16', 'd', 'h', 'Lorong Bukit', 'Lorong Bukit south', 0.3, 0, 65, 0],
    ['e17', 'clinic', 'plaza', 'Jalan Pusat', 'Jalan Pusat north', 0.2, 1, 60, 0],
    ['e18', 'plaza', 'park', 'Jalan Pusat', 'Jalan Pusat south', 0.3, 0, 38, 0],
    ['e19', 'b', 'f', 'Lorong Cahaya', 'Lorong Cahaya north', 0.1, 0, 80, 0],
    ['e20', 'f', 'i', 'Lorong Cahaya', 'Lorong Cahaya south', 0.1, 0, 45, 0],
    ['e21', 'market', 'g', 'Jalan Pasar', 'Jalan Pasar north', 0.2, 0, 70, 0],
    ['e22', 'g', 'school', 'Jalan Pasar', 'Jalan Pasar south', 0.15, 0, 50, 0]
  ];
  const LIT = { 'Jalan Seri': 1, 'Jalan Pusat': 1, 'Jalan Pasar': 1, 'Jalan Taman': 1, 'Lorong Cahaya': 1, 'Lorong Pokok': 0, 'Lorong Bukit': 0 };

  function build() {
    const xy = Object.assign({}, PLACES, JUNCTIONS);
    const keys = Object.keys(xy);
    const idx = {};
    keys.forEach(function (k, i) { idx[k] = i; });
    const nodes = keys.map(function (k) { return ll(xy[k][0], xy[k][1]); });

    const trees = [];
    const edges = EDGES.map(function (d, n) {
      const A = xy[d[1]], B = xy[d[2]];
      const len = Math.round(Math.hypot(A[0] - B[0], A[1] - B[1]) * 2.2 / 5) * 5;
      if (d[5] >= 0.35) {            // draw trees beside shaded roads
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / L, ny = (B[0] - A[0]) / L;
        const count = Math.max(3, Math.round(L / 22));
        for (let j = 0; j < count; j++) {
          const t = (j + 0.5) / count, side = (j % 2 ? 1 : -1) * (9 + ((n * 7 + j * 3) % 4));
          trees.push(ll(A[0] + (B[0] - A[0]) * t + nx * side, A[1] + (B[1] - A[1]) * t + ny * side));
        }
      }
      return {
        id: d[0], a: idx[d[1]], b: idx[d[2]], road: d[3], where: d[4], len: len, shade: d[5], covered: d[6],
        thr: d[7], base: d[8] ? 55 : d[7], blocked: d[8], hw: 'residential', lit: LIT[d[3]] === undefined ? null : LIT[d[3]],
        steps: 0, bike: 1, sidewalk: d[3].indexOf('Lorong') === 0 ? 0 : 1, pts: [ll(A[0], A[1]), ll(B[0], B[1])]
      };
    });

    const places = Object.keys(PLACES).map(function (k) {
      const p = nodes[idx[k]];
      return { name: PLACES[k][2], kind: 'spot', node: idx[k], lat: p[0], lon: p[1] };
    });
    const river = [[-10, 186], [70, 181], [140, 190], [210, 184], [270, 188], [320, 189], [370, 180]].map(function (p) { return ll(p[0], p[1]); });
    const c = ll(180, 150);
    return {
      name: 'Sample township', source: 'sample', center: { lat: c[0], lon: c[1] }, radius: 400,
      stats: { roads: edges.length, trees: trees.length, covered: edges.filter(function (e) { return e.covered; }).length, places: places.length, waterways: 1, terrain: false },
      notes: ['This township is invented for demonstration. Connect to the server to load a real one.'],
      nodes: nodes, edges: edges, places: places, trees: trees,
      decor: { river: river, park: { lat: ll(184, 268)[0], lon: ll(184, 268)[1], rx: 60 * U, ry: 26 * U } }
    };
  }

  root.Sample = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Sample;
