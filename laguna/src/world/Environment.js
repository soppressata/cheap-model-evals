/**
 * Environment.js — sky dome (custom shader), sun sprite, procedural clouds,
 * per-biome lighting/rig, exponential fog, and a lightweight water plane.
 *
 * The sky dome is a giant inverted sphere whose fragment shader blends two
 * horizon/zenith colors and composites a procedural additive sun + clouds
 * (pure GLSL value noise, no textures).
 */
import * as THREE from 'three';
import { BIOMES } from './Terrain.js';

// ---- GLSL helpers: tiny hash-based 3D value noise for cloud sprites ----
const NOISE_GLSL = `
float uhash(float v){ return fract(sin(v)*43758.5453123); }
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,123.3)),
                           dot(p,vec3(269.5,183.3,489.3)),
                           dot(p,vec3(419.2,371.9,983.1))); return -1.0+2.0*fract(sin(p)*43758.5453123); }
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n= i.x+i.y*100.0+i.z*250.0; // not used directly; use hash3
  float a000=dot(hash3(i+0.0),vec3(1)), a100=dot(hash3(i+vec3(1,0,0)),vec3(1));
  float a010=dot(hash3(i+vec3(0,1,0)),vec3(1)), a110=dot(hash3(i+vec3(1,1,0)),vec3(1));
  float a001=dot(hash3(i+vec3(0,0,1)),vec3(1)), a101=dot(hash3(i+vec3(1,0,1)),vec3(1));
  float a011=dot(hash3(i+vec3(0,1,1)),vec3(1)), a111=dot(hash3(i+vec3(1,1,1)),vec3(1));
  return mix(mix(mix(a000,a100,f.x),mix(a010,a110,f.x),f.y),
             mix(mix(a001,a101,f.x),mix(a011,a111,f.x),f.y),f.z);
}
float fbm(vec3 p){
  float a=0.0,s=0.0,d=1.0,g=0.5;
  for(int i=0;i<4;i++){ a+=d*vnoise(p*d); s+=d; d*=2.0; g*=0.5; p*=2.0; }
  return a/s;
}
`;

const SKY_VERT = `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main(){
  vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;
  vNormal = normalize(normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos,1.0);
  gl_Position.z = gl_Position.w; // force to far plane
}
`;

const SKY_FRAG = `
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunSize;      // angular radius factor
uniform float time;
varying vec3 vWorldPos;
varying vec3 vNormal;
${NOISE_GLSL}
void main(){
  // altitude-based vertical gradient
  float t = pow(smoothstep(-0.2,0.9,normalize(vWorldPos).y),0.55);
  vec3 sky = mix(skyHorizon, skyTop, t);
  // sun disc + glow
  vec3 viewDir = normalize(vWorldPos);
  float sd = acos(clamp(dot(viewDir, sunDir),-1.0,1.0));
  float sun = smoothstep(sunSize, sunSize*0.2, sd) * (1.0 - smoothstep(sunSize*0.2, sunSize*4.0, sd));
  sky += sunColor * sun * 0.9;
  // procedural additive clouds (layered, scroll with time)
  vec3 p = viewDir * 2.4 + vec3(time*0.006, time*0.0, time*0.003);
  float c = fbm(p*1.6 + viewDir*0.9);
  c = pow(max(c,0.0),1.8)*0.7;
  sky = mix(sky, sky + sunColor*0.05, c*0.35);
  sky += sunColor*0.18 * pow(c,2.0);
  gl_FragColor = vec4(sky,1.0);
}
`;

export class Environment {
  constructor({ scene, camera }) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;

    // Sun as a glowing billboard sprite (procedural canvas texture, no asset)
    this.sunSprite = this._makeSunSprite();
    scene.add(this.sunSprite);

