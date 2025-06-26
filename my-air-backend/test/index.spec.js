import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src';

// Mock fetch helper
function mockFetchImplementation() {
	return vi.fn(async (url) => {
		if (typeof url === 'string' && url.includes('geo/1.0/direct')) {
			// Geocoding for city=London
			if (url.includes('London')) {
				return {
					ok: true,
					json: async () => [{ lat: 51.5074, lon: -0.1278, name: 'London', country: 'GB' }],
				};
			}
			// Geocoding for invalid city
			if (url.includes('NotARealCity12345')) {
				return {
					ok: true,
					json: async () => [],
				};
			}
		}
		if (typeof url === 'string' && url.includes('geo/1.0/reverse')) {
			// Reverse geocoding for lat/lon
			return {
				ok: true,
				json: async () => [{ name: 'New York', country: 'US' }],
			};
		}
		if (typeof url === 'string' && url.includes('air_pollution')) {
			// AQI data for valid lat/lon or city
			if (url.includes('40.7128') && url.includes('-74.0060')) {
				return {
					ok: true,
					json: async () => ({ list: [{ main: { aqi: 2 } }] }),
				};
			}
			if (url.includes('51.5074') && url.includes('-0.1278')) {
				// Simulate details=1 by returning city/country in AQI response
				return {
					ok: true,
					json: async () => ({ list: [{ main: { aqi: 1 } }], city: 'London', country: 'GB' }),
				};
			}
		}
		// Default: simulate API error
		return { ok: false, json: async () => ({ error: 'API error' }) };
	});
}

describe('AQI Worker API', () => {
	let originalFetch;
	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = mockFetchImplementation();
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns AQI data for valid lat/lon', async () => {
		const lat = '40.7128';
		const lon = '-74.0060';
		const url = `http://localhost:8787/?lat=${lat}&lon=${lon}`;
		const request = new Request(url);
		const response = await worker.fetch(request, { AIR_API_KEY: 'test' });
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveProperty('list');
		expect(data.list[0].main.aqi).toBe(2);
	});

	it('returns error for missing lat/lon', async () => {
		const url = `http://localhost:8787/`;
		const request = new Request(url);
		const response = await worker.fetch(request, { AIR_API_KEY: 'test' });
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data).toHaveProperty('error');
	});

	it('returns AQI data for valid city', async () => {
		const url = `http://localhost:8787/?city=London`;
		const request = new Request(url);
		const response = await worker.fetch(request, { AIR_API_KEY: 'test' });
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveProperty('list');
		expect(data.list[0].main.aqi).toBe(1);
		expect(data.city).toBe('London');
		expect(data.country).toBe('GB');
	});

	it('returns error for invalid city', async () => {
		const url = `http://localhost:8787/?city=NotARealCity12345`;
		const request = new Request(url);
		const response = await worker.fetch(request, { AIR_API_KEY: 'test' });
		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data).toHaveProperty('error');
	});
});
