'use strict';
// Live weather. IQAir (AirVisual, needs IQAIR_API_KEY) gives the reading right now for the place nearest the person:
// temperature, humidity, wind, pressure, air quality and the city name. IQAir's free plan has no rain and no forecast,
// so rain, storms, UV, sunrise/sunset and the next 24 hours still come from Open-Meteo (free, no key), which the
// flood warnings need. Without an IQAir key everything comes from Open-Meteo. Cached 5 minutes per ~1 km square.

const { fetchJson, HttpError } = require('./http');

function num(v) { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; }
function col(h, k) { return (h && Array.isArray(h[k])) ? h[k] : []; }

function createWeather(cfg) {
  const cache = new Map();

  async function airQuality(lat, lon) {
    if (!cfg.urls.airQuality) return null;
    try {
      const url = cfg.urls.airQuality + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
        '&current=us_aqi,pm2_5,pm10&hourly=us_aqi&forecast_hours=24&timezone=auto';
      const j = await fetchJson(url, {}, 6000);
      return j || null;
    } catch (e) { return null; }       // haze info is a bonus
  }

  // IQAir's nearest city or station. Returns null on any problem: the Open-Meteo reading is used instead.
  async function iqair(lat, lon) {
    if (!cfg.iqair.key) return null;
    try {
      const j = await fetchJson(cfg.iqair.url + '?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) + '&key=' + encodeURIComponent(cfg.iqair.key), {}, 6000);
      const d = j && j.status === 'success' ? j.data : null;
      const w = d && d.current && d.current.weather, p = d && d.current && d.current.pollution;
      if (!w) return null;
      const place = [d.city, d.state].filter(Boolean).join(', ');
      return { temp: num(w.tp), humidity: num(w.hu), wind: num(w.ws) === null ? null : Math.round(num(w.ws) * 3.6 * 10) / 10, pressure: num(w.pr), aqi: p ? num(p.aqius) : null, place: place || null };
    } catch (e) { return null; }
  }

  async function get(lat, lon) {
    const key = lat.toFixed(2) + ',' + lon.toFixed(2);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;

    const url = cfg.urls.forecast + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day' +
      '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_gusts_10m,uv_index,visibility' +
      '&daily=sunrise,sunset&forecast_days=2&forecast_hours=24&timezone=auto';
    const [j, aq, iq] = await Promise.all([fetchJson(url, {}, 8000), airQuality(lat, lon), iqair(lat, lon)]);
    const cur = j && j.current;
    if (!cur || num(cur.precipitation) === null) throw new HttpError(502, 'The weather service returned no rain value');

    const H = j.hourly || {};
    const times = col(H, 'time');
    const aqH = aq && aq.hourly ? aq.hourly : {};
    const aqTimes = col(aqH, 'time');
    const aqAt = function (t) { const i = aqTimes.indexOf(t); return i < 0 ? null : num(col(aqH, 'us_aqi')[i]); };

    const hourly = times.map(function (t, i) {
      return {
        time: t,
        temp: num(col(H, 'temperature_2m')[i]),
        feels: num(col(H, 'apparent_temperature')[i]),
        pop: num(col(H, 'precipitation_probability')[i]),
        rain: num(col(H, 'precipitation')[i]) || 0,
        code: num(col(H, 'weather_code')[i]),
        gust: num(col(H, 'wind_gusts_10m')[i]),
        uv: num(col(H, 'uv_index')[i]),
        vis: num(col(H, 'visibility')[i]),
        aqi: aqAt(t)
      };
    });

    // rain "now" is the larger of the current reading and this hour's total, so a shower is not missed
    const rainNow = Math.max(num(cur.precipitation) || 0, hourly.length ? hourly[0].rain : 0);
    let peak = null;
    hourly.slice(0, 4).forEach(function (f) { if (!peak || f.rain > peak.rain) peak = { time: f.time, rain: f.rain }; });
    const D = j.daily || {};
    const aqc = aq && aq.current ? aq.current : {};

    const data = {
      at: new Date().toISOString(),
      source: iq ? 'IQAir (now) and Open-Meteo (rain and forecast)' : 'Open-Meteo',
      place: iq ? iq.place : null,
      timezone: j.timezone || null,
      now: {
        time: cur.time || null,
        temp: num(cur.temperature_2m), feels: num(cur.apparent_temperature), humidity: num(cur.relative_humidity_2m),
        rain: rainNow, cloud: num(cur.cloud_cover), wind: num(cur.wind_speed_10m), gust: num(cur.wind_gusts_10m),
        code: num(cur.weather_code), isDay: cur.is_day === 1,
        uv: hourly.length ? hourly[0].uv : null,
        aqi: num(aqc.us_aqi), pm25: num(aqc.pm2_5)
      },
      pressure: iq ? iq.pressure : null,
      hourly: hourly,
      sun: { rise: col(D, 'sunrise')[0] || null, set: col(D, 'sunset')[0] || null, rise2: col(D, 'sunrise')[1] || null },
      // older fields, kept so earlier code keeps working
      rain: rainNow,
      cloud: num(cur.cloud_cover),
      isDay: cur.is_day === 1,
      uv: hourly.length ? hourly[0].uv : null,
      forecast: hourly.slice(0, 4).map(function (f) { return { time: f.time, rain: f.rain }; }),
      peak: peak
    };
    if (iq) {
      if (iq.temp !== null) data.now.temp = iq.temp;
      if (iq.humidity !== null) data.now.humidity = iq.humidity;
      if (iq.wind !== null) data.now.wind = iq.wind;
      if (iq.aqi !== null) data.now.aqi = iq.aqi;
    }
    cache.set(key, { at: Date.now(), data: data });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return data;
  }

  return { get: get };
}

module.exports = { createWeather };
