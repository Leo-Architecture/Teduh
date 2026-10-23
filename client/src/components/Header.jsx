import { useStore, useClock } from '../hooks.js';
import { ui, getG } from '../store.js';
import { Wx } from '../engines.js';

function Clock() {
  const n = useClock();
  return (
    <div className="clockbox" role="timer" aria-label="Time in Malaysia">
      <span className="clock" id="clockTime">{Wx.clockText(n)}</span>
      <span className="clockdate" id="clockDate">{n.dateLabel + ' · Malaysia time'}</span>
    </div>
  );
}

export default function Header() {
  useStore();
  const G = getG();
  const mode = !G ? 'Starting' : ui.online ? (G.ds.source === 'sample' ? 'Sample, shared live' : 'Live: ' + G.name) : 'Demo data, this device only';
  return (
    <header className="top">
      <a className="brand" href="#/" aria-label="Teduh home">
        <img className="brand-mark" src="mark.png" width="33" height="44" alt="" />
        <div>
          <h1>Teduh</h1>
          <p className="tagline">Walk the township cool and dry.</p>
        </div>
      </a>
      <Clock />
      <span className="tag" id="modeTag">{mode}</span>
    </header>
  );
}
