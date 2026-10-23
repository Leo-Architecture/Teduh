import { useStore } from '../hooks.js';
import { ui, getG, conds, curSample, viewClock, canLive, alertList, plural, round1, shortHour, previewHour, backToLive, setSim } from '../store.js';
import { Wx } from '../engines.js';

function WxIcon({ kind, size }) { return <span className="wx-svg" dangerouslySetInnerHTML={{ __html: Wx.icon(kind, size) }} />; }

function Cell({ label, value, unit, sub }) {
  return <div><dt>{label}</dt><dd>{value}{unit ? <small>{unit}</small> : null}{sub ? <small>{sub}</small> : null}</dd></div>;
}

export function WxStatus() {
  useStore();
  const W = ui.wx;
  let status;
  if (!canLive()) status = ui.online ? 'Live weather is for real areas. This sample map has none.' : 'Live weather needs the server. Run npm start.';
  else if (ui.wxErr) status = ui.wxErr;
  else if (!W) status = 'Loading the weather.';
  else {
    const age = Math.round((Date.now() - ui.wxAt) / 60000);
    status = (W.place ? 'Weather for ' + W.place + ' (where you are) · ' : ui.here ? 'Weather where you are · ' : '') + 'Live · updated ' + (age < 1 ? 'just now' : age + ' min ago') + ' · ' + (W.source || 'Open-Meteo');
  }
  return <><p className={'wx-status' + (ui.wxErr ? ' stale' : '')} id="wxStatus" role="status">{status}</p>{ui.hereMsg ? <p className="hint" id="hereMsg">{ui.hereMsg}</p> : null}</>;
}

export function WxPreview() {
  useStore();
  if (!ui.preview) return null;
  return (
    <div className="wx-preview" id="wxPreview">
      <span id="wxPreviewText">Previewing {Wx.hourText(ui.preview.h)}{ui.preview.day !== ui.clock.dateKey ? ' tomorrow' : ''}. Routes and flood risk use this hour.</span>
      <button type="button" className="chip" id="wxLive" onClick={backToLive}>Back to live</button>
    </div>
  );
}

export function WxNow() {
  useStore();
  const W = ui.wx, p = curSample();
  if (!p) return <div className="wx-now" id="wxNow"><div className="empty">No weather reading yet. The clock, sun and routes still work.</div></div>;
  const d = Wx.describe(p.code, p.isDay === undefined ? Wx.isDayAt(W, viewClock().h) : p.isDay);
  const has = function (v) { return v !== null && v !== undefined; };
  return (
    <div className="wx-now" id="wxNow">
      <div className="wx-main">
        <div className="wx-ic"><WxIcon kind={d.kind} size={54} /></div>
        <div>
          <p className="wx-temp">{has(p.temp) ? Math.round(p.temp) + '°C' : '-'}</p>
          <p className="wx-desc">{d.label}</p>
          <p className="wx-feels">{has(p.feels) ? 'Feels like ' + Math.round(p.feels) + '°C' : ''}</p>
        </div>
      </div>
      <dl className="wx-grid">
        <Cell label="Rain" value={round1(ui.sim !== null ? ui.sim : p.rain)} unit=" mm/h" sub={ui.sim !== null ? 'simulated' : Wx.rainWord(p.rain)} />
        {has(p.pop) ? <Cell label="Chance of rain" value={Math.round(p.pop)} unit="%" /> : null}
        {has(p.humidity) ? <Cell label="Humidity" value={Math.round(p.humidity)} unit="%" /> : null}
        {has(p.wind) ? <Cell label="Wind" value={Math.round(p.wind)} unit=" km/h" sub={p.gust ? 'gusts ' + Math.round(p.gust) : ''} /> : (has(p.gust) ? <Cell label="Gusts" value={Math.round(p.gust)} unit=" km/h" /> : null)}
        {has(p.uv) ? <Cell label="UV index" value={round1(p.uv)} sub={Wx.uvWord(p.uv)} /> : null}
        {has(p.aqi) ? <Cell label="Air quality" value={Math.round(p.aqi)} sub={Wx.aqiWord(p.aqi).replace(' for sensitive groups', '')} /> : null}
        {has(p.cloud) ? <Cell label="Cloud cover" value={Math.round(p.cloud)} unit="%" /> : null}
        {has(p.vis) ? <Cell label="Visibility" value={round1(p.vis / 1000)} unit=" km" /> : null}
      </dl>
    </div>
  );
}

