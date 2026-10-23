# Teduh

Walk the township cool and dry. Teduh finds shade-first walking routes and warns about streets where water rises in heavy rain. It works anywhere in Malaysia.

## Pages (React version, v4)

The interface is a React app in `client/` with five pages: Plan a walk, Weather and flood, Report a problem, Township team, About. A running journey carries over between pages.

- Build it: `npm run build` (installs `client/` packages and bundles with esbuild into `client/dist`). A prebuilt `client/dist` is included in the zip, so `npm start` works without building.
- The server serves `client/dist` when it exists. Set `TEDUH_CLASSIC=1` to serve the classic single page in `public/` instead.
- Render: build command `npm run build`, start command `npm start`.
- Engines (`public/js/*.js`) are shared by both versions and covered by `npm test`.

### Opening screen and logo

The app opens with the full Teduh logo video, with sound (`client/public/splash.mp4` and `splash.webm`), once each time it is opened. Browsers often block sound until a tap, so a "Tap for sound" button appears when that happens. Skip goes straight in. If the video cannot play, the still logo shows for about 2 seconds. To change it, replace the files in `client/public/` and run `npm run build`. `manifest.webmanifest` and the icons let a phone add Teduh to the home screen as an app.

### Resident flood reports

On the Report page residents can choose Flooded road, Water rising, Blocked drain, Standing water or Fallen branch. Each type has its own symbol on the map. A Flooded road report shows that road as flooded, and a Water rising or Standing water report shows it as at risk, in the Flood early warning list and in route planning, for 3 hours. The township team can mark a road cleared on the Team page.

### Why the two routes can match

Teduh avoids sun, rain and floods. At night there is no sun, so when the roads are dry the shortest route and the Teduh route are the same. The Plan page offers "See the routes at midday" to preview daytime.

### GPS accuracy

Phones are usually within 5 to 20 m. Laptops use Wi-Fi positioning, which can be 100 m or more off. The app waits up to 10 seconds for the best fix and tells you when it is rough.

## Run it (2 minutes)

1. Install Node 18 or newer from nodejs.org.
2. Open this folder in VS Code, then open the terminal.
3. Run `npm start`.
4. Open http://localhost:3000.

It runs with **no keys at all**. Real roads, trees, covered walkways, terrain and weather need no key. Keys only switch on the extra features below.

## Using it

1. Type a **start** and **destination** like in Google Maps. Suggestions include **Your location** (GPS), **Choose on map**, nearby landmarks, and any place in Malaysia. If the two places are outside the loaded map, Teduh loads the roads between them (walks up to about 2.5 km).
2. Pick **Who is walking**, then tap the **Shortest** or **Teduh** route card to choose it.
3. Press **Start** for live GPS tracking: a blue dot, turn-by-turn steps, time of arrival, distance left, rain warnings and covered walkways ahead. If you leave the route it plans a new one from where you are. Voice guidance is optional. **Demo walk** replays the route with simulated GPS, handy for the pitch on a laptop.
4. The **Weather** section shows the live conditions (temperature, feels-like, rain, chance of rain, wind and gusts, humidity, UV, air quality and haze, cloud, visibility, thunderstorms, fog), warnings, and the next 24 hours. Tap an hour to preview the routes and flood risk at that time. Once a route is planned it shows the weather along the route at the time you will reach each part, and suggests a drier time to leave.
5. The clock is Malaysia time, ticking every second. Sun strength and darkness follow the real sunrise and sunset. Time and weather refresh by themselves (the weather every 5 minutes).

The **Demo: simulate a storm** buttons let you show flooding and re-routing even on a dry day. They are labelled as simulated on screen.

### GPS needs a secure page

Browsers only share GPS on `http://localhost` or an `https://` address. On your laptop `http://localhost:3000` is fine. On your phone, a plain `http://192.168...` address will **not** get GPS. Deploy it (Render gives you https) or use a tunnel such as Cloudflare Tunnel or ngrok, then open that https address on the phone.

## Appwrite setup (saves reports)

Appwrite is used when all four of `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` and `APPWRITE_DATABASE_ID` are filled in. It takes priority over Supabase.

