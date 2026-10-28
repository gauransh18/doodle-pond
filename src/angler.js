// Cast, wait, nibble, bite, reel, land. One fishing line at a time.
import * as THREE from 'three';
import { DOCK, POND, pond } from './world.js';
import { sfx } from './audio.js';
import { angleDiff, clamp, easeInOutSine, easeOutCubic, lerp, rand } from './util.js';

const REST = -0.95;
const LINE_PTS = 28;
const LAND_SPOT = new THREE.Vector2(DOCK.x, DOCK.z1 - 0.35);

export class Angler {
  constructor(world, getFish, ui) {
    this.w = world;
    this.getFish = getFish;
    this.ui = ui;
    // tells the other players at this pond what we're doing
    this.state = 'idle';
    this.t = 0;
    this.fish = null;
    this.reeling = false;

    const { pivot, tip, group } = world.angler;
    this.pivot = pivot;
    this.tip = tip;
    this.body = group;
    this.faceGoal = 0;

    const bob = new THREE.Group();
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#e5484d' }));
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#fbfaf6' }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
    stem.position.y = 0.1;
    bob.add(red, white, stem);
    bob.visible = false;
    world.scene.add(bob);
    this.bobber = bob;
    this.bobberBase = new THREE.Vector3();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_PTS * 3), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#2d2a26', transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    world.scene.add(this.line);

