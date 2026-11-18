import {
  airQualityForCity,
  airQualityForCoords,
  cityCacheKey,
  createCache,
  formatResult,
  geoCacheKey,
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

const cache = createCache();

// Minimum gap between network requests started from the button.
const CHECK_THROTTLE_MS = 3 * 1000;
let lastNetworkCheck = 0;

function setLoading(isLoading, info = '') {
  spinnerEl.hidden = !isLoading;
  checkBtnEl.disabled = isLoading;
  infoEl.textContent = info;
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

async function lookup({ cacheKey, load, info, forCity }) {
  const cached = cache.get(cacheKey);
  if (cached) {
    showResult(cached);
    return;
  }
  setLoading(true, info);
  try {
    const result = await load();
    cache.set(cacheKey, result);
    showResult(result);
  } catch (err) {
    console.error(err);
    showError(errorText(err, forCity));
  } finally {
    setLoading(false);
  }
}

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

// Check the user's current location on load.
if (!window.isSecureContext) {
  infoEl.textContent = 'Location needs HTTPS. Search for a city instead.';
} else if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const { latitude, longitude } = coords;
      lookup({
        cacheKey: geoCacheKey(latitude, longitude),
        load: () => airQualityForCoords(latitude, longitude),
        info: 'Getting air quality data for your current location…',
        forCity: false,
      });
    },
    () => {
      infoEl.textContent = 'Location not available. Search for a city instead.';
    },
  );
}
