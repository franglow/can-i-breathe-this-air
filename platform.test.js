import { describe, it, expect } from 'vitest';
import { applePlatform } from './platform.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

describe('applePlatform', () => {
  it.each([
    ['iPhone', { userAgent: UA.iphone, maxTouchPoints: 5 }, 'ios'],
    ['iPad (desktop-mode Safari)', { userAgent: UA.ipadDesktop, maxTouchPoints: 5 }, 'ios'],
    ['Mac Safari', { userAgent: UA.macSafari, maxTouchPoints: 0 }, 'mac'],
    ['Mac Firefox', { userAgent: UA.macFirefox, maxTouchPoints: 0 }, 'mac'],
    ['Mac Chrome (client hints)', { userAgentData: { platform: 'macOS' }, userAgent: UA.macSafari }, 'mac'],
    ['Android Chrome (client hints)', { userAgentData: { platform: 'Android' }, userAgent: UA.android }, null],
    ['Android without hints', { userAgent: UA.android, maxTouchPoints: 5 }, null],
    ['Windows Edge (client hints)', { userAgentData: { platform: 'Windows' }, userAgent: '' }, null],
    ['Windows Firefox', { userAgent: UA.windowsFirefox, maxTouchPoints: 0 }, null],
    ['Linux', { userAgent: UA.linux, maxTouchPoints: 0 }, null],
  ])('%s → %s', (_name, nav, expected) => {
    expect(applePlatform(nav)).toBe(expected);
  });

  it('handles a missing navigator', () => {
    expect(applePlatform(null)).toBe(null);
  });
});
