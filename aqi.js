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
  { max: 20, label: 'Good', message: '🌿 Yes, you can breathe easy.' },
  { max: 40, label: 'Fair', message: '🙂 Air quality is fair. Enjoy your day!' },
  { max: 60, label: 'Moderate', message: '😐 The air is a bit polluted. Maybe avoid heavy outdoor activity.' },
  { max: 80, label: 'Poor', message: '😷 The air is poor. Sensitive people should stay inside.' },
  { max: 100, label: 'Very poor', message: '☠️ Very poor air quality. Avoid going outside.' },
  { max: Infinity, label: 'Extremely poor', message: '☠️ Extremely poor air quality. Stay indoors.' },
];

export function interpretAQI(eaqi) {
  if (typeof eaqi !== 'number' || Number.isNaN(eaqi) || eaqi < 0) {
    return { label: 'Unknown', message: '🤷 Air quality data unavailable.' };
  }
  const band = EAQI_BANDS.find((b) => eaqi <= b.max);
  return { label: band.label, message: band.message };
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
    return { city: data.city || data.locality || '', country: data.countryName || '' };
  } catch {
    return { city: '', country: '' };
  }
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

export async function airQualityForCoords(lat, lon, fetchImpl = fetch) {
  const [air, place] = await Promise.all([
    fetchAirQuality(lat, lon, fetchImpl),
    reverseGeocode(lat, lon, fetchImpl),
  ]);
  return { city: place.city, country: place.country, ...air };
}

// ---------- Formatting ----------

export function formatResult(result) {
  const { label, message } = interpretAQI(result.europeanAqi);
  const place = [result.city || 'Your area', result.country].filter(Boolean).join(', ');
  const headline = `${place}: ${label} (European AQI ${Math.round(result.europeanAqi)})`;
  const details = [
    result.usAqi != null ? `US AQI ${Math.round(result.usAqi)}` : null,
    result.pm25 != null ? `PM2.5 ${result.pm25} µg/m³` : null,
    result.pm10 != null ? `PM10 ${result.pm10} µg/m³` : null,
  ].filter(Boolean).join(' · ');
  return { headline, message, details };
}
