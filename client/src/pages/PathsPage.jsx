import { useEffect } from 'react';
import { useStore } from '../hooks.js';
import {
  ui, setMapMode, toggleSatellite, startTrace, stopTrace, undoPoint, cancelPath, setPathField, selectPath, choosePathPhoto,
  clearPathPhoto, checkPathPhoto, sendPath, confirmPath, addDemoPaths, deviceId, pathMetres, editPath, reverseDraft
} from '../store.js';
import MapCard from '../components/MapCard.jsx';

const KINDS = [['trail', 'Trail'], ['shortcut', 'Shortcut'], ['footbridge', 'Footbridge'], ['stairs', 'Stairs']];
const SURFACES = [['paved', 'Paved'], ['concrete', 'Concrete'], ['boardwalk', 'Boardwalk'], ['gravel', 'Gravel'], ['mud', 'Mud'], ['grass', 'Grass']];

function Status({ p }) {
  if (p.status === 'verified') return <span className="pill p-ok">Verified</span>;
  return <span className="pill p-risk">Unverified</span>;
}

function viaText(p) {
  if (p.status !== 'verified') return 'Waiting for one more person to confirm, or the township team.';
  const base = p.via === 'team' ? 'Approved by the township team.' : 'Confirmed by a second resident.';
  return base + (p.connected === false ? ' Too far from a mapped road to join routes.' : ' Teduh routes can use it.');
}

function Form() {
  const d = ui.pathDraw;
  if (!d) return null;
  const a = d.ai;
  const aiText = a ? 'AI photo check: ' + (a.walkable === false ? 'does not look walkable. ' : 'looks walkable. ') + (a.condition ? 'Condition: ' + a.condition + '. ' : '') + (a.summary || '') : (d.aiMsg || '');
  const len = d.pts.length >= 2 ? pathMetres(d.pts) : 0;
  return (
    <form className="rep card" id="pathForm" onSubmit={function (ev) { ev.preventDefault(); sendPath(); }}>
      {d.editId ? <p className="sub" style={{ marginBottom: 6 }}>You are editing your path. Change the description freely. If you change the line, kind or surface, it is checked again before routes use it.</p> : null}
      <p className="spot" id="pathSpot">{d.pts.length} point{d.pts.length === 1 ? '' : 's'}{len ? ', about ' + len + ' m' : ''}</p>
      <div className="fld">
        <label className="lbl" htmlFor="pathKind">Kind of path</label>
        <select id="pathKind" value={d.kind} onChange={function (ev) { setPathField('kind', ev.target.value); }}>
          {KINDS.map(function (k) { return <option key={k[0]} value={k[0]}>{k[1]}</option>; })}
        </select>
      </div>
      <div className="fld">
        <label className="lbl" htmlFor="pathSurface">Surface</label>
        <select id="pathSurface" value={d.surface} onChange={function (ev) { setPathField('surface', ev.target.value); }}>
          {SURFACES.map(function (k) { return <option key={k[0]} value={k[0]}>{k[1]}</option>; })}
        </select>
      </div>
      <div className="fld">
        <label className="lbl" htmlFor="pathNoteIn">Note (optional)</label>
        <input id="pathNoteIn" maxLength={80} autoComplete="off" placeholder="For example: muddy after rain, no light" value={d.note} onChange={function (ev) { setPathField('note', ev.target.value); }} />
      </div>
      <div className="photo">
        <label className="btn ghost sm" htmlFor="pathFile">Add a photo</label>
        <input type="file" id="pathFile" accept="image/*" className="sr" onChange={function (ev) { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; choosePathPhoto(f); }} />
        {d.photo ? <img id="pathPreview" src={d.photo} alt="The photo you chose" /> : null}
        {d.photo ? <button type="button" className="btn ghost sm" onClick={clearPathPhoto}>Remove photo</button> : null}
      </div>
      <button type="button" className={'btn ghost sm' + (ui.online && ui.features.pathAi ? '' : ' off')} id="pathAiBtn" disabled={!!d.busy} onClick={checkPathPhoto}>Check photo with AI</button>
      <p className="sub" style={{ marginTop: 6 }}>The AI only looks at your photo. It does not draw the path: you do.</p>
      {aiText ? <p className="aibox" id="pathAi">{aiText}</p> : null}
      <div className="row">
        <button type="submit" className="btn" id="pathSend" disabled={!!d.busy}>{d.editId ? 'Save changes' : 'Send path'}</button>
        <button type="button" className="btn ghost" id="pathCancel" onClick={cancelPath}>Cancel</button>
      </div>
    </form>
  );
}

