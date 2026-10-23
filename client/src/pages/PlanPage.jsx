import { useEffect } from 'react';
import { useStore } from '../hooks.js';
import { ui, getG, setMapMode, setProfile, swapPoints, demoTrip, loadHere } from '../store.js';
import { L } from '../engines.js';
import PlaceInput from '../components/PlaceInput.jsx';
import MapCard from '../components/MapCard.jsx';
import Results from '../components/Results.jsx';
import JourneyPanel from '../components/JourneyPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

function Dirs() {
  const G = getG();
  return (
    <section className="card dirs" aria-label="Plan a walk">
      <PlaceInput which="from" label="Start" placeholder="Choose start location" />
      <PlaceInput which="to" label="Destination" placeholder="Choose destination" />
      <button type="button" className="swap" id="swap" aria-label="Swap start and destination" onClick={swapPoints}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>
      </button>
      {ui.planMsg ? <p className="hint" id="planMsg" role="status">{ui.planMsg}</p> : null}
      {G && !ui.start && !ui.dest && !ui.nav ? <div className="chips" id="demoRow"><button type="button" className="chip" id="demoTrip" onClick={demoTrip}>Show a trip where Teduh differs</button></div> : null}
      {ui.areaMsg ? <p className="hint" id="areaNote" role="status">{ui.areaMsg}</p> : null}
    </section>
  );
}

function Profiles() {
  return (
    <div className="fld">
      <span className="lbl" id="profLbl">Who is walking?</span>
      <div className="chips" id="profiles" role="group" aria-labelledby="profLbl">
        {L.PROFILE_ORDER.map(function (id) {
          return <button type="button" key={id} className="chip" data-profile={id} aria-pressed={ui.profile === id} onClick={function () { setProfile(id); }}>{L.PROFILES[id].label}</button>;
        })}
      </div>
    </div>
  );
}

export default function PlanPage() {
  useStore();
  useEffect(function () { setMapMode('plan'); }, []);
  const nav = ui.nav;
  return (
    <div className="plan">
      <div className="plan-a">
        {nav ? <JourneyPanel /> : <><Dirs /><Profiles /></>}
      </div>
      <div className="plan-map">
        <MapCard walk tools={<>
          <button type="button" className="chip ghost" id="loadHere" onClick={loadHere}>Load roads here</button>
          <a className="chip ghost" href="#/report">Report a problem</a>
        </>} />
        {ui.notice ? <p className="note" id="notice" role="status">{ui.notice}</p> : null}
      </div>
      <div className="plan-b">
        {nav ? null : <Results />}
        {nav ? null : <ChatPanel />}
      </div>
    </div>
  );
}
