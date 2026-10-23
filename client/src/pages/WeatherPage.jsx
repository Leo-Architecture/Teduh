import { useStore } from '../hooks.js';
import { WxStatus, WxPreview, WxNow, WxAlerts, WxRoute, WxHours, StormSim } from '../components/WeatherPanel.jsx';
import AlertsList from '../components/AlertsList.jsx';

export default function WeatherPage() {
  useStore();
  return (
    <div className="page-narrow">
      <section className="sec wx" id="wx" aria-label="Weather">
        <div className="wx-head">
          <h2>Weather</h2>
          <WxStatus />
        </div>
        <WxPreview />
        <WxNow />
        <WxAlerts />
        <WxRoute />
        <WxHours />
        <StormSim />
      </section>
      <AlertsList />
      <p className="hint" style={{ marginTop: 12 }}>Set a start and destination on <a href="#/">Plan a walk</a> to see the weather along your route.</p>
    </div>
  );
}
