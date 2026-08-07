/**
 * Cosmetics.js — procedural canvas textures for airplane skins.
 *
 * Every surface finish and pattern is generated on a <canvas> at runtime;
 * there are zero image assets. The returned texture drives the plane's base
 * color, while the finish controls PBR params (roughness/metalness/emissive).
 */
import * as THREE from 'three';

const TEX_SIZE = 256;

// Convert a hex string like '#fb9233' or 0xfb9233 to an {r,g,b} 0..1 object.
function hexToRgb(h) {
  if (typeof h === 'number') {
    return { r: ((h >> 16) & 255) / 255, g: ((h >> 8) & 255) / 255, b: (h & 255) / 255 };
  }
  const m = String(h).replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

function rand(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Subtle paper grain drawn into a separate canvas and composited on top.
function paperGrain(ctx, seed) {
  const r = rand(seed);
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (r() * 0.18 + 0.92) * 255;
    d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 50;
  }
  ctx.putImageData(img, 0, 0);
}

export function createCosmetics({ primary, secondary, pattern = 'stripes', finish = 'paper' }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  const prim = hexToRgb(primary);
  const sec = hexToRgb(secondary);

  // --- base background (secondary color) ---
  ctx.fillStyle = `rgb(${sec.r * 255},${sec.g * 255},${sec.b * 255})`;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const seed = Math.floor(Math.random() * 100000);
  const r = rand(seed);

  // --- pattern overlay in primary color ---
  ctx.fillStyle = `rgb(${prim.r * 255},${prim.g * 255},${prim.b * 255})`;
  switch (pattern) {
    case 'stripes': {
      const w = 14 + 6 * r();
      ctx.save();
      ctx.translate(6, 6);
      for (let i = 0; i < 12; i++) {
        ctx.fillRect(0, i * (w + 5), TEX_SIZE, w);
        ctx.rotate((Math.PI / 10) * (0.5 - r()));
      }
      ctx.restore();
      break;
    }
    case 'chevrons': {
      ctx.save();
      ctx.translate(0, 6);
      const stride = 22 + 4 * r();
      ctx.setLineDash([stride / 2, stride / 2]);
      ctx.lineWidth = 12 + 3 * r();
      ctx.strokeStyle = `rgb(${prim.r * 255},${prim.g * 255},${prim.b * 255})`;
      for (let i = 0; i < 18; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * stride);
        ctx.lineTo(TEX_SIZE, i * stride + stride / 2);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'confetti': {
      for (let i = 0; i < 320; i++) {
        ctx.fillStyle = `rgba(
          ${prim.r * 255},${prim.g * 255},${prim.b * 255},
          ${0.5 + r() * 0.5})`;
        const s = 2 + 3 * r();
        ctx.fillRect(r() * TEX_SIZE, r() * TEX_SIZE, s, s);
      }
      break;
    }
    case 'camo': {
      // splotchy organic blobs in primary + secondary
      const blobs = 9 + (6 * r() | 0);
      for (let i = 0; i < blobs; i++) {
        ctx.fillStyle = `rgba(
          ${r() < 0.5 ? sec.r * 255 : prim.r * 255},
          ${r() < 0.5 ? sec.g * 255 : prim.g * 255},
          ${r() < 0.5 ? sec.b * 255 : prim.b * 255}, 0.9)`;
        const rad = 28 + 24 * r();
        const x = -rad + r() * (TEX_SIZE + 2 * rad);
        const y = -rad + r() * (TEX_SIZE + 2 * rad);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'gradient': {
      const grad = ctx.createLinearGradient(0, 0, TEX_SIZE, TEX_SIZE);
      grad.addColorStop(0, `rgb(${prim.r * 255},${prim.g * 255},${prim.b * 255})`);
      grad.addColorStop(1, `rgb(${sec.r * 255},${sec.g * 255},${sec.b * 255})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      break;
    }
  }

  // --- finish: adjust material behavior ---
  let params = { roughness: 0.6, metalness: 0.0, emissive: 0x000000, emissiveIntensity: 0 };
  if (finish === 'foil') {
    params = { roughness: 0.08, metalness: 0.85, emissive: 0x000000, emissiveIntensity: 0 };
    // foil: add a bright specular highlight band
    const h = ctx.createLinearGradient(0, 0, TEX_SIZE, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  } else if (finish === 'matte') {
    params = { roughness: 0.92, metalness: 0.0, emissive: 0x000000, emissiveIntensity: 0 };
  } else if (finish === 'glitch') {
    params = { roughness: 0.3, metalness: 0.3, emissive: primToHex(prim), emissiveIntensity: 0.55 };
    // glitch scanlines
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(0,255,255,${0.25 + r() * 0.15})`;
      ctx.fillRect(0, (r() * TEX_SIZE) | 0, TEX_SIZE, 2);
    }
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(255,0,200,${0.15 + r() * 0.1})`;
      ctx.fillRect((r() * TEX_SIZE) | 0, 0, 3, TEX_SIZE);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // paper grain on matte/paper finishes only
  if (finish === 'paper' || finish === 'matte') paperGrain(ctx, seed + 7);

  // finalize canvas texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 1; // paper; low-aniso for the aesthetic
  texture.needsUpdate = true;

  return { texture, params, color: primToHex(prim) };
}

function primToHex(c) {
  const r = ((c.r * 255) | 0).toString(16).padStart(2, '0');
  const g = ((c.g * 255) | 0).toString(16).padStart(2, '0');
  const b = ((c.b * 255) | 0).toString(16).padStart(2, '0');
  return parseInt('0x' + r + g + b, 16);
}