export function WxAlerts() {
  useStore();
  if (!getG()) return null;
  const c = conds(), p = curSample();
  const warn = Wx.warnings(ui.sim !== null ? Object.assign({}, p || {}, { rain: ui.sim }) : p);
  const roads = alertList(c).length;
  if (roads) warn.push({ id: 'flood', level: c.rain >= 25 ? 'bad' : 'warn', text: plural(roads, 'road') + ' may flood at ' + round1(c.rain) + ' mm/h. See Flood early warning below.' });
  if (ui.sim !== null) warn.unshift({ id: 'sim', level: 'info', text: 'Simulated storm of ' + ui.sim + ' mm/h. Real weather is ' + (p ? round1(p.rain) + ' mm/h' : 'unknown') + '.' });
  return (
    <ul className="wx-alerts" id="wxAlerts">
      {warn.map(function (w) { return <li key={w.id} className={'wa wa-' + w.level}><b>{w.level === 'bad' ? 'Warning' : w.level === 'warn' ? 'Caution' : 'Note'}</b><span>{w.text}</span></li>; })}
    </ul>
  );
}

// The weather along the planned route, at the time you reach each part of it.
export function WxRoute() {
  useStore();
  const tw = ui.tripW, line = ui.cur && ui.cur.line, st = ui.cur && ui.cur.stats;
  if (!tw || !tw.points.length || !line || !line.total || !st) return null;
  const vc = viewClock(), mins = Math.max(1, Math.round(ui.tripMin));
  const rows = tw.points.map(function (pt, i) {
    const frac = i / (tw.points.length - 1 || 1), d = frac * line.total;
    let road = '';
    for (let k = 0; k < line.parts.length; k++) { if (line.cum[line.parts[k].to] >= d - 0.01) { road = line.parts[k].edge.where; break; } }
    const desc = Wx.describe(pt.s.code, Wx.isDayAt(ui.wx, pt.hour));
    const label = i === 0 ? 'Start' : i === tw.points.length - 1 ? 'Arrive' : 'On the way';
    return { i: i, label: label, time: Wx.hourText(vc.h + pt.at / 60), desc: desc, temp: pt.s.temp, rain: pt.s.rain, road: road };
  });
  let verdict;
  if (tw.maxRain >= 0.5) {
    verdict = tw.rainStartsInMin === 0 ? 'It is raining (' + Wx.rainWord(tw.maxRain).toLowerCase() + ') when you start.' : tw.rainStartsInMin !== null ? 'Rain is forecast about ' + tw.rainStartsInMin + ' min into your walk (' + Wx.rainWord(tw.maxRain).toLowerCase() + ').' : 'Some rain is forecast during your walk (' + Wx.rainWord(tw.maxRain).toLowerCase() + ').';
    if (st.coveredPct > 0) verdict += ' ' + st.coveredPct + '% of this route is under a covered walkway.';
  } else verdict = 'Dry for your whole walk.';
  const hot = tw.points.reduce(function (m, pt) { return Math.max(m, pt.s.feels === null || pt.s.feels === undefined ? (pt.s.temp || 0) : pt.s.feels); }, 0);
  if (hot >= 35) verdict += ' It feels hot (' + Math.round(hot) + '°C), so shade matters: this route is ' + st.shadedPct + '% shaded.';
  let best = '';
  if (tw.maxRain >= 0.5 && ui.sim === null) {
    const bd = Wx.bestDeparture(ui.wx, vc, ui.tripMin, 4, !ui.preview);
    if (bd && bd.offMin > 0 && bd.maxRain < tw.maxRain * 0.5) best = 'Drier if you leave around ' + Wx.hourText(vc.h + bd.offMin / 60) + (bd.maxRain < 0.5 ? ' (no rain expected).' : ' (only light rain).');
  }
  return (
    <div className="wx-route" id="wxRoute">
      <h3>On your route <small>{mins} min, {st.dist} m</small></h3>
      <ul className="wr">
        {rows.map(function (r) {
          return (
            <li key={r.i}>
              <span className="wr-t">{r.label}<b>{r.time}</b></span>
              <WxIcon kind={r.desc.kind} size={24} />
              <span className="wr-d"><b>{r.desc.label}{r.temp !== null && r.temp !== undefined ? ', ' + Math.round(r.temp) + '°C' : ''}</b><span>{r.road}{r.rain >= 0.1 ? ' · ' + round1(r.rain) + ' mm/h' : ''}</span></span>
            </li>
          );
        })}
      </ul>
      <p className="wr-v">{verdict}</p>
      {best ? <p className="wr-best">{best}</p> : null}
      <p className="hint">Forecast squares are a few kilometres wide, so this is the weather around your route at the time you reach each part of it.</p>
    </div>
  );
}

