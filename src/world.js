// The diorama: a painted meadow tile with a pond cut into it, trees, a dock and the angler.
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { buildAngler } from './anglers.js';

export const BG = '#f1eee7';
export const TILE = { w: 16, d: 11 };
export const POND = { cx: 0.6, cz: -0.45, rx: 5.6, rz: 3.45, y: -0.15, bed: -1.0 };
export const DOCK = { x: 0.5, z0: 3.95, z1: 1.75 };

const shapeR = (th) => 1 + 0.08 * Math.sin(2 * th + 0.7) + 0.05 * Math.sin(3 * th + 2.1) + 0.03 * Math.sin(5 * th + 0.3);
const AVG_R = (POND.rx + POND.rz) / 2;

export const pond = {
  inside(x, z, margin = 0) {
    const dx = (x - POND.cx) / POND.rx;
    const dz = (z - POND.cz) / POND.rz;
    return Math.hypot(dx, dz) < shapeR(Math.atan2(dz, dx)) - margin / AVG_R;
  },
  // k: 0 at the center, 1 on the shore. (nx, nz): unit vector pointing inward.
  edge(x, z) {
    const dx = (x - POND.cx) / POND.rx;
    const dz = (z - POND.cz) / POND.rz;
    const k = Math.hypot(dx, dz) / shapeR(Math.atan2(dz, dx));
    const gx = dx / POND.rx;
    const gz = dz / POND.rz;
    const g = Math.hypot(gx, gz) || 1;
    return { k, nx: -gx / g, nz: -gz / g };
  },
  // pulls a point back inside along its radius, so fish slide along the wall
  clampInside(x, z, margin = 0) {
    const dx = (x - POND.cx) / POND.rx;
    const dz = (z - POND.cz) / POND.rz;
    const th = Math.atan2(dz, dx);
    const lim = shapeR(th) - margin / AVG_R;
    const d = Math.hypot(dx, dz);
    if (d <= lim) return null;
    const s = lim / d;
    return [POND.cx + dx * s * POND.rx, POND.cz + dz * s * POND.rz];
  },
  area: Math.PI * POND.rx * POND.rz,
  point(th, s = 1) {
    const r = shapeR(th) * s;
    return [POND.cx + Math.cos(th) * r * POND.rx, POND.cz + Math.sin(th) * r * POND.rz];
  },
  outline(n = 160, s = 1) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pond.point((i / n) * Math.PI * 2, s));
    return pts;
  },
  random(rng = Math.random, margin = 0.7) {
    for (let k = 0; k < 60; k++) {
      const x = POND.cx + (rng() * 2 - 1) * POND.rx;
      const z = POND.cz + (rng() * 2 - 1) * POND.rz;
      if (pond.inside(x, z, margin) && !nearDock(x, z, 0.5)) return [x, z];
    }
    return [POND.cx, POND.cz];
  },
};

export function nearDock(x, z, pad = 0) {
  return Math.abs(x - DOCK.x) < 0.5 + pad && z > DOCK.z1 - pad;
}

/* ---------- painted textures ---------- */

const W = 2048;
const H = 1408;
const tc = (x, z) => [((x + TILE.w / 2) / TILE.w) * W, ((z + TILE.d / 2) / TILE.d) * H];
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function strokePath(g, pts) {
  const p = pts.map(([x, z]) => tc(x, z));
  g.beginPath();
  g.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length - 1; i++) {
    g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
  }
  g.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
}

const RIVER = [[-8.4, -2.6], [-7.0, -1.4], [-5.9, -2.1], [-4.8, -1.0], [-3.3, -0.7]];
const PATHS = [
  [[0.7, 5.9], [0.95, 5.25], [0.5, 4.7], [0.5, 3.9]],
  [[0.55, 4.7], [2.6, 4.9], [4.6, 4.35], [6.4, 4.55], [8.4, 4.1]],
];

