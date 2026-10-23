'use strict';
// Where the sun is, for any place on Earth. Used to cast building shadows.
// NOAA's simple solar position formulas: accurate to well under 1 degree, which is plenty here.
// clockHour is local clock time in hours (Malaysia is UTC+8 everywhere), date is a JS Date used for the day of the year.

function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}

// returns { el, az } in degrees: el = height above the horizon, az = compass direction clockwise from north
function sunPosition(lat, lon, date, clockHour, utcOffset) {
  const rad = Math.PI / 180;
  const n = dayOfYear(date);
  const g = 2 * Math.PI / 365 * (n - 1 + (clockHour - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const off = utcOffset === undefined ? 8 : utcOffset;
  const solarMin = clockHour * 60 + eot + 4 * lon - 60 * off;     // true solar time in minutes
  const ha = (solarMin / 4 - 180) * rad;                           // hour angle
  const la = lat * rad;
  let cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  cz = Math.max(-1, Math.min(1, cz));
  const zen = Math.acos(cz);
  const sz = Math.sin(zen) || 1e-9;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(la) * cz - Math.sin(decl)) / (Math.cos(la) * sz)))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { el: 90 - zen / rad, az: az };
}

module.exports = { sunPosition: sunPosition, dayOfYear: dayOfYear };
