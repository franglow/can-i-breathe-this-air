// Air-quality logic with no DOM access, so it can be tested on its own.
// Data sources (all free, no API key):
//   - Open-Meteo Air Quality API: https://open-meteo.com/en/docs/air-quality-api
//   - Open-Meteo Geocoding API:   https://open-meteo.com/en/docs/geocoding-api
//   - BigDataCloud client reverse geocoding (coordinates -> city name)

export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_STORAGE_KEY = 'aqiCache.v3'; // bump when the cached result shape changes

// ---------- Input validation ----------

// Letters from any alphabet (Köln, São Paulo, 東京), spaces, hyphens, apostrophes, dots, commas.
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s\-'’.,]*$/u;

export function isValidCityName(city) {
  return typeof city === 'string' && city.length <= 100 && CITY_PATTERN.test(city);
}

// ---------- AQI interpretation (European AQI scale) ----------

const EAQI_BANDS = [
  { max: 20, label: 'Good' },
  { max: 40, label: 'Fair' },
  { max: 60, label: 'Moderate' },
  { max: 80, label: 'Poor' },
  { max: 100, label: 'Very poor' },
  { max: Infinity, label: 'Extremely poor' },
];

export function interpretAQI(eaqi) {
  if (typeof eaqi !== 'number' || Number.isNaN(eaqi) || eaqi < 0) return { label: 'Unknown' };
  return { label: EAQI_BANDS.find((b) => eaqi <= b.max).label };
}

// The page voice. One entry per visual level (body[data-aqi="1..5"]); 80+ is level 5.
export const BREATH_LEVELS = [
  { level: 1, sound: 'Aaah.', answer: 'Yes.', line: 'Clean air. Go outside.', verdict: 'Breathe easy' },
  { level: 2, sound: 'Mmm.', answer: 'Yes.', line: 'Fine for almost everyone.', verdict: 'Breathable' },
  { level: 3, sound: 'Hmm.', answer: 'Mostly.', line: 'Sensitive lungs: take it easy.', verdict: 'Mostly breathable' },
  { level: 4, sound: 'Ehem.', answer: 'Not now.', line: 'Keep time outdoors short.', verdict: 'Not great' },
  { level: 5, sound: '…', answer: 'No.', line: 'Stay in. Close the windows.', verdict: 'Stay in' },
];

export function breathLevel(eaqi) {
  if (typeof eaqi !== 'number' || Number.isNaN(eaqi) || eaqi < 0) return null;
  return Math.min(5, EAQI_BANDS.findIndex((b) => eaqi <= b.max) + 1);
}

// ---------- Cache (memory + localStorage) ----------

