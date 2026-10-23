import { useStore } from '../hooks.js';
import { ui, getG, conds, alertList, rainSource, round1, toggleShowAll } from '../store.js';

// Roads where water is rising, using the rain on screen (live, previewed or simulated).
export default function AlertsList() {
  useStore();
  if (!getG()) return null;
  const c = conds(), list = alertList(c);
  const shown = ui.showAll ? list : list.slice(0, 5);
  return (
    <section className="sec card" id="floodSec">
      <h2>Flood early warning</h2>
      <p className="sub" id="alertSub">Roads where water is rising, using {rainSource()} ({round1(c.rain)} mm/h), plus floods reported by residents in the last 3 hours.</p>
      <ul className="alerts" id="alerts">
        {!list.length ? <li><div className="empty" style={{ width: '100%' }}>No roads at risk at {round1(c.rain)} mm/h. Pick a storm above to see warnings appear. See water on a road? <a href="#/report">Report it</a> and it shows here and on the map for everyone.</div></li> : null}
        {shown.map(function (x) {
          const f = x.s === 'flooded';
          return (
            <li key={x.e.id}>
              <span className={'pill ' + (f ? 'p-bad' : 'p-risk')}>{f ? 'Flooded now' : 'Rising'}</span>
              <div className="txt"><b>{x.e.where}</b><span>{x.e.live ? (f ? 'Reported by a resident: water is over the road.' : 'Reported by a resident: water is rising or pooling.') : (f ? 'Water is over the road.' : 'May flood if rain continues.') + ' Floods at about ' + x.e.thr + ' mm/h' + (x.e.blocked ? ', drain blocked' : '') + '.'}</span></div>
            </li>
          );
        })}
        {list.length > 5 ? <li><button type="button" className="btn ghost sm" id="moreBtn" aria-expanded={ui.showAll} onClick={toggleShowAll}>{ui.showAll ? 'Show fewer' : 'Show ' + (list.length - 5) + ' more'}</button></li> : null}
      </ul>
    </section>
  );
}
