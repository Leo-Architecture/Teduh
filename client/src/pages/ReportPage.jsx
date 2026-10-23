import { useEffect } from 'react';
import { useStore } from '../hooks.js';
import { ui, setMapMode, setTool } from '../store.js';
import MapCard from '../components/MapCard.jsx';
import ReportForm from '../components/ReportForm.jsx';

export default function ReportPage() {
  useStore();
  useEffect(function () { setMapMode('report'); }, []);
  return (
    <div className="split">
      <div className="split-a">
        <section className="sec card">
          <h2>Report a problem</h2>
          <p className="sub" id="repHint">Flooded road, rising water, blocked drain or a fallen branch? Tell everyone and the township team. Reports update the routes for everyone.</p>
          <ol className="steps">
            <li><b>1</b><span>Choose <b>Tap a road</b> below the map.</span></li>
            <li><b>2</b><span>Tap the road where the problem is.</span></li>
            <li><b>3</b><span>Add a note or a photo, then send. A blocked drain lowers that street's flood level at once.</span></li>
          </ol>
          <div className="chips">
            <button type="button" className="chip" id="repTool" aria-pressed={ui.tool === 'report'} onClick={function () { setTool('report'); }}>Tap a road</button>
          </div>
          {ui.notice ? <p className="note" id="notice" role="status">{ui.notice}</p> : null}
        </section>
        <ReportForm />
      </div>
      <div className="split-b">
        <MapCard walk={false} />
      </div>
    </div>
  );
}
