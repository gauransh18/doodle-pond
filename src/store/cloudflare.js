// Global pond on Cloudflare: the API in functions/api talks to a D1 database.
//
// Request budget (the free plan allows 100k function calls a day): one call to load the
// pond and one for the bucket, then a single "tick" a minute that brings new fish, stats,
// and which on-screen fish are still swimming, plus the pool refresh every few minutes.
import { seedFish } from '../seed.js';
import { BUCKET_MAX, isSeed, localBucket, ownerKey } from './bucket.js';

const MIN_POND = 10;
const TICK_MS = 60000;

async function api(path, body) {
  const res = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || `The pond didn't answer (${res.status}).`);
  return data;
}

export async function createCloudflareStore() {
  // Fail fast so the app can fall back to a local pond (no API in `vite dev`, or the daily limit is used up).
  await api('health');

  const owner = ownerKey();
  const houseCopies = localBucket('doodlepond:house-copies'); // kept house fish only
  const newFishListeners = new Set();
  const seen = new Set();
  let newest = new Date().toISOString();
  let lastStats = null;
  let lastTick = 0;

  const note = (fish) => {
    seen.add(fish.id);
    if (fish.created_at > newest) newest = fish.created_at;
  };
  const shape = (s) => ({ ...s, inPond: Math.max(s.inPond, MIN_POND), low: s.inPond < MIN_POND });

  async function tick(ids = []) {
    lastTick = Date.now();
    const q = new URLSearchParams({ since: newest });
    const real = ids.filter((id) => !isSeed(id)).slice(0, 80);
    if (real.length) q.set('ids', real.join(','));
    const data = await api(`tick?${q}`);
    lastStats = data.stats;
    for (const fish of data.fresh) {
      if (seen.has(fish.id)) continue;
      note(fish);
      newFishListeners.forEach((cb) => cb(fish));
    }
    return new Set([...ids.filter(isSeed), ...data.swimming]);
  }
  // main.js ticks once a minute through stillSwimming(); this only fills in if it stops
  setInterval(() => {
    if (Date.now() - lastTick > TICK_MS * 1.5 && !document.hidden) tick().catch(() => {});
  }, TICK_MS / 2);

  return {
    kind: 'cloudflare',
    async listFish(limit = 40) {
      const data = await api(`pond?limit=${Math.min(limit, 60)}`);
      lastStats = data.stats;
      data.fish.forEach(note);
      const list = data.fish;
      // a young or nearly emptied pond still gets house fish to catch
      if (list.length < MIN_POND) list.push(...seedFish(MIN_POND - list.length));
      return list;
    },
    async addFish({ name, artist, strokes }) {
      const data = await api('fish', { name, artist, strokes });
      lastStats = data.stats;
      seen.add(data.fish.id);
      return data.fish;
    },
    async recordCatch(id) {
      if (isSeed(id)) return null;
      const data = await api('catch', { id });
      lastStats = data.stats;
      return data.catches;
    },
    async report(id) {
      if (!isSeed(id)) await api('report', { id });
    },
    // -> { status: 'kept' | 'taken' | 'full' | 'slow', fish? }
    async keepFish(fish) {
      if (isSeed(fish.id)) {
        if ((await this.bucket()).length >= BUCKET_MAX) return { status: 'full' };
        return { status: 'kept', fish: houseCopies.add(fish, true) };
      }
      const data = await api('keep', { id: fish.id, owner });
      lastStats = data.stats;
      if (data.status !== 'kept') return { status: data.status };
      const { id, name, artist, strokes, created_at, catches } = fish;
      return { status: 'kept', fish: { id, name, artist, strokes, created_at, catches, kept_at: new Date().toISOString() } };
    },
    async releaseFish(id) {
      if (isSeed(id)) return houseCopies.remove(id);
      const data = await api('release', { id, owner });
      lastStats = data.stats;
      return data.ok;
    },
    async bucket() {
      const data = await api('bucket', { owner });
      return [...data.fish, ...houseCopies.list()].sort((a, b) => b.kept_at.localeCompare(a.kept_at)).slice(0, BUCKET_MAX);
    },
    // ids still swimming in the shared pond; this is also the minute's tick
    stillSwimming: (ids) => tick(ids),
    async stats() {
      if (!lastStats) lastStats = (await api('stats')).stats;
      return shape(lastStats);
    },
    onNewFish(cb) {
      newFishListeners.add(cb);
      return () => newFishListeners.delete(cb);
    },
  };
}
