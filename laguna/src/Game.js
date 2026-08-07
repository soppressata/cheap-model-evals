/**
 * Game.js — render loop, state machine, chunk/feature management, collision
 * and scoring. Owns the Three.js renderer; the UI lives in HTML overlays
 * that main.js updates by reading Game's getters each frame.
 */
import * as THREE from 'three';
import { Terrain } from './world/Terrain.js';
import { Environment } from './world/Environment.js';
import { Features } from './world/Features.js';
import { Airplane } from './player/Airplane.js';
import { ParticleSystem } from './systems/Particles.js';
import { AudioEngine } from './systems/AudioEngine.js';
import { loadSave, updateStats, PLANES, FINISH_PARAMS, CONTRAIL_COLORS } from './systems/Storage.js';

export const PHASE = {
  TITLE: 'title',
  LAUNCHING: 'launching',
  FLYING: 'flying',
  CRASHED: 'crashed',
};

export class Game {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.phase = PHASE.TITLE;
    this.save = loadSave();

    // renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.shadowMap.enabled = false; // perf: no shadow maps
    this.renderer.shadowMap.enabled = false; // perf: no shadow maps

    // scene + camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.5, 4000);
    this.camera.position.set(0, 12, -22);

    this.clock = new THREE.Clock();
    this._raf = 0;

    // systems
    this.terrain = new Terrain({ scene: this.scene, biomeKey: 'SUNSET_CANYON' });
    this.env = new Environment({ scene: this.scene, camera: this.camera });
    this.features = new Features({ scene: this.scene, terrain: this.terrain });
    this.particles = new ParticleSystem({ scene: this.scene, capacity: 1024 });
    this.audio = new AudioEngine();

    // flight state
    this.airplane = null;
    this._mouse = new THREE.Vector2(0, 0);
    this._boost = false;
    this._launchHold = 0;
    this._launchCharge = 0;

    // scoring
    this.distance = 0;
    this.airTime = 0;
    this.ringsCollected = 0;
    this.combo = 0;
    this.comboTimer = 0;
    const COMBO_WINDOW = 1.2; // seconds to keep the chain alive between rings
    this._comboWindow = COMBO_WINDOW;
    this.multiplier = 1.0;
    this.coinsEarned = 0;

    // title orbit
    this._orbit = 0;
    this._shake = 0;
    this._lastW = 0;
    this._lastH = 0;

