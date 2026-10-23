import { useEffect } from 'react';
import { useStore } from '../hooks.js';
import { ui, setMapMode, signOut, isTeam, isAdmin } from '../store.js';
import MapCard from '../components/MapCard.jsx';
import Impact from '../components/Impact.jsx';
import TeamQueue from '../components/TeamQueue.jsx';
import AuthCard from '../components/AuthCard.jsx';
import AdminPanel from '../components/AdminPanel.jsx';

export default function TeamPage() {
  useStore();
  useEffect(function () { setMapMode('team'); }, []);
  const signed = isTeam() || isAdmin();
  return (
    <div className="split">
      <div className="split-a">
        {signed ? (
          <section className="sec card" id="whoami">
            <p className="spot">Signed in as <b>{ui.auth.username}</b> · {isAdmin() ? 'Teduh admin team' : 'Township Team'} <button type="button" className="btn ghost sm" id="signout" onClick={signOut}>Sign out</button></p>
          </section>
        ) : <AuthCard />}
        {signed ? <Impact /> : null}
        {isTeam() ? <TeamQueue /> : null}
        {isAdmin() ? <AdminPanel /> : null}
      </div>
      <div className="split-b">
        <MapCard walk={false} />
      </div>
    </div>
  );
}
