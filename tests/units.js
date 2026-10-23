'use strict';
// Tests for the clock and weather helpers (public/js/wx.js) and the walking navigation maths (public/js/nav.js). Run with: node tests/units.js

const Wx = require('../public/js/wx.js');
const Nav = require('../public/js/nav.js');
const Logic = require('../public/js/logic.js');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

console.log('Clock');
const n1 = Wx.klNow(Date.UTC(2026, 9, 11, 5, 3, 9));          // 05:03:09 UTC is 13:03:09 in Malaysia
check('Malaysia time is UTC+8 down to the second', n1.hh === 13 && n1.mm === 3 && n1.ss === 9 && n1.dateKey === '2026-10-11', n1);
check('the clock reads like a digital clock', Wx.clockText(n1) === '1:03:09 pm' && Wx.clockText(n1, false) === '1:03 pm', Wx.clockText(n1));
const n2 = Wx.klNow(Date.UTC(2026, 9, 11, 16, 30, 0));        // 00:30 next day in Malaysia
check('the date rolls over at Malaysia midnight', n2.dateKey === '2026-10-12' && n2.hh === 0 && Wx.clockText(n2, false) === '12:30 am', n2);
check('seconds change the fractional hour', Wx.klNow(Date.UTC(2026, 9, 11, 5, 3, 10)).h > n1.h);
check('hour text for half hours', Wx.hourText(14.5) === '2:30 pm' && Wx.hourText(0.25) === '12:15 am' && Wx.hourText(23.999) === '12:00 am');

console.log('Weather words and warnings');
check('weather codes are described', Wx.describe(95).label === 'Thunderstorm' && Wx.describe(0, false).kind === 'moon' && Wx.describe(63).kind === 'rain' && Wx.describe(45).kind === 'fog');
check('rain words follow the usual scale', Wx.rainWord(0) === 'Dry' && Wx.rainWord(1) === 'Light rain' && Wx.rainWord(5) === 'Moderate rain' && Wx.rainWord(20) === 'Heavy rain' && Wx.rainWord(60) === 'Violent rain');
const ids = function (p) { return Wx.warnings(p).map(function (w) { return w.id; }).sort().join(','); };
check('a calm day has no warnings', ids({ code: 1, rain: 0, gust: 10, feels: 31, uv: 4, aqi: 40, vis: 20000 }) === '');
check('thunderstorm, heavy rain, gusts, heat, UV, haze and fog all warn', ids({ code: 95, rain: 35, gust: 60, feels: 42, uv: 9, aqi: 160, vis: 500 }) === 'fog,haze,heat,rain,storm,uv,wind', ids({ code: 95, rain: 35, gust: 60, feels: 42, uv: 9, aqi: 160, vis: 500 }));
check('heat and haze have levels', Wx.warnings({ feels: 36 })[0].level === 'warn' && Wx.warnings({ feels: 43 })[0].level === 'bad' && Wx.warnings({ aqi: 120 })[0].level === 'warn' && Wx.warnings({ aqi: 180 })[0].level === 'bad');
check('light rain is only a note', Wx.warnings({ rain: 1 })[0].level === 'info');

console.log('Forecast lookups');
function hours(day, start, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = start + i, d = h >= 24 ? Wx.nextDay(day) : day, hh = h % 24;
    out.push({ time: d + 'T' + (hh < 10 ? '0' : '') + hh + ':00', temp: 30 + i, feels: 34, pop: 10, rain: 0, code: 2, gust: 20, uv: 5, vis: 20000, aqi: 50 });
  }
  return out;
}
const W = { now: { time: '2026-10-11T13:00', temp: 31, feels: 37, humidity: 70, rain: 0, code: 1, gust: 20, wind: 9, uv: 8, aqi: 60, isDay: true }, hourly: hours('2026-10-11', 13, 24), sun: { rise: '2026-10-11T07:00', set: '2026-10-11T19:10', rise2: '2026-10-12T07:00' } };
W.hourly[1].rain = 8; W.hourly[1].code = 95;          // 14:00 thunderstorm, 8 mm
const s1 = Wx.sample(W, '2026-10-11', 13.5);
check('temperature glides between hours, rain and code come from the hour', Math.abs(s1.temp - 30.5) < 1e-9 && s1.rain === 0 && s1.code === 2, s1);
check('tomorrow can be looked up', Wx.sample(W, '2026-10-12', 2).temp === 30 + 13, Wx.sample(W, '2026-10-12', 2));
check('outside the forecast there is no answer', Wx.sample(W, '2026-10-13', 5) === null && Wx.sample(null, '2026-10-11', 5) === null);
check('sunrise and sunset in hours', JSON.stringify(Wx.sunHours(W)) === JSON.stringify({ rise: 7, set: 19 + 10 / 60 }) && Wx.isDayAt(W, 12) && !Wx.isDayAt(W, 20));
const now = { h: 13.2, dateKey: '2026-10-11' };
const out = Wx.rainOutlook(W, now, 60, 0.5);
check('rain outlook finds the storm hour', out && out.inMin === 50 && out.rain === 8 && out.code === 95, out);
check('no rain outlook on a dry stretch', Wx.rainOutlook(W, { h: 16, dateKey: '2026-10-11' }, 60, 0.5) === null);

