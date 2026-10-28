import * as THREE from 'three';
import { createWorld, POND, pond } from './world.js';
import { Fish } from './fish.js';
import { Angler } from './angler.js';
import { createStudio } from './studio.js';
import { createStore } from './store/index.js';
import { BUCKET_MAX, baseId, isSeed } from './store/bucket.js';
import { renderFishCanvas, validateStrokes } from './strokes.js';
import { initAudio, setSound, sfx, soundOn } from './audio.js';
import { clamp, storage, timeAgo } from './util.js';
import { randomLook, sanitizeLook } from './anglers.js';
import { createCustomizer } from './customize.js';

const METERS_PER_UNIT = 0.5;
// Each visitor renders a capped school, sized to how much pond their screen shows.
// All other fish wait in a pool and rotate in and out through the stream, so render
// cost stays flat however many fish exist, and every fish gets its turn on screen.
// The school is split into depth layers; fish only keep their distance within a layer.
const PER_LAYER = clamp(Math.round((pond.area * 0.11) / 0.42), 8, 20);
const MAX_LAYERS = 4;
// grows with the square root of on-screen pond area: about 12 on a phone, 28 on a laptop, 48 on a big monitor
const FISH_PER_PX = 0.06;
const SLOW_DEVICE = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const POOL_FETCH = 60;
const POOL_MAX = 150;
const ROTATE_EVERY = 18;
const FILL_EVERY = 2.5;
const ARRIVAL_GAP = 1.6;
const POOL_REFRESH_MS = 3 * 60 * 1000;
const $ = (id) => document.getElementById(id);

// first visit gets a random look so a crowded pond isn't all yellow coats
let look = sanitizeLook(storage.get('doodlepond:look', null) || randomLook(storage.get('doodlepond:artist', '')));
storage.set('doodlepond:look', look);

const canvas = $('scene');
const world = createWorld(canvas, look);
world.fit();

// on-screen area of the water in CSS pixels
function pondPixels() {
  const pts = pond.outline(48, 1).map(([x, z]) => world.toScreen(new THREE.Vector3(x, POND.y, z)));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
// dev only: ?school=40 forces the school size to test layering
const forced = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('school')) || 0 : 0;
function schoolSize() {
  if (forced) return clamp(forced, 1, PER_LAYER * MAX_LAYERS);
  const n = Math.round(Math.sqrt(pondPixels()) * FISH_PER_PX * (SLOW_DEVICE ? 0.7 : 1));
  return clamp(n, 6, PER_LAYER * MAX_LAYERS);
}
let school = schoolSize();
let layers = Math.ceil(school / PER_LAYER);
let resizeTimer = 0;
window.addEventListener('resize', () => {
  world.fit();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    school = schoolSize();
    const n = Math.ceil(school / PER_LAYER);
    if (n !== layers) {
      layers = n;
      for (const f of fishes.values()) f.setLayer(f.layer < layers ? f.layer : quietLayer(), layers);
    }
  }, 300);
});

/* ---------- ui helpers ---------- */

