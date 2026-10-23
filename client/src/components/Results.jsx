import { useStore } from '../hooks.js';
import { ui, getG, profile, routeStats, plural, uniq, setPick, startJourney, previewDaytime, backToLive, hazardsOf, hazardPhrase } from '../store.js';
import { L, Nav } from '../engines.js';

function Dash({ kind }) {
  return kind === 'teduh'
    ? <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--accent)" strokeWidth="4.5" strokeLinecap="round" /></svg>
    : <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--sun)" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 4" /></svg>;
}

function Flood({ s }) {
  if (s.flooded.length) {
    return <><span className="pill p-bad">Flooded</span><span>Crosses {plural(s.flooded.length, 'flooded road')}: {uniq(s.flooded.map(function (e) { return e.where; })).slice(0, 3).join(', ')}{s.flooded.length > 3 ? ' and more' : ''}.</span></>;
  }
  if (s.risk.length) {
    return <><span className="pill p-risk">Rising</span><span>Passes {plural(s.risk.length, 'road')} where water is rising: {uniq(s.risk.map(function (e) { return e.where; })).slice(0, 3).join(', ')}{s.risk.length > 3 ? ' and more' : ''}.</span></>;
  }
  return <><span className="pill p-ok">Clear</span><span>No flooding or rising water on this route.</span></>;
}

function RouteCard({ kind, title, s, c }) {
  const P = profile();
  const sun = Math.round(s.sunMin);
  const via = s.via.slice(0, 4).join(', then ') + (s.via.length > 4 ? ', and ' + (s.via.length - 4) + ' more' : '');
  const extras = [];
  if (s.coveredPct > 0) extras.push('covered walkway ' + s.coveredPct + '%');
  if (c.dark > 0.5) extras.push('lit streets ' + s.litPct + '%');
  if (s.stepsN) extras.push(plural(s.stepsN, 'flight') + ' of steps');
  const picked = (kind === 'teduh') === (ui.pick !== 'std');
  function choose() { setPick(kind); }
  return (
    <article className={'rc rc-' + kind + (picked ? ' picked' : '')} data-route={kind} role="button" tabIndex={0} aria-pressed={picked}
      onClick={choose} onKeyDown={function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(); } }}>
      <h3><Dash kind={kind} />{title}{picked ? <span className="sel">Selected</span> : null}</h3>
      <p className="via">via {via}</p>
      <dl>
        <div><dt>Distance</dt><dd>{s.dist} <small>m</small></dd></div>
        <div><dt>{P.verb === 'ride' ? 'Ride' : 'Walk'}</dt><dd>{Math.max(1, Math.round(s.min))} <small>min</small></dd></div>
        <div><dt>In shade</dt><dd>{s.shadedPct}<small>%</small></dd></div>
        <div><dt>Sun exposure</dt><dd>{sun < 1 ? '<1' : sun} <small>min</small></dd></div>
      </dl>
      {extras.length ? <p className="via" style={{ marginTop: 8 }}>{extras.join(' · ')}</p> : null}
      <p className="fl"><Flood s={s} /></p>
    </article>
  );
}

