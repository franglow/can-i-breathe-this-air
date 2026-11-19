import { describe, it, expect, vi } from 'vitest';
import {
  airQualityForCity,
  airQualityForCoords,
  airQualityForIp,
  geolocationPermission,
  getBestPosition,
  cityCacheKey,
  createCache,
  breathLevel,
  describeResult,
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

describe('breathLevel', () => {
  it.each([[0, 1], [20, 1], [20.5, 2], [40, 2], [55, 3], [80, 4], [81, 5], [250, 5]])('%s -> level %s', (eaqi, level) => {
    expect(breathLevel(eaqi)).toBe(level);
  });

  it('returns null for missing data', () => {
    expect(breathLevel(undefined)).toBeNull();
  });
});

describe('describeResult', () => {
  it('builds place, answer and data line', () => {
    const out = describeResult({ city: 'Cologne', country: 'Germany', europeanAqi: 27, usAqi: 26, pm25: 5.8, pm10: 11.2 });
    expect(out).toMatchObject({ level: 2, sound: 'Mmm.', answer: 'Yes.', city: 'Cologne' });
    expect(out.place).toBe('Cologne, Germany · Fair');
    expect(out.data).toBe('EU AQI 27 · US AQI 26 · PM2.5 5.8 · PM10 11.2 µg/m³');
  });

  it('falls back to "Your area" without a city', () => {
    expect(describeResult({ europeanAqi: 10 }).place).toBe('Your area · Good');
  });

  it('uses level 5 for extremely poor air', () => {
    expect(describeResult({ city: 'X', europeanAqi: 140 })).toMatchObject({ level: 5, answer: 'No.', label: 'Extremely poor' });
  });
});

describe('neighbourhood names', () => {
  const routes = () => mockFetch([
    ['air-quality-api', airResponse],
    ['bigdatacloud', jsonResponse({ city: 'Koln', locality: 'Altstadt Nord', countryName: 'Germany' })],
  ]);

  it('shows the area when the position is precise', async () => {
    const result = await airQualityForCoords(50.94, 6.96, routes(), { accuracy: 30 });
    expect(describeResult(result).place).toBe('Altstadt Nord, Koln, Germany · Fair');
  });

  it('hides the area when the position is rough', async () => {
    const result = await airQualityForCoords(50.94, 6.96, routes(), { accuracy: 5000 });
    expect(result.area).toBe('');
  });
});

describe('airQualityForIp', () => {
  it('uses the IP location and marks the result as approximate', async () => {
    const fetchImpl = mockFetch([
      ['bigdatacloud', jsonResponse({ latitude: 52.52, longitude: 13.4, city: 'Berlin', countryName: 'Germany' })],
      ['air-quality-api', airResponse],
    ]);
    const result = await airQualityForIp(fetchImpl);
    expect(result).toMatchObject({ city: 'Berlin', approximate: true, europeanAqi: 27 });
    expect(fetchImpl.mock.calls[0][0]).not.toContain('latitude=');
    expect(fetchImpl.mock.calls[1][0]).toContain('latitude=52.52');
    expect(describeResult(result).place).toBe('Near Berlin, Germany · Fair');
  });

  it('fails cleanly when the IP lookup has no coordinates', async () => {
    const fetchImpl = mockFetch([['bigdatacloud', jsonResponse({})]]);
    await expect(airQualityForIp(fetchImpl)).rejects.toMatchObject({ code: 'no-location' });
  });
});

describe('getBestPosition', () => {
  // Fake geolocation that replays readings when the test calls emit().
  function fakeGeolocation() {
    const geo = {
      cleared: [],
      watchPosition: vi.fn((ok, fail, options) => {
        geo.ok = ok;
        geo.fail = fail;
        geo.options = options;
        return 7;
      }),
      clearWatch: vi.fn((id) => geo.cleared.push(id)),
      emit(accuracy, lat = 50, lon = 7) {
        geo.ok({ coords: { latitude: lat, longitude: lon, accuracy } });
      },
    };
    return geo;
  }

  function fakeTimer() {
    const t = { fire: null };
    t.set = (fn) => { t.fire = fn; return 1; };
    t.clear = vi.fn();
    return t;
  }

  it('asks for high accuracy', () => {
    const geo = fakeGeolocation();
    getBestPosition(geo);
    expect(geo.options).toMatchObject({ enableHighAccuracy: true });
    expect(geo.options.timeout).toBeGreaterThan(0);
    expect(geo.options.maximumAge).toBeGreaterThan(0);
  });

  it('keeps refining until a reading is accurate enough', async () => {
    const geo = fakeGeolocation();
    const timer = fakeTimer();
    const promise = getBestPosition(geo, { goodAccuracy: 100, setTimer: timer.set, clearTimer: timer.clear });
    geo.emit(2000, 1, 1);
    geo.emit(400, 2, 2);
    expect(geo.clearWatch).not.toHaveBeenCalled();
    geo.emit(25, 3, 3);
    await expect(promise).resolves.toEqual({ lat: 3, lon: 3, accuracy: 25 });
    expect(geo.cleared).toEqual([7]);
    expect(timer.clear).toHaveBeenCalled();
  });

  it('returns the best reading so far when time runs out', async () => {
    const geo = fakeGeolocation();
    const timer = fakeTimer();
    const promise = getBestPosition(geo, { setTimer: timer.set, clearTimer: timer.clear });
    geo.emit(800, 1, 1);
    geo.emit(1500, 2, 2); // worse, ignored
    timer.fire();
    await expect(promise).resolves.toEqual({ lat: 1, lon: 1, accuracy: 800 });
    expect(geo.cleared).toEqual([7]);
  });

  it('reports a refused permission', async () => {
    const geo = fakeGeolocation();
    const promise = getBestPosition(geo, { setTimer: () => 1, clearTimer: () => {} });
    geo.fail({ code: 1, message: 'User denied' });
    await expect(promise).rejects.toMatchObject({ code: 'denied' });
  });

  it('keeps an earlier reading if a later one fails', async () => {
    const geo = fakeGeolocation();
    const promise = getBestPosition(geo, { setTimer: () => 1, clearTimer: () => {} });
    geo.emit(600, 4, 4);
    geo.fail({ code: 3, message: 'Timeout' });
    await expect(promise).resolves.toMatchObject({ lat: 4, accuracy: 600 });
  });

  it('handles a reading delivered synchronously', async () => {
    const geo = fakeGeolocation();
    geo.watchPosition = vi.fn((ok) => {
      ok({ coords: { latitude: 5, longitude: 5, accuracy: 10 } });
      return 9;
    });
    await expect(getBestPosition(geo, { setTimer: () => 1, clearTimer: () => {} })).resolves.toMatchObject({ lat: 5 });
    expect(geo.cleared).toEqual([9]);
  });

  it('rejects when geolocation is not supported', async () => {
    await expect(getBestPosition(undefined)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('geolocationPermission', () => {
  it('returns the permission state', async () => {
    await expect(geolocationPermission({ query: async () => ({ state: 'granted' }) })).resolves.toBe('granted');
  });

  it('returns "unknown" when the Permissions API is missing', async () => {
    await expect(geolocationPermission(undefined)).resolves.toBe('unknown');
  });
});