    this._fit();            // size to the canvas (layout may not be ready in ctor)
    this._bindHandlers();
  }

  _fit() {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    if (w === this._lastW && h === this._lastH && this.camera.aspect) return;
    this._lastW = w; this._lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _bindHandlers() {
    window.addEventListener('resize', () => this._fit());
    // primary click/tap = boost (mid-flight) or launch charge (while held)
    this.canvas.parentElement?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.phase === PHASE.LAUNCHING) { this._chargePressed = true; return; }
      if (this.phase === PHASE.FLYING) { this._boost = true; this._boostByUser = true; }
    });
    const releasePointer = (e) => {
      if (this.phase === PHASE.LAUNCHING && this._chargePressed) {
        this._chargePressed = false;
        this.throw();
      }
      this._boost = false;
      this._boostByUser = false;
      this._pointerDown = false;
    };
    window.addEventListener('mouseup', releasePointer);
    window.addEventListener('mouseleave', releasePointer);
    window.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this._mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this._mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this._mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.phase === PHASE.TITLE) return;
        if (this.phase === PHASE.LAUNCHING) { this._chargePressed = true; return; }
        if (this.phase === PHASE.FLYING) { this._boost = true; this._boostByUser = true; }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.phase === PHASE.LAUNCHING && this._chargePressed) {
          this._chargePressed = false;
          this.throw();
        }
        this._boost = false;
        this._boostByUser = false;
      }
    });
  }

  /* ---------- public configuration ---------- */
  configurePlane() {
    const s = this.save;
    const planeDef = PLANES.find((p) => p.id === s.equippedPlane) || PLANES[0];
    const cos = s.customizations[s.equippedPlane] || {};
    if (this.airplane) this.airplane.dispose();
    this.airplane = new Airplane({ scene: this.scene, cosmetics: cos });
    this.airplane.setStats(planeDef.stats);
    this.airplane.startLaunchHold();
    // place at spawn above the valley
    const spawnY = this.terrain.getHeight(0, 5) + 14;
    this.airplane.position.set(0, spawnY, 5);
    this.airplane.forward.set(0, 0.05, 1).normalize();
    this.airplane.state = 'launching';
  }

  setBiome(key) {
    this.terrain.setBiome(key);
    this.features.setBiome(key);
    this.env.setBiome(key);
    this.configurePlane();
  }

  refreshCosmetics() {
    this._reloadSave();
    if (this.airplane) {
      this.airplane.applyCosmetics(this.save.customizations[this.save.equippedPlane] || {});
    }
  }

  /* ---------- high-level state entry points (called by main.js) ---------- */
  startTitle() {
    this.phase = PHASE.TITLE;
    this._orbit = 0;
    this._shake = 0;
    this._reloadSave();
    this.configurePlane();   // place a glider on the valley for the title card
    if (this.airplane) this.airplane.state = 'idle';
    // ensure terrain exists under the spawn
    this.terrain.update(new THREE.Vector3(0, 0, 5));
    this.features.update(new THREE.Vector3(0, 0, 5));
  }

  beginLaunch() {
    this.phase = PHASE.LAUNCHING;
    this._reloadSave();
    this._launchHold = 0;
    this._launchCharge = 0;
    this.distance = 0;
    this.airTime = 0;
    this.ringsCollected = 0;
    this.combo = 0;
    this.multiplier = 1.0;
    this.coinsEarned = 0;
    this._chargePressed = false;
    if (this.airplane) {
      this.configurePlane(); // fresh plane at spawn
      this.airplane.state = 'launching';
    }
  }

  _reloadSave() {
    try { this.save = loadSave(); } catch { /* keep current */ }
  }

  // called each frame during LAUNCHING: returns clamped charge in [0,1]
  getLaunchCharge() {
    // charge peaks at 1.0 at ~1.2s; meter swings (overshoot flash) for polish
    const t = Math.min(this._launchHold / 1.2, 1);
    return t;
  }

  throw() {
    if (!this.airplane) return;
    const charge = THREE.MathUtils.clamp(this._launchCharge, 0.2, 1);
    this.airplane.launch(charge);
    this.phase = PHASE.FLYING;
    this.airplane.state = 'flying';
    this.airTime = 0;
    this.distance = 0;
    this._boost = false;
    this.audio.resume();
    this.audio.startBoost(false);
  }

  startFlight() { if (this.phase === PHASE.LAUNCHING) this.throw(); }
  restartCrashed() {
    this.beginLaunch();
  }

  /* ---------- frame loop (called by main.js rAF) ---------- */
  frame(dt) {
    this._fit();
    const delta = Math.min(dt, 1 / 30); // clamp spikes
    if (this.phase === PHASE.TITLE) {
      this._updateTitle(delta);
    } else if (this.phase === PHASE.LAUNCHING) {
      this._updateLaunching(delta);
    } else if (this.phase === PHASE.FLYING) {
      this._updateFlying(delta);
    } else if (this.phase === PHASE.CRASHED) {
      this._updateCrashed(delta);
    }
    this.env.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  _updateTitle(delta) {
    this._orbit += delta * 0.18;
    const r = 58;
    const focus = new THREE.Vector3(0, this.terrain.getHeight(0, 5) + 6, 5);
    this.camera.position.lerp(
      new THREE.Vector3(
        Math.sin(this._orbit) * r,
        16 + Math.cos(this._orbit * 0.5) * 4,
        Math.cos(this._orbit) * r,
      ).add(focus).clone(),
      0.06,
    );
    this.camera.lookAt(focus);
    // gentle, stable terrain under the spawn for the title card
    this.terrain.update(new THREE.Vector3(0, 0, 5));
    this.features.update(new THREE.Vector3(0, 0, 5));
    if (this.airplane && this.airplane.mesh) {
      this.airplane.mesh.rotation.y = this._orbit * 0.5;
      this.airplane.mesh.position.copy(this.airplane.position);
    }
  }

  _updateLaunching(delta) {
    if (this._chargePressed) {
      this._launchHold += delta;
      this._launchHold = Math.min(this._launchHold, 3.0);
    }
    // charge swings: ramps to 1 at 1.2s, then overshoots slightly to 1.15
    const t = this._launchHold / 1.2;
    this._launchCharge = t > 1 ? 1 + 0.15 * Math.min((t - 1), 1) * (1 - (t - 1)) : t;
    this._launchCharge = THREE.MathUtils.clamp(this._launchCharge, 0, 1.15);
    // steer aim while charging
    if (this.airplane && this.airplane.state === 'launching') {
      this.airplane.setMouse(this._mouse);
      this.airplane.update(delta, this.camera);
      this._cameraOrbitLook(this.airplane.position, delta);
    }
  }

  _cameraOrbitLook(target, dt) {
    // over-the-shoulder follow during the launch aim (uses forward vector)
    const f = this.airplane.forward;
    const offset = new THREE.Vector3(-f.x, 0, -f.z).multiplyScalar(14);
    offset.y = 5 + f.y * 3;
    const desired = new THREE.Vector3().addVectors(target, offset);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(target);
  }

  _updateFlying(delta) {
    if (!this.airplane) return;
    this.airplane.setBoost(this._boost && this.airplane.boostRatio > 0.02);
    this.airplane.setMouse(this._mouse);
    this.airplane.update(delta, this.camera);

    const p = this.airplane.position;
    this.terrain.update(p);
    this.features.update(p);
    this.features.tick(delta);

    // audio
    this.audio.setWind(this.airplane.horizontalSpeed);
    this.audio.setBoostLevel(this.airplane._boosting ? this.airplane.boostRatio : 0);
    if (this.airplane._boosting) this.audio.startBoost(); else this.audio.stopBoost();
    if (this.airplane._boosting) this.particles.emitTrail(p, this.airplane.forward, 3);
    this.particles.update(delta);

    // scoring & rings
    this._ringLogic(delta);
    this.airTime += delta;
    this.distance += this.airplane.horizontalSpeed * delta;
    this.coinsEarned += (this.airplane.horizontalSpeed * 0.02) * delta * (this.airplane.stats.coins || 1);

    // camera chase
    this._chaseCamera(delta);

    // crash checks
    this._crashCheck();
  }

  _ringLogic(delta) {
    const collected = this.features.checkRings(this.airplane.position);
    for (const r of collected) {
      this.ringsCollected++;
      this.combo++;
      this.comboTimer = this._comboWindow;
      this.multiplier = 1.0 + 0.5 * Math.min(this.combo, 2);
      const gained = Math.round(6 * this.multiplier * (this.airplane.stats.coins || 1));
      this.coinsEarned += gained;
      this.audio.playRing();
      this.particles.burst({ type: 'spark', origin: r.pos, count: 10, color: 0xf59e0b, speed: 6, lifetime: 0.5 });
      const popPos = this._mousePx || { x: 480, y: 270 };
      window.dispatchEvent(new CustomEvent('pg:pop', { detail: { x: popPos.x, y: popPos.y, value: `x${this.multiplier.toFixed(1)}` } }));
      this._pop = { x: popPos.x, y: popPos.y, value: `x${this.multiplier.toFixed(1)}`, t: 0.9 };
    }
    // decrement combo timer; missing a ring = timer expires
    if (this.combo > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.multiplier = 1.0;
      }
    }
    // rings that pass behind us unmarked count as "missed" -> reset combo
    if (this.features.markMissed(this.airplane.position.z)) {
      this.combo = 0;
      this.multiplier = 1.0;
    }
  }

  _chaseCamera(delta) {
    const p = this.airplane.position;
    const f = this.airplane.forward;
    const up = new THREE.Vector3(0, 1, 0);
    const behind = new THREE.Vector3().reflect(f, up); // -f with y preserved? use -f.y negated
    // behind+above relative to plane, in world space
    const offset = new THREE.Vector3(-f.x, 0, -f.z).multiplyScalar(16); // 16m behind (horizontal)
    offset.y = 7 + f.y * 4; // sit above, lift with nose
    const desired = new THREE.Vector3().addVectors(p, offset);
    this.camera.position.lerp(desired, 0.09);
    const lookAhead = new THREE.Vector3().copy(f).multiplyScalar(6);
    this.camera.lookAt(p.clone().add(lookAhead).add(new THREE.Vector3(0, 2, 0)));
    // FOV kick on boost
    const targetFov = this.airplane._boosting ? 68 : 60;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.12);
    this.camera.updateProjectionMatrix();
  }

  // --- terrain collision (heightfield) + obstacle collision ---
  _crashCheck() {
    if (!this.airplane || this.airplane.state !== 'flying') return;
    const p = this.airplane.position;
    const groundH = this.terrain.getHeight(p.x, p.z);
    const clearance = 1.6;
    if (p.y < groundH + clearance) {
      this._doCrash('terrain');
      return;
    }
    if (this.features.checkObstacles(p, 1.2)) {
      this._doCrash('obstacle');
    }
  }

  _doCrash(kind) {
    if (this.phase !== PHASE.FLYING) return;
    this.phase = PHASE.CRASHED;
    this.airplane.state = 'crashed';
    this._boost = false;
    this.airplane._boosting = false;
    this._shake = 0.55;
    // white flash + particles + sound
    this.particles.burst({ type: 'spark', origin: this.airplane.position.clone(), count: 80, color: 0xffffff, speed: 18, lifetime: 0.6, gravity: 0.2 });
    this.particles.burst({ type: 'boost', origin: this.airplane.position.clone(), count: 40, color: 0xff7d00, speed: 10, lifetime: 0.5 });
    this.audio.playCrash();
    this.audio.stopBoost();
    this.audio.setWind(0);
    this.env.sunSprite.material.opacity = 1;
    // white flash + tally dispatched to the UI layer
    window.dispatchEvent(new CustomEvent('pg:flash', { detail: { duration: 450 } }));
    const tally = this._finalizeScore();
    window.dispatchEvent(new CustomEvent('pg:crash', { detail: tally }));
  }

  _finalizeScore() {
    const gained = Math.floor(this.coinsEarned);
    const s = this.save;
    s.coins = (s.coins || 0) + gained;
    s.coinsEarnedThisRun = gained;
    // persist bests
    let best = false;
    if (this.distance > s.highScore) { s.highScore = Math.floor(this.distance); best = true; }
    if (this.airTime > s.highTime) s.highTime = Math.floor(this.airTime);
    if (this.ringsCollected > s.bestRings) s.bestRings = this.ringsCollected;
    try { localStorage.setItem('paper_glider_save', JSON.stringify(s)); } catch { /* noop */ }
    return {
      distance: Math.floor(this.distance),
      airTime: Math.floor(this.airTime),
      rings: this.ringsCollected,
      coins: gained,
      totalCoins: s.coins,
      highScore: s.highScore,
      multiplier: this.multiplier,
      best,
    };
  }

  _updateCrashed(delta) {
    if (this._shake > 0) {
      const k = this._shake / 0.55;
      this._shake -= delta;
      const amp = 0.6 * k * k;
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
      this.camera.position.z += (Math.random() - 0.5) * amp;
      this.particles.update(delta);
    }
    if (this._shake <= 0) {
      // idle render keeps the wreckage still
      this.particles.update(delta);
    }
  }

  getStats() {
    const p = this.airplane;
    const ground = p ? this.terrain.getHeight(p.position.x, p.position.z) : 0;
    const aheadZ = p ? p.position.z + p.forward.z * 16 : 0;
    const aheadX = p ? p.position.x + p.forward.x * 16 : 0;
    const groundAhead = this.terrain.getHeight(aheadX, aheadZ);
    const pullingUp = p ? (p.position.y - groundAhead < 9) : false;
    return {
      phase: this.phase,
      altitude: p ? Math.max(0, Math.round(p.position.y - ground)) : 0,
      speed: p ? Math.round(p.horizontalSpeed) : 0,
      airspeed: p ? Math.round(p.speed) : 0,
      distance: Math.round(this.distance),
      airTime: Math.round(this.airTime),
      rings: this.ringsCollected,
      multiplier: this.multiplier,
      coins: Math.floor(this.coinsEarned),
      boost: p ? p.boostRatio : 0,
      pullingUp: pullingUp,
      launchCharge: this._launchCharge,
      orbit: this._orbit,
      pop: this._pop,
    };
  }

  /* ---------- lifecycle ---------- */
  resize() {
    this._lastW = 0; this._lastH = 0; // force a re-fit
    this._fit();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.terrain.dispose();
    this.env.dispose();
    this.features.dispose();
    this.particles.dispose();
    this.airplane?.dispose();
    this.renderer.dispose();
  }
}
