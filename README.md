# Can I Breathe This Air?

A small web app that tells you whether the air outside is OK to breathe, for your current location or any city in the world.

It's a static site (HTML, CSS and JavaScript) with no backend and no API keys. Air-quality data comes straight from free public APIs.

## Version

- **2.0.0** (2026-11-18): Switched to Open-Meteo. No backend, no API key.
- **1.0.0** (2025-06-26): First release (vanilla JS frontend, Cloudflare Worker backend using OpenWeatherMap).

## Changelog

### 2.0.0
- Data now comes from the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) and [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api). Neither needs an API key.
- Removed the Cloudflare Worker (`my-air-backend/`) and the OpenWeatherMap dependency.
- Results use the standard European AQI and also show US AQI, PM2.5 and PM10.
- City search accepts accented and non-Latin names (Köln, São Paulo, 東京).
- Location results are cached per ~1 km area, so small GPS changes still use the cache.
- The loading message now clears when results arrive.
- Added the cloud image that was missing, a proper `<form>` with a label, and mobile layout fixes.
- Logic moved to `aqi.js` (no DOM access) and covered by unit tests.

### 1.0.0
- First stable release.

## Features
- Air quality for your current location (asks for location permission) or any city.
- European AQI with a plain-language verdict, plus US AQI, PM2.5 and PM10.
- Results cached for 10 minutes in the browser (memory and `localStorage`).
- Accessible: labelled form, live regions for results, keyboard friendly.

## Data sources
| What | Service | Key needed |
|---|---|---|
| Air quality | [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | No |
| City search | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | No |
| Coordinates → city name | [BigDataCloud client reverse geocoding](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) | No |

Open-Meteo is free for non-commercial use (about 10,000 calls a day) and its data is licensed CC BY 4.0, so the page credits it in the footer. Commercial use needs an [Open-Meteo API plan](https://open-meteo.com/en/pricing).

### European AQI scale
| EAQI | Level |
|---|---|
| 0–20 | Good |
| 20–40 | Fair |
| 40–60 | Moderate |
| 60–80 | Poor |
| 80–100 | Very poor |
| 100+ | Extremely poor |

## Project structure
```
├── index.html          Page markup
├── style.css           Styles
├── script.js           DOM wiring (form, geolocation, rendering)
├── aqi.js              API calls, cache, validation, AQI interpretation (no DOM)
├── aqi.test.js         Unit tests for aqi.js
├── script.test.js      Page tests (jsdom)
├── image-resources/    Images
└── vitest.config.js
```

## Running locally
The page uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work).

```sh
npm install
npm start   # serves on http://localhost:5173
```

Any static server works, e.g. `npx serve .`.

## Testing
```sh
npm test
```

## Deployment
Deploy the repository root as a static site, e.g. on Cloudflare Pages, GitHub Pages or Netlify. There is no build step and nothing to configure.

Location lookup only works over HTTPS (or on `localhost`), which all of these hosts provide.

## License
MIT
