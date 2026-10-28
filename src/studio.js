// The drawing sheet. Produces a stroke list (see strokes.js).
import { CANVAS_ASPECT, MAX_POINTS, PALETTE, SIZES, countPoints, drawStrokes, validateStrokes } from './strokes.js';
import { clamp, cleanText, storage } from './util.js';

const r4 = (v) => Math.round(v * 10000) / 10000;

export function createStudio({ onSubmit }) {
  const root = document.getElementById('studio');
  const cv = document.getElementById('draw-canvas');
  const ctx = cv.getContext('2d');
  const nameIn = document.getElementById('fish-name');
  const artistIn = document.getElementById('fish-artist');
  const err = document.getElementById('studio-err');
  const submit = document.getElementById('studio-submit');
  const inkBar = document.getElementById('ink-fill');
  const eraseBtn = document.getElementById('tool-erase');

  let strokes = [];
  let cur = null;
  let color = PALETTE[0];
  let size = SIZES[1];
  let erasing = false;
  let busy = false;

  // swatches
  const sw = document.getElementById('swatches');
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c);
    b.setAttribute('aria-checked', String(c === color));
    b.onclick = () => {
      color = c;
      setErase(false);
      sw.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
    sw.appendChild(b);
  }
  const sizesEl = document.getElementById('sizes');
  SIZES.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i]);
    b.setAttribute('aria-checked', String(s === size));
    const d = 4 + i * 4;
    b.innerHTML = `<span class="dot" style="width:${d}px;height:${d}px"></span>`;
    b.onclick = () => {
      size = s;
      sizesEl.querySelectorAll('.tool').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
    sizesEl.appendChild(b);
  });

  function setErase(on) {
    erasing = on;
    eraseBtn.setAttribute('aria-pressed', String(on));
  }
  eraseBtn.onclick = () => setErase(!erasing);
  document.getElementById('tool-undo').onclick = () => {
    strokes.pop();
    render();
  };
  document.getElementById('tool-clear').onclick = () => {
    strokes = [];
    render();
  };

  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.width * CANVAS_ASPECT * dpr);
    render();
  }

  function render() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawStrokes(ctx, strokes, cv.width);
    const left = 1 - countPoints(strokes) / MAX_POINTS;
    inkBar.style.width = `${clamp(left, 0, 1) * 100}%`;
    inkBar.parentElement.classList.toggle('low', left < 0.15);
  }

  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.width, 0, CANVAS_ASPECT)];
  };

  cv.addEventListener('pointerdown', (e) => {
    if (countPoints(strokes) >= MAX_POINTS) {
      err.textContent = 'Out of ink. Undo a stroke to keep drawing.';
      return;
    }
    err.textContent = '';
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    cur = { c: erasing ? 'erase' : color, w: erasing ? size * 1.8 : size, p: [r4(x), r4(y)] };
    strokes.push(cur);
    render();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = pt(ev);
      const p = cur.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 0.004) continue;
      if (countPoints(strokes) >= MAX_POINTS) {
        cur = null;
        break;
      }
      p.push(r4(x), r4(y));
    }
    render();
  });
  const end = () => {
    cur = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  function open() {
    strokes = [];
    err.textContent = '';
    nameIn.value = '';
    artistIn.value = storage.get('doodlepond:artist', '');
    root.hidden = false;
    requestAnimationFrame(resize);
  }
  function close() {
    if (busy) return;
    root.hidden = true;
  }
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });
  window.addEventListener('resize', () => !root.hidden && resize());

  submit.onclick = async () => {
    const clean = strokes.filter((s) => s.p.length >= 2);
    if (!validateStrokes(clean)) {
      err.textContent = 'Draw a little more fish first.';
      return;
    }
    const name = cleanText(nameIn.value, 24) || 'Mystery fish';
    const artist = cleanText(artistIn.value, 24) || 'anonymous';
    storage.set('doodlepond:artist', cleanText(artistIn.value, 24));
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Releasing…';
    try {
      await onSubmit({ name, artist, strokes: clean });
      busy = false;
      close();
    } catch (e) {
      err.textContent = e?.message ? `Couldn't release it: ${e.message}` : "Couldn't release it. Try again.";
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = 'Release into the pond';
    }
  };

  return { open, close, get isOpen() { return !root.hidden; } };
}
