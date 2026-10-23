'use strict';
// Local stand-ins for the outside services (OpenStreetMap, Open-Meteo, Supabase, Gemini, Claude),
// so the whole app can be tested without internet or real keys.
// They check that requests have the headers and shape the real services expect.
//
//   const mock = await startMock(0);   // port 0 = any free port
//   mock.url, mock.log (every request), mock.fail (set a service to fail), mock.stop()

const http = require('http');

// A small made-up neighbourhood in OpenStreetMap's JSON format, near Putra Heights.
// "YYYY-MM-DDTHH:00" for the current hour in Malaysia time and the next n-1 hours
function klHours(n) {
  const base = Math.floor(Date.now() / 3600000) * 3600000, out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 3600000 + 8 * 3600000), z = function (x) { return (x < 10 ? '0' : '') + x; };
    out.push(d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + ':00');
  }
  return out;
}

function osmFixture(lat0, lon0) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const ll = function (x, y) { return { lat: lat0 + y / ky, lon: lon0 + x / kx }; };
  const elements = [];
  let nodeId = 1000;
  const nid = new Map();
  function node(x, y) { const k = x + ',' + y; if (!nid.has(k)) nid.set(k, nodeId++); return nid.get(k); }
  function way(id, tags, pts) {
    elements.push({ type: 'way', id: id, nodes: pts.map(function (p) { return node(p[0], p[1]); }), geometry: pts.map(function (p) { return ll(p[0], p[1]); }), tags: tags });
  }
  // a 4 x 4 grid of streets, 120 m apart; every street has a node where it crosses the others
  const xs = [-180, -60, 60, 180], ys = [-180, -60, 60, 180];
  const line = function (fixed, horizontal) {
    const pts = [];
    [-240, -180, -120, -60, 0, 60, 120, 180, 240].forEach(function (t) { pts.push(horizontal ? [t, fixed] : [fixed, t]); });
    return pts;
  };
  ys.forEach(function (y, i) { way(100 + i, { highway: 'residential', name: 'Jalan Seri ' + (i + 1), lit: i % 2 ? 'yes' : undefined, sidewalk: 'both' }, line(y, true)); });
  xs.forEach(function (x, i) { way(200 + i, { highway: i === 0 ? 'tertiary' : 'residential', name: 'Lorong Pokok ' + (i + 1) }, line(x, false)); });
  // a covered shop-lot walkway, a flight of steps, a footpath, a street whose name tries to inject HTML
  way(300, { highway: 'footway', covered: 'yes' }, [[-60, 60], [-20, 60], [20, 60], [60, 60]].map(function (p) { return [p[0], p[1] + 0]; }));
  way(301, { highway: 'steps' }, [[60, -60], [60, -60 + 0.0001]].map(function (p, i) { return i ? [60, -52] : p; }));
  way(302, { highway: 'footway', name: '<img src=x onerror=alert(1)>' }, [[180, -60], [200, -80], [220, -100]]);
  way(303, { highway: 'motorway', name: 'Lebuhraya' }, [[-300, 300], [300, 300]]);
  way(304, { highway: 'footway', foot: 'no', name: 'No foot' }, [[0, 0], [10, 10]]);
  // trees: dense along Jalan Seri 2 (y = -60), none elsewhere
  for (let x = -230; x <= 230; x += 10) { const p = ll(x, -55); elements.push({ type: 'node', id: nodeId++, lat: p.lat, lon: p.lon }); }
  // a tall building (20 m) just south of Jalan Seri 3 (y = 60), and a small shed far from any street shade test
  const bld = function (id, tags, x0, y0, x1, y1) { const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]; elements.push({ type: 'way', id: id, tags: tags, nodes: pts.map(function (p) { return node(p[0], p[1]); }), geometry: pts.map(function (p) { return ll(p[0], p[1]); }) }); };
  bld(600, { building: 'commercial', height: '20' }, -30, 48, 0, 56);
  // a drain close to Lorong Pokok 4 (x = 180)
  elements.push({ type: 'way', id: 400, tags: { waterway: 'drain' }, nodes: [1, 2], geometry: [ll(185, -240), ll(185, 240)] });
  // landmarks
  const poi = function (id, tags, x, y) { const c = ll(x, y); elements.push({ type: 'node', id: id, lat: c.lat, lon: c.lon, tags: tags }); };
  poi(501, { amenity: 'school', name: 'SK Putra Heights' }, -180, 180);
  poi(502, { amenity: 'clinic', name: 'Klinik Seri' }, 180, 180);
  poi(503, { shop: 'supermarket', name: 'Seri Mart' }, -180, -180);
  poi(504, { leisure: 'park', name: 'Taman Pokok' }, 180, -180);
  poi(505, { amenity: 'marketplace', name: 'Pasar Pagi' }, 0, 60);
  elements.push({ type: 'way', id: 506, center: ll(60, 60), tags: { amenity: 'place_of_worship', name: 'Surau Seri' } });
  return { version: 0.6, elements: elements };
}

