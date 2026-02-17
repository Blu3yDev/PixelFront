// FILE: src/game/utils.js

// ===== utilities =====

export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}



export function clampInt(v, a, b) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

export function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function title(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  return raw
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function hash01(x, y) {
  let n = ((x | 0) * 374761393 + (y | 0) * 668265263) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return (n >>> 0) / 4294967295;
}

// ===== Value noise + FBM (fast, stable, no dependencies) =====

function hash01i(seed, xi, yi) {
  let h = (seed ^ (xi * 374761393) ^ (yi * 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 0) / 4294967295;
}

export function noise2(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const n00 = hash01i(seed, xi, yi);
  const n10 = hash01i(seed, xi + 1, yi);
  const n01 = hash01i(seed, xi, yi + 1);
  const n11 = hash01i(seed, xi + 1, yi + 1);

  const a = lerp(n00, n10, u);
  const b = lerp(n01, n11, u);
  return lerp(a, b, v);
}

export function fbm01(seed, x, y, octaves) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const n = noise2(seed + (i * 1013), x * freq, y * freq);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return norm > 0 ? (sum / norm) : 0.5;
}

export function ridgeFbm01(seed, x, y, octaves) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noise2(seed + (i * 733), x * freq, y * freq);
    n = 1 - Math.abs(n * 2 - 1); // ridged
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }

  return norm > 0 ? (sum / norm) : 0.5;
}
