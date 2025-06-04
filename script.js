// Replace this with your real API key
const API_KEY = "be4794190ef234a77d7f3c74d4fdc88d";

// Update this with the user's current location
navigator.geolocation.getCurrentPosition(success, error);

function success(position) {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;

  const reverseGeocodeURL = `https://api.openweathermap.org/geo/1.0/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${API_KEY}`;

  fetch(reverseGeocodeURL)
    .then(res => res.json())
    .then(locationData => {
      const city = locationData[0]?.name || 'Your area';

      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${latitude}&lon=${longitude}&appid=${API_KEY}`;

      fetch(url)
        .then(response => response.json())
        .then((data) => {
          const aqi = data.list[0].main.aqi;
          const message = interpretAQI(aqi);
          document.getElementById("status").textContent = `${city}: ${message}`;
        });
    })
    .catch(() => {
      document.getElementById("status").textContent = "Failed to load air quality data.";
    });
}

function error() {
  document.getElementById("status").textContent = "Location permission denied.";
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

document.getElementById("check-btn").addEventListener("click", () => {
  const city = document.getElementById("city-input").value.trim();
  if (!city) return;

  let resolvedCity = ""; // <-- Move this outside

  // Get coordinates using OpenWeather Geocoding API
  fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`)
    .then((response) => response.json())
    .then((geoData) => {
      if (!geoData.length) {
        document.getElementById("status").textContent = "City not found.";
        return;
      }

      const { lat, lon } = geoData[0];
      resolvedCity = geoData[0].name;
      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;

      return fetch(url);
    })
    .then((response) => response?.json())
    .then((data) => {
      if (!data?.list?.length) {
        document.getElementById("status").textContent = "No AQI data found.";
        return;
      }

      const aqi = data.list[0].main.aqi;
      const message = interpretAQI(aqi);
      document.getElementById("status").textContent = `${resolvedCity}: AQI Level ${aqi} — ${message}`;
    })
    .catch(() => {
      document.getElementById("status").textContent = "Failed to load city air quality data.";
    });
});