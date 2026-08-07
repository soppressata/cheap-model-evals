/**
 * main.js — boot, state machine, render loop, and UI overlay wiring.
 *
 * High-level screens: title -> hangar / workshop / flying (launch->fly->crash)
 * -> game over. The heavy lifting (physics, terrain, rendering) lives in Game;
 * this file owns the DOM and dispatches transitions.
 */
import { Game, PHASE } from './Game.js';
import {
  PLANES, PATTERNS, FINISHES, CONTRAILS,
  loadSave, save, setCustomization, unlockPlane, equipPlane,
} from './systems/Storage.js';
import { Airplane } from './player/Airplane.js';
import * as THREE from 'three';
import './index.css';

const qs = (s) => document.querySelector(s);
const qsa = (s) => document.querySelectorAll(s);

let game;
let prevTime = performance.now();
let screen = 'title';

const title = qs('#title');
const hud = qs('#hud');
const hangar = qs('#hangar');
const workshop = qs('#workshop');
const gameover = qs('#gameover');
const canvas = qs('#glcanvas');
const reticle = qs('#reticle');
const flash = qs('#flash');
const pops = qs('#pops');

const els = {
  altitude: qs('#altitude'),
  airspeed: qs('#airspeed'),
  distance: qs('#distance'),
  coins: qs('#coins'),
  multiplier: qs('#multiplier'),
  boostFill: qs('#boost-fill'),
  boostLabel: qs('#boost-label'),
  chargeFill: qs('#charge-fill'),
  powermeter: qs('#powermeter'),
  pullup: qs('#pullup'),
};

/* ---------- render loop ---------- */
function loop(t) {
  const dt = Math.min((t - prevTime) / 1000, 1 / 30);
  prevTime = t;
  game.frame(dt);
  updateHUD(dt);
  requestAnimationFrame(loop);
}

/* ---------- HUD ---------- */
function updateHUD(dt) {
  const s = game.getStats();
  const flying = s.phase === PHASE.FLYING || s.phase === PHASE.LAUNCHING;
  hud.style.display = flying ? 'block' : 'none';
  els.altitude.textContent = `${s.altitude}`;
  els.airspeed.textContent = `${s.speed}`;
  els.distance.textContent = `${s.distance} m`;
  els.coins.textContent = `${s.coins}`; // run coins earned this flight (bank persists on crash)
  els.multiplier.textContent = `x${s.multiplier.toFixed(1)}`;

  // boost bar
  const bp = Math.round(s.boost * 100);
  els.boostLabel.textContent = `${bp}%`;
  els.boostFill.style.width = `${s.boost * 100}%`;
  els.boostFill.className = `h-full rounded-full transition-all ` +
    (s.boost < 0.25 ? 'bg-gradient-to-r from-red-400 to-amber-400' :
     s.boost < 0.6 ? 'bg-gradient-to-r from-amber-400 to-yellow-300' :
     'bg-gradient-to-r from-cyan-400 to-amber-400');

  // launch power meter
  els.powermeter.style.display = s.phase === PHASE.LAUNCHING ? 'flex' : 'none';
  const charge = Math.min(s.launchCharge, 1);
  els.chargeFill.style.width = `${charge * 100}%`;
  if (s.launchCharge > 1) {
    els.chargeFill.classList.add('animate-pulse', 'bg-red-400');
    els.chargeFill.classList.remove('bg-gradient-to-r', 'from-amber-400', 'to-cyan-400');
    els.chargeFill.classList.add('bg-red-400');
  } else {
    els.chargeFill.classList.remove('animate-pulse');
    els.chargeFill.className = 'h-full rounded-full meter-swing transition-all bg-gradient-to-r from-amber-400 to-cyan-400';
    els.chargeFill.style.width = `${charge * 100}%`;
  }

  // PULL UP warning
  els.pullup.style.display = s.pullingUp && s.phase === PHASE.FLYING ? 'block' : 'none';
  if (s.pullingUp) els.pullup.classList.add('animate-pulse');
  else els.pullup.classList.remove('animate-pulse');

  // reticle
  reticle.style.display = flying ? 'block' : 'none';

  document.body.classList.toggle('fly-cursor', s.phase === PHASE.FLYING);
}

