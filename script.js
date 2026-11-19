import {
  airQualityForCity,
  airQualityForCoords,
  airQualityForIp,
  cityCacheKey,
  createCache,
  describeResult,
  geoCacheKey,
  geolocationPermission,
  getBestPosition,
  isValidCityName,
} from './aqi.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const answerEl = $('answer');
const messageEl = $('aqi-message');
const detailsEl = $('aqi-details');
const infoEl = $('info-message');
const spinnerEl = $('spinner');
const soundEl = $('sound');
const formEl = $('city-form');
const cityInputEl = $('city-input');
const checkBtnEl = $('check-btn');
const locateBtnEl = $('locate-btn');
const shareTextEl = $('share-text');
const shareBtnEl = $('share-btn');
const shareStatusEl = $('share-status');
const themeBtnEl = $('theme-btn');

const params = new URLSearchParams(location.search);
const cache = createCache();

// Minimum gap between network requests started from the form.
const CHECK_THROTTLE_MS = 3 * 1000;
let lastNetworkCheck = 0;

// ---------- Rendering ----------

// Every non-result state, in the same calm voice. Answers stay short so they
// fit on one line at 360px.
const STATES = {
  loading:          { sound: '…',     status: 'Checking the air…', answer: 'One sec.', line: 'Looking up the air near you.' },
  'city-not-found': { sound: 'Huh?',  status: 'City not found',    answer: 'Where?',   line: 'We couldn’t find that place. Check the spelling and try again.' },
  'no-data':        { sound: 'Hmm.',  status: 'No reading',        answer: 'No data.', line: 'No air reading for this place right now. Try a city nearby.' },
  network:          { sound: '…',     status: 'Connection',        answer: 'Offline?', line: 'We couldn’t reach the air data. Try again in a minute.' },
  throttle:         { sound: 'Phew.', status: 'Slow down',         answer: 'One sec.', line: 'Give it a few seconds, then check again.' },
  invalid:          { sound: 'Huh?',  status: 'Check the name',    answer: 'Hmm?',     line: 'Type a city name, like Berlin or São Paulo.' },
};

function renderState(key) {
  const s = STATES[key] ?? STATES.network;
  document.body.dataset.state = key === 'loading' ? 'loading' : 'error';
  delete document.body.dataset.aqi;
  soundEl.textContent = s.sound;
  statusEl.textContent = s.status;
  answerEl.textContent = s.answer;
  messageEl.textContent = s.line;
  detailsEl.textContent = '';
}

function showResult(result) {
  const view = describeResult(result);
  document.body.dataset.state = 'result';
  document.body.dataset.aqi = String(view.level);
  soundEl.textContent = view.sound;
  statusEl.textContent = view.place;
  answerEl.textContent = view.answer;
  messageEl.textContent = view.line;
  detailsEl.textContent = view.data;
  shareTextEl.textContent = `${view.city} today: ${view.answer}`;
  shareBtnEl.disabled = false;
}

function setLoading(isLoading, info = '') {
  spinnerEl.hidden = !isLoading;
  checkBtnEl.disabled = isLoading;
  locateBtnEl.disabled = isLoading;
  if (isLoading) {
    // Keep a previous answer on screen while refreshing; only blank the page the first time.
    if (document.body.dataset.state !== 'result') renderState('loading');
    infoEl.textContent = info;
  }
}

function errorKey(err) {
  return ['city-not-found', 'no-data'].includes(err?.code) ? err.code : 'network';
}

// Returns true when a result was shown.
async function lookup({ cacheKey, load, info, afterInfo = '' }) {
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
    renderState(errorKey(err));
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
    renderState('invalid');
    infoEl.textContent = '';
    return;
  }

  const cacheKey = cityCacheKey(city);
  if (!cache.get(cacheKey)) {
    const now = Date.now();
    if (now - lastNetworkCheck < CHECK_THROTTLE_MS) {
      renderState('throttle');
      infoEl.textContent = '';
      return;
    }
    lastNetworkCheck = now;
  }

  lookup({ cacheKey, load: () => airQualityForCity(city), info: 'Checking the air in that city…' });
});

// ---------- Location ----------

// City-level estimate from the IP address; no permission needed.
function showApproximateLocation(afterInfo) {
  return lookup({ cacheKey: 'ip', load: () => airQualityForIp(), info: 'Estimating your location…', afterInfo });
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
    info: 'Checking the air where you are…',
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

// ---------- Theme ----------

function setTheme(theme, save) {
  document.documentElement.dataset.theme = theme;
  themeBtnEl.setAttribute('aria-pressed', String(theme === 'dark'));
  $('theme-label').textContent = theme === 'dark' ? 'Light' : 'Dark';
  if (save) {
    try { localStorage.setItem('theme', theme); } catch { /* private mode: just don't remember */ }
  }
}

themeBtnEl.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
});
// The inline script in <head> already picked the theme; sync the button with it.
setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);

// ---------- Share ----------

let shareResetTimer;
shareBtnEl.addEventListener('click', async () => {
  const data = { title: 'Can I Breathe This Air?', text: shareTextEl.textContent, url: location.origin + location.pathname };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    shareBtnEl.textContent = 'Link copied';
    shareStatusEl.textContent = 'Link copied to the clipboard.';
  } catch (err) {
    if (err?.name === 'AbortError') return; // user closed the share sheet
    shareBtnEl.textContent = 'Couldn’t copy';
    shareStatusEl.textContent = 'Could not copy the link.';
  }
  clearTimeout(shareResetTimer);
  shareResetTimer = setTimeout(() => {
    shareBtnEl.textContent = 'Share to stories';
    shareStatusEl.textContent = '';
  }, 2500);
});

// ---------- Start ----------

// Temporary test override: ?aqi=1..5 shows sample data for that level and skips the network.
const SAMPLES = [
  { europeanAqi: 17, pm25: 3.5, pm10: 4.9 },
  { europeanAqi: 34, pm25: 9, pm10: 22 },
  { europeanAqi: 52, pm25: 18, pm10: 40 },
  { europeanAqi: 71, pm25: 32, pm10: 70 },
  { europeanAqi: 96, pm25: 58, pm10: 115 },
];
const sampleLevel = parseInt(params.get('aqi'), 10);
if (sampleLevel >= 1 && sampleLevel <= 5) {
  showResult({ city: 'Berlin', ...SAMPLES[sampleLevel - 1] });
  infoEl.textContent = 'Sample data (?aqi override).';
} else {
  start();
}
