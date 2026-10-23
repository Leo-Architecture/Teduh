import { useEffect, useRef } from 'react';
import { attachMap } from '../store.js';

// The one shared map is moved into whichever page is showing, so its position and zoom are kept.
export function MapHost() {
  const ref = useRef(null);
  useEffect(function () { return attachMap(ref.current); }, []);
  return <div ref={ref} className="maphost" />;
}

function Sw({ children }) {
  return <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">{children}</svg>;
}

export function Legend({ walk, paths }) {
  return (
    <figcaption className="legend" id="legend">
      <span><Sw><circle cx="6" cy="6" r="4" fill="var(--canopy)" opacity=".6" /><circle cx="13" cy="7" r="3.5" fill="var(--canopy)" opacity=".5" /></Sw>Tree shade</span>
      <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="var(--road)" strokeWidth="8" strokeLinecap="round" /><line x1="1" y1="6" x2="19" y2="6" stroke="var(--cover)" strokeWidth="2.5" /></Sw>Covered walkway</span>
      <span><Sw><circle cx="10" cy="6" r="5.5" fill="var(--warn)" /><path d="M6.5 4h7M6.5 6h7M6.5 8h7" stroke="#fff" strokeWidth="1.2" /></Sw>Blocked drain</span>
      <span><Sw><circle cx="10" cy="6" r="5.5" fill="var(--rain)" /><path d="M10 2.8C12 5 12.4 6.6 10 8.8 7.6 6.6 8 5 10 2.8z" fill="#fff" /></Sw>Flooded road report</span>
      <span><Sw><circle cx="10" cy="6" r="5.5" fill="var(--rain)" /><path d="M10 9V3M8 5l2-2 2 2" stroke="#fff" strokeWidth="1.3" fill="none" /></Sw>Water rising report</span>
      <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" strokeWidth="8" strokeLinecap="round" /></Sw>Flooded</span>
      <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" strokeWidth="8" strokeLinecap="round" opacity=".28" /><line x1="1" y1="6" x2="19" y2="6" stroke="var(--rain)" strokeWidth="2" strokeDasharray="3 3" /></Sw>Water rising</span>
      {paths ? <>
        <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="#15803D" strokeWidth="3" /></Sw>Verified path</span>
        <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="#D97706" strokeWidth="3" strokeDasharray="5 3" /></Sw>Unverified path</span>
        <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="#7C3AED" strokeWidth="3" strokeDasharray="5 3" /></Sw>Path you are tracing</span>
      </> : null}
      {walk ? <>
        <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="var(--sun)" strokeWidth="5" strokeLinecap="round" strokeDasharray="6 4" /></Sw>Shortest route</span>
        <span><Sw><line x1="1" y1="6" x2="19" y2="6" stroke="var(--accent)" strokeWidth="4.5" strokeLinecap="round" /></Sw>Teduh route</span>
        <span><Sw><circle cx="10" cy="6" r="4.5" fill="#fff" /><circle cx="10" cy="6" r="3" fill="#2563EB" /></Sw>You</span>
      </> : null}
    </figcaption>
  );
}

// The map with an optional row of tools under it and the key.
export default function MapCard({ walk, tools, paths }) {
  return (
    <figure className="mapwrap">
      <MapHost />
      {tools ? <div className="tools"><span className="lbl">Map tools</span><div className="chips" id="tools">{tools}</div></div> : null}
      <Legend walk={walk} paths={paths} />
    </figure>
  );
}
