// House fish so a fresh pond is never empty. Drawn procedurally as strokes,
// with a little wobble so they read as doodles, and credited to the pond keeper.
import { mulberry32 } from './util.js';

const NAMES = ['Bubbles', 'Sir Fins', 'Pickle', 'Mango', 'Lulu', 'Captain Wiggles', 'Noodle', 'Biscuit', 'Pebble', 'Marigold'];
const BODY = ['#ef6f6c', '#f2a03d', '#4fa3d9', '#9b7fe0', '#f4a6c6', '#6cc58a', '#f6d55c'];
const INK = '#1f2a44';

const r4 = (v) => Math.round(v * 10000) / 10000;

export function makeSeedFish(i) {
  const rng = mulberry32(1000 + i * 7919);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const wob = (v, a = 0.004) => r4(v + (rng() - 0.5) * a * 2);

  const body = BODY[i % BODY.length];
  let accent = pick(BODY);
  while (accent === body) accent = pick(BODY);

  const cx = 0.53;
  const cy = 0.3;
  const rx = 0.17 + rng() * 0.11;
  const ry = Math.min(rx * 0.85, 0.08 + rng() * 0.08);
  const strokes = [];

  // body fill, scribbled in rows
  const fill = [];
  const step = 0.02;
  for (let dy = -ry * 0.82, dir = 1; dy <= ry * 0.82; dy += step, dir *= -1) {
    const half = rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)) * 0.88;
    fill.push(wob(cx - half * dir), wob(cy + dy), wob(cx + half * dir), wob(cy + dy + step / 2));
  }
  strokes.push({ c: body, w: 0.03, p: fill });

  // tail fill + outline
  const tx = cx - rx + 0.012;
  const tl = 0.07 + rng() * 0.05;
  const th = ry * (0.8 + rng() * 0.4);
  strokes.push({ c: accent, w: 0.03, p: [tx - 0.02, cy, tx - tl * 0.8, cy - th * 0.55, tx - tl * 0.6, cy, tx - tl * 0.8, cy + th * 0.55].map((v) => r4(v)) });
  strokes.push({ c: INK, w: 0.011, p: [tx, cy, tx - tl, cy - th, tx - tl * 0.72, cy, tx - tl, cy + th, tx, cy].map((v) => wob(v, 0.003)) });

  // stripes or spots
  if (rng() < 0.6) {
    const n = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const sx = cx - rx * 0.45 + k * rx * 0.35;
      const sh = ry * Math.sqrt(Math.max(0, 1 - ((sx - cx) / rx) ** 2)) * 0.8;
      strokes.push({ c: accent, w: 0.022, p: [wob(sx), wob(cy - sh), wob(sx + 0.012), wob(cy), wob(sx), wob(cy + sh)] });
    }
  } else {
    for (let k = 0; k < 5; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.6;
      strokes.push({ c: accent, w: 0.02 + rng() * 0.015, p: [r4(cx - rx * 0.15 + Math.cos(a) * rx * d), r4(cy + Math.sin(a) * ry * d)] });
    }
  }

  // body outline
  const outline = [];
  for (let k = 0; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 2 + 0.15;
    outline.push(wob(cx + Math.cos(a) * rx), wob(cy + Math.sin(a) * ry));
  }
  strokes.push({ c: INK, w: 0.011, p: outline });

  // dorsal fin
  strokes.push({ c: INK, w: 0.01, p: [cx - rx * 0.35, cy - ry * 0.95, cx - rx * 0.05, cy - ry - 0.05, cx + rx * 0.25, cy - ry * 0.92].map((v) => wob(v, 0.003)) });
  // eye
  const ex = cx + rx * 0.58;
  const ey = cy - ry * 0.22;
  strokes.push({ c: '#ffffff', w: 0.034, p: [r4(ex), r4(ey)] });
  strokes.push({ c: INK, w: 0.016, p: [r4(ex + 0.004), r4(ey)] });
  // mouth
  strokes.push({ c: INK, w: 0.008, p: [cx + rx * 0.95, cy + ry * 0.2, cx + rx * 0.8, cy + ry * 0.32].map((v) => r4(v)) });

  const daysAgo = 2 + Math.floor(rng() * 20);
  return {
    id: `seed-${i}`,
    name: NAMES[i % NAMES.length],
    artist: 'pond keeper',
    strokes,
    created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    catches: 0,
  };
}

export const seedFish = (n = 10) => Array.from({ length: n }, (_, i) => makeSeedFish(i));