function startMock(port) {
  const log = [];
  const fail = {};
  const supa = { rows: [], seq: 1 };
  let overpassHits = 0;

  function reply(res, status, body) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
    res.end(data);
  }
  function readBody(req) {
    return new Promise(function (resolve) {
      const chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
  }

  const server = http.createServer(async function (req, res) {
    const url = new URL(req.url, 'http://localhost');
    const body = await readBody(req);
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body };
    log.push(entry);
    const p = url.pathname;
    const svc = p.split('/')[1];
    if (fail[svc]) return reply(res, fail[svc], { error: { message: 'forced failure' } });

    if (p === '/overpass/interpreter') {
      overpassHits++;
      const m = /around:(\d+),([\d.-]+),([\d.-]+)/.exec(decodeURIComponent(body.replace(/^data=/, '')));
      if (!m || !/\[out:json\]/.test(decodeURIComponent(body))) return reply(res, 400, 'bad query');
      return reply(res, 200, osmFixture(Number(m[2]), Number(m[3])));
    }
    if (p === '/nominatim/search') {
      if (!/Teduh/.test(String(req.headers['user-agent']))) return reply(res, 403, 'no user agent');
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (q.indexOf('nowhere') !== -1) return reply(res, 200, []);
      return reply(res, 200, [{ name: 'Putra Heights', display_name: 'Putra Heights, Subang Jaya, Selangor, Malaysia', lat: '3.0000', lon: '101.5700' }]);
    }
    if (p === '/geocoding/v1/search') {
      return reply(res, 200, { results: [{ name: 'Putra Heights', admin1: 'Selangor', admin2: 'Petaling', latitude: 3.0, longitude: 101.57 }] });
    }
    if (p === '/forecast') {
      const hours = klHours(24);
      const rain = [12.5, 30, 45, 5, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const code = [81, 95, 95, 61, 2, 2, 1, 3, 2, 1, 0, 0, 0, 1, 2, 2, 3, 3, 2, 1, 0, 0, 1, 2];
      const pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
      const day = hours[0].slice(0, 10), next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1));
      const nextDay = next.getUTCFullYear() + '-' + pad2(next.getUTCMonth() + 1) + '-' + pad2(next.getUTCDate());
      return reply(res, 200, {
        timezone: 'Asia/Kuala_Lumpur',
        current: { time: hours[0], temperature_2m: 29.4, apparent_temperature: 36.1, relative_humidity_2m: 78, precipitation: 12.5, weather_code: 81, cloud_cover: 80, wind_speed_10m: 11, wind_gusts_10m: 32, is_day: 1 },
        hourly: {
          time: hours, temperature_2m: hours.map(function (t, i) { return 29 - (i > 8 ? (i - 8) * 0.4 : 0); }), apparent_temperature: hours.map(function () { return 36; }),
          precipitation_probability: rain.map(function (r) { return r > 0 ? 80 : 10; }), precipitation: rain, weather_code: code,
          wind_gusts_10m: hours.map(function () { return 30; }), uv_index: hours.map(function (t, i) { return [6.5, 4, 2, 0.5][i] === undefined ? 1 : [6.5, 4, 2, 0.5][i]; }), visibility: hours.map(function () { return 20000; })
        },
        daily: { time: [day, nextDay], sunrise: [day + 'T07:00', nextDay + 'T07:00'], sunset: [day + 'T19:00', nextDay + 'T19:00'] }
      });
    }
    if (p === '/airquality/v1/air-quality') {
      const hours = klHours(24);
      return reply(res, 200, { current: { time: hours[0], us_aqi: 112, pm2_5: 41, pm10: 60 }, hourly: { time: hours, us_aqi: hours.map(function () { return 112; }) } });
    }
    if (p === '/elevation') {
      const lats = String(url.searchParams.get('latitude')).split(',').map(Number);
      const lons = String(url.searchParams.get('longitude')).split(',').map(Number);
      // the east side is lower, the west side higher
      const minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
      return reply(res, 200, { elevation: lons.map(function (lo, i) { return 30 - 10 * (lo - minLon) / ((maxLon - minLon) || 1) + (lats[i] > 0 ? 0 : 0); }) });
    }

    if (p === '/supabase/rest/v1/reports') {
      if (req.headers.apikey !== 'sb-test-key' || req.headers.authorization !== 'Bearer sb-test-key') return reply(res, 401, { message: 'Invalid API key' });
      if (req.method === 'GET') {
        let rows = supa.rows.filter(function (r) { return !r.cleared; });
        return reply(res, 200, rows);
      }
      if (req.method === 'POST') {
        const b = JSON.parse(body);
        supa.rows.push(Object.assign({ id: 'row-' + supa.seq++, cleared: false, created_at: new Date().toISOString() }, b));
        return reply(res, 201, '');
      }
      if (req.method === 'PATCH') {
        const b = JSON.parse(body);
        const edge = url.searchParams.get('edge_id');
        const want = edge ? edge.replace(/^eq\./, '') : null;
        const tf = /^not\.in\.\((.*)\)$/.exec(url.searchParams.get('type') || ''), keep = tf ? tf[1].split(',').map(function (x) { return x.replace(/^"|"$/g, ''); }) : [];
        supa.rows.forEach(function (r) { if (!r.cleared && (want === null || r.edge_id === want) && keep.indexOf(r.type) === -1) r.cleared = b.cleared; });
        return reply(res, 204, '');
      }
    }

    if (p === '/iqair/v2/nearest_city') {
      if (url.searchParams.get('key') !== 'iq-test') return reply(res, 401, { status: 'fail', data: { message: 'incorrect_api_key' } });
      return reply(res, 200, { status: 'success', data: { city: 'Subang Jaya', state: 'Selangor', country: 'Malaysia', current: { weather: { ts: 'x', tp: 31, pr: 1008, hu: 70, ws: 2.5, wd: 90, ic: '10d' }, pollution: { ts: 'x', aqius: 88, mainus: 'p2' } } } });
    }
    if (p === '/brevo/v3/smtp/email' && req.method === 'POST') {
      if (req.headers['api-key'] !== 'brevo-test') return reply(res, 401, { message: 'Key not found' });
      const b = JSON.parse(body);
      if (!b.sender || !b.to || !b.to[0] || !b.subject || !b.textContent) return reply(res, 400, { message: 'bad email' });
      return reply(res, 201, { messageId: '<mock@brevo>' });
    }

    if (/^\/gemini\/v1beta\/models\/[^/]+:generateContent$/.test(p)) {
      if (!req.headers['x-goog-api-key']) return reply(res, 403, { error: { message: 'API key missing' } });
      const b = JSON.parse(body);
      const sys = b.systemInstruction.parts[0].text;
      const lastParts = b.contents[b.contents.length - 1].parts;
      if (/walking paths/i.test(sys)) {
        return reply(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ walkable: true, surface: 'mud', condition: 'muddy', summary: 'A muddy trail beside a drain (gemini)' }) }] } }] });
      }
      if (/triage/i.test(sys)) {
        const hasImg = lastParts.some(function (x) { return x.inline_data; });
        return reply(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'Standing water', severity: 'medium', summary: hasImg ? 'Water pooling on the road (gemini)' : 'From note only (gemini)' }) }] } }] });
      }
      return reply(res, 200, { candidates: [{ content: { parts: [{ text: 'Gemini buddy here! Take the shady way, lah.' }] } }] });
    }

    if (p === '/groq/openai/v1/chat/completions') {
      if (req.headers.authorization !== 'Bearer groq-test') return reply(res, 401, { error: { message: 'Invalid API Key' } });
      const b = JSON.parse(body);
      const parts = b.messages[1].content;
      const img = Array.isArray(parts) && parts.find(function (x) { return x.type === 'image_url'; });
      if (!img || !/^data:image\/jpeg;base64,/.test(img.image_url.url)) return reply(res, 400, { error: { message: 'bad image' } });
      const out = JSON.stringify({ walkable: !/wall/i.test(parts[0].text), surface: 'mud', condition: 'muddy', summary: 'A muddy trail beside a drain (groq)' });
      return reply(res, 200, { choices: [{ message: { role: 'assistant', content: '<think>looking</think>' + out } }] });
    }

    if (p === '/anthropic/v1/messages') {
      if (!req.headers['x-api-key'] || req.headers['anthropic-version'] !== '2023-06-01') return reply(res, 401, { error: { message: 'invalid x-api-key' } });
      const b = JSON.parse(body);
      if (/triage/i.test(b.system)) {
        const content = b.messages[0].content;
        const img = Array.isArray(content) && content.find(function (x) { return x.type === 'image'; });
        if (img && img.source.media_type !== 'image/jpeg') return reply(res, 400, { error: { message: 'bad media type' } });
        return reply(res, 200, { content: [{ type: 'text', text: 'Here you go: ```json\n' + JSON.stringify({ type: 'Blocked drain', severity: 'high', summary: img ? 'Drain full of leaves (claude)' : 'From note only (claude)' }) + '\n```' }] });
      }
      return reply(res, 200, { content: [{ type: 'text', text: 'Claude buddy: stay under the covered walkway.' }] });
    }

    reply(res, 404, { error: 'mock: no route ' + p });
  });

  return new Promise(function (resolve) {
    server.listen(port || 0, '127.0.0.1', function () {
      const addr = server.address();
      resolve({
        url: 'http://127.0.0.1:' + addr.port, log: log, fail: fail, supa: supa,
        overpassHits: function () { return overpassHits; },
        stop: function () { return new Promise(function (r) { server.close(r); server.closeAllConnections && server.closeAllConnections(); }); }
      });
    });
  });
}

module.exports = { startMock, osmFixture };

if (require.main === module) {
  startMock(Number(process.env.MOCK_PORT) || 4010).then(function (m) { console.log('Mock services on ' + m.url); });
}
