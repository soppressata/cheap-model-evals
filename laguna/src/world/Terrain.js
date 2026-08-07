/**
 * Terrain.js — fBM noise, biome definitions, chunk-based heightfield mesh pool.
 *
 * Terrain is treated as a continuous height function getHeight(x, z) over the
 * (X,Z) plane (X horizontal, Z forward, Y up). Ahead of the player, terrain is
 * tiled into reusable mesh "chunks"; behind the player they are recycled.
 *
 * Each chunk geometry is allocated once with a fixed local grid; only the
 * vertex Y (height) is rewritten when a chunk cell changes, so generation is
 * cheap and GC-free.
 */
import * as THREE from 'three';

/* ---------- Seeded PRNG & 3D value noise ---------- */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ken Perlin-style improved permutation table.
function buildPerm(seed) {
  const p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function createNoise3(seed = 1337) {
  const perm = buildPerm(seed);
  const hash = (x, y, z) =>
    perm[(perm[(perm[(x & 255)] + (y & 255)) & 255] + (z & 255)) & 255];
  return function noise3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const x00 = lerp(hash(X, Y, Z), hash(X + 1, Y, Z), u);
    const x10 = lerp(hash(X, Y + 1, Z), hash(X + 1, Y + 1, Z), u);
    const x01 = lerp(hash(X, Y, Z + 1), hash(X + 1, Y, Z + 1), u);
    const x11 = lerp(hash(X, Y + 1, Z + 1), hash(X + 1, Y + 1, Z + 1), u);
    const y0 = lerp(x00, x10, v);
    const y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w) / 255; // [0,1]
  };
}

// Fractional Brownian Motion: sum of octaves -> value in [-1, 1].
export function fBm(noise, x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5, scale = 1.0) {
  let amp = 1;
  let freq = scale;
  let s = 0;
  let tot = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * noise(x * freq, y * freq, z * freq);
    tot += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return s / tot; // [-1,1] (noise is [0,1], mean 0.5 -> recentered)
}

/* ---------- Biome definitions ---------- */

export const BIOMES = {
  SUNSET_CANYON: {
    id: 'sunset_canyon',
    name: 'Sunset Canyon',
    // colors
    groundColor: 0xc25416,
    tintLow: 0x8a3a0e,
    tintHigh: 0xf5b870,
    fogColor: 0x7c2d12,
    fogNear: 60,
    fogFar: 260,
    skyTop: 0x221b10,
    skyHorizon: 0xf97316,
    sunColor: 0xffb84d,
    // terrain
    base: 8,
    amp: 22,
    freq: 0.038,
    valleyDepth: 8,
    valleyW: 24,
    octave: 5,
    waterLevel: -1000,
    obstacle: 'arch',
    seed: 11235,
  },
  FROST_CAVERNS: {
    id: 'frost_caverns',
    name: 'Frost Caverns',
    groundColor: 0xe2f0ff,
    tintLow: 0xc7e0f4,
    tintHigh: 0xf0fdfa,
    fogColor: 0xdbeafe,
    fogNear: 50,
    fogFar: 220,
    skyTop: 0x1e293b,
    skyHorizon: 0xceeadf,
    sunColor: 0xf0f9ff,
    base: 2,
    amp: 10,
    freq: 0.065,
    valleyDepth: 5,
    valleyW: 20,
    octave: 5,
    waterLevel: -1000,
    obstacle: 'stalactite',
    seed: 98765,
  },
  NEON_METROPOLIS: {
    id: 'neon_metropolis',
    name: 'Neon Metropolis',
    groundColor: 0x0b0f19,
    tintLow: 0x0f1729,
    tintHigh: 0x1e293b,
    fogColor: 0x0f1729,
    fogNear: 70,
    fogFar: 320,
    skyTop: 0x0b0110,
    skyHorizon: 0x0b0f2b,
    sunColor: 0x00f0ff,
    base: 0,
    amp: 1.5,
    freq: 0.18,
    valleyDepth: 0,
    valleyW: 16,
    octave: 4,
    waterLevel: -1000,
    obstacle: 'skyscraper',
    seed: 31337,
  },
  EMERALD_ARCHIPELAGO: {
    id: 'emerald_archipelago',
    name: 'Emerald Archipelago',
    groundColor: 0x158233,
    tintLow: 0x14532d,
    tintHigh: 0x4ade80,
    fogColor: 0x0c4a30,
    fogNear: 40,
    fogFar: 240,
    skyTop: 0x7c3aed,
    skyHorizon: 0x06b2b2,
    sunColor: 0xfbf285,
    base: 0,
    amp: 3.2,
    freq: 0.055,
    valleyDepth: 2,
    valleyW: 26,
    octave: 5,
    waterLevel: 0,
    obstacle: 'spires',
    seed: 424242,
  },
};