export default function PathsPage() {
  useStore();
  useEffect(function () { setMapMode('paths'); }, []);
  const tracing = ui.tool === 'path', d = ui.pathDraw;
  const me = deviceId();
  const list = ui.paths.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  return (
    <div className="split">
      <div className="split-a">
        <section className="sec card">
          <h2>Discover paths</h2>
          <p className="sub">Maps show roads for cars. Residents know the footbridge, the dirt shortcut and the steps. Trace a missing path on the satellite view and share it. Once a second person confirms it, Teduh can route along it.</p>
          <ol className="steps">
            <li><b>1</b><span>Switch to the <b>Satellite view</b>.</span></li>
            <li><b>2</b><span>Choose <b>Trace a path</b> and tap along it.</span></li>
            <li><b>3</b><span>Say what it is made of, add a photo, then send.</span></li>
          </ol>
          <div className="chips">
            <button type="button" className="chip" id="satBtn" aria-pressed={ui.satellite} onClick={toggleSatellite}>Satellite view</button>
            {tracing
              ? <button type="button" className="chip" id="traceBtn" aria-pressed="true" onClick={stopTrace}>Done tracing</button>
              : <button type="button" className="chip" id="traceBtn" onClick={startTrace}>{d ? 'Keep tracing' : 'Trace a path'}</button>}
            {d && d.pts.length ? <button type="button" className="chip ghost" id="undoBtn" onClick={undoPoint}>Undo point</button> : null}
            {d && d.editId ? <button type="button" className="chip ghost" id="reverseBtn" onClick={reverseDraft}>Reverse direction</button> : null}
            <button type="button" className="chip ghost" id="demoPaths" disabled={ui.pathBusy} onClick={addDemoPaths}>Add demo paths</button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>Paths inside buildings cannot be seen from the sky, so they are not covered. Demo paths are simulated and labelled.</p>
          {ui.notice ? <p className="note" id="notice" role="status">{ui.notice}</p> : null}
          {ui.pathNote ? <p className="note" id="pathNote" role="status">{ui.pathNote}</p> : null}
        </section>
        <Form />
        <section className="sec card">
          <h2>Paths on the map</h2>
          <ul className="queue" id="pathList">
            {!list.length ? <li><div className="empty" style={{ width: '100%' }}>No paths yet. Trace the first one, or add demo paths.</div></li> : null}
            {list.map(function (p) {
              const mine = p.owner === me, done = p.confirmers.indexOf(me) !== -1;
              return (
                <li key={p.id} className={p.id === ui.pathSel ? 'sel' : ''}>
                  <Status p={p} />
                  <div className="txt">
                    <b><button type="button" className="linkbtn" data-path={p.id} onClick={function () { selectPath(p.id); }}>{p.kind} · {p.surface}{p.length ? ' · ' + p.length + ' m' : ''}</button></b>
                    {p.note ? <span>{p.note}</span> : null}
                    <span>{viaText(p)}{p.sim ? ' (simulated)' : ''}{p.edited ? ' Edited ' + p.edited + (p.edited === 1 ? ' time.' : ' times.') : ''}</span>
                    {p.ai ? <span>AI photo check: {p.ai.severity} concern{p.ai.summary ? ', ' + p.ai.summary : ''}</span> : null}
                  </div>
                  {mine && !(d && d.editId === p.id) ? <button type="button" className="btn ghost sm" data-edit={p.id} onClick={function () { editPath(p.id); }}>Edit</button> : null}
                  {p.status !== 'verified' && !mine && !done
                    ? <button type="button" className="btn ghost sm" data-confirm={p.id} onClick={function () { confirmPath(p.id); }}>Confirm it exists</button>
                    : (p.status !== 'verified' ? <span className="sub">{mine ? 'Your path' : 'You confirmed'}</span> : null)}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <div className="split-b">
        <MapCard walk={false} paths />
      </div>
    </div>
  );
}