    this.tension = 0;
    this.progress = 0;
  }

  get canCast() {
    return ['idle', 'waiting', 'nibble'].includes(this.state);
  }

  tipWorld(out = new THREE.Vector3()) {
    return this.tip.getWorldPosition(out);
  }

  setStatus() {
    const text = {
      idle: 'Click the pond to cast',
      casting: 'Casting…',
      waiting: 'Waiting for a bite…',
      nibble: 'Something is nibbling…',
      bite: 'Bite! Click to hook it',
      reel: 'Hold to reel it in. Let go if the line gets tight.',
      leap: 'Got it!',
      card: 'Nice catch',
    }[this.state];
    this.ui.status(text, this.state);
  }

  /* ---------- actions ---------- */

  cast(x, z) {
    if (!this.canCast) return false;
    if (this.fish && this.fish.mode !== 'wander') this.fish.flee(x, z);
    this.fish = null;
    this.state = 'casting';
    this.castT = 0;
    this.castFrom = this.tipWorld();
    this.castTo = new THREE.Vector3(x, POND.y, z);
    const dx = x - this.body.position.x;
    const dz = z - this.body.position.z;
    this.faceGoal = Math.atan2(-dx, -dz);
    this.bobber.visible = false;
    this.line.visible = false;
    sfx.whoosh();
    this.setStatus();
    return true;
  }

  cancel() {
    if (!['casting', 'waiting', 'nibble', 'bite'].includes(this.state)) return;
    if (this.fish) this.fish.flee(this.bobberBase.x, this.bobberBase.z);
    this.reset();
  }

  reset() {
    this.fish = null;
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
    this.reeling = false;
    this.ui.bite(false);
    this.ui.reel(false);
    this.setStatus();
  }

  // returns true when the press belongs to the fishing game
  press() {
    if (this.state === 'bite') {
      this.hook();
      this.reeling = true;
      return true;
    }
    if (this.state === 'nibble') {
      // too early is fine: nothing is lost, just a nudge
      this.ui.status('Not yet. Wait for the big dip…', 'nibble');
      return true;
    }
    if (this.state === 'reel') {
      this.reeling = true;
      return true;
    }
    return false;
  }

  release() {
    this.reeling = false;
  }

  hook() {
    this.state = 'reel';
    this.tension = 0.3;
    this.progress = 0.1;
    this.calmAt = 0;
    this.surgeAt = this.t + rand(1.0, 2.0);
    this.surgeUntil = 0;
    this.tickAt = 0;
    this.hookPos = this.fish.pos.clone();
    this.hookY = this.fish.y;
    this.fish.mode = 'hooked';
    this.ui.bite(false);
    this.ui.reel(true, this.tension, this.progress);
    sfx.splash();
    this.w.splash(this.bobberBase.x, this.bobberBase.z, 10, 0.7);
    this.setStatus();
  }

  toWaiting(delay) {
    this.state = 'waiting';
    this.interestAt = this.t + delay;
    this.bobber.visible = true;
    this.line.visible = true;
    this.ui.bite(false);
    this.setStatus();
  }

  // after the catch card closes
  letGo() {
    const f = this.fish;
    if (f) {
      f.u.uTint.value.setRGB(1, 1, 1);
      f.mode = 'drop';
      f.y = 0.9;
      f.vy = 1.5;
      f.pos.copy(LAND_SPOT);
      f.heading = -Math.PI / 2 + rand(-0.6, 0.6);
      f.onLand = (fish) => {
        this.w.splash(fish.pos.x, fish.pos.y, 16, 0.9);
        sfx.splash();
      };
    }
    this.reset();
  }

  // after the catch card closes with "Keep": the fish goes in the bucket, not back in the water
  keep() {
    const f = this.fish;
    if (f) {
      f.mode = 'remove';
      f.scale = 0;
    }
    this.reset();
  }

  /* ---------- frame ---------- */

  update(dt, t) {
    this.t = t;
    // turn the angler toward the cast
    const rot = this.body.rotation;
    rot.y += angleDiff(rot.y, this.faceGoal) * Math.min(1, dt * 5);

    switch (this.state) {
      case 'idle':
        this.pivot.rotation.x = lerp(this.pivot.rotation.x, REST + Math.sin(t * 1.2) * 0.03, dt * 4);
        break;

      case 'casting': {
        this.castT += dt;
        const wind = 0.22;
        const fly = 0.55;
        if (this.castT < wind) {
          this.pivot.rotation.x = lerp(REST, 0.35, easeOutCubic(this.castT / wind));
        } else {
          const k = clamp((this.castT - wind) / fly, 0, 1);
          this.pivot.rotation.x = lerp(0.35, -1.25, easeOutCubic(Math.min(1, k * 2.2)));
          const from = this.tipWorld();
          const p = new THREE.Vector3().lerpVectors(from, this.castTo, k);
          p.y += Math.sin(k * Math.PI) * 1.4 * (1 - k * 0.3);
          this.bobber.position.copy(p);
          this.bobber.visible = true;
          this.line.visible = true;
          if (k >= 1) {
            this.bobberBase.copy(this.castTo);
            this.w.addRipple(this.castTo.x, this.castTo.z, 1);
            this.w.splash(this.castTo.x, this.castTo.z, 5, 0.35);
            sfx.plop();
            this.toWaiting(rand(0.8, 2.0));
          }
        }
        break;
      }

      case 'waiting': {
        this.pivot.rotation.x = lerp(this.pivot.rotation.x, REST - 0.15, dt * 3);
        if (!this.fish && t > this.interestAt) {
          const near = this.getFish()
            .filter((f) => f.mode === 'wander' && f.pos.distanceTo(new THREE.Vector2(this.bobberBase.x, this.bobberBase.z)) < 5.5)
            .sort((a, b) => a.pos.distanceToSquared(new THREE.Vector2(this.bobberBase.x, this.bobberBase.z)) - b.pos.distanceToSquared(new THREE.Vector2(this.bobberBase.x, this.bobberBase.z)));
          const f = near[Math.floor(Math.random() * Math.min(3, near.length))];
          if (f) {
            this.fish = f;
            f.approach(this.bobberBase.x, this.bobberBase.z);
          } else this.interestAt = t + 1;
        }
        if (this.fish) {
          if (this.fish.mode === 'nibble') {
            this.state = 'nibble';
            this.nibblesLeft = 1 + Math.floor(Math.random() * 2);
            this.nextNibble = t + rand(0.3, 0.7);
            this.missed = 0;
            this.setStatus();
          } else if (this.fish.mode !== 'approach') {
            this.fish = null;
            this.interestAt = t + rand(1, 2);
          }
        }
        this.floatBobber(t, 0);
        break;
      }

      case 'nibble': {
        let dip = 0;
        const since = t - (this.lastNibble ?? -9);
        if (since < 0.25) dip = Math.sin((since / 0.25) * Math.PI) * 0.04;
        if (t > this.nextNibble) {
          if (this.nibblesLeft > 0) {
            this.nibblesLeft--;
            this.lastNibble = t;
            this.nextNibble = t + rand(0.55, 1.0);
            this.w.addRipple(this.bobberBase.x, this.bobberBase.z, 0.5);
            sfx.nibble();
          } else {
            this.state = 'bite';
            this.biteEnd = t + 4;
            this.w.addRipple(this.bobberBase.x, this.bobberBase.z, 1.3);
            this.w.splash(this.bobberBase.x, this.bobberBase.z, 6, 0.45);
            sfx.splash();
            this.ui.bite(true);
            this.setStatus();
          }
        }
        this.floatBobber(t, dip);
        break;
      }

      case 'bite':
        this.floatBobber(t, 0.12);
        if (t > this.biteEnd) {
          this.ui.bite(false);
          if (++this.missed < 3) {
            // it comes back for another nibble
            this.state = 'nibble';
            this.nibblesLeft = 1;
            this.nextNibble = t + rand(0.6, 1.2);
            this.setStatus();
          } else {
            this.fish?.flee(this.bobberBase.x, this.bobberBase.z);
            this.fish = null;
            this.ui.toast('That one wandered off. Another will come along.');
            this.toWaiting(rand(1, 2));
          }
        }
        break;

      case 'reel':
        this.updateReel(dt, t);
        break;

      case 'leap': {
        this.leapT += dt;
        const k = clamp(this.leapT / 0.75, 0, 1);
        const f = this.fish;
        f.pos.lerpVectors(this.leapFrom, LAND_SPOT, easeInOutSine(k));
        f.y = lerp(POND.y - 0.2, 0.9, k) + Math.sin(k * Math.PI) * 1.4;
        f.heading += dt * 7;
        f.u.uTint.value.setRGB(1, 1, 1);
        f.sync();
        this.pivot.rotation.x = lerp(this.pivot.rotation.x, -0.2, dt * 6);
        this.bobber.position.set(f.pos.x, f.y, f.pos.y);
        if (k >= 1) {
          this.state = 'card';
          f.mode = 'held';
          f.sync();
          this.bobber.visible = false;
          this.line.visible = false;
          sfx.chime();
          this.ui.caught(f);
          this.setStatus();
        }
        break;
      }
      default:
        break;
    }
    this.updateLine();
  }

  floatBobber(t, dip) {
    this.bobber.position.set(this.bobberBase.x, POND.y + 0.03 + Math.sin(t * 2.4) * 0.012 - dip, this.bobberBase.z);
  }

  // Relaxed reel: hold to bring it in, ease off when the needle reaches the end.
  // The line never snaps and the fish never escapes; a tight line just slips a little.
  updateReel(dt, t) {
    const f = this.fish;
    const s = f.strength;
    if (this.reeling) this.tension += 0.38 * dt;
    else this.tension -= 0.55 * dt;
    if (t > this.surgeAt) {
      this.surgeUntil = t + 0.3;
      this.surgeAt = t + rand(1.4, 2.8);
    }
    const surging = t < this.surgeUntil;
    if (surging) this.tension += 0.6 * s * dt;
    this.tension = clamp(this.tension, 0, 1);

    if (this.tension >= 1) {
      this.tension = 0.45;
      this.ui.status('Easy… give it a moment', 'reel');
      this.restUntil = t + 0.8;
      this.calmAt = t + 1.5;
    } else if (this.calmAt && t > this.calmAt) {
      this.calmAt = 0;
      this.setStatus();
    }

    // a tight line pauses reeling for a beat, so easing off is a little quicker than holding
    const resting = t < (this.restUntil ?? 0);
    const inZone = this.tension >= 0.12 && this.tension < 0.92;
    this.progress += (inZone && this.reeling && !resting ? 0.3 : 0.05) * dt;

    if (this.reeling && t > this.tickAt) {
      sfx.tick();
      this.tickAt = t + 0.12;
    }

    // fish pulled toward the dock, thrashing side to side
    const k = clamp(this.progress, 0, 1);
    const base = new THREE.Vector2().lerpVectors(this.hookPos, LAND_SPOT, easeInOutSine(k));
    const away = Math.atan2(this.hookPos.y - LAND_SPOT.y, this.hookPos.x - LAND_SPOT.x);
    const side = Math.sin(t * (surging ? 7 : 3.2)) * 0.55 * (1 - k * 0.7);
    f.pos.set(base.x + Math.cos(away + Math.PI / 2) * side, base.y + Math.sin(away + Math.PI / 2) * side);
    if (!pond.inside(f.pos.x, f.pos.y, 0.3)) f.pos.copy(base);
    f.heading = away + Math.sin(t * 6) * 0.5;
    f.u.uSwim.value = surging ? 1.6 : 1.0;
    f.y = lerp(this.hookY, -0.2, k);
    f.sync();
    if (Math.random() < dt * (surging ? 10 : 2)) this.w.addRipple(f.pos.x, f.pos.y, 0.6);

    const h = f.head();
    this.bobber.position.set(h.x, POND.y - 0.04, h.y);
    this.bobberBase.set(h.x, POND.y, h.y);
    this.pivot.rotation.x = lerp(this.pivot.rotation.x, REST + 0.3 + this.tension * 0.5 + (surging ? Math.sin(t * 40) * 0.04 : 0), dt * 8);
    this.faceGoal = Math.atan2(-(h.x - this.body.position.x), -(h.y - this.body.position.z));

    this.ui.reel(true, this.tension, k, surging);

    if (this.progress >= 1) {
      this.state = 'leap';
      this.leapT = 0;
      this.leapFrom = f.pos.clone();
      f.mode = 'leap';
      this.reeling = false;
      this.ui.reel(false);
      this.w.splash(f.pos.x, f.pos.y, 18, 1);
      sfx.splash();
      this.setStatus();
    }
  }

  updateLine() {
    if (!this.line.visible) return;
    const a = this.tipWorld();
    const b = this.bobber.position;
    const taut = this.state === 'reel' ? 0.05 : this.state === 'casting' ? 0.3 : 0.6;
    const pos = this.line.geometry.attributes.position;
    for (let i = 0; i < LINE_PTS; i++) {
      const k = i / (LINE_PTS - 1);
      const sag = Math.sin(k * Math.PI) * taut * Math.min(1, a.distanceTo(b) / 4);
      pos.setXYZ(i, lerp(a.x, b.x, k), lerp(a.y, b.y, k) - sag, lerp(a.z, b.z, k));
    }
    pos.needsUpdate = true;
  }
}
