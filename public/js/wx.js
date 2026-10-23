'use strict';
// Clock and weather helpers. Everything here is plain functions on plain data, so it can be tested without a browser.
// All times are Malaysia time (Asia/Kuala_Lumpur, UTC+8), the same clock Open-Meteo uses for Malaysian places.

(function (root) {
  const TZ = 'Asia/Kuala_Lumpur';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  let fmt = null;
  // The clock, down to the second, in Malaysia time. `ms` is optional (used by tests).
  function klNow(ms) {
    const t = ms === undefined ? Date.now() : ms;
    let y, mo, d, hh, mm, ss;
    try {
      if (!fmt) fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const o = {};
      fmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
      y = +o.year; mo = +o.month; d = +o.day; hh = +o.hour % 24; mm = +o.minute; ss = +o.second;
    } catch (e) {
      const u = new Date(t + 8 * 3600 * 1000);       // Malaysia has no daylight saving, so UTC+8 is always right
      y = u.getUTCFullYear(); mo = u.getUTCMonth() + 1; d = u.getUTCDate(); hh = u.getUTCHours(); mm = u.getUTCMinutes(); ss = u.getUTCSeconds();
    }
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return {
      ms: t, y: y, mo: mo, d: d, hh: hh, mm: mm, ss: ss,
      h: hh + mm / 60 + ss / 3600,
      dateKey: y + '-' + pad(mo) + '-' + pad(d),
      dateLabel: DAYS[dow] + ' ' + d + ' ' + MONTHS[mo - 1]
    };
  }
  function clockText(n, withSeconds) {
    const h12 = n.hh % 12 || 12;
    return h12 + ':' + pad(n.mm) + (withSeconds === false ? '' : ':' + pad(n.ss)) + ' ' + (n.hh >= 12 ? 'pm' : 'am');
  }
  function hourText(h) {              // 14.5 -> "2:30 pm"
    const t = ((h % 24) + 24) % 24, H = Math.floor(t), M = Math.round((t - H) * 60);
    const HH = M === 60 ? (H + 1) % 24 : H, MM = M === 60 ? 0 : M;
    return (HH % 12 || 12) + ':' + pad(MM) + ' ' + (HH >= 12 ? 'pm' : 'am');
  }
  function isoHour(iso) {              // "2026-10-11T14:30" -> 14.5
    const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? +m[1] + +m[2] / 60 : null;
  }
  function isoDay(iso) { return String(iso || '').slice(0, 10); }
  function hourKey(dateKey, h) { return dateKey + 'T' + pad(Math.floor(h)) + ':00'; }

  // ---------- what the weather codes mean ----------

  function describe(code, isDay) {
    const day = isDay !== false;
    if (code === null || code === undefined) return { label: 'No data', kind: 'cloud' };
    if (code === 0) return day ? { label: 'Clear and sunny', kind: 'sun' } : { label: 'Clear night', kind: 'moon' };
    if (code === 1) return day ? { label: 'Mostly sunny', kind: 'sun' } : { label: 'Mostly clear', kind: 'moon' };
    if (code === 2) return { label: 'Partly cloudy', kind: day ? 'partly' : 'cloud' };
    if (code === 3) return { label: 'Overcast', kind: 'cloud' };
    if (code === 45 || code === 48) return { label: 'Fog', kind: 'fog' };
    if (code >= 51 && code <= 57) return { label: 'Drizzle', kind: 'rain' };
    if (code >= 61 && code <= 65) return { label: code === 61 ? 'Light rain' : code === 63 ? 'Rain' : 'Heavy rain', kind: 'rain' };
    if (code === 66 || code === 67) return { label: 'Freezing rain', kind: 'rain' };
    if (code >= 80 && code <= 82) return { label: code === 80 ? 'Light showers' : code === 81 ? 'Showers' : 'Heavy showers', kind: 'rain' };
    if (code === 95) return { label: 'Thunderstorm', kind: 'storm' };
    if (code === 96 || code === 99) return { label: 'Thunderstorm with hail', kind: 'storm' };
    if (code >= 71 && code <= 77) return { label: 'Snow', kind: 'cloud' };
    if (code === 85 || code === 86) return { label: 'Snow showers', kind: 'cloud' };
    return { label: 'Cloudy', kind: 'cloud' };
  }
  // rain intensity in mm per hour, in the usual weather-service words
  function rainWord(r) {
    return !(r >= 0.1) ? 'Dry' : r < 2.5 ? 'Light rain' : r < 7.6 ? 'Moderate rain' : r < 50 ? 'Heavy rain' : 'Violent rain';
  }
  function uvWord(u) { return u === null || u === undefined ? '' : u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme'; }
  function aqiWord(a) { return a === null || a === undefined ? '' : a <= 50 ? 'Good' : a <= 100 ? 'Moderate' : a <= 150 ? 'Unhealthy for sensitive groups' : a <= 200 ? 'Unhealthy' : a <= 300 ? 'Very unhealthy' : 'Hazardous'; }

  // small weather pictures, drawn as inline SVG (24 x 24)
  function icon(kind, size) {
    const s = size || 28;
    const sun = '<circle cx="12" cy="12" r="4.2" fill="#F4A62A"/><g stroke="#F4A62A" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7"/></g>';
    const cloud = function (fill, dy) { return '<path d="M7 ' + (18 + dy) + 'a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.7 1.2A3.4 3.4 0 0 1 17 ' + (18 + dy) + 'z" fill="' + fill + '"/>'; };
    let inner;
    switch (kind) {
      case 'sun': inner = sun; break;
      case 'moon': inner = '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 12.6A7 7 0 0 1 15.5 3.5z" fill="#B9C6E8"/>'; break;
      case 'partly': inner = '<g transform="translate(-3.5 -3.5) scale(.8)">' + sun + '</g>' + cloud('#9FB0AA', 0); break;
      case 'fog': inner = cloud('#A9B7B1', -3) + '<g stroke="#8FA09A" stroke-width="1.8" stroke-linecap="round"><path d="M4 18.5h16M6 21.5h12"/></g>'; break;
      case 'rain': inner = cloud('#8FA3AE', -3) + '<g stroke="#2D6CDF" stroke-width="1.9" stroke-linecap="round"><path d="M8 18.5l-1 3M12.5 18.5l-1 3M17 18.5l-1 3"/></g>'; break;
      case 'storm': inner = cloud('#6F8290', -3) + '<path d="M12.8 14.2l-3 4.6h2.6l-1.2 3.7 4.2-5.4h-2.7z" fill="#F4C20D"/>'; break;
      default: inner = cloud('#9FB0AA', 0);
    }
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  // ---------- the forecast at a moment ----------

  // W is what /api/weather returns. Looks up the forecast hour for a Malaysia date and hour.
  function hourlyAt(W, dateKey, h) {
    if (!W || !W.hourly || !W.hourly.length) return null;
    const k = hourKey(dateKey, h);
    for (let i = 0; i < W.hourly.length; i++) if (W.hourly[i].time === k) return { i: i, row: W.hourly[i] };
    return null;
  }
  // The weather around a Malaysia date and fractional hour. Temperatures glide between hours; rain is that hour's total.
  function sample(W, dateKey, h) {
    const a = hourlyAt(W, dateKey, h);
    if (!a) return null;
    const next = W.hourly[a.i + 1], f = h - Math.floor(h);
    const mix = function (k) {
      const x = a.row[k], y = next ? next[k] : null;
      return x === null || x === undefined ? null : (y === null || y === undefined ? x : x + (y - x) * f);
    };
    return {
      time: a.row.time, temp: mix('temp'), feels: mix('feels'), pop: a.row.pop, rain: a.row.rain, code: a.row.code,
      gust: mix('gust'), uv: mix('uv'), vis: a.row.vis, aqi: a.row.aqi
    };
  }
  // sunrise and sunset in hours, from the weather answer
  function sunHours(W) {
    if (!W || !W.sun) return null;
    const r = isoHour(W.sun.rise), s = isoHour(W.sun.set);
    return r === null || s === null ? null : { rise: r, set: s };
  }
  function isDayAt(W, h) {
    const s = sunHours(W);
    return s ? h >= s.rise && h < s.set : h >= 7 && h < 19;
  }

  // The "now" reading shaped like a forecast sample, so the screen can treat both the same way.
  function nowSample(W) {
    if (!W || !W.now) return null;
    const n = W.now;
    return { time: n.time, temp: n.temp, feels: n.feels, humidity: n.humidity, pop: null, rain: n.rain, code: n.code, gust: n.gust, wind: n.wind, uv: n.uv, vis: null, aqi: n.aqi, pm25: n.pm25, cloud: n.cloud, isDay: n.isDay };
  }

  // ---------- warnings for all kinds of weather ----------

  function warnings(p) {
    const out = [];
    if (!p) return out;
    if (p.code === 95 || p.code === 96 || p.code === 99) out.push({ id: 'storm', level: 'bad', text: p.code === 95 ? 'Thunderstorm. Avoid open ground and tall trees; lightning is possible.' : 'Thunderstorm with hail. Stay indoors if you can.' });
    if (p.rain >= 30) out.push({ id: 'rain', level: 'bad', text: 'Very heavy rain (' + Math.round(p.rain) + ' mm/h). Flash flooding is possible.' });
    else if (p.rain >= 7.6) out.push({ id: 'rain', level: 'warn', text: 'Heavy rain (' + (Math.round(p.rain * 10) / 10) + ' mm/h). Expect puddles and slippery paths.' });
    else if (p.rain >= 0.5) out.push({ id: 'rain', level: 'info', text: rainWord(p.rain) + '. Prefer covered walkways.' });
    if (p.gust !== null && p.gust !== undefined && p.gust >= 50) out.push({ id: 'wind', level: 'warn', text: 'Strong gusts up to ' + Math.round(p.gust) + ' km/h. Watch for falling branches.' });
    const hot = p.feels !== null && p.feels !== undefined ? p.feels : p.temp;
    if (hot !== null && hot !== undefined && hot >= 41) out.push({ id: 'heat', level: 'bad', text: 'Dangerous heat (feels like ' + Math.round(hot) + '°C). Take shade, drink water.' });
    else if (hot !== null && hot !== undefined && hot >= 35) out.push({ id: 'heat', level: 'warn', text: 'Hot (feels like ' + Math.round(hot) + '°C). Stay in shade and drink water.' });
    if (p.uv !== null && p.uv !== undefined && p.uv >= 8) out.push({ id: 'uv', level: p.uv >= 11 ? 'bad' : 'warn', text: uvWord(p.uv) + ' UV (' + Math.round(p.uv) + '). Shade and sun protection matter.' });
    if (p.aqi !== null && p.aqi !== undefined && p.aqi > 100) out.push({ id: 'haze', level: p.aqi > 150 ? 'bad' : 'warn', text: 'Hazy air (AQI ' + Math.round(p.aqi) + ', ' + aqiWord(p.aqi).toLowerCase() + '). Consider a mask if you are sensitive.' });
    if (p.code === 45 || p.code === 48 || (p.vis !== null && p.vis !== undefined && p.vis < 1000)) out.push({ id: 'fog', level: 'warn', text: 'Low visibility. Be careful crossing roads.' });
    return out;
  }

  // ---------- the weather during a walk ----------

  // Walk starts at (dateKey, startH) and takes `minutes`. Returns samples at n+1 evenly spaced moments, and a summary.
  function tripWeather(W, now, minutes, n, startOffsetMin, live) {
    const out = { points: [], maxRain: 0, worst: null, rainStartsInMin: null };
    if (!W || !W.hourly) return out;
    const off = startOffsetMin || 0;
    n = n || 3;
    const dur = Math.max(1, minutes);
    for (let i = 0; i <= n; i++) {
      const m = off + dur * i / n;
      const t = now.h + m / 60;
      const day = t >= 24 ? nextDay(now.dateKey) : now.dateKey;
      const hh = t % 24;
      const s = i === 0 && off === 0 && live ? mergeNow(W, sample(W, day, hh)) : sample(W, day, hh);
      if (!s) continue;
      out.points.push({ at: m, hour: hh, s: s });
    }
    // rain over the whole window: look at every forecast hour the walk touches
    const hours = {};
    for (let m = off; m <= off + dur; m += Math.max(5, dur / 12)) {
      const t = now.h + m / 60, day = t >= 24 ? nextDay(now.dateKey) : now.dateKey, s = sample(W, day, t % 24);
      if (s) hours[s.time] = s;
    }
    if (off === 0 && live && W.now) hours.now = { rain: W.now.rain, code: W.now.code };
    Object.keys(hours).forEach(function (k) {
      const s = hours[k];
      if (s.rain > out.maxRain) out.maxRain = s.rain;
      if (!out.worst || severity(s) > severity(out.worst)) out.worst = s;
    });
    for (let i = 0; i < out.points.length; i++) {
      if (out.points[i].s.rain >= 0.5) { out.rainStartsInMin = Math.round(out.points[i].at); break; }
    }
    return out;
  }
  function severity(s) { return (s.code === 95 || s.code === 96 || s.code === 99 ? 100 : 0) + (s.rain || 0); }
  function mergeNow(W, s) {   // for the very start of a walk starting now, the current reading is the best one we have
    const n = nowSample(W);
    if (!n) return s;
    return Object.assign({}, s || {}, n, { pop: s ? s.pop : null, vis: s ? s.vis : null });
  }
  function nextDay(key) {
    const p = key.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // Looking ahead: the first moment in the next `mins` minutes when rain of at least `min` mm/h is forecast.
  function rainOutlook(W, now, mins, min) {
    for (let m = 0; m <= mins; m += 5) {
      const t = now.h + m / 60, day = t >= 24 ? nextDay(now.dateKey) : now.dateKey;
      const s = m === 0 ? (nowSample(W) || sample(W, day, t % 24)) : sample(W, day, t % 24);
      if (s && s.rain >= (min || 0.5)) return { inMin: m, rain: s.rain, code: s.code };
    }
    return null;
  }

  // The best time to leave within the next `hours` hours: the earliest start (every 15 min) with the least rain during the walk.
  function bestDeparture(W, now, minutes, hours, live) {
    if (!W || !W.hourly) return null;
    let best = null;
    for (let off = 0; off <= hours * 60; off += 15) {
      const tw = tripWeather(W, now, minutes, 2, off, live);
      if (!tw.points.length) continue;
      const score = tw.maxRain + (tw.worst && (tw.worst.code === 95 || tw.worst.code === 96 || tw.worst.code === 99) ? 100 : 0);
      if (!best || score < best.score - 0.05) best = { offMin: off, score: score, maxRain: tw.maxRain };
    }
    return best;
  }

  root.Wx = {
    TZ: TZ, klNow: klNow, clockText: clockText, hourText: hourText, isoHour: isoHour, isoDay: isoDay, hourKey: hourKey,
    describe: describe, rainWord: rainWord, uvWord: uvWord, aqiWord: aqiWord, icon: icon,
    sample: sample, nowSample: nowSample, sunHours: sunHours, isDayAt: isDayAt, warnings: warnings,
    tripWeather: tripWeather, rainOutlook: rainOutlook, bestDeparture: bestDeparture, nextDay: nextDay, clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Wx;