/* ---------- mouse tracking for reticle ---------- */
function trackMouse() {
  let mx = 0, my = 0;
  window.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    reticle.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%) rotate(45deg)`;
  });
  return () => ({ x: mx, y: my });
}
const mousePos = trackMouse();

/* ---------- screen helpers ---------- */
function show(el) { el.classList.remove('hidden'); el.classList.add('flex'); }
function hide(el) { el.classList.add('hidden'); el.classList.remove('flex'); }
function goto(s) {
  if (screen === 'workshop') disposePreview();
  screen = s;
  hide(title); hide(hangar); hide(workshop); hide(gameover);
  hide(pops);
  switch (s) {
    case 'title': show(title); break;
    case 'hangar': show(hangar); prepHangar(); break;
    case 'workshop': show(workshop); prepWorkshop(); break;
    case 'gameover': show(gameover); break;
    case 'flying': /* HUD shown via updateHUD */ break;
  }
  if (game) game.resize();
}

function setScreen(s) {
  goto(s);
  if (s === 'flying') {
    // reveal the in-flight HUD immediately
    hud.style.display = 'block';
  }
}

/* ---------- title ---------- */
function initTitle() {
  qs('#btn-play').addEventListener('click', () => {
    goto('flying');
    game.beginLaunch();
  });
  qs('#btn-quit').addEventListener('click', () => {
    // soft reset: clear local save (no .env involved) and reload
    localStorage.removeItem('paper_glider_save');
    location.reload();
  });
}

/* ---------- hangar ---------- */
function prepHangar() {
  const grid = qs('#hangar-grid');
  grid.innerHTML = '';
  const sv = loadSave();
  PLANES.forEach((p) => {
    const unlocked = sv.unlockedPlanes.includes(p.id);
    const equipped = sv.equippedPlane === p.id;
    const card = document.createElement('div');
    card.className = 'glass-panel p-4 rounded-2xl relative group';
    card.innerHTML = `
      <div class="text-center">
        <div class="font-bold text-lg text-amber-300">${p.name}</div>
        <div class="text-cyan-300/60 text-xs mb-2">Cost: ${p.cost}</div>
        <div class="flex justify-center gap-2 text-xs mb-2">
          <span title="Speed">✈ ${p.stats.speed}</span>
          <span title="Handling">🎯 ${p.stats.handling}</span>
          <span title="Lift">⬆ ${p.stats.lift}</span>
          <span title="Boost">⚡ ${p.stats.boost}</span>
          <span title="Coin">🔸 ${p.stats.coins.toFixed(1)}</span>
        </div>
        <button data-id="${p.id}" class="buy-btn ${unlocked ? 'btn-ghost' : 'btn-confirm'} w-full text-sm">
          ${!unlocked ? (sv.coins >= p.cost ? 'UNLOCK' : `LOCKED • ${p.cost}`) : (equipped ? 'EQUIPPED' : 'EQUIP')}
        </button>
        ${!unlocked ? '<div class="absolute inset-0 rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center text-cyan-300/40 text-xs">LOCKED</div>' : ''}
      </div>
    `;
    grid.appendChild(card);
    const btn = card.querySelector('.buy-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!unlocked) {
        if (sv.coins >= p.cost) {
          unlockPlane(p.id); sv.unlockedPlanes.push(p.id); sv.coins -= p.cost; save(sv);
          goto('hangar'); prepHangar();
        }
        return;
      }
      if (!equipped) {
        equipPlane(p.id); sv.equippedPlane = p.id; save(sv);
        game.save = sv;
        goto('hangar'); prepHangar();
      }
    });
  });
}

/* ---------- workshop ---------- */
let preview = null;
let previewAuto = 0;
let previewTarget = { yaw: 0, pitch: 0 };
let previewManual = false;
let previewT = 0;
let _workshopWired = false;

function disposePreview() {
  if (previewAuto) { cancelAnimationFrame(previewAuto); previewAuto = 0; }
  if (preview) {
    preview.plane.dispose();
    preview.renderer.dispose();
    preview = null;
  }
}

function buildPreview(planeId) {
  disposePreview(); // clean any prior
  const c = qs('#preview');
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(272, 272);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  cam.position.set(0, 0.6, 2.6);
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(2, 3, 1);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0x404060, 0.8));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 0.5));
  // simple ground disc for context
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 0.1, 32),
    new THREE.MeshStandardMaterial({ color: 0x0f1729, roughness: 0.7, metalness: 0.2, toneMapped: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.9;
  scene.add(disc);

  const sv = loadSave();
  const cos = sv.customizations[planeId] || {};
  const planeDef = PLANES.find((p) => p.id === planeId) || PLANES[0];
  const plane = new Airplane({ scene, cosmetics: cos });
  plane.setStats(planeDef.stats);
  plane.position.set(0, 0.2, 0);
  scene.add(plane.mesh);

  preview = { renderer, scene, cam, plane, disc };
  if (!previewAuto) previewAuto = requestAnimationFrame(previewLoop);
}

function previewLoop(t) {
  previewT = t;
  if (preview) {
    if (!previewManual) previewTarget.yaw += 0.24 * 0.016;
    const mesh = preview.plane.mesh;
    mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, previewTarget.yaw, 10, 0.016);
    mesh.rotation.x = THREE.MathUtils.damp(mesh.rotation.x, previewTarget.pitch, 8, 0.016);
    preview.renderer.render(preview.scene, preview.cam);
    previewAuto = requestAnimationFrame(previewLoop);
  }
}

function prepWorkshop() {
  const sv = loadSave();
  const id = sv.equippedPlane;
  const cos = sv.customizations[id] || {};
  // populate selects
  const pat = qs('#w-pattern'), fin = qs('#w-finish'), con = qs('#w-contrail');
  [PATTERNS, FINISHES, CONTRAILS].forEach((list, i) => {
    const sel = [pat, fin, con][i];
    sel.innerHTML = '';
    list.forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      o.selected = (v === (i === 0 ? cos.pattern : i === 1 ? cos.finish : cos.contrail));
      sel.appendChild(o);
    });
  });
  qs('#w-primary').value = cos.primary || '#fb9233';
  qs('#w-secondary').value = cos.secondary || '#1e293b';
  buildPreview(id);

  const applyLive = () => {
    const patch = {
      primary: qs('#w-primary').value,
      secondary: qs('#w-secondary').value,
      pattern: qs('#w-pattern').value,
      finish: qs('#w-finish').value,
      contrail: qs('#w-contrail').value,
    };
    setCustomization(id, patch);          // persist
    if (preview) preview.plane.applyCosmetics(patch);  // instant canvas texture regen
  };
  if (!_workshopWired) {
    _workshopWired = true;
    [qs('#w-primary'), qs('#w-secondary'), pat, fin, con].forEach((el) => {
      el.addEventListener('input', () => { previewManual = true; applyLive(); });
      el.addEventListener('change', () => { previewManual = false; applyLive(); });
    });
    const pc = qs('#preview');
    let down = false, lx = 0, ly = 0;
    pc.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { down = false; });
    window.addEventListener('pointermove', (e) => {
      if (!down || !preview) return;
      previewTarget.yaw += (e.clientX - lx) * 0.005;
      previewTarget.pitch += (e.clientY - ly) * 0.005;
      previewTarget.pitch = THREE.MathUtils.clamp(previewTarget.pitch, -0.6, 0.6);
      lx = e.clientX; ly = e.clientY;
      previewManual = true;
    });
    qs('#btn-workshop-apply').addEventListener('click', () => {
      game.refreshCosmetics();
      goto('title');
    });
    qs('#btn-workshop-back').addEventListener('click', () => goto('title'));
  }
}

/* ---------- game over ---------- */
function showGameOver(tally) {
  qs('#go-distance').textContent = `${tally.distance} m`;
  qs('#go-airtime').textContent = `${tally.airTime} s`;
  qs('#go-rings').textContent = `${tally.rings}`;
  qs('#go-coins').textContent = `+${tally.coins}`;
  qs('#go-highscore').innerHTML = tally.best
    ? `<span class="text-amber-300">★ NEW RECORD DISTANCE</span>`
    : `Best: ${tally.highScore} m • ${tally.totalCoins} coins total`;
  goto('gameover');
  // flash + shake
  flash.style.opacity = '0.85';
  setTimeout(() => { flash.style.opacity = '0'; }, 450);
}

/* ---------- pop-up numbers ---------- */
function spawnPop({ x, y, value }) {
  const el = document.createElement('div');
  el.className = 'pop-num fixed text-2xl font-bold pointer-events-none';
  el.textContent = value;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = '#fb9233';
  el.style.textShadow = '0 0 8px #000,0 0 16px #fff';
  pops.appendChild(el);
  setTimeout(() => pops.removeChild(el), 900);
}

/* ---------- boot ---------- */
function boot() {
  game = new Game({ canvas });
  game.startTitle();
  initTitle();
  qs('#btn-hangar').addEventListener('click', () => goto('hangar'));
  qs('#btn-workshop').addEventListener('click', () => goto('workshop'));
  // crash listener
  window.addEventListener('pg:crash', (e) => {
    game.save = loadSave();
    showGameOver(e.detail);
  });
  window.addEventListener('pg:pop', (e) => spawnPop(e.detail));
  window.addEventListener('pg:flash', (e) => {
    flash.style.opacity = '0.9';
    setTimeout(() => { flash.style.opacity = '0'; }, e.detail.duration || 450);
  });
  qs('#btn-restart').addEventListener('click', () => {
    game.beginLaunch();
    goto('flying');
  });
  qs('#btn-go-hangar').addEventListener('click', () => goto('hangar'));

  // unlock first hidden plane for immediate progression demo
  const sv = loadSave();
  requestAnimationFrame(loop);
}

window.addEventListener('load', boot);