1. In the Appwrite Console create a project. In **Settings** copy the **Project ID** and the **API endpoint** (for example `https://sgp.cloud.appwrite.io/v1`).
2. **Databases**, create a database. Copy its **Database ID**.
3. In that database create a table (older versions call it a collection) with the ID `reports`. Do not turn on any public permissions: only the server uses it.
4. Add these columns (older versions call them attributes), all optional (not required):

| Key | Type | Size |
|---|---|---|
| `edge_id` | String | 80 |
| `type` | String | 40 |
| `note` | String | 300 |
| `lat` | Float | |
| `lon` | Float | |
| `ai` | String | 600 |

5. **Overview, Integrations, API keys**: create a key with the Databases scopes (read and write for databases, tables or collections, and rows or documents). Copy the secret into `APPWRITE_API_KEY`.
6. Restart. The start-up message should say `Appwrite connected` and `Reports saved in : Appwrite`.

The key stays on the server and is never sent to the browser. Marking a road cleared or resetting deletes its rows.

## Where to paste your keys

Open the `.env` file. Paste each key after the `=` sign, with no quotes and no spaces. Save, then restart (`Ctrl+C`, `npm start`). The start-up message lists which features are on.

| Slot | What it unlocks | Where to get it | Cost |
|---|---|---|---|
| `ADMIN_PASSWORD` | Password for the Teduh admin team (user `ADMIN_USERNAME`) who approve or reject clearances and remove accounts | Make one up | Free |
| `BREVO_API_KEY` + `MAIL_FROM` | Sends the password reset link to the staff member's registered email | brevo.com, SMTP & API, API keys; verify your sender address | Free plan |
| `TEAM_EMAIL_DOMAINS`, `PUBLIC_URL`, `SESSION_SECRET` | Allowed organisation email domains, the app's public address for reset links, a secret that keeps sign-ins across restarts | You choose | Free |
| `TOWNSHIP_NAME` or `TOWNSHIP_LAT` and `TOWNSHIP_LON` | Which township opens first | Any Malaysian place name | Free |
| `MAPTILER_API_KEY` | Nicer, more reliable map tiles | cloud.maptiler.com, Account, Keys | Free tier |
| `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` | Reports survive restarts and are shared by every phone | supabase.com, Project Settings, API. Use the **service_role** key, not the anon key | Free tier |
| `GEMINI_API_KEY` | "Teduh Buddy", the friendly chat that favours shady and covered walkways | aistudio.google.com/apikey | Free tier |
| `ANTHROPIC_API_KEY` | Optional. Gemini already does the photo check; Claude is only used if you set `AI_TRIAGE_PROVIDER=claude` or have no Gemini key | console.anthropic.com | Paid, very small amounts |
| `APPWRITE_*` | Reports survive restarts and are shared by every phone (see Appwrite setup) | cloud.appwrite.io | Free tier |

Supabase setup: create a project, open the SQL Editor, paste `supabase/schema.sql`, run it. Then paste the two keys.

If only one AI key is set, that provider does both jobs. If you leave both blank, the chat and AI check are hidden and everything else still works.