// The headline, the two route cards and the Start buttons.
export default function Results() {
  useStore();
  const G = getG();
  const P = profile();
  if (!G) return <div className="cards-wrap"><p className="headline" id="headline">Loading the map.</p></div>;
  const a = ui.start && ui.start.node !== undefined ? ui.start.node : -1, b = ui.dest && ui.dest.node !== undefined ? ui.dest.node : -1;
  let headline = '', body = null, extra = null;
  if (!ui.start || !ui.dest) {
    headline = ui.start || ui.dest ? 'Now choose ' + (ui.start ? 'a destination' : 'a start') + '.' : 'Where to? Choose a start and destination.';
  } else if (a < 0 || b < 0) {
    headline = ui.loading ? 'Loading the roads for this trip.' : 'These places are not on the loaded roads yet.';
  } else if (a === b) {
    headline = 'Pick two different spots.';
  } else {
    const r = routeStats();
    if (!r.S || !r.T) {
      headline = 'There is no way between these two spots for ' + P.label.toLowerCase() + '. Try another start or destination.';
    } else {
      const ss = r.ss, ts = r.ts, c = r.c;
      if (ts.flooded.length) {
        headline = 'No fully dry route right now. Teduh picks the least flooded one, but waiting for the rain to ease is safer.';
      } else if (L.sameRoute(r.S, r.T)) {
        headline = c.sunLoad < 0.05
          ? 'No sun to avoid right now, so Teduh and the shortest route match. Teduh only chooses differently when it is sunny, raining or flooded.'
          : 'The shortest route is also the best one in these conditions. Try the storm simulator on the Weather page to see Teduh choose differently.';
        if (c.sunLoad < 0.05 && ui.wx && !ui.preview) extra = <button type="button" className="btn ghost sm" id="dayBtn" onClick={previewDaytime}>See the routes at midday</button>;
        else if (ui.preview) extra = <button type="button" className="btn ghost sm" id="liveBtn" onClick={backToLive}>Back to now</button>;
      } else {
        const parts = [], dd = ts.dist - ss.dist;
        parts.push(dd > 0 ? 'adds ' + dd + ' m' : dd < 0 ? 'saves ' + (-dd) + ' m' : 'keeps the same distance');
        const dsun = Math.round(ss.sunMin - ts.sunMin);
        if (dsun >= 1) parts.push('cuts sun exposure by ' + dsun + ' min');
        if (ts.coveredPct > ss.coveredPct + 4) parts.push('adds ' + (ts.coveredPct - ss.coveredPct) + '% covered walkway');
        const bad = uniq(ss.flooded.concat(ss.risk).map(function (e) { return e.where; }));
        if (bad.length) parts.push('avoids ' + bad.slice(0, 2).join(' and ') + (bad.length > 2 ? ' and ' + (bad.length - 2) + ' more' : ''));
        headline = 'Teduh ' + parts.join(', ') + '.';
      }
      const chosen = ui.pick === 'std' ? ss : ts;
      const hz = hazardsOf(ui.cur.line, c);
      const wet = hz.some(function (h) { return h.status === 'flooded' || h.status === 'risk'; });
      const altN = ui.pick === 'std' && ui.cur.T ? hazardsOf(Nav.routeLine(getG(), ui.cur.T), c).length : hz.length;
      const warn = hz.length ? (
        <p className="note err" id="routeWarn" role="alert">
          <b>Warning before you start:</b> {hz.slice(0, 3).map(function (h) { return h.where + ' ' + hazardPhrase(h); }).join('; ')}{hz.length > 3 ? '; and ' + (hz.length - 3) + ' more' : ''}.
          {ui.pick === 'std' ? (altN < hz.length ? ' The Teduh route avoids ' + (altN ? 'some of them' : 'them') + '.' : '')
            : (wet ? ' Teduh tried every other road and verified resident path and none avoids it.' : ' Teduh found no reasonable way round it.') + ' You will be warned again as you get near.'}
        </p>
      ) : null;
      body = (
        <>
          <div className="cards" id="cards">
            <RouteCard kind="std" title="Shortest route" s={ss} c={c} />
            <RouteCard kind="teduh" title="Teduh route" s={ts} c={c} />
          </div>
          {warn}
          <div className="startbar" id="startBar">
            <button type="button" className="btn big" id="startBtn" onClick={function () { startJourney(false); }}>Start · {Math.max(1, Math.round(chosen.min))} min</button>
            <button type="button" className="btn ghost" id="demoBtn" title="Walks the route with simulated GPS, for demos" onClick={function () { startJourney(true); }}>Demo walk</button>
          </div>
          <p className="hint" id="cardHint">Tap a route to choose it. Sun exposure counts minutes without shade, scaled by the sun's strength at the time.</p>
        </>
      );
    }
  }
  return (
    <div className="cards-wrap" aria-live="polite">
      <p className="headline" id="headline">{headline}</p>
      {extra}
      {body}
    </div>
  );
}
