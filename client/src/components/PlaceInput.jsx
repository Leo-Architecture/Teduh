import { useEffect, useRef, useState } from 'react';
import { useStore } from '../hooks.js';
import { ui, pointOf, suggestItems, geocode, chooseSuggest, forgetPoint, clearPoint } from '../store.js';

const ICON = {
  gps: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>,
  map: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>,
  place: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z" /></svg>,
  geo: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
  hint: null
};

// A search box like a maps app: your location, a spot on the map, landmarks, then any place in Malaysia.
export default function PlaceInput({ which, label, placeholder }) {
  useStore();
  const pt = pointOf(which);
  const id = which === 'from' ? 'fromIn' : 'toIn';
  const [text, setText] = useState(pt ? pt.label : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [geo, setGeo] = useState({ list: [], q: '', busy: false });
  const timer = useRef(0);
  const inputRef = useRef(null);

  useEffect(function () {
    if (pt) setText(pt.label);
    else if (document.activeElement !== inputRef.current) setText('');
  }, [pt]);
  useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);

  const items = suggestItems(which, text, geo.list, geo.busy, geo.q);
  const shown = open && items.length > 0;

  function onChange(ev) {
    const v = ev.target.value;
    setText(v); forgetPoint(which); setOpen(true); setActive(-1);
    clearTimeout(timer.current);
    setGeo({ list: [], q: '', busy: false });
    const q = v.trim();
    if (q.length < 3 || !ui.online) return;
    timer.current = setTimeout(async function () {
      setGeo(function (g) { return Object.assign({}, g, { busy: true }); });
      try {
        const r = await geocode(q);
        if (inputRef.current && inputRef.current.value.trim() !== q) return;
        setGeo({ list: r, q: q.toLowerCase(), busy: false });
      } catch (e) { setGeo({ list: [], q: '', busy: false }); }
    }, 450);
  }
  function pick(it) { setOpen(false); chooseSuggest(which, it); }
  function onKey(ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!open) { setOpen(true); return; }
      const n = items.length; if (!n) return;
      setActive(ev.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const i = active >= 0 ? active : items.findIndex(function (it) { return it.kind !== 'hint' && it.kind !== 'gps' && it.kind !== 'map'; });
      if (i >= 0) pick(items[i]);
    } else if (ev.key === 'Escape') { setOpen(false); }
  }
  function onFocus() { setOpen(true); setActive(-1); try { inputRef.current.select(); } catch (e) { /* ignore */ } }

  return (
    <div className="dir">
      <span className={'dot ' + (which === 'from' ? 'dot-a' : 'dot-b')} aria-hidden="true" />
      <div className="combo">
        <label className="sr" htmlFor={id}>{label}</label>
        <input id={id} ref={inputRef} type="text" role="combobox" aria-expanded={shown} aria-controls={which + 'List'} aria-autocomplete="list"
          placeholder={placeholder} autoComplete="off" maxLength={80} value={text}
          onChange={onChange} onFocus={onFocus} onClick={function () { if (!open) setOpen(true); }} onKeyDown={onKey}
          onBlur={function () { setTimeout(function () { if (document.activeElement !== inputRef.current) setOpen(false); }, 180); }} />
        {text ? (
          <button type="button" className="x" id={which + 'X'} aria-label={'Clear ' + label.toLowerCase()}
            onClick={function () { setText(''); clearPoint(which); if (inputRef.current) inputRef.current.focus(); }}>&times;</button>
        ) : null}
        <ul className="sugg" id={which + 'List'} role="listbox" hidden={!shown} onPointerDown={function (ev) { ev.preventDefault(); }}>
          {shown ? items.map(function (it, i) {
            return (
              <li key={i} role="option" data-i={i} aria-selected={i === active} className={(i === active ? 'on ' : '') + (it.kind === 'hint' ? 'hintrow' : '')}
                onClick={function () { pick(it); }}>
                <span className="sg-ic">{ICON[it.kind]}</span>
                <span className="sg-tx"><b>{it.label}</b>{it.sub ? <span>{it.sub}</span> : null}</span>
              </li>
            );
          }) : null}
        </ul>
      </div>
    </div>
  );
}
