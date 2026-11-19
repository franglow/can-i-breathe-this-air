import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('./index.html', 'utf8');
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

function respond(body) {
  return { ok: true, status: 200, json: async () => body };
}

const $ = (id) => document.getElementById(id);

function setPermission(state) {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state }) },
    configurable: true,
  });
}

// readings: array of accuracies to emit, or { error: code }
function setGeolocation(readings) {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      watchPosition: vi.fn((ok, fail) => {
        queueMicrotask(() => {
          if (readings.error) fail({ code: readings.error, message: 'error' });
          else readings.forEach((accuracy) => ok({ coords: { latitude: 50.94, longitude: 6.96, accuracy } }));
        });
        return 1;
      }),
      clearWatch: vi.fn(),
    },
    configurable: true,
  });
}

async function loadPage() {
  document.body.innerHTML = body;
  vi.resetModules();
  await import('./script.js');
  await settle();
}

async function settle() {
  await vi.waitFor(() => expect($('spinner').hidden).toBe(true));
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect($('spinner').hidden).toBe(true));
}

async function submitCity(name) {
  $('city-input').value = name;
  $('city-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

describe('page', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    setPermission('prompt');
    setGeolocation([30]);
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('geocoding-api')) {
        return url.includes('Nowhere')
          ? respond({})
          : respond({ results: [{ name: 'Cologne', country: 'Germany', latitude: 50.93, longitude: 6.95 }] });
      }
      if (url.includes('bigdatacloud')) {
        return url.includes('latitude=')
          ? respond({ city: 'Koln', locality: 'Altstadt Nord', countryName: 'Germany' })
          : respond({ latitude: 52.52, longitude: 13.4, city: 'Berlin', countryName: 'Germany' });
      }
      return respond({ current: { european_aqi: 27, us_aqi: 26, pm2_5: 5.8, pm10: 11.2 } });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on load', () => {
    it('shows an approximate result and offers precise location without prompting', async () => {
      await loadPage();
      expect($('status').textContent).toBe('Near Berlin, Germany · Fair');
      expect($('answer').textContent).toBe('Yes.');
      expect(document.body.dataset.aqi).toBe('2');
      expect($('share-text').textContent).toBe('Berlin today: Yes.');
      expect($('locate-btn').hidden).toBe(false);
      expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('uses precise location straight away when already allowed', async () => {
      setPermission('granted');
      await loadPage();
      expect($('status').textContent).toBe('Altstadt Nord, Koln, Germany · Fair');
      expect($('locate-btn').hidden).toBe(true);
    });

    it('falls back to approximate location when access is off', async () => {
      setPermission('denied');
      await loadPage();
      expect($('status').textContent).toMatch(/^Near Berlin/);
      expect($('info-message').textContent).toMatch(/location access is off/i);
      expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('falls back to approximate location without HTTPS', async () => {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      await loadPage();
      expect($('status').textContent).toMatch(/^Near Berlin/);
      expect($('info-message').textContent).toMatch(/https/i);
    });
  });

  describe('use my location button', () => {
    it('shows the precise result', async () => {
      await loadPage();
      $('locate-btn').click();
      await settle();
      expect($('status').textContent).toMatch(/^Altstadt Nord, Koln/);
      expect($('locate-btn').hidden).toBe(true);
      expect($('info-message').textContent).toBe('');
    });

    it('explains when the user refuses', async () => {
      setGeolocation({ error: 1 });
      await loadPage();
      $('locate-btn').click();
      await settle();
      expect($('status').textContent).toMatch(/^Near Berlin/);
      expect($('info-message').textContent).toMatch(/location access is off/i);
    });
  });

  describe('city search', () => {
    it('shows air quality and clears the approximate note', async () => {
      await loadPage();
      await submitCity('Köln');
      expect($('status').textContent).toBe('Cologne, Germany · Fair');
      expect($('aqi-details').textContent).toBe('EU AQI 27 · US AQI 26 · PM2.5 5.8 · PM10 11.2 µg/m³');
      expect($('info-message').textContent).toBe('');
      expect($('check-btn').disabled).toBe(false);
    });

    it('uses the cache for a repeated search', async () => {
      await loadPage();
      fetch.mockClear();
      await submitCity('Köln');
      await submitCity('köln');
      expect(fetch).toHaveBeenCalledTimes(2); // geocoding + air quality, once
    });

    it('rejects invalid input without calling the API', async () => {
      await loadPage();
      fetch.mockClear();
      await submitCity('123');
      expect($('answer').textContent).toBe('Hmm?');
      expect($('aqi-message').textContent).toMatch(/city name/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('shows a clear message for an unknown city', async () => {
      await loadPage();
      await submitCity('Nowhereville');
      expect($('answer').textContent).toBe('Where?');
      expect(document.body.dataset.state).toBe('error');
      expect(document.body.dataset.aqi).toBeUndefined();
    });
    it('stays calm on a network error', async () => {
      await loadPage();
      fetch.mockImplementation(async () => { throw new TypeError('offline'); });
      await submitCity('Lima');
      expect($('answer').textContent).toBe('Offline?');
    });

    it('asks the user to wait when checking too fast', async () => {
      await loadPage();
      await submitCity('Lima');
      await submitCity('Quito');
      expect($('answer').textContent).toBe('One sec.');
      expect($('aqi-message').textContent).toMatch(/few seconds/i);
    });
  });
});