console.log('Weather during a walk');
const dry = Wx.tripWeather(W, { h: 15, dateKey: '2026-10-11' }, 10, 3, 0, false);
check('a walk after the storm is dry', dry.maxRain === 0 && dry.points.length === 4 && dry.rainStartsInMin === null, dry);
const wet = Wx.tripWeather(W, { h: 13.8, dateKey: '2026-10-11' }, 20, 3, 0, false);
check('a walk into the storm sees its rain and when it starts', wet.maxRain === 8 && wet.rainStartsInMin > 0 && wet.rainStartsInMin <= 20 && wet.worst.code === 95, wet);
const best = Wx.bestDeparture(W, { h: 13.8, dateKey: '2026-10-11' }, 20, 3, false);
check('a drier time to leave is suggested', best && best.offMin > 0 && best.maxRain === 0, best);
const live = Wx.tripWeather(W, { h: 13.2, dateKey: '2026-10-11' }, 10, 3, 0, true);
check('a live walk starts from the current reading', live.points[0].s.temp === 31 && live.points[0].s.humidity === 70, live.points[0]);

console.log('Sun and darkness follow real sunrise and sunset');
const sun = { rise: 7, set: 19.17 };
check('noon is bright and dark is zero', Logic.darkness(12, sun) === 0 && Logic.conditions(0, 12, null, sun).sunLoad > 0.9);
check('after sunset it gets dark within the hour', Logic.darkness(19.2, sun) < 1 && Logic.darkness(20.2, sun) === 1 && Logic.darkness(3, sun) === 1);
check('a later sunset keeps the evening bright for longer', Logic.darkness(19.4, { rise: 7, set: 19.8 }) < Logic.darkness(19.4, { rise: 7, set: 18.8 }));
check('no sun load in the dark', Logic.conditions(0, 23, 5, sun).sunLoad === 0);
check('minute-level time matters', Logic.conditions(0, 12.5, null, sun).sunLoad !== Logic.conditions(0, 12.51, null, sun).sunLoad);

console.log('Navigation');
// a route that goes east 100 m, then north 100 m, on two roads
const lat0 = 3.0, lon0 = 101.5, dLon = 100 / (111320 * Math.cos(lat0 * Math.PI / 180)), dLat = 100 / 110574;
const P = [[lat0, lon0], [lat0, lon0 + dLon], [lat0 + dLat, lon0 + dLon]];
const G = { };
const e1 = { a: 0, b: 1, road: 'Jalan Satu', where: 'Jalan Satu', pts: [P[0], P[1]], covered: false }, e2 = { a: 1, b: 2, road: 'Jalan Dua', where: 'Jalan Dua', pts: [P[1], P[2]], covered: true };
const line = Nav.routeLine(G, { nodes: [0, 1, 2], edges: [e1, e2] });
check('the line is about 200 m long', Math.abs(line.total - 200) < 2, line.total);
check('a route can be walked backwards too', Math.abs(Nav.routeLine(G, { nodes: [2, 1, 0], edges: [e2, e1] }).total - 200) < 2);
const sn = Nav.snap(line, lat0 + dLat * 0.4, lon0 + dLon + 0.00002);
check('a GPS fix snaps to the line: 140 m along and about 2 m off', Math.abs(sn.along - 140) < 2 && sn.off < 4, sn);
check('a fix far from the line is far off', Nav.snap(line, lat0 - 0.001, lon0).off > 100);
const pa = Nav.pointAt(line, 150);
check('the point 150 m along is on the second road, heading north', Math.abs(pa.lat - (lat0 + dLat * 0.5)) < 1e-5 && (pa.heading < 5 || pa.heading > 355), pa);
check('the walked part of the line is cut where you are', Nav.lineUpTo(line, 150).length === 3);
const st = Nav.steps(line, 'Pasar Pagi');
check('steps: head east, turn left onto the second road, arrive', st.length === 3 && /^Head east on Jalan Satu$/.test(st[0].text) && st[1].kind === 'left' && /^Turn left onto Jalan Dua$/.test(st[1].text) && st[2].text === 'Arrive at Pasar Pagi', st.map(function (x) { return x.text; }));
check('step distances', Math.abs(st[1].at - 100) < 2 && Math.abs(st[2].at - 200) < 2);
const east = Nav.routeLine(G, { nodes: [0, 1, 2], edges: [e1, { a: 1, b: 2, road: 'Jalan Tiga', where: 'x', pts: [P[1], [lat0 - dLat, lon0 + dLon]], covered: false }] });
check('a right turn is a right turn', Nav.steps(east, '')[1].kind === 'right');
const pr = Nav.progress(st, 70);
check('progress: 30 m to the turn', pr.index === 0 && pr.next.kind === 'left' && Math.abs(pr.toNext - 30) < 2, pr);
check('distances are written for walking', Nav.metres(48) === '50 m' && Nav.metres(1240) === '1.2 km' && Nav.metres(0) === '0 m');
check('bearing and angles', Math.abs(Nav.bearing([0, 0], [0, 1]) - 90) < 0.5 && Nav.angleDiff(350, 10) === 20 && Nav.angleDiff(10, 350) === -20);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
