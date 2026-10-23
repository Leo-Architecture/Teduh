import { useStore } from '../hooks.js';
import {
  ui, getG, getUsage, conds, teamSummary, reportNotes, uniq, round1, resetDemo, pathDecide, openClear, closeClear, setClearNote,
  pickClearFile, removeClearFile, sendClear
} from '../store.js';

function ClearForm() {
  const f = ui.clearForm;
  if (!f) return null;
  return (
    <form className="rep card" id="clearForm" onSubmit={function (ev) { ev.preventDefault(); sendClear(); }}>
      <p className="spot">Clearing: <b>{f.where}</b></p>
      <p className="sub">Send a photo from before the work and one from after. Both are required. A video of the work is optional. The Teduh admin team reviews them before the issue is closed.</p>
      <div className="clear-grid">
        <div className="photo">
          <span className="lbl">Before the work (required)</span>
          <label className="btn ghost sm" htmlFor="clrBefore">{f.before ? 'Change photo' : 'Add photo'}</label>
          <input type="file" id="clrBefore" accept="image/*" className="sr" onChange={function (ev) { const x = ev.target.files && ev.target.files[0]; ev.target.value = ''; pickClearFile('before', x); }} />
          {f.before ? <img src={f.before} alt="Before the work" id="clrBeforeImg" /> : null}
        </div>
        <div className="photo">
          <span className="lbl">After the work (required)</span>
          <label className="btn ghost sm" htmlFor="clrAfter">{f.after ? 'Change photo' : 'Add photo'}</label>
          <input type="file" id="clrAfter" accept="image/*" className="sr" onChange={function (ev) { const x = ev.target.files && ev.target.files[0]; ev.target.value = ''; pickClearFile('after', x); }} />
          {f.after ? <img src={f.after} alt="After the work" id="clrAfterImg" /> : null}
        </div>
      </div>
      <div className="photo">
        <span className="lbl">Video of the work (optional, MP4 or WebM, up to 20 MB)</span>
        <label className="btn ghost sm" htmlFor="clrVideo">{f.video ? 'Change video' : 'Add video'}</label>
        <input type="file" id="clrVideo" accept="video/mp4,video/webm" className="sr" onChange={function (ev) { const x = ev.target.files && ev.target.files[0]; ev.target.value = ''; pickClearFile('video', x); }} />
        {f.video ? <><span className="sub">{f.videoName}</span><button type="button" className="btn ghost sm" onClick={function () { removeClearFile('video'); }}>Remove video</button></> : null}
      </div>
      <div className="fld">
        <label className="lbl" htmlFor="clrNote">What was done (optional)</label>
        <input id="clrNote" maxLength={60} autoComplete="off" value={f.note} onChange={function (ev) { setClearNote(ev.target.value); }} placeholder="For example: drain unblocked and flushed" />
      </div>
      {f.msg ? <p className="aibox" id="clrMsg">{f.msg}</p> : null}
      <div className="row">
        <button type="submit" className="btn" id="clrSend" disabled={f.busy}>Send for review</button>
        <button type="button" className="btn ghost" onClick={closeClear}>Cancel</button>
      </div>
    </form>
  );
}

export function Evidence({ c }) {
  return (
    <div className="evi">
      <figure><img src={'/api/media/' + c.before} alt="Before" loading="lazy" /><figcaption>Before</figcaption></figure>
      <figure><img src={'/api/media/' + c.after} alt="After" loading="lazy" /><figcaption>After</figcaption></figure>
      {c.video ? <video controls preload="none" src={'/api/media/' + c.video} aria-label="Video of the work" /> : null}
    </div>
  );
}

