/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// In-memory cache for Worker (per instance, not global)
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const aqiCache = new Map();

function getWorkerCache(key) {
  const entry = aqiCache.get(key);
  if (entry && (Date.now() - entry.timestamp < CACHE_DURATION_MS)) {
    return entry.data;
  }
  if (entry) aqiCache.delete(key);
  return null;
}
function setWorkerCache(key, data) {
  aqiCache.set(key, { data, timestamp: Date.now() });
}

export default {
  async fetch(request, env, ctx) {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const city = searchParams.get("city");
    const details = searchParams.get("details");
    const apiKey = env.AIR_API_KEY;

    // Helper to add CORS headers
    function cors(res) {
      res.headers.set("Access-Control-Allow-Origin", "*");
      return res;
    }

    // Helper to build cache key
    function buildCacheKey(type, value) {
      return `${type}:${value}`;
    }

    // If city is provided, geocode to lat/lon
    if (city) {
      const cacheKey = buildCacheKey('city', city.toLowerCase());
      const cached = getWorkerCache(cacheKey);
      if (cached) {
        return cors(new Response(JSON.stringify(cached), { headers: { "Content-Type": "application/json" } }));
      }
      // Geocode city to lat/lon
      const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        return cors(new Response(JSON.stringify({ error: "Geocoding failed" }), { status: 500, headers: { "Content-Type": "application/json" } }));
      }
      const geoData = await geoRes.json();
      if (!geoData.length) {
        return cors(new Response(JSON.stringify({ error: "City not found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      }
      const { lat, lon, name, country } = geoData[0];
      // Fetch AQI
      const aqiUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
      const aqiRes = await fetch(aqiUrl);
      if (!aqiRes.ok) {
        return cors(new Response(JSON.stringify({ error: "AQI fetch failed" }), { status: 500, headers: { "Content-Type": "application/json" } }));
      }
      const aqiData = await aqiRes.json();
      // Attach city/country if details requested
      if (details === '1') {
        aqiData.city = name;
        aqiData.country = country;
      }
      setWorkerCache(cacheKey, aqiData);
      return cors(new Response(JSON.stringify(aqiData), { headers: { "Content-Type": "application/json" } }));
    }

    // If lat/lon provided, fetch AQI (and optionally city/country)
    if (lat && lon) {
      const cacheKey = buildCacheKey('geo', `${lat},${lon}`);
      const cached = getWorkerCache(cacheKey);
      if (cached) {
        return cors(new Response(JSON.stringify(cached), { headers: { "Content-Type": "application/json" } }));
      }
      const aqiUrl = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
      const aqiRes = await fetch(aqiUrl);
      if (!aqiRes.ok) {
        return cors(new Response(JSON.stringify({ error: "AQI fetch failed" }), { status: 500, headers: { "Content-Type": "application/json" } }));
      }
      const aqiData = await aqiRes.json();
      if (details === '1') {
        // Reverse geocode to get city/country
        const revUrl = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${apiKey}`;
        const revRes = await fetch(revUrl);
        if (revRes.ok) {
          const revData = await revRes.json();
          if (revData.length) {
            aqiData.city = revData[0].name;
            aqiData.country = revData[0].country;
          }
        }
      }
      setWorkerCache(cacheKey, aqiData);
      return cors(new Response(JSON.stringify(aqiData), { headers: { "Content-Type": "application/json" } }));
    }

    // If neither, error
    return cors(new Response(JSON.stringify({ error: "Missing latitude/longitude or city" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  },
};
