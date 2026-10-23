import { useStore, useRoute } from './hooks.js';
import { ui } from './store.js';
import Header from './components/Header.jsx';
import TabBar from './components/TabBar.jsx';
import JourneyBar from './components/JourneyBar.jsx';
import PlanPage from './pages/PlanPage.jsx';
import WeatherPage from './pages/WeatherPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import PathsPage from './pages/PathsPage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import Splash from './components/Splash.jsx';

const PAGES = { '/': PlanPage, '/weather': WeatherPage, '/report': ReportPage, '/paths': PathsPage, '/team': TeamPage, '/about': AboutPage };

export default function App() {
  useStore();
  const path = useRoute();
  const Page = PAGES[path] || PlanPage;
  return (
    <>
    <Splash />
    <div className="shell">
      <Header />
      <TabBar path={path} />
      {ui.nav && path !== '/' ? <JourneyBar /> : null}
      <main className="page" id="main" key={path}>
        <Page />
      </main>
      <footer className="foot">
        Teduh · Township of Tomorrow · Roads and trees from OpenStreetMap contributors, weather from Open-Meteo.
      </footer>
    </div>
    </>
  );
}
