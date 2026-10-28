// Local pond: fish live in this browser's storage and sync between tabs.
// Keeping a fish takes it out of this pond until you release it, like the global pond.
import { seedFish } from '../seed.js';
import { storage } from '../util.js';
import { BUCKET_MAX, localBucket } from './bucket.js';

const KEY = 'doodlepond:local:v1';
const load = () => storage.get(KEY, null) || { fish: [], catches: {}, reports: {} };

// dev only: ?stress=500 adds that many house fish to test a crowded pond
const stress = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('stress')) || 0 : 0;

export function createLocalStore() {
  const seeds = seedFish(10 + Math.min(stress, 5000));
  const bucket = localBucket();
  const listeners = new Set();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('doodlepond') : null;
  if (channel) {
    channel.onmessage = (e) => {
      if (e.data?.type === 'fish') listeners.forEach((cb) => cb(e.data.fish));
    };
  }

  const all = () => {
    const s = load();
    return [...seeds, ...s.fish]
      .filter((f) => !s.reports[f.id])
      .map((f) => ({ ...f, catches: (f.catches || 0) + (s.catches[f.id] || 0) }));
  };
  const swimming = () => {
    const kept = new Set(bucket.list().map((d) => d.id));
    return all().filter((f) => !kept.has(f.id));
  };

  return {
    kind: 'local',
    // newest half plus a random sample, the same mix the global pond serves
    async listFish(limit = 40) {
      const a = swimming().sort((x, y) => y.created_at.localeCompare(x.created_at));
      const half = Math.ceil(limit / 2);
      const picked = a.slice(0, half);
      const rest = a.slice(half);
      for (let i = 0; i < limit - half && rest.length; i++) picked.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
      return picked;
    },
    async addFish({ name, artist, strokes }) {
      const fish = {
        id: `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        artist,
        strokes,
        created_at: new Date().toISOString(),
        catches: 0,
      };
      const s = load();
      s.fish.push(fish);
      storage.set(KEY, s);
      channel?.postMessage({ type: 'fish', fish });
      return fish;
    },
    async recordCatch(id) {
      const s = load();
      s.catches[id] = (s.catches[id] || 0) + 1;
      storage.set(KEY, s);
      return all().find((f) => f.id === id)?.catches ?? s.catches[id];
    },
    async report(id) {
      const s = load();
      s.reports[id] = (s.reports[id] || 0) + 1;
      storage.set(KEY, s);
    },
    async keepFish(fish) {
      if (bucket.list().length >= BUCKET_MAX) return { status: 'full' };
      if (bucket.has(fish.id)) return { status: 'taken' }; // kept in another tab
      return { status: 'kept', fish: bucket.add(fish) };
    },
    async releaseFish(id) {
      return bucket.remove(id);
    },
    async bucket() {
      return bucket.list();
    },
    async stillSwimming(ids) {
      const kept = new Set(bucket.list().map((d) => d.id));
      return new Set(ids.filter((id) => !kept.has(id)));
    },
    async stats() {
      const a = all();
      return { fish: a.length, inPond: swimming().length, catches: a.reduce((n, f) => n + f.catches, 0), low: false };
    },
    onNewFish(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
