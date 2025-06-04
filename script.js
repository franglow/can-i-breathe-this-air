// Replace this with your real API key
const API_KEY = "be4794190ef234a77d7f3c74d4fdc88d";

// Update this with the user's current location
navigator.geolocation.getCurrentPosition(success, error);

function success(position) {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;

  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${latitude}&lon=${longitude}&appid=${API_KEY}`;

  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      const aqi = data.list[0].main.aqi;
      const message = interpretAQI(aqi);
      document.getElementById("status").textContent = message;
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