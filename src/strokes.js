// A drawing is a list of strokes. Coordinates are normalized by canvas width,
// so x is 0..1 and y is 0..CANVAS_ASPECT. Small, crisp at any size, easy to validate.
//   { c: '#rrggbb' | 'erase', w: width, p: [x0, y0, x1, y1, ...] }

export const CANVAS_ASPECT = 0.6;
export const PALETTE = ['#1f2a44', '#ef6f6c', '#f2a03d', '#f6d55c', '#6cc58a', '#4fa3d9', '#9b7fe0', '#f4a6c6', '#ffffff'];
export const SIZES = [0.007, 0.014, 0.028];
export const MAX_POINTS = 4000;
export const MAX_STROKES = 400;

export const countPoints = (strokes) => strokes.reduce((n, s) => n + s.p.length / 2, 0);

export function validateStrokes(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > MAX_STROKES) return false;
  let pts = 0;
  let ink = 0;
  for (const s of strokes) {
    if (!s || typeof s.c !== 'string' || !(s.c === 'erase' || /^#[0-9a-f]{6}$/i.test(s.c))) return false;
    if (typeof s.w !== 'number' || !(s.w > 0) || s.w > 0.08) return false;
    if (!Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2) return false;
    for (const v of s.p) if (typeof v !== 'number' || !Number.isFinite(v) || v < -0.05 || v > 1.05) return false;
    pts += s.p.length / 2;
    if (s.c !== 'erase') ink += s.p.length / 2;
  }
  return pts <= MAX_POINTS && ink >= 8;
}

export function drawStrokes(ctx, strokes, scale, ox = 0, oy = 0) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const erase = s.c === 'erase';
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = erase ? '#000' : s.c;
    ctx.lineWidth = s.w * scale;
    const p = s.p;
    const X = (i) => p[i] * scale + ox;
    const Y = (i) => p[i + 1] * scale + oy;
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(X(0), Y(0), (s.w * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(X(i), Y(i), ((p[i] + p[i + 2]) / 2) * scale + ox, ((p[i + 1] + p[i + 3]) / 2) * scale + oy);
    }
    ctx.lineTo(X(p.length - 2), Y(p.length - 2));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function strokeBounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    if (s.c === 'erase') continue;
    const r = s.w / 2;
    for (let i = 0; i < s.p.length; i += 2) {
      x0 = Math.min(x0, s.p[i] - r);
      x1 = Math.max(x1, s.p[i] + r);
      y0 = Math.min(y0, s.p[i + 1] - r);
      y1 = Math.max(y1, s.p[i + 1] + r);
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: CANVAS_ASPECT };
  return { x0, y0, x1, y1 };
}

// Crops the drawing to its ink and optionally adds a white sticker outline,
// which keeps doodles readable under tinted water.
export function renderFishCanvas(strokes, maxSide = 256, outline = true) {
  const b = strokeBounds(strokes);
  const pad = 0.022;
  const bw = b.x1 - b.x0 + pad * 2;
  const bh = b.y1 - b.y0 + pad * 2;
  const scale = maxSide / Math.max(bw, bh);
  const w = Math.max(8, Math.ceil(bw * scale));
  const h = Math.max(8, Math.ceil(bh * scale));
  const art = document.createElement('canvas');
  art.width = w;
  art.height = h;
  drawStrokes(art.getContext('2d'), strokes, scale, (pad - b.x0) * scale, (pad - b.y0) * scale);
  if (!outline) return { canvas: art, aspect: w / h };

  const sil = document.createElement('canvas');
  sil.width = w;
  sil.height = h;
  const sc = sil.getContext('2d');
  sc.drawImage(art, 0, 0);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = '#fffdf6';
  sc.fillRect(0, 0, w, h);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const oc = out.getContext('2d');
  const r = Math.max(2, maxSide * 0.018);
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    oc.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r);
  }
  oc.drawImage(art, 0, 0);
  return { canvas: out, aspect: w / h };
}