export function createCache({ storage = safeLocalStorage(), now = () => Date.now(), ttl = CACHE_DURATION_MS } = {}) {
  let entries = {};
  try {
    entries = JSON.parse(storage?.getItem(CACHE_STORAGE_KEY) || '{}') || {};
  } catch {
    entries = {};
  }

  function persist() {
    try {
      storage?.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked (private mode): memory cache still works.
    }
  }

  function prune() {
    const t = now();
    for (const key of Object.keys(entries)) {
      if (!entries[key] || t - entries[key].timestamp >= ttl) delete entries[key];
    }
  }

  return {
    get(key) {
      prune();
      return entries[key]?.data ?? null;
    },
    set(key, data) {
      prune();
      entries[key] = { data, timestamp: now() };
      persist();
    },
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Round to ~1 km so small GPS jitter still hits the cache.
export function geoCacheKey(lat, lon) {
  return `geo:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
}

export function cityCacheKey(city) {
  return `city:${city.trim().normalize('NFC').toLocaleLowerCase()}`;
}

// ---------- API calls ----------

export class AirQualityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'city-not-found' | 'no-data' | 'network'
  }
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new AirQualityError('network', `Network error: ${err.message}`);
  }
  if (!res.ok) throw new AirQualityError('network', `Request failed with status ${res.status}`);
  return res.json();
}

export async function geocodeCity(city, fetchImpl = fetch) {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const data = await getJson(url, fetchImpl);
  const place = data?.results?.[0];
  if (!place) throw new AirQualityError('city-not-found', `City not found: ${city}`);
  return {
    lat: place.latitude,
    lon: place.longitude,
    city: place.name,
    country: place.country || '',
    countryCode: place.country_code || '',
  };
}

// Best effort: if this fails, the app shows "Your area" instead of a city name.
export async function reverseGeocode(lat, lon, fetchImpl = fetch) {
  try {
    const url = `${REVERSE_GEOCODING_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const data = await getJson(url, fetchImpl);
    return {
      city: data.city || data.locality || '',
      locality: data.locality || '',
      country: data.countryName || '',
      countryCode: data.countryCode || '',
    };
  } catch {
    return { city: '', locality: '', country: '', countryCode: '' };
  }
}

// Approximate (city-level) location from the visitor's IP address. Used when
// device location is unavailable or refused. BigDataCloud falls back to IP
// lookup when no coordinates are sent.
export async function approximateLocationFromIp(fetchImpl = fetch) {
  const data = await getJson(`${REVERSE_GEOCODING_URL}?localityLanguage=en`, fetchImpl);
  if (typeof data?.latitude !== 'number' || typeof data?.longitude !== 'number') {
    throw new AirQualityError('no-location', 'Could not estimate location from IP');
  }
  return {
    lat: data.latitude,
    lon: data.longitude,
    city: data.city || data.locality || '',
    country: data.countryName || '',
    countryCode: data.countryCode || '',
  };
}

export async function fetchAirQuality(lat, lon, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: CURRENT_FIELDS.join(','),
    timezone: 'auto',
  });
  const data = await getJson(`${AIR_QUALITY_URL}?${params}`, fetchImpl);
  const current = data?.current;
  if (!current || typeof current.european_aqi !== 'number') {
    throw new AirQualityError('no-data', 'No air quality data for this location');
  }
  const pick = (prefix) =>
    Object.fromEntries(Object.entries(POLLUTANT_FIELDS).map(([key, field]) => [key, current[prefix + field] ?? null]));
  return {
    europeanAqi: current.european_aqi,
    usAqi: current.us_aqi ?? null,
    pm25: current.pm2_5 ?? null,
    pm10: current.pm10 ?? null,
    // Concentrations in µg/m³, and each pollutant's own sub-index on both scales.
    // The overall index is the highest sub-index, which tells us the main pollutant.
    concentrations: pick(''),
    subIndex: { eu: pick('european_aqi_'), us: pick('us_aqi_') },
    // Europe only (CAMS); null elsewhere and out of season.
    pollen: Object.fromEntries(POLLEN_TYPES.map((type) => [type, current[`${type}_pollen`] ?? null])),
    time: current.time ?? null,
  };
}

const POLLUTANT_FIELDS = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  no2: 'nitrogen_dioxide',
  o3: 'ozone',
  so2: 'sulphur_dioxide',
  co: 'carbon_monoxide',
};
const POLLEN_TYPES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];
export const CURRENT_FIELDS = [
  'european_aqi',
  'us_aqi',
  ...Object.values(POLLUTANT_FIELDS),
  // The European index has no carbon monoxide component (Open-Meteo rejects that field).
  ...Object.values(POLLUTANT_FIELDS).filter((f) => f !== 'carbon_monoxide').map((f) => `european_aqi_${f}`),
  ...Object.values(POLLUTANT_FIELDS).map((f) => `us_aqi_${f}`),
  ...POLLEN_TYPES.map((type) => `${type}_pollen`),
];

// ---------- High-level lookups ----------

export async function airQualityForCity(city, fetchImpl = fetch) {
  const place = await geocodeCity(city, fetchImpl);
  const air = await fetchAirQuality(place.lat, place.lon, fetchImpl);
  return { city: place.city, country: place.country, countryCode: place.countryCode, ...air };
}

// Neighbourhood names are only shown when the position is precise enough to trust them.
export const AREA_NAME_MAX_ACCURACY_M = 1000;

export async function airQualityForCoords(lat, lon, fetchImpl = fetch, { accuracy = Infinity } = {}) {
  const [air, place] = await Promise.all([
    fetchAirQuality(lat, lon, fetchImpl),
    reverseGeocode(lat, lon, fetchImpl),
  ]);
  const area =
    accuracy <= AREA_NAME_MAX_ACCURACY_M && place.locality && place.locality !== place.city ? place.locality : '';
  return { area, city: place.city, country: place.country, countryCode: place.countryCode, ...air };
}

export async function airQualityForIp(fetchImpl = fetch) {
  const place = await approximateLocationFromIp(fetchImpl);
  const air = await fetchAirQuality(place.lat, place.lon, fetchImpl);
  return { city: place.city, country: place.country, countryCode: place.countryCode, approximate: true, ...air };
}

// ---------- Device location ----------

