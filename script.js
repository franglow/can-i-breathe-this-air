import {
  airQualityForCity,
  airQualityForCoords,
  airQualityForIp,
  cityCacheKey,
  createCache,
  formatResult,
  geoCacheKey,
  geolocationPermission,
  getBestPosition,
  isValidCityName,
} from './aqi.js';

const statusEl = document.getElementById('status');
const messageEl = document.getElementById('aqi-message');
const detailsEl = document.getElementById('aqi-details');
const infoEl = document.getElementById('info-message');
const spinnerEl = document.getElementById('spinner');
const formEl = document.getElementById('city-form');
const cityInputEl = document.getElementById('city-input');
const checkBtnEl = document.getElementById('check-btn');
const locateBtnEl = document.getElementById('locate-btn');

const cache = createCache();

// Minimum gap between network requests started from the button.
const CHECK_THROTTLE_MS = 3 * 1000;
let lastNetworkCheck = 0;

function setLoading(isLoading, info = '') {
  spinnerEl.hidden = !isLoading;
  checkBtnEl.disabled = isLoading;
  locateBtnEl.disabled = isLoading;
  if (isLoading || info) infoEl.textContent = info;
}

function showResult(result) {
  const { headline, message, details } = formatResult(result);
  statusEl.textContent = headline;
  messageEl.textContent = message;
  detailsEl.textContent = details;
}

function showError(text) {
  statusEl.textContent = text;
  messageEl.textContent = '';
  detailsEl.textContent = '';
}

function errorText(err, forCity) {
  switch (err?.code) {
    case 'city-not-found':
      return 'City not found. Check the spelling and try again.';
    case 'no-data':
      return forCity ? 'No air quality data for this city.' : 'No air quality data for your area.';
    default:
      return 'Could not load air quality data. Please try again later.';
  }
}

// Returns true when a result was shown.
async function lookup({ cacheKey, load, info, forCity, afterInfo = '' }) {
  const cached = cache.get(cacheKey);
  if (cached) {
    showResult(cached);
    infoEl.textContent = afterInfo;
    return true;
  }
  setLoading(true, info);
  try {
    const result = await load();
    cache.set(cacheKey, result);
    showResult(result);
    return true;
  } catch (err) {
    console.error(err);
    showError(errorText(err, forCity));
    return false;
  } finally {
    setLoading(false);
    infoEl.textContent = afterInfo;
  }
}

// ---------- City search ----------

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const city = cityInputEl.value.trim();
  if (!isValidCityName(city)) {
    showError('Please enter a valid city name.');
    return;
  }

  const cacheKey = cityCacheKey(city);
  if (!cache.get(cacheKey)) {
    const now = Date.now();
    if (now - lastNetworkCheck < CHECK_THROTTLE_MS) {
      showError('Please wait a few seconds before checking again.');
      return;
    }
    lastNetworkCheck = now;
  }

  lookup({
    cacheKey,
    load: () => airQualityForCity(city),
    info: 'Getting air quality data for the entered city…',
    forCity: true,
  });
});

// ---------- Location ----------

// City-level estimate from the IP address; no permission needed.
function showApproximateLocation(afterInfo) {
  return lookup({
    cacheKey: 'ip',
    load: () => airQualityForIp(),
    info: 'Estimating your location…',
    forCity: false,
    afterInfo,
  });
}

async function showDeviceLocation() {
  setLoading(true, 'Finding your location…');
  let position;
  try {
    position = await getBestPosition(navigator.geolocation);
  } catch (err) {
    setLoading(false);
    if (err.code === 'denied') {
      locateBtnEl.hidden = true;
      return showApproximateLocation('Location access is off, so this is approximate. Search for a city for exact results.');
    }
    return showApproximateLocation('Could not get your precise location, so this is approximate.');
  }
  locateBtnEl.hidden = true;
  return lookup({
    cacheKey: geoCacheKey(position.lat, position.lon),
    load: () => airQualityForCoords(position.lat, position.lon, fetch, { accuracy: position.accuracy }),
    info: 'Getting air quality data for your location…',
    forCity: false,
  });
}

locateBtnEl.addEventListener('click', () => {
  showDeviceLocation();
});

async function start() {
  const canUseDevice = window.isSecureContext && 'geolocation' in navigator;
  if (!canUseDevice) {
    return showApproximateLocation('Precise location needs HTTPS, so this is approximate.');
  }

  const permission = await geolocationPermission();
  if (permission === 'granted') {
    // Already allowed: no prompt will appear, so go straight to precise location.
    return showDeviceLocation();
  }
  if (permission === 'denied') {
    return showApproximateLocation('Location access is off, so this is approximate. Search for a city for exact results.');
  }
  // 'prompt' or 'unknown': don't ask on load. Show an estimate and let the user opt in.
  locateBtnEl.hidden = false;
  return showApproximateLocation('This is approximate. Use your location for a precise reading.');
}

start();
