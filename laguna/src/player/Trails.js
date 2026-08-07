/**
 * Trails.js — dynamic ribbon contrails streaming from the wingtips.
 *
 * Each Contrail is a thin quad-strip built from a rolling window of position
 * samples. The geometry is preallocated and rewritten in place each frame
 * (no GC), with additive blending and per-vertex alpha fade so trails vanish
 * smoothly behind the plane.
 */
import * as THREE from 'three';

export class Contrail {
  constructor({ scene, color, length = 40, width = 0.32, life = 1.4 }) {
    this.scene = scene;
    this.color = new THREE.Color(color);
    this.max = Math.max(12, length);
    this.width = width;
    this.life = life;

    // sample history (most-recent first is index 0)
    this.points = []; // {pos:Vector3, t:number}
    this._clock = 0;

    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const vCount = (this.max + 1) * 2;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(vCount * 3, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.Float32BufferAttribute(vCount * 3, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.Float32BufferAttribute(vCount * 2, 2);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setAttribute('uv', this.uvAttr);

    const idx = [];
    for (let i = 0; i < this.max; i++) {
      const a = i * 2, b = a + 1, c = (i + 1) * 2, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this._dirty = true;
  }

  setColor(color) {
    this.color.set(color);
    this._dirty = true;
  }

  reset() {
    this.points = [];
  }

  // worldUp: global up (Vector3) used to orient ribbon faces.
  update(dt, tipWorldPos, forward) {
    this._clock += dt;
    // sample when far enough from last sample
    const minStep = this.width * 2.2;
    const last = this.points[0];
    if (!last || last.pos.distanceTo(tipWorldPos) > minStep) {
      this.points.unshift({ pos: tipWorldPos.clone(), t: this._clock });
    }
    // expire old
    const cutoff = this._clock - this.life;
    while (this.points.length && this.points[this.points.length - 1].t < cutoff) {
      this.points.pop();
    }

    const n = this.points.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      this.posAttr.needsUpdate = true;
      return;
    }

    // build ribbon. We re-derive a sideways vector from each segment so the
    // strip rolls naturally with the plane's pitch/roll.
    const up = new THREE.Vector3(0, 1, 0);
    const aPos = this.posAttr.array;
    const aCol = this.colAttr.array;
    let vi = 0;
    const fade = (age) => 1 - age / this.life;

    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const pNext = this.points[i + 1] || p;
      const segForward = new THREE.Vector3().subVectors(pNext.pos, p.pos).normalize();
      const side = new THREE.Vector3().crossVectors(up, segForward).normalize();
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      const age = this._clock - p.t;
      const a = Math.max(0, fade(age));
      const col = this.color;
      const r = col.r * a, g = col.g * a, b = col.b * a;
      const hw = this.width * 0.5 * a;
      // vertex 0 = left, vertex 1 = right
      aPos[vi] = p.pos.x - side.x * hw; aPos[vi + 1] = p.pos.y - side.y * hw; aPos[vi + 2] = p.pos.z - side.z * hw;
      aCol[vi] = r; aCol[vi + 1] = g; aCol[vi + 2] = b;
      aPos[vi + 3] = p.pos.x + side.x * hw; aPos[vi + 4] = p.pos.y + side.y * hw; aPos[vi + 5] = p.pos.z + side.z * hw;
      aCol[vi + 6] = r; aCol[vi + 7] = g; aCol[vi + 8] = b;
      vi += 6;
    }
    const vertCount = n * 2;
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.attributes.uv.needsUpdate = true;
  }

  dispose() {
    if (this.mesh && this.mesh.parent === this.scene) this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
