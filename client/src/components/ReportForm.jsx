import { useStore } from '../hooks.js';
import { ui, setReportField, cancelReport, choosePhoto, clearPhoto, triage, sendReport } from '../store.js';

const TYPES = ['Flooded road', 'Water rising', 'Blocked drain', 'Standing water', 'Fallen branch'];

export default function ReportForm() {
  useStore();
  const r = ui.report;
  if (!r) return null;
  const aiOn = ui.online && ui.features.triage;
  const a = r.ai;
  const aiText = a ? 'AI check: ' + (a.type || 'not a drain or water problem') + ', ' + a.severity + ' severity. ' + (a.summary || '') : (r.aiMsg || '');
  return (
    <form className="rep card" id="reportForm" onSubmit={function (ev) { ev.preventDefault(); sendReport(); }}>
      <p className="spot" id="repSpot">Where: <b>{r.edge.where}</b></p>
      <div className="fld">
        <label className="lbl" htmlFor="repType">What</label>
        <select id="repType" value={r.type} onChange={function (ev) { setReportField('type', ev.target.value); }}>
          {TYPES.map(function (t) { return <option key={t}>{t}</option>; })}
        </select>
      </div>
      <div className="fld">
        <label className="lbl" htmlFor="repNote">Note (optional)</label>
        <input id="repNote" maxLength={200} autoComplete="off" placeholder="For example: water up to the kerb" value={r.note} onChange={function (ev) { setReportField('note', ev.target.value); }} />
      </div>
      <div className="photo">
        <label className="btn ghost sm" htmlFor="repFile">Add a photo</label>
        <input type="file" id="repFile" accept="image/*" className="sr" onChange={function (ev) { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; choosePhoto(f); }} />
        {r.photo ? <img id="repPreview" src={r.photo} alt="The photo you chose" /> : null}
        {r.photo ? <button type="button" className="btn ghost sm" id="repPhotoClear" onClick={clearPhoto}>Remove photo</button> : null}
      </div>
      <button type="button" className={'btn ghost sm' + (aiOn ? '' : ' off')} id="repAiBtn" disabled={!!r.busy} onClick={triage}>Check with AI</button>
      {aiText ? <p className="aibox" id="repAi">{aiText}</p> : null}
      <div className="row">
        <button type="submit" className="btn" id="repSend" disabled={!!r.busy}>Send report</button>
        <button type="button" className="btn ghost" id="repCancel" onClick={cancelReport}>Cancel</button>
      </div>
    </form>
  );
}
