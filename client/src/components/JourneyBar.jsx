import { useStore } from '../hooks.js';
import { ui, profile, destLabel } from '../store.js';
import { Nav, Wx } from '../engines.js';

// A slim reminder shown on the other pages while a journey is running.
export default function JourneyBar() {
  useStore();
  const n = ui.nav;
  if (!n) return null;
  const P = profile();
  const min = Math.max(1, Math.round(n.left / P.speed));
  return (
    <a className={'jbar' + (n.arrived ? ' arrived' : '')} href="#/" role="status">
      <b>{n.arrived ? 'You have arrived' : 'Journey in progress'}</b>
      <span>{n.arrived ? destLabel() : 'to ' + destLabel() + ' · ' + Nav.metres(n.left) + ' · ' + min + ' min · arrive ' + Wx.hourText(ui.clock.h + n.left / P.speed / 60)}</span>
      <span className="jbar-go">Open</span>
    </a>
  );
}