export const BIOME_ORDER = ['SUNSET_CANYON', 'FROST_CAVERNS', 'NEON_METROPOLIS', 'EMERALD_ARCHIPELAGO'];

/* ---------- Terrain manager ---------- */

export class Terrain {
  constructor({ scene, biomeKey = 'SUNSET_CANYON' }) {
    this.scene = scene;
    this.setBiome(biomeKey);

    // Chunk / grid parameters
    this.chunkWorld = 128;        // world units per chunk edge
    this.segs = 48;               // vertices per edge (49x49)
    this.step = this.chunkWorld / this.segs;
    this.halfW = this.chunkWorld / 2;

    // Recycling radii (in chunk cells)
    this.genRadiusX = 2;
    this.genRadiusZ = 5;          // generous forward buffer
    this.discardRadiusX = 3;
    this.discardRadiusZ = 7;

    this.chunks = new Map();      // "gx,gz" -> chunk entry
    this.pool = [];               // free geometries/meshes for reuse

    this._buildTemplate();        // shared geometry scaffold (local grid)
  }

  setBiome(key) {
    const k = BIOMES[key] ? key : 'SUNSET_CANYON';
    this.biomeKey = k;
    this.biome = BIOMES[k];
    // fresh noise per biome for deterministic terrain
    this.noise = createNoise3(this.biome.seed);
  }

  /* ----- height function (world coords) -----
     A smooth Gaussian trench runs down the centerline (X=0); rough hills rise
     only on the shoulders outside the trench. This guarantees a clear, flat-
     floored path the player can always thread while the sides stay jagged. */
  getHeight(x, z) {
    const b = this.biome;
    const n = fBm(
      this.noise,
      x * b.freq,
      z * b.freq,
      0.3,
      b.octave,
      2.0,
      0.5,
      1,
    );
    const gauss = Math.exp(-(x * x) / (b.valleyW * b.valleyW));
    const sideHills = n * b.amp * (1 - gauss);   // 0 in the trench, noisy at ridges
    const groove = b.valleyDepth * gauss;        // deepest at the centerline
    let h = b.base + sideHills - groove;
    // islands: ocean fills the basin so you can't fall below the waterline
    if (b.waterLevel > -999 && h < b.waterLevel) h = b.waterLevel;
    return h;
  }

  // Sample a normal (upward) at a world point via height deltas — cheap.
  getNormal(x, z, eps = 2.5) {
    const h = this.getHeight.bind(this);
    const hx0 = h(x - eps, z), hx1 = h(x + eps, z);
    const hz0 = h(x, z - eps), hz1 = h(x, z + eps);
    const n = new THREE.Vector3(hx0 - hx1, 2 * eps, hz0 - hz1).normalize();
    return n;
  }

  /* ----- shared chunk geometry scaffold ----- */
  _buildTemplate() {
    const s = this.segs;
    const positions = new Float32Array((s + 1) * (s + 1) * 3);
    const uvs = new Float32Array((s + 1) * (s + 1) * 2);
    const indices = [];
    for (let j = 0; j <= s; j++) {
      for (let i = 0; i <= s; i++) {
        const vi = (j * (s + 1) + i) * 3;
        positions[vi] = i * this.step;
        positions[vi + 1] = 0;
        positions[vi + 2] = j * this.step;
        const ui = (j * (s + 1) + i) * 2;
        uvs[ui] = i / s;
        uvs[ui + 1] = j / s;
      }
    }
    for (let j = 0; j < s; j++) {
      for (let i = 0; i < s; i++) {
        const a = j * (s + 1) + i;
        const b = (j + 1) * (s + 1) + i;
        const c = b + 1;
        const d = a + 1;
        indices.push(a, b, d, b, c, d);
      }
    }
    this._templatePos = positions;
    this._templateUvs = uvs;
    this._templateIdx = indices;
    this._geomCount = positions.length / 3;
  }

