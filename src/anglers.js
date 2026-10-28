// The angler figure: one builder used for you on the dock and for the customizer preview.
import * as THREE from 'three';
import { cleanText, lerp } from './util.js';

export const LOOKS = {
  coat: ['#f2c14e', '#e5484d', '#3f8fd2', '#4caf6e', '#9b7fe0', '#f08fb0', '#2f3a4f', '#f4efe2'],
  hat: ['bucket', 'cap', 'straw', 'beanie', 'none'],
  hatColor: ['#3e6f8e', '#e5484d', '#f2c14e', '#4caf6e', '#2f3a4f', '#e9d8a6', '#f08fb0'],
  skin: ['#f6d7bf', '#f1c7a1', '#d9a47e', '#b07a52', '#7a4e33', '#57382a'],
  rod: ['#4a3322', '#c9a25a', '#e5484d', '#2f3a4f'],
};
export const HAT_LABELS = { bucket: 'Bucket', cap: 'Cap', straw: 'Straw', beanie: 'Beanie', none: 'No hat' };
export const DEFAULT_LOOK = { name: '', coat: '#f2c14e', hat: 'bucket', hatColor: '#3e6f8e', skin: '#f1c7a1', rod: '#4a3322' };

const pickIn = (v, list, fallback) => (list.includes(v) ? v : fallback);
const pickAny = (list) => list[Math.floor(Math.random() * list.length)];

// Looks arrive from other players, so treat every field as untrusted.
export function sanitizeLook(l) {
  const o = l && typeof l === 'object' ? l : {};
  return {
    name: cleanText(o.name, 16),
    coat: pickIn(o.coat, LOOKS.coat, DEFAULT_LOOK.coat),
    hat: pickIn(o.hat, LOOKS.hat, DEFAULT_LOOK.hat),
    hatColor: pickIn(o.hatColor, LOOKS.hatColor, DEFAULT_LOOK.hatColor),
    skin: pickIn(o.skin, LOOKS.skin, DEFAULT_LOOK.skin),
    rod: pickIn(o.rod, LOOKS.rod, DEFAULT_LOOK.rod),
  };
}

export function randomLook(name = '') {
  return { name, coat: pickAny(LOOKS.coat), hat: pickAny(LOOKS.hat.slice(0, 4)), hatColor: pickAny(LOOKS.hatColor), skin: pickAny(LOOKS.skin), rod: pickAny(LOOKS.rod) };
}

let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });

const ROD_LEN = 1.7;
export const ROD_REST = -0.95;

function hatMeshes(style, hatMat, darkMat) {
  const m = [];
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    m.push(mesh);
    return mesh;
  };
  switch (style) {
    case 'bucket':
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 24), hatMat, 0, 0.8, 0);
      add(new THREE.CylinderGeometry(0.11, 0.14, 0.12, 20), hatMat, 0, 0.87, 0);
      break;
    case 'cap':
      add(new THREE.SphereGeometry(0.148, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMat, 0, 0.745, 0);
      add(new THREE.BoxGeometry(0.19, 0.018, 0.13), hatMat, 0, 0.755, -0.15);
      add(new THREE.SphereGeometry(0.02, 8, 6), hatMat, 0, 0.895, 0);
      break;
    case 'straw':
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.018, 28), hatMat, 0, 0.8, 0);
      add(new THREE.CylinderGeometry(0.115, 0.13, 0.11, 20), hatMat, 0, 0.865, 0);
      add(new THREE.CylinderGeometry(0.132, 0.132, 0.03, 20), darkMat, 0, 0.83, 0);
      break;
    case 'beanie':
      add(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hatMat, 0, 0.735, 0);
      add(new THREE.CylinderGeometry(0.157, 0.157, 0.05, 20), hatMat, 0, 0.755, 0);
      add(new THREE.SphereGeometry(0.05, 12, 8), hatMat, 0, 0.9, 0);
      break;
    default:
      // no hat: a tuft of hair
      add(new THREE.SphereGeometry(0.146, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), darkMat, 0, 0.73, 0.005);
  }
  return m;
}

export function buildAngler(lookIn) {
  let look = sanitizeLook(lookIn);
  const mats = {
    coat: toon(look.coat),
    skin: toon(look.skin),
    hat: toon(look.hatColor),
    rod: toon(look.rod),
    dark: toon('#3a2a20'),
    eye: new THREE.MeshBasicMaterial({ color: '#1f2a44' }),
  };
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 6, 14), mats.coat);
  body.position.y = 0.38;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), mats.skin);
  head.position.y = 0.72;
  for (const m of [body, head]) {
    m.castShadow = true;
    group.add(m);
  }
  // eyes face -z, toward the water
  for (const x of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mats.eye);
    eye.position.set(x, 0.73, -0.128);
    group.add(eye);
  }
  const hat = new THREE.Group();
  group.add(hat);

  const pivot = new THREE.Group();
  pivot.position.set(0.13, 0.48, -0.1);
  const rodGeo = new THREE.CylinderGeometry(0.008, 0.016, ROD_LEN, 6);
  rodGeo.translate(0, ROD_LEN / 2, 0);
  const rod = new THREE.Mesh(rodGeo, mats.rod);
  rod.castShadow = true;
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 12), toon('#d8d2c4'));
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0.03, 0.18, 0);
  const tip = new THREE.Object3D();
  tip.position.y = ROD_LEN;
  pivot.add(rod, reel, tip);
  pivot.rotation.x = ROD_REST;
  group.add(pivot);

  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.2, 16), toon('#8aa3b5'));
  bucket.position.set(0.38, 0.1, 0.25);
  bucket.castShadow = true;
  group.add(bucket);

  function apply(next) {
    const prevHat = look.hat;
    look = sanitizeLook(next);
    mats.coat.color.set(look.coat);
    mats.skin.color.set(look.skin);
    mats.hat.color.set(look.hatColor);
    mats.rod.color.set(look.rod);
    if (prevHat !== look.hat || !hat.children.length) {
      for (const c of [...hat.children]) {
        hat.remove(c);
        c.geometry.dispose();
      }
      for (const m of hatMeshes(look.hat, mats.hat, mats.dark)) {
        m.castShadow = true;
        hat.add(m);
      }
    }
  }
  apply(look);

  return {
    group,
    pivot,
    tip,
    apply,
    get look() {
      return look;
    },
  };
}

/* ---------- bobber and line, shared by every angler ---------- */

export function makeBobber() {
  const bob = new THREE.Group();
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#e5484d' }));
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#fbfaf6' }));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
  stem.position.y = 0.1;
  bob.add(red, white, stem);
  bob.visible = false;
  return bob;
}

const LINE_PTS = 28;
export function makeLine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_PTS * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#2d2a26', transparent: true, opacity: 0.75 }));
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

export function drawLine(line, a, b, slack) {
  const pos = line.geometry.attributes.position;
  const sagScale = Math.min(1, a.distanceTo(b) / 4);
  for (let i = 0; i < LINE_PTS; i++) {
    const k = i / (LINE_PTS - 1);
    const sag = Math.sin(k * Math.PI) * slack * sagScale;
    pos.setXYZ(i, lerp(a.x, b.x, k), lerp(a.y, b.y, k) - sag, lerp(a.z, b.z, k));
  }
  pos.needsUpdate = true;
}
