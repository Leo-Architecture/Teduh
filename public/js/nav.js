'use strict';
// Walking navigation maths: turn a route into a line, snap a GPS fix onto it, and write the turn-by-turn steps.
// Pure functions on plain data. Positions are [lat, lon]; distances are metres.

(function (root) {
  const R = 6371000, RAD = Math.PI / 180;

  function dist(a, b) {
    const k = Math.cos((a[0] + b[0]) / 2 * RAD);
    return Math.hypot((b[0] - a[0]) * RAD * R, (b[1] - a[1]) * RAD * R * k);
  }
  function bearing(a, b) {                 // degrees clockwise from north, 0 to 360
    const k = Math.cos(a[0] * RAD);
    const y = (b[1] - a[1]) * k, x = b[0] - a[0];
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  function angleDiff(a, b) {               // signed, -180..180 (positive = turn right)
    let d = (b - a + 540) % 360 - 180;
    return d;
  }
  function compass(deg) { return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]; }

  // The route as one line of [lat, lon] points, with the distance from the start to each point.
  // `r` is { nodes, edges } from Logic.route, `G` is the graph. Each edge has pts [[lat, lon], ...].
  function routeLine(G, r) {
    const pts = [], roadAt = [];
    if (!r) return { pts: pts, cum: [], total: 0, parts: [] };
    const parts = [];
    r.edges.forEach(function (e, i) {
      const fwd = e.a === r.nodes[i];
      const w = fwd ? e.pts : e.pts.slice().reverse();
      const startIdx = pts.length ? pts.length - 1 : 0;
      w.forEach(function (p, j) { if (!(pts.length && j === 0)) pts.push([p[0], p[1]]); });
      parts.push({ edge: e, from: startIdx, to: pts.length - 1 });
    });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts: pts, cum: cum, total: cum[cum.length - 1] || 0, parts: parts };
  }

  // The nearest spot on the line to a GPS fix: how far along the line it is, how far off the line, and where.
  function snap(line, lat, lon) {
    const p = [lat, lon];
    let best = { along: 0, off: Infinity, at: line.pts[0] || p, i: 0 };
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      const k = Math.cos(a[0] * RAD);
      const ax = 0, ay = 0, bx = (b[1] - a[1]) * RAD * R * k, by = (b[0] - a[0]) * RAD * R;
      const px = (lon - a[1]) * RAD * R * k, py = (lat - a[0]) * RAD * R;
      const l2 = bx * bx + by * by;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / l2)) : 0;
      const off = Math.hypot(px - t * bx, py - t * by);
      if (off < best.off) best = { along: line.cum[i - 1] + t * Math.sqrt(l2), off: off, at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i: i };
    }
    return best;
  }

  // The point that is `d` metres along the line.
  function pointAt(line, d) {
    if (!line.pts.length) return null;
    d = Math.max(0, Math.min(line.total, d));
    for (let i = 1; i < line.pts.length; i++) {
      if (line.cum[i] >= d) {
        const seg = line.cum[i] - line.cum[i - 1] || 1, t = (d - line.cum[i - 1]) / seg, a = line.pts[i - 1], b = line.pts[i];
        return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, heading: bearing(a, b) };
      }
    }
    const last = line.pts[line.pts.length - 1], prev = line.pts[Math.max(0, line.pts.length - 2)];
    return { lat: last[0], lon: last[1], heading: bearing(prev, last) };
  }
  // The part of the line from the start up to `d` metres (to draw the part already walked).
  function lineUpTo(line, d) {
    const out = [];
    for (let i = 0; i < line.pts.length; i++) {
      if (line.cum[i] <= d) out.push(line.pts[i]); else break;
    }
    const p = pointAt(line, d);
    if (p) out.push([p.lat, p.lon]);
    return out;
  }

  function turnKind(delta) {
    const a = Math.abs(delta);
    if (a < 20) return 'straight';
    if (a < 55) return delta > 0 ? 'slight-right' : 'slight-left';
    if (a < 135) return delta > 0 ? 'right' : 'left';
    return 'uturn';
  }
  const WORDS = { straight: 'Continue', 'slight-right': 'Bear right', 'slight-left': 'Bear left', right: 'Turn right', left: 'Turn left', uturn: 'Make a U-turn' };

  // Turn-by-turn steps: [{ kind, text, road, at, len }]. `at` is how far from the start the step begins.
  function steps(line, destName) {
    const out = [];
    if (!line.parts.length) return out;
    // merge neighbouring edges that share a road name
    const groups = [];
    line.parts.forEach(function (p) {
      const g = groups[groups.length - 1];
      if (g && g.road === p.edge.road) { g.to = p.to; g.len += line.cum[p.to] - line.cum[p.from]; g.covered = g.covered && p.edge.covered; }
      else groups.push({ road: p.edge.road, from: p.from, to: p.to, len: line.cum[p.to] - line.cum[p.from], covered: !!p.edge.covered });
    });
    const first = groups[0];
    const h0 = bearing(line.pts[first.from], line.pts[Math.min(first.from + 1, line.pts.length - 1)]);
    out.push({ kind: 'depart', text: 'Head ' + compass(h0) + ' on ' + first.road, road: first.road, at: 0, len: first.len, heading: h0 });
    for (let i = 1; i < groups.length; i++) {
      const prev = groups[i - 1], g = groups[i];
      const pa = line.pts[Math.max(prev.from, prev.to - 1)], pb = line.pts[prev.to];
      const qa = line.pts[g.from], qb = line.pts[Math.min(g.from + 1, line.pts.length - 1)];
      const delta = angleDiff(bearing(pa, pb), bearing(qa, qb));
      const kind = turnKind(delta);
      out.push({
        kind: kind,
        text: kind === 'uturn' ? 'Make a U-turn onto ' + g.road : WORDS[kind] + (kind === 'straight' ? ' onto ' : ' onto ') + g.road,
        road: g.road, at: line.cum[g.from], len: g.len, heading: bearing(qa, qb)
      });
    }
    out.push({ kind: 'arrive', text: destName ? 'Arrive at ' + destName : 'You have arrived', road: '', at: line.total, len: 0 });
    return out;
  }

  // Which step is the walker on, and how far is it to the next one.
  function progress(stepsList, along) {
    let k = 0;
    for (let i = 0; i < stepsList.length; i++) if (stepsList[i].at <= along + 1) k = i;
    const next = stepsList[Math.min(k + 1, stepsList.length - 1)];
    return { index: k, now: stepsList[k], next: next, toNext: Math.max(0, next.at - along) };
  }

  function metres(m) { return m < 1000 ? Math.max(0, Math.round(m / 5) * 5) + ' m' : (m / 1000).toFixed(1) + ' km'; }

  root.Nav = {
    dist: dist, bearing: bearing, angleDiff: angleDiff, compass: compass, routeLine: routeLine, snap: snap, pointAt: pointAt,
    lineUpTo: lineUpTo, turnKind: turnKind, steps: steps, progress: progress, metres: metres
  };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Nav;
