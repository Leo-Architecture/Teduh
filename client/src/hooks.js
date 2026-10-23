import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe, getVersion, subscribeClock, getClockVersion, ui } from './store.js';

// Re-render this component whenever the app state changes. Components then read `ui` directly.
export function useStore() { return useSyncExternalStore(subscribe, getVersion); }
// The clock ticks every second; only the components that call this redraw each second.
export function useClock() { useSyncExternalStore(subscribeClock, getClockVersion); return ui.clock; }

// A tiny hash router: the page is the part after # in the address, for example #/weather.
function parse() {
  const h = String(window.location.hash || '').replace(/^#/, '').split('?')[0];
  return h ? (h.charAt(0) === '/' ? h : '/' + h) : '/';
}
export function useRoute() {
  const [path, setPath] = useState(parse());
  useEffect(function () {
    function on() { setPath(parse()); window.scrollTo(0, 0); }
    window.addEventListener('hashchange', on);
    return function () { window.removeEventListener('hashchange', on); };
  }, []);
  return path;
}
