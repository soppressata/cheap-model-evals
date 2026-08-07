/**
 * Particles.js — a single-draw-call additive point-sprite particle system.
 *
 * Every particle type (ring sparkles, boost exhaust, impact sparks, crash
 * bursts) draws from the same pool so the engine stays at a low draw-call
 * count (T12). Particles are soft discs computed in a small shader so no
 * sprite textures are required.
 */
import * as THREE from 'three';

const VERT = `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;
  varying float vLife;
  varying vec3 vColor;
  void main(){
    vLife = aLife;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    float dist = -mv.z;
    float sz = aSize * (1.0 + dist*0.02);
    gl_PointSize = max(sz, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying float vLife;
  varying vec3 vColor;
  void main(){
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vLife;
    if(a < 1e-4) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class ParticleSystem {
  constructor({ scene, capacity = 1024 }) {
    this.scene = scene;
    this.capacity = capacity;
    this.count = 0;
    this.time = 0;
    this.pool = [];

    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.timeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aVel', this.vel);
    geo.setAttribute('aLife', this.timeAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setDrawRange(0, 0);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // scratch arrays to avoid allocs
    this._p = this.pos.array;
    this._v = this.vel.array;
    this._t = this.timeAttr.array;
    this._s = this.sizeAttr.array;
    this._c = this.colorAttr.array;
  }

  /* spawn a burst of particles */
  burst({ type = 'spark', origin, count = 16, color = 0xffffff, speed = 4, lifetime = 0.6, gravity = 9 }) {
    for (let i = 0; i < count; i++) {
      const idx = this._nextIndex();
      if (idx < 0) break;
      const p = this.pool[idx] || (this.pool[idx] = { r: Math.random(), g: 0 });
      // spherical direction
      const u = p.r * 2 - 1;
      const theta = (p.g || 0) * Math.PI * 2;
      const sp = Math.sqrt(1 - u * u);
      const vx = sp * Math.cos(theta);
      const vy = u;
      const vz = sp * Math.sin(theta);
      const s = 2 + Math.random() * (speed - 2);
      const o = origin;
      this._p[idx * 3] = o.x + vx * s;
      this._p[idx * 3 + 1] = o.y + vy * s;
      this._p[idx * 3 + 2] = o.z + vz * s;
      this._v[idx * 3] = vx * s;
      this._v[idx * 3 + 1] = vy * s;
      this._v[idx * 3 + 2] = vz * s;
      this._t[idx] = lifetime * (0.6 + Math.random() * 0.4);
      this._s[idx] = 4 + Math.random() * (type === 'boost' ? 14 : 8);
      const c = new THREE.Color(color);
      this._c[idx * 3] = c.r;
      this._c[idx * 3 + 1] = c.g;
      this._c[idx * 3 + 2] = c.b;
      p.g = Math.random(); // reuse as second random next time
      this.count++;
    }
    this._apply();
  }

  _nextIndex() {
    // find a dead/inactive slot
    if (this.count < this.capacity) {
      const idx = this.count;
      this.count = idx + 1;
      return idx;
    }
    for (let i = 0; i < this.capacity; i++) {
      if (this._t[i] <= 0) return i;
    }
    return -1;
  }

  _apply() {
    this.pos.needsUpdate = true;
    this.timeAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.count);
  }

  emitTrail(origin, forward, count = 2) {
    // continuous boost exhaust puff
    for (let i = 0; i < count; i++) {
      const idx = this._nextIndex();
      if (idx < 0) break;
      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
      ).addScaledVector(forward, -3);
      this._p[idx * 3] = origin.x + jitter.x;
      this._p[idx * 3 + 1] = origin.y + jitter.y;
      this._p[idx * 3 + 2] = origin.z + jitter.z;
      this._v[idx * 3] = jitter.x;
      this._v[idx * 3 + 1] = jitter.y - 0.2;
      this._v[idx * 3 + 2] = jitter.z;
      this._t[idx] = 0.35 + Math.random() * 0.2;
      this._s[idx] = 3 + Math.random() * 6;
      const c = new THREE.Color(0xff7d00);
      c.lerp(new THREE.Color(0x06b6d4), Math.random());
      this._c[idx * 3] = c.r;
      this._c[idx * 3 + 1] = c.g;
      this._c[idx * 3 + 2] = c.b;
      this.count++;
    }
    this._apply();
  }

  update(dt) {
    this.time += dt;
    if (this.count === 0) return;
    const g = 9;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      let t = this._t[i];
      if (t <= 0) {
        // swap-remove to keep array dense
        const j = this.count - 1;
        if (i !== j) {
          this._p[i * 3] = this._p[j * 3]; this._v[i * 3] = this._v[j * 3];
          this._p[i * 3 + 1] = this._p[j * 3 + 1]; this._v[i * 3 + 1] = this._v[j * 3 + 1];
          this._p[i * 3 + 2] = this._p[j * 3 + 2]; this._v[i * 3 + 2] = this._v[j * 3 + 2];
          this._t[i] = this._t[j];
          this._s[i] = this._s[j];
          this._c[i * 3] = this._c[j * 3]; this._c[i * 3 + 1] = this._c[j * 3 + 1]; this._c[i * 3 + 2] = this._c[j * 3 + 2];
        }
        this.count--;
        i--;
        continue;
      }
      const life = t;
      t -= dt;
      this._t[i] = t;
      // integrate velocity (with gravity)
      this._v[i * 3 + 1] -= g * dt * 0.5;
      this._p[i * 3] += this._v[i * 3] * dt;
      this._p[i * 3 + 1] += this._v[i * 3 + 1] * dt;
      this._p[i * 3 + 2] += this._v[i * 3 + 2] * dt;
      // fade size as life runs out (spark shrinkage)
      this._s[i] *= 0.97;
      alive++;
    }
    if (alive > 0) {
      this.pos.needsUpdate = true;
      this.timeAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
    this.points.geometry.setDrawRange(0, alive);
    this.count = alive;
  }

  dispose() {
    if (this.points && this.points.parent === this.scene) this.scene.remove(this.points);
    this.geo?.dispose?.();
    this.mat.dispose();
  }

  get geo() { return this.points.geometry; }
}
