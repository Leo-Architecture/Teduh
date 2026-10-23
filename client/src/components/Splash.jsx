import { useEffect, useRef, useState } from 'react';

// The opening screen: the full Teduh logo video with its sound, shown once each time the app is opened.
// Browsers only allow sound after a tap, so it first tries with sound. If the browser refuses, the video plays silently
// and a "Tap for sound" button turns the sound on. Skip goes straight into the app.
// If the video cannot play at all, the still logo shows for about 2 seconds instead.
const KEY = 'teduhSplashSeen';
function wasSeen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
function markSeen() { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode: it just shows again */ } }

export default function Splash() {
  const [phase, setPhase] = useState(wasSeen() ? 'gone' : 'show');   // show, leaving, gone
  const [still, setStill] = useState(false);
  const [muted, setMuted] = useState(false);
  const vid = useRef(null);
  const timers = useRef([]);
  const userMuted = useRef(false);

  function leave() {
    setPhase(function (p) { return p === 'show' ? 'leaving' : p; });
    markSeen();
    timers.current.push(setTimeout(function () { setPhase('gone'); }, 500));
  }
  function stillLogo() { setStill(true); timers.current.push(setTimeout(leave, 2200)); }
  function soundOn() {
    const v = vid.current; userMuted.current = false;
    if (!v) return;
    v.muted = false; v.volume = 1;
    const p = v.play(); if (p && p.catch) p.catch(function () { /* stays silent */ });
    setMuted(false);
  }
  function soundOff() { const v = vid.current; userMuted.current = true; if (v) v.muted = true; setMuted(true); }

  useEffect(function () {
    if (phase !== 'show') return undefined;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) stillLogo();
    else {
      const v = vid.current;
      if (v) {
        v.muted = false; v.volume = 1;
        const p = v.play();
        if (p && p.catch) {
          p.catch(function () {
            // sound not allowed yet: play silently and offer the button
            v.muted = true;
            const q = v.play();
            if (q && q.then) q.then(function () { setMuted(true); }, stillLogo); else setMuted(true);
          });
        }
      }
      // if the video has not started after 4 s (slow data or no codec), show the still logo instead
      timers.current.push(setTimeout(function () { const x = vid.current; if (x && x.readyState < 3 && x.currentTime === 0) stillLogo(); }, 4000));
      timers.current.push(setTimeout(leave, 14000));
    }
    function key(ev) { if (ev.key === 'Escape') leave(); else soundOnce(); }
    // sound is on by default; if the browser blocked it, the first tap or key press turns it on
    function soundOnce() { const x = vid.current; if (x && x.muted && !userMuted.current) { x.muted = false; x.volume = 1; setMuted(false); } }
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', soundOnce);
    return function () { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', soundOnce); timers.current.forEach(clearTimeout); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'gone') return null;
  return (
    <div className={'splash' + (phase === 'leaving' ? ' leaving' : '')} role="img" aria-label="Teduh, cool path navigation"
      onClick={still ? leave : undefined}>
      {still
        ? <img className="splash-still" src="logo.png" alt="" />
        : (
          <video ref={vid} className="splash-video" playsInline preload="auto" poster="splash-poster.jpg"
            onEnded={leave} onError={function (ev) { if (ev.currentTarget.error) stillLogo(); }}>
            <source src="splash.mp4" type="video/mp4" />
            <source src="splash.webm" type="video/webm" />
          </video>
        )}
      {still ? null : <button type="button" className="splash-sound" onClick={function (ev) { ev.stopPropagation(); if (muted) soundOn(); else soundOff(); }}>{muted ? 'Sound on' : 'Sound off'}</button>}
      <button type="button" className="splash-skip" onClick={function (ev) { ev.stopPropagation(); leave(); }}>Skip</button>
    </div>
  );
}
