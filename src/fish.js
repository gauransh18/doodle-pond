// A drawn fish: the doodle becomes a wiggling sticker that swims under the water.
import * as THREE from 'three';
import { renderFishCanvas } from './strokes.js';
import { DOCK, POND, pond } from './world.js';
import { angleDiff, clamp, hashStr, lerp, mulberry32, rand } from './util.js';

const AVG_R = (POND.rx + POND.rz) / 2;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// where the stream meets the pond: fish arrive and leave here
export const MOUTH = pond.point(Math.PI + 0.09, 0.86);
// fish swim in depth layers between these; each layer keeps its own spacing
const TOP = -0.26;
const BOTTOM = -0.82;
const depthOf = (y) => clamp((TOP - y) / (TOP - BOTTOM), 0, 1);

const vert = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uSwim;
uniform float uLen;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float tail = 1.0 - uv.x;
  p.z += sin(uTime * (3.0 + uSwim * 8.0) + uPhase - uv.x * 4.0) * uLen * 0.1 * tail * tail * (0.45 + uSwim);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uShadow;
uniform float uOpacity;
uniform float uDeep;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.45) discard;
  if (uShadow > 0.5) {
    gl_FragColor = vec4(0.03, 0.14, 0.2, 0.28 * uOpacity);
  } else {
    // deeper fish fade into the water color
    gl_FragColor = vec4(mix(c.rgb * uTint, vec3(0.17, 0.4, 0.66), uDeep * 0.5), 1.0);
  }
  #include <colorspace_fragment>
}`;

const UNDER = new THREE.Color(0.92, 0.97, 1.0);
const DRY = new THREE.Color(1, 1, 1);

export class Fish {
  constructor(data, scene) {
    this.data = data;
    this.id = data.id;
    this.scene = scene;
    const r = mulberry32(hashStr(data.id));
    const { canvas, aspect } = renderFishCanvas(data.strokes, 256);
    this.canvas = canvas;

    let len = 0.8 + r() * 0.4;
    let wid = len / aspect;
    if (wid > len * 1.05) {
      wid = len * 1.05;
      len = wid * aspect;
    }
    this.len = len;
    this.wid = wid;
    this.strength = 0.8 + r() * 0.5;
    this.baseSpeed = 0.3 + r() * 0.3;
    // main.js assigns the layer; the jitter keeps a layer from looking flat
    this.jitter = (r() - 0.5) * 0.06;
    this.layer = 0;
    this.depth = TOP - 0.1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(len, wid, 16, 1).rotateX(-Math.PI / 2);
    this.u = {
      uTime: { value: 0 },
      uPhase: { value: r() * 10 },
      uSwim: { value: 0.5 },
      uLen: { value: len },
      uMap: { value: tex },
      uTint: { value: UNDER.clone() },
      uShadow: { value: 0 },
      uOpacity: { value: 1 },
      uDeep: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 1;
    this.mesh.userData.fish = this;
    this.shadow = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: { ...this.u, uShadow: { value: 1 } }, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false }),
    );
    scene.add(this.mesh, this.shadow);

    const [x, z] = pond.random(r, len * 0.7);
    this.pos = new THREE.Vector2(x, z);
    this.y = this.depth;
    this.heading = r() * Math.PI * 2;
    this.omega = 0;
    this.speed = this.baseSpeed;
    this.target = new THREE.Vector2(...pond.random(Math.random, 0.55));
    this.mode = 'wander';
    this.timer = 0;
    this.pause = 0;
    this.bait = new THREE.Vector2();
    this.flight = new THREE.Vector2();
    this.desire = new THREE.Vector2();
    this.push = new THREE.Vector2();
    this.vy = 0;
    this.scale = 1;
    this.onLand = null;
    this.sync();
  }

  head(out = new THREE.Vector2()) {
    return out.set(this.pos.x + Math.cos(this.heading) * this.len * 0.45, this.pos.y + Math.sin(this.heading) * this.len * 0.45);
  }

  setLayer(i, n, snap = false) {
    this.layer = i;
    this.depth = (n > 1 ? lerp(TOP, BOTTOM, i / (n - 1)) : TOP - 0.1) + this.jitter;
    if (snap) this.y = this.depth;
  }

  get inWater() {
    return !['drop', 'held', 'leap'].includes(this.mode);
  }

  approach(x, z) {
    this.mode = 'approach';
    this.timer = 0;
    this.bait.set(x, z);
  }

  flee(fromX, fromZ) {
    this.mode = 'flee';
    this.timer = 1.6;
    this.speed = Math.max(this.speed, 1.2);
    const a = fromX === undefined ? this.heading : Math.atan2(this.pos.y - fromZ, this.pos.x - fromX) + rand(-0.4, 0.4);
    this.flight.set(Math.cos(a), Math.sin(a));
  }

  dropIn(x, z, onLand) {
    this.mode = 'drop';
    this.pos.set(x, z);
    this.y = 3.2;
    this.vy = 0;
    this.onLand = onLand;
    this.u.uTint.value.copy(DRY);
  }

  // arrive from the stream
  swimIn() {
    this.mode = 'arrive';
    this.pos.set(MOUTH[0], MOUTH[1]);
    this.heading = rand(-0.4, 0.4);
    this.omega = 0;
    this.speed = this.baseSpeed + 0.3;
    this.scale = 0;
    this.target.set(...pond.random(Math.random, 1.2));
    this.sync();
  }

  // leave through the stream to make room for another fish
  swimAway() {
    this.mode = 'leave';
    this.timer = 0;
    this.target.set(MOUTH[0], MOUTH[1]);
  }

  remove() {
    this.mode = 'remove';
  }

  dispose() {
    this.scene.remove(this.mesh, this.shadow);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.shadow.material.dispose();
    this.u.uMap.value.dispose();
  }

  newTarget() {
    this.target.set(...pond.random(Math.random, 0.55));
    this.timer = 0;
  }

  update(dt, t, others) {
    this.u.uTime.value = t;
    const want = this.desire.set(0, 0);
    let speedGoal = this.baseSpeed;
    let maxTurn = 1.5;
    let crowd = 1;
    let turnRate = 3;
    let steering = true;
    let yGoal = this.depth;

    switch (this.mode) {
      case 'arrive':
        this.scale = Math.min(1, this.scale + dt * 0.9);
        this.seek(want, this.target, 1);
        speedGoal = this.baseSpeed + 0.15;
        if (this.scale >= 1) this.mode = 'wander';
        break;
      case 'wander':
        this.timer += dt;
        if (this.pause > 0) {
          this.pause -= dt;
          speedGoal = 0.04;
        } else this.seek(want, this.target, 1);
        if (this.pos.distanceTo(this.target) < 0.6 || this.timer > 14) {
          this.newTarget();
          if (Math.random() < 0.3) this.pause = rand(1, 3);
        }
        break;
      case 'approach': {
        const h = this.head();
        const d = h.distanceTo(this.bait);
        this.seek(want, this.bait, 1.8, h);
        // slow right down and turn sharply near the bait, or it circles forever
        speedGoal = clamp(d * 0.55, 0.03, 0.5);
        maxTurn = 3.2;
        turnRate = d < 1 ? 8 : 3;
        crowd = d < 1 ? 0.1 : 0.3;
        // rise up to the bait from whatever layer it swims in
        yGoal = lerp(Math.max(this.depth, TOP - 0.04), this.depth, clamp(d - 0.5, 0, 1));
        this.timer += dt;
        if (d < 0.18 || (this.timer > 10 && d < 0.7)) this.mode = 'nibble';
        break;
      }
      case 'nibble':
        speedGoal = 0;
        crowd = 0;
        yGoal = Math.max(this.depth, TOP - 0.04);
        this.heading += Math.sin(t * 9) * dt * 0.35;
        break;
      case 'flee':
        this.timer -= dt;
        want.addScaledVector(this.flight, 1.4);
        speedGoal = 1.1;
        maxTurn = 2.2;
        if (this.timer <= 0) {
          this.mode = 'wander';
          this.newTarget();
        }
        break;
      case 'leave':
        this.timer += dt;
        this.seek(want, this.target, 1.2);
        speedGoal = this.baseSpeed + 0.2;
        if (this.pos.distanceTo(this.target) < 1.0 || this.timer > 15) {
          this.scale -= dt * 0.8;
          if (this.scale <= 0) {
            this.scale = 0;
            this.mode = 'remove';
          }
        }
        break;
      case 'drop':
        steering = false;
        this.vy -= 9 * dt;
        this.y += this.vy * dt;
        this.heading += dt * 2;
        if (this.y <= this.depth + 0.25) {
          this.y = this.depth;
          this.u.uTint.value.copy(UNDER);
          this.onLand?.(this);
          this.onLand = null;
          this.flee();
        }
        break;
      case 'remove':
        steering = false;
        this.scale = Math.max(0, this.scale - dt * 3);
        break;
      default:
        // 'hooked', 'leap', 'held' are driven by the angler
        steering = false;
    }

    if (steering) {
      if (crowd > 0) this.separate(want, others, crowd, dt);
      this.avoidWalls(want);
      this.avoidDock(want);

      const targetOmega = want.lengthSq() > 1e-4 ? clamp(angleDiff(this.heading, Math.atan2(want.y, want.x)) * 2.2, -maxTurn, maxTurn) : 0;
      this.omega = lerp(this.omega, targetOmega, Math.min(1, dt * turnRate));
      this.heading += this.omega * dt;
      this.speed = lerp(this.speed, speedGoal, Math.min(1, dt * 1.5));
      this.pos.x += Math.cos(this.heading) * this.speed * dt;
      this.pos.y += Math.sin(this.heading) * this.speed * dt;
      this.y = lerp(this.y, yGoal, Math.min(1, dt * 1.2));

      // hard limits: slide along the wall and around the dock instead of stopping
      const c = pond.clampInside(this.pos.x, this.pos.y, this.len * 0.42);
      if (c) this.pos.set(c[0], c[1]);
      const dockHalf = 0.5 + this.wid * 0.45;
      const dockFront = DOCK.z1 - this.len * 0.3;
      if (Math.abs(this.pos.x - DOCK.x) < dockHalf && this.pos.y > dockFront) this.pos.y = dockFront;
    }

    this.u.uSwim.value = clamp(this.speed / 0.8, 0, 1.6);
    this.sync();
  }

  seek(out, target, weight, from = this.pos) {
    const dx = target.x - from.x;
    const dz = target.y - from.y;
    const d = Math.hypot(dx, dz) || 1;
    out.x += (dx / d) * weight;
    out.y += (dz / d) * weight;
  }

  // steer away from neighbors, and nudge apart when already overlapping
  separate(out, others, weight, dt) {
    const push = this.push.set(0, 0);
    for (const o of others) {
      // fish in other layers pass over and under each other
      if (o === this || !o.inWater || Math.abs(o.y - this.y) > 0.12) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.y - o.pos.y;
      const R = (this.len + o.len) * 0.62;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const ux = d2 > 1e-6 ? dx / d : Math.cos(this.heading + Math.PI / 2);
      const uz = d2 > 1e-6 ? dz / d : Math.sin(this.heading + Math.PI / 2);
      const overlap = 1 - d / R;
      out.x += ux * overlap * 3.2 * weight;
      out.y += uz * overlap * 3.2 * weight;
      const core = (this.len + o.len) * 0.4;
      if (d < core) {
        const k = (1 - d / core) * 0.9 * weight;
        push.x += ux * k;
        push.y += uz * k;
      }
    }
    this.pos.x += push.x * dt;
    this.pos.y += push.y * dt;
  }

  // look ahead along the heading and turn away before reaching the shore
  avoidWalls(out) {
    const ahead = this.len * 0.5 + 0.3 + this.speed * 0.6;
    const e = pond.edge(this.pos.x + Math.cos(this.heading) * ahead, this.pos.y + Math.sin(this.heading) * ahead);
    const kLim = 1 - (this.len * 0.5) / AVG_R;
    const w = smoothstep(kLim - 0.1, kLim, e.k) * 3.5;
    const here = pond.edge(this.pos.x, this.pos.y);
    const w2 = smoothstep(kLim - 0.06, kLim, here.k) * 2;
    out.x += e.nx * w + here.nx * w2;
    out.y += e.nz * w + here.nz * w2;
  }

  avoidDock(out) {
    const side = this.pos.x - DOCK.x;
    if (Math.abs(side) < 1.3 && this.pos.y > DOCK.z1 - 1.1) {
      const w = smoothstep(DOCK.z1 - 1.1, DOCK.z1, this.pos.y) * 2;
      out.x += Math.sign(side || 1) * 0.5 * w;
      out.y -= w;
    }
  }

  sync() {
    this.mesh.position.set(this.pos.x, this.y, this.pos.y);
    this.mesh.rotation.y = -this.heading;
    const deep = this.y < POND.y ? depthOf(this.y) : 0;
    this.u.uDeep.value = deep;
    this.mesh.scale.setScalar(this.scale * (1 - deep * 0.12));
    this.mesh.visible = this.mode !== 'held' && this.scale > 0.01;
    const underwater = this.y < POND.y;
    this.shadow.visible = this.mesh.visible;
    // the closer to the bed, the tighter the shadow
    const lift = clamp((this.y - POND.bed) / 0.75, 0.3, 1.4);
    this.shadow.position.set(this.pos.x + 0.14 * lift, POND.bed + 0.02, this.pos.y + 0.12 * lift);
    this.shadow.rotation.y = -this.heading;
    this.shadow.scale.setScalar(this.mesh.scale.x);
    this.u.uOpacity.value = underwater ? 1 : clamp(1 - (this.y - POND.y) / 2.5, 0.2, 1);
  }
}
