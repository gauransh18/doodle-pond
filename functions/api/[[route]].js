// The pond's API, running as a Cloudflare Pages Function next to the static site.
// Every rule lives here: clients only ever see swimming fish and their public columns.
//
//   GET  /api/health                      -> { ok }
//   GET  /api/pond?limit=60                -> { fish, stats }   newest half + random half
//   GET  /api/tick?since=ISO&ids=a,b       -> { fresh, swimming, stats }   one call a minute
//   GET  /api/stats                        -> { stats }
//   POST /api/fish     { name, artist, strokes }  -> { fish, stats }
//   POST /api/catch    { id }              -> { catches, stats }
//   POST /api/report   { id }              -> { ok }
//   POST /api/keep     { id, owner }       -> { status: kept|taken|full|slow, stats }
//   POST /api/release  { id, owner }       -> { ok, stats }
//   POST /api/bucket   { owner }           -> { fish }   (POST keeps the owner key out of URLs)
import { validateStrokes } from '../../src/strokes.js';

const COLS = 'id, name, artist, strokes, catches, created_at';
const SWIMMING = 'hidden = 0 and kept_at is null';
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const LIMITS = {
  fishPerMinute: 60, // everyone
  fishPerIpHour: 20,
  bucket: 60,
  keepsPerIpHour: 40,
  keepsPerMinute: 120, // everyone
  hidesPerHour: 10, // auto-hides from reports, so a script can't empty the pond
  reportsToHide: 3,
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const isId = (v) => typeof v === 'string' && /^[0-9a-f-]{8,64}$/i.test(v);
const isOwner = (v) => typeof v === 'string' && /^[0-9a-f]{32,128}$/i.test(v);
const cleanText = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '');

function toFish(r) {
  const f = { id: r.id, name: r.name, artist: r.artist, strokes: JSON.parse(r.strokes), catches: r.catches, created_at: r.created_at };
  if (r.kept_at) f.kept_at = r.kept_at;
  return f;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cloudflare sets cf-connecting-ip itself, so clients can't fake it. Stored only salted and hashed.
let salt = null;
async function ipHash(env, request) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;
  salt ??= await env.DB.prepare('select salt from secrets where id = 1').first('salt');
  return sha256(`${salt}:${ip}`);
}

async function stats(db) {
  const c = await db.prepare('select fish_count, pond_count, catch_count from counters where id = 1').first();
  return { fish: c?.fish_count ?? 0, inPond: c?.pond_count ?? 0, catches: c?.catch_count ?? 0 };
}

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 120_000) return null;
  const text = await request.text();
  if (text.length > 120_000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/* ---------- reads ---------- */

async function pond(db, url) {
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 40));
  const half = Math.ceil(limit / 2);
  const max = (await db.prepare('select max(rowid) as m from fish').first('m')) || 0;
  // random fish: a few short runs from random places, instead of shuffling the table
  const runs = Math.ceil((limit - half) / 5);
  const random = db.prepare(`select ${COLS} from fish where rowid >= ? and ${SWIMMING} order by rowid limit 5`);
  const results = await db.batch([
    db.prepare(`select ${COLS} from fish where ${SWIMMING} order by created_at desc limit ?`).bind(half),
    ...Array.from({ length: max ? runs : 0 }, () => random.bind(1 + Math.floor(Math.random() * max))),
  ]);
  const byId = new Map();
  for (const r of results.flatMap((x) => x.results)) byId.set(r.id, r);
  return json({ fish: [...byId.values()].slice(0, limit).map(toFish), stats: await stats(db) });
}

async function tick(db, url) {
  const since = url.searchParams.get('since');
  const ids = (url.searchParams.get('ids') || '').split(',').filter(isId).slice(0, 80);
  const queries = [db.prepare('select fish_count, pond_count, catch_count from counters where id = 1')];
  if (since && !Number.isNaN(Date.parse(since))) {
    queries.push(db.prepare(`select ${COLS} from fish where created_at > ? and ${SWIMMING} order by created_at limit 20`).bind(since));
  }
  if (ids.length) queries.push(db.prepare(`select id from fish where id in (${ids.map(() => '?').join(',')}) and ${SWIMMING}`).bind(...ids));
  const [c, ...rest] = await db.batch(queries);
  const counts = c.results[0] || {};
  const fresh = since ? rest.shift().results.map(toFish) : [];
  const swimming = ids.length ? rest.shift().results.map((r) => r.id) : [];
  return json({ fresh, swimming, stats: { fish: counts.fish_count ?? 0, inPond: counts.pond_count ?? 0, catches: counts.catch_count ?? 0 } });
}

/* ---------- writes ---------- */

async function addFish(db, env, request) {
  const body = await readBody(request);
  if (!body) return fail(400, 'Bad request');
  const name = cleanText(body.name);
  const artist = cleanText(body.artist);
  if (!name || !artist) return fail(400, 'Give your fish a name and sign it.');
  if (!validateStrokes(body.strokes)) return fail(400, "That drawing can't be released.");
  const strokes = JSON.stringify(body.strokes);
  if (strokes.length > 80_000) return fail(400, 'That drawing is too big.');

  const ip = await ipHash(env, request);
  const [recent, mine] = await db.batch([
    db.prepare('select count(*) as n from fish where created_at > ?').bind(ago(MINUTE)),
    db.prepare('select count(*) as n from fish where creator_ip = ? and created_at > ?').bind(ip ?? '', ago(HOUR)),
  ]);
  if (recent.results[0].n >= LIMITS.fishPerMinute) return fail(429, 'The pond is busy right now. Try again in a minute.');
  if (ip && mine.results[0].n >= LIMITS.fishPerIpHour) return fail(429, "You've released a lot of fish this hour. Try again a little later.");

  const fish = { id: crypto.randomUUID(), name, artist, strokes: body.strokes, catches: 0, created_at: new Date().toISOString() };
  await db
    .prepare('insert into fish (id, name, artist, strokes, created_at, creator_ip) values (?, ?, ?, ?, ?, ?)')
    .bind(fish.id, name, artist, strokes, fish.created_at, ip)
    .run();
  return json({ fish, stats: await stats(db) });
}

