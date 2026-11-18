import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('./index.html', 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

function respond(body) {
  return { ok: true, status: 200, json: async () => body };
}

async function loadPage() {
  document.body.innerHTML = body;
  vi.resetModules();
  await import('./script.js');
}

async function submitCity(name) {
  document.getElementById('city-input').value = name;
  document.getElementById('city-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(document.getElementById('spinner').hidden).toBe(true));
}

describe('page', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) },
      configurable: true,
    });
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes('geocoding-api')) {
        return url.includes('Nowhere')
          ? respond({})
          : respond({ results: [{ name: 'Cologne', country: 'Germany', latitude: 50.93, longitude: 6.95 }] });
      }
      return respond({ current: { european_aqi: 27, us_aqi: 26, pm2_5: 5.8, pm10: 11.2 } });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tells the user when location is not available', async () => {
    await loadPage();
    expect(document.getElementById('info-message').textContent).toMatch(/search for a city/i);
  });

  it('shows air quality for a searched city and clears the loading message', async () => {
    await loadPage();
    await submitCity('Köln');
    expect(document.getElementById('status').textContent).toBe('Cologne, Germany: Fair (European AQI 27)');
    expect(document.getElementById('aqi-details').textContent).toContain('PM2.5 5.8');
    expect(document.getElementById('info-message').textContent).toBe('');
    expect(document.getElementById('check-btn').disabled).toBe(false);
  });

  it('uses the cache for a repeated search', async () => {
    await loadPage();
    await submitCity('Köln');
    await submitCity('köln');
    expect(fetch).toHaveBeenCalledTimes(2); // geocoding + air quality, once
  });

  it('rejects invalid input without calling the API', async () => {
    await loadPage();
    await submitCity('123');
    expect(document.getElementById('status').textContent).toMatch(/valid city/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a clear message for an unknown city', async () => {
    await loadPage();
    await submitCity('Nowhereville');
    expect(document.getElementById('status').textContent).toMatch(/city not found/i);
  });
});
