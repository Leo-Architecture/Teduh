import { useState } from 'react';
import { useStore } from '../hooks.js';
import { ui, getG, adminReview, removeAccount, resetDemo } from '../store.js';
import { Evidence, History } from './TeamQueue.jsx';

// The Teduh admin team: review clearances, manage accounts.
export default function AdminPanel() {
  useStore();
  const [why, setWhy] = useState({});
  const pending = Object.keys(ui.clears).filter(function (k) { return ui.clears[k].status === 'pending'; });
  const where = function (id) { const e = getG() && getG().edges.find(function (x) { return x.id === id; }); return e ? e.where : id; };
  return (
    <>
    <section className="sec card" id="adminReview">
      <h2>Clearances to review</h2>
      <p className="sub">The Township Team sends photos from before and after the work. Approve to close the issue, or send it back with a reason.</p>
      <ul className="queue" id="reviewQueue">
        {!pending.length ? <li><div className="empty" style={{ width: '100%' }}>Nothing is waiting for review.</div></li> : null}
        {pending.map(function (id) {
          const c = ui.clears[id];
          return (
            <li key={id} className="col">
              <div className="txt">
                <b>{where(id)}</b>
                <span>Sent by {c.by}{c.note ? ': ' + c.note : ''}</span>
                <Evidence c={c} />
                <div className="fld" style={{ marginTop: 6 }}>
                  <label className="lbl" htmlFor={'why-' + id}>Reason (if you send it back)</label>
                  <input id={'why-' + id} maxLength={60} autoComplete="off" value={why[id] || ''} onChange={function (ev) { setWhy(Object.assign({}, why, { [id]: ev.target.value })); }} />
                </div>
                <div className="row">
                  <button type="button" className="btn sm" data-approve={id} onClick={function () { adminReview(id, 'approve'); }}>Approve</button>
                  <button type="button" className="btn ghost sm" data-reject={id} onClick={function () { adminReview(id, 'reject', why[id]); }}>Reject</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {ui.teamNote ? <p className={'note' + (ui.teamErr ? ' err' : '')} id="teamNote" role="status">{ui.teamNote}</p> : null}
    </section>
    <History />
    <section className="sec card">
      <h2>Township Team accounts</h2>
      <p className="sub">Staff cannot change or delete their own username. When they message you, remove the account here and they can register again.</p>
      <ul className="queue" id="accounts">
        {!ui.accounts.length ? <li><div className="empty" style={{ width: '100%' }}>No staff accounts yet.</div></li> : null}
        {ui.accounts.map(function (a) {
          return (
            <li key={a.username}>
              <div className="txt"><b>{a.username}</b><span>{a.email}</span></div>
              <button type="button" className="btn ghost sm" data-remove={a.username} onClick={function () { if (window.confirm('Remove the account ' + a.username + '?')) removeAccount(a.username); }}>Remove</button>
            </li>
          );
        })}
      </ul>
      <div style={{ marginTop: 12 }}><button type="button" className="btn ghost sm" id="reset" onClick={function () { if (window.confirm('Reset the demo for everyone? Reports and paths are cleared. Accounts and the history stay.')) resetDemo(); }}>Reset demo</button></div>
    </section>
    </>
  );
}