const statusEl = $('status');
const ui = {
  status(text, state) {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
    $('btn-reelin').hidden = !['waiting', 'nibble'].includes(state);
  },
  toast(html, ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  },
  bite(on) {
    $('bite').hidden = !on;
  },
  reel(show, tension = 0, progress = 0, surging = false) {
    const el = $('reel');
    el.hidden = !show;
    if (!show) return;
    $('reel-needle').style.left = `${clamp(tension, 0, 1) * 100}%`;
    $('reel-fill').style.width = `${clamp(progress, 0, 1) * 100}%`;
    el.classList.toggle('surge', surging);
  },
  caught: (fish) => showCard(fish),
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- pond population ---------- */

const fishes = new Map(); // on screen
const pool = new Map(); // everything this visitor knows about, id -> data
const lastShown = new Map(); // id -> time it last left the pond
const arrivals = []; // live releases from other people, shown one at a time
const fishList = () => [...fishes.values()].filter((f) => f.mode !== 'remove');
const residents = () => [...fishes.values()].filter((f) => !['remove', 'leave'].includes(f.mode));
let store = null;

function remember(data) {
  if (!data || !validateStrokes(data.strokes)) return false;
  pool.set(data.id, data);
  return true;
}

// the layer with the fewest fish
function quietLayer() {
  const counts = new Array(layers).fill(0);
  for (const f of residents()) if (f.layer < layers) counts[f.layer]++;
  return counts.indexOf(Math.min(...counts));
}

// how: 'place' (already swimming), 'stream' (swims in), 'drop' (just released)
function spawn(data, how = 'place') {
  if (!data || fishes.has(data.id) || !remember(data)) return null;
  const f = new Fish(data, world.scene);
  f.setLayer(quietLayer(), layers, true);
  fishes.set(f.id, f);
  if (how === 'stream') f.swimIn();
  if (how === 'drop') {
    const [x, z] = pond.random(Math.random, 1.4);
    f.dropIn(x, z, (fish) => {
      world.splash(fish.pos.x, fish.pos.y, 18, 1);
      sfx.splash();
    });
  }
  return f;
}

// send one idle fish back up the stream; returns false if none can go
function makeRoom() {
  const idle = residents().filter((f) => f.mode === 'wander' && f !== selected && f !== angler.fish);
  const f = idle[Math.floor(Math.random() * idle.length)];
  if (!f) return false;
  f.swimAway();
  return true;
}

function nextFromPool() {
  let best = null;
  let bestAt = Infinity;
  for (const d of pool.values()) {
    // fish in your bucket stay out of your pond until you release them
    if (fishes.has(d.id) || inBucket(d.id)) continue;
    const at = lastShown.get(d.id) ?? -1 - Math.random();
    if (at < bestAt) {
      bestAt = at;
      best = d;
    }
  }
  return best;
}

let rotateAt = ROTATE_EVERY;
let fillAt = 0;
let arrivalAt = 0;
let trimAt = 0;
function tendPond(t) {
  const n = residents().length;
  // live releases first
  if (arrivals.length && t > arrivalAt) {
    arrivalAt = t + ARRIVAL_GAP;
    const d = arrivals.shift();
    if (!fishes.has(d.id)) {
      if (n >= school) makeRoom();
      if (spawn(d, 'drop')) {
        if (arrivals.length >= 3) {
          ui.toast(`<b>${arrivals.length + 1}</b> new fish just arrived`);
          arrivals.splice(0).forEach(remember);
        } else ui.toast(`<b>${esc(d.artist)}</b> released <b>${esc(d.name)}</b>`);
      }
    }
    return;
  }
  // the window got smaller: send the extra fish home one at a time
  if (n > school) {
    if (t > trimAt) {
      trimAt = t + 1.2;
      makeRoom();
    }
    return;
  }
  // top up an underfilled pond
  if (n < school && t > fillAt) {
    // quicker when the window just grew a lot
    fillAt = t + (school - n > 4 ? 0.6 : FILL_EVERY);
    spawn(nextFromPool(), 'stream');
    return;
  }
  // rotate so every fish in the pool gets seen
  if (t > rotateAt) {
    rotateAt = t + ROTATE_EVERY;
    const next = nextFromPool();
    if (next && makeRoom()) {
      fillAt = t + 3;
    }
  }
}

async function refreshPool() {
  try {
    const list = await store.listFish(POOL_FETCH);
    list.forEach(remember);
    // forget the oldest-seen fish that aren't on screen
    if (pool.size > POOL_MAX) {
      const off = [...pool.keys()].filter((id) => !fishes.has(id)).sort((a, b) => (lastShown.get(a) ?? 0) - (lastShown.get(b) ?? 0));
      off.slice(0, pool.size - POOL_MAX).forEach((id) => pool.delete(id));
    }
  } catch {}
}

let nudged = false;
async function refreshStats() {
  try {
    const s = await store.stats();
    $('stat-pond').textContent = s.inPond.toLocaleString();
    $('stat-fish').textContent = s.fish.toLocaleString();
    $('stat-catches').textContent = s.catches.toLocaleString();
    if (s.low && !nudged) {
      nudged = true;
      ui.toast('The pond is running low. <b>Draw a fish</b> to fill it up!', 6000);
    }
  } catch {}
}

// fish you kept, newest first; the store is the source of truth, this is its cached copy
let bucket = [];
const inBucket = (id) => bucket.some((d) => d.id === id);
const renderBucket = () => ($('stat-bucket').textContent = bucket.length);

// let go of fish on screen that someone else kept (or that got hidden) since we loaded them
async function checkSwimming() {
  const here = [...fishes.values()].filter((f) => ['wander', 'arrive', 'approach'].includes(f.mode) && f !== angler.fish);
  try {
    const ok = await store.stillSwimming(here.map((f) => f.id));
    for (const f of here) {
      if (ok.has(f.id)) continue;
      pool.delete(f.id);
      if (f.mode === 'wander' && f !== selected) f.swimAway();
    }
  } catch {}
}

/* ---------- angler ---------- */

const angler = new Angler(world, fishList, ui);
angler.setStatus();

/* ---------- your angler ---------- */

const myTag = document.createElement('div');
myTag.className = 'tag me';
myTag.innerHTML = '<b></b><span></span>';
$('tags').appendChild(myTag);
const renderMyTag = (l) => (myTag.firstChild.textContent = l.name || 'you');
renderMyTag(look);
const tagPoint = new THREE.Vector3();
function placeMyTag() {
  const g = world.angler.group.position;
  const p = world.toScreen(tagPoint.set(g.x, 1.45 * world.angler.group.scale.y, g.z));
  myTag.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
}

const customizer = createCustomizer({
  getLook: () => look,
  onChange(l) {
    world.angler.apply(l);
    renderMyTag(l);
  },
  onDone(l) {
    look = l;
    storage.set('doodlepond:look', l);
  },
});
$('btn-me').onclick = () => {
  select(null);
  customizer.open();
};

/* ---------- selection ---------- */

let selected = null;
const selEl = $('sel');
const selBar = $('sel-bar');

function select(f) {
  selected = f;
  if (!f) {
    selEl.hidden = selBar.hidden = true;
    return;
  }
  sfx.pop();
  $('sel-name').textContent = f.data.name;
  $('sel-meta').textContent = `by ${f.data.artist} · caught ${f.data.catches || 0}×`;
}

const corner = new THREE.Vector3();
function updateSelection() {
  const f = selected;
  if (!f || !fishes.has(f.id) || ['held', 'leap', 'remove', 'hooked'].includes(f.mode)) {
    if (f) select(null);
    return;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = (a * f.len) / 2;
    const lz = (b * f.wid) / 2;
    corner.set(f.pos.x + lx * c - lz * s, f.y, f.pos.y + lx * s + lz * c);
    const p = world.toScreen(corner);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  selEl.hidden = selBar.hidden = false;
  Object.assign(selEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  const dist = Math.hypot(f.pos.x - world.angler.group.position.x, f.pos.y - world.angler.group.position.z) * METERS_PER_UNIT;
  $('sel-label').textContent = `${(f.len * METERS_PER_UNIT).toFixed(2)} × ${(f.wid * METERS_PER_UNIT).toFixed(2)} m · ${dist.toFixed(1)} m away`;
  const bw = selBar.offsetWidth;
  const bx = clamp((x0 + x1) / 2 - bw / 2, 12, window.innerWidth - bw - 12);
  let by = y0 - selBar.offsetHeight - 14;
  if (by < 70) by = y1 + 34;
  selBar.style.transform = `translate(${bx}px, ${by}px)`;
}

$('sel-close').onclick = () => select(null);
$('sel-cast').onclick = () => {
  if (!selected) return;
  initAudio();
  const h = selected.head();
  const x = h.x + Math.cos(selected.heading) * 0.35;
  const z = h.y + Math.sin(selected.heading) * 0.35;
  if (pond.inside(x, z, 0.3)) angler.cast(x, z);
  else angler.cast(selected.pos.x, selected.pos.y);
  select(null);
};
$('sel-report').onclick = () => selected && reportFish(selected);

async function reportFish(f) {
  const id = f.id;
  pool.delete(id);
  f.remove();
  select(null);
  ui.toast('Thanks. That drawing is hidden for you and flagged for review.');
  try {
    await store.report(id);
  } catch {}
}

/* ---------- catch card ---------- */

let cardFish = null;
async function showCard(f) {
  cardFish = f;
  $('card-name').textContent = f.data.name;
  $('card-artist').textContent = f.data.artist;
  $('card-length').textContent = `${(f.len * METERS_PER_UNIT).toFixed(2)} m`;
  $('card-age').textContent = timeAgo(f.data.created_at);
  $('card-count').textContent = '…';
  const { canvas: art } = renderFishCanvas(f.data.strokes, 520, false);
  const cc = $('card-canvas');
  cc.width = art.width;
  cc.height = art.height;
  cc.getContext('2d').drawImage(art, 0, 0);
  cc.style.width = `${Math.min(320, art.width / 2)}px`;
  const full = bucket.length >= BUCKET_MAX;
  $('card-keep').disabled = full;
  cardNote(full ? `Your bucket is full (${BUCKET_MAX}). Release one from it to keep this fish.` : '');
  $('card').hidden = false;
  $(full ? 'card-release' : 'card-keep').focus();

  try {
    const n = (await store.recordCatch(f.id)) ?? (f.data.catches || 0) + 1;
    f.data.catches = n;
    $('card-count').textContent = n === 1 ? 'You are the first!' : `${n}`;
  } catch {
    $('card-count').textContent = String((f.data.catches || 0) + 1);
  }
  refreshStats();
}

let keeping = false; // a keep request is in flight; the card can't close under it
function closeCard() {
  if ($('card').hidden || keeping) return;
  $('card').hidden = true;
  cardFish = null;
  angler.letGo();
}
$('card-release').onclick = closeCard;
function cardNote(text) {
  $('card-note').hidden = !text;
  $('card-note').textContent = text || '';
}
$('card-keep').onclick = async () => {
  const f = cardFish;
  if (!f || bucket.length >= BUCKET_MAX) return;
  const btns = [$('card-keep'), $('card-release'), $('card-report')];
  btns.forEach((b) => (b.disabled = true));
  keeping = true;
  let r;
  try {
    r = await store.keepFish(f.data);
  } catch {
    r = { status: 'error' };
  }
  keeping = false;
  btns.forEach((b) => (b.disabled = false));
  if (cardFish !== f) return;
  const name = esc(f.data.name);
  if (r.status === 'kept' || r.status === 'taken') {
    $('card').hidden = true;
    cardFish = null;
    angler.keep();
    // a kept house fish in the global pond is a copy, so the original stays in the pool
    if (r.status === 'taken' || !isSeed(f.id)) pool.delete(f.id);
    if (r.status === 'kept') {
      bucket.unshift(r.fish);
      renderBucket();
      sfx.chime();
      ui.toast(`<b>${name}</b> is in your bucket`);
    } else {
      world.splash(f.pos.x, f.pos.y, 12, 0.7);
      ui.toast(`Someone else took <b>${name}</b> home a moment ago. It wriggled free!`, 4500);
    }
    refreshStats();
  } else if (r.status === 'full') {
    $('card-keep').disabled = true;
    cardNote(`Your bucket is full (${BUCKET_MAX}). Release one from it to keep this fish.`);
  } else if (r.status === 'slow') {
    $('card-keep').disabled = true;
    cardNote("You've kept a lot of fish this hour. Release this one and try again later.");
  } else {
    cardNote("Couldn't reach the pond. Try again, or release it back.");
  }
};

/* ---------- bucket ---------- */

function openBucket() {
  select(null);
  const grid = $('bucket-grid');
  grid.innerHTML = '';
  for (const d of bucket) {
    const li = document.createElement('li');
    const art = document.createElement('div');
    art.className = 'bucket-art';
    art.appendChild(renderFishCanvas(d.strokes, 180, false).canvas);
    const name = document.createElement('b');
    name.textContent = d.name;
    const by = document.createElement('small');
    by.textContent = `by ${d.artist} · kept ${timeAgo(d.kept_at)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = 'Release';
    btn.onclick = () => releaseFromBucket(d.id, btn);
    li.append(art, name, by, btn);
    grid.appendChild(li);
  }
  $('bucket-empty').hidden = bucket.length > 0;
  $('bucket-sub').textContent = bucket.length ? `${bucket.length} of ${BUCKET_MAX} kept. Release one to put it back in the pond.` : 'Fish you keep end up here.';
  $('bucket').hidden = false;
}
function closeBucket() {
  $('bucket').hidden = true;
}
async function releaseFromBucket(id, btn) {
  const d = bucket.find((x) => x.id === id);
  if (!d) return;
  btn.disabled = true;
  let ok = false;
  try {
    ok = await store.releaseFish(id);
  } catch {
    btn.disabled = false;
    ui.toast("Couldn't reach the pond. Try again in a moment.");
    return;
  }
  bucket = bucket.filter((x) => x.id !== id);
  renderBucket();
  closeBucket();
  if (!ok) {
    ui.toast(`<b>${esc(d.name)}</b> isn't in your bucket anymore`);
    return;
  }
  if (residents().length >= school) makeRoom();
  // a kept house fish was a copy; the original is still in the pond
  spawn({ ...d, id: baseId(d.id) }, 'drop');
  ui.toast(`<b>${esc(d.name)}</b> is back in the pond`);
  refreshStats();
}
$('btn-bucket').onclick = () => {
  initAudio();
  openBucket();
};
$('bucket').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeBucket));
$('bucket').addEventListener('pointerdown', (e) => {
  if (e.target === $('bucket')) closeBucket();
});
$('card-report').onclick = () => {
  if (keeping) return;
  const f = cardFish;
  $('card').hidden = true;
  cardFish = null;
  angler.reset();
  if (f) reportFish(f);
};

/* ---------- studio ---------- */

const studio = createStudio({
  async onSubmit(fish) {
    const saved = await store.addFish(fish);
    if (residents().length >= school) makeRoom();
    spawn(saved, 'drop');
    ui.toast(`<b>${esc(saved.name)}</b> is in the pond`);
    refreshStats();
  },
});
$('btn-draw').onclick = () => {
  initAudio();
  select(null);
  studio.open();
};

/* ---------- input ---------- */

let press = null;
const modalOpen = () => studio.isOpen || customizer.isOpen || !$('card').hidden || !$('bucket').hidden;

canvas.addEventListener('pointerdown', (e) => {
  if (modalOpen()) return;
  initAudio();
  const consumed = angler.press();
  press = { x: e.clientX, y: e.clientY, consumed };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  angler.release();
  if (!press) return;
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  const { consumed } = press;
  press = null;
  if (consumed || moved > 10) return;
  if (world.rayFrom(e.clientX, e.clientY).intersectObject(world.angler.group, true).length) {
    select(null);
    customizer.open();
    return;
  }
  const hit = pickFish(e.clientX, e.clientY);
  if (hit) {
    select(hit);
    return;
  }
  const p = world.waterPoint(e.clientX, e.clientY);
  if (p && pond.inside(p.x, p.z, 0.25) && p.distanceTo(world.angler.group.position) > 1.2) {
    select(null);
    angler.cast(p.x, p.z);
  } else {
    select(null);
  }
});
canvas.addEventListener('pointercancel', () => {
  angler.release();
  press = null;
});

function pickFish(x, y) {
  const meshes = fishList().filter((f) => f.mode !== 'held').map((f) => f.mesh);
  const hits = world.rayFrom(x, y).intersectObjects(meshes, false);
  if (hits[0]) return hits[0].object.userData.fish;
  // fish keep moving, so forgive near misses
  const r = canvas.getBoundingClientRect();
  let best = null;
  let bestD = 30;
  for (const f of fishList()) {
    if (f.mode === 'held') continue;
    const p = world.toScreen(corner.set(f.pos.x, f.y, f.pos.y));
    const d = Math.hypot(p.x + r.left - x, p.y + r.top - y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

let hoverAt = 0;
canvas.addEventListener('pointermove', (e) => {
  world.setParallax((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  const now = performance.now();
  if (now - hoverAt < 60 || e.buttons) return;
  hoverAt = now;
  if (pickFish(e.clientX, e.clientY)) canvas.style.cursor = 'pointer';
  else {
    const p = world.waterPoint(e.clientX, e.clientY);
    canvas.style.cursor = p && pond.inside(p.x, p.z, 0.25) && angler.canCast ? 'crosshair' : 'default';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape') {
    if (studio.isOpen) studio.close();
    else if (customizer.isOpen) customizer.close(false);
    else if (!$('card').hidden) closeCard();
    else if (!$('bucket').hidden) closeBucket();
    else if (selected) select(null);
    else angler.cancel();
    return;
  }
  // Enter goes to the focused button
  if (modalOpen()) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) {
      initAudio();
      angler.press();
    }
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    studio.open();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') angler.release();
});

$('btn-reelin').onclick = () => angler.cancel();
const soundBtn = $('btn-sound');
const renderSound = () => soundBtn.classList.toggle('off', !soundOn());
renderSound();
soundBtn.onclick = () => {
  initAudio();
  setSound(!soundOn());
  renderSound();
};

/* ---------- loop ---------- */

const clock = new THREE.Clock();
const biteEl = $('bite');
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  world.update(dt, t);
  const list = fishList();
  for (const f of fishes.values()) {
    f.update(dt, t, list);
    if (f.mode === 'remove' && f.scale <= 0) {
      f.dispose();
      fishes.delete(f.id);
      lastShown.set(f.id, t);
    }
  }
  if (store) tendPond(t);
  angler.update(dt, t);
  placeMyTag();
  if (!biteEl.hidden) {
    const p = world.toScreen(angler.bobber.position);
    biteEl.style.left = `${p.x}px`;
    biteEl.style.top = `${p.y}px`;
  }
  updateSelection();
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) window.__pond = { world, fishes, pool, angler, select, store: () => store, bucket: () => bucket, size: () => ({ school, layers, px: Math.round(pondPixels()) }) };

/* ---------- boot ---------- */

// dev only: ?shot hides the controls, for rendering the social preview image
if (import.meta.env.DEV && new URLSearchParams(location.search).has('shot')) {
  document.body.classList.add('shot');
  document.querySelector('.brand p').textContent = "Draw a fish. Catch everyone else's.";
  const url = document.createElement('p');
  url.className = 'shot-url';
  url.textContent = 'doodlepond.pages.dev';
  document.body.appendChild(url);
}

(async () => {
  store = await createStore();
  if (store.kind === 'local') {
    $('mode-tag').hidden = false;
    $('mode-tag').textContent = 'Local pond · fish stay in this browser';
  }
  try {
    bucket = await store.bucket();
  } catch {}
  renderBucket();
  try {
    const list = await store.listFish(POOL_FETCH);
    list.forEach(remember);
    list.filter((d) => !inBucket(d.id)).slice(0, school).forEach((d) => spawn(d, 'place'));
  } catch (e) {
    ui.toast("Couldn't load the pond. Refresh to try again.", 6000);
  }
  refreshStats();
  setInterval(refreshStats, 30000);
  setInterval(refreshPool, POOL_REFRESH_MS);
  setInterval(checkSwimming, 60000);
  store.onNewFish((d) => {
    if (fishes.has(d.id) || inBucket(d.id) || arrivals.some((a) => a.id === d.id) || !validateStrokes(d.strokes)) return;
    arrivals.push(d);
    refreshStats();
  });
})();
