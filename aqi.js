// Air-quality logic with no DOM access, so it can be tested on its own.
// Data sources (all free, no API key):
//   - Open-Meteo Air Quality API: https://open-meteo.com/en/docs/air-quality-api
//   - Open-Meteo Geocoding API:   https://open-meteo.com/en/docs/geocoding-api
//   - BigDataCloud client reverse geocoding (coordinates -> city name)

export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_STORAGE_KEY = 'aqiCache.v2';

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
  { level: 1, sound: 'Aaah.', answer: 'Yes.', line: 'Clean air. Go outside.' },
  { level: 2, sound: 'Mmm.', answer: 'Yes.', line: 'Fine for almost everyone.' },
  { level: 3, sound: 'Hmm.', answer: 'Mostly.', line: 'Sensitive lungs: take it easy.' },
  { level: 4, sound: 'Ehem.', answer: 'Not now.', line: 'Keep time outdoors short.' },
  { level: 5, sound: '…', answer: 'No.', line: 'Stay in. Close the windows.' },
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
  return { lat: place.latitude, lon: place.longitude, city: place.name, country: place.country || '' };
}

// Best effort: if this fails, the app shows "Your area" instead of a city name.
export async function reverseGeocode(lat, lon, fetchImpl = fetch) {
  try {
    const url = `${REVERSE_GEOCODING_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const data = await getJson(url, fetchImpl);
    return { city: data.city || data.locality || '', locality: data.locality || '', country: data.countryName || '' };
  } catch {
    return { city: '', locality: '', country: '' };
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
  };
}

export async function fetchAirQuality(lat, lon, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'european_aqi,us_aqi,pm2_5,pm10',
    timezone: 'auto',
  });
  const data = await getJson(`${AIR_QUALITY_URL}?${params}`, fetchImpl);
  const current = data?.current;
  if (!current || typeof current.european_aqi !== 'number') {
    throw new AirQualityError('no-data', 'No air quality data for this location');
  }
  return {
    europeanAqi: current.european_aqi,
    usAqi: current.us_aqi ?? null,
    pm25: current.pm2_5 ?? null,
    pm10: current.pm10 ?? null,
    time: current.time ?? null,
  };
}

// ---------- High-level lookups ----------

export async function airQualityForCity(city, fetchImpl = fetch) {
  const place = await geocodeCity(city, fetchImpl);
  const air = await fetchAirQuality(place.lat, place.lon, fetchImpl);
  return { city: place.city, country: place.country, ...air };
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
  return { area, city: place.city, country: place.country, ...air };
}

export async function airQualityForIp(fetchImpl = fetch) {
  const place = await approximateLocationFromIp(fetchImpl);
  const air = await fetchAirQuality(place.lat, place.lon, fetchImpl);
  return { city: place.city, country: place.country, approximate: true, ...air };
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

// Everything the page shows for one result.
export function describeResult(result) {
  const level = breathLevel(result.europeanAqi) ?? 1;
  const { label } = interpretAQI(result.europeanAqi);
  const city = result.city || 'Your area';
  const name = [result.area, city, result.country].filter(Boolean).join(', ');
  const near = result.approximate && result.city ? 'Near ' : '';

  const pm = [
    result.pm25 != null ? `PM2.5 ${result.pm25}` : null,
    result.pm10 != null ? `PM10 ${result.pm10}` : null,
  ].filter(Boolean).join(' · ');
  const data = [
    `EU AQI ${Math.round(result.europeanAqi)}`,
    result.usAqi != null ? `US AQI ${Math.round(result.usAqi)}` : null,
    pm ? `${pm} µg/m³` : null,
  ].filter(Boolean).join(' · ');

  return { ...BREATH_LEVELS[level - 1], label, place: `${near}${name} · ${label}`, data, city };
}
