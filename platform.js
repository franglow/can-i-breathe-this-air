// Which Apple platform the visitor is on, for features that only work there
// (the morning alert uses Apple Shortcuts). Returns 'ios', 'mac' or null.
export function applePlatform(nav = globalThis.navigator) {
  if (!nav) return null;

  // Chromium browsers (Chrome, Edge) report the OS directly.
  const hinted = nav.userAgentData?.platform;
  if (hinted) {
    if (hinted === 'macOS') return 'mac';
    if (hinted === 'iOS') return 'ios';
    return null; // Windows, Android, Linux, Chrome OS…
  }

  const ua = nav.userAgent || '';
  if (/Android|Windows/i.test(ua)) return null;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh|Mac OS X/.test(ua)) {
    // iPadOS Safari pretends to be a Mac; a touch screen gives it away.
    return nav.maxTouchPoints > 1 ? 'ios' : 'mac';
  }
  return null;
}
