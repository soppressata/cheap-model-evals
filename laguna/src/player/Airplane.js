/**
 * Airplane.js — procedurally generated low-poly glider + arcade flight physics.
 *
 * Flight model (arcade momentum):
 *   * constant forward motion along `forwardDir`
 *   * gravity pulls the plane down (terminal via vertical drag)
 *   * pitching the nose up => wings generate lift (gain altitude, bleed speed)
 *   * pitching the nose down => trade altitude for speed (dive acceleration)
 *   * boost injects a large forward thrust at the cost of a regenerating meter
 *
 * Steering: a 2D reticle follows the mouse; the 3D nose smoothly interpolates
 * toward the reticle's projected world coordinate (handled in Game via input).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Contrail } from './Trails.js';
import { createCosmetics } from './Cosmetics.js';

/* flight constants (tuned for a floaty-but-responsive arcade feel) */
const GRAVITY = 7.0;
const VERT_DRAG = 0.8;           // -> terminal descent ~ 8.75 m/s
const GLIDE_TRIM = 17;           // speed the glider naturally settles near
const SPD_DRAG = 0.25;            // gentle drag when above trim
const LIFT_BASE = 10;            // lift coefficient
const ENERGY_COUPLE = 0.10;      // falling => speed (altitude-to-speed trade)
const CLIMB_BURN = 2.6;          // climbing bleeds speed
const DIVE_GAIN = 4.0;           // diving adds speed
const MIN_SPEED = 6;
export const MAX_SPEED_BASE = 20;
export const BOOST_THRUST = 48;
export const BOOST_CAP = 72;
const PITCH_LIMIT = 1.15;        // ~66deg up/down
const TURN_RATE_0 = 2.0;         // rad/s at handling=5
const TURN_PER_HANDLING = 0.45;

const _Z_AXIS = new THREE.Vector3(0, 0, 1);

export const CONTRAIL_COLORS = {
  ribbon: '#fb9233',
  spark: '#f59e0b',
  neon: '#06b6d4',
};

export class Airplane {
  constructor({ scene, gl, cosmetics }) {
    this.scene = scene;
    this.gl = gl;

    this.cosmetics = { ...cosmetics };
    this.stats = { speed: 5, handling: 5, lift: 5, boost: 5, coins: 1.0 };
    this.position = new THREE.Vector3(0, 12, 0);   // spawn above the valley
    this.forward = new THREE.Vector3(0, -0.15, 1).normalize();
    this.velocity = new THREE.Vector3();
    this.spd = GLIDE_TRIM;        // forward speed
    this.vy = 0;                  // vertical velocity

    this.state = 'idle'; // idle | launching | flying | crashed
    this.boostMeter = 1.0;
    this._boosting = false;

    // input mirror
    this._mouse = new THREE.Vector2(0, 0);
    this._boostDown = false;
    this._launchHold = 0;         // seconds held for charge

    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();

    this._buildMesh();
    this._buildTrails();
  }

  setStats(stats) {
    this.stats = { ...stats };
    this._rebuildMesh();
    return this;
  }

  /* ---------- procedural geometry ---------- */
  _geometry() {
    const s = this.stats;
    const span = 0.6 + 0.05 * s.handling;
    const chord = 0.45 + 0.032 * s.lift;
    const length = 0.9 + 0.06 * s.speed;
    const keel = 0.22 + 0.028 * s.lift;
    const tip = 0.1 + 0.016 * s.handling;
    const wingT = 0.07;

    const parts = [];

    // Fuselage: pointed cone (nose forward = +Z). Squash the depth so the body
    // is a thin vertical ridge (paper glider aesthetic).
    const fuseGeo = new THREE.ConeGeometry(keel * 0.55, length, 8, 1);
    const mF = new THREE.Matrix4()
      .makeRotationX(Math.PI / 2)          // apex +Y -> +Z (nose forward)
      .scale(new THREE.Vector3(1, 1, 0.28)); // thin in local-Z (-> world-Y thinness)
    fuseGeo.applyMatrix4(mF);
    parts.push(fuseGeo);

    // Main wing: flat plate riding the ridge.
    const wingGeo = new THREE.BoxGeometry(span * 2, wingT, chord);
    wingGeo.translate(0, keel * 0.72, 0);
    parts.push(wingGeo);

    // Winglets: small cones at each tip, leaned back/up.
    const wingletGeo = new THREE.ConeGeometry(tip, tip * 2.2, 5, 1);
    wingletGeo.translate(0, 0, 0); // apex up
    wingletGeo.applyMatrix4(
      new THREE.Matrix4().makeRotationX(0.8)
    );
    const wlL = wingletGeo.clone().translate(-span, keel * 0.72, 0);
    const wlR = wingletGeo.clone().translate(span, keel * 0.72, 0);
    parts.push(wlL, wlR);

    // Vertical stabilizer at the tail.
    const finGeo = new THREE.BoxGeometry(tip * 1.4, keel * 1.5, 0.08);
    finGeo.translate(0, keel * 0.9, -length / 2 + chord * 0.5);
    parts.push(finGeo);

    // Horizontal stabilizer.
    const stabGeo = new THREE.BoxGeometry(span * 0.45, 0.09, 0.36);
    stabGeo.translate(0, keel, -length / 2 + chord * 0.2);
    parts.push(stabGeo);

    const merged = mergeGeometries(parts, false);
    merged.computeVertexNormals();
    return merged;
  }

