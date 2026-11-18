import { describe, it, expect, vi } from 'vitest';
import {
  airQualityForCity,
  airQualityForCoords,
  cityCacheKey,
  createCache,
  formatResult,
  geoCacheKey,
  interpretAQI,
  isValidCityName,
} from './aqi.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mockFetch(routes) {
  return vi.fn(async (url) => {
    for (const [pattern, response] of routes) {
      if (url.includes(pattern)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

const airResponse = jsonResponse({
  current: { time: '2026-11-18T12:00', european_aqi: 27, us_aqi: 26, pm2_5: 5.8, pm10: 11.2 },
});

describe('isValidCityName', () => {
  it.each(['London', 'Köln', 'São Paulo', "N'Djamena", 'Winston-Salem', 'St. Louis', '東京'])('accepts %s', (city) => {
    expect(isValidCityName(city)).toBe(true);
  });

  it.each(['', '   ', '123', '<script>', 'Berlin; DROP', 'a'.repeat(101)])('rejects %j', (city) => {
    expect(isValidCityName(city)).toBe(false);
  });
});

describe('interpretAQI', () => {
  it.each([
    [0, 'Good'],
    [20, 'Good'],
    [21, 'Fair'],
    [50, 'Moderate'],
    [75, 'Poor'],
    [95, 'Very poor'],
    [150, 'Extremely poor'],
  ])('EAQI %d is %s', (value, label) => {
    expect(interpretAQI(value).label).toBe(label);
  });

  it('handles missing values', () => {
    expect(interpretAQI(undefined).label).toBe('Unknown');
    expect(interpretAQI(-1).label).toBe('Unknown');
  });
});

describe('cache keys', () => {
  it('rounds coordinates so small GPS jitter shares a key', () => {
    expect(geoCacheKey(50.93812, 6.95991)).toBe(geoCacheKey(50.9379, 6.9601));
  });

  it('normalizes city names', () => {
    expect(cityCacheKey('  KÖLN ')).toBe(cityCacheKey('köln'));
  });
});

describe('createCache', () => {
  function memoryStorage() {
    const data = {};
    return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  }

  it('returns stored values until they expire', () => {
    let t = 0;
    const cache = createCache({ storage: memoryStorage(), now: () => t, ttl: 1000 });
    cache.set('a', { x: 1 });
    expect(cache.get('a')).toEqual({ x: 1 });
    t = 1000;
    expect(cache.get('a')).toBeNull();
  });

  it('survives a reload through storage', () => {
    const storage = memoryStorage();
    createCache({ storage, now: () => 0 }).set('a', 42);
    expect(createCache({ storage, now: () => 1 }).get('a')).toBe(42);
  });

  it('works when storage is unavailable or corrupt', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    const cache = createCache({ storage: broken });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });
});

describe('airQualityForCity', () => {
  it('geocodes the city, then fetches air quality', async () => {
    const fetchImpl = mockFetch([
      ['geocoding-api', jsonResponse({ results: [{ name: 'Cologne', country: 'Germany', latitude: 50.93, longitude: 6.95 }] })],
      ['air-quality-api', airResponse],
    ]);
    const result = await airQualityForCity('Köln', fetchImpl);
    expect(result).toMatchObject({ city: 'Cologne', country: 'Germany', europeanAqi: 27, usAqi: 26, pm25: 5.8 });
    expect(fetchImpl.mock.calls[0][0]).toContain('name=K%C3%B6ln');
    expect(fetchImpl.mock.calls[1][0]).toContain('latitude=50.93');
  });

  it('reports an unknown city', async () => {
    const fetchImpl = mockFetch([['geocoding-api', jsonResponse({})]]);
    await expect(airQualityForCity('Nowhereville', fetchImpl)).rejects.toMatchObject({ code: 'city-not-found' });
  });

  it('reports missing air quality data', async () => {
    const fetchImpl = mockFetch([
      ['geocoding-api', jsonResponse({ results: [{ name: 'X', latitude: 1, longitude: 2 }] })],
      ['air-quality-api', jsonResponse({ current: {} })],
    ]);
    await expect(airQualityForCity('X', fetchImpl)).rejects.toMatchObject({ code: 'no-data' });
  });

  it('reports HTTP and network failures', async () => {
    await expect(airQualityForCity('X', mockFetch([['geocoding-api', jsonResponse({}, false, 500)]])))
      .rejects.toMatchObject({ code: 'network' });
    await expect(airQualityForCity('X', mockFetch([['geocoding-api', new TypeError('offline')]])))
      .rejects.toMatchObject({ code: 'network' });
  });
});

describe('airQualityForCoords', () => {
  it('adds the city name from reverse geocoding', async () => {
    const fetchImpl = mockFetch([
      ['air-quality-api', airResponse],
      ['bigdatacloud', jsonResponse({ city: 'Koln', countryName: 'Germany' })],
    ]);
    const result = await airQualityForCoords(50.94, 6.96, fetchImpl);
    expect(result).toMatchObject({ city: 'Koln', country: 'Germany', europeanAqi: 27 });
  });

  it('still returns air quality when reverse geocoding fails', async () => {
    const fetchImpl = mockFetch([
      ['air-quality-api', airResponse],
      ['bigdatacloud', new TypeError('offline')],
    ]);
    const result = await airQualityForCoords(50.94, 6.96, fetchImpl);
    expect(result).toMatchObject({ city: '', country: '', europeanAqi: 27 });
  });
});

describe('formatResult', () => {
  it('builds headline, message and details', () => {
    const out = formatResult({ city: 'Cologne', country: 'Germany', europeanAqi: 27, usAqi: 26, pm25: 5.8, pm10: 11.2 });
    expect(out.headline).toBe('Cologne, Germany: Fair (European AQI 27)');
    expect(out.message).toMatch(/fair/i);
    expect(out.details).toBe('US AQI 26 · PM2.5 5.8 µg/m³ · PM10 11.2 µg/m³');
  });

  it('falls back to "Your area" without a city', () => {
    expect(formatResult({ europeanAqi: 10 }).headline).toBe('Your area: Good (European AQI 10)');
  });
});