  /* ----- chunk pool -----
     Meshes are never disposed on recycling (only on full teardown) so the GPU
     buffers and attribute arrays are reused without GC churn. A mesh is
     "free" while off-screen; re-adding it re-registers it with the scene. */
  _newChunkGeometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._templatePos.slice(), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this._templateUvs.slice(), 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this._geomCount * 3, 3));
    geo.setIndex(this._templateIdx.slice());
    return geo;
  }

  _allocChunk(gx, gz) {
    let mesh = this.pool.pop();
    const key = `${gx},${gz}`;
    if (mesh) {
      // reuse
      mesh.geometry.userData.gx = gx;
      mesh.geometry.userData.gz = gz;
      this._refitHeights(mesh.geometry, gx, gz);
      mesh.position.set(gx * this.chunkWorld, 0, gz * this.chunkWorld);
      if (mesh.parent !== this.scene) this.scene.add(mesh);
      // keep biome material in sync if the biome changed
      if (mesh.userData.biome !== this.biome.id) {
        mesh.userData.biome = this.biome.id;
      }
    } else {
      const geo = this._newChunkGeometry();
      this._refitHeights(geo, gx, gz);
      const mat = this._terrainMaterial();
      mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { biome: this.biome.id, gx, gz };
      mesh.position.set(gx * this.chunkWorld, 0, gz * this.chunkWorld);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  _refitHeights(geo, gx, gz) {
    const pos = geo.attributes.position;
    const arr = pos.array;
    const s = this.segs;
    const step = this.step;
    const bx = gx * this.chunkWorld;
    const bz = gz * this.chunkWorld;
    const cols = geo.attributes.color;
    const cArr = cols.array;
    const b = this.biome;
    const inv = 1 / (b.amp * 2 || 1);
    for (let j = 0; j <= s; j++) {
      const row = j * (s + 1);
      const bz2 = bz + j * step;
      for (let i = 0; i <= s; i++) {
        const idx = row + i;
        const vi = idx * 3;
        const wx = bx + i * step;
        const h = this.getHeight(wx, bz2);
        arr[vi] = i * step;            // local X (grid)
        arr[vi + 1] = h;               // world Y height
        arr[vi + 2] = j * step;        // local Z (grid)
        const t = Math.pow(THREE.MathUtils.clamp((h - b.base) * inv + 0.5, 0, 1), 0.75);
        const c = THREE.MathUtils.lerp(b.tintLow, b.tintHigh, t);
        cArr[vi] = (c >> 16 & 255) / 255;
        cArr[vi + 1] = (c >> 8 & 255) / 255;
        cArr[vi + 2] = (c & 255) / 255;
      }
    }
    pos.needsUpdate = true;
    cols.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _terrainMaterial() {
    const b = this.biome;
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: b.id === 'neon_metropolis' ? 0.48 : (b.id === 'frost_caverns' ? 0.3 : 0.85),
      metalness: b.id === 'neon_metropolis' ? 0.2 : (b.id === 'frost_caverns' ? 0.15 : 0.0),
      flatShading: b.id === 'neon_metropolis',
      envMapIntensity: b.id === 'neon_metropolis' ? 0.7 : 0.25,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }

  /* ----- per-frame maintenance around a reference point ----- */
  update(center) {
    const cx = Math.floor(center.x / this.chunkWorld);
    const cz = Math.floor(center.z / this.chunkWorld);
    const keep = new Set();
    // ensure presence in generation window (forward + sideways)
    for (let dz = -1; dz <= this.genRadiusZ; dz++) {
      for (let dx = -this.genRadiusX; dx <= this.genRadiusX; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const key = `${gx},${gz}`;
        if (!this.chunks.has(key)) this.chunks.set(key, this._allocChunk(gx, gz));
        keep.add(key);
      }
    }
    // discard far-behind / far-out chunks
    const farX = this.discardRadiusX, farZ = this.discardRadiusZ;
    for (const [key, mesh] of this.chunks) {
      const [gx, gz] = key.split(',').map(Number);
      const inWindow = keep.has(key) ||
        (Math.abs(gx - cx) <= farX && Math.abs(gz - cz) <= farZ);
      if (!inWindow) {
        this.chunks.delete(key);
        this._freeChunk(mesh);
      }
    }
  }

  _freeChunk(mesh) {
    if (mesh && mesh.parent === this.scene) this.scene.remove(mesh);
    mesh.visible = false;
    this.pool.push(mesh);
  }

  dispose() {
    for (const [key, mesh] of this.chunks) {
      if (mesh && mesh.parent === this.scene) this.scene.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this.chunks.clear();
    this.pool = [];
  }
}
