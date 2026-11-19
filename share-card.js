// Draws the on-page share card into a PNG, so what people share looks like
// what they see. Colours and fonts are read from the live card, so the image
// follows the current theme and air level.

const DEFAULT_WIDTH = 360; // CSS px, when the card has no size (hidden, tests)
const SCALE = 3;
const PAD = 22; // the image is drawn at SCALE times the card size
const GAP = 16;
const DOT = 28;
const TEXT_SIZE = 34;
const TEXT_LINE = 34; // line-height: 1
const SMALL_SIZE = 12;

// Splits text into lines that fit maxWidth with the current ctx font.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// cardEl: the .share section. Returns a PNG Blob.
export async function renderShareImage(cardEl, { text, label, footer }) {
  const styles = getComputedStyle(cardEl);
  const bg = styles.backgroundColor;
  const ink = styles.color;
  const sub = styles.getPropertyValue('--card-sub').trim() || ink;
  const accent = styles.getPropertyValue('--accent').trim() || '#FFB000';
  const fontUi = styles.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
  const fontMono = styles.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';

  // Same width as the card on screen, so the sentence wraps the same way.
  const WIDTH = Math.round(cardEl.getBoundingClientRect().width) || DEFAULT_WIDTH;

  const textFont = `700 ${TEXT_SIZE}px ${fontUi}`;
  const smallFont = `400 ${SMALL_SIZE}px ${fontMono}`;
  // Web fonts are only used by canvas once loaded.
  try {
    await Promise.all([document.fonts.load(textFont, text), document.fonts.load(smallFont, label + footer)]);
  } catch {
    // Fall back to whatever font is available.
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = textFont;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.03 * TEXT_SIZE}px`;
  const lines = wrapText(ctx, text, WIDTH - PAD * 2);

  const height = PAD + DOT + GAP + lines.length * TEXT_LINE + GAP + SMALL_SIZE * 1.6 + PAD;
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.ceil(height * SCALE);
  ctx.scale(SCALE, SCALE);

  // Card
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, WIDTH, height, 20);
  ctx.fill();

  // Label row: label on the left, level dot on the right
  ctx.textBaseline = 'middle';
  ctx.font = smallFont;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = sub;
  ctx.fillText(label, PAD, PAD + DOT / 2);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(WIDTH - PAD - DOT / 2, PAD + DOT / 2, DOT / 2, 0, Math.PI * 2);
  ctx.fill();

  // Main sentence
  ctx.textBaseline = 'alphabetic';
  ctx.font = textFont;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.03 * TEXT_SIZE}px`;
  ctx.fillStyle = ink;
  let y = PAD + DOT + GAP;
  for (const line of lines) {
    ctx.fillText(line, PAD, y + TEXT_LINE * 0.8);
    y += TEXT_LINE;
  }

  // Footer: where to check your own air (takes the place of the button)
  ctx.font = smallFont;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = sub;
  ctx.fillText(footer, PAD, y + GAP + SMALL_SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))), 'image/png');
  });
}
