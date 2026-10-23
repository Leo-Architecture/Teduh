'use strict';
// Building shadows on streets.
// A building of height h under a sun at height el casts a shadow h / tan(el) long, pointing away from the sun.
// The shadow is everything the building footprint sweeps over as it slides along that line.
// For each street and each hour we test points along the street (and a pavement 3 m to each side) against those shadows.
// This is an ESTIMATE: building heights come from OpenStreetMap tags (height, building:levels) or a typical value for the building type.

const { sunPosition } = require('./sun');

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const MAX_SHADOW = 60;     // metres: very low sun gives very long shadows, which are not reliable
const SIDE = 3;            // metres from the road centre line to the pavement
const STEP = 6;            // metres between test points

const DEFAULT_H = {
  house: 7, detached: 7, terrace: 7, semidetached_house: 7, residential: 8, bungalow: 5, static_caravan: 3,
  apartments: 25, dormitory: 15, hotel: 20, commercial: 12, retail: 8, office: 20, industrial: 9, warehouse: 8,
  school: 9, university: 12, hospital: 16, mosque: 12, church: 10, temple: 10, hut: 3, shed: 3, garage: 3, garages: 3,
  carport: 3, roof: 4, kiosk: 3, parking: 6, service: 4, farm_auxiliary: 4, cabin: 4
};

function numberOf(s) { const m = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(s === undefined ? '' : s).replace(',', '.')); return m ? parseFloat(m[1]) : NaN; }

// height in metres from OpenStreetMap tags
function buildingHeight(t) {
  let h = numberOf(t.height);
  if (!(h > 0)) { const lv = numberOf(t['building:levels']); if (lv > 0) h = lv * 3.2 + 1; }
  if (!(h > 0)) h = DEFAULT_H[t.building] || 6;
  return Math.max(2, Math.min(h, 200));
}

// bs: [{ ring: [[x,y],...] (closed, metres), h }]
// edges: [{ exy: [[x,y],...] }]
// returns, per edge, 13 numbers (0 to 1): the share of the street in building shadow for each hour 7 to 19
function shadowByHour(bs, edges, lat, lon, date) {
  const out = edges.map(function () { return new Array(HOURS.length).fill(0); });
  if (!bs.length) return out;
  const cell = 30;
  HOURS.forEach(function (hr, hi) {
    const sp = sunPosition(lat, lon, date, hr);
    if (sp.el < 3) return;                                   // sun at or below the horizon: no sun load anyway
    const ratio = 1 / Math.tan(sp.el * Math.PI / 180);
    const dx = -Math.sin(sp.az * Math.PI / 180), dy = -Math.cos(sp.az * Math.PI / 180);
    const grid = new Map();
    const shapes = [];
    bs.forEach(function (b) {
      const L = Math.min(MAX_SHADOW, b.h * ratio);
      if (L < 1) return;
      const vx = dx * L, vy = dy * L;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      b.ring.forEach(function (p) {
        x0 = Math.min(x0, p[0], p[0] + vx); x1 = Math.max(x1, p[0], p[0] + vx);
        y0 = Math.min(y0, p[1], p[1] + vy); y1 = Math.max(y1, p[1], p[1] + vy);
      });
      const id = shapes.push({ r: b.ring, vx: vx, vy: vy }) - 1;
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
        const k = i + ',' + j; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(id);
      }
    });
    edges.forEach(function (e, ei) {
      const pts = samples(e.exy);
      if (!pts.length) return;
      let sl = 0, sr = 0;
      pts.forEach(function (p) {
        if (inShadow(p[0] + p[2] * SIDE, p[1] + p[3] * SIDE, grid, shapes, cell)) sl++;
        if (inShadow(p[0] - p[2] * SIDE, p[1] - p[3] * SIDE, grid, shapes, cell)) sr++;
      });
      // a walker can use the shadier pavement
      out[ei][hi] = Math.max(sl, sr) / pts.length;
    });
  });
  return out;
}

// points along a polyline every STEP metres: [x, y, normalX, normalY]
function samples(xy) {
  const out = [];
  for (let i = 1; i < xy.length; i++) {
    const ax = xy[i - 1][0], ay = xy[i - 1][1], bx = xy[i][0], by = xy[i][1];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 0.01) continue;
    const nx = -(by - ay) / l, ny = (bx - ax) / l;
    const n = Math.max(1, Math.round(l / STEP));
    for (let k = 0; k < n; k++) { const d = l * (k + 0.5) / n; out.push([ax + (bx - ax) * d / l, ay + (by - ay) * d / l, nx, ny]); }
  }
  return out;
}

function inShadow(x, y, grid, shapes, cell) {
  const a = grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell));
  if (!a) return false;
  for (let k = 0; k < a.length; k++) {
    const s = shapes[a[k]];
    if (inPoly(x, y, s.r)) continue;                        // inside the footprint itself: not a street, ignore
    if (inPoly(x - s.vx, y - s.vy, s.r)) return true;       // under the far end of the shadow
    for (let i = 1; i < s.r.length; i++) {
      const p = s.r[i - 1], q = s.r[i];
      if (inQuad(x, y, p[0], p[1], q[0], q[1], s.vx, s.vy)) return true;
    }
  }
  return false;
}

function inPoly(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}
// the parallelogram a, b, b+v, a+v
function inQuad(x, y, ax, ay, bx, by, vx, vy) {
  const ex = bx - ax, ey = by - ay;
  const det = ex * vy - ey * vx;
  if (Math.abs(det) < 1e-9) return false;
  const px = x - ax, py = y - ay;
  const s = (px * vy - py * vx) / det, t = (ex * py - ey * px) / det;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

module.exports = { shadowByHour: shadowByHour, buildingHeight: buildingHeight, HOURS: HOURS, inPoly: inPoly };
