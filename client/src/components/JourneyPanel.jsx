import { useStore } from '../hooks.js';
import { ui, profile, destLabel, endNav, recenter, toggleVoice, hazardPhrase } from '../store.js';
import { Nav, Wx } from '../engines.js';

function Arrow({ kind }) {
  if (kind === 'arrive') {
    return <svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 35s-10-8.4-10-16a10 10 0 0 1 20 0c0 7.6-10 16-10 16z" fill="currentColor" /><circle cx="20" cy="19" r="3.6" fill="var(--nav-bg)" /></svg>;
  }
  const rot = { straight: 0, depart: 0, 'slight-right': 45, right: 90, uturn: 180, 'slight-left': -45, left: -90 }[kind] || 0;
  return <svg viewBox="0 0 40 40" width="40" height="40"><g fill="currentColor" transform={'rotate(' + rot + ' 20 20)'}><path d="M20 5 L31 18 H23.5 V35 H16.5 V18 H9 Z" /></g></svg>;
}

// Turn-by-turn guidance while the journey runs.
export default function JourneyPanel() {
  useStore();
  const n = ui.nav;
  if (!n) return null;
  const P = profile();
  const minLeft = n.left / P.speed;
  const clock = ui.clock;
  let kind = 'straight', dist = '...', text = n.msg || 'Waiting for GPS.', then = 'First turn: ' + n.steps[0].text;
  if (n.arrived) {
    kind = 'arrive'; dist = 'You have arrived'; text = destLabel(); then = 'Journey took ' + Math.max(1, Math.round((Date.now() - n.started) / 60000)) + ' min.';
  } else if (n.pos || n.sim) {
    let show, nxt;
    if (n.along < 12 && n.steps.length > 1) { show = n.steps[0]; nxt = n.steps[1]; dist = Nav.metres(n.steps[1].at - n.along); }
    else {
      const pr = Nav.progress(n.steps, n.along);
      show = pr.next; dist = Nav.metres(pr.toNext);
      nxt = n.steps[Math.min(pr.index + 2, n.steps.length - 1)];
      if (nxt === show) nxt = null;
    }
    kind = show.kind; text = show.text;
    then = nxt ? 'Then ' + nxt.text.charAt(0).toLowerCase() + nxt.text.slice(1) : '';
  }
  // weather and cover ahead
  const bits = [];
  if (!n.arrived) {
    if (ui.sim !== null) bits.push('Simulated storm of ' + ui.sim + ' mm/h');
    else if (ui.wx) {
      const out = Wx.rainOutlook(ui.wx, ui.clock, 30, 0.5), p = Wx.nowSample(ui.wx), d = p ? Wx.describe(p.code, p.isDay) : null;
      if (out && out.inMin === 0) bits.push('Raining now (' + Wx.rainWord(out.rain).toLowerCase() + ')');
      else if (out) bits.push('Rain expected in about ' + out.inMin + ' min');
      else bits.push('Dry for the next 30 min');
      if (d && p.temp !== null) bits.push(Math.round(p.temp) + '°C, ' + d.label.toLowerCase());
    }
    for (let k = 0; k < n.line.parts.length; k++) {
      const pt = n.line.parts[k];
      if (!pt.edge.covered || n.line.cum[pt.to] <= n.along) continue;
      const ahead = n.line.cum[pt.from] - n.along;
      bits.push(ahead <= 5 ? 'Under a covered walkway' : ahead < 400 ? 'Covered walkway in ' + Nav.metres(ahead) : '');
      break;
    }
  }
  let gps = '';
  if (!n.arrived) {
    if (n.gpsErr) gps = n.gpsErr + ' Showing your last position.';
    else gps = n.sim ? 'Simulated GPS (demo walk)' : !n.pos ? (n.msg || 'Waiting for GPS.') :
      (n.msg && n.off ? n.msg + ' ' : '') + 'GPS ' + (n.pos.acc <= 20 ? 'good' : n.pos.acc <= 50 ? 'fair' : 'weak') + ' (within ' + Math.round(n.pos.acc) + ' m)' + (n.reroutes && n.msg ? ' · ' + n.msg : '');
  }
  return (
    <section className={'nav' + (n.arrived ? ' arrived' : '')} id="nav" aria-label="Journey">
      {!n.arrived && (n.zone || n.near || n.startWarn) ? (
        <p className="nav-warn" id="navWarn" role="alert">
          <b>{n.zone ? 'You are on a problem stretch' : n.near ? 'Caution ahead' : 'Warning'}</b>{' '}
          {n.zone ? n.zone.h.where + ' ' + hazardPhrase(n.zone.h) + '. About ' + Nav.metres(n.zone.left) + ' to go before it ends. Take care.' : n.near ? n.near.text : n.startWarn.replace(/^Warning\. /, '')}
        </p>
      ) : null}
      <div className="nav-main">
        <div className="nav-arrow" id="navArrow" aria-hidden="true"><Arrow kind={kind} /></div>
        <div className="nav-txt">
          <p className="nav-dist" id="navDist">{dist}</p>
          <p className="nav-text" id="navText">{text}</p>
          <p className="nav-then" id="navThen">{then}</p>
        </div>
      </div>
      <div className="nav-stats">
        <div><span className="lbl">Arrive</span><b id="navEta">{n.arrived ? Wx.clockText(clock, false) : Wx.hourText(clock.h + minLeft / 60)}</b></div>
        <div><span className="lbl" id="navMinLbl">{P.verb === 'ride' ? 'Ride' : 'Walk'}</span><b id="navMin">{n.arrived ? '0 min' : Math.max(1, Math.round(minLeft)) + ' min'}</b></div>
        <div><span className="lbl">Left</span><b id="navLeft">{Nav.metres(n.left)}</b></div>
      </div>
      <p className="nav-wx" id="navWx">{bits.filter(Boolean).join(' · ')}</p>
      <p className="nav-gps" id="navGps" role="status">{gps}</p>
      <div className="row nav-btns">
        <button type="button" className="btn ghost sm" id="navRecenter" onClick={recenter}>Recenter</button>
        <button type="button" className="btn ghost sm" id="navVoice" aria-pressed={ui.voice} onClick={toggleVoice}>{ui.voice ? 'Voice on' : 'Voice off'}</button>
        <button type="button" className="btn danger sm" id="navEnd" onClick={function () { endNav(); }}>{n.arrived ? 'Done' : 'End journey'}</button>
      </div>
    </section>
  );
}
