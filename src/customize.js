// "Your angler" sheet: pick a look and see it on a little turntable. The look is saved in this browser.
import * as THREE from 'three';
import { buildAngler, HAT_LABELS, LOOKS, randomLook, sanitizeLook, toonRamp } from './anglers.js';

export function createCustomizer({ getLook, onChange, onDone }) {
  const root = document.getElementById('custom');
  const cv = document.getElementById('custom-preview');
  const nameIn = document.getElementById('angler-name');
  let look = sanitizeLook(getLook());
  let saved = look;

  // turntable
  let renderer = null;
  let scene;
  let camera;
  let model;
  let raf = 0;
  function initPreview() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0.9, 1.15, -2.3);
    camera.lookAt(0, 0.5, 0);
    scene.add(new THREE.HemisphereLight('#fffdf4', '#a8b98a', 2.2));
    const sun = new THREE.DirectionalLight('#fff6e3', 2.2);
    sun.position.set(2, 4, -3);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#8fca4e', gradientMap: toonRamp() }));
    scene.add(ground);
    model = buildAngler(look);
    model.group.position.y = 0.0;
    scene.add(model.group);
  }
  function frame(now) {
    const r = cv.getBoundingClientRect();
    if (r.width && (cv.width !== Math.round(r.width * renderer.getPixelRatio()) || cv.height !== Math.round(r.height * renderer.getPixelRatio()))) {
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    }
    model.group.rotation.y = Math.sin(now / 1400) * 0.7;
    model.pivot.rotation.x = -0.95 + Math.sin(now / 600) * 0.05;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  // controls
  function swatchRow(id, key, labeler) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    for (const v of LOOKS[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.value = v;
      if (labeler) {
        b.className = 'tool';
        b.textContent = labeler[v];
      } else {
        b.className = 'swatch';
        b.style.background = v;
        b.setAttribute('aria-label', v);
      }
      b.onclick = () => set({ [key]: v });
      el.appendChild(b);
    }
  }
  swatchRow('pick-coat', 'coat');
  swatchRow('pick-hat', 'hat', HAT_LABELS);
  swatchRow('pick-hat-color', 'hatColor');
  swatchRow('pick-skin', 'skin');
  swatchRow('pick-rod', 'rod');
  const rows = { coat: 'pick-coat', hat: 'pick-hat', hatColor: 'pick-hat-color', skin: 'pick-skin', rod: 'pick-rod' };

  function render() {
    for (const [key, id] of Object.entries(rows)) {
      document.querySelectorAll(`#${id} [role=radio]`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === look[key])));
    }
    document.getElementById('pick-hat-color').closest('.pick').hidden = look.hat === 'none';
    if (document.activeElement !== nameIn) nameIn.value = look.name;
  }

  function set(patch) {
    look = sanitizeLook({ ...look, ...patch });
    model?.apply(look);
    onChange(look);
    render();
  }

  nameIn.addEventListener('input', () => set({ name: nameIn.value }));
  document.getElementById('custom-shuffle').onclick = () => set(randomLook(look.name));

  function open() {
    look = saved = sanitizeLook(getLook());
    initPreview();
    model.apply(look);
    render();
    root.hidden = false;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function close(keep) {
    if (root.hidden) return;
    root.hidden = true;
    cancelAnimationFrame(raf);
    if (keep) {
      saved = look;
      onDone(look);
    } else {
      look = saved;
      onChange(saved);
    }
  }
  document.getElementById('custom-done').onclick = () => close(true);
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => close(false)));
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close(false);
  });

  return {
    open,
    close,
    get isOpen() {
      return !root.hidden;
    },
  };
}
