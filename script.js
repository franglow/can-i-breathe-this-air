// Replace this with your real API key
const API_KEY = "be4794190ef234a77d7f3c74d4fdc88d";

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in ms
const aqiCache = {};

// Persistent cache using localStorage
function setCache(key, data) {
  aqiCache[key] = { data, timestamp: Date.now() };
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
  const entry = aqiCache[key];
  if (entry && (Date.now() - entry.timestamp < CACHE_DURATION)) {
    return entry.data;
  }
  return null;
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

// Update this with the user's current location
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
  setTimeout(() => fetchGeolocationData(position), 100); // Ensure message is rendered before fetch
}, error);

function fetchGeolocationData(position) {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const cacheKey = getCacheKey('geo', `${latitude},${longitude}`);

  const reverseGeocodeURL = `https://api.openweathermap.org/geo/1.0/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${API_KEY}`;

  // Show spinner and disable button
  showSpinner();
  checkBtnEl.disabled = true;
  statusEl.textContent = 'Loading air quality data...';
  fetch(reverseGeocodeURL)
    .then(res => {
      if (!res.ok) throw new Error('Reverse geocoding failed');
      return res.json();
    })
    .then(locationData => {
      if (!locationData.length) throw new Error('Location not found');
      const city = locationData[0]?.name || 'Your area';
      const country = locationData[0]?.country || '';
      const countryFull = country ? countryNameLookup(country) : '';
      const cityCountry = countryFull ? `${city}, ${countryFull}` : city;
      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${latitude}&lon=${longitude}&appid=${API_KEY}`;
      return fetch(url).then(response => {
        if (!response.ok) throw new Error('Air quality fetch failed');
        return response.json();
      }).then((data) => {
        if (!data?.list?.length) throw new Error('No AQI data found');
        const aqi = data.list[0].main.aqi;
        const message = interpretAQI(aqi);
        const statusMsg = `${cityCountry}: AQI Level ${aqi} — ${message}`;
        setCache(cacheKey, statusMsg);
        statusEl.textContent = statusMsg;
        // Optionally, update info message with cityCountry if needed
      });
    })
    .catch((err) => {
      let msg = "Failed to load air quality data.";
      if (err.message === 'Location not found') msg = "Could not determine your location.";
      else if (err.message === 'No AQI data found') msg = "No AQI data found for your area.";
      else if (err.message === 'Reverse geocoding failed' || err.message === 'Air quality fetch failed') msg = "API error. Please try again later.";
      statusEl.textContent = msg;
    })
    .finally(() => {
      hideSpinner();
      checkBtnEl.disabled = false;
    });
}

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

checkBtnEl.addEventListener("click", () => {
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
  // Get coordinates using OpenWeather Geocoding API
  fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`)
    .then((response) => {
      if (!response.ok) throw new Error('Geocoding failed');
      return response.json();
    })
    .then((geoData) => {
      if (!geoData.length) throw new Error('City not found');
      const { lat, lon, name, country } = geoData[0];
      resolvedCity = name;
      resolvedCountry = country;
      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;
      return fetch(url);
    })
    .then((response) => {
      if (!response.ok) throw new Error('Air quality fetch failed');
      return response.json();
    })
    .then((data) => {
      if (!data?.list?.length) throw new Error('No AQI data found');
      const aqi = data.list[0].main.aqi;
      const message = interpretAQI(aqi);
      const countryFull = resolvedCountry ? countryNameLookup(resolvedCountry) : '';
      const cityCountry = countryFull ? `${resolvedCity}, ${countryFull}` : resolvedCity;
      const statusMsg = `${cityCountry}: AQI Level ${aqi} — ${message}`;
      setCache(cacheKey, statusMsg);
      statusEl.textContent = statusMsg;
    })
    .catch((err) => {
      let msg = "Failed to load city air quality data.";
      if (err.message === 'City not found') {
        msg = "City not found.";
        document.getElementById("status").textContent = "City not found.";
        return;
      }
      else if (err.message === 'No AQI data found') msg = "No AQI data found for this city.";
      else if (err.message === 'Geocoding failed' || err.message === 'Air quality fetch failed') msg = "API error. Please try again later.";
      statusEl.textContent = msg;
    })
    .finally(() => {
      hideSpinner();
      checkBtnEl.disabled = false;
    });
});