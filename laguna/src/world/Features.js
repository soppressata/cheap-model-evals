/**
 * Features.js — procedural placement of ring gates, spires, archways and
 * skyscrapers, each with collision volumes (spheres / AABBs).
 *
 * Features are generated per world cell ahead of the player and discarded
 * behind, decoupled from terrain chunk pooling (the height function is
 * deterministic, so a feature always sits correctly on whatever chunk mesh
 * currently renders its cell).
 */
import * as THREE from 'three';
import { BIOMES } from './Terrain.js';

const CELL = 128;        // must match Terrain.chunkWorld
const RING_RAD = 1.9;
const TUBE = 0.22;
const PLANE_RADIUS = 0.9;

// per-biome accent colors for rings & neon
const RING_COLOR = {
  sunset_canyon: 0xf59e0b,
  frost_caverns: 0xb0c4de,
  neon_metropolis: 0x06b6d4,
  emerald_archipelago: 0x4ade80,
};

export class Features {
  constructor({ scene, terrain }) {
    this.scene = scene;
    this.terrain = terrain;
    this.cells = new Map(); // key -> { group, rings:[...], obstacles:[...] }
    this.rings = [];        // live ring entries { mesh, pos, radius, collected }
    this.obstacles = [];    // live obstacle entries { volumes, mesh }
    this.genRadiusX = 2;
    this.genRadiusZ = 6;
    this.discardRadiusX = 3;
    this.discardRadiusZ = 8;
    this.setBiome(terrain.biomeKey);
  }

  setBiome(key) {
    this.biomeKey = key;
    this.biome = BIOMES[key] || BIOMES.SUNSET_CANYON;
    // rebuild live meshes' colors when the biome flips
    for (const r of this.rings) r.mesh.material.color.setHex(RING_COLOR[key] || 0xffffff);
  }

  update(center) {
    const gx = Math.floor(center.x / CELL);
    const gz = Math.floor(center.z / CELL);
    const keep = new Set();
    for (let dz = -1; dz <= this.genRadiusZ; dz++) {
      for (let dx = -this.genRadiusX; dx <= this.genRadiusX; dx++) {
        const cx = gx + dx, cz = gz + dz;
        const key = `${cx},${cz}`;
        if (!this.cells.has(key)) this.spawnCell(cx, cz);
        keep.add(key);
      }
    }
    const farX = this.discardRadiusX, farZ = this.discardRadiusZ;
    for (const key of this.cells.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (!keep.has(key) && (Math.abs(cx - gx) > farX || Math.abs(cz - gz) > farZ)) {
        this.recycleCell(key);
      }
    }
  }

  spawnCell(gx, gz) {
    // Group is an ownership container only (origin = world origin) so that
    // feature meshes keep their world-space positions; colliding volumes are
    // therefore already in world space.
    const group = new THREE.Group();
    this.scene.add(group);
    const rings = [];
    const obstacles = [];

    const b = this.biome;
    const obsPerCell = (gz) => {
      // vary density by biome
      if (b.id === 'neon_metropolis') return 2; // skyscrapers dense
      return 1;
    };

    const cols = obsPerCell(gz);
    for (let i = 0; i < cols; i++) {
      const ox = (i === 0 ? -1 : 1) * (14 + Math.random() * 10);
      const oz = -CELL / 2 + Math.random() * CELL;
      const wx = gx * CELL + ox;
      const wz = gz * CELL + oz;
      const h = this.terrain.getHeight(wx, wz);
      const ob = this._makeObstacle(wx, wz, h, b);
      group.add(ob.mesh);
      obstacles.push(ob);
    }

    // ring gates along the center valley
    const ringCount = 3 + (Math.random() * 2 | 0);
    for (let i = 0; i < ringCount; i++) {
      const oz = -CELL / 2 + 4 + i * (CELL / (ringCount + 1));
      const wz = gz * CELL + oz;
      const floor = this.terrain.getHeight(0, wz);
      const cx = (Math.random() - 0.5) * 6; // slight lateral wander, but still central
      const wx = gx * CELL + cx;
      // height: low/risky gates sit near the canyon floor; others higher
      const risky = Math.random() < 0.25;
      const height = floor + (risky ? 5 + Math.random() * 3 : 10 + Math.random() * 14);
      const ring = this._makeRing(wx, wz, height, b);
      group.add(ring.mesh);
      rings.push(ring);
    }

    this.cells.set(`${gx},${gz}`, { group, rings, obstacles });
    this.rings.push(...rings);
    this.obstacles.push(...obstacles);
  }

  _makeRing(x, z, y, b) {
    const geo = new THREE.TorusGeometry(RING_RAD, TUBE, 14, 40, Math.PI * 1.99);
    const mat = new THREE.MeshStandardMaterial({
      color: RING_COLOR[b.id],
      emissive: RING_COLOR[b.id],
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: b.id === 'neon_metropolis' ? 0.6 : 0.2,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    // tilt gate slightly relative to the valley so threading needs attention
    mesh.rotation.z = (Math.random() - 0.5) * 0.6;
    mesh.rotation.x = (Math.random() - 0.3) * 0.4;
    const entry = {
      mesh,
      pos: new THREE.Vector3(x, y, z),
      radius: RING_RAD * 0.55,   // collect sphere inside the ring hole
      collected: false,
    };
    entry.tick = (dt) => {
      mesh.rotation.y += dt * 0.6;
      mesh.scale.setScalar(1 + Math.sin(performance.now() * 0.004 + x * 0.3) * 0.06);
    };
    return entry;
  }

  _makeObstacle(x, z, y, b) {
    let mesh;
    const volumes = []; // collision volumes (sphere / box in world space)
    const id = b.id;
    const W = 4.2;
    if (id === 'sunset_canyon') {
      // archway: two pillars + a top beam; the gap between pillars is the path.
      const H = 7 + Math.random() * 6;
      const beamGeo = new THREE.BoxGeometry(W, 1.6, 2.2);
      const beamMat = this._mat(0xc25416, 0.9);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(0, y + H, 0);
      const pGeo = new THREE.BoxGeometry(1.6, H, 2.0);
      const pMat = this._mat(0x8a3a0e, 0.85);
      const l = new THREE.Mesh(pGeo, pMat);
      l.position.set(-W / 2, y + H / 2, 0);
      const r = new THREE.Mesh(pGeo, pMat);
      r.position.set(W / 2, y + H / 2, 0);
      mesh = new THREE.Group();
      mesh.add(beam, l, r);
      mesh.position.set(x, 0, z);
      // world AABBs for the two pillars (axis aligned; gap between them)
      for (const px of [-W / 2, W / 2]) {
        const cx = x + px;
        volumes.push({
          type: 'box',
          world: {
            min: new THREE.Vector3(cx - 0.8, y, z - 1.0),
            max: new THREE.Vector3(cx + 0.8, y + H, z + 1.0),
          },
        });
      }
      mesh.userData.kind = 'arch';
    } else if (id === 'frost_caverns') {
      const H = 12 + Math.random() * 8;
      const geo = new THREE.CylinderGeometry(0.9, 1.2, H, 8);
      const ic = new THREE.Mesh(geo, this._mat(0xdbeafe, 0.6, 0xbfdbfe));
      ic.position.set(0, y + H / 2, 0);
      mesh = new THREE.Group();
      mesh.add(ic);
      volumes.push({ type: 'sphere', pos: new THREE.Vector3(x, y + H / 2, z), r: (H * 0.28) });
      mesh.position.set(x, 0, z);
      mesh.userData.kind = 'stalactite';
    } else if (id === 'neon_metropolis') {
      const H = 16 + Math.random() * 16;
      const geo = new THREE.BoxGeometry(4 + Math.random() * 3, H, 4 + Math.random() * 3);
      const em = new THREE.MeshStandardMaterial({
        color: 0x0f1729,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.8,
        roughness: 0.4,
        metalness: 0.3,
        toneMapped: false,
      });
      mesh = new THREE.Mesh(geo, em);
      mesh.position.set(x, y + H / 2, z);
      volumes.push({ type: 'sphere', pos: new THREE.Vector3(x, y + H / 2, z), r: (H * 0.32) });
      mesh.userData.kind = 'skyscraper';
    } else {
      // emerald archipelago: rocky spires on island edges
      const H = 5 + Math.random() * 7;
      const geo = new THREE.ConeGeometry(1.6, H, 6, 1);
      const m = new THREE.Mesh(geo, this._mat(0x14532d, 0.85, 0x22c55e, 0.2));
      m.position.set(0, y + H / 2, 0);
      mesh = new THREE.Group();
      mesh.add(m);
      mesh.position.set(x, 0, z);
      volumes.push({ type: 'sphere', pos: new THREE.Vector3(x, y + H / 2, z), r: Math.max(H * 0.3, 1.2) });
      mesh.userData.kind = 'spire';
    }
    return { mesh, volumes };
  }

  _mat(color, rough, emissive, emInt) {
    return new THREE.MeshStandardMaterial({
      color: color,
      emissive: emissive || 0x000000,
      emissiveIntensity: emInt || 0,
      roughness: rough,
      metalness: 0.0,
      toneMapped: false,
    });
  }

  recycleCell(key) {
    const cell = this.cells.get(key);
    if (!cell) return;
    // remove from live arrays
    for (const r of cell.rings) {
      const idx = this.rings.indexOf(r);
      if (idx >= 0) this.rings.splice(idx, 1);
    }
    for (const o of cell.obstacles) {
      const idx = this.obstacles.indexOf(o);
      if (idx >= 0) this.obstacles.splice(idx, 1);
    }
    this.scene.remove(cell.group);
    cell.group.traverse((c) => {
      if (c.isMesh) { c.geometry.dispose(); c.material.dispose && c.material.dispose(); }
    });
    this.cells.delete(key);
  }

  tick(dt) {
    for (const r of this.rings) if (r.tick) r.tick(dt);
  }

  // --- collision queries ---

  // Returns collected rings (and marks them collected).
  checkRings(planePos) {
    const collected = [];
    for (const r of this.rings) {
      if (r.collected) continue;
      if (r.pos.distanceTo(planePos) < r.radius + PLANE_RADIUS * 0.6) {
        r.collected = true;
        r.mesh.visible = false;
        collected.push(r);
      }
    }
    return collected;
  }

  // Hard crash if the plane's sphere intersects any obstacle volume.
  checkObstacles(planePos, radius = PLANE_RADIUS) {
    for (const ob of this.obstacles) {
      for (const v of ob.volumes) {
        if (v.type === 'sphere') {
          if (v.pos.distanceTo(planePos) < v.r + radius) return true;
        } else if (v.type === 'box' && v.world) {
          const bx = v.world;
          if (
            planePos.x > bx.min.x && planePos.x < bx.max.x &&
            planePos.y > bx.min.y && planePos.y < bx.max.y &&
            planePos.z > bx.min.z && planePos.z < bx.max.z
          ) return true;
        }
      }
    }
    return false;
  }

  // Rings whose Z has fallen behind the plane without being collected count as
  // "missed" (the gate was skipped). They are flagged and pruned from play.
  markMissed(planeZ) {
    let missed = false;
    for (const r of this.rings) {
      if (r.collected) continue;
      if (r.pos.z < planeZ - 12) {
        r.collected = true;
        r.mesh.visible = false;
        missed = true;
      }
    }
    if (missed) this.rings = this.rings.filter((r) => !r.collected);
    return missed;
  }

  dispose() {
    for (const key of this.cells.keys()) this.recycleCell(key);
    this.rings = [];
    this.obstacles = [];
  }
}