    // Sky dome
    const geo = new THREE.SphereGeometry(4500, 64, 48);
    geo.scale(-1, 1, 1); // front-facing inside
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        skyTop: { value: new THREE.Color(0x221b10) },
        skyHorizon: { value: new THREE.Color(0xf97316) },
        sunDir: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color(0xffb84d) },
        sunSize: { value: 0.26 },
        time: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    scene.add(this.sky);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
    scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sunLight.position.set(120, 220, 80);
    scene.add(this.sunLight);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(this.ambient);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sunLight.target = this.sunTarget;

    // Water plane (added/removed per biome)
    this.water = null;
    this._makeWater();

    this.setBiome('SUNSET_CANYON');
  }

  _makeSunSprite() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.25, 'rgba(255,190,90,0.9)');
    grad.addColorStop(0.55, 'rgba(255,130,30,0.45)');
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(420, 420, 1);
    return spr;
  }

  _makeWater() {
    const geo = new THREE.PlaneGeometry(4000, 4000, 128, 128);
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        waterColor: { value: new THREE.Color(0x06b2b2) },
        specular: { value: new THREE.Color(0xffffff) },
        waterLevel: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        uniform float time;
        void main(){
          vPos = position;
          vec3 p = position;
          p.y += sin(p.x*0.09+time*1.3)*0.35 + sin(p.z*0.07+time*0.9)*0.35;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 waterColor;
        uniform vec3 specular;
        uniform float time;
        varying vec3 vPos;
        ${NOISE_GLSL}
        void main(){
          vec2 uv = vPos.xz*0.02;
          float wave = (vnoise(vec3(vPos.xz*0.04, time*0.3))*0.5+0.5)*0.5;
          float foam = smoothstep(0.55,0.75, fbm(vec3(uv, time*0.2)));
          vec3 c = mix(waterColor*0.85, waterColor, 0.5+wave*0.1);
          c += specular*foam*0.45;
          c = mix(c, vec3(1.0,0.96,0.9), foam*0.35);
          gl_FragColor = vec4(c, 0.78);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.waterMat = mat;
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0;
    this.water.visible = false;
    this.water.renderOrder = 1;
    this.scene.add(this.water);
  }

  setBiome(key) {
    const b = BIOMES[key] || BIOMES.SUNSET_CANYON;
    this.biome = b;
    this.skyMat.uniforms.skyTop.value.setHex(b.skyTop);
    this.skyMat.uniforms.skyHorizon.value.setHex(b.skyHorizon);
    this.skyMat.uniforms.sunColor.value.setHex(b.sunColor);
    this.hemi.color.setHex(b.id === 'neon_metropolis' ? 0xffffff : 0xe8f0ff);
    this.hemi.groundColor.setHex(b.skyTop);
    this.hemi.intensity = b.id === 'neon_metropolis' ? 0.7 : 0.9;
    this.sunLight.color.setHex(b.sunColor);
    this.sunLight.intensity = 1.0;
    // fog matches the sky horizon so terrain pops in cleanly
    this.scene.fog = new THREE.FogExp2(b.fogColor, b.id === 'neon_metropolis' ? 0.0028 : 0.0032);
    this._sunAzimuth = b.id === 'neon_metropolis' ? 0.6 : 0.85;
    this._updateSun();
    // water toggle
    if (this.water) this.water.visible = b.id === 'emerald_archipelago';
  }

  _updateSun() {
    const a = this._sunAzimuth || 0.85;
    const elev = 0.55;
    const x = Math.sin(a), y = elev, z = Math.cos(a);
    const len = Math.hypot(x, y, z);
    this.skyMat.uniforms.sunDir.value.set(x / len, y / len, z / len);
    const far = 900;
    this.sunSprite.position.set(x * far, y * far + 30, z * far);
    this.sunSprite.material.color.setHex(this.biome.sunColor);
    this.sunLight.position.set(x * 600, y * 900, z * 600);
    this.sunTarget.position.set(x * 120, y * 260 + 20, z * 120);
  }

  update(dt, sunPitch = 0) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time * 0.15;
    this.waterMat.uniforms.time.value = this.time;
    // gentle sun drift for life
    const a = this._sunAzimuth + sunPitch;
    const elev = 0.55 + Math.sin(this.time * 0.05) * 0.02;
    const x = Math.sin(a), y = elev, z = Math.cos(a);
    const len = Math.hypot(x, y, z) || 1;
    this.skyMat.uniforms.sunDir.value.set(x / len, y / len, z / len);
    const far = 900;
    this.sunSprite.position.set(x * far, y * far + 30, z * far);
    this.sunLight.position.set(x * 600, y * 900, z * 600);
    this.sunTarget.position.set(x * 120, y * 260 + 20, z * 120);
  }

  applyToScene(scene) {
    scene.fog = new THREE.FogExp2(this.biome.fogColor, 0.0032);
  }

  dispose() {
    this.skyMat.dispose();
    this.sunSprite.material.dispose();
    if (this.water) {
      this.water.geometry.dispose();
      this.waterMat.dispose();
    }
  }
}