function paintGround() {
  const rng = mulberry32(7);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });

  // patchwork fields with hedgerows between them (low-res voronoi, upscaled soft)
  const lw = 256;
  const lh = 176;
  const low = document.createElement('canvas');
  low.width = lw;
  low.height = lh;
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  const fieldCols = ['#8fca4e', '#7cbc41', '#a3d45e', '#72b03c', '#b2d86c', '#94c754', '#cdbf5a', '#86c249'];
  const seeds = [];
  for (let i = 0; i < 14; i++) seeds.push({ x: rng() * lw, y: rng() * lh, c: hexRgb(fieldCols[i % fieldCols.length]) });
  const hedge = hexRgb('#4a822e');
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let s1 = seeds[0];
      for (const s of seeds) {
        const d = Math.hypot(x - s.x, (y - s.y) * 1.1);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          s1 = s;
        } else if (d < d2) d2 = d;
      }
      const col = d2 - d1 < 1.1 ? hedge : s1.c;
      const k = (y * lw + x) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  }
  lg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(low, 0, 0, W, H);

  // grassy brushwork sampled from what's underneath
  const base = g.getImageData(0, 0, W, H).data;
  g.lineCap = 'round';
  for (let i = 0; i < 16000; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const k = ((y | 0) * W + (x | 0)) * 4;
    const f = 0.84 + rng() * 0.3;
    g.strokeStyle = `rgba(${Math.min(255, base[k] * f) | 0},${Math.min(255, base[k + 1] * f) | 0},${Math.min(255, base[k + 2] * f) | 0},0.6)`;
    g.lineWidth = 2 + rng() * 4;
    const a = -1.0 + rng() * 0.7;
    const L = 7 + rng() * 16;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
    g.stroke();
  }

  // wildflower clusters
  const flowers = ['#f6df6e', '#fffaf0', '#f3b1c4', '#f9c74f'];
  for (let k = 0; k < 110; k++) {
    const cx = rng() * W;
    const cy = rng() * H;
    g.fillStyle = flowers[(rng() * flowers.length) | 0];
    for (let j = 0; j < 16; j++) {
      const r = rng() * 40;
      const a = rng() * Math.PI * 2;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.3 + rng() * 2, 0, Math.PI * 2);
      g.fill();
    }
  }

  // dirt paths
  for (const p of PATHS) {
    strokePath(g, p);
    g.strokeStyle = '#cdb77f';
    g.lineWidth = 70;
    g.stroke();
    g.strokeStyle = '#e3d3a0';
    g.lineWidth = 50;
    g.stroke();
    g.strokeStyle = 'rgba(246,236,203,0.7)';
    g.lineWidth = 16;
    g.stroke();
  }

  // pond bank
  const ol = pond.outline(220);
  const pondPath = () => {
    g.beginPath();
    ol.forEach(([x, z], i) => {
      const [p, q] = tc(x, z);
      if (i) g.lineTo(p, q);
      else g.moveTo(p, q);
    });
    g.closePath();
  };
  pondPath();
  g.lineWidth = 76;
  g.strokeStyle = '#d9c892';
  g.stroke();
  for (let i = 0; i < 700; i++) {
    const [x, z] = pond.point(rng() * Math.PI * 2, 1.0);
    const [p, q] = tc(x, z);
    g.fillStyle = rng() < 0.5 ? '#c8b47b' : '#e7d9ab';
    g.beginPath();
    g.ellipse(p + (rng() - 0.5) * 50, q + (rng() - 0.5) * 50, 3 + rng() * 6, 2 + rng() * 4, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // stream feeding the pond
  strokePath(g, RIVER);
  g.strokeStyle = '#d9c892';
  g.lineWidth = 92;
  g.stroke();
  g.strokeStyle = '#3d83d4';
  g.lineWidth = 60;
  g.stroke();
  g.strokeStyle = 'rgba(126,186,240,0.75)';
  g.lineWidth = 16;
  g.stroke();

  // cut the pond out
  g.globalCompositeOperation = 'destination-out';
  pondPath();
  g.fill();
  g.globalCompositeOperation = 'source-over';

  // frayed, brushy outer edge
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const mg = m.getContext('2d');
  const ins = 64;
  mg.fillStyle = '#000';
  mg.fillRect(ins, ins, W - ins * 2, H - ins * 2);
  mg.lineCap = 'round';
  mg.strokeStyle = '#000';
  const edge = [];
  for (let x = ins; x <= W - ins; x += 4) edge.push([x, ins, 0, -1], [x, H - ins, 0, 1]);
  for (let y = ins; y <= H - ins; y += 4) edge.push([ins, y, -1, 0], [W - ins, y, 1, 0]);
  for (const [x, y, nx, ny] of edge) {
    for (let k = 0; k < 2; k++) {
      const add = rng() < 0.55;
      mg.globalCompositeOperation = add ? 'source-over' : 'destination-out';
      const o = (rng() - 0.5) * 46;
      const L = (8 + rng() * 32) * (add ? 1 : -1);
      const a = Math.atan2(ny, nx) + (rng() - 0.5) * 1.4;
      const sx = x + nx * o + (rng() - 0.5) * 8;
      const sy = y + ny * o + (rng() - 0.5) * 8;
      mg.lineWidth = 2 + rng() * 6;
      mg.beginPath();
      mg.moveTo(sx, sy);
      mg.lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L);
      mg.stroke();
    }
  }
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(m, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return c;
}

function paintBed() {
  const rng = mulberry32(11);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, '#1f5a6e');
  grad.addColorStop(0.5, '#2f7584');
  grad.addColorStop(0.8, '#7f9474');
  grad.addColorStop(0.92, '#bba976');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const r = 120 + Math.sqrt(rng()) * 130;
    g.fillStyle = ['rgba(90,100,90,0.5)', 'rgba(200,190,150,0.5)', 'rgba(60,90,80,0.5)'][i % 3];
    g.beginPath();
    g.ellipse(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 2 + rng() * 5, 2 + rng() * 3, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function paintShadow() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 360;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(70,60,40,0.55)';
  g.shadowBlur = 40;
  g.shadowOffsetX = 2000;
  g.fillRect(70 - 2000, 60, 372, 240);
  return c;
}

/* ---------- water ---------- */

const waterVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const waterFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec4 uPond;
uniform vec4 uRip[8];
varying vec3 vW;
float shapeR(float th) { return 1.0 + 0.08 * sin(2.0 * th + 0.7) + 0.05 * sin(3.0 * th + 2.1) + 0.03 * sin(5.0 * th + 0.3); }
void main() {
  vec2 p = vW.xz;
  vec2 q = (p - uPond.xy) / uPond.zw;
  float k = length(q) / shapeR(atan(q.y, q.x));
  float shore = smoothstep(0.5, 1.0, k);
  vec3 col = mix(uDeep, uShallow, shore);
  float a = mix(0.4, 0.24, shore);
  float n = sin(p.x * 1.5 + uTime * 0.5 + sin(p.y * 1.3 + uTime * 0.3) * 1.6) * sin(p.y * 2.4 - uTime * 0.4 + sin(p.x * 0.9) * 1.3);
  float glint = smoothstep(0.62, 0.92, n);
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (age > 0.0 && age < 2.2) {
      float d = abs(length(p - r.xy) - age * 0.75);
      ring += smoothstep(0.07, 0.0, d) * (1.0 - age / 2.2) * r.w;
    }
  }
  float foam = smoothstep(0.93, 1.0, k);
  col += uFoam * (glint * 0.16 + ring * 0.6 + foam * 0.3);
  a += glint * 0.08 + ring * 0.3 + foam * 0.25;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  #include <colorspace_fragment>
}`;

/* ---------- props ---------- */

function toonRamp() {
  const data = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function makeTree(rng, ramp, palette, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, 0.45 * scale, 8),
    new THREE.MeshToonMaterial({ color: '#7a5636', gradientMap: ramp }),
  );
  trunk.position.y = 0.22 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const col = palette[(rng() * palette.length) | 0];
  const mat = new THREE.MeshToonMaterial({ color: col, gradientMap: ramp });
  const n = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const r = (0.3 + rng() * 0.22) * scale;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), mat);
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : (0.18 + rng() * 0.16) * scale;
    s.position.set(Math.cos(a) * d, (0.75 + rng() * 0.3) * scale + (i === 0 ? 0.12 * scale : 0), Math.sin(a) * d);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

function makeCloud(rng) {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonRamp() });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + rng() * 0.16, 3), mat);
    s.position.set((i - 2) * 0.24, rng() * 0.18, (rng() - 0.5) * 0.3);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

/* ---------- world ---------- */

export function createWorld(canvas, look) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(BG);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const rng = mulberry32(42);
  const ramp = toonRamp();

  scene.add(new THREE.HemisphereLight('#fffdf4', '#a8b98a', 2.1));
  const sun = new THREE.DirectionalLight('#fff6e3', 2.3);
  sun.position.set(-5, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 4;
  scene.add(sun);

  // drop shadow under the tile
  const shadowTex = new THREE.CanvasTexture(paintShadow());
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE.w * 1.38, TILE.d * 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  shadow.position.set(0.4, -1.4, 0.6);
  scene.add(shadow);

  // ground
  const groundTex = new THREE.CanvasTexture(paintGround());
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE.w, TILE.d).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: groundTex, alphaTest: 0.5 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // pond bed + bank walls + water
  const shapeOf = (s) => new THREE.Shape(pond.outline(180, s).map(([x, z]) => new THREE.Vector2(x, -z)));
  const bedGeo = new THREE.ShapeGeometry(shapeOf(1.0)).rotateX(-Math.PI / 2);
  {
    const pos = bedGeo.attributes.position;
    const uv = bedGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - POND.cx) / (POND.rx * 2.1) + 0.5, 0.5 - (pos.getZ(i) - POND.cz) / (POND.rz * 2.1));
    }
  }
  const bedTex = new THREE.CanvasTexture(paintBed());
  bedTex.colorSpace = THREE.SRGBColorSpace;
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshLambertMaterial({ map: bedTex, side: THREE.DoubleSide }));
  bed.position.y = POND.bed;
  bed.receiveShadow = true;
  scene.add(bed);

  {
    const ol = pond.outline(180, 1.0);
    const verts = [];
    const cols = [];
    const top = new THREE.Color('#b59b63');
    const bot = new THREE.Color('#5e5034');
    for (const [x, z] of ol) {
      verts.push(x, 0, z, x, POND.bed, z);
      cols.push(top.r, top.g, top.b, bot.r, bot.g, bot.b);
    }
    const idx = [];
    for (let i = 0; i < ol.length; i++) {
      const a = i * 2;
      const b = ((i + 1) % ol.length) * 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const walls = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    walls.receiveShadow = true;
    scene.add(walls);
  }

  const ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0));
  let ripIdx = 0;
  const waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#2f6fc0') },
    uShallow: { value: new THREE.Color('#62aee4') },
    uFoam: { value: new THREE.Color('#ffffff') },
    uPond: { value: new THREE.Vector4(POND.cx, POND.cz, POND.rx, POND.rz) },
    uRip: { value: ripples },
  };
  const water = new THREE.Mesh(
    new THREE.ShapeGeometry(shapeOf(1.0)).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  water.position.y = POND.y;
  water.renderOrder = 2;
  scene.add(water);

  // lily pads
  const pads = [];
  const padMat = new THREE.MeshToonMaterial({ color: '#5aa344', gradientMap: ramp, side: THREE.DoubleSide });
  const bloomMat = new THREE.MeshToonMaterial({ color: '#f6b3c9', gradientMap: ramp });
  for (let i = 0; i < 9; i++) {
    const th = rng() * Math.PI * 2;
    if (Math.abs(th - Math.PI / 2) < 0.5) continue;
    const [x, z] = pond.point(th, 0.72 + rng() * 0.22);
    const r = 0.18 + rng() * 0.14;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 22, 0.35, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), padMat);
    pad.position.set(x, POND.y + 0.02, z);
    pad.rotation.y = rng() * Math.PI * 2;
    pad.receiveShadow = true;
    if (rng() < 0.35) {
      const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), bloomMat);
      bloom.position.set(r * 0.25, 0.05, 0);
      bloom.castShadow = true;
      pad.add(bloom);
    }
    pads.push({ mesh: pad, phase: rng() * 6 });
    scene.add(pad);
  }

  // reeds
  const reedMat = new THREE.MeshToonMaterial({ color: '#5d8f3a', gradientMap: ramp });
  const tailMat = new THREE.MeshToonMaterial({ color: '#7b5233', gradientMap: ramp });
  const reeds = [];
  for (const th of [3.05, 3.5, 4.3, 5.4, 0.15, 0.6, 2.4]) {
    const [cx, cz] = pond.point(th, 0.97);
    for (let k = 0; k < 6; k++) {
      const h = 0.5 + rng() * 0.55;
      const reed = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, h, 5), reedMat);
      stem.position.y = h / 2;
      stem.castShadow = true;
      reed.add(stem);
      if (rng() < 0.5) {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 4, 8), tailMat);
        tail.position.y = h - 0.02;
        tail.castShadow = true;
        reed.add(tail);
      }
      reed.position.set(cx + (rng() - 0.5) * 0.5, POND.y, cz + (rng() - 0.5) * 0.35);
      reed.rotation.z = (rng() - 0.5) * 0.25;
      reed.userData.phase = rng() * 6;
      reeds.push(reed);
      scene.add(reed);
    }
  }

  // rocks on the bank
  const rockMat = new THREE.MeshToonMaterial({ color: '#b9b4a6', gradientMap: ramp });
  for (const th of [1.0, 2.1, 3.9, 4.9, 5.9]) {
    const [x, z] = pond.point(th, 1.04);
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + rng() * 0.12, 1), rockMat);
    r.scale.y = 0.55;
    r.position.set(x, 0.04, z);
    r.castShadow = true;
    scene.add(r);
  }

  // trees
  const greens = ['#5fae3e', '#6dbb45', '#4f9c37', '#7cc24c'];
  const spots = [
    [-6.9, -4.3, 1.1], [-4.7, -4.6, 0.9], [-2.2, -4.5, 1.0], [2.5, -4.65, 0.95], [4.8, -4.25, 1.1], [7.0, -4.4, 0.9],
    [7.1, -1.6, 1.0], [-7.1, 1.6, 0.95], [-6.4, 4.4, 1.05], [-3.6, 4.6, 0.85], [6.9, 1.7, 1.15], [4.3, 3.7, 0.8], [-1.6, 4.9, 0.7],
  ];
  for (const [x, z, s] of spots) {
    const t = makeTree(rng, ramp, greens, s);
    t.position.set(x, 0, z);
    t.rotation.y = rng() * 6;
    scene.add(t);
  }
  const pink = makeTree(rng, ramp, ['#e98fb3'], 1.0);
  pink.position.set(-5.5, 0, 2.6);
  scene.add(pink);

  // clouds
  const clouds = [];
  for (const [x, z, y] of [[-3, -2.5, 4.6], [4.5, -1.5, 5.2]]) {
    const c = makeCloud(rng);
    c.position.set(x, y, z);
    clouds.push(c);
    scene.add(c);
  }

  // dock
  const plankMats = ['#c0915a', '#b08250'].map((c) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp }));
  const nPlanks = 9;
  const pl = (DOCK.z0 - DOCK.z1) / nPlanks;
  for (let i = 0; i < nPlanks; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, pl * 0.9), plankMats[i % 2]);
    p.position.set(DOCK.x + (rng() - 0.5) * 0.04, 0.07, DOCK.z1 + pl * (i + 0.5));
    p.rotation.y = (rng() - 0.5) * 0.03;
    p.castShadow = p.receiveShadow = true;
    scene.add(p);
  }
  const postMat = new THREE.MeshToonMaterial({ color: '#6e4d31', gradientMap: ramp });
  for (const dx of [-0.45, 0.45]) {
    for (const z of [DOCK.z1 + 0.08, DOCK.z1 + 1.0, DOCK.z0 - 0.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.15, 8), postMat);
      post.position.set(DOCK.x + dx, -0.45, z);
      post.castShadow = true;
      scene.add(post);
    }
  }

  const angler = buildAngler(look);
  angler.group.position.set(DOCK.x - 0.05, 0.1, DOCK.z1 + 0.35);
  angler.group.scale.setScalar(1.3);
  scene.add(angler.group);

  // splash particles
  const dropMat = new THREE.MeshBasicMaterial({ color: '#eaf6ff' });
  const dropGeo = new THREE.IcosahedronGeometry(0.035, 0);
  const drops = Array.from({ length: 80 }, () => {
    const m = new THREE.Mesh(dropGeo, dropMat);
    m.visible = false;
    m.userData.v = new THREE.Vector3();
    scene.add(m);
    return m;
  });
  let dropIdx = 0;

  /* ---------- api ---------- */

  const target = new THREE.Vector3(0.3, -0.3, 0.5);
  const dir = new THREE.Vector3(0, 0.8, 0.6).normalize();
  const basePos = new THREE.Vector3();
  const parallax = new THREE.Vector2();
  const parallaxGoal = new THREE.Vector2();

  function fit() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const portrait = camera.aspect < 0.95;
    dir.set(0, portrait ? 0.93 : 0.8, portrait ? 0.37 : 0.6).normalize();
    const pts = portrait
      ? [[POND.cx - POND.rx - 0.4, 0, POND.cz - POND.rz - 0.8], [POND.cx + POND.rx + 0.4, 0, POND.cz - POND.rz - 0.8], [POND.cx - POND.rx - 0.4, 0, DOCK.z0 + 0.6], [POND.cx + POND.rx + 0.4, 0, DOCK.z0 + 0.6]]
      : [[-8.3, 0, -5.8], [8.3, 0, -5.8], [-8.3, 0, 5.8], [8.3, 0, 5.8], [-7, 1.6, -4.5], [7, 1.6, -4.5]];
    const v = new THREE.Vector3();
    let lo = 4;
    let hi = 80;
    for (let k = 0; k < 24; k++) {
      const d = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(dir, d);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const ok = pts.every(([x, y, z]) => {
        v.set(x, y, z).project(camera);
        return Math.abs(v.x) < 0.94 && v.y < 0.86 && v.y > -0.8;
      });
      if (ok) hi = d;
      else lo = d;
    }
    camera.position.copy(target).addScaledVector(dir, hi);
    basePos.copy(camera.position);
    camera.lookAt(target);
  }

  function addRipple(x, z, strength = 1, delay = 0) {
    ripples[ripIdx].set(x, z, waterUniforms.uTime.value + delay, strength);
    ripIdx = (ripIdx + 1) % ripples.length;
  }

  function splash(x, z, n = 14, power = 1) {
    for (let i = 0; i < n; i++) {
      const d = drops[dropIdx];
      dropIdx = (dropIdx + 1) % drops.length;
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 0.9) * power;
      d.position.set(x, POND.y + 0.02, z);
      d.userData.v.set(Math.cos(a) * s * 0.6, (1.6 + Math.random() * 1.6) * power, Math.sin(a) * s * 0.6);
      d.scale.setScalar(0.6 + Math.random() * 0.8);
      d.visible = true;
    }
    addRipple(x, z, 1.2 * power);
    addRipple(x, z, 0.7 * power, 0.25);
  }

  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -POND.y);
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    return raycaster;
  }
  function waterPoint(clientX, clientY) {
    const hit = new THREE.Vector3();
    return rayFrom(clientX, clientY).ray.intersectPlane(waterPlane, hit) ? hit : null;
  }

  function toScreen(v3) {
    const v = v3.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
  }

  function update(dt, t) {
    waterUniforms.uTime.value = t;
    for (const p of pads) p.mesh.position.y = POND.y + 0.02 + Math.sin(t * 1.3 + p.phase) * 0.008;
    for (const r of reeds) r.rotation.x = Math.sin(t * 1.1 + r.userData.phase) * 0.05;
    for (const c of clouds) {
      c.position.x += dt * 0.12;
      if (c.position.x > 9) c.position.x = -9;
    }
    for (const d of drops) {
      if (!d.visible) continue;
      d.userData.v.y -= 7 * dt;
      d.position.addScaledVector(d.userData.v, dt);
      if (d.position.y < POND.y) d.visible = false;
    }
    parallax.lerp(parallaxGoal, Math.min(1, dt * 3));
    camera.position.set(basePos.x + parallax.x * 0.5, basePos.y + parallax.y * 0.25, basePos.z);
    camera.lookAt(target);
  }

  return {
    renderer,
    scene,
    camera,
    angler,
    fit,
    update,
    addRipple,
    splash,
    rayFrom,
    waterPoint,
    toScreen,
    setParallax: (x, y) => parallaxGoal.set(x, y),
    render: () => renderer.render(scene, camera),
  };
}