// The Township Team's view: listed issues, resident paths to review.
export default function TeamQueue() {
  useStore();
  if (!getG()) return null;
  const c = conds(), t = teamSummary(c), USAGE = getUsage(), rr = round1(c.rain);
  const line = t.hit
    ? 'At ' + rr + ' mm/h, ' + t.hit + ' of ' + t.trips + ' typical trips between landmarks would cross a road that is flooding or about to. Teduh keeps ' + t.kept + ' of them dry.'
    : 'At ' + rr + ' mm/h, none of the ' + t.trips + ' typical trips crosses a road at risk. Use the storm simulator on the Weather page to see the list matter.';
  return (
    <>
    <section className="sec card">
      <h2>Listed issues</h2>
      <p className="sub" id="teamLine">{line}</p>
      <p className="hint">To close an issue, send a photo from before and after the work. The Teduh admin team approves or rejects it.</p>
      <ul className="queue" id="queue">
        {!t.items.length ? <li><div className="empty" style={{ width: '100%' }}>No issues listed right now. Resident reports will appear here, ranked by how many trips they affect.</div></li> : null}
        {t.items.map(function (e) {
          const fix = e.thr <= 35;
          const types = e.reports.length ? uniq(e.reports).map(function (ty) { return ty + ' x' + e.reports.filter(function (r) { return r === ty; }).length; }).join(', ') : 'Found by inspection';
          const cl = ui.clears[e.id];
          return (
            <li key={e.id}>
              <span className={'pill ' + (fix ? 'p-bad' : 'p-risk')}>{fix ? 'Fix first' : 'Watch'}</span>
              <div className="txt">
                <b>{e.where}</b>
                <span>Floods at about {e.thr} mm/h (normal {e.base}). On {USAGE[e.id] || 0} of {t.trips} typical trips.</span>
                <span>{types}</span>
                {reportNotes(e).map(function (l, i) { return <span key={i}>{l}</span>; })}
                {cl && cl.status === 'pending' ? <span><b>Waiting for the Teduh admin team</b> (sent by {cl.by})</span> : null}
                {cl && cl.status === 'rejected' ? <span className="rej"><b>Sent back by the Teduh admin team:</b> {cl.reason || 'no reason given'}. Fix it and send new photos.</span> : null}
              </div>
              {!cl || cl.status === 'rejected'
                ? <button type="button" className="btn ghost sm" data-clear={e.id} onClick={function () { openClear(e.id); }}>{cl ? 'Send again' : 'Clear issue'}</button>
                : null}
            </li>
          );
        })}
      </ul>
      {ui.teamNote ? <p className={'note' + (ui.teamErr ? ' err' : '')} id="teamNote" role="status">{ui.teamNote}</p> : null}
    </section>
    <ClearForm />
    <section className="sec card">
      <h2>Resident paths to review</h2>
      <p className="sub">Only the Township Team approves or rejects resident paths. An approved path is used by Teduh routes straight away.</p>
      <ul className="queue" id="pathQueue">
        {!ui.paths.length ? <li><div className="empty" style={{ width: '100%' }}>No resident paths yet.</div></li> : null}
        {ui.paths.map(function (p) {
          return (
            <li key={p.id}>
              <span className={'pill ' + (p.status === 'verified' ? 'p-ok' : 'p-risk')}>{p.status === 'verified' ? 'Verified' : 'Unverified'}</span>
              <div className="txt">
                <b>{p.kind} · {p.surface}{p.length ? ' · ' + p.length + ' m' : ''}{p.sim ? ' (simulated)' : ''}</b>
                {p.note ? <span>{p.note}</span> : null}
                {p.ai ? <span>AI photo check: {p.ai.severity} concern{p.ai.summary ? ', ' + p.ai.summary : ''}</span> : null}
              </div>
              {p.status !== 'verified' ? <button type="button" className="btn ghost sm" data-approve={p.id} onClick={function () { pathDecide(p.id, 'approve'); }}>Approve</button> : null}
              <button type="button" className="btn ghost sm" data-reject={p.id} onClick={function () { pathDecide(p.id, 'reject'); }}>Reject</button>
            </li>
          );
        })}
      </ul>
    </section>
    <History />
    </>
  );
}

export function History() {
  useStore();
  if (!ui.cleared.length) return null;
  return (
    <section className="sec card">
      <h2>Cleared issues</h2>
      <ul className="queue" id="history">
        {ui.cleared.slice(0, 8).map(function (c, i) {
          const e = (getG() ? getG().edges : []).find(function (x) { return x.id === c.edgeId; });
          return (
            <li key={i}>
              <span className="pill p-ok">Cleared</span>
              <div className="txt">
                <b>{e ? e.where : c.edgeId}</b>
                <span>By {c.by}, approved by {c.approvedBy}{c.note ? '. ' + c.note : ''}</span>
                <Evidence c={c} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
