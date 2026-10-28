// Every backend implements the same small surface:
//   kind                       'local' | 'cloudflare'
//   listFish(limit)            -> [{ id, name, artist, strokes, created_at, catches }]
//   addFish({ name, artist, strokes }) -> fish
//   recordCatch(id)            -> new catch count
//   report(id)
//   keepFish(fish)             -> { status: 'kept' | 'taken' | 'full' | 'slow', fish? }
//   releaseFish(id)            -> true if it went back in the pond
//   bucket()                   -> fish you kept, newest first
//   stillSwimming(ids)         -> Set of the ids nobody has kept
//   stats()                    -> { fish, inPond, catches, low }
//   onNewFish(cb)              -> unsubscribe

export async function createStore() {
  // the global pond is served by functions/api on Cloudflare Pages; anywhere else, play locally
  try {
    const { createCloudflareStore } = await import('./cloudflare.js');
    return await createCloudflareStore();
  } catch (err) {
    console.info('No pond API here, playing in a local pond.', err.message);
  }
  const { createLocalStore } = await import('./local.js');
  return createLocalStore();
}