export function WxHours() {
  useStore();
  const W = ui.wx, hrs = (W && W.hourly) || [];
  const sun = Wx.sunHours(W);
  return (
    <>
      {hrs.length ? <div className="wx-sub"><span className="lbl">Next 24 hours</span><span className="hint">Tap an hour to preview routes and flood risk at that time.</span></div> : null}
      <div className="wx-hours" id="wxHours" role="list">
        {hrs.map(function (h, i) {
          const hh = Wx.isoHour(h.time);
          const d = Wx.describe(h.code, Wx.isDayAt(W, hh));
          const sel = ui.preview ? ui.preview.iso === h.time : i === 0;
          const r = h.rain >= 0.1 ? round1(h.rain) + ' mm' : (h.pop !== null && h.pop !== undefined ? Math.round(h.pop) + '%' : '');
          return (
            <button type="button" key={h.time} className={'wh' + (h.code === 95 || h.code === 96 || h.code === 99 ? ' storm' : '')} role="listitem" data-hr={i} aria-pressed={sel}
              aria-label={shortHour(hh) + ', ' + d.label} onClick={function () { previewHour(i); }}>
              <span className="wh-t">{i === 0 ? 'Now' : shortHour(hh)}</span>
              <WxIcon kind={d.kind} size={26} />
              <span className="wh-temp">{h.temp === null ? '-' : Math.round(h.temp) + '°'}</span>
              <span className="wh-r">{r}</span>
            </button>
          );
        })}
      </div>
      <p className="hint" id="wxSun">{sun ? 'Sunrise ' + Wx.hourText(sun.rise) + '  ·  Sunset ' + Wx.hourText(sun.set) + '. Shade matters most between these times.' : ''}</p>
    </>
  );
}

const SIMS = [['', 'Real weather'], ['8', 'Showers'], ['25', 'Heavy'], ['45', 'Storm'], ['70', 'Extreme']];
export function StormSim() {
  useStore();
  return (
    <div className="sim">
      <span className="lbl">Demo: simulate a storm</span>
      <div className="chips" id="simChips" role="group" aria-label="Simulated rain">
        {SIMS.map(function (s) {
          const on = s[0] === '' ? ui.sim === null : Number(s[0]) === ui.sim;
          return <button type="button" key={s[0]} className="chip" data-sim={s[0]} aria-pressed={on} onClick={function () { setSim(s[0] === '' ? null : Number(s[0])); }}>{s[1]}</button>;
        })}
      </div>
      <p className="hint" id="simNote">{ui.sim !== null ? 'Routes and flood warnings are using the simulated rain. Choose Real weather to go back.' : 'Real rain is usually light. Simulate a storm to see Teduh re-route around flooding.'}</p>
    </div>
  );
}
