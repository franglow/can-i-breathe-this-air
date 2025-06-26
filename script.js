const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in ms
const aqiCache = {};

// Persistent cache using localStorage
function setCache(key, data) {
  aqiCache[key] = { data, timestamp: Date.now() };
  cleanupCache(); // Clean up expired entries before saving
  try {
    localStorage.setItem('aqiCache', JSON.stringify(aqiCache));
  } catch (e) {}
}

function getCache(key) {
  // On first call, load from localStorage if available
  if (Object.keys(aqiCache).length === 0) {
    try {
      const stored = localStorage.getItem('aqiCache');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(aqiCache, parsed);
      }
    } catch (e) {}
  }
  cleanupCache(); // Clean up expired entries on every get
  const entry = aqiCache[key];
  if (entry && (Date.now() - entry.timestamp < CACHE_DURATION)) {
    return entry.data;
  }
  return null;
}

function cleanupCache() {
  const now = Date.now();
  let changed = false;
  for (const key in aqiCache) {
    if (aqiCache.hasOwnProperty(key)) {
      const entry = aqiCache[key];
      if (!entry || (now - entry.timestamp >= CACHE_DURATION)) {
        delete aqiCache[key];
        changed = true;
      }
    }
  }
  if (changed) {
    try {
      localStorage.setItem('aqiCache', JSON.stringify(aqiCache));
    } catch (e) {}
  }
}

function getCacheKey(type, value) {
  return `${type}:${value}`;
}

const statusEl = document.getElementById("status");
const cityInputEl = document.getElementById("city-input");
const checkBtnEl = document.getElementById("check-btn");

// Add spinner element
const spinner = document.createElement('span');
spinner.id = 'spinner';
spinner.style.display = 'none';
spinner.innerHTML = ' <span class="loader"></span>';
statusEl.after(spinner);

// Info message element (existing in HTML)
const infoEl = document.getElementById('info-message');

function showSpinner() {
  spinner.style.display = '';
}
function hideSpinner() {
  spinner.style.display = 'none';
}
function setInfoMessage(msg) {
  infoEl.textContent = msg;
  infoEl.classList.add('active');
  infoEl.style.display = 'block';
}
function clearInfoMessage() {
  // Do not clear the info message automatically; keep it visible until a new fetch starts
}

// Warn if not using HTTPS (except on localhost)
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  statusEl.textContent = 'Warning: For your security, please use this site over HTTPS.';
}

// Country code to full name lookup using Intl.DisplayNames (fallback to object if not supported)
let countryNameLookup;
if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  countryNameLookup = code => displayNames.of(code) || code;
} else {
  // Fallback for environments without Intl.DisplayNames
  const countryMap = {
    US: 'United States',
    DE: 'Germany',
    FR: 'France',
    GB: 'United Kingdom',
    ES: 'Spain',
    IT: 'Italy',
    // ...add more as needed
  };
  countryNameLookup = code => countryMap[code] || code;
}

// Helper to get backend URL based on environment
function getBackendUrl(lat, lon) {
  // Use local backend if running on localhost, else use deployed Worker
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const base = isLocal
    ? 'http://localhost:8787'
    : 'https://my-air-backend.francortez.workers.dev';
  return `${base}/?lat=${lat}&lon=${lon}`;
}

// Extract shared AQI-fetching and display logic into a reusable async function
async function fetchAndDisplayAQI({ url, cacheKey, fallbackCity }) {
  showSpinner();
  checkBtnEl.disabled = true;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Backend fetch failed:', response.status, response.statusText);
      throw new Error('Backend fetch failed');
    }
    const data = await response.json();
    if (!data?.list?.length) {
      console.error('Backend returned no data:', data);
      throw new Error('No AQI data found');
    }
    const aqi = data.list[0].main.aqi;
    const city = data.city || fallbackCity || 'Your area';
    const country = data.country || '';
    const countryFull = country ? countryNameLookup(country) : '';
    const cityCountry = countryFull ? `${city}, ${countryFull}` : city;
    const message = interpretAQI(aqi);
    const statusMsg = `${cityCountry}: AQI Level ${aqi} — ${message}`;
    setCache(cacheKey, statusMsg);
    statusEl.textContent = statusMsg;
  } catch (err) {
    let msg = fallbackCity ? "Failed to load city air quality data." : "Failed to load air quality data.";
    if (err.message === 'No AQI data found') msg = fallbackCity ? "No AQI data found for this city." : "No AQI data found for your area.";
    else if (err.message === 'Backend fetch failed') msg = "API error. Please try again later.";
    statusEl.textContent = msg;
    if (fallbackCity) console.error('City search error:', err);
  } finally {
    hideSpinner();
    checkBtnEl.disabled = false;
  }
}

// Get user's current location and fetch AQI data using backend
navigator.geolocation.getCurrentPosition((position) => {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const cacheKey = getCacheKey('geo', `${latitude},${longitude}`);
  const cached = getCache(cacheKey);
  if (cached) {
    statusEl.textContent = cached;
    clearInfoMessage();
    return;
  }
  setInfoMessage('Getting air quality data for your current location...');
  showSpinner();
  checkBtnEl.disabled = true;
  setTimeout(() => {
    const url = getBackendUrl(latitude, longitude) + '&details=1';
    fetchAndDisplayAQI({ url, cacheKey });
  }, 100); // Ensure message is rendered before fetch
}, error);

function error() {
  statusEl.textContent = "Location permission denied.";
}

// Turn AQI levels into human-friendly text
function interpretAQI(aqi) {
  switch (aqi) {
    case 1:
      return "🌿 Yes, you can breathe easy.";
    case 2:
      return "🙂 Air quality is fair. Enjoy your day!";
    case 3:
      return "😐 The air is a bit polluted. Maybe avoid heavy outdoor activity.";
    case 4:
      return "😷 The air is poor. Sensitive people should stay inside.";
    case 5:
      return "☠️ Warning: Very poor air quality. Avoid going outside.";
    default:
      return "🤷 Air quality data unavailable.";
  }
}

let lastCheckTime = 0;
const CHECK_THROTTLE_MS = 10 * 1000; // 10 seconds

checkBtnEl.addEventListener("click", async () => {
  const now = Date.now();
  if (now - lastCheckTime < CHECK_THROTTLE_MS) {
    statusEl.textContent = `Please wait a few seconds before checking again.`;
    return;
  }
  lastCheckTime = now;

  const city = cityInputEl.value.trim();
  // Only allow letters, spaces, hyphens, and apostrophes
  if (!city || !/^[a-zA-Z\s\-']+$/.test(city)) {
    statusEl.textContent = "Please enter a valid city name (letters, spaces, hyphens, apostrophes only).";
    return;
  }
  const cacheKey = getCacheKey('city', city.toLowerCase());
  const cached = getCache(cacheKey);
  if (cached) {
    statusEl.textContent = cached;
    clearInfoMessage();
    return;
  }
  setInfoMessage('Getting air quality data for the entered city...');
  showSpinner();
  checkBtnEl.disabled = true;
  // Fetch AQI and city/country from backend by city name
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const base = isLocal
    ? 'http://localhost:8787'
    : 'https://my-air-backend.francortez.workers.dev';
  const url = `${base}/?city=${encodeURIComponent(city)}&details=1`;
  fetchAndDisplayAQI({ url, cacheKey, fallbackCity: city });
});