  _material() {
    const { texture, params, color } = createCosmetics(this.cosmetics);
    const opts = {
      map: texture,
      roughness: params.roughness,
      metalness: params.metalness,
      toneMapped: false,
    };
    const finish = this.cosmetics.finish;
    if (finish === 'glitch') {
      opts.emissive = new THREE.Color(params.emissive);
      opts.emissiveIntensity = params.emissiveIntensity;
      opts.emissiveMap = texture;
    } else if (finish === 'foil') {
      opts.clearcoat = 0.4;
      opts.clearcoatRoughness = 0.05;
    } else if (finish === 'neon') {
      opts.emissive = new THREE.Color(color);
      opts.emissiveIntensity = 0.35;
    }
    return new THREE.MeshPhysicalMaterial(opts);
  }

  _buildMesh() {
    const geo = this._geometry();
    const mat = this._material();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
  }

  _rebuildMesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.scene.remove(this.mesh);
    }
    this._buildMesh();
  }

  /* ---------- contrails ---------- */
  _buildTrails() {
    const c = new THREE.Color('#f59e0b');
    const con = CONTRAIL_COLORS[this.cosmetics.contrail || 'ribbon'] || CONTRAIL_COLORS.ribbon;
    this.leftTrail = new Contrail({
      scene: this.scene, color: con, length: 44, width: 0.26, life: 1.5,
    });
    this.rightTrail = new Contrail({
      scene: this.scene, color: con, length: 44, width: 0.26, life: 1.5,
    });
    this._recomputeWingtips();
  }

  _recomputeWingtips() {
    const s = this.stats;
    const span = 0.6 + 0.05 * s.handling;
    const keel = 0.22 + 0.028 * s.lift;
    this._wingLeftLocal = new THREE.Vector3(-span, 0.72 * keel, 0);
    this._wingRightLocal = new THREE.Vector3(span, 0.72 * keel, 0);
  }

  /* ---------- state / launch ---------- */
  startLaunchHold() {
    this._launchHold = 0;
    this.state = 'launching';
  }

  holdLaunch(dt) {
    this._launchHold += dt;
  }

  launch(power) {
    // power in [0,1]: charge strength -> initial speed boost
    this.state = 'flying';
    this.spd = GLIDE_TRIM * (0.6 + 0.9 * power);
    this.vy = 2.2;                       // initial upward kick
    this.forward.set(0, 0.05, 1).normalize(); // slight nose-up starter
    this._boosting = false;
    this.boostMeter = Math.min(1, this.boostMeter + 0.1);
    return this.spd;
  }

  setLaunchAim(forward) {
    this.forward.copy(forward).normalize();
  }

  /* ---------- input mirror (called each frame by Game) ---------- */
  setMouse(ndc) {
    this._mouse.x = ndc.x;
    this._mouse.y = ndc.y;
  }

  setBoost(active) {
    if (active && !this._boosting) this.startBoost();
    if (!active) this.stopBoost();
    this._boostDown = active;
  }

  startBoost() {
    this._boosting = true;
  }

  stopBoost() {
    this._boosting = false;
  }

  triggerBoost() { /* alias */ this._boosting = true; }

  /* ---------- physics step ---------- */
  update(dt, camera) {
    if (this.state === 'idle') return;
    if (this.state === 'launching') {
      // aim the nose at the reticle while charging; the body stays put
      this._steer(dt, camera);
      this._applyPosition();
      return;
    }
    if (this.state === 'flying') {
      this._steer(dt, camera);
      this._fly(dt);
      this._stepBoost(dt);
      this._updateTrails(dt);
      this._applyPosition();
    }
  }

  _steer(dt, camera) {
    // Build a world-space steering target from the camera basis + mouse NDC.
    const cam = camera;
    const camForward = new THREE.Vector3();
    cam.getWorldDirection(camForward);
    camForward.y = 0;
    camForward.normalize();
    const camRight = new THREE.Vector3().crossVectors(this._up, camForward).normalize();

    const dist = 22;
    const target = this._tmp
      .copy(this.position)
      .addScaledVector(camForward, dist)
      .addScaledVector(camRight, this._mouse.x * dist * 0.85)
      .addScaledVector(this._up, this._mouse.y * dist * 0.85); // mouse-up => nose-up (Y was inverted)

    const desired = new THREE.Vector3().subVectors(target, this.position).normalize();
    // clamp the nose to a sane pitch cone (no straight up/down)
    const horiz = Math.hypot(desired.x, desired.z);
    if (horiz > 1e-4) {
      const yaw = Math.atan2(desired.x, desired.z);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(desired.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
      desired.set(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
    } else {
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(desired.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
      desired.set(0, Math.sin(pitch), Math.cos(pitch));
    }

    const turnRate = TURN_RATE_0 + TURN_PER_HANDLING * this.stats.handling;
    const k = 1 - Math.exp(-turnRate * dt); // smooth slerp toward the target
    this.forward.lerp(desired, k);
    this.forward.normalize();
    // cosmetic bank: tilt the wings slightly into turns
    this._bank = THREE.MathUtils.damp(this._bank || 0, desired.x * 0.35, 3, dt);
  }

  _applyPosition() {
    this.mesh.position.copy(this.position);
    // orient the nose (local +Z) along `forward`, then roll about that axis.
    this._q.setFromUnitVectors(_Z_AXIS, this.forward); // base: +Z -> forward
    this._q2.setFromAxisAngle(this.forward, this._bank || 0); // roll
    this._q.multiplyQuaternions(this._q, this._q2);
    this.mesh.quaternion.copy(this._q);
  }

  _fly(dt) {
    const s = this.stats;
    const α = THREE.MathUtils.clamp(this.forward.y, -0.5, 0.5); // nose-up positive
    const liftEff = 0.5 + 0.5 * (s.lift / 9);
    const maxSpeed = MAX_SPEED_BASE + s.speed * 1.8;
    const boostCap = this._boosting ? BOOST_CAP : maxSpeed * 1.05;

    // lift only when nose is above the horizon
    if (α > 0) this.vy += LIFT_BASE * Math.hypot(this.forward.x, this.forward.z) * α * liftEff * dt;

    // gravity + terminal vertical drag
    this.vy += (-GRAVITY - this.vy * VERT_DRAG) * dt;

    // energy: falling converts altitude -> speed; climbing bleeds speed
    const fall = Math.max(0, -this.vy);
    this.spd += fall * ENERGY_COUPLE * dt;
    this.spd -= (this.forward.y > 0 ? this.forward.y : 0) * CLIMB_BURN * dt;
    if (this.forward.y < 0) this.spd += -this.forward.y * DIVE_GAIN * dt;

    // drag back toward glide trim (only when above it, so falling still accelerates)
    if (this.spd > GLIDE_TRIM) this.spd -= (this.spd - GLIDE_TRIM) * SPD_DRAG * dt;

    // cap
    this.spd = THREE.MathUtils.clamp(this.spd, MIN_SPEED, boostCap);

    // boost thrust
    if (this._boosting && this.boostMeter > 0.001) {
      this.spd += BOOST_THRUST * dt;
      this.spd = Math.min(this.spd, boostCap);
    }

    // integrate position: horizontal forward + vertical (vy)
    this.velocity.set(
      this.forward.x * this.spd,
      this.vy,
      this.forward.z * this.spd,
    );
    this.position.addScaledVector(this.velocity, dt);
  }

  _stepBoost(dt) {
    if (this._boosting && this.boostMeter > 0) {
      this.boostMeter -= (1.7 - 0.05 * this.stats.boost / 9) * dt;
      if (this.boostMeter <= 0) { this.boostMeter = 0; this._boosting = false; }
    } else if (!this._boosting && this.boostMeter < 1) {
      this.boostMeter += (0.35 + 0.1 * this.stats.boost / 9) * dt;
    }
    this.boostMeter = THREE.MathUtils.clamp(this.boostMeter, 0, 1);
  }

  _updateTrails(dt) {
    if (this.state !== 'flying') return;
    this.mesh.updateMatrixWorld(true);
    const lx = this.mesh.localToWorld(this._wingLeftLocal.clone());
    const rx = this.mesh.localToWorld(this._wingRightLocal.clone());
    // trails only when moving fast and not in a deep dive
    const active = this.spd > GLIDE_TRIM * 0.7 && this.vy >= -12;
    this.leftTrail.update(active ? dt : 0, lx, this.forward);
    this.rightTrail.update(active ? dt : 0, rx, this.forward);
  }

  /* ---------- API for the game loop ---------- */
  get altitude() { return this.position.y; }
  get speed() { return Math.hypot(this.forward.x * this.spd, this.vy, this.forward.z * this.spd); }
  get horizontalSpeed() {
    return Math.hypot(this.forward.x * this.spd, this.forward.z * this.spd);
  }
  get boostRatio() { return this.boostMeter; }
  setBoostLevel() { /* called by Game to drive audio */ }

  reset() {
    this.state = 'idle';
    this.spd = GLIDE_TRIM;
    this.vy = 0;
    this.boostMeter = 1;
    this._boosting = false;
    this._bank = 0;
    this.forward.set(0, -0.15, 1).normalize();
    this.leftTrail.reset();
    this.rightTrail.reset();
  }

  applyCosmetics(cosmetics) {
    this.cosmetics = { ...cosmetics };
    // rebuild material only (geometry unchanged)
    if (this.mesh) {
      this.mesh.material.dispose();
      this.mesh.material = this._material();
      // re-color trails
      const con = CONTRAIL_COLORS[this.cosmetics.contrail || 'ribbon'];
      this.leftTrail.setColor(con);
      this.rightTrail.setColor(con);
      this._recomputeWingtips();
    }
    return this;
  }

  dispose() {
    this.leftTrail?.dispose();
    this.rightTrail?.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.scene.remove(this.mesh);
    }
  }
}
