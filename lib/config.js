'use strict';
// All settings live here. They come from the .env file (see .env.example) or the environment.

const path = require('path');
const { loadEnv } = require('./env');

const ROOT = path.join(__dirname, '..');
loadEnv(process.env.TEDUH_ENV_FILE || path.join(ROOT, '.env'));   // TEDUH_ENV_FILE is used by the tests

const env = process.env;
function num(v, fallback) {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function trimSlash(s) { return String(s).replace(/\/+$/, ''); }

function pickPublic() {
  // The React build (client/dist) is served when it exists; TEDUH_CLASSIC=1 forces the classic page in public/.
  const fs = require('fs');
  const dist = path.join(ROOT, 'client', 'dist');
  if (!process.env.TEDUH_CLASSIC && fs.existsSync(path.join(dist, 'index.html'))) return dist;
  return path.join(ROOT, 'public');
}

const cfg = {
  root: ROOT,
  publicDir: pickPublic(),
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  port: num(env.PORT, 3000),
  // Township Team accounts and the Teduh admin login
  auth: {
    secret: env.SESSION_SECRET || '',
    adminUser: (env.ADMIN_USERNAME || 'teduhadmin').toLowerCase(),
    adminPass: env.ADMIN_PASSWORD || require('crypto').randomBytes(9).toString('base64url'),
    adminPassGenerated: !env.ADMIN_PASSWORD,
    emailDomains: String(env.TEAM_EMAIL_DOMAINS || '').split(',').map(function (s) { return s.trim().toLowerCase().replace(/^@/, ''); }).filter(Boolean),
    publicUrl: env.PUBLIC_URL ? trimSlash(env.PUBLIC_URL) : ''
  },
  mail: {
    brevoKey: env.BREVO_API_KEY || '', brevoUrl: env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email',
    resendKey: env.RESEND_API_KEY || '', resendUrl: env.RESEND_API_URL || 'https://api.resend.com/emails',
    from: env.MAIL_FROM || ''
  },

  // The township shown when the page first opens. Any place in Malaysia can be searched later.
  township: {
    name: env.TOWNSHIP_NAME || 'Putra Heights',
    lat: num(env.TOWNSHIP_LAT, null),
    lon: num(env.TOWNSHIP_LON, null),
    radius: clamp(num(env.TOWNSHIP_RADIUS_M, 600), 300, 1000)
  },

  maptiler: { key: env.MAPTILER_API_KEY || '', satellite: env.MAPTILER_SATELLITE_TILESET || 'satellite-v2' },
  supabase: { url: env.SUPABASE_URL ? trimSlash(env.SUPABASE_URL) : '', key: env.SUPABASE_SERVICE_KEY || '', table: 'reports' },
  appwrite: {
    endpoint: env.APPWRITE_ENDPOINT ? trimSlash(env.APPWRITE_ENDPOINT) : '',
    project: env.APPWRITE_PROJECT_ID || '',
    key: env.APPWRITE_API_KEY || '',
    database: env.APPWRITE_DATABASE_ID || '',
    table: env.APPWRITE_TABLE_ID || 'reports',
    api: ['tables', 'legacy'].indexOf(env.APPWRITE_API) !== -1 ? env.APPWRITE_API : 'auto'
  },
  anthropic: {
    key: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    baseUrl: trimSlash(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
  },
  gemini: {
    key: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    baseUrl: trimSlash(env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com')
  },
  groq: {
    key: env.GROQ_API_KEY || '',
    model: env.GROQ_MODEL || 'qwen/qwen3.8-27b',
    baseUrl: trimSlash(env.GROQ_BASE_URL || 'https://api.groq.com')
  },
  iqair: { key: env.IQAIR_API_KEY || '', url: env.IQAIR_API_URL || 'https://api.airvisual.com/v2/nearest_city' },
  pathProvider: (env.AI_PATH_PROVIDER || 'auto').toLowerCase(),
  chatProvider: (env.AI_CHAT_PROVIDER || 'auto').toLowerCase(),
  triageProvider: (env.AI_TRIAGE_PROVIDER || 'auto').toLowerCase(),

  // Public data services. Leave alone unless one of them is down.
  urls: {
    overpass: (env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    nominatim: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
    geocoding: env.OPEN_METEO_GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search',
    forecast: env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
    elevation: env.OPEN_METEO_ELEVATION_URL || 'https://api.open-meteo.com/v1/elevation',
    airQuality: env.OPEN_METEO_AIR_QUALITY_URL || 'https://air-quality-api.open-meteo.com/v1/air-quality'
  }
};

// Which AI answers the chat, and which reads report photos.
cfg.chatAi = function () {
  const g = !!cfg.gemini.key, a = !!cfg.anthropic.key;
  if (cfg.chatProvider === 'claude') return a ? 'claude' : null;
  if (cfg.chatProvider === 'gemini') return g ? 'gemini' : null;
  return g ? 'gemini' : a ? 'claude' : null;
};
cfg.triageAi = function () {
  const g = !!cfg.gemini.key, a = !!cfg.anthropic.key;
  if (cfg.triageProvider === 'claude') return a ? 'claude' : null;
  if (cfg.triageProvider === 'gemini') return g ? 'gemini' : null;
  return g ? 'gemini' : a ? 'claude' : null;   // Gemini first: it has a free tier
};

// Which AI checks the photo of a resident-traced path: Groq first (if its key is set), then Gemini.
cfg.pathAi = function () {
  const q = !!cfg.groq.key, g = !!cfg.gemini.key;
  if (cfg.pathProvider === 'groq') return q ? 'groq' : null;
  if (cfg.pathProvider === 'gemini') return g ? 'gemini' : null;
  return q ? 'groq' : g ? 'gemini' : null;
};

// Satellite pictures for the map's satellite view (needs the MapTiler key)
cfg.satellite = function () {
  if (!cfg.maptiler.key) return null;
  return {
    url: 'https://api.maptiler.com/tiles/' + encodeURIComponent(cfg.maptiler.satellite) + '/{z}/{x}/{y}.jpg?key=' + encodeURIComponent(cfg.maptiler.key),
    attribution: '© MapTiler © satellite imagery providers',
    maxZoom: 19
  };
};

cfg.tiles = function () {
  if (cfg.maptiler.key) {
    return {
      source: 'maptiler',
      url: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=' + encodeURIComponent(cfg.maptiler.key),
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 19
    };
  }
  return {
    source: 'osm',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  };
};

// Safe to send to the browser: no keys, only what is switched on.
cfg.publicConfig = function () {
  return {
    features: {
      database: (cfg.appwrite.endpoint && cfg.appwrite.project && cfg.appwrite.key && cfg.appwrite.database) ? 'appwrite' : cfg.supabase.url && cfg.supabase.key ? 'supabase' : 'file',
      chat: cfg.chatAi(),
      triage: cfg.triageAi(),
      pathAi: cfg.pathAi(),
      satellite: !!cfg.satellite(),
      weatherNow: cfg.iqair.key ? 'iqair' : 'open-meteo',
      mail: !!(cfg.mail.brevoKey || cfg.mail.resendKey),
      tiles: cfg.tiles().source
    },
    tiles: cfg.tiles(),
    satelliteTiles: cfg.satellite(),
    defaultArea: { name: cfg.township.name, lat: cfg.township.lat, lon: cfg.township.lon, radius: cfg.township.radius }
  };
};

module.exports = cfg;