async function recordCatch(db, request) {
  const body = await readBody(request);
  if (!body || !isId(body.id)) return fail(400, 'Bad request');
  const r = await db.prepare(`update fish set catches = catches + 1 where id = ? and ${SWIMMING} returning catches`).bind(body.id).first();
  return json({ catches: r?.catches ?? null, stats: await stats(db) });
}

async function report(db, env, request) {
  const body = await readBody(request);
  if (!body || !isId(body.id)) return fail(400, 'Bad request');
  const ip = (await ipHash(env, request)) ?? 'unknown';
  const added = await db.prepare('insert or ignore into reports (fish_id, ip, created_at) values (?, ?, ?)').bind(body.id, ip, new Date().toISOString()).run();
  if (!added.meta.changes) return json({ ok: true }); // this person already reported it
  const hidden = await db.prepare('select count(*) as n from fish where hidden = 1 and hidden_at > ?').bind(ago(HOUR)).first('n');
  const canHide = hidden < LIMITS.hidesPerHour ? 1 : 0;
  await db
    .prepare(
      `update fish set reports = reports + 1,
         hidden_at = case when hidden = 0 and ? and reports + 1 >= ? then ? else hidden_at end,
         hidden = case when hidden = 0 and ? and reports + 1 >= ? then 1 else hidden end
       where id = ?`,
    )
    .bind(canHide, LIMITS.reportsToHide, new Date().toISOString(), canHide, LIMITS.reportsToHide, body.id)
    .run();
  return json({ ok: true });
}

async function keep(db, env, request) {
  const body = await readBody(request);
  if (!body || !isId(body.id) || !isOwner(body.owner)) return fail(400, 'Bad request');
  const owner = await sha256(body.owner);
  const ip = await ipHash(env, request);
  const [inBucket, mine, everyone] = await db.batch([
    db.prepare('select count(*) as n from fish where keeper_hash = ?').bind(owner),
    db.prepare('select count(*) as n from fish where keeper_ip = ? and kept_at > ?').bind(ip ?? '', ago(HOUR)),
    db.prepare('select count(*) as n from fish where kept_at > ?').bind(ago(MINUTE)),
  ]);
  let status;
  if (inBucket.results[0].n >= LIMITS.bucket) status = 'full';
  else if ((ip && mine.results[0].n >= LIMITS.keepsPerIpHour) || everyone.results[0].n >= LIMITS.keepsPerMinute) status = 'slow';
  else {
    // only matches while the fish is still swimming, so two people can't both win it
    const r = await db
      .prepare(`update fish set kept_at = ?, keeper_hash = ?, keeper_ip = ? where id = ? and ${SWIMMING}`)
      .bind(new Date().toISOString(), owner, ip, body.id)
      .run();
    status = r.meta.changes ? 'kept' : 'taken';
  }
  return json({ status, stats: await stats(db) });
}

async function release(db, request) {
  const body = await readBody(request);
  if (!body || !isId(body.id) || !isOwner(body.owner)) return fail(400, 'Bad request');
  const r = await db
    .prepare('update fish set kept_at = null, keeper_hash = null, keeper_ip = null where id = ? and keeper_hash = ?')
    .bind(body.id, await sha256(body.owner))
    .run();
  return json({ ok: r.meta.changes > 0, stats: await stats(db) });
}

async function bucket(db, request) {
  const body = await readBody(request);
  if (!body || !isOwner(body.owner)) return fail(400, 'Bad request');
  const { results } = await db
    .prepare(`select ${COLS}, kept_at from fish where keeper_hash = ? and hidden = 0 order by kept_at desc limit ?`)
    .bind(await sha256(body.owner), LIMITS.bucket)
    .all();
  return json({ fish: results.map(toFish) });
}

/* ---------- router ---------- */

const ROUTES = {
  'GET health': () => json({ ok: true }),
  'GET pond': ({ db, url }) => pond(db, url),
  'GET tick': ({ db, url }) => tick(db, url),
  'GET stats': async ({ db }) => json({ stats: await stats(db) }),
  'POST fish': ({ db, env, request }) => addFish(db, env, request),
  'POST catch': ({ db, request }) => recordCatch(db, request),
  'POST report': ({ db, env, request }) => report(db, env, request),
  'POST keep': ({ db, env, request }) => keep(db, env, request),
  'POST release': ({ db, request }) => release(db, request),
  'POST bucket': ({ db, request }) => bucket(db, request),
};

export async function onRequest({ request, env, params }) {
  const path = (params.route || []).join('/');
  const handler = ROUTES[`${request.method} ${path}`];
  if (!handler) return fail(404, 'Not found');
  if (!env.DB) return fail(503, 'The pond database is not connected.');
  try {
    return await handler({ db: env.DB, env, request, url: new URL(request.url) });
  } catch (err) {
    console.error(err);
    return fail(500, 'Something went wrong in the pond.');
  }
}
