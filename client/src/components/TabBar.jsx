const TABS = [
  { to: '/', label: 'Plan a walk', short: 'Plan', icon: 'route' },
  { to: '/weather', label: 'Weather and flood', short: 'Weather', icon: 'cloud' },
  { to: '/report', label: 'Report a problem', short: 'Report', icon: 'flag' },
  { to: '/paths', label: 'Discover paths', short: 'Paths', icon: 'path' },
  { to: '/team', label: 'Township team', short: 'Team', icon: 'team' },
  { to: '/about', label: 'About', short: 'About', icon: 'info' }
];

const PATHS = {
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>,
  cloud: <><path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z" /><path d="M9 21l1-2M13 21l1-2" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  path: <><path d="M4 20c0-6 6-4 8-8s-2-6 3-8" strokeDasharray="3 3" /><circle cx="4" cy="20" r="1.6" /><circle cx="16" cy="4" r="1.6" /></>,
  team: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.9.8 3 2.7 3 5.6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></>
};

export function TabIcon({ name }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export default function TabBar({ path }) {
  return (
    <nav className="tabs" aria-label="Pages">
      {TABS.map(function (t) {
        const on = (path === t.to) || (t.to === '/' && !TABS.some(function (x) { return x.to === path; }));
        return (
          <a key={t.to} href={'#' + t.to} className={'tab' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}>
            <TabIcon name={t.icon} />
            <span className="tab-long">{t.label}</span>
            <span className="tab-short">{t.short}</span>
          </a>
        );
      })}
    </nav>
  );
}
