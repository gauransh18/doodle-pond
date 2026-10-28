// Fish kept in this browser: every kept fish in the local pond, and copies of house fish
// in the global one (house fish never leave the pond, so keeping one keeps a copy).
import { storage } from '../util.js';
import { validateStrokes } from '../strokes.js';

const KEY = 'doodlepond:bucket:v2';
export const BUCKET_MAX = 60;
export const isSeed = (id) => String(id).startsWith('seed-');
// a house fish copy is "seed-3~k2x9": the original id plus a stamp
export const baseId = (id) => String(id).split('~')[0];

// key: the local pond and the global pond's house fish copies are stored apart
export function localBucket(key = KEY) {
  const load = () => (storage.get(key, []) || []).filter((d) => d && d.id && validateStrokes(d.strokes));
  return {
    list: load,
    has: (id) => load().some((d) => d.id === id),
    // copy: keep a copy and leave the original swimming (house fish in the global pond)
    add(fish, copy = false) {
      const list = load();
      if (list.length >= BUCKET_MAX) return null;
      const { name, artist, strokes, created_at, catches } = fish;
      const id = copy ? `${baseId(fish.id)}~${Date.now().toString(36)}` : fish.id;
      const entry = { id, name, artist, strokes, created_at, catches, kept_at: new Date().toISOString() };
      storage.set(key, [entry, ...list]);
      return entry;
    },
    remove(id) {
      const list = load();
      const next = list.filter((d) => d.id !== id);
      storage.set(key, next);
      return next.length < list.length;
    },
  };
}

// The secret that proves which bucket a kept fish belongs to. Only its hash leaves the browser
// in stored form; losing it (clearing site data) means those fish stay kept.
export function ownerKey() {
  let k = storage.get('doodlepond:owner', null);
  if (typeof k !== 'string' || k.length < 32) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    k = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    storage.set('doodlepond:owner', k);
  }
  return k;
}
