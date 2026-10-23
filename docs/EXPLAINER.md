# Teduh: one-page explainer

**Walk the township cool and dry.** Teduh plans walking routes that favour shade and covered walkways, and warns about streets where water is likely to rise in heavy rain. It works anywhere in Malaysia.

| | |
|---|---|
| **1. Problem** | Malaysia is hot and wet. Walking to the shops, school or the bus stop means long stretches in direct sun, then sudden storms and streets that flood. Maps route for the shortest way, not the comfortable or safe one. |
| **2. Target user** | Five kinds of walker: pedestrians, women (lighting matters more), children (busy roads matter more), cyclists, senior citizens (sun and steps matter more). Township teams are the second user: they see which drains to clear first. |
| **3. Solution** | Type a start and destination, pick who is walking, compare the shortest route with the Teduh route, press Start for live GPS guidance. Weather for the time of the walk, and a drier time to leave, are shown. Residents report blocked drains; the township team sees a ranked queue. |
| **4. Innovation** | One tool combines shade-first routing, street-level flood warning, who is walking, and resident reports feeding a repair queue. Common map apps give the shortest or fastest route, not shade or flooding. |
| **5. How it works** | OpenStreetMap roads, footpaths, trees and covered walkways build a walking network. Terrain height and nearby streams give each street a flood threshold (mm/h). Live weather and the real sunrise and sunset set sun strength and rain. A cost model picks the route for each walker type. GPS follows the walk and re-routes if you leave it. |
| **6. Impact** | Modelled in the app's Impact panel: share of sun time avoided, extra walking time, trips kept dry in heavy rain. These are modelled figures under fixed reference conditions, not measurements. A pilot would measure them. |
| **7. Feasibility** | Runs on free public data and services (OpenStreetMap, Open-Meteo), needs no key to start, deploys on any Node host. No proprietary data needed. |
| **8. Implementation** | Pilot one township for 3 months: connect the council's drain and flood records, compare estimated flood spots with where water really collected, survey residents, measure minutes in the sun and drains cleared. Then repeat in other townships. |

## Data sources and assumptions (stated, as the organizers ask)

Real, live data: roads, footpaths, trees, covered walkways, streams (OpenStreetMap contributors); weather, UV, sunrise and sunset, air quality, terrain height (Open-Meteo).

Estimated or assumed:
- **Street flood level** is an estimate from terrain height (about 90 m resolution) and distance to mapped streams and drains. It is not a flood map. A blocked-drain report lowers a street's threshold to 60% of normal (assumption).
- **Shade** uses mapped trees and covered walkways only. Building shadows are not modelled.
- **Walking time and sun exposure** use a simple model with assumed speeds per walker type.
- **Weather** forecasts cover grid squares a few kilometres wide.
- **Impact figures** use fixed reference conditions (sunny afternoon, UV 10, dry; heavy rain, 30 mm/h, evening) and the typical trips between mapped landmarks.

Simulated in the demo, and labelled on screen: the storm buttons, the Demo walk (simulated GPS), and the sample township shown when the map service is unreachable.
No internal or proprietary datasets are used.