| `IQAIR_API_KEY` | Weather right now where the person is (temperature, humidity, wind, air quality, place name). IQAir's free plan has no rain or forecast, so rain and the 24-hour forecast still use Open-Meteo | iqair.com, Community plan | Free (5 calls/min, 500/day) |
| `GROQ_API_KEY` | Path Discovery photo check (AI describes a resident's photo of a path; it does not draw it) | console.groq.com | Free tier |

Model names are in `.env` (`GEMINI_MODEL`, `ANTHROPIC_MODEL`). If a provider retires a model, change the name there.

**Never share `.env` or upload it to GitHub.** `.gitignore` already excludes it. The keys stay on the server and are never sent to the browser.

## What is real and what is estimated

Real, from live public services:
- Roads, footpaths, steps, street lights and covered walkways: OpenStreetMap
- Trees and buildings (used for shade): OpenStreetMap. Building shadows are worked out for every hour from 7:00 to 19:00 with a sun-position formula (lib/sun.js, lib/shadow.js). Building heights come from the `height` or `building:levels` tag, or a typical value for the building type, so shade is an estimate.
- Weather now and for the next 24 hours (temperature, rain, storms, wind, UV, sunrise and sunset): Open-Meteo
- Air quality and haze: Open-Meteo air quality
- Terrain height: Open-Meteo elevation

Estimated:
- **Flood level of each street.** No public service gives township drain records, so Teduh estimates from how low the street sits and how close it is to drains and streams. The app says so. In the pitch, say that connecting the township's real drain and flood records is the next step.
- Shade is from mapped trees and covered walkways only. Building shadows are not modelled.
- Walking time and sun exposure come from a simple model, not measurements.
- Weather forecasts cover grid squares a few kilometres wide, so "weather along your route" means the weather around the route at the time you reach each part, not street by street. Rain "now" is the larger of the current reading and this hour's total.
- GPS tracking uses the phone's own location. Turn-by-turn text is built from the OpenStreetMap road names and may be rough where roads are unnamed.

Map data quality varies by area. Where OpenStreetMap has few trees or covered walkways mapped, the shade result will be weaker.

## For the pitch

- **Township team** view: the **Impact (modelled)** panel compares the shortest and Teduh routes over typical trips with fixed reference conditions, and has one box for your own walkers-per-day assumption. It is labelled as modelled, not measured.
- **How we estimate flooding** (bottom of the Resident page) explains the flood estimate and lists what is simulated in the demo.
- `docs/EXPLAINER.md` is a one-page summary laid out on the organizers' 8 pitch areas, with the data sources and assumptions.

## Walkers

Pedestrian, Women, Children, Bicyclist, Senior citizens. Each weighs shade, lighting, busy roads and steps differently.

## Deploy so others can open it

Any Node host works, for example Render: new Web Service, build command blank, start command `npm start`, then add the same keys as environment variables (do not upload `.env`). Set `ADMIN_PASSWORD`, `SESSION_SECRET` and `PUBLIC_URL`, and use Appwrite or Supabase, because free hosts lose local files on restart. Accounts and reports live in the database, but the clearance photos and videos are saved in the server's `data/media` folder, so use a host with a persistent disk (or move them to Appwrite Storage) for anything beyond a demo.

## Tests

`npm test` runs 156 checks against fake copies of every service, so no keys are needed. The browser checks (map, search, weather, clock, GPS with simulated movement) were run with Playwright during development and are not shipped.

## Folder guide

- `server.js` and `lib/`: server, map data, weather, storage, AI
- `public/`: the app (`index.html`, `css/`, `js/`)
- `supabase/schema.sql`: database table
- `tests/`: automatic tests

## Path Discovery

The Paths page lets residents trace paths that road maps miss (dirt shortcuts, footbridges, steps) on a satellite view. A path starts unverified (shown dashed, not used for routes). It becomes verified when a second device confirms it or the township team approves it (PIN). Verified paths join the road network, so Teduh routes can differ from the shortest route, which only knows the existing map. Unpaved paths are penalised in rain and for seniors and children, and bicycles avoid them. The AI only checks a photo; paths inside buildings cannot be seen from satellite. Demo paths are simulated and labelled.

## Township Team and admin

- Township staff open the **Township Team** page and create an account with their staff ID and organisation email address. One account per staff ID and per email. Passwords are stored hashed. Nobody can change or delete a username; staff message the Teduh admin team, who remove the account on the same page so the staff member can register again.
- **Forgot password** sends a one-time link (valid 30 minutes) to the registered email. This needs an email service key (Brevo or Resend). Without one the link is only printed in the server console.
- The Township Team sees **Listed issues**. To close one they send a photo from before and after the work (both required) and may add a video. The **Teduh admin team** approves or rejects it. An approved issue moves to the cleared history with its photos.
- Only the Township Team approves or rejects resident paths. Residents can edit their own paths (the description at any time; changing the line, kind or surface sends it for a new check).
- Teduh cannot check that a staff ID really belongs to the person. Restrict sign-up with `TEAM_EMAIL_DOMAINS` and let the organisation confirm its staff list.
- The classic page in `public/` (used only with `TEDUH_CLASSIC=1`) does not support accounts.

## Weather and pins

- The weather follows the person: on opening, the browser asks for location. If allowed, the weather is for that spot, and if they are outside the loaded township the roads around them are loaded. If location is refused, it uses the middle of the loaded area and says so.
- **Choose on map** places a pin anywhere. A pin away from the roads joins the nearest road within 1.5 km, and the gap is drawn as a dotted line to cross on foot.
