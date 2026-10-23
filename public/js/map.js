'use strict';
// A small map drawn on a <canvas>: picture tiles underneath, then roads coloured by flood status,
// shade, trees, the two routes, landmarks and pins on top. Drag to pan, wheel or pinch to zoom, tap to pick.
// It needs no library. Without tile pictures (the sample township) it draws on a plain background.

(function (root) {
  const TILE = 256, MIN_Z = 5, MAX_Z = 19;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function lonToX(lon) { return (lon + 180) / 360; }
  function latToY(lat) {
    const s = clamp(Math.sin(lat * Math.PI / 180), -0.9999, 0.9999);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function xToLon(x) { return x * 360 - 180; }
  function yToLat(y) { const n = Math.PI - 2 * Math.PI * y; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  function create(box, handlers) {
    const canvas = box.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const attrib = box.querySelector('.map-attrib');
    const view = { x: 0.5, y: 0.5, z: 5 };
    let W = 300, H = 300, dpr = 1;
    let geo = null;               // the current township, in map coordinates
    let tiles = null;             // { url, maxZoom }
    const cache = new Map();
    let queued = false;
    const st = { status: null, std: null, teduh: null, primary: 'teduh', markers: [], pin: null, me: null, trail: null, paths: [], draft: null, selPath: null, legs: [] };

    // ---------- data ----------

    function toWorld(lat, lon) { return [lonToX(lon), latToY(lat)]; }

    function setGraph(G) {
      const ds = G.ds;
      geo = {
        G: G,
        nodes: G.nodes.map(function (p) { return toWorld(p[0], p[1]); }),
        edges: G.edges.map(function (e) {
          const w = e.pts.map(function (p) { return toWorld(p[0], p[1]); });
          let x0 = 2, y0 = 2, x1 = -1, y1 = -1;
          w.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
          return { e: e, w: w, bb: [x0, y0, x1, y1] };
        }),
        places: G.places.map(function (p) { return { p: p, w: toWorld(p.lat, p.lon) }; }),
        trees: (ds.trees || []).map(function (t) { return toWorld(t[0], t[1]); }),
        decor: ds.decor ? {
          river: ds.decor.river.map(function (p) { return toWorld(p[0], p[1]); }),
          park: { c: toWorld(ds.decor.park.lat, ds.decor.park.lon), rx: ds.decor.park.rx / 360, ry: ds.decor.park.ry / 360 }
        } : null
      };
      st.std = st.teduh = null; st.pin = null; st.from = st.to = -1;
    }

    function fit() {
      if (!geo || !geo.nodes.length) return;
      if (box.isConnected) resize();   // measure now: the size observer can lag behind (for example while a video is playing)
      // Ignore stray far-away points: keep nodes within 4x the median distance of the median centre.
      const xs = geo.nodes.map(function (p) { return p[0]; }).sort(function (a, b) { return a - b; });
      const ys = geo.nodes.map(function (p) { return p[1]; }).sort(function (a, b) { return a - b; });
      const mx = xs[xs.length >> 1], my = ys[ys.length >> 1];
      const ds = geo.nodes.map(function (p) { return Math.hypot(p[0] - mx, p[1] - my); }).sort(function (a, b) { return a - b; });
      const lim = Math.max(ds[ds.length >> 1] * 4, 1e-6);
      let x0 = 2, y0 = 2, x1 = -1, y1 = -1;
      geo.nodes.forEach(function (p) {
        if (Math.hypot(p[0] - mx, p[1] - my) > lim) return;
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
      });
      const w = Math.max(x1 - x0, 1e-7), h = Math.max(y1 - y0, 1e-7), pad = 24;
      view.z = clamp(Math.log2(Math.min((W - 2 * pad) / (w * TILE), (H - 2 * pad) / (h * TILE))), MIN_Z, MAX_Z - 1);
      view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
      requestDraw();
    }

    // zoom and move so every [lat, lon] in the list is in view
    function fitPoints(list, padding) {
      if (!list || !list.length) return;
      if (box.isConnected) resize();
      let x0 = 2, y0 = 2, x1 = -1, y1 = -1;
      list.forEach(function (p) { const w = toWorld(p[0], p[1]); x0 = Math.min(x0, w[0]); y0 = Math.min(y0, w[1]); x1 = Math.max(x1, w[0]); y1 = Math.max(y1, w[1]); });
      const w = Math.max(x1 - x0, 1e-7), h = Math.max(y1 - y0, 1e-7), pad = padding || 40;
      view.z = clamp(Math.log2(Math.min((W - 2 * pad) / (w * TILE), (H - 2 * pad) / (h * TILE))), MIN_Z, MAX_Z - 1);
      view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
      requestDraw();
    }

    function setTiles(t, attributionText) {
      const next = t ? { url: t.url, maxZoom: t.maxZoom || 19, veil: t.veil !== false } : null;
      if ((tiles && tiles.url) !== (next && next.url)) cache.clear();      // another picture source: forget the old tiles
      tiles = next;
      attrib.textContent = tiles ? attributionText || '' : '';
      requestDraw();
    }

    function setState(patch) { Object.assign(st, patch); if (patch.paths) st.paths.forEach(function (p) { delete p.w; }); requestDraw(); }

    // ---------- tiles ----------

    function getTile(z, x, y) {
      const key = z + '/' + x + '/' + y;
      let img = cache.get(key);
      if (!img) {
        img = new Image();
        img.onload = requestDraw;
        img.onerror = function () { img.failed = true; };
        img.src = tiles.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        cache.set(key, img);
        if (cache.size > 400) cache.delete(cache.keys().next().value);
      }
      return img;
    }

    // ---------- drawing ----------

    function requestDraw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(draw);
    }

    function draw() {
      queued = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = function (n) { return css.getPropertyValue(n).trim(); };
      ctx.fillStyle = col('--map-bg');
      ctx.fillRect(0, 0, W, H);

      const S = TILE * Math.pow(2, view.z);
      const sx = function (wx) { return (wx - view.x) * S + W / 2; };
      const sy = function (wy) { return (wy - view.y) * S + H / 2; };
      const vx0 = view.x - W / 2 / S, vx1 = view.x + W / 2 / S, vy0 = view.y - H / 2 / S, vy1 = view.y + H / 2 / S;

      if (tiles) {
        const tz = clamp(Math.round(view.z), 0, tiles.maxZoom), n = Math.pow(2, tz), size = S / n;
        const tx0 = Math.floor(vx0 * n), tx1 = Math.floor(vx1 * n);
        const ty0 = Math.max(0, Math.floor(vy0 * n)), ty1 = Math.min(n - 1, Math.floor(vy1 * n));
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            const img = getTile(tz, ((tx % n) + n) % n, ty);
            if (img.complete && img.naturalWidth) ctx.drawImage(img, Math.floor(sx(tx / n)), Math.floor(sy(ty / n)), Math.ceil(size) + 1, Math.ceil(size) + 1);
          }
        }
        if (tiles.veil) {
          ctx.globalAlpha = 0.3;       // a light veil so the roads stand out from the picture
          ctx.fillStyle = col('--map-bg');
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }
      }
      if (!geo) return;

      const base = clamp((view.z - 13.2) * 1.35, 1.6, 9);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (geo.decor) {
        ctx.strokeStyle = col('--water'); ctx.lineWidth = base * 1.5;
        ctx.beginPath();
        geo.decor.river.forEach(function (p, i) { if (i) ctx.lineTo(sx(p[0]), sy(p[1])); else ctx.moveTo(sx(p[0]), sy(p[1])); });
        ctx.stroke();
        ctx.globalAlpha = 0.18; ctx.fillStyle = col('--canopy');
        ctx.beginPath();
        ctx.ellipse(sx(geo.decor.park.c[0]), sy(geo.decor.park.c[1]), geo.decor.park.rx * S, geo.decor.park.ry * S, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.globalAlpha = 1;
      }

      const vis = geo.edges.filter(function (g) { return g.bb[2] >= vx0 && g.bb[0] <= vx1 && g.bb[3] >= vy0 && g.bb[1] <= vy1; });
      const trace = function (g) {
        ctx.moveTo(sx(g.w[0][0]), sy(g.w[0][1]));
        for (let i = 1; i < g.w.length; i++) ctx.lineTo(sx(g.w[i][0]), sy(g.w[i][1]));
      };
      const strokeBatch = function (list, color, width, alpha, dash) {
        if (!list.length) return;
        ctx.beginPath();
        list.forEach(trace);
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
        ctx.setLineDash(dash || []);
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      };

      // shade under the roads (building shadows move with the hour the map is showing)
      const sh = function (e) { return window.Logic && window.Logic.shadeAt ? window.Logic.shadeAt(e, window.Logic.viewHour) : e.shade; };
      const canopy = col('--canopy');
      [[0.25, 0.5, 0.16], [0.5, 0.8, 0.26], [0.8, 1.01, 0.36]].forEach(function (b) {
        strokeBatch(vis.filter(function (g) { return !g.e.covered && sh(g.e) >= b[0] && sh(g.e) < b[1]; }), canopy, base + 7, b[2]);
      });
      strokeBatch(vis.filter(function (g) { return g.e.covered; }), canopy, base + 7, 0.3);

      // roads by status
      const status = st.status || function () { return 'ok'; };
      const ok = [], risk = [], flooded = [];
      vis.forEach(function (g) { const s = status(g.e); (s === 'flooded' ? flooded : s === 'risk' ? risk : ok).push(g); });
      if (tiles && !tiles.veil) strokeBatch(vis, '#ffffff', base + 2.5, 0.6);    // satellite view: a white edge keeps roads readable
      strokeBatch(ok, col('--road'), base, tiles ? 0.85 : 1);
      strokeBatch(risk, col('--road'), base, 1);
      strokeBatch(risk, col('--rain'), base, 0.3);
      strokeBatch(risk, col('--rain'), 2, 1, [4, 4]);
      strokeBatch(flooded, col('--rain'), base, 0.95);
      strokeBatch(vis.filter(function (g) { return g.e.covered; }), col('--cover'), Math.max(2, base * 0.45), 0.95);

      // trees
      if (geo.trees.length && view.z >= 15) {
        const r = clamp((view.z - 14) * 0.9, 1.4, 4);
        ctx.fillStyle = canopy; ctx.globalAlpha = 0.55;
        ctx.beginPath();
        geo.trees.forEach(function (p) {
          if (p[0] < vx0 || p[0] > vx1 || p[1] < vy0 || p[1] > vy1) return;
          const x = sx(p[0]), y = sy(p[1]);
          ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        });
        ctx.fill(); ctx.globalAlpha = 1;
      }

      // routes
      const line = function (r) {
        const pts = [];
        r.edges.forEach(function (e, i) {
          const g = geo.edges[e.idx];
          const fwd = e.a === r.nodes[i];
          const w = fwd ? g.w : g.w.slice().reverse();
          w.forEach(function (p, j) { if (!(i > 0 && j === 0)) pts.push(p); });
        });
        return pts;
      };
      const strokeLine = function (pts, color, width, dash, alpha) {
        if (!pts.length) return;
        ctx.beginPath();
        pts.forEach(function (p, i) { if (i) ctx.lineTo(sx(p[0]), sy(p[1])); else ctx.moveTo(sx(p[0]), sy(p[1])); });
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha || 1; ctx.setLineDash(dash || []);
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      };
      const drawRoute = function (r, which) {
        if (!r) return;
        const pts = line(r);
        if (which === 'teduh') { strokeLine(pts, col('--surface'), base + 5); strokeLine(pts, col('--accent'), base + 2.5); }
        else { strokeLine(pts, col('--surface'), base + 5); strokeLine(pts, col('--sun'), base + 2.5); }
      };
      const dashed = function (r, color) { if (r) strokeLine(line(r), color, base + 2, [base * 2 + 4, base + 4], 0.8); };
      const prim = st.primary === 'std' ? 'std' : 'teduh', other = prim === 'std' ? 'teduh' : 'std';
      if (st.std && st.teduh && !same(st.std, st.teduh)) dashed(st[other], other === 'std' ? col('--sun') : col('--accent'));
      drawRoute(st[prim], prim);
      if (st.trail && st.trail.length > 1) {
        strokeLine(st.trail.map(function (p) { return toWorld(p[0], p[1]); }), col('--muted'), base + 2.5, null, 0.9);
      }

      // the gap between a pin and the nearest road, when the pin is off the road network
      (st.legs || []).forEach(function (l) {
        const a = toWorld(l[0], l[1]), b = toWorld(l[2], l[3]);
        ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1]));
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = '#475569'; ctx.lineWidth = 2.5; ctx.setLineDash([2, 6]); ctx.lineCap = 'round'; ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
      });
      // resident-traced paths: dashed amber until verified, solid green once verified
      const worldOf = function (p) { return p.w || (p.w = p.pts.map(function (q) { return toWorld(q[0], q[1]); })); };
      (st.paths || []).forEach(function (p) {
        const w = worldOf(p);
        const strokeW = function (color, width, dash, alpha) {
          ctx.beginPath();
          w.forEach(function (q, i) { if (i) ctx.lineTo(sx(q[0]), sy(q[1])); else ctx.moveTo(sx(q[0]), sy(q[1])); });
          ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        };
        if (st.selPath === p.id) strokeW('#2563EB', base + 9, null, 0.35);
        strokeW('#ffffff', base + 5);
        if (p.status === 'verified') strokeW('#15803D', base + 2.5, p.connected === false ? [3, 5] : null);
        else strokeW('#D97706', base + 2.5, [base * 1.6 + 3, base + 3]);
      });
      // the path being traced
      if (st.draft && st.draft.pts && st.draft.pts.length) {
        const dw = st.draft.pts.map(function (q) { return toWorld(q[0], q[1]); });
        if (dw.length > 1) {
          ctx.beginPath(); dw.forEach(function (q, i) { if (i) ctx.lineTo(sx(q[0]), sy(q[1])); else ctx.moveTo(sx(q[0]), sy(q[1])); });
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = base + 5; ctx.stroke();
          ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = base + 2.5; ctx.setLineDash([base * 1.6 + 3, base + 3]); ctx.stroke(); ctx.setLineDash([]);
        }
        dw.forEach(function (q, i) {
          const x = sx(q[0]), y = sy(q[1]), end = i === 0 || i === dw.length - 1;
          ctx.fillStyle = (st.draft.snapped && st.draft.snapped[i]) ? '#15803D' : '#ffffff'; ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, end ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      }

      // report markers: each kind of problem has its own symbol
      const rainCol = col('--rain'), warnCol = col('--warn');
      function badge(x, y, fill, glyph) {
        ctx.fillStyle = fill; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        glyph(x, y);
      }
      const glyphs = {
        'Flooded road': function (x, y) {   // water drop
          ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.bezierCurveTo(x + 6, y + 1, x + 5, y + 6, x, y + 6); ctx.bezierCurveTo(x - 5, y + 6, x - 6, y + 1, x, y - 6); ctx.fill();
        },
        'Water rising': function (x, y) {   // arrow up over a wave
          ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 6); ctx.moveTo(x - 4, y - 2); ctx.lineTo(x, y - 6); ctx.lineTo(x + 4, y - 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 6, y + 6); ctx.quadraticCurveTo(x - 3, y + 3, x, y + 6); ctx.quadraticCurveTo(x + 3, y + 9, x + 6, y + 6); ctx.stroke();
        },
        'Standing water': function (x, y) {   // puddle
          ctx.beginPath(); ctx.ellipse(x, y + 1, 6.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        },
        'Blocked drain': function (x, y) {   // grate
          ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(x - 5, y - 4); ctx.lineTo(x + 5, y - 4); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x + 5, y + 4); ctx.stroke();
        },
        'Fallen branch': function (x, y) {   // branch
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x - 6, y + 5); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x - 1, y + 1); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 2, y - 2); ctx.lineTo(x - 2, y - 6); ctx.stroke();
        }
      };
      const order = ['Flooded road', 'Water rising', 'Blocked drain', 'Standing water', 'Fallen branch'];
      const fills = { 'Flooded road': rainCol, 'Water rising': rainCol, 'Standing water': rainCol, 'Blocked drain': warnCol, 'Fallen branch': col('--accent') };
      geo.edges.forEach(function (g) {
        const kinds = g.e.reports.slice();
        if (g.e.blocked && kinds.indexOf('Blocked drain') < 0) kinds.push('Blocked drain');
        if (!kinds.length) return;
        const k = Math.floor((g.w.length - 1) / 2), m = [(g.w[k][0] + g.w[k + 1][0]) / 2, (g.w[k][1] + g.w[k + 1][1]) / 2];   // middle of the road, not a junction
        if (m[0] < vx0 || m[0] > vx1 || m[1] < vy0 || m[1] > vy1) return;
        const x = sx(m[0]), y = sy(m[1]);
        const shown = order.filter(function (k) { return kinds.indexOf(k) >= 0; }).slice(0, 2);   // most serious first
        shown.forEach(function (k, n) { badge(x + (n - (shown.length - 1) / 2) * 24, y, fills[k], glyphs[k]); });
        if (kinds.length > shown.length) {
          ctx.fillStyle = col('--ink'); ctx.font = '700 11px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('+' + (kinds.length - shown.length), x + shown.length * 12 + 10, y - 12); ctx.textAlign = 'start';
        }
      });

      // landmarks
      ctx.font = '600 12px Figtree, "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      geo.places.forEach(function (q) {
        const x = sx(q.w[0]), y = sy(q.w[1]);
        if (x < -40 || x > W + 40 || y < -20 || y > H + 20) return;
        ctx.fillStyle = col('--surface'); ctx.strokeStyle = col('--ink'); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (view.z >= 14.2) {
          ctx.lineWidth = 3.5; ctx.strokeStyle = col('--map-bg'); ctx.lineJoin = 'round';
          ctx.strokeText(q.p.name, x + 10, y);
          ctx.fillStyle = col('--ink'); ctx.fillText(q.p.name, x + 10, y);
        }
      });

      // start and destination
      (st.markers || []).forEach(function (m) {
        const w = toWorld(m.lat, m.lon), x = sx(w[0]), y = sy(w[1]);
        if (m.label === 'B') {
          ctx.fillStyle = col('--warn'); ctx.strokeStyle = col('--surface'); ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - 15, y - 14, x - 12, y - 34, x, y - 34); ctx.bezierCurveTo(x + 12, y - 34, x + 15, y - 14, x, y);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = '700 12px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('B', x, y - 21); ctx.textAlign = 'start';
        } else {
          ctx.fillStyle = col('--accent'); ctx.strokeStyle = col('--surface'); ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = col('--accent-ink'); ctx.font = '700 12px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('A', x, y + 0.5); ctx.textAlign = 'start';
        }
      });

      // where you are (the blue dot, its accuracy circle and the way you are facing)
      if (st.me) {
        const w = toWorld(st.me.lat, st.me.lon), x = sx(w[0]), y = sy(w[1]);
        const mpp = 40075016.686 * Math.cos(st.me.lat * Math.PI / 180) / S;     // metres per pixel
        const ar = clamp((st.me.acc || 0) / mpp, 0, 160);
        ctx.fillStyle = '#2563EB'; ctx.globalAlpha = 0.14;
        ctx.beginPath(); ctx.arc(x, y, Math.max(ar, 10), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        if (st.me.heading !== null && st.me.heading !== undefined && Number.isFinite(st.me.heading)) {
          const a = (st.me.heading - 90) * Math.PI / 180;
          ctx.fillStyle = '#2563EB'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24);
          ctx.lineTo(x + Math.cos(a + 2.5) * 12, y + Math.sin(a + 2.5) * 12); ctx.lineTo(x + Math.cos(a - 2.5) * 12, y + Math.sin(a - 2.5) * 12);
          ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 9.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2563EB'; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
      }

      // the spot chosen for a report
      if (st.pin) {
        const p = toWorld(st.pin.lat, st.pin.lon), x = sx(p[0]), y = sy(p[1]);
        ctx.fillStyle = col('--warn'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - 14, y - 14, x - 10, y - 30, x, y - 30); ctx.bezierCurveTo(x + 10, y - 30, x + 14, y - 14, x, y);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 19, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    function same(a, b) {
      return a.edges.length === b.edges.length && a.edges.every(function (e, i) { return e === b.edges[i]; });
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    // ---------- picking ----------

    function scale() { return TILE * Math.pow(2, view.z); }
    function toLatLon(px, py) {
      const S = scale();
      return { lat: yToLat(view.y + (py - H / 2) / S), lon: xToLon(view.x + (px - W / 2) / S) };
    }
    // what is under a point on the screen: the nearest road (within 24 px) and the nearest landmark (within 18 px)
    function hit(px, py, reach) {
      const out = toLatLon(px, py);
      if (!geo) return out;
      const S = scale();
      const sx = function (wx) { return (wx - view.x) * S + W / 2; }, sy = function (wy) { return (wy - view.y) * S + H / 2; };
      let bd = reach || 24;
      geo.edges.forEach(function (g) {
        for (let i = 1; i < g.w.length; i++) {
          const ax = sx(g.w[i - 1][0]), ay = sy(g.w[i - 1][1]), bx = sx(g.w[i][0]), by = sy(g.w[i][1]);
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          if (d < bd) { bd = d; out.edge = g.e; }
        }
      });
      let qd = 22;
      (st.paths || []).forEach(function (p) {
        const w = p.w || (p.w = p.pts.map(function (q) { return toWorld(q[0], q[1]); }));
        for (let i = 1; i < w.length; i++) {
          const ax = sx(w[i - 1][0]), ay = sy(w[i - 1][1]), bx = sx(w[i][0]), by = sy(w[i][1]);
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          if (d < qd) { qd = d; out.pathId = p.id; }
        }
      });
      let pd = 18;
      geo.places.forEach(function (q) { const d = Math.hypot(px - sx(q.w[0]), py - sy(q.w[1])); if (d < pd) { pd = d; out.place = q.p; } });
      return out;
    }

    // ---------- moving ----------

    function zoomAt(px, py, dz) {
      const S = scale();
      const wx = view.x + (px - W / 2) / S, wy = view.y + (py - H / 2) / S;
      view.z = clamp(view.z + dz, MIN_Z, MAX_Z);
      const S2 = scale();
      view.x = wx - (px - W / 2) / S2; view.y = wy - (py - H / 2) / S2;
      clampView(); requestDraw();
    }
    function moved() { if (handlers && handlers.onUserMove) handlers.onUserMove(); }
    function panBy(dx, dy) { const S = scale(); view.x -= dx / S; view.y -= dy / S; clampView(); requestDraw(); }
    function clampView() { view.x = clamp(view.x, 0, 1); view.y = clamp(view.y, 0.01, 0.99); }

    const pointers = new Map();
    let down = null, pinch = null;
    function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 1) down = { x: pos(e).x, y: pos(e).y, t: Date.now(), moved: false, touch: e.pointerType !== 'mouse' };
      if (pointers.size === 2) {
        const p = Array.from(pointers.values());
        pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
        if (down) down.moved = true;
      }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId), now = pos(e);
      pointers.set(e.pointerId, now);
      if (pointers.size >= 2 && pinch) {
        const p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (pinch.d > 0 && d > 0) { zoomAt((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, Math.log2(d / pinch.d)); moved(); }
        pinch.d = d;
      } else if (down) {
        if (Math.hypot(now.x - down.x, now.y - down.y) > (down.touch ? 14 : 6)) down.moved = true;   // a finger wobbles more than a mouse
        if (down.moved) { panBy(now.x - prev.x, now.y - prev.y); canvas.style.cursor = 'grabbing'; moved(); }
      }
    });
    function release(e) {
      const wasTap = down && !down.moved && Date.now() - down.t < 1200 && pointers.size === 1 && e.type === 'pointerup';
      const where = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) { canvas.style.cursor = ''; if (wasTap && where && handlers && handlers.onTap) handlers.onTap(hit(where.x, where.y, down.touch ? 34 : 24)); down = null; }
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      const p = pos(e);
      zoomAt(p.x, p.y, clamp(-e.deltaY * 0.0018, -0.6, 0.6)); moved();
    }, { passive: false });
    canvas.addEventListener('dblclick', function (e) { const p = pos(e); zoomAt(p.x, p.y, 1); moved(); });
    canvas.addEventListener('keydown', function (e) {
      const k = e.key;
      if (k === 'ArrowLeft') panBy(60, 0); else if (k === 'ArrowRight') panBy(-60, 0);
      else if (k === 'ArrowUp') panBy(0, 60); else if (k === 'ArrowDown') panBy(0, -60);
      else if (k === '+' || k === '=') zoomAt(W / 2, H / 2, 0.5); else if (k === '-') zoomAt(W / 2, H / 2, -0.5);
      else return;
      moved();
      e.preventDefault();
    });
    box.querySelectorAll('[data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () { zoomAt(W / 2, H / 2, Number(b.getAttribute('data-zoom'))); moved(); });
    });

    // ---------- size ----------

    function resize() {
      const r = box.getBoundingClientRect();
      W = Math.max(100, Math.round(r.width)); H = Math.max(100, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      requestDraw();
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(box); else window.addEventListener('resize', resize);
    // colours follow the light and dark theme
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestDraw);
    resize();

    return {
      setView: function (lat, lon, z) { view.x = lonToX(lon); view.y = latToY(lat); if (z !== undefined) view.z = clamp(z, MIN_Z, MAX_Z); clampView(); requestDraw(); },
      fitPoints: fitPoints,
      setGraph: setGraph, fit: fit, setTiles: setTiles, setState: setState, redraw: requestDraw, hit: hit,
      center: function () { return { lat: yToLat(view.y), lon: xToLon(view.x), z: view.z }; },
      size: function () { return { w: W, h: H }; },
      project: function (lat, lon) { const S = scale(), w = toWorld(lat, lon); return { x: (w[0] - view.x) * S + W / 2, y: (w[1] - view.y) * S + H / 2 }; }
    };
  }

  root.TMap = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
