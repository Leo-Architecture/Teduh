import { useState } from 'react';
import { useStore } from '../hooks.js';
import { getImpact, round1 } from '../store.js';
import { L } from '../engines.js';

// Teduh routes compared with the shortest routes over typical trips, with fixed reference conditions.
export default function Impact() {
  useStore();
  const [walkers, setWalkers] = useState('1000');
  const m = getImpact();
  if (!m) return null;
  const sc = L.SCENARIOS;
  const w = Math.max(0, Math.min(1000000, Number(walkers) || 0));
  return (
    <section className="sec card impact" aria-label="Modelled impact">
      <h2>Impact (modelled)</h2>
      <p className="sub" id="impSub">Shortest route compared with the Teduh route, for every typical trip and all 5 walker types.</p>
      <div className="kpis" id="impKpis">
        {m.sun ? (
          <>
            <div className="kpi"><b>{m.sun.savedPct}%</b><span>less time in direct sun on the Teduh route. {round1(m.sun.stdMin)} min on the shortest route, {round1(m.sun.tedMin)} min on Teduh. Reference: {sc.sun.label}.</span></div>
            <div className="kpi"><b>+{round1(Math.max(0, m.sun.extraMin))} min</b><span>average extra walking time for that shade, across all trips and walker types.</span></div>
          </>
        ) : null}
        <div className="kpi"><b>{m.rain.kept} of {m.rain.wet}</b><span>trips that cross a flooding or rising road on the shortest route, and stay dry on the Teduh route. Reference: {sc.rain.label}.</span></div>
        <div className="kpi"><b>{m.trips}</b><span>typical trips between landmarks, each checked for all 5 walker types ({m.pairs} comparisons).</span></div>
      </div>
      <div className="fld imp-scale">
        <label className="lbl" htmlFor="impWalkers">Your assumption: walkers per day in the township</label>
        <input type="number" id="impWalkers" min="0" max="1000000" step="100" inputMode="numeric" value={walkers} onChange={function (ev) { setWalkers(ev.target.value); }} />
      </div>
      <p className="hint" id="impScale">{m.sun ? 'If ' + w.toLocaleString('en-MY') + ' people walk a typical trip each day, that is about ' + Math.round(w * m.sun.savedMin).toLocaleString('en-MY') + ' minutes a day out of the sun (sunny afternoon). This is arithmetic on your assumption, not a forecast.' : ''}</p>
      <p className="hint">These numbers come from a model with fixed reference conditions, not from measurements. Real impact would be measured in a pilot: minutes in the sun, trips kept dry, and drains cleared faster.</p>
    </section>
  );
}