export const LOCATION_OPTIONS = {
  enableHighAccuracy: true, // allow GPS on phones
  timeout: 10 * 1000, // per reading
  maximumAge: 5 * 60 * 1000, // reuse a reading up to 5 minutes old
};
export const GOOD_ACCURACY_M = 100; // stop refining once this accurate
export const MAX_LOCATE_MS = 10 * 1000; // never refine for longer than this

export class LocationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'denied' | 'unavailable' | 'unsupported'
  }
}

// Watches the device position and resolves with the most accurate reading,
// as soon as one is within `goodAccuracy` metres or after `maxWait` ms.
// The first reading is often a rough Wi-Fi/cell fix; GPS improves it.
export function getBestPosition(
  geolocation,
  {
    goodAccuracy = GOOD_ACCURACY_M,
    maxWait = MAX_LOCATE_MS,
    options = LOCATION_OPTIONS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  if (!geolocation?.watchPosition) {
    return Promise.reject(new LocationError('unsupported', 'Geolocation is not supported'));
  }
  return new Promise((resolve, reject) => {
    let best = null;
    let done = false;
    let watchId = null;
    let timer = null;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (timer != null) clearTimer(timer);
      if (watchId != null) geolocation.clearWatch(watchId);
      if (best) {
        resolve({ lat: best.coords.latitude, lon: best.coords.longitude, accuracy: best.coords.accuracy });
      } else if (err?.code === 1) {
        reject(new LocationError('denied', 'Location permission denied'));
      } else {
        reject(new LocationError('unavailable', err?.message || 'Location unavailable'));
      }
    };

    timer = setTimer(() => finish(), maxWait);
    watchId = geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= goodAccuracy) finish();
      },
      (err) => finish(err),
      options,
    );
    // A reading may arrive synchronously, before watchId was known.
    if (done && watchId != null) geolocation.clearWatch(watchId);
  });
}

