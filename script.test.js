import { describe, it, expect, beforeEach } from 'vitest';

// Example: test that the info message element exists and is empty by default

describe('UI basics', () => {
  beforeEach(() => {
    // Optionally reset DOM or state here
  });

  it('should have an info message element in the DOM', () => {
    const infoEl = document.getElementById('info-message');
    expect(infoEl).toBeTruthy();
    expect(infoEl.textContent).toBe('');
  });

  it('should have a city input and check button', () => {
    const cityInput = document.getElementById('city-input');
    const checkBtn = document.getElementById('check-btn');
    expect(cityInput).toBeTruthy();
    expect(checkBtn).toBeTruthy();
  });
});
