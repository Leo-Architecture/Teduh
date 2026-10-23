import { useState } from 'react';
import { useStore } from '../hooks.js';
import { ui, setAuthView, signIn, signUp, forgotPassword, resetPassword } from '../store.js';

function Field({ id, label, type, value, onChange, hint, auto, max }) {
  return (
    <div className="fld">
      <label className="lbl" htmlFor={id}>{label}</label>
      <input id={id} type={type || 'text'} value={value} autoComplete={auto || 'off'} maxLength={max || 80} onChange={function (ev) { onChange(ev.target.value); }} />
      {hint ? <p className="hint" style={{ marginTop: 4 }}>{hint}</p> : null}
    </div>
  );
}

// Sign in, create an account, forgot password, and choose a new password from the emailed link.
export default function AuthCard() {
  useStore();
  const [f, setF] = useState({ username: '', password: '', password2: '', staffId: '', email: '' });
  const set = function (k) { return function (v) { setF(Object.assign({}, f, { [k]: v })); }; };
  const v = ui.resetToken ? 'reset' : ui.authView;
  const busy = ui.authBusy;
  if (!ui.online) {
    return (
      <section className="sec card">
        <h2>Township Team sign-in</h2>
        <p className="sub">Sign-in needs the Teduh server. Run <code>npm start</code> (or open the hosted app) and come back.</p>
      </section>
    );
  }
  return (
    <section className="sec card" id="authCard">
      <h2>{v === 'login' ? 'Township Team sign-in' : v === 'signup' ? 'Create a Township Team account' : v === 'forgot' ? 'Forgot your password?' : 'Choose a new password'}</h2>
      {v === 'login' ? (
        <form onSubmit={function (ev) { ev.preventDefault(); signIn(f.username, f.password); }}>
          <p className="sub">For township and organisation staff, and the Teduh admin team. Residents do not need an account: they can plan walks, report problems and trace paths without signing in.</p>
          <Field id="authUser" label="Username" value={f.username} onChange={set('username')} auto="username" max={40} />
          <Field id="authPass" label="Password" type="password" value={f.password} onChange={set('password')} auto="current-password" max={100} />
          <div className="row">
            <button type="submit" className="btn" id="authGo" disabled={busy}>Sign in</button>
          </div>
          <p className="hint"><button type="button" className="linkbtn" id="goForgot" onClick={function () { setAuthView('forgot'); }}>Forgot password?</button> · <button type="button" className="linkbtn" id="goSignup" onClick={function () { setAuthView('signup'); }}>Create an account</button></p>
        </form>
      ) : null}
      {v === 'signup' ? (
        <form onSubmit={function (ev) { ev.preventDefault(); signUp(f); }}>
          <p className="sub">One account for each staff ID and organisation email address. To change or delete an account later, message the Teduh admin team.</p>
          <Field id="suStaff" label="Staff ID" value={f.staffId} onChange={set('staffId')} max={20} />
          <Field id="suEmail" label="Organisation email address" type="email" value={f.email} onChange={set('email')} auto="email" max={80} hint="Your work email, not a personal one. Password reset links are sent here." />
          <Field id="suUser" label="Choose a username" value={f.username} onChange={set('username')} auto="username" max={20} hint="4 to 20 characters: letters, numbers, dot or underscore." />
          <Field id="suPass" label="Choose a password" type="password" value={f.password} onChange={set('password')} auto="new-password" max={100} hint="At least 8 characters with letters and a number." />
          <Field id="suPass2" label="Type the password again" type="password" value={f.password2} onChange={set('password2')} auto="new-password" max={100} />
          <div className="row">
            <button type="submit" className="btn" id="suGo" disabled={busy}>Create account</button>
            <button type="button" className="btn ghost" onClick={function () { setAuthView('login'); }}>Back to sign in</button>
          </div>
        </form>
      ) : null}
      {v === 'forgot' ? (
        <form onSubmit={function (ev) { ev.preventDefault(); forgotPassword(f.email); }}>
          <p className="sub">Enter the organisation email address you registered with. We send a link that lets you choose a new password.</p>
          <Field id="fpEmail" label="Organisation email address" type="email" value={f.email} onChange={set('email')} auto="email" max={80} />
          <div className="row">
            <button type="submit" className="btn" id="fpGo" disabled={busy}>Send reset link</button>
            <button type="button" className="btn ghost" onClick={function () { setAuthView('login'); }}>Back to sign in</button>
          </div>
        </form>
      ) : null}
      {v === 'reset' ? (
        <form onSubmit={function (ev) { ev.preventDefault(); resetPassword(f.password, f.password2); }}>
          <Field id="rsPass" label="New password" type="password" value={f.password} onChange={set('password')} auto="new-password" max={100} hint="At least 8 characters with letters and a number." />
          <Field id="rsPass2" label="Type it again" type="password" value={f.password2} onChange={set('password2')} auto="new-password" max={100} />
          <div className="row"><button type="submit" className="btn" id="rsGo" disabled={busy}>Save new password</button></div>
        </form>
      ) : null}
      {ui.authMsg ? <p className={'note' + (ui.authErr ? ' err' : '')} id="authMsg" role="status">{ui.authMsg}</p> : null}
    </section>
  );
}