// 'granted' | 'prompt' | 'denied' | 'unknown' (Permissions API missing, e.g. older Safari)
export async function geolocationPermission(permissions = globalThis.navigator?.permissions) {
  try {
    const status = await permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

// ---------- Formatting ----------

// ---------- Which index to show ----------

// Europe uses the European AQI; everywhere else the US AQI is the best-known scale.
const EUROPE = new Set(
  ('AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT ' +
    'NL NO PL PT RO RS SE SI SK SM UA VA XK').split(' '),
);

// 'eu' | 'us'. Unknown country: European, the scale the app has always used.
export function indexForCountry(countryCode) {
  if (!countryCode) return 'eu';
  return EUROPE.has(countryCode.toUpperCase()) ? 'eu' : 'us';
}

// US EPA categories. Six bands, mapped onto the page's five levels like the EU scale.
const US_BANDS = [
  { max: 50, label: 'Good' },
  { max: 100, label: 'Moderate' },
  { max: 150, label: 'Unhealthy for sensitive groups' },
  { max: 200, label: 'Unhealthy' },
  { max: 300, label: 'Very unhealthy' },
  { max: Infinity, label: 'Hazardous' },
];

const SCALES = {
  eu: { name: 'EU AQI', long: 'European scale', bands: EAQI_BANDS, field: 'europeanAqi' },
  us: { name: 'US AQI', long: 'US scale', bands: US_BANDS, field: 'usAqi' },
};

// Where a value sits on a scale: band position 1..6 and its label.
export function onScale(index, value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return null;
  const { bands } = SCALES[index];
  const i = bands.findIndex((b) => value <= b.max);
  return { position: i + 1, of: bands.length, label: bands[i].label, level: Math.min(5, i + 1) };
}

// ---------- Pollutants ----------

// WHO 2021 air quality guidelines, µg/m³ (24-hour means; ozone is the 8-hour mean).
const POLLUTANTS = {
  pm25: { code: 'PM2.5', name: 'fine particles', source: 'from smoke, traffic and heating', who: 15 },
  pm10: { code: 'PM10', name: 'coarse particles', source: 'from dust, pollen and road wear', who: 45 },
  no2: { code: 'NO₂', name: 'nitrogen dioxide', source: 'mostly from traffic', who: 25 },
  o3: { code: 'O₃', name: 'ozone', source: 'formed when sunlight acts on traffic fumes', who: 100 },
  so2: { code: 'SO₂', name: 'sulphur dioxide', source: 'from industry and shipping', who: 40 },
  co: { code: 'CO', name: 'carbon monoxide', source: 'from traffic and heating', who: 4000 },
};
// Always listed in the panel; the others only when they are the main pollutant.
const ALWAYS_LISTED = ['pm25', 'pm10', 'no2'];

// Plain words for value vs. WHO limit.
export function compareToLimit(value, limit) {
  const r = value / limit;
  if (r < 0.5) return 'well under the WHO limit';
  if (r < 0.9) return 'under the WHO limit';
  if (r <= 1.1) return 'near the WHO limit';
  if (r < 1.75) return 'above the WHO limit';
  return `${Math.round(r * 2) / 2}× the WHO limit`;
}

// The pollutant with the highest sub-index on the given scale.
export function mainPollutant(subIndex) {
  let best = null;
  for (const [key, value] of Object.entries(subIndex || {})) {
    if (typeof value === 'number' && POLLUTANTS[key] && (!best || value > best.value)) best = { key, value };
  }
  return best?.key ?? null;
}

// Typical "high" pollen thresholds, grains/m³ (as used by European pollen services).
const POLLEN_HIGH = { alder: 100, birch: 100, grass: 50, mugwort: 50, olive: 200, ragweed: 50 };

export function highPollen(pollen) {
  return Object.entries(POLLEN_HIGH)
    .filter(([type, high]) => typeof pollen?.[type] === 'number' && pollen[type] >= high)
    .map(([type]) => type);
}

function joinWords(words) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

// ---------- Everything the page shows for one result ----------

export function describeResult(result) {
  let index = indexForCountry(result.countryCode);
  if (typeof result[SCALES[index].field] !== 'number') index = 'eu'; // US value missing: fall back
  const scale = SCALES[index];
  const value = result[scale.field];
  const position = onScale(index, value) ?? { position: 1, of: 6, label: 'Unknown', level: 1 };
  const { level, label } = position;

  const city = result.city || 'Your area';
  const name = [result.area, city, result.country].filter(Boolean).join(', ');
  const near = result.approximate && result.city ? 'Near ' : '';
  const place = `${near}${name}${result.approximate ? ' · approximate' : ''}`;

  const values = result.concentrations ?? { pm25: result.pm25 ?? null, pm10: result.pm10 ?? null };
  const main = mainPollutant(result.subIndex?.[index]);
  const mainInfo = main ? POLLUTANTS[main] : null;
  const mainValue = main ? values[main] : null;

  const mainLine = mainInfo
    ? `Main pollutant: ${mainInfo.name}` + (typeof mainValue === 'number' ? ` · ${compareToLimit(mainValue, mainInfo.who)}` : '')
    : '';

  const pollenTypes = index === 'eu' ? highPollen(result.pollen) : [];
  const pollenLine = pollenTypes.length ? `Pollen: ${joinWords(pollenTypes)} high` : '';

  const rows = Object.keys(POLLUTANTS)
    .filter((key) => typeof values[key] === 'number' && (ALWAYS_LISTED.includes(key) || key === main))
    .map((key) => {
      const p = POLLUTANTS[key];
      const v = values[key];
      return {
        key,
        code: p.code,
        name: p.name,
        value: v,
        limit: p.who,
        ratio: v / p.who,
        words: compareToLimit(v, p.who).replace('× the WHO limit', '× the limit').replace(' the WHO limit', ''),
        main: key === main,
      };
    });

  const intro = [
    `Today’s air is rated ${label}: level ${position.position} of ${position.of} on the ${scale.long}.`,
    mainInfo ? `The main pollutant is ${mainInfo.name} (${mainInfo.code}), ${mainInfo.source}.` : '',
  ].filter(Boolean).join(' ');

  const otherIndex = index === 'eu' ? 'us' : 'eu';
  const otherValue = result[SCALES[otherIndex].field];
  const otherScale = onScale(otherIndex, otherValue);
  const otherLine = otherScale
    ? `On the ${SCALES[otherIndex].long} this is ${Math.round(otherValue)} (${otherScale.label}).`
    : '';

  return {
    ...BREATH_LEVELS[level - 1],
    label,
    city,
    place,
    index,
    scaleText: `${scale.name} ${Math.round(value)} · ${label}`,
    scaleLabel: `Level ${position.position} of ${position.of} on the ${scale.long}`,
    scalePosition: position.position,
    mainLine,
    pollenLine,
    explain: { intro, rows, otherLine },
  };
}

// The sentence on the share card, both on the page and in the shared image.
export function shareText(view) {
  const where = view.city && view.city !== 'Your area' ? `in ${view.city}` : 'here';
  return `Air ${where} today: ${view.verdict}`;
}
