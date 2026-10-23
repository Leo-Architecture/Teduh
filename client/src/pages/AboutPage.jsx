import { useStore } from '../hooks.js';
import { ui } from '../store.js';
import { L } from '../engines.js';

const STEPS = [
  ['Open data', 'Roads, footpaths, trees, buildings and covered walkways come from OpenStreetMap. Rain, UV, sunrise and sunset and terrain height come from Open-Meteo. When an IQAir key is set, the temperature, humidity, wind, air quality and place name come from IQAir for where you are.'],
  ['A walking network', 'Each street gets a shade score (trees plus the shadows of nearby buildings, worked out from the position of the sun for each hour), a covered-walkway flag, lighting, steps, and a flood threshold in mm/h.'],
  ['A route for each walker', 'A cost model weighs time, sun, lighting, busy roads and steps differently for pedestrians, women, children, bicyclists and senior citizens.'],
  ['Paths residents discover', 'Residents trace paths that road maps miss (dirt shortcuts, footbridges, steps) on a satellite view. Once a second person confirms a path, or the Township Team approves it, Teduh routes can use it. The shortest route does not know these paths, so the two routes can differ.'],
  ['Live guidance', 'GPS tracking, turn-by-turn steps that are repeated as you near each turn (about 150 m, 60 m and at the turn), and a new route if you leave the path. Flooded roads, rising water, standing water, blocked drains and fallen branches are warned about before you start and again as you get near, in any weather.']
];

export default function AboutPage() {
  useStore();
  return (
    <div className="page-narrow about">
      <section className="hero">
        <h2>Walk the township cool and dry</h2>
        <p>Teduh (Malay for shade) plans walking routes that favour shade and covered walkways, and warns about streets where water is likely to rise in heavy rain. It works anywhere in Malaysia, on open data.</p>
        <div className="chips"><a className="btn" href="#/">Plan a walk</a><a className="btn ghost" href="#/team">See the Township Team page</a></div>
      </section>

      <section className="sec card">
        <h2>How it works</h2>
        <ol className="steps big">
          {STEPS.map(function (s, i) { return <li key={i}><b>{i + 1}</b><span><strong>{s[0]}.</strong> {s[1]}</span></li>; })}
        </ol>
      </section>

      <section className="sec card" id="whatsNew">
        <h2>What is new</h2>
        <ul className="plain">
          <li><b>Path Discovery.</b> Trace missing paths on a satellite view (needs a MapTiler key). Add the kind, the surface, a note and a photo. An AI (Groq) describes the photo only; it does not draw the path. You can edit your own path later: a note change keeps it verified, but a new line, kind or surface is checked again. Only the Township Team approves or rejects paths. Paths inside buildings cannot be seen from satellite, so they are not covered.</li>
          <li><b>Warnings in any weather.</b> If a flooded road, rising water, standing water, blocked drain or fallen branch is on your route, Teduh says so before you start and again about 80 m before it. It goes round the problem when a reasonable way exists, using roads and verified resident paths. If none exists, it warns you instead.</li>
          <li><b>Clearer voice guide.</b> Each turn is announced three times as you approach it. The sound can be switched off with the sound button.</li>
          <li><b>Weather where you are.</b> The weather page uses your location if you allow it, and loads the roads around you. If you refuse, it uses the middle of the loaded area and says so.</li>
          <li><b>Pin anywhere.</b> Choose on map lets you drop a start or destination anywhere. A pin away from the roads joins the nearest road, and the gap is drawn as a dotted line.</li>
          <li><b>Building shadows.</b> Shade now includes the shadows of nearby buildings, worked out from the sun's position for each hour.</li>
          <li><b>Township Team accounts.</b> Staff sign up with a staff ID and organisation email (one account each), sign in with a username and password, and can reset the password by an emailed link. The team works the <i>Listed issues</i> list and sends a before and an after photo (video optional) to close an issue. The Teduh admin team approves or rejects each clearance, and removes accounts on request.</li>
        </ul>
        <p className="hint">Teduh cannot check that a staff ID belongs to the person. In a real rollout the organisation would limit sign-up to its own email domain and confirm its staff list.</p>
      </section>

      <section className="sec card">
        <h2>Who is walking</h2>
        <ul className="walkers">
          {L.PROFILE_ORDER.map(function (id) { return <li key={id}><b>{L.PROFILES[id].label}</b></li>; })}
        </ul>
        <p className="hint">Women weigh well-lit streets more, children avoid busy roads without a pavement, bicyclists ride faster on bike-friendly roads, and senior citizens weigh sun and steps the most.</p>
      </section>

      <details className="how card" id="floodHow" open>
        <summary>How we estimate flooding</summary>
        <ol>
          <li><b>Terrain.</b> Each road's height comes from Open-Meteo elevation (about 90 m resolution). A road that sits lower than the roads around it collects water first.</li>
          <li><b>Water nearby.</b> Streams, rivers and drains mapped in OpenStreetMap lower a road's threshold the closer it is to them.</li>
          <li><b>The threshold.</b> Each road gets a rainfall rate (mm/h) at which we expect water on the road. The warning compares that with the rain forecast for the hours of your walk.</li>
          <li><b>Resident reports.</b> A blocked-drain report lowers that road's threshold to 60% of normal (an assumption). Other reports raise its place in the Listed issues list. The Township Team closes an issue by sending a before and an after photo, and once the Teduh admin team approves it the normal value returns.</li>
        </ol>
        <p><b>What this is not.</b> It is an estimate, not a flood map. Public services do not publish drain capacity or past flood records. Connecting the township's own records, and checking the estimate against where water really collected, is the first step of a pilot.</p>
        <p><b>Simulated data in this demo.</b> The storm buttons on the Weather page, the Demo walk (simulated GPS), the Add demo paths button and the sample township used when offline are simulations, and the screen says so. The Impact panel uses fixed reference conditions.</p>
      </details>

      <details className="how card" open>
        <summary>What powers this</summary>
        <ul id="dataNotes">
          {ui.dataNotes.map(function (n, i) { return <li key={i}>{n}</li>; })}
        </ul>
        <p>The flood level for each road is an estimate until the township's drain and flood records are connected. The route cost is a simple model, not a measured one. Weather forecasts cover a few kilometres per grid square, so they describe the area around your walk, not each street. IQAir's free plan has no rain or forecast, so rain and the 24-hour outlook still come from Open-Meteo.</p>
      </details>
    </div>
  );
}
