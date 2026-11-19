import { describe, it, expect } from 'vitest';
import { wrapText } from './share-card.js';

// Fake canvas context: every character is 10px wide.
const ctx = { measureText: (t) => ({ width: t.length * 10 }) };

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText(ctx, 'Air here', 200)).toEqual(['Air here']);
  });

  it('breaks between words to fit the width', () => {
    expect(wrapText(ctx, 'Air in Berlin today: Mostly breathable', 150)).toEqual([
      'Air in Berlin',
      'today: Mostly',
      'breathable',
    ]);
  });

  it('never drops a word that is longer than the width', () => {
    expect(wrapText(ctx, 'Llanfairpwllgwyngyll air', 100)).toEqual(['Llanfairpwllgwyngyll', 'air']);
  });
});
