// FILE: src/render.js
// Provides the Renderer API expected by your main.js/input.js

import { OWNER } from "./game/core/world.js";
import {
  AIRBASE_LAUNCH_RADIUS_TILES,
  ABM_RADIUS_TILES,
  CAMERA_PAN_OVERSCROLL_VIEWPORT,
  CAPITAL_DEFENCE_RADIUS_TILES,
  DEFENCE_POST_RADIUS_TILES,
  ENV_LIGHTING,
  ENV_RAIN,
  ENV_TIME,
  STRUCTURE_HIDE_ZOOM
} from "./game/config.js";
import { mulberry32 } from "./game/utils.js";
import { renderFlagToCanvas, sanitizeFlag } from "./flag.js";

// ===== tiny math/utils =====
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function mixRGB(a, b, t) { return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0]; }
function rgb(r, g, b) { return [r | 0, g | 0, b | 0]; }

function drawArcText(ctx, text, x, y, radius, arc, opts = {}) {
  if (!text) return;
  const chars = Array.from(String(text));
  if (!chars.length) return;

  const r = Number(radius) || 0;
  const absR = Math.max(1, Math.abs(r));
  const trackingPx = Math.max(0, Number(opts.trackingPx) || 0);
  const extraArc = (chars.length > 1) ? ((trackingPx / absR) * (chars.length - 1)) : 0;
  const totalArc = (Number(arc) || 0) + extraArc;
  const start = -totalArc * 0.5;
  const step = (chars.length > 1) ? (totalArc / (chars.length - 1)) : 0;

  const baseAngle = (r >= 0) ? (-Math.PI / 2) : (Math.PI / 2);

  ctx.save();
  ctx.translate(x, y);
  if (opts.font) ctx.font = opts.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (opts.arcLine) {
    ctx.lineWidth = Math.max(0.5, opts.arcLine.lineWidth || 1);
    ctx.strokeStyle = opts.arcLine.strokeStyle || "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(0, 0, absR, baseAngle + start, baseAngle + start + totalArc);
    ctx.stroke();
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const ang = start + i * step;

    ctx.save();
    ctx.rotate(ang);
    ctx.translate(0, -r);

    if (opts.strokeStyle) {
      ctx.lineWidth = Math.max(0.5, opts.lineWidth || 2);
      ctx.strokeStyle = opts.strokeStyle;
      ctx.strokeText(ch, 0, 0);
    }
    if (opts.fillStyle) {
      ctx.fillStyle = opts.fillStyle;
      ctx.fillText(ch, 0, 0);
    }
    ctx.restore();
  }

  ctx.restore();
}

function measureSpacedText(ctx, text, trackingPx) {
  const chars = Array.from(String(text || ""));
  if (!chars.length) return 0;
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    w += ctx.measureText(chars[i]).width;
  }
  if (chars.length > 1) w += trackingPx * (chars.length - 1);
  return w;
}

function fitSpacedFontPx(ctx, text, family, weight, maxPx, minPx, maxWidth, trackingPx) {
  let size = Math.max(minPx, maxPx);
  for (let i = 0; i < 28; i++) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (measureSpacedText(ctx, text, trackingPx) <= maxWidth) break;
    size -= 1;
    if (size <= minPx) break;
  }
  return Math.max(minPx, size);
}

function drawSpacedText(ctx, text, x, y, trackingPx, opts = {}) {
  const chars = Array.from(String(text || ""));
  if (!chars.length) return;
  const total = measureSpacedText(ctx, text, trackingPx);
  let cursor = x - total * 0.5;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const w = ctx.measureText(ch).width;
    const cx = cursor + w * 0.5;
    if (opts.strokeStyle) {
      ctx.strokeStyle = opts.strokeStyle;
      ctx.lineWidth = opts.lineWidth || 2;
      ctx.strokeText(ch, cx, y);
    }
    if (opts.fillStyle) {
      ctx.fillStyle = opts.fillStyle;
      ctx.fillText(ch, cx, y);
    }
    cursor += w + trackingPx;
  }
}

function fmtCompact(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs < 1000) return sign + String(Math.floor(abs));

  const units = ["k", "M", "B", "T"];
  let u = -1;
  let val = abs;

  while (val >= 1000 && u < units.length - 1) {
    val /= 1000;
    u++;
  }

  const decimals = val >= 100 ? 0 : val >= 10 ? 1 : 2;
  let s = val.toFixed(decimals);
  s = s.replace(/\.0+$/, "");
  s = s.replace(/(\.[0-9]*[1-9])0+$/, "$1");

  return sign + s + units[u];
}

function roundTo(v, step) {
  const s = Math.max(1, step | 0);
  return Math.round(v / s) * s;
}

function pseudo01(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function randRange(rng, a, b) {
  const r = (typeof rng === "function") ? rng() : Math.random();
  return a + (b - a) * r;
}

function hasIntelAdjacency(world, ownerId) {
  if (ownerId === OWNER.PLAYER) return true;
  if (!world || typeof world._bordersTouch !== "function") return false;
  return world._bordersTouch(OWNER.PLAYER, ownerId | 0);
}

function estimatePopulationText(world, ownerId, pop) {
  const p = Math.max(0, Math.floor(Number(pop) || 0));
  if (p <= 0) return "0";
  if (hasIntelAdjacency(world, ownerId)) return fmtCompact(p);

  const bucket = Math.floor((world.time || 0) / 30);
  const seed = ((world.seed >>> 0) ^ (ownerId * 2654435761) ^ (bucket * 1013904223)) >>> 0;
  const spread = 0.35 + pseudo01(seed) * 0.35;

  let low = Math.max(0, Math.floor(p * (1 - spread)));
  let high = Math.max(low + 1, Math.floor(p * (1 + spread)));

  const step = p >= 1_000_000 ? 10_000 : p >= 100_000 ? 5_000 : p >= 10_000 ? 1_000 : p >= 1_000 ? 250 : 50;
  low = roundTo(low, step);
  high = roundTo(high, step);
  if (high <= low) high = low + step;

  return `${fmtCompact(low)}-${fmtCompact(high)}`;
}

function hash2i(x, y, seed) {
  // deterministic, cheap hash
  let n = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = (n * 1274126177) | 0;
  return (n ^ (n >>> 16)) >>> 0;
}

// ===== coherent noise for legacy/fallback world texture build =====
function noise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  function h(ix, iy) { return (hash2i(ix, iy, seed) >>> 0) / 4294967295; }

  const n00 = h(xi, yi);
  const n10 = h(xi + 1, yi);
  const n01 = h(xi, yi + 1);
  const n11 = h(xi + 1, yi + 1);

  const a = lerp(n00, n10, u);
  const b = lerp(n01, n11, u);
  return lerp(a, b, v);
}

function fbm01(seed, x, y, octaves) {
  let amp = 0.5, freq = 1.0, sum = 0.0, norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    const n = noise2(seed + i * 1013, x * freq, y * freq);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return norm > 0 ? (sum / norm) : 0.5;
}

export class Renderer {
  constructor(ctx, canvas, world) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.world = world;

    // World canvas (offscreen)
    this.worldCanvas = document.createElement("canvas");
    this.worldCanvas.width = world.w;
    this.worldCanvas.height = world.h;
    this.worldCtx = this.worldCanvas.getContext("2d", { alpha: false });

    this.worldImage = null;
    this._worldImageUsesViewPixels = false;
    this._bindWorldImageBuffer(world);
    this.worldDirty = true;

    // Political map canvas (offscreen): lazily allocated to avoid reserving
    // a second world-sized pixel buffer unless the mode is enabled.
    this.politicalCanvas = null;
    this.politicalCtx = null;
    this.politicalImage = null;
    this._politicalDirty = true;
    this._politicalLastOwnerVersion = -1;
    this._politicalLastSeed = -1;
    this._politicalLastRebuildT = -1;
    this._politicalFullRebuildRow = -1;

    // Selection overlay (offscreen)
    this.selectionCanvas = document.createElement("canvas");
    this.selectionCanvas.width = world.w;
    this.selectionCanvas.height = world.h;
    this.selectionCtx = this.selectionCanvas.getContext("2d", { alpha: true });

    this.selectionImage = this.selectionCtx.createImageData(world.w, world.h);
    this.selectionDirty = true;
    this._selectionHasPixels = false;

    // Selection outline overlay (offscreen)
    // Drawn on top of selection fill so the planned claim area reads clearly.
    this.selectionOutlineCanvas = document.createElement("canvas");
    this.selectionOutlineCanvas.width = world.w;
    this.selectionOutlineCanvas.height = world.h;
    this.selectionOutlineCtx = this.selectionOutlineCanvas.getContext("2d", { alpha: true });
    this.selectionOutlineImage = this.selectionOutlineCtx.createImageData(world.w, world.h);
    this.selectionOutlineDirty = true;

    // Hover overlay (offscreen)
    this.hoverCanvas = document.createElement("canvas");
    this.hoverCanvas.width = world.w;
    this.hoverCanvas.height = world.h;
    this.hoverCtx = this.hoverCanvas.getContext("2d", { alpha: true });
    this.hoverImage = this.hoverCtx.createImageData(world.w, world.h);
    this.hoverDirty = true;
    this._hoverOwner = 0;
    this._hoverRGBA = { r: 255, g: 255, b: 255, a: 60 };

    // Hatch overlay (offscreen): lazily allocated when the overlay is active.
    this.hatchCanvas = null;
    this.hatchCtx = null;
    this.hatchImage = null;
    this.hatchDirty = true;
    this._hatchLastT = -1;
    this._hatchLastOwnerVersion = -1;
    this._hatchIdle = false;

    // Heatmap overlay (offscreen): lazily allocated when enabled.
    this.heatmapCanvas = null;
    this.heatmapCtx = null;
    this.heatmapImage = null;
    this._heatmapDirty = true;
    this._heatmapLastT = -1;
    this._heatmapLastVersion = -1;

    // Nation highlight overlay (client-side): lazily allocated.
    this.highlightCanvas = null;
    this.highlightCtx = null;
    this.highlightImage = null;
    this._highlightDirty = true;
    this._highlightLastOwnerVersion = -1;
    this._highlightFullRebuildRow = -1;

    // Cache label sizes so they stay visually stable across zoom changes.
    this._labelSizeCache = new Map();
    this._labelSizeCacheVersion = -1;
    this._labelSizeCacheLastPruneAt = 0;
    this._labelSpanCache = new Map();
    this._labelSpanCacheVersion = -1;
    this._labelSpanCacheNextSyncAt = 0;

    this.dpr = 1;
    this.zoomLevels = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10, 12];
    this.zoom = 1.5;
    this.zoomTarget = this.zoom;
    this.zoomSmooth = 14; // higher = snappier smoothing

    // Camera in world coords
    this.camera = { x: world.w * 0.5, y: world.h * 0.5 };
    this.cameraTarget = { x: this.camera.x, y: this.camera.y };
    this._lastRenderTime = 0;

    this.debugChecker = false;

    this._viewport = null;
    this._clientSettings = {
      showAIStructures: true,
      showAIFlags: true,
      showNationLabels: true,
      showShips: true,
      highlightNation: true,
      showHatchOverlay: true,
      showHeatmap: false,
      nukeDestinationOverlay: true,
      politicalMapMode: false,
      atmosphereEnabled: true,
      reduceMotion: false,
      lowPowerOverlays: false
    };
    this._playerFlag = null;
    this._playerFlagCanvas = null;
    this._playerFlagKey = "";
    this._nationFlagCanvasById = new Map();

    // ===== Structure icons (screen-space, constant size) =====
    // Put PNGs in `public/Structures/`:
    //   capital.png, city.png, factory.png, barracks.png
    this.structureIconMaxPx = 44; // bigger + constant size (no zoom scaling)
    this._structureIconCache = new Map();
    this._structureIconFiles = Object.freeze({
      capital: "capital.png",
      city: "city.png",
      factory: "factory.png",
      barracks: "barracks.png",
      defence_post: "defence_post.png",
      port: "port.png",
      missile_silo: "missile_silo.png",
      abm_launcher: "abm_launcher.png",
      airbase: "airbase.png"
    });
    this._nukeCenterIcon = null;
    this._missileIconCache = new Map();
    // Missile sprites are drawn in fixed screen-space size (do not scale with zoom).
    this._missileIconSizePx = Object.freeze({
      atomic: 30,
      hydrogen: 30,
      abm: 25
    });
    // User missile sprites are authored nose-up, so rotate +90deg to align with flight direction.
    this._missileSpriteHeadingOffsetRad = Math.PI * 0.5;
    this._missileIconFiles = Object.freeze({
      atomic: ["AtomicMissile.png", "atomicMissile.png"],
      hydrogen: ["HydrogenMissile.png", "hydrogenMissile.png"],
      abm: ["abmMissile.png", "AbmMissile.png", "ABMMissile.png"]
    });
    this._airbornePlaneIcon = null;
    this._airbornePlaneIconSizePx = 28;
    // Plane icon is authored nose-up, so rotate +90deg to align with movement direction.
    this._airbornePlaneHeadingOffsetRad = Math.PI * 0.5;
    this._relationIconCache = new Map();
    this._relationIconFiles = Object.freeze({
      allied: ["allied.png"],
      ceasefire: ["ceasefire.png"],
      war: ["war.png"]
    });
    // Fixed-size relation markers (screen-space, no zoom scaling).
    this._relationIconSizePx = 58;
    this._relationIconGapPx = 8;
    this._relationIconSpacingPx = 8;
    this._relationIconLiftPx = 0;

    // ===== Ship icons (screen-space) =====
    // Put PNGs in `public/Structures/ShipIcons/`:
    //   TradeShip.png, WarShip.png, TransportShip.png
    this._shipIconCache = new Map();
    this._shipIconFiles = Object.freeze({
      trade: "TradeShip.png",
      war: "WarShip.png",
      transport: "TransportShip.png"
    });
    this._shipTintSpriteCache = new Map();
    const worldTiles = Math.max(1, (world.w | 0) * (world.h | 0));
    this._shipTintSpriteCacheMaxEntries = worldTiles >= 1_000_000 ? 640 : 1024;
    this._shipTintSpriteCacheMaxBytes = worldTiles >= 1_000_000 ? (32 * 1024 * 1024) : (64 * 1024 * 1024);
    this._shipTintSpriteCacheBytes = 0;
    this._shipTintCanvas = document.createElement("canvas");
    this._shipTintCtx = this._shipTintCanvas.getContext("2d", { alpha: true });

    // Shared owner-delta cache so multiple overlay rebuilds can consume the same world dirty batch once.
    this._ownerDirtyFrameVersion = -1;
    this._ownerDirtyFrameDelta = null;

    // Transient screen-edge alerts (war declaration, incoming attack, alliance formed).
    this._screenAlerts = [];
    // Player elimination victory marker VFX (icon + local particles).
    this._victoryMarkers = [];
    this._victoryParticles = [];
    this._victoryVfxLastT = performance.now() * 0.001;
    this._victoryMaxParticles = worldTiles >= 1_000_000 ? 1600 : 2400;
    this._victoryIcon = null;
    this._victoryIconReady = false;
    this._victoryIconFailed = false;
    this._victoryIconPath = "/UI_Icons/Expressions/victory.png";
    this._ensureVictoryIcon();

    this._env = {
      seed: (world && typeof world.seed === "number") ? (world.seed >>> 0) : 1,
      rng: null,
      lastWorldTime: (world && typeof world.time === "number") ? world.time : 0,
      lastCanvasW: 0,
      lastCanvasH: 0,
      rain: { state: "clear", nextAt: 0, endAt: 0, intensity: 0 },
      drops: []
    };
    this._resetEnvironment(world);

    this.rebuildWorldTexture(true);
    this.presentHatch();
    this.presentHeatmap();
    this.presentSelection();
    this.presentHover();
  }

  // Main entry called by main.js
  draw(arg) { this.render(arg); }

  setClientSettings(next) {
    const src = (next && typeof next === "object") ? next : {};
    const prev = this._clientSettings || {};
    const prevAtmosphere = Boolean(prev.atmosphereEnabled ?? true);

    this._clientSettings = {
      showAIStructures: Object.prototype.hasOwnProperty.call(src, "showAIStructures")
        ? Boolean(src.showAIStructures)
        : Boolean(prev.showAIStructures ?? true),
      showAIFlags: Object.prototype.hasOwnProperty.call(src, "showAIFlags")
        ? Boolean(src.showAIFlags)
        : Boolean(prev.showAIFlags ?? true),
      showNationLabels: Object.prototype.hasOwnProperty.call(src, "showNationLabels")
        ? Boolean(src.showNationLabels)
        : Boolean(prev.showNationLabels ?? true),
      showShips: Object.prototype.hasOwnProperty.call(src, "showShips")
        ? Boolean(src.showShips)
        : Boolean(prev.showShips ?? true),
      highlightNation: Object.prototype.hasOwnProperty.call(src, "highlightNation")
        ? Boolean(src.highlightNation)
        : Boolean(prev.highlightNation ?? true),
      showHatchOverlay: Object.prototype.hasOwnProperty.call(src, "showHatchOverlay")
        ? Boolean(src.showHatchOverlay)
        : Boolean(prev.showHatchOverlay ?? true),
      showHeatmap: Object.prototype.hasOwnProperty.call(src, "showHeatmap")
        ? Boolean(src.showHeatmap)
        : Boolean(prev.showHeatmap ?? false),
      nukeDestinationOverlay: Object.prototype.hasOwnProperty.call(src, "nukeDestinationOverlay")
        ? Boolean(src.nukeDestinationOverlay)
        : Boolean(prev.nukeDestinationOverlay ?? true),
      politicalMapMode: Object.prototype.hasOwnProperty.call(src, "politicalMapMode")
        ? Boolean(src.politicalMapMode)
        : Boolean(prev.politicalMapMode ?? false),
      atmosphereEnabled: Object.prototype.hasOwnProperty.call(src, "atmosphereEnabled")
        ? Boolean(src.atmosphereEnabled)
        : Boolean(prev.atmosphereEnabled ?? true),
      reduceMotion: Object.prototype.hasOwnProperty.call(src, "reduceMotion")
        ? Boolean(src.reduceMotion)
        : Boolean(prev.reduceMotion ?? false),
      lowPowerOverlays: Object.prototype.hasOwnProperty.call(src, "lowPowerOverlays")
        ? Boolean(src.lowPowerOverlays)
        : Boolean(prev.lowPowerOverlays ?? false)
    };

    if (!this._clientSettings.atmosphereEnabled && this._env) {
      this._env.rain.intensity = 0;
      this._env.rain.state = "clear";
      this._env.drops.length = 0;
    } else if (!prevAtmosphere && this._clientSettings.atmosphereEnabled) {
      this._resetEnvironment(this.world);
    }

    this._heatmapDirty = true;
    this.hatchDirty = true;
    this._highlightDirty = true;
    this._politicalDirty = true;

    if (!this._clientSettings.showHeatmap) this._releaseLayerSurface("heatmap");
    if (this._clientSettings.showHatchOverlay === false) {
      this._hatchIdle = true;
      this._releaseLayerSurface("hatch");
    }
    if (!this._clientSettings.highlightNation) this._releaseLayerSurface("highlight");
    if (!this._clientSettings.politicalMapMode) this._releaseLayerSurface("political");
  }

  getClientSettings() {
    return { ...this._clientSettings };
  }

  setPlayerFlag(flagDef) {
    const safe = sanitizeFlag(flagDef || null);
    const key = JSON.stringify(safe);
    if (key === this._playerFlagKey && this._playerFlagCanvas) return;
    this._playerFlag = safe;
    this._playerFlagKey = key;

    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 64;
    renderFlagToCanvas(c, safe, { smoothing: false });
    this._playerFlagCanvas = c;
  }

  setNationFlags(flagsById) {
    const src = (flagsById && typeof flagsById === "object") ? flagsById : {};
    this._nationFlagCanvasById.clear();
    const keys = Object.keys(src);
    for (let i = 0; i < keys.length; i++) {
      const id = Number(keys[i]) | 0;
      if (!Number.isFinite(id) || id <= 1) continue;
      const safe = sanitizeFlag(src[id]);
      const c = document.createElement("canvas");
      c.width = 72;
      c.height = 48;
      renderFlagToCanvas(c, safe, { smoothing: false });
      this._nationFlagCanvasById.set(id, c);
    }
  }

  triggerScreenAlert(kind = "war") {
    const t = performance.now() * 0.001;
    const reduceMotion = !!(this._clientSettings && this._clientSettings.reduceMotion);
    const type = String(kind || "war").toLowerCase();

    const preset = (() => {
      if (type === "attack") return { color: [255, 68, 68], duration: 1.6, pulses: 3.2, strength: 1.0 };
      if (type === "ally") return { color: [84, 220, 120], duration: 1.45, pulses: 2.2, strength: 0.82 };
      return { color: [255, 196, 72], duration: 1.4, pulses: 2.8, strength: 0.92 }; // war/default
    })();

    const duration = reduceMotion ? (preset.duration * 0.75) : preset.duration;
    const pulses = reduceMotion ? Math.max(1, preset.pulses * 0.5) : preset.pulses;

    this._screenAlerts.push({
      color: preset.color,
      start: t,
      end: t + duration,
      pulses,
      strength: preset.strength
    });

    if (this._screenAlerts.length > 8) {
      this._screenAlerts.splice(0, this._screenAlerts.length - 8);
    }
  }

  _ensureVictoryIcon() {
    if (this._victoryIconReady || this._victoryIconFailed) return;
    if (this._victoryIcon) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      this._victoryIconReady = true;
      this._victoryIconFailed = false;
    };
    img.onerror = () => {
      this._victoryIconFailed = true;
      this._victoryIconReady = false;
    };
    img.src = this._victoryIconPath;
    this._victoryIcon = img;
  }

  _spawnVictoryParticlesAt(wx, wy, intensity = 1) {
    const parts = this._victoryParticles;
    const n = Math.max(2, Math.round(10 * Math.max(0.2, intensity)));
    const colors = [[255, 212, 88], [255, 172, 64], [255, 236, 182], [255, 138, 82]];

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.95 + Math.random() * 3.4;
      const life = 0.48 + Math.random() * 0.92;
      const c = colors[(Math.random() * colors.length) | 0];
      const px = 1 + ((Math.random() * 2.4) | 0);
      parts.push({
        x: wx + (Math.random() - 0.5) * 0.55,
        y: wy + (Math.random() - 0.5) * 0.55,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - (0.2 + Math.random() * 0.6),
        life,
        lifeMax: life,
        px,
        delay: Math.random() * 0.16 * Math.max(0.35, Math.min(1.4, intensity)),
        gravity: 0.9,
        drag: 1.26,
        trail: 1.1 + Math.random() * 2.1,
        trailSteps: 1 + ((Math.random() * 3) | 0),
        color: [c[0] | 0, c[1] | 0, c[2] | 0]
      });
    }

    const maxP = Math.max(120, this._victoryMaxParticles | 0);
    if (parts.length > maxP) parts.splice(0, parts.length - maxP);
  }

  _collectEliminationFrontierTiles(defeatedOwner, focusX = NaN, focusY = NaN, maxTiles = 260, lookbackS = 14) {
    const world = this.world;
    const did = defeatedOwner | 0;
    if (!world || did <= OWNER.NONE) return [];

    const claimBuf = (typeof world._getClaimFxBuffer === "function") ? world._getClaimFxBuffer() : null;
    const cap = claimBuf ? (claimBuf.cap | 0) : 0;
    const count = claimBuf ? (claimBuf.count | 0) : 0;
    if (!(cap > 0 && count > 0) || !claimBuf.idx || !claimBuf.owner || !claimBuf.prevOwner || !claimBuf.stamp) return [];

    const now = Number(world.time) || 0;
    const out = [];
    const seen = new Set();
    const isBorderCell = (typeof world._isRenderBorderCell === "function")
      ? ((idx) => world._isRenderBorderCell(idx))
      : null;
    const hardCap = Math.max(maxTiles, 1200);
    const scanMax = Math.min(cap, Math.max(2600, hardCap * 6));

    let slot = ((claimBuf.write | 0) - 1 + cap) % cap;
    let left = Math.min(count, cap);
    let scanned = 0;

    while (left > 0 && scanned < scanMax && out.length < hardCap) {
      const stamp = Number(claimBuf.stamp[slot]) || 0;
      const age = now - stamp;
      if (age > lookbackS) break;
      if (age >= 0) {
        const idx = claimBuf.idx[slot] | 0;
        const ownerNow = claimBuf.owner[slot] | 0;
        const prevOwner = claimBuf.prevOwner[slot] | 0;
        if (idx >= 0 && ownerNow === OWNER.PLAYER && prevOwner === did && !seen.has(idx)) {
          if (isBorderCell && !isBorderCell(idx)) {
            slot = (slot - 1 + cap) % cap;
            left--;
            scanned++;
            continue;
          }
          seen.add(idx);
          out.push(idx);
        }
      }
      slot = (slot - 1 + cap) % cap;
      left--;
      scanned++;
    }

    const fx = Number(focusX);
    const fy = Number(focusY);
    if (out.length > maxTiles && Number.isFinite(fx) && Number.isFinite(fy)) {
      const w = world.w | 0;
      out.sort((a, b) => {
        const ax = (a % w) - fx;
        const ay = ((a / w) | 0) - fy;
        const bx = (b % w) - fx;
        const by = ((b / w) | 0) - fy;
        return (ax * ax + ay * ay) - (bx * bx + by * by);
      });
    }

    if (out.length > maxTiles) out.length = maxTiles;
    return out;
  }

  _pickFrontierMarkerAnchor(frontierTiles, fallbackX, fallbackY) {
    const world = this.world;
    const w = world ? (world.w | 0) : 0;
    if (!world || !Array.isArray(frontierTiles) || frontierTiles.length <= 0 || w <= 0) {
      return {
        x: Number.isFinite(fallbackX) ? (Number(fallbackX) + 0.5) : 0.5,
        y: Number.isFinite(fallbackY) ? (Number(fallbackY) + 0.5) : 0.5
      };
    }

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < frontierTiles.length; i++) {
      const idx = frontierTiles[i] | 0;
      sumX += (idx % w) + 0.5;
      sumY += ((idx / w) | 0) + 0.5;
    }
    const cx = sumX / frontierTiles.length;
    const cy = sumY / frontierTiles.length;

    let bestIdx = frontierTiles[0] | 0;
    let bestD2 = Infinity;
    for (let i = 0; i < frontierTiles.length; i++) {
      const idx = frontierTiles[i] | 0;
      const x = (idx % w) + 0.5;
      const y = ((idx / w) | 0) + 0.5;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = idx;
      }
    }
    return { x: (bestIdx % w) + 0.5, y: ((bestIdx / w) | 0) + 0.5 };
  }

  triggerVictoryEliminationFx(eventData = null) {
    const ev = (eventData && typeof eventData === "object") ? eventData : {};
    const defeatedOwner = ev.to | 0;
    const wx = Number(ev.x);
    const wy = Number(ev.y);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;

    this._ensureVictoryIcon();

    const lowPower = !!this._clientSettings?.lowPowerOverlays;
    const reduceMotion = !!this._clientSettings?.reduceMotion;
    const frontierTiles = this._collectEliminationFrontierTiles(
      defeatedOwner,
      wx,
      wy,
      reduceMotion ? 120 : (lowPower ? 260 : 420),
      reduceMotion ? 8 : (lowPower ? 11 : 15)
    );
    const anchor = this._pickFrontierMarkerAnchor(frontierTiles, wx, wy);

    const now = performance.now() * 0.001;
    this._victoryMarkers.push({
      x: anchor.x,
      y: anchor.y,
      start: now,
      end: now + 2.1
    });
    if (this._victoryMarkers.length > 14) {
      this._victoryMarkers.splice(0, this._victoryMarkers.length - 14);
    }

    if (frontierTiles.length > 0) {
      const w = this.world.w | 0;
      const perTile = reduceMotion ? 0.2 : (lowPower ? 0.22 : 0.28);
      for (let i = 0; i < frontierTiles.length; i++) {
        const idx = frontierTiles[i] | 0;
        this._spawnVictoryParticlesAt((idx % w) + 0.5, ((idx / w) | 0) + 0.5, perTile);
      }
      this._spawnVictoryParticlesAt(anchor.x, anchor.y, reduceMotion ? 0.7 : 1.05);
    } else {
      this._spawnVictoryParticlesAt(wx + 0.5, wy + 0.5, 1.0);
    }
  }

  _updateVictoryVfx(dt) {
    if (dt <= 0) return;
    const now = performance.now() * 0.001;

    const markers = this._victoryMarkers;
    for (let i = markers.length - 1; i >= 0; i--) {
      if (now >= (Number(markers[i]?.end) || 0)) markers.splice(i, 1);
    }

    const parts = this._victoryParticles;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if ((Number(p.delay) || 0) > 0) {
        p.delay -= dt;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      const dragMul = Math.exp(-(Math.max(0, Number(p.drag) || 0) * dt));
      p.vx *= dragMul;
      p.vy = (p.vy * dragMul) + ((Number(p.gravity) || 0) * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  _drawVictoryVfxScreen(ctx, v) {
    const now = performance.now() * 0.001;
    const markers = this._victoryMarkers;
    const parts = this._victoryParticles;
    if ((!markers || markers.length <= 0) && (!parts || parts.length <= 0)) return;

    const dx = Number(v.dx) || 0;
    const dy = Number(v.dy) || 0;
    const zoom = Math.max(0.0001, Number(v.zoom) || 1);

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    if (parts && parts.length > 0) {
      const prevComp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "lighter";
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if ((Number(p.delay) || 0) > 0) continue;
        const lifeMax = Math.max(0.001, Number(p.lifeMax) || 0.001);
        const t = clamp01((Number(p.life) || 0) / lifeMax);
        if (t <= 0) continue;

        const sx = dx + (Number(p.x) || 0) * zoom;
        const sy = dy + (Number(p.y) || 0) * zoom;
        if (sx < -32 || sy < -32 || sx > v.canvasW + 32 || sy > v.canvasH + 32) continue;
        const c = Array.isArray(p.color) ? p.color : [255, 210, 120];
        const pxSize = Math.max(1, Math.round((Number(p.px) || 1) * (0.58 + 0.42 * t)));
        const alpha = Math.min(0.94, Math.max(0.05, t * t));

        const vx = Number(p.vx) || 0;
        const vy = Number(p.vy) || 0;
        const vLen = Math.hypot(vx, vy);
        const nx = vLen > 0.001 ? (vx / vLen) : 0;
        const ny = vLen > 0.001 ? (vy / vLen) : -1;
        const steps = Math.max(1, Number(p.trailSteps) | 0);
        const trailLen = (Number(p.trail) || 1.0) * (0.26 + 0.74 * t) * (0.6 + 0.28 * zoom);
        for (let s = steps; s >= 0; s--) {
          const k = (steps > 0) ? (s / steps) : 0;
          const tx = sx - nx * trailLen * k;
          const ty = sy - ny * trailLen * k;
          const ax = Math.round(tx - pxSize * 0.5);
          const ay = Math.round(ty - pxSize * 0.5);
          const aSeg = alpha * (1 - k * 0.68);
          if (aSeg <= 0.01) continue;
          ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${aSeg.toFixed(3)})`;
          ctx.fillRect(ax, ay, pxSize, pxSize);
          if (s === 0 && pxSize >= 2) {
            ctx.fillStyle = `rgba(255,248,235,${Math.min(0.95, aSeg * 0.88).toFixed(3)})`;
            ctx.fillRect(ax, ay, 1, 1);
          }
        }
      }
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = prevComp;
    }

    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const span = Math.max(0.001, (Number(m.end) || 0) - (Number(m.start) || 0));
      const t = clamp01((now - (Number(m.start) || 0)) / span);
      if (t <= 0 || t >= 1) continue;

      const fadeIn = clamp01(t / 0.26);
      const fadeOut = clamp01((1 - t) / 0.28);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= 0.003) continue;

      const riseEase = 1 - Math.pow(1 - t, 3);
      const slidePx = 30 * riseEase;
      const sx = dx + (Number(m.x) || 0) * zoom;
      const sy = dy + (Number(m.y) || 0) * zoom - slidePx;

      const size = clamp(34 + zoom * 6.5, 34, 62);
      const half = size * 0.5;
      const img = this._victoryIcon;
      if (this._victoryIconReady && img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, sx - half, sy - size, size, size);
        ctx.globalAlpha = 1;
      } else {
        const rr = half * 0.42;
        ctx.fillStyle = `rgba(255,196,78,${(alpha * 0.72).toFixed(3)})`;
        ctx.fillRect(sx - rr, sy - size + rr * 0.2, rr * 2, rr * 2);
      }
    }

    ctx.restore();
  }

  _bindWorldImageBuffer(world) {
    const w = world.w | 0;
    const h = world.h | 0;
    this.worldImage = this.worldCtx.createImageData(w, h);
    this._worldImageUsesViewPixels = false;
  }

  _releaseLayerSurface(kind) {
    const k = String(kind || "");
    if (!k) return;
    const canvasKey = `${k}Canvas`;
    const ctxKey = `${k}Ctx`;
    const imgKey = `${k}Image`;
    const c = this[canvasKey];
    if (c && typeof c === "object") {
      c.width = 1;
      c.height = 1;
    }
    this[canvasKey] = null;
    this[ctxKey] = null;
    this[imgKey] = null;
    if (k === "political") this._politicalFullRebuildRow = -1;
    if (k === "highlight") this._highlightFullRebuildRow = -1;
  }

  _ensurePoliticalSurface() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    if (
      this.politicalCanvas &&
      this.politicalCtx &&
      this.politicalImage &&
      this.politicalImage.data &&
      this.politicalImage.data.length === (w * h * 4)
    ) {
      return true;
    }

    this._releaseLayerSurface("political");
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return false;

    this.politicalCanvas = c;
    this.politicalCtx = ctx;
    this.politicalImage = ctx.createImageData(w, h);
    this._politicalDirty = true;
    this._politicalFullRebuildRow = -1;
    this._politicalLastOwnerVersion = -1;
    this._politicalLastSeed = -1;
    return true;
  }

  _ensureHeatmapSurface() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    if (
      this.heatmapCanvas &&
      this.heatmapCtx &&
      this.heatmapImage &&
      this.heatmapImage.data &&
      this.heatmapImage.data.length === (w * h * 4)
    ) {
      return true;
    }

    this._releaseLayerSurface("heatmap");
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return false;

    this.heatmapCanvas = c;
    this.heatmapCtx = ctx;
    this.heatmapImage = ctx.createImageData(w, h);
    this._heatmapDirty = true;
    this._heatmapLastVersion = -1;
    this._heatmapLastT = -1;
    return true;
  }

  _ensureHatchSurface() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    if (
      this.hatchCanvas &&
      this.hatchCtx &&
      this.hatchImage &&
      this.hatchImage.data &&
      this.hatchImage.data.length === (w * h * 4)
    ) {
      return true;
    }

    this._releaseLayerSurface("hatch");
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return false;

    this.hatchCanvas = c;
    this.hatchCtx = ctx;
    this.hatchImage = ctx.createImageData(w, h);
    this.hatchDirty = true;
    this._hatchIdle = false;
    this._hatchLastT = -1;
    this._hatchLastOwnerVersion = -1;
    return true;
  }

  _ensureHighlightSurface() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    if (
      this.highlightCanvas &&
      this.highlightCtx &&
      this.highlightImage &&
      this.highlightImage.data &&
      this.highlightImage.data.length === (w * h * 4)
    ) {
      return true;
    }

    this._releaseLayerSurface("highlight");
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return false;

    this.highlightCanvas = c;
    this.highlightCtx = ctx;
    this.highlightImage = ctx.createImageData(w, h);
    this._highlightDirty = true;
    this._highlightFullRebuildRow = -1;
    this._highlightLastOwnerVersion = -1;
    return true;
  }

  resizeToDisplay() {
    const rect = this.canvas.getBoundingClientRect();
    const nextDpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    const w = Math.max(1, Math.floor(rect.width * nextDpr));
    const h = Math.max(1, Math.floor(rect.height * nextDpr));

    let changed = false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      changed = true;
    }
    if (this.dpr !== nextDpr) {
      this.dpr = nextDpr;
      changed = true;
    }

    if (changed) {
      this._viewport = null;
      this._clampCameraToWorld();
      this._clampCameraToWorldWithZoom(this.cameraTarget, this.zoomTarget);
    }
    return changed;
  }

  _getStructureIcon(type) {
    const key = String(type || "").toLowerCase();
    const file = this._structureIconFiles[key];
    if (!file) return null;

    let img = this._structureIconCache.get(key);
    if (img) return img;

    img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    // Be tolerant to case differences in user projects ("Structures" vs "structures").
    img.__pfTriedLower = false;
    img.onerror = () => {
      if (img.__pfTriedLower) return;
      img.__pfTriedLower = true;
      img.src = `/structures/${file}`;
    };
    img.src = `/Structures/${file}`;
    this._structureIconCache.set(key, img);
    return img;
  }

  _getShipIcon(kind) {
    const key = String(kind || "").toLowerCase();
    const file = this._shipIconFiles[key];
    if (!file) return null;

    let img = this._shipIconCache.get(key);
    if (img) return img;

    const paths = [
      `/Structures/ShipIcons/${file}`,
      `/Structures/shipicons/${file}`,
      `/structures/ShipIcons/${file}`,
      `/structures/shipicons/${file}`
    ];

    img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.__pfShipTry = 0;
    img.onerror = () => {
      img.__pfShipTry = (img.__pfShipTry | 0) + 1;
      const ix = img.__pfShipTry | 0;
      if (ix >= paths.length) return;
      img.src = paths[ix];
    };
    img.src = paths[0];
    this._shipIconCache.set(key, img);
    return img;
  }

  _getMissileIcon(kind) {
    const key = String(kind || "").toLowerCase();
    const files = this._missileIconFiles[key] || this._missileIconFiles.atomic;
    if (!Array.isArray(files) || files.length === 0) return null;

    let img = this._missileIconCache.get(key);
    if (img) return img;

    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      // User-provided missile icons live in UI_Icons.
      paths.push(`/UI_Icons/${file}`);
      paths.push(`/ui_icons/${file}`);
      paths.push(`/Structures/ShipIcons/${file}`);
      paths.push(`/Structures/shipicons/${file}`);
      paths.push(`/structures/ShipIcons/${file}`);
      paths.push(`/structures/shipicons/${file}`);
      paths.push(`/Structures/${file}`);
      paths.push(`/structures/${file}`);
    }
    if (paths.length <= 0) return null;

    img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.__pfMissileTry = 0;
    img.onerror = () => {
      img.__pfMissileTry = (img.__pfMissileTry | 0) + 1;
      const ix = img.__pfMissileTry | 0;
      if (ix >= paths.length) return;
      img.src = paths[ix];
    };
    img.src = paths[0];
    this._missileIconCache.set(key, img);
    return img;
  }

  _getAirbornePlaneIcon() {
    if (this._airbornePlaneIcon) return this._airbornePlaneIcon;

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    const paths = [
      "/Structures/PlaneIcon/transportPlane.png",
      "/Structures/PlaneIcon/TransportPlane.png",
      "/Structures/planeicon/transportPlane.png",
      "/Structures/planeicon/transportplane.png",
      "/structures/PlaneIcon/transportPlane.png",
      "/structures/PlaneIcon/TransportPlane.png",
      "/structures/planeicon/transportPlane.png",
      "/structures/planeicon/transportplane.png"
    ];
    img.__pfAirplaneTry = 0;
    img.onerror = () => {
      img.__pfAirplaneTry = (img.__pfAirplaneTry | 0) + 1;
      const ix = img.__pfAirplaneTry | 0;
      if (ix >= paths.length) return;
      img.src = paths[ix];
    };
    img.src = paths[0];
    this._airbornePlaneIcon = img;
    return img;
  }

  _getNukeCenterIcon() {
    if (this._nukeCenterIcon) return this._nukeCenterIcon;

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    const paths = [
      "/UI_Icons/NukeIcon.png",
      "/UI_Icons/NukeIcon.webp",
      "/UI_Icons/NukeIcon.jpg",
      "/ui_icons/NukeIcon.png",
      "/ui_icons/NukeIcon.webp",
      "/ui_icons/NukeIcon.jpg"
    ];
    img.__pfNukeTry = 0;
    img.onerror = () => {
      img.__pfNukeTry = (img.__pfNukeTry | 0) + 1;
      const ix = img.__pfNukeTry | 0;
      if (ix >= paths.length) return;
      img.src = paths[ix];
    };
    img.src = paths[0];
    this._nukeCenterIcon = img;
    return img;
  }

  _getRelationIcon(kind) {
    const key = String(kind || "").toLowerCase();
    const files = this._relationIconFiles[key];
    if (!Array.isArray(files) || files.length === 0) return null;

    let img = this._relationIconCache.get(key);
    if (img) return img;

    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      paths.push(`/UI_Icons/Expressions/${file}`);
      paths.push(`/UI_Icons/expressions/${file}`);
      paths.push(`/ui_icons/Expressions/${file}`);
      paths.push(`/ui_icons/expressions/${file}`);
      paths.push(`/UI_Icons/${file}`);
      paths.push(`/ui_icons/${file}`);
    }
    if (paths.length <= 0) return null;

    img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.__pfRelationTry = 0;
    img.onerror = () => {
      img.__pfRelationTry = (img.__pfRelationTry | 0) + 1;
      const ix = img.__pfRelationTry | 0;
      if (ix >= paths.length) return;
      img.src = paths[ix];
    };
    img.src = paths[0];
    this._relationIconCache.set(key, img);
    return img;
  }

  _getPlayerRelationIconKindsForNation(ownerId) {
    const id = ownerId | 0;
    if (id <= 0) return [];

    const world = this.world;
    if (!world || typeof world.getRelation !== "function") return [];

    // Never draw relation markers above the player's own nation label.
    if (id === OWNER.PLAYER) return [];

    const rel = world.getRelation(OWNER.PLAYER, id);
    if (!rel) return [];
    if (rel.allied) return ["allied"];
    if (rel.ceasefire) return ["ceasefire"];
    if (rel.atWar) return ["war"];
    return [];
  }

  _getTintedShipSprite(kind, ownerId, icon, size, tint) {
    if (!icon || !icon.complete || icon.naturalWidth <= 0) return null;

    const s = Math.max(1, Math.round((Math.max(1, size | 0)) * 0.5) * 2);
    const q = 8;
    const tr = (((tint?.r ?? 220) | 0) / q + 0.5) | 0;
    const tg = (((tint?.g ?? 220) | 0) / q + 0.5) | 0;
    const tb = (((tint?.b ?? 220) | 0) / q + 0.5) | 0;
    const rr = tr * q;
    const gg = tg * q;
    const bb = tb * q;
    const key = `${String(kind || "")}|${ownerId | 0}|${s}|${tr}|${tg}|${tb}`;

    const cache = this._shipTintSpriteCache;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.canvas;
    }

    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const tx = c.getContext("2d", { alpha: true });
    if (!tx) return null;

    tx.imageSmoothingEnabled = false;
    tx.globalCompositeOperation = "source-over";
    tx.globalAlpha = 1;
    tx.drawImage(icon, 0, 0, s, s);

    tx.globalCompositeOperation = "source-atop";
    tx.globalAlpha = 0.82;
    tx.fillStyle = `rgb(${rr},${gg},${bb})`;
    tx.fillRect(0, 0, s, s);

    // Re-apply source details without blur-heavy filtering.
    tx.globalCompositeOperation = "source-over";
    tx.globalAlpha = 0.30;
    tx.drawImage(icon, 0, 0, s, s);
    tx.globalAlpha = 1;
    tx.globalCompositeOperation = "source-over";

    const bytes = (s * s * 4) | 0;
    cache.set(key, { canvas: c, bytes });
    this._shipTintSpriteCacheBytes += bytes;

    while (
      cache.size > (this._shipTintSpriteCacheMaxEntries | 0) ||
      this._shipTintSpriteCacheBytes > (this._shipTintSpriteCacheMaxBytes | 0)
    ) {
      const first = cache.keys().next();
      if (!first || first.done) break;
      const old = cache.get(first.value);
      cache.delete(first.value);
      this._shipTintSpriteCacheBytes -= (old?.bytes | 0);
      if (this._shipTintSpriteCacheBytes < 0) this._shipTintSpriteCacheBytes = 0;
    }
    return c;
  }

  _drawTintedShipIcon(ctx, icon, x, y, size, tintColor) {
    const s = Math.max(1, size | 0);
    const tx = this._shipTintCtx;
    const tc = this._shipTintCanvas;
    if (!tx || !tc) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(icon, x, y, s, s);
      return;
    }

    if (tc.width !== s || tc.height !== s) {
      tc.width = s;
      tc.height = s;
    } else {
      tx.clearRect(0, 0, s, s);
    }

    // Keep ship pixels crisp in the offscreen tint pass.
    tx.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    tx.globalCompositeOperation = "source-over";
    tx.globalAlpha = 1;
    tx.drawImage(icon, 0, 0, s, s);

    tx.globalCompositeOperation = "source-atop";
    tx.globalAlpha = 0.82;
    tx.fillStyle = tintColor;
    tx.fillRect(0, 0, s, s);

    // Re-apply source details without blur-heavy filtering.
    tx.globalCompositeOperation = "source-over";
    tx.globalAlpha = 0.30;
    tx.drawImage(icon, 0, 0, s, s);

    tx.globalCompositeOperation = "source-over";
    tx.globalAlpha = 1;
    ctx.drawImage(tc, x, y, s, s);
  }

  _consumeOwnerDirtyFrame(ownerVersion) {
    const ver = ownerVersion | 0;
    if ((this._ownerDirtyFrameVersion | 0) === ver && this._ownerDirtyFrameDelta) {
      return this._ownerDirtyFrameDelta;
    }

    let delta = { full: true, items: null };
    if (this.world && typeof this.world._consumeOwnerDirty === "function") {
      const got = this.world._consumeOwnerDirty();
      delta = {
        full: Boolean(got?.full),
        items: Array.isArray(got?.items) ? got.items : null
      };
    }

    this._ownerDirtyFrameVersion = ver;
    this._ownerDirtyFrameDelta = delta;
    return delta;
  }

  _resetEnvironment(world) {
    if (!this._env) {
      this._env = {
        seed: 1,
        rng: null,
        lastWorldTime: 0,
        lastCanvasW: 0,
        lastCanvasH: 0,
        rain: { state: "clear", nextAt: 0, endAt: 0, intensity: 0 },
        drops: []
      };
    }

    const env = this._env;
    const seed = (world && typeof world.seed === "number") ? (world.seed >>> 0) : (env.seed >>> 0) || 1;

    env.seed = seed;
    env.rng = mulberry32((seed ^ 0xA5A5A5A5) >>> 0);
    env.lastWorldTime = (world && typeof world.time === "number") ? world.time : 0;
    env.lastCanvasW = 0;
    env.lastCanvasH = 0;

    env.rain.state = "clear";
    env.rain.intensity = 0;
    env.rain.endAt = 0;
    env.rain.nextAt = env.lastWorldTime + randRange(env.rng, ENV_RAIN.MIN_GAP_S, ENV_RAIN.MAX_GAP_S);

    env.drops.length = 0;
  }

  _updateEnvironment(world) {
    if (!this._env) this._resetEnvironment(world);

    const env = this._env;
    const now = (world && typeof world.time === "number") ? world.time : 0;
    const seed = (world && typeof world.seed === "number") ? (world.seed >>> 0) : env.seed;

    if (seed !== env.seed || now < env.lastWorldTime) {
      this._resetEnvironment(world);
    }

    const dt = Math.max(0, now - env.lastWorldTime);
    env.lastWorldTime = now;

    const rain = env.rain;
    if (rain.state === "clear") {
      if (now >= rain.nextAt) {
        rain.state = "rain";
        rain.endAt = now + randRange(env.rng, ENV_RAIN.MIN_DURATION_S, ENV_RAIN.MAX_DURATION_S);
      }
    } else if (now >= rain.endAt) {
      rain.state = "clear";
      rain.nextAt = now + randRange(env.rng, ENV_RAIN.MIN_GAP_S, ENV_RAIN.MAX_GAP_S);
    }

    const target = (rain.state === "rain") ? 1 : 0;
    const ramp = Math.max(0.001, Number(ENV_RAIN.RAMP_S) || 0);
    const t = ramp > 0 ? (1 - Math.exp(-dt / ramp)) : 1;
    rain.intensity = lerp(rain.intensity, target, t);

    if (!Number.isFinite(rain.intensity)) rain.intensity = target;
    if (rain.intensity < 0.001) rain.intensity = 0;
    if (rain.intensity > 0.999) rain.intensity = 1;

    return dt;
  }

  _updateRainDrops(dt, v) {
    const env = this._env;
    if (!env || !v) return;

    const rainIntensity = clamp01(env.rain?.intensity ?? 0);
    const area = Math.max(1, v.canvasW * v.canvasH);
    const target = Math.max(0, Math.round(area * ENV_RAIN.DENSITY * rainIntensity));

    const drops = env.drops;
    if (drops.length > target) {
      drops.length = target;
    } else if (drops.length < target) {
      const add = target - drops.length;
      for (let i = 0; i < add; i++) {
        drops.push({
          x: randRange(env.rng, 0, v.canvasW),
          y: randRange(env.rng, 0, v.canvasH),
          speed: randRange(env.rng, ENV_RAIN.SPEED_MIN, ENV_RAIN.SPEED_MAX),
          length: randRange(env.rng, ENV_RAIN.LENGTH_MIN, ENV_RAIN.LENGTH_MAX)
        });
      }
    }

    const windX = Number(ENV_RAIN.WIND_X) || 0;
    const windY = Number(ENV_RAIN.WIND_Y) || 0;
    const windLen = Math.hypot(windX, windY) || 1;
    const dx = windX / windLen;
    const dy = windY / windLen;
    const pad = 40;

    if (dt > 0) {
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.x += dx * d.speed * dt;
        d.y += dy * d.speed * dt;

        const out =
          d.x < -pad || d.x > v.canvasW + pad ||
          d.y < -pad || d.y > v.canvasH + pad;

        if (out) {
          if (Math.abs(dx) > Math.abs(dy)) {
            d.x = dx > 0 ? -pad : v.canvasW + pad;
            d.y = randRange(env.rng, -pad, v.canvasH + pad);
          } else {
            d.x = randRange(env.rng, -pad, v.canvasW + pad);
            d.y = dy > 0 ? -pad : v.canvasH + pad;
          }
          d.speed = randRange(env.rng, ENV_RAIN.SPEED_MIN, ENV_RAIN.SPEED_MAX);
          d.length = randRange(env.rng, ENV_RAIN.LENGTH_MIN, ENV_RAIN.LENGTH_MAX);
        }
      }
    }

    env.lastCanvasW = v.canvasW;
    env.lastCanvasH = v.canvasH;
  }

  _drawLightingOverlay(ctx, v, world) {
    if (!world) return;

    const env = this._env;
    const rainIntensity = clamp01(env?.rain?.intensity ?? 0);

    const dayLen = Math.max(1, Number(ENV_TIME.DAY_LENGTH_S) || 1);
    const dawn = Math.max(0, Number(ENV_TIME.DAWN_S) || 0);
    const dusk = Math.max(0, Number(ENV_TIME.DUSK_S) || 0);
    const night = Math.max(0, Number(ENV_TIME.NIGHT_S) || 0);
    const day = Math.max(0, dayLen - dawn - dusk - night);

    let t = (Number(world.time) || 0) + (Number(ENV_TIME.START_OFFSET_S) || 0);
    t = t % dayLen;
    if (t < 0) t += dayLen;

    let twilightAlpha = 0;
    let nightAlpha = 0;

    if (t < dawn) {
      const u = dawn > 0 ? (t / dawn) : 1;
      twilightAlpha = (ENV_LIGHTING.TWILIGHT_ALPHA || 0) * Math.sin(u * Math.PI);
      nightAlpha = (ENV_LIGHTING.NIGHT_ALPHA || 0) * (1 - u);
    } else if (t < dawn + day) {
      twilightAlpha = 0;
      nightAlpha = 0;
    } else if (t < dawn + day + dusk) {
      const u = dusk > 0 ? ((t - dawn - day) / dusk) : 1;
      twilightAlpha = (ENV_LIGHTING.TWILIGHT_ALPHA || 0) * Math.sin(u * Math.PI);
      nightAlpha = (ENV_LIGHTING.NIGHT_ALPHA || 0) * u;
    } else {
      twilightAlpha = 0;
      nightAlpha = (ENV_LIGHTING.NIGHT_ALPHA || 0);
    }

    const rainAlpha = (ENV_LIGHTING.RAIN_CLOUD_ALPHA_MAX || 0) * rainIntensity;

    if (nightAlpha <= 0.001 && twilightAlpha <= 0.001 && rainAlpha <= 0.001) return;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);

    if (nightAlpha > 0.001) {
      const c = ENV_LIGHTING.NIGHT_COLOR;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${nightAlpha})`;
      ctx.fillRect(0, 0, v.canvasW, v.canvasH);
    }

    if (twilightAlpha > 0.001) {
      const c = ENV_LIGHTING.TWILIGHT_COLOR;
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${twilightAlpha})`;
      ctx.fillRect(0, 0, v.canvasW, v.canvasH);
    }

    if (rainAlpha > 0.001) {
      const c = ENV_LIGHTING.RAIN_CLOUD_COLOR;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${rainAlpha})`;
      ctx.fillRect(0, 0, v.canvasW, v.canvasH);
    }

    ctx.restore();
  }

  _drawRain(ctx, v) {
    const env = this._env;
    if (!env || !env.drops || env.drops.length === 0) return;

    const intensity = clamp01(env.rain?.intensity ?? 0);
    if (intensity <= 0.001) return;

    const windX = Number(ENV_RAIN.WIND_X) || 0;
    const windY = Number(ENV_RAIN.WIND_Y) || 0;
    const windLen = Math.hypot(windX, windY) || 1;
    const dx = windX / windLen;
    const dy = windY / windLen;

    const c = ENV_RAIN.COLOR;
    const alpha = 0.15 + 0.55 * intensity;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`;
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    for (let i = 0; i < env.drops.length; i++) {
      const d = env.drops[i];
      const x0 = d.x;
      const y0 = d.y;
      const x1 = x0 + dx * d.length;
      const y1 = y0 + dy * d.length;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
  }

  _clampCameraToWorld() {
    this._clampCameraToWorldWithZoom(this.camera, this.zoom);
  }

  _clampCameraToWorldWithZoom(cam, zoom) {
    const m = this._getCanvasMetrics();
    const z = Math.max(0.25, Number(zoom) || 1);
    const halfW = (m.canvasW / z) * 0.5;
    const halfH = (m.canvasH / z) * 0.5;

    const overscroll = Math.max(0, Number(CAMERA_PAN_OVERSCROLL_VIEWPORT) || 0);
    const overscrollX = (m.canvasW / z) * overscroll;
    const overscrollY = (m.canvasH / z) * overscroll;
    const minX = halfW - overscrollX;
    const maxX = this.world.w - halfW + overscrollX;
    const minY = halfH - overscrollY;
    const maxY = this.world.h - halfH + overscrollY;

    cam.x = (minX > maxX) ? (this.world.w * 0.5) : clamp(cam.x, minX, maxX);
    cam.y = (minY > maxY) ? (this.world.h * 0.5) : clamp(cam.y, minY, maxY);
  }

  _getCanvasMetrics() {
    const dpr = this.dpr || 1;
    const canvasW = this.canvas.width / dpr;
    const canvasH = this.canvas.height / dpr;
    return { dpr, canvasW, canvasH };
  }

  setCameraCenter(wx, wy) {
    this.camera.x = wx;
    this.camera.y = wy;
    this.cameraTarget.x = wx;
    this.cameraTarget.y = wy;
    this._viewport = null;
    this._clampCameraToWorld();
    this._clampCameraToWorldWithZoom(this.cameraTarget, this.zoomTarget);
  }

  setCameraTarget(wx, wy) {
    const tx = Number(wx);
    const ty = Number(wy);
    if (Number.isFinite(tx)) this.cameraTarget.x = tx;
    if (Number.isFinite(ty)) this.cameraTarget.y = ty;
    this._viewport = null;
    this._clampCameraToWorldWithZoom(this.cameraTarget, this.zoomTarget);
  }

  panBy(dxScreen, dyScreen) {
    // main.js feeds coords in "local * vp.dpr". Convert back to CSS pixels first.
    const v = this.getViewport();
    const dxCss = (Number(dxScreen) || 0) / (v.dpr || 1);
    const dyCss = (Number(dyScreen) || 0) / (v.dpr || 1);

    const dx = dxCss / v.zoom;
    const dy = dyCss / v.zoom;
    this.camera.x -= dx;
    this.camera.y -= dy;
    this.cameraTarget.x -= dx;
    this.cameraTarget.y -= dy;

    this._viewport = null;
    this._clampCameraToWorld();
    this._clampCameraToWorldWithZoom(this.cameraTarget, this.zoomTarget);
  }

  zoomStep(sign, a, b, alreadyLocal = true) {
    const levels = this.zoomLevels;
    const baseZoom = Number(this.zoomTarget) || this.zoom;
    let idx = levels.indexOf(baseZoom);
    if (idx < 0) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < levels.length; i++) {
        const d = Math.abs(levels[i] - baseZoom);
        if (d < bestD) { bestD = d; best = i; }
      }
      idx = best;
    }

    // sign > 0 should zoom IN (OpenFront-style).
    idx = clamp(idx + (sign > 0 ? 1 : -1), 0, levels.length - 1);
    const nextZoom = levels[idx];

    // Pivot around cursor (canvas-local coords)
    let sx, sy;
    if (a && typeof a === "object") {
      if (typeof a.offsetX === "number" && typeof a.offsetY === "number") {
        sx = a.offsetX;
        sy = a.offsetY;
      } else if (typeof a.clientX === "number") {
        const rect = this.canvas.getBoundingClientRect();
        sx = a.clientX - rect.left;
        sy = a.clientY - rect.top;
      } else {
        sx = 0; sy = 0;
      }
    } else {
      if (!alreadyLocal) {
        const rect = this.canvas.getBoundingClientRect();
        sx = (Number(a) || 0) - rect.left;
        sy = (Number(b) || 0) - rect.top;
      } else {
        sx = Number(a) || 0;
        sy = Number(b) || 0;
      }
    }

    const v0 = this.getViewport();

    // Be tolerant if caller passed device pixels.
    if (v0.dpr !== 1 && (sx > v0.canvasW + 1 || sy > v0.canvasH + 1)) {
      sx /= v0.dpr;
      sy /= v0.dpr;
    }

    const before = v0.screenToWorld(sx, sy);

    this.zoomTarget = nextZoom;

    const camX = (v0.canvasW * 0.5 - sx) / nextZoom + before.x;
    const camY = (v0.canvasH * 0.5 - sy) / nextZoom + before.y;
    this.cameraTarget.x = camX;
    this.cameraTarget.y = camY;

    this._viewport = null;
    this._clampCameraToWorldWithZoom(this.cameraTarget, this.zoomTarget);
  }

  getViewport() {
    if (this._viewport) return this._viewport;
    this._viewport = this._computeViewport();
    return this._viewport;
  }

  _computeViewport() {
    const dpr = this.dpr || 1;
    const canvasW = this.canvas.width / dpr;
    const canvasH = this.canvas.height / dpr;

    const zoom = this.zoom;

    const dx = canvasW * 0.5 - this.camera.x * zoom;
    const dy = canvasH * 0.5 - this.camera.y * zoom;

    const worldToScreen = (wx, wy) => ({ x: dx + wx * zoom, y: dy + wy * zoom });
    const screenToWorld = (sx, sy) => ({ x: (sx - dx) / zoom, y: (sy - dy) / zoom });

    return { dpr, canvasW, canvasH, zoom, dx, dy, worldToScreen, screenToWorld };
  }

  _getVisibleWorldRect(v, padTiles = 2) {
    const z = Math.max(0.0001, Number(v.zoom) || 1);
    const invZ = 1 / z;
    const pad = Math.max(0, padTiles | 0);

    let sx0 = Math.floor((-v.dx) * invZ) - pad;
    let sy0 = Math.floor((-v.dy) * invZ) - pad;
    let sx1 = Math.ceil((v.canvasW - v.dx) * invZ) + pad;
    let sy1 = Math.ceil((v.canvasH - v.dy) * invZ) + pad;

    sx0 = clamp(sx0, 0, this.world.w);
    sy0 = clamp(sy0, 0, this.world.h);
    sx1 = clamp(sx1, 0, this.world.w);
    sy1 = clamp(sy1, 0, this.world.h);

    const sw = Math.max(0, sx1 - sx0);
    const sh = Math.max(0, sy1 - sy0);

    return {
      sx: sx0,
      sy: sy0,
      sw,
      sh,
      dx: v.dx + sx0 * z,
      dy: v.dy + sy0 * z,
      dw: sw * z,
      dh: sh * z
    };
  }

  _drawWorldLayerCulled(ctx, layerCanvas, vis) {
    if (!layerCanvas || !vis || vis.sw <= 0 || vis.sh <= 0) return;
    ctx.drawImage(
      layerCanvas,
      vis.sx, vis.sy, vis.sw, vis.sh,
      vis.dx, vis.dy, vis.dw, vis.dh
    );
  }

  _drawClaimTransitionsWorld(ctx, v, vis) {
    if (!ctx || !v || !vis) return;
    const world = this.world;
    if (!world || this._clientSettings?.reduceMotion) return;
    if (!(vis.sw > 0 && vis.sh > 0)) return;

    const claimBuf = (typeof world._getClaimFxBuffer === "function") ? world._getClaimFxBuffer() : null;
    const neutralBuf = (typeof world._getNukeNeutralizeFxBuffer === "function")
      ? world._getNukeNeutralizeFxBuffer()
      : null;

    const claimCap = claimBuf ? (claimBuf.cap | 0) : 0;
    const claimCount = claimBuf ? (claimBuf.count | 0) : 0;
    const hasClaimFx = claimCap > 0 && claimCount > 0
      && claimBuf.idx && claimBuf.owner && claimBuf.prevOwner && claimBuf.stamp;

    const neutralCap = neutralBuf ? (neutralBuf.cap | 0) : 0;
    const neutralCount = neutralBuf ? (neutralBuf.count | 0) : 0;
    const hasNeutralFx = neutralCap > 0 && neutralCount > 0
      && neutralBuf.idx && neutralBuf.stamp;

    if (!hasClaimFx && !hasNeutralFx) return;

    const lowPower = !!this._clientSettings?.lowPowerOverlays;
    const claimLifeS = lowPower ? 0.16 : 0.24;
    const claimMaxScan = lowPower ? 1400 : 4200;
    const neutralLifeS = lowPower ? 0.85 : 1.65;
    const neutralMaxScan = lowPower ? 900 : 2600;
    const now = Number(world.time) || 0;
    const z = Number(v.zoom) || 1;
    if (!(z > 0)) return;

    const xMin = (vis.sx | 0) - 1;
    const yMin = (vis.sy | 0) - 1;
    const xMax = (vis.sx + vis.sw + 1) | 0;
    const yMax = (vis.sy + vis.sh + 1) | 0;
    const w = world.w | 0;

    const tintCache = new Map();

    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    if (hasClaimFx) {
      const idxArr = claimBuf.idx;
      const ownerArr = claimBuf.owner;
      const prevOwnerArr = claimBuf.prevOwner;
      const stampArr = claimBuf.stamp;
      let slot = ((claimBuf.write | 0) - 1 + claimCap) % claimCap;
      let scanned = 0;
      let left = Math.min(claimCount, claimCap);

      while (left > 0 && scanned < claimMaxScan) {
        const t0 = Number(stampArr[slot]) || 0;
        const age = now - t0;
        if (age > claimLifeS) break;
        if (age >= 0) {
          const idx = idxArr[slot] | 0;
          const ownerId = ownerArr[slot] | 0;
          const prevOwnerId = prevOwnerArr[slot] | 0;
          if (ownerId > OWNER.NONE && idx >= 0) {
            const y = (idx / w) | 0;
            const x = (idx - y * w) | 0;
            if (x >= xMin && x < xMax && y >= yMin && y < yMax) {
              let tint = tintCache.get(ownerId);
              if (!tint) {
                tint = (typeof world.getOwnerTint === "function")
                  ? world.getOwnerTint(ownerId)
                  : { r: 220, g: 220, b: 220 };
                tintCache.set(ownerId, tint);
              }

              const u = clamp01(age / claimLifeS);
              const ease = u * u * (3 - 2 * u);
              const remain = 1 - ease;
              const flashA = lowPower ? (0.020 * remain * remain) : (0.042 * remain * remain);
              const newTintA = lowPower ? (0.030 * remain) : (0.060 * remain);

              const sx = v.dx + x * z;
              const sy = v.dy + y * z;

              if (prevOwnerId > OWNER.NONE) {
                let prevTint = tintCache.get(prevOwnerId);
                if (!prevTint) {
                  prevTint = (typeof world.getOwnerTint === "function")
                    ? world.getOwnerTint(prevOwnerId)
                    : { r: 140, g: 140, b: 140 };
                  tintCache.set(prevOwnerId, prevTint);
                }
                const oldTintA = lowPower ? (0.080 * remain) : (0.135 * remain);
                if (oldTintA > 0.003) {
                  ctx.fillStyle = `rgba(${prevTint.r | 0},${prevTint.g | 0},${prevTint.b | 0},${oldTintA})`;
                  ctx.fillRect(sx, sy, z, z);
                }
              }

              if (newTintA > 0.003) {
                ctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${newTintA})`;
                ctx.fillRect(sx, sy, z, z);
              }
              if (flashA > 0.004) {
                ctx.fillStyle = `rgba(255,255,255,${flashA})`;
                ctx.fillRect(sx, sy, z, z);
              }
            }
          }
        }

        slot = (slot - 1 + claimCap) % claimCap;
        scanned++;
        left--;
      }
    }

    if (hasNeutralFx) {
      const idxArr = neutralBuf.idx;
      const stampArr = neutralBuf.stamp;
      let slot = ((neutralBuf.write | 0) - 1 + neutralCap) % neutralCap;
      let scanned = 0;
      let left = Math.min(neutralCount, neutralCap);

      while (left > 0 && scanned < neutralMaxScan) {
        const t0 = Number(stampArr[slot]) || 0;
        const age = now - t0;
        if (age > neutralLifeS) break;
        if (age >= 0) {
          const idx = idxArr[slot] | 0;
          if (idx >= 0) {
            const y = (idx / w) | 0;
            const x = (idx - y * w) | 0;
            if (x >= xMin && x < xMax && y >= yMin && y < yMax) {
              const u = clamp01(age / neutralLifeS);
              const ease = u * u * (3 - 2 * u);
              const remain = 1 - ease;
              const tintA = lowPower ? (0.078 * remain) : (0.148 * remain);
              const glowA = lowPower ? (0.044 * remain * remain) : (0.082 * remain * remain);

              if (tintA > 0.002 || glowA > 0.002) {
                const sx = v.dx + x * z;
                const sy = v.dy + y * z;
                if (tintA > 0.002) {
                  ctx.fillStyle = `rgba(92,234,124,${tintA})`;
                  ctx.fillRect(sx, sy, z, z);
                }
                if (glowA > 0.002) {
                  ctx.fillStyle = `rgba(154,255,174,${glowA})`;
                  ctx.fillRect(sx, sy, z, z);
                }
              }
            }
          }
        }

        slot = (slot - 1 + neutralCap) % neutralCap;
        scanned++;
        left--;
      }
    }

    ctx.restore();
  }

  // main.js/input.js feed canvas-local coords (often multiplied by vp.dpr).
  screenToWorldCell(a, b, alreadyLocal = true) {
    let sx, sy;

    if (a && typeof a === "object") {
      if (typeof a.offsetX === "number" && typeof a.offsetY === "number") {
        sx = a.offsetX;
        sy = a.offsetY;
      } else if (typeof a.clientX === "number") {
        const rect = this.canvas.getBoundingClientRect();
        sx = a.clientX - rect.left;
        sy = a.clientY - rect.top;
      } else {
        sx = 0; sy = 0;
      }
    } else {
      if (!alreadyLocal) {
        const rect = this.canvas.getBoundingClientRect();
        sx = (Number(a) || 0) - rect.left;
        sy = (Number(b) || 0) - rect.top;
      } else {
        sx = Number(a) || 0;
        sy = Number(b) || 0;
      }
    }

    const v = this.getViewport();

    // If passed device pixels, convert to CSS pixels.
    if (v.dpr !== 1 && (sx > v.canvasW + 1 || sy > v.canvasH + 1)) {
      sx /= v.dpr;
      sy /= v.dpr;
    }

    const wpos = v.screenToWorld(sx, sy);
    const x = Math.floor(wpos.x);
    const y = Math.floor(wpos.y);
    if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h) return null;
    return { x, y };
  }

  worldCellToScreenCenter(cx, cy) {
    const v = this.getViewport();
    return v.worldToScreen(cx + 0.5, cy + 0.5);
  }

  // ===== Selection API used by main.js =====
  paintSelectionIndex(idx, rgba) {
    const i = (idx | 0) << 2;
    const d = this.selectionImage.data;

    const r = (rgba?.r ?? rgba?.[0] ?? 0) | 0;
    const g = (rgba?.g ?? rgba?.[1] ?? 0) | 0;
    const b = (rgba?.b ?? rgba?.[2] ?? 0) | 0;
    const a = (rgba?.a ?? rgba?.[3] ?? 255) | 0;

    d[i + 0] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
    if (a > 0) this._selectionHasPixels = true;
    this.selectionDirty = true;
  }

  // Backwards-compatible helper (supports (idx, [r,g,b,a]) OR (x,y,r,g,b,a))
  setSelectionPixel(a, b, c, d, e, f) {
    if (typeof f === "number") {
      const x = a | 0, y = b | 0;
      if (x < 0 || y < 0 || x >= this.world.w || y >= this.world.h) return;
      const idx = (y * this.world.w + x) | 0;
      this.paintSelectionIndex(idx, { r: c | 0, g: d | 0, b: e | 0, a: f | 0 });
      return;
    }

    // (idx, rgba)
    const idx = a | 0;
    const rgba = b;
    this.paintSelectionIndex(idx, rgba);
  }
  clearSelection() {
    this.selectionImage.data.fill(0);
    this.selectionDirty = true;
    this.selectionOutlineImage.data.fill(0);
    this.selectionOutlineDirty = true;
    this._selectionHasPixels = false;
  }
  presentSelection() {
    if (!this.selectionDirty && !this.selectionOutlineDirty) return;

    if (this.selectionDirty) {
      this.selectionCtx.putImageData(this.selectionImage, 0, 0);
      this.selectionDirty = false;

      // Outline depends on the latest selection pixels
      this._rebuildSelectionOutline();
      this.selectionOutlineDirty = true;
    }

    if (this.selectionOutlineDirty) {
      this.selectionOutlineCtx.putImageData(this.selectionOutlineImage, 0, 0);
      this.selectionOutlineDirty = false;
    }
  }

  _rebuildSelectionOutline() {
    const w = this.world.w | 0;
    const h = this.world.h | 0;

    const src = this.selectionImage.data;
    const out = this.selectionOutlineImage.data;
    out.fill(0);

    // Tinted outline, constant 1px in world-space.
    // A pixel is part of the outline if it is selected and at least one 4-neighbor is not selected.
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        const pSrc = idx << 2;
        const a = src[pSrc + 3] | 0;
        if (a <= 0) continue;

        let edge = false;
        if (x === 0 || (src[((idx - 1) << 2) + 3] | 0) === 0) edge = true;
        else if (x === w - 1 || (src[((idx + 1) << 2) + 3] | 0) === 0) edge = true;
        else if (y === 0 || (src[((idx - w) << 2) + 3] | 0) === 0) edge = true;
        else if (y === h - 1 || (src[((idx + w) << 2) + 3] | 0) === 0) edge = true;

        if (!edge) continue;
        const sr = src[pSrc + 0] | 0;
        const sg = src[pSrc + 1] | 0;
        const sb = src[pSrc + 2] | 0;

        // Darken selection color for a clean, readable edge.
        const p = idx << 2;
        out[p + 0] = (sr * 0.55) | 0;
        out[p + 1] = (sg * 0.55) | 0;
        out[p + 2] = (sb * 0.55) | 0;
        out[p + 3] = 220;
      }
    }
  }

  // ===== Hover API used by main.js =====
  setHoverOwner(ownerId, rgba) {
    const id = ownerId | 0;

    const nr = (rgba?.r ?? 255) | 0;
    const ng = (rgba?.g ?? 255) | 0;
    const nb = (rgba?.b ?? 255) | 0;
    const na = (rgba?.a ?? 60) | 0;

    if (this._hoverOwner === id &&
        this._hoverRGBA.r === nr &&
        this._hoverRGBA.g === ng &&
        this._hoverRGBA.b === nb &&
        this._hoverRGBA.a === na) return;

    this._hoverOwner = id;
    this._hoverRGBA = { r: nr, g: ng, b: nb, a: na };
    this._rebuildHoverOverlay();
  }

  _rebuildHoverOverlay() {
    const w = this.world.w | 0;
    const h = this.world.h | 0;
    const data = this.hoverImage.data;
    data.fill(0);

    const id = this._hoverOwner | 0;
    if (!id || id === OWNER.NONE) {
      this.hoverDirty = true;
      return;
    }

    const r = this._hoverRGBA.r | 0;
    const g = this._hoverRGBA.g | 0;
    const b = this._hoverRGBA.b | 0;
    const a = this._hoverRGBA.a | 0;

    const ownerTiles = (typeof this.world._getOwnerTiles === "function") ? this.world._getOwnerTiles(id) : null;
    if (ownerTiles && ownerTiles.length) {
      for (let i = 0; i < ownerTiles.length; i++) {
        const idx = ownerTiles[i] | 0;
        const p = idx << 2;
        data[p + 0] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = a;
      }
      this.hoverDirty = true;
      return;
    }

    const ownerArr = this.world.owner || this.world.owners || null;
    if (!ownerArr || ownerArr.length !== w * h) {
      this.hoverDirty = true;
      return;
    }

    for (let i = 0; i < ownerArr.length; i++) {
      if ((ownerArr[i] | 0) !== id) continue;
      const p = i << 2;
      data[p + 0] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = a;
    }

    this.hoverDirty = true;
  }

  presentHover() {
    if (!this.hoverDirty) return;
    this.hoverCtx.putImageData(this.hoverImage, 0, 0);
    this.hoverDirty = false;
  }

  // ===== Tile pressure heatmap overlay =====
  presentHeatmap() {
    if (!this._clientSettings?.showHeatmap) return;
    if (!this._ensureHeatmapSurface()) return;

    const world = this.world;
    const pressure = world?.tilePressure || null;
    if (!pressure || pressure.length !== ((world.w | 0) * (world.h | 0))) return;

    const now = (world && typeof world.time === "number") ? world.time : 0;
    const version = (world && typeof world.tilePressureVersion === "number") ? world.tilePressureVersion : 0;

    const lowPower = !!this._clientSettings?.lowPowerOverlays;
    const UPDATE_INTERVAL_S = lowPower ? 0.95 : 0.28;
    if (!this._heatmapDirty && (version === this._heatmapLastVersion) && ((now - this._heatmapLastT) < UPDATE_INTERVAL_S)) {
      return;
    }
    if ((now - this._heatmapLastT) < UPDATE_INTERVAL_S && !this._heatmapDirty) {
      return;
    }

    this._heatmapLastVersion = version;
    this._heatmapLastT = now;

    this._rebuildHeatmapOverlay();
    this.heatmapCtx.putImageData(this.heatmapImage, 0, 0);
    this._heatmapDirty = false;
  }

  presentNationHighlight() {
    if (!this._clientSettings?.highlightNation) return;
    if (!this._ensureHighlightSurface()) return;

    const world = this.world;
    const owner = world?.owner || null;
    const land = world?.land || null;
    if (!owner || !land) return;

    const w = world.w | 0;
    const h = world.h | 0;
    const ownerVersion = world.ownerVersion | 0;
    const lowPower = !!this._clientSettings?.lowPowerOverlays;
    const sizeChanged =
      !this.highlightImage ||
      !this.highlightImage.data ||
      this.highlightImage.data.length !== (w * h * 4);
    if (sizeChanged) {
      if (!this._ensureHighlightSurface()) return;
      this._highlightDirty = true;
      this._highlightLastOwnerVersion = -1;
    }

    const prevVersion = this._highlightLastOwnerVersion | 0;
    if (!this._highlightDirty && ownerVersion === prevVersion && (this._highlightFullRebuildRow | 0) < 0) return;

    let fullRebuild = this._highlightDirty || sizeChanged || prevVersion < 0 || ownerVersion < prevVersion;
    let dirtyItems = null;

    if (!fullRebuild && ownerVersion !== prevVersion) {
      if (typeof world._consumeOwnerDirty === "function") {
        const delta = this._consumeOwnerDirtyFrame(ownerVersion);
        if (delta?.full) {
          fullRebuild = true;
        } else if (Array.isArray(delta?.items) && delta.items.length > 0) {
          dirtyItems = delta.items;
        } else {
          this._highlightLastOwnerVersion = ownerVersion;
          this._highlightDirty = false;
          return;
        }
      } else {
        fullRebuild = true;
      }
    }

    const maxDirtyBeforeFull = lowPower ? 70000 : 150000;
    if (!fullRebuild && dirtyItems && dirtyItems.length > maxDirtyBeforeFull) {
      fullRebuild = true;
      dirtyItems = null;
    }

    if (fullRebuild || !dirtyItems) {
      const rowsPerFrame = lowPower ? 96 : 176;
      let y0 = this._highlightFullRebuildRow | 0;
      if (y0 <= 0 || y0 >= h) {
        y0 = 0;
        this.highlightImage.data.fill(0);
      }
      const y1 = Math.min(h, y0 + rowsPerFrame);
      this._rebuildNationHighlightOverlayRows(y0, y1);
      this.highlightCtx.putImageData(this.highlightImage, 0, 0, 0, y0, w, y1 - y0);

      if (y1 < h) {
        this._highlightFullRebuildRow = y1;
        this._highlightLastOwnerVersion = ownerVersion;
        this._highlightDirty = true;
        return;
      }

      this._highlightFullRebuildRow = -1;
      this._highlightLastOwnerVersion = ownerVersion;
      this._highlightDirty = false;
      return;
    }

    this._highlightFullRebuildRow = -1;
    const data = this.highlightImage.data;
    const BIN_SHIFT = 6; // 64x64 upload bins
    const BIN_SIZE = 1 << BIN_SHIFT;
    const binsW = Math.ceil(w / BIN_SIZE);
    const dirtyBins = new Set();

    for (let i = 0; i < dirtyItems.length; i++) {
      const idx = dirtyItems[i] | 0;
      if (idx < 0 || idx >= (w * h)) continue;

      this._writeNationHighlightPixel(idx, data, owner, land);

      const x = idx % w;
      const y = (idx / w) | 0;
      const bx = x >> BIN_SHIFT;
      const by = y >> BIN_SHIFT;
      dirtyBins.add((by * binsW + bx) | 0);
    }

    for (const bid0 of dirtyBins) {
      const bid = bid0 | 0;
      const bx = (bid % binsW) << BIN_SHIFT;
      const by = ((bid / binsW) | 0) << BIN_SHIFT;
      const bw = Math.min(BIN_SIZE, w - bx);
      const bh = Math.min(BIN_SIZE, h - by);
      if (bw <= 0 || bh <= 0) continue;
      this.highlightCtx.putImageData(this.highlightImage, 0, 0, bx, by, bw, bh);
    }

    this._highlightLastOwnerVersion = ownerVersion;
    this._highlightDirty = false;
  }

  _writeNationHighlightPixel(idxRaw, data, owner, land) {
    const idx = idxRaw | 0;
    if (idx < 0) return;

    const p = idx << 2;
    if (!land[idx]) {
      data[p + 0] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 0;
      return;
    }

    const o = owner[idx] | 0;
    if (o === OWNER.PLAYER) {
      data[p + 0] = 130;
      data[p + 1] = 198;
      data[p + 2] = 255;
      data[p + 3] = 68;
      return;
    }

    if (o > OWNER.NONE) {
      data[p + 0] = 14;
      data[p + 1] = 16;
      data[p + 2] = 26;
      data[p + 3] = 28;
      return;
    }

    data[p + 0] = 0;
    data[p + 1] = 0;
    data[p + 2] = 0;
    data[p + 3] = 0;
  }

  _rebuildNationHighlightOverlay() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    const owner = world.owner || null;
    const land = world.land || null;
    const data = this.highlightImage.data;
    data.fill(0);
    if (!owner || !land || owner.length !== (w * h) || land.length !== (w * h)) return;

    this._rebuildNationHighlightOverlayRows(0, h);
  }

  _rebuildNationHighlightOverlayRows(yStartRaw, yEndRaw) {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    const owner = world.owner || null;
    const land = world.land || null;
    const data = this.highlightImage.data;
    if (!owner || !land || owner.length !== (w * h) || land.length !== (w * h)) return;

    const yStart = Math.max(0, Math.min(h, yStartRaw | 0));
    const yEnd = Math.max(yStart, Math.min(h, yEndRaw | 0));
    for (let y = yStart; y < yEnd; y++) {
      let idx = (y * w) | 0;
      const rowEnd = idx + w;
      for (; idx < rowEnd; idx++) {
        this._writeNationHighlightPixel(idx, data, owner, land);
      }
    }
  }

  _rebuildHeatmapOverlay() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    const pressure = world.tilePressure || null;
    const land = world.land || null;

    const data = this.heatmapImage.data;
    data.fill(0);

    if (!pressure || pressure.length !== (w * h)) return;

    const peakRaw = Math.max(1, Number(world.tilePressurePeak) || 1);
    const peakLog = Math.log1p(peakRaw);
    if (!(peakLog > 0)) return;

    for (let idx = 0; idx < pressure.length; idx++) {
      if (land && !land[idx]) continue;

      const v = Number(pressure[idx]) || 0;
      if (v <= 0.015) continue;

      const t = clamp01(Math.log1p(v) / peakLog);
      if (t <= 0.01) continue;

      let r = 0;
      let g = 0;
      let b = 0;

      if (t < 0.25) {
        const u = t / 0.25;
        r = lerp(22, 56, u);
        g = lerp(80, 168, u);
        b = lerp(180, 228, u);
      } else if (t < 0.55) {
        const u = (t - 0.25) / 0.30;
        r = lerp(56, 244, u);
        g = lerp(168, 206, u);
        b = lerp(228, 92, u);
      } else {
        const u = (t - 0.55) / 0.45;
        r = lerp(244, 255, u);
        g = lerp(206, 74, u);
        b = lerp(92, 64, u);
      }

      const alpha = Math.round(32 + 170 * t);
      const p = idx << 2;
      data[p + 0] = r | 0;
      data[p + 1] = g | 0;
      data[p + 2] = b | 0;
      data[p + 3] = alpha | 0;
    }
  }

  rebuildPoliticalMap(force = false) {
    const world = this.world;
    if (!world) return;
    if (!this._ensurePoliticalSurface()) return;

    const w = world.w | 0;
    const h = world.h | 0;
    const ownerVersion = world.ownerVersion | 0;
    const seed = (world.seed >>> 0) || 1;
    const now = (typeof world.time === "number") ? world.time : 0;
    const lowPower = !!this._clientSettings?.lowPowerOverlays;

    const sizeChanged =
      !this.politicalImage ||
      !this.politicalImage.data ||
      this.politicalImage.data.length !== (w * h * 4);
    if (sizeChanged) {
      if (!this._ensurePoliticalSurface()) return;
      this._politicalDirty = true;
      force = true;
    }

    const land = world.land || null;
    const owner = world.owner || null;
    if (!land || !owner || land.length !== (w * h) || owner.length !== (w * h)) return;

    const data = this.politicalImage.data;
    const shadeArr = world.shade || null;
    const heightArr = world.height || null;
    const seaLevel = Number.isFinite(Number(world._seaLevel)) ? (world._seaLevel | 0) : 128;

    // Vintage atlas palette: warm parchment land + muted sea + inked borders.
    const neutralLandLight = { r: 228, g: 214, b: 183 };
    const neutralLandDark = { r: 173, g: 148, b: 109 };
    const waterShallow = { r: 108, g: 141, b: 158 };
    const waterDeep = { r: 58, g: 88, b: 113 };
    const borderColor = { r: 83, g: 63, b: 40 };

    const writePixel = (idxRaw) => {
      const idx = idxRaw | 0;
      if (idx < 0 || idx >= (w * h)) return;

      const p = idx << 2;
      const x = idx % w;
      const y = (idx / w) | 0;

      if (!land[idx]) {
        let depthT = 0.62;
        if (heightArr && idx < heightArr.length) {
          const hb = heightArr[idx] | 0;
          depthT = clamp01((seaLevel - hb + 16) / 92);
        }

        const waterMacro = (hash2i(x >> 4, y >> 4, seed ^ 0x51a3bd27) & 255) / 255;
        const waterGrain = (hash2i(x, y, seed ^ 0x0f1e2d3c) & 63) / 63;
        const waterJitter = (waterMacro - 0.5) * 14 + (waterGrain - 0.5) * 8;

        let wr = lerp(waterShallow.r, waterDeep.r, depthT);
        let wg = lerp(waterShallow.g, waterDeep.g, depthT);
        let wb = lerp(waterShallow.b, waterDeep.b, depthT);

        wr += waterJitter * 0.42;
        wg += waterJitter * 0.54;
        wb += waterJitter * 0.72;
        // Slight parchment wash so ocean fits the antique map style.
        wr = lerp(wr, 162, 0.10);
        wg = lerp(wg, 168, 0.08);
        wb = lerp(wb, 154, 0.06);

        data[p + 0] = clamp(wr, 0, 255) | 0;
        data[p + 1] = clamp(wg, 0, 255) | 0;
        data[p + 2] = clamp(wb, 0, 255) | 0;
        data[p + 3] = 255;
        return;
      }

      const o = owner[idx] | 0;
      const shade = shadeArr ? ((shadeArr[idx] | 0) / 255) : 0.55;
      const grain = (hash2i(x, y, seed) & 63) / 63;
      const macro = (hash2i(x >> 4, y >> 4, seed ^ 0x7f4a7c15) & 255) / 255;
      const fiber = (hash2i(x + ((y & 7) << 5), y + ((x & 7) << 5), seed ^ 0x2c1b3c6d) & 255) / 255;
      const tone = clamp01(0.56 * shade + 0.28 * macro + 0.16 * grain);
      const paperJitter = (macro - 0.5) * 20 + (grain - 0.5) * 12 + (fiber - 0.5) * 8;

      let r = lerp(neutralLandDark.r, neutralLandLight.r, tone);
      let g = lerp(neutralLandDark.g, neutralLandLight.g, tone);
      let b = lerp(neutralLandDark.b, neutralLandLight.b, tone);

      // Paper-like uneven pigment for an old-map feel.
      r += paperJitter * 0.88;
      g += paperJitter * 0.62;
      b += paperJitter * 0.36;

      if (o > OWNER.NONE) {
        const tint = (typeof world.getOwnerTint === "function")
          ? world.getOwnerTint(o)
          : { r: 180, g: 180, b: 180 };

        r = lerp(r, tint.r | 0, 0.36);
        g = lerp(g, tint.g | 0, 0.36);
        b = lerp(b, tint.b | 0, 0.36);

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const sat = 0.58;
        r = luma + (r - luma) * sat;
        g = luma + (g - luma) * sat;
        b = luma + (b - luma) * sat;

        r = lerp(r, 233, 0.11);
        g = lerp(g, 223, 0.10);
        b = lerp(b, 197, 0.08);
      }

      // Subtle old-cartography land details: contour and hatch hints.
      // Keep these faint so ownership colors remain readable.
      const hb = (heightArr && idx < heightArr.length)
        ? (heightArr[idx] | 0)
        : (seaLevel + 12);
      const contourNoise = ((x * 3 + y * 5 + (seed & 31)) & 15);
      const contourBand = (hb + contourNoise) & 15;
      if (contourBand === 0 && macro > 0.24) {
        r = lerp(r, 104, 0.16);
        g = lerp(g, 85, 0.16);
        b = lerp(b, 58, 0.16);
      }

      const hatchA = ((x * 5 + y * 7 + (seed & 63)) & 63) === 0;
      const hatchB = ((x * 9 + y * 3 + ((seed >>> 5) & 63)) & 63) === 0;
      if (hatchA || (hatchB && tone < 0.55)) {
        r = lerp(r, 129, 0.09);
        g = lerp(g, 104, 0.09);
        b = lerp(b, 72, 0.09);
      }

      if (typeof world._isRenderBorderCell === "function" && world._isRenderBorderCell(idx)) {
        r = lerp(r, borderColor.r, 0.46);
        g = lerp(g, borderColor.g, 0.46);
        b = lerp(b, borderColor.b, 0.46);
      }

      data[p + 0] = clamp(r, 0, 255) | 0;
      data[p + 1] = clamp(g, 0, 255) | 0;
      data[p + 2] = clamp(b, 0, 255) | 0;
      data[p + 3] = 255;
    };

    let fullRebuild =
      force ||
      this._politicalDirty ||
      this._politicalLastSeed !== seed ||
      this._politicalLastOwnerVersion < 0 ||
      ownerVersion < (this._politicalLastOwnerVersion | 0);

    let dirtyItems = null;

    if (!fullRebuild && ownerVersion !== (this._politicalLastOwnerVersion | 0)) {
      if (typeof world._consumeOwnerDirty === "function") {
        const delta = this._consumeOwnerDirtyFrame(ownerVersion);
        if (delta?.full) {
          fullRebuild = true;
        } else if (Array.isArray(delta?.items) && delta.items.length > 0) {
          dirtyItems = delta.items;
        }
      } else {
        fullRebuild = true;
      }
    }

    if (fullRebuild) {
      const rowsPerFrame = lowPower ? 72 : 128;
      let y0 = this._politicalFullRebuildRow | 0;
      if (y0 <= 0 || y0 >= h) {
        y0 = 0;
        data.fill(0);
      }

      const y1 = Math.min(h, y0 + rowsPerFrame);
      for (let y = y0; y < y1; y++) {
        let idx = (y * w) | 0;
        const rowEnd = idx + w;
        for (; idx < rowEnd; idx++) writePixel(idx);
      }
      this.politicalCtx.putImageData(this.politicalImage, 0, 0, 0, y0, w, y1 - y0);

      if (y1 < h) {
        this._politicalFullRebuildRow = y1;
        this._politicalDirty = true;
        this._politicalLastOwnerVersion = ownerVersion;
        this._politicalLastSeed = seed;
        this._politicalLastRebuildT = now;
        return;
      }

      this._politicalFullRebuildRow = -1;
      this._politicalDirty = false;
      this._politicalLastOwnerVersion = ownerVersion;
      this._politicalLastSeed = seed;
      this._politicalLastRebuildT = now;
      return;
    }

    if (!dirtyItems || dirtyItems.length === 0) {
      this._politicalFullRebuildRow = -1;
      this._politicalDirty = false;
      this._politicalLastOwnerVersion = ownerVersion;
      this._politicalLastSeed = seed;
      this._politicalLastRebuildT = now;
      return;
    }

    const maxDirtyBeforeFull = lowPower ? 90000 : 180000;
    if (dirtyItems.length > maxDirtyBeforeFull) {
      this._politicalDirty = true;
      this._politicalFullRebuildRow = 0;
      return;
    }

    this._politicalFullRebuildRow = -1;
    const BIN_SHIFT = 6; // 64x64 upload bins
    const BIN_SIZE = 1 << BIN_SHIFT;
    const binsW = Math.ceil(w / BIN_SIZE);
    const dirtyBins = new Set();

    for (let i = 0; i < dirtyItems.length; i++) {
      const idx = dirtyItems[i] | 0;
      if (idx < 0 || idx >= (w * h)) continue;
      writePixel(idx);

      const x = idx % w;
      const y = (idx / w) | 0;
      const bx = x >> BIN_SHIFT;
      const by = y >> BIN_SHIFT;
      dirtyBins.add((by * binsW + bx) | 0);
    }

    for (const bid0 of dirtyBins) {
      const bid = bid0 | 0;
      const bx = (bid % binsW) << BIN_SHIFT;
      const by = ((bid / binsW) | 0) << BIN_SHIFT;
      const bw = Math.min(BIN_SIZE, w - bx);
      const bh = Math.min(BIN_SIZE, h - by);
      if (bw <= 0 || bh <= 0) continue;
      this.politicalCtx.putImageData(this.politicalImage, 0, 0, bx, by, bw, bh);
    }

    this._politicalDirty = false;
    this._politicalLastOwnerVersion = ownerVersion;
    this._politicalLastSeed = seed;
    this._politicalLastRebuildT = now;
  }

  // ===== Hatch overlay (contested / newly captured) =====
  presentHatch() {
    const world = this.world;
    const t = (world && typeof world.time === "number") ? world.time : 0;
    const ownerVer = (world && typeof world.ownerVersion === "number") ? world.ownerVersion : 0;
    const ops = world?.operations || [];

    let hasPlayerOps = false;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || (op.attacker | 0) !== OWNER.PLAYER) continue;
      if (op.kind === "neutral" || op.kind === "war" || op.kind === "burst" || op.kind === "burstWar") {
        hasPlayerOps = true;
        break;
      }
    }

    const lastPlayerChange = Number(world?._lastPlayerOwnershipChangeAt || 0);
    const hasRecentPlayerCapture = (t - lastPlayerChange) <= 10.0;
    const needsDynamicHatch = hasPlayerOps || hasRecentPlayerCapture;

    if (!needsDynamicHatch) {
      if (!this.hatchImage || !this.hatchCtx) {
        this._hatchIdle = true;
        this.hatchDirty = false;
        this._hatchLastT = t;
        this._hatchLastOwnerVersion = ownerVer;
        return;
      }
      if (this._hatchIdle && !this.hatchDirty) return;
      this.hatchImage.data.fill(0);
      this.hatchCtx.putImageData(this.hatchImage, 0, 0);
      this._hatchIdle = true;
      this.hatchDirty = false;
      this._hatchLastT = t;
      this._hatchLastOwnerVersion = ownerVer;
      return;
    }

    if (!this._ensureHatchSurface()) return;

    const lowPower = !!this._clientSettings?.lowPowerOverlays;
    let interval = hasPlayerOps ? 0.45 : 0.90;
    if (lowPower) interval *= 2.2;
    if (!this.hatchDirty && (t - this._hatchLastT) < interval) return;

    this._hatchIdle = false;
    this._hatchLastT = t;
    this._hatchLastOwnerVersion = ownerVer;

    this._rebuildHatchOverlay();
    this.hatchCtx.putImageData(this.hatchImage, 0, 0);
    this.hatchDirty = false;
  }

  _rebuildHatchOverlay() {
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;

    const land = world.land || null;
    const owner = world.owner || null;
    const stamp = world.ownerStamp || null;
    const ops = world.operations || [];

    const data = this.hatchImage.data;
    data.fill(0);

    const now = (typeof world.time === "number") ? world.time : 0;

    const CAPTURE_HATCH_S = 10.0;
    const TARGET_ALPHA = 150;
    const CAPTURE_ALPHA = 160;

    // Helper: write a hatch pixel if it is on the diagonal stripe.
    function writeIdx(idx, alpha) {
      if (idx < 0) return;
      const x = idx % w;
      const y = (idx / w) | 0;

      // \ diagonal hatch (like the reference image): (x - y) mod 4 == 0
      if (((x - y) & 3) !== 0) return;

      const p = idx << 2;
      // Keep max alpha if multiple sources overlap
      const curA = data[p + 3] | 0;
      if (alpha <= curA) return;

      data[p + 0] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = alpha | 0;
    }

    // 1) Active player operations (neutral/war) => hatch their remaining target area (contesting)
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;
      if ((op.attacker | 0) !== OWNER.PLAYER) continue;
      if (op.kind !== "neutral" && op.kind !== "war") continue;
      const target = op.target;
      if (!target || typeof target.forEach !== "function") continue;
      target.forEach((idx) => {
        if (land && !land[idx]) return;
        writeIdx(idx | 0, TARGET_ALPHA);
      });
    }

    // 2) Newly captured player land (both from neutral and war) => hatch fades out over time
    const playerTiles = (typeof world._getOwnerTiles === "function") ? world._getOwnerTiles(OWNER.PLAYER) : null;
    if (playerTiles && stamp && land && stamp.length === w * h) {
      for (let i = 0; i < playerTiles.length; i++) {
        const idx = playerTiles[i] | 0;
        if (!land[idx]) continue;
        const age = now - (stamp[idx] || 0);
        if (age < 0 || age > CAPTURE_HATCH_S) continue;
        const t01 = 1 - (age / CAPTURE_HATCH_S);
        const a = (CAPTURE_ALPHA * t01) | 0;
        if (a > 0) writeIdx(idx, a);
      }
    } else if (land && owner && stamp && land.length === w * h && owner.length === w * h && stamp.length === w * h) {
      for (let idx = 0; idx < w * h; idx++) {
        if (!land[idx]) continue;
        if ((owner[idx] | 0) !== OWNER.PLAYER) continue;
        const age = now - (stamp[idx] || 0);
        if (age < 0 || age > CAPTURE_HATCH_S) continue;
        const t01 = 1 - (age / CAPTURE_HATCH_S);
        const a = (CAPTURE_ALPHA * t01) | 0;
        if (a > 0) writeIdx(idx, a);
      }
    }
  }

  markWorldDirty() { this.worldDirty = true; }

  _copyPixelsRect(src, dst, worldW, rect) {
    const x0 = rect.x | 0;
    const y0 = rect.y | 0;
    const rw = rect.w | 0;
    const rh = rect.h | 0;
    if (rw <= 0 || rh <= 0) return;

    const rowBytes = (rw * 4) | 0;
    for (let y = 0; y < rh; y++) {
      const srcStart = (((y0 + y) * worldW + x0) * 4) | 0;
      const srcEnd = (srcStart + rowBytes) | 0;
      dst.set(src.subarray(srcStart, srcEnd), srcStart);
    }
  }

  _gradeOwnedPixelsRect(data, rect) {
    const world = this.world;
    const landArr = world.land || world.landMask || null;
    const ownerArr = world.owner || world.owners || null;
    if (!landArr || !ownerArr) return;

    const w = world.w | 0;
    const h = world.h | 0;
    if (landArr.length !== w * h || ownerArr.length !== w * h) return;

    const x0 = Math.max(0, rect.x | 0);
    const y0 = Math.max(0, rect.y | 0);
    const x1 = Math.min(w, x0 + (rect.w | 0));
    const y1 = Math.min(h, y0 + (rect.h | 0));
    if (x1 <= x0 || y1 <= y0) return;

    const contrast = 1.12;
    const sat = 1.18;
    const dark = 0.92;

    for (let y = y0; y < y1; y++) {
      let idx = y * w + x0;
      for (let x = x0; x < x1; x++, idx++) {
        if (!landArr[idx]) continue;
        if ((ownerArr[idx] | 0) === OWNER.NONE) continue;

        const p = idx << 2;
        let r = data[p + 0];
        let g = data[p + 1];
        let b = data[p + 2];

        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;

        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;

        r *= dark;
        g *= dark;
        b *= dark;

        data[p + 0] = r < 0 ? 0 : (r > 255 ? 255 : r) | 0;
        data[p + 1] = g < 0 ? 0 : (g > 255 ? 255 : g) | 0;
        data[p + 2] = b < 0 ? 0 : (b > 255 ? 255 : b) | 0;
      }
    }
  }

  // ===== Map texture generation =====
  rebuildWorldTexture(force = false) {
    const w = this.world.w | 0;
    const h = this.world.h | 0;
    const worldFlagDirty = !!this.world.dirty;

    if (!this.worldImage || !this.worldImage.data || this.worldImage.data.length !== (w * h * 4)) {
      this._bindWorldImageBuffer(this.world);
    }
    const data = this.worldImage.data;
    // Fast path: if the World maintains a ready-to-render RGBA buffer, just blit it.
    const vp = this.world.viewPixels;
    if (vp && vp.length === data.length) {
      const dirtyRect = (typeof this.world._consumePixelDirtyRect === "function")
        ? this.world._consumePixelDirtyRect()
        : null;

      if (!dirtyRect && !force && !this.worldDirty && !worldFlagDirty) return;

      if (dirtyRect) {
        if (!this._worldImageUsesViewPixels) {
          if (dirtyRect.full) data.set(vp);
          else this._copyPixelsRect(vp, data, w, dirtyRect);
        }

        if (dirtyRect.full) {
          this.worldCtx.putImageData(this.worldImage, 0, 0);
        } else {
          this.worldCtx.putImageData(
            this.worldImage,
            0,
            0,
            dirtyRect.x | 0,
            dirtyRect.y | 0,
            dirtyRect.w | 0,
            dirtyRect.h | 0
          );
        }
      } else {
        // No new world pixels; still allow a forced refresh of the offscreen texture.
        if (force) this.worldCtx.putImageData(this.worldImage, 0, 0);
      }

      this.worldDirty = false;
      this.world.dirty = false;
      return;
    }

    if (!force && !this.worldDirty && !worldFlagDirty) return;

    if (this.debugChecker) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (x + y * w) << 2;
          const on = (((x >> 3) ^ (y >> 3)) & 1) === 1;
          data[i + 0] = on ? 255 : 0;
          data[i + 1] = on ? 0 : 255;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
      this.worldCtx.putImageData(this.worldImage, 0, 0);
      this.worldDirty = false;
      this.world.dirty = false;
      return;
    }

    // Fallback procedural map (only used if world.viewPixels isn't available)
    const landArr = this.world.land || this.world.landMask || null;
    const heightArr = this.world.height || this.world.heights || null;
    const ownerArr = this.world.owner || this.world.owners || null;

    const OCEAN_DEEP = rgb(6, 20, 58);
    const OCEAN_SHALLOW = rgb(18, 74, 130);
    const BEACH = rgb(206, 196, 146);
    const GRASS = rgb(78, 142, 92);
    const FOREST = rgb(42, 104, 66);
    const MOUNTAIN = rgb(128, 128, 136);
    const SNOW = rgb(234, 236, 240);

    // Choose sea threshold from height if available
    let sea = 0.5;
    if (heightArr && heightArr.length === w * h) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < heightArr.length; i++) hist[heightArr[i] | 0]++;
      const total = w * h;
      const wantLand = Math.floor(total * 0.42);
      let acc = 0;
      for (let s = 255; s >= 0; s--) {
        acc += hist[s] | 0;
        const landCount = total - acc;
        if (landCount >= wantLand) { sea = s / 255; break; }
      }
    }

    const tintByOwner = new Map();

    for (let y = 0; y < h; y++) {
      const lat = Math.abs((y / Math.max(1, h - 1)) * 2 - 1); // 0 eq -> 1 poles
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const i = idx << 2;

        const u = x / Math.max(1, w - 1);
        const v = y / Math.max(1, h - 1);

        const detail = fbm01(1337, u * 6.0, v * 6.0, 4);
        const moist01 = fbm01(9001, u * 2.2, v * 2.2, 4);
        const temp01 = clamp01((1 - lat) + (fbm01(7007, u * 2.0, v * 2.0, 3) - 0.5) * 0.25);

        const isLand = landArr ? !!landArr[idx] : (detail > 0.52);

        let col;
        if (!isLand) {
          const d = clamp01(0.5 + (detail - 0.5) * 1.2);
          col = mixRGB(OCEAN_DEEP, OCEAN_SHALLOW, d);
        } else {
          let height01 = detail;
          if (heightArr && heightArr.length === w * h) height01 = (heightArr[idx] | 0) / 255;

          const elev = clamp((height01 - sea) / (1.0 - sea), 0, 1);

          if (elev < 0.06) col = mixRGB(BEACH, GRASS, elev / 0.06);
          else if (elev < 0.35) col = mixRGB(GRASS, FOREST, clamp((moist01 - 0.25) / 0.6, 0, 1));
          else if (elev < 0.70) col = mixRGB(FOREST, MOUNTAIN, (elev - 0.35) / 0.35);
          else {
            const snowBias = clamp((lat - 0.55) / 0.35, 0, 1);
            const t = clamp(((elev - 0.70) / 0.30) * 0.7 + snowBias * 0.6, 0, 1);
            col = mixRGB(MOUNTAIN, SNOW, t);
          }
        }

        if (ownerArr && ownerArr.length === w * h) {
          const o = ownerArr[idx] | 0;
          if (o !== OWNER.NONE) {
            let tint = tintByOwner.get(o);
            if (!tint) {
              const hsh = hash2i(o * 31, o * 97, 1337);
              tint = rgb(
                80 + ((hsh >>> 0) & 127),
                80 + ((hsh >>> 8) & 127),
                80 + ((hsh >>> 16) & 127)
              );
              tintByOwner.set(o, tint);
            }
            col = mixRGB(col, tint, 0.22);
          }
        }

        data[i + 0] = col[0];
        data[i + 1] = col[1];
        data[i + 2] = col[2];
        data[i + 3] = 255;
      }
    }

    this.worldCtx.putImageData(this.worldImage, 0, 0);
    this.worldDirty = false;
    this.world.dirty = false;
  }

  _drawBordersWorld(ctx, v) {
    return; // borders are pixel-rendered in world.viewPixels
    const world = this.world;
    const w = world.w | 0;
    const h = world.h | 0;
    const land = world.land;
    const owner = world.owner;

    if (!owner || owner.length !== w * h) return;

    ctx.save();
    ctx.lineWidth = 1.8 / v.zoom; // constant screen thickness (slightly thicker)
    ctx.strokeStyle = "rgba(0,0,0,0.92)";
    ctx.beginPath();

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        const l0 = land ? (land[idx] | 0) : 1;
        const o0 = owner ? (owner[idx] | 0) : 0;

        // right edge
        if (x < w - 1) {
          const idxR = idx + 1;
          const l1 = land ? (land[idxR] | 0) : 1;
          const o1 = owner ? (owner[idxR] | 0) : 0;
          if ((l0 !== l1) || (l0 && l1 && o0 !== o1)) {
            const xx = x + 1;
            ctx.moveTo(xx, y);
            ctx.lineTo(xx, y + 1);
          }
        }

        // bottom edge
        if (y < h - 1) {
          const idxD = idx + w;
          const l1 = land ? (land[idxD] | 0) : 1;
          const o1 = owner ? (owner[idxD] | 0) : 0;
          if ((l0 !== l1) || (l0 && l1 && o0 !== o1)) {
            const yy = y + 1;
            ctx.moveTo(x, yy);
            ctx.lineTo(x + 1, yy);
          }
        }
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  _drawStructuresScreen(ctx, v, selectedStructureId) {
  const world = this.world;
  const list = world.structures || [];
  if (!list.length) return;
  if ((Number(v.zoom) || 1) < (Number(STRUCTURE_HIDE_ZOOM) || 0)) return;
  const showAIStructures = this._clientSettings?.showAIStructures !== false;
  const zoom = Number(v.zoom) || 1;
  const dx = Number(v.dx) || 0;
  const dy = Number(v.dy) || 0;

  ctx.save();
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // Render structures as a 3x3 *world-pixel footprint* (matches the placement
  // footprint). On-screen size therefore scales with zoom: sizePx = 3 * zoom.
  // Slightly overscale the icon but clip it to the logical 3x3 box so it fills
  // the square cleanly without bleeding outside the footprint.
  const box = Math.max(3, (3 * (zoom | 0)) | 0);       // logical footprint box (for badge/highlight)
  const size = Math.max(box, Math.round(box * 1.35));    // draw larger, then clip to box
  const halfBox = box * 0.5;
  const half = size * 0.5;

  // Small badge for stacked structures.
  const badgeR = 6;

  for (const st of list) {
    if (!showAIStructures && (st.owner | 0) !== OWNER.PLAYER) continue;

    const wx = (st.x | 0) + 0.5;
    const wy = (st.y | 0) + 0.5;
    const sx = dx + wx * zoom;
    const sy = dy + wy * zoom;

    // Logical 3x3 box (for selection highlight + badge anchor)
    const xBox = Math.round(sx - halfBox);
    const yBox = Math.round(sy - halfBox);

    // Cull off-screen structures early (large maps can have many structures).
    if (xBox + box < -32 || yBox + box < -32 || xBox > v.canvasW + 32 || yBox > v.canvasH + 32) {
      continue;
    }

    // Drawn icon (slightly larger than the logical box)
    const x0 = Math.round(sx - half);
    const y0 = Math.round(sy - half);

    // Selection highlight
    if (selectedStructureId && (st.id | 0) === (selectedStructureId | 0)) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 220, 80, 0.90)";
      ctx.strokeRect(xBox - 3, yBox - 3, box + 6, box + 6);
      ctx.fillStyle = "rgba(255, 220, 80, 0.18)";
      ctx.fillRect(xBox - 3, yBox - 3, box + 6, box + 6);
    }

    // Type-tinted pixel palette mixed with owner tint so nations remain visually distinct.
    const tint = world.getOwnerTint ? world.getOwnerTint(st.owner | 0) : { r: 220, g: 220, b: 220 };

    let tr = 200, tg = 200, tb = 200;
    if (st.type === "capital") { tr = 255; tg = 220; tb = 80; }
    else if (st.type === "factory") { tr = 255; tg = 140; tb = 60; }
    else if (st.type === "barracks") { tr = 110; tg = 220; tb = 140; }
    else if (st.type === "defence_post") { tr = 140; tg = 200; tb = 255; }
    else if (st.type === "port") { tr = 120; tg = 190; tb = 255; }
    else if (st.type === "missile_silo") { tr = 255; tg = 172; tb = 88; }
    else if (st.type === "abm_launcher") { tr = 255; tg = 126; tb = 96; }
    else if (st.type === "airbase") { tr = 160; tg = 208; tb = 255; }
    else { /* city/default */ tr = 210; tg = 210; tb = 210; }

    const r = ((tr * 0.55) + (tint.r * 0.45)) | 0;
    const g = ((tg * 0.55) + (tint.g * 0.45)) | 0;
    const b = ((tb * 0.55) + (tint.b * 0.45)) | 0;

    // Draw the 3x3 icon. Prefer your PNG assets in /Structures (or /structures).
    ctx.save();
    ctx.beginPath();
    ctx.rect(xBox, yBox, box, box);
    ctx.clip();

    const icon = this._getStructureIcon(st.type);
    if (icon && icon.complete && icon.naturalWidth > 0) {
      ctx.drawImage(icon, x0, y0, size, size);
    } else {
      // Fallback: fill the entire 3x3 so it reads as "3x3" (not 1px).
      ctx.fillStyle = `rgba(${r},${g},${b},0.98)`;
      ctx.fillRect(x0, y0, size, size);

      // Tiny 1px mark for readability without shrinking the perceived size.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      if (st.type === "factory") ctx.fillRect(x0 + 2, y0 + 0, 1, 1);
      else if (st.type === "barracks") ctx.fillRect(x0 + 0, y0 + 0, 1, 1);
      else if (st.type === "capital") ctx.fillRect(x0 + 1, y0 + 1, 1, 1);
      else ctx.fillRect(x0 + 1, y0 + 0, 1, 1);
    }

    ctx.restore();

    // Stack badge (top-right of the 3x3 boundary)
    const count = (st.count | 0) || 1;
    // Hide stack badges when zoomed out (cleaner at macro view).
    const showBadge = ((v.zoom | 0) >= 3);
    if (showBadge && count > 1) {
      const bx = xBox + box + badgeR - 1;
      const by = yBox - 1 + badgeR - 1;

      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.stroke();

      ctx.font = "800 9px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = (count >= 10) ? "rgba(220,40,40,0.95)" : "rgba(0,0,0,0.95)";
      ctx.fillText(String(Math.min(count, 99)), bx, by + 0.5);
    }
  }

  ctx.restore();
}

  _drawDefenceRadiusScreen(ctx, v, selectedStructureId) {
    const sid = selectedStructureId | 0;
    if (!sid) return;
    if ((Number(v.zoom) || 1) < (Number(STRUCTURE_HIDE_ZOOM) || 0)) return;

    const list = this.world.structures || [];
    if (!list.length) return;

    let st = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s && (s.id | 0) === sid) { st = s; break; }
    }
    if (!st) return;

    const type = String(st.type || "");
    const isDefencePost = type === "defence_post";
    const isCapital = type === "capital";
    const isAbm = type === "abm_launcher";
    const isAirbase = type === "airbase";
    if (!isDefencePost && !isCapital && !isAbm && !isAirbase) return;

    const radiusTiles = isAirbase
      ? (Number(AIRBASE_LAUNCH_RADIUS_TILES) || 0)
      : isCapital
      ? (Number(CAPITAL_DEFENCE_RADIUS_TILES) || 0)
      : isAbm
        ? (Number(ABM_RADIUS_TILES) || 0)
        : (Number(DEFENCE_POST_RADIUS_TILES) || 0);
    if (radiusTiles <= 0) return;

    const zoom = Number(v.zoom) || 1;
    const camDx = Number(v.dx) || 0;
    const camDy = Number(v.dy) || 0;
    const centerX = camDx + ((st.x | 0) + 0.5) * zoom;
    const centerY = camDy + ((st.y | 0) + 0.5) * zoom;
    const rPx = radiusTiles * zoom;
    if (rPx <= 1) return;

    const tint = this.world.getOwnerTint
      ? this.world.getOwnerTint(st.owner | 0)
      : (isCapital ? { r: 255, g: 220, b: 90 } : isAbm ? { r: 250, g: 140, b: 90 } : isAirbase ? { r: 160, g: 208, b: 255 } : { r: 120, g: 200, b: 255 });
    const accent = isCapital ? { r: 255, g: 215, b: 90 } : isAbm ? { r: 255, g: 176, b: 120 } : isAirbase ? { r: 190, g: 228, b: 255 } : { r: 200, g: 240, b: 255 };
    const rr = ((tint.r * 0.52) + (accent.r * 0.48)) | 0;
    const gg = ((tint.g * 0.52) + (accent.g * 0.48)) | 0;
    const bb = ((tint.b * 0.52) + (accent.b * 0.48)) | 0;
    const fillA = isCapital ? 0.055 : isAbm ? 0.070 : 0.08;
    const strokeA = isCapital ? 0.46 : isAbm ? 0.58 : 0.55;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    ctx.beginPath();
    ctx.arc(centerX, centerY, rPx, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rr},${gg},${bb},${fillA})`;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},${strokeA})`;
    ctx.setLineDash([6, 4]);
    ctx.stroke();

    ctx.restore();
  }

  _drawSpawnPicksScreen(ctx, v) {
    const world = this.world;
    const phase = world?._spawnPhase || null;
    const spawns = world?._spawnPos || null;
    const picked = phase?.picked || null;
    if (!phase || !phase.active || !spawns || !picked) return;

    const zoom = Number(v.zoom) || 1;
    const camDx = Number(v.dx) || 0;
    const camDy = Number(v.dy) || 0;
    const cap = Math.min(
      Math.max(0, world._nationCount | 0),
      Math.max(0, picked.length - 1),
      Math.max(0, spawns.length - 1)
    );
    if (cap <= 0) return;

    const coreR = clamp(5.2 + zoom * 0.88, 5.2, 12.8);
    const cullPad = Math.ceil(coreR + 16);

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.textAlign = "center";

    for (let id = 1; id <= cap; id++) {
      if (!picked[id]) continue;
      const s = spawns[id];
      if (!s) continue;

      const sx = s.x | 0;
      const sy = s.y | 0;
      const px = camDx + (sx + 0.5) * zoom;
      const py = camDy + (sy + 0.5) * zoom;
      if (
        px < -cullPad || py < -cullPad ||
        px > (v.canvasW + cullPad) || py > (v.canvasH + cullPad)
      ) continue;

      const tint = world.getOwnerTint
        ? world.getOwnerTint(id)
        : { r: 200, g: 214, b: 236 };
      const isPlayer = (id | 0) === OWNER.PLAYER;
      const ringR = coreR + (isPlayer ? 3.6 : 2.5);
      const pulse = isPlayer ? (0.86 + 0.14 * Math.sin((Number(world.time) || 0) * 8.2)) : 1;

      ctx.beginPath();
      ctx.arc(px, py, ringR + 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, ringR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${isPlayer ? "0.33" : "0.24"})`;
      ctx.fill();
      ctx.lineWidth = isPlayer ? 2.4 : 1.6;
      ctx.strokeStyle = isPlayer
        ? `rgba(220,240,255,${(0.84 * pulse).toFixed(3)})`
        : "rgba(212,224,244,0.68)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, coreR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${isPlayer ? "0.82" : "0.72"})`;
      ctx.fill();
      ctx.lineWidth = isPlayer ? 1.6 : 1.2;
      ctx.strokeStyle = "rgba(8,12,20,0.58)";
      ctx.stroke();

      const cross = coreR * (isPlayer ? 0.92 : 0.84);
      ctx.beginPath();
      ctx.moveTo(px - cross, py);
      ctx.lineTo(px + cross, py);
      ctx.moveTo(px, py - cross);
      ctx.lineTo(px, py + cross);
      ctx.lineWidth = isPlayer ? 2.1 : 1.5;
      ctx.strokeStyle = "rgba(8,12,20,0.70)";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px - (cross - 0.8), py);
      ctx.lineTo(px + (cross - 0.8), py);
      ctx.moveTo(px, py - (cross - 0.8));
      ctx.lineTo(px, py + (cross - 0.8));
      ctx.lineWidth = isPlayer ? 1.2 : 0.9;
      ctx.strokeStyle = "rgba(232,246,255,0.82)";
      ctx.stroke();

      if (isPlayer) {
        const labelY = py - ringR - 7;
        ctx.font = "700 10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.70)";
        ctx.strokeText("YOU", px, labelY);
        ctx.fillStyle = "rgba(232,246,255,0.96)";
        ctx.fillText("YOU", px, labelY);
      }
    }

    ctx.restore();
  }

  _drawScreenAlertFrame(ctx, v) {
    const alerts = this._screenAlerts;
    if (!Array.isArray(alerts) || alerts.length === 0) return;

    const now = performance.now() * 0.001;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumW = 0;
    let alpha = 0;

    for (let i = alerts.length - 1; i >= 0; i--) {
      const a = alerts[i];
      const start = Number(a?.start) || 0;
      const end = Number(a?.end) || 0;
      const span = Math.max(0.001, end - start);
      const t = (now - start) / span;
      if (t >= 1) {
        alerts.splice(i, 1);
        continue;
      }
      if (t < 0) continue;

      const pulseN = Math.max(1, Number(a?.pulses) || 1);
      const strength = Math.max(0, Number(a?.strength) || 0);
      const env = Math.sin(Math.PI * clamp01(t));
      const pulse = 0.5 + 0.5 * Math.sin((t * pulseN * Math.PI * 2) - (Math.PI * 0.5));
      const w = strength * env * (0.35 + 0.65 * pulse);
      if (w <= 0.001) continue;

      const c = Array.isArray(a?.color) ? a.color : [255, 196, 72];
      const cr = Number(c[0]) || 0;
      const cg = Number(c[1]) || 0;
      const cb = Number(c[2]) || 0;

      sumR += cr * w;
      sumG += cg * w;
      sumB += cb * w;
      sumW += w;
      alpha += w;
    }

    if (sumW <= 0 || alpha <= 0.002) return;

    const r = Math.round(sumR / sumW);
    const g = Math.round(sumG / sumW);
    const b = Math.round(sumB / sumW);
    const a = Math.min(0.92, alpha);

    const minSide = Math.min(v.canvasW, v.canvasH);
    const band = clamp(minSide * 0.028, 8, 28);

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = `rgba(${r},${g},${b},${(a * 0.05).toFixed(3)})`;
    ctx.fillRect(0, 0, v.canvasW, v.canvasH);

    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      const lw = band * (1 - t * 0.50);
      const inset = i * band * 0.42;
      const x = inset + lw * 0.5;
      const y = inset + lw * 0.5;
      const w = v.canvasW - (x * 2);
      const h = v.canvasH - (y * 2);
      if (w <= 2 || h <= 2) continue;
      const sa = a * (0.52 - i * 0.16);
      if (sa <= 0.002) continue;
      ctx.lineWidth = lw;
      ctx.strokeStyle = `rgba(${r},${g},${b},${sa.toFixed(3)})`;
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }

  _drawShipsScreen(ctx, v, selectedShipId = 0) {
    const world = this.world;
    const ships = world.ships;
    if (!ships || ships.length === 0) return;
    const zoom = Number(v.zoom) || 1;
    const camDx = Number(v.dx) || 0;
    const camDy = Number(v.dy) || 0;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const now = (typeof world.time === "number") ? world.time : 0;

    // Trade-ship trails (fade out smoothly).
    const TRAIL_FADE_S = 3.5;
    const drawTrails = (zoom >= 2);

    if (drawTrails) {
      const dot = Math.max(1, Math.min(3, ((zoom * 0.35) + 0.5) | 0));
      const dh = dot * 0.5;

      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s || s.kind !== "trade") continue;

        const tr = s.trail;
        if (!tr || tr.length === 0) continue;

        const tint = world.getOwnerTint ? world.getOwnerTint(s.owner | 0) : { r: 220, g: 220, b: 220 };
        const r = ((230 * 0.55) + (tint.r * 0.45)) | 0;
        const g = ((230 * 0.55) + (tint.g * 0.45)) | 0;
        const b = ((245 * 0.55) + (tint.b * 0.45)) | 0;
        ctx.fillStyle = `rgb(${r},${g},${b})`;

        for (let j = 0; j < tr.length; j++) {
          const p0 = tr[j];
          if (!p0) continue;

          const age = now - (p0.t || 0);
          if (age < 0 || age > TRAIL_FADE_S) continue;

          const a = (1 - (age / TRAIL_FADE_S)) * 0.35;
          if (a <= 0.01) continue;

          const px = camDx + p0.x * zoom;
          const py = camDy + p0.y * zoom;

          // Quick cull
          if (px < -20 || py < -20 || px > v.canvasW + 20 || py > v.canvasH + 20) continue;

          ctx.globalAlpha = a;
          ctx.fillRect((px - dh) | 0, (py - dh) | 0, dot, dot);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Ship icons
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const kind = s ? String(s.kind || "") : "";
      if (!s || (kind !== "trade" && kind !== "war" && kind !== "transport")) continue;

      const wx = (typeof s.px === "number") ? s.px : ((s.x | 0) + 0.5);
      const wy = (typeof s.py === "number") ? s.py : ((s.y | 0) + 0.5);
      const px = camDx + wx * zoom;
      const py = camDy + wy * zoom;

      // Quick cull
      if (px < -28 || py < -28 || px > v.canvasW + 28 || py > v.canvasH + 28) continue;

      const owner = (s.owner | 0);
      const tint = world.getOwnerTint ? world.getOwnerTint(owner) : { r: 220, g: 220, b: 220 };
      const tr = tint.r | 0;
      const tg = tint.g | 0;
      const tb = tint.b | 0;
      const col = `rgb(${tr},${tg},${tb})`;

      let drawSize = Math.max(10, Math.min(31, Math.round(7 + zoom * 2.35)));
      if (kind === "transport") drawSize += 2;
      if (kind === "war") drawSize += 4;

      const haloR = Math.max(2, Math.round(drawSize * 0.20));
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, haloR, 0, Math.PI * 2);
      ctx.fill();

      if ((selectedShipId | 0) && ((s.id | 0) === (selectedShipId | 0))) {
        const ringR = Math.max(6, Math.round(drawSize * 0.64));
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = Math.max(1, Math.round(drawSize * 0.11));
        ctx.strokeStyle = "rgba(255,245,190,0.96)";
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      const icon = this._getShipIcon(kind);
      const hasIcon = !!(icon && icon.complete && icon.naturalWidth > 0);

      if (hasIcon) {
        const x0 = Math.round(px - drawSize * 0.5);
        const y0 = Math.round(py - drawSize * 0.5);
        const tinted = this._getTintedShipSprite(kind, owner, icon, drawSize, tint);

        ctx.save();
        ctx.globalAlpha = 0.98;
        if (tinted) ctx.drawImage(tinted, x0, y0, drawSize, drawSize);
        else this._drawTintedShipIcon(ctx, icon, x0, y0, drawSize, col);
        ctx.restore();
      } else {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = col;
        if (kind === "trade") {
          const s0 = Math.max(6, Math.round(drawSize * 0.48));
          ctx.fillRect(Math.round(px - s0 * 0.5), Math.round(py - s0 * 0.5), s0, s0);
        } else if (kind === "transport") {
          const ww = Math.max(9, Math.round(drawSize * 0.76));
          const hh = Math.max(6, Math.round(drawSize * 0.46));
          ctx.fillRect(Math.round(px - ww * 0.5), Math.round(py - hh * 0.5), ww, hh);
          ctx.fillRect(Math.round(px + ww * 0.5 - 2), Math.round(py - 1), 3, 2);
        } else {
          const r0 = Math.max(3, Math.round(drawSize * 0.30));
          ctx.beginPath();
          ctx.arc(px, py, r0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }




  _drawNationLabelsScreen(ctx, v) {
    const world = this.world;
    const nations = world.nation || [];
    if (!nations.length) return;
    const cset = this._clientSettings || {};
    const zoom = Number(v.zoom) || 1;
    const dx = Number(v.dx) || 0;
    const dy = Number(v.dy) || 0;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const nameFontPx = 17;
    const popFontPx = 14;
    const labelFontFamily = "\"Palatino Linotype\", \"Book Antiqua\", \"Georgia\", serif";
    const nameFontWeight = 500;
    const popFontWeight = 400;
    const LABEL_REF_ZOOM = 2.6;
    const LABEL_BASE_ZOOM = 1.5;
    const MIN_LABEL_SCALE = 0.38;
    const labelScaleFont = clamp(zoom / LABEL_BASE_ZOOM, MIN_LABEL_SCALE, 1);
    const labelScaleBounds = clamp(zoom / LABEL_BASE_ZOOM, MIN_LABEL_SCALE, 2.5);

    const SPAN_MARGIN = 0.85;
    const MIN_TEXT_PX = 0.5;
    const ownerArr = world.owner;
    const landArr = world.land;
    const worldW = world.w | 0;
    const worldH = world.h | 0;
    const LABEL_CULL_PAD = 260;

    const ownerVersion = world.ownerVersion | 0;
    const nowT = (typeof world.time === "number") ? world.time : 0;
    const cacheVer = this._labelSpanCacheVersion | 0;
    if (ownerVersion < cacheVer) {
      this._labelSpanCacheVersion = ownerVersion;
      this._labelSpanCache.clear();
      this._labelSpanCacheNextSyncAt = nowT + 1.5;
    } else if ((ownerVersion - cacheVer) >= 24000 && nowT >= this._labelSpanCacheNextSyncAt) {
      this._labelSpanCacheVersion = ownerVersion;
      this._labelSpanCache.clear();
      this._labelSpanCacheNextSyncAt = nowT + 2.0;
    }

    const sizeCacheVer = this._labelSizeCacheVersion | 0;
    if (ownerVersion < sizeCacheVer) {
      this._labelSizeCacheVersion = ownerVersion;
      this._labelSizeCache.clear();
      this._labelSizeCacheLastPruneAt = nowT;
    } else if (ownerVersion > sizeCacheVer) {
      this._labelSizeCacheVersion = ownerVersion;
    } else if (this._labelSizeCache.size > 4096 && (nowT - this._labelSizeCacheLastPruneAt) >= 0.4) {
      this._labelSizeCache.clear();
      this._labelSizeCacheLastPruneAt = nowT;
    }

    const fitFontPx = (text, weight, maxPx, minPx, maxWidth) => {
      let size = Math.max(minPx, maxPx);
      if (!(maxWidth > 0)) return size;
      ctx.font = `${weight} ${size}px ${labelFontFamily}`;
      let w = ctx.measureText(text).width;
      if (w > maxWidth && w > 0) {
        size = Math.max(minPx, size * (maxWidth / w));
        ctx.font = `${weight} ${size}px ${labelFontFamily}`;
        w = ctx.measureText(text).width;
        if (w > maxWidth && w > 0) size = Math.max(minPx, size * (maxWidth / w));
      }
      return Math.max(minPx, size);
    };

    const measureHeight = (text, fallbackPx) => {
      const m = ctx.measureText(text);
      const a = m.actualBoundingBoxAscent;
      const d = m.actualBoundingBoxDescent;
      if (Number.isFinite(a) && Number.isFinite(d) && (a + d) > 0) return a + d;
      const fa = m.fontBoundingBoxAscent;
      const fd = m.fontBoundingBoxDescent;
      if (Number.isFinite(fa) && Number.isFinite(fd) && (fa + fd) > 0) return fa + fd;
      return Math.max(1, fallbackPx);
    };

    const spanXAtY = (cx, y, ownerId) => {
      if (!landArr || !ownerArr) return 0;
      if (y < 0 || y >= worldH) return 0;
      const row = y * worldW;
      const idx0 = row + cx;
      if (!landArr[idx0] || (ownerArr[idx0] | 0) !== ownerId) return 0;
      let x0 = cx;
      while (x0 > 0) {
        const idx = row + x0 - 1;
        if (!landArr[idx] || (ownerArr[idx] | 0) !== ownerId) break;
        x0--;
      }
      let x1 = cx;
      while (x1 + 1 < worldW) {
        const idx = row + x1 + 1;
        if (!landArr[idx] || (ownerArr[idx] | 0) !== ownerId) break;
        x1++;
      }
      return (x1 - x0 + 1);
    };

    const spanYAtX = (x, cy, ownerId) => {
      if (!landArr || !ownerArr) return 0;
      if (x < 0 || x >= worldW) return 0;
      const idx0 = cy * worldW + x;
      if (!landArr[idx0] || (ownerArr[idx0] | 0) !== ownerId) return 0;
      let y0 = cy;
      while (y0 > 0) {
        const idx = (y0 - 1) * worldW + x;
        if (!landArr[idx] || (ownerArr[idx] | 0) !== ownerId) break;
        y0--;
      }
      let y1 = cy;
      while (y1 + 1 < worldH) {
        const idx = (y1 + 1) * worldW + x;
        if (!landArr[idx] || (ownerArr[idx] | 0) !== ownerId) break;
        y1++;
      }
      return (y1 - y0 + 1);
    };

    const tileOwnedBy = (x, y, ownerId) => {
      if (!landArr || !ownerArr) return false;
      if (x < 0 || y < 0 || x >= worldW || y >= worldH) return false;
      const idx = y * worldW + x;
      return !!landArr[idx] && ((ownerArr[idx] | 0) === (ownerId | 0));
    };

    const snapLabelToOwnerTile = (xRaw, yRaw, ownerId, maxRadius = 26) => {
      const x0 = Math.max(0, Math.min(worldW - 1, xRaw | 0));
      const y0 = Math.max(0, Math.min(worldH - 1, yRaw | 0));
      if (tileOwnedBy(x0, y0, ownerId)) return { x: x0, y: y0 };

      let best = null;
      let bestD2 = Infinity;
      const rMax = Math.max(1, maxRadius | 0);
      for (let r = 1; r <= rMax; r++) {
        const xMin = x0 - r;
        const xMax = x0 + r;
        const yMin = y0 - r;
        const yMax = y0 + r;

        for (let x = xMin; x <= xMax; x++) {
          const yTop = yMin;
          const yBottom = yMax;
          if (tileOwnedBy(x, yTop, ownerId)) {
            const dx = x - x0;
            const dy = yTop - y0;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = { x, y: yTop }; }
          }
          if (tileOwnedBy(x, yBottom, ownerId)) {
            const dx = x - x0;
            const dy = yBottom - y0;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = { x, y: yBottom }; }
          }
        }

        for (let y = yMin + 1; y <= yMax - 1; y++) {
          const xLeft = xMin;
          const xRight = xMax;
          if (tileOwnedBy(xLeft, y, ownerId)) {
            const dx = xLeft - x0;
            const dy = y - y0;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = { x: xLeft, y }; }
          }
          if (tileOwnedBy(xRight, y, ownerId)) {
            const dx = xRight - x0;
            const dy = y - y0;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = { x: xRight, y }; }
          }
        }

        if (best) return best;
      }

      return null;
    };

    const screenPointInOwner = (sx, sy, ownerId) => {
      if (!landArr || !ownerArr || !(zoom > 0)) return false;
      const wx = ((sx - dx) / zoom) - 0.5;
      const wy = ((sy - dy) / zoom) - 0.5;
      const x = Math.floor(wx);
      const y = Math.floor(wy);
      if (x < 0 || y < 0 || x >= worldW || y >= worldH) return false;
      const idx = y * worldW + x;
      return !!landArr[idx] && ((ownerArr[idx] | 0) === (ownerId | 0));
    };

    const iconRectFitsOwner = (x, y, size, ownerId) => {
      if (!(size > 4)) return false;
      const inset = Math.min(6, Math.max(1, size * 0.16));
      const x0 = x + inset;
      const y0 = y + inset;
      const x1 = x + size - inset;
      const y1 = y + size - inset;
      const cx = x + size * 0.5;
      const cy = y + size * 0.5;
      return (
        screenPointInOwner(cx, cy, ownerId) &&
        screenPointInOwner(x0, y0, ownerId) &&
        screenPointInOwner(x1, y0, ownerId) &&
        screenPointInOwner(x0, y1, ownerId) &&
        screenPointInOwner(x1, y1, ownerId)
      );
    };

    const iconGroupFitsOwner = (xStart, y, size, spacing, ownerId, count) => {
      for (let i = 0; i < count; i++) {
        const x = xStart + i * (size + spacing);
        if (!iconRectFitsOwner(x, y, size, ownerId)) return false;
      }
      return true;
    };

    for (let id = 1; id < nations.length; id++) {
      const n = nations[id];
      if (!n || !n.alive) continue;

      const pos = world.getNationLabelPos ? world.getNationLabelPos(id) : null;
      if (!pos) continue;

      const snappedLabel = snapLabelToOwnerTile(pos.x | 0, pos.y | 0, id, 28);
      if (!snappedLabel) continue;
      const labelX = snappedLabel.x | 0;
      const labelY = snappedLabel.y | 0;

      const sX = Math.round(dx + (labelX + 0.5) * zoom);
      const sY = Math.round(dy + (labelY + 0.5) * zoom);
      if (sX < -LABEL_CULL_PAD || sY < -LABEL_CULL_PAD || sX > v.canvasW + LABEL_CULL_PAD || sY > v.canvasH + LABEL_CULL_PAD) continue;

      const name = String(n.name || "Nation");
      const pop = n.population || 0;
      const popText = estimatePopulationText(world, id, pop);
      const relationIconKinds = this._getPlayerRelationIconKindsForNation(id);

      // Fit name width to territory so it doesn't spill out.
      const land = (world.landOwnedCount && world.landOwnedCount[id]) ? (world.landOwnedCount[id] | 0) : 0;
      const radiusWorld = Math.max(4, Math.sqrt(Math.max(1, land) / Math.PI) * 0.9);
      const radiusPx = clamp(radiusWorld * LABEL_REF_ZOOM * labelScaleBounds, 10 * labelScaleBounds, 180 * labelScaleBounds);
      const radiusWidth = clamp(radiusPx * 2.6, 36 * labelScaleBounds, 300 * labelScaleBounds);
      const radiusHeight = clamp(radiusPx * 2.0, 20 * labelScaleBounds, 240 * labelScaleBounds);

      const cx = Math.max(0, Math.min(worldW - 1, labelX));
      const cy = Math.max(0, Math.min(worldH - 1, labelY));
      let spanX = 0;
      let spanY = 0;
      const spanCached = this._labelSpanCache.get(id | 0);
      if (spanCached && spanCached.x === cx && spanCached.y === cy) {
        spanX = spanCached.spanX | 0;
        spanY = spanCached.spanY | 0;
      } else {
        for (let dy = -1; dy <= 1; dy++) {
          const span = spanXAtY(cx, cy + dy, id);
          if (span > 0) spanX = spanX === 0 ? span : Math.min(spanX, span);
        }
        for (let dx = -1; dx <= 1; dx++) {
          const span = spanYAtX(cx + dx, cy, id);
          if (span > 0) spanY = spanY === 0 ? span : Math.min(spanY, span);
        }
        this._labelSpanCache.set(id | 0, { x: cx, y: cy, spanX, spanY });
      }

      const spanWidthPx = spanX > 0 ? Math.max(2, spanX * zoom * SPAN_MARGIN) : 0;
      const spanHeightPx = spanY > 0 ? Math.max(2, spanY * zoom * SPAN_MARGIN) : 0;
      const maxWidth = Math.max(1, spanWidthPx > 0 ? Math.min(radiusWidth, spanWidthPx) : radiusWidth);
      const maxHeight = Math.max(1, spanHeightPx > 0 ? Math.min(radiusHeight, spanHeightPx) : radiusHeight);

      const aiFlagCanvas = (cset.showAIFlags !== false) ? (this._nationFlagCanvasById.get(id) || null) : null;
      const nationFlagCanvas = (id === OWNER.PLAYER) ? this._playerFlagCanvas : aiFlagCanvas;
      const hasNationFlag = !!(nationFlagCanvas && nationFlagCanvas.width > 0 && nationFlagCanvas.height > 0);
      const flagReserve = hasNationFlag ? Math.max(8, 20 * labelScaleFont) : 0;
      const fitWidth = Math.max(1, maxWidth - flagReserve);

      const sizeKey = `${id}|${name}|${popText}|${Math.round(fitWidth)}|${Math.round(maxHeight)}|${Math.round(labelScaleFont * 1000)}|${hasNationFlag ? 1 : 0}`;
      let cached = this._labelSizeCache.get(sizeKey);
      let namePx;
      let popPx;
      let nameH;
      let popH;
      let gap;
      let heightScale;
      if (cached) {
        namePx = cached.namePx;
        popPx = cached.popPx;
        nameH = cached.nameH;
        popH = cached.popH;
        gap = cached.gap;
        heightScale = cached.heightScale;
      } else {
        namePx = fitFontPx(name, nameFontWeight, nameFontPx * labelScaleFont, MIN_TEXT_PX, fitWidth);
        popPx = fitFontPx(popText, popFontWeight, popFontPx * labelScaleFont, MIN_TEXT_PX, fitWidth);

        ctx.font = `${nameFontWeight} ${namePx}px ${labelFontFamily}`;
        nameH = measureHeight(name, namePx);
        ctx.font = `${popFontWeight} ${popPx}px ${labelFontFamily}`;
        popH = measureHeight(popText, popPx);

        gap = Math.max(2, 4 * labelScaleFont);
        let totalHeight = nameH + popH + gap;
        heightScale = 1;
        if (maxHeight > 0 && totalHeight > maxHeight) {
          heightScale = maxHeight / totalHeight;
          namePx *= heightScale;
          popPx *= heightScale;
          gap *= heightScale;
          ctx.font = `${nameFontWeight} ${namePx}px ${labelFontFamily}`;
          nameH = measureHeight(name, namePx);
          ctx.font = `${popFontWeight} ${popPx}px ${labelFontFamily}`;
          popH = measureHeight(popText, popPx);
        }

        cached = { namePx, popPx, nameH, popH, gap, heightScale };
        this._labelSizeCache.set(sizeKey, cached);
      }

      const nameOffset = -(popH * 0.5 + gap * 0.5);
      const popOffset = (nameH * 0.5 + gap * 0.5);
      ctx.font = `${nameFontWeight} ${namePx}px ${labelFontFamily}`;
      const nameWidthPx = ctx.measureText(name).width;

      let nameTextX = sX;
      let flagDraw = null;
      if (hasNationFlag) {
        const aspect = nationFlagCanvas.width / Math.max(1, nationFlagCanvas.height);
        // Keep the flag visually aligned with the rendered name glyph height.
        let flagH = Math.max(4, namePx * 0.92);
        let flagW = Math.max(6, flagH * aspect);
        let fgap = Math.max(2, 3 * labelScaleFont);

        const groupW = flagW + fgap + nameWidthPx;
        if (groupW > maxWidth) {
          const scale = maxWidth / Math.max(1, groupW);
          flagH *= scale;
          flagW *= scale;
          fgap *= scale;
        }

        nameTextX = sX + (flagW + fgap) * 0.5;
        flagDraw = {
          x: Math.round(sX - (nameWidthPx + fgap + flagW) * 0.5),
          y: Math.round((sY + nameOffset) - (flagH * 0.5)),
          w: Math.max(4, Math.round(flagW)),
          h: Math.max(3, Math.round(flagH))
        };
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(0.5, 3 * labelScaleFont * heightScale);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(name, nameTextX, sY + nameOffset);

      ctx.fillStyle = "rgba(245,245,245,0.92)";
      ctx.fillText(name, nameTextX, sY + nameOffset);

      if (flagDraw && nationFlagCanvas) {
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(nationFlagCanvas, flagDraw.x, flagDraw.y, flagDraw.w, flagDraw.h);
        ctx.imageSmoothingEnabled = prevSmooth;
      }

      ctx.font = `${popFontWeight} ${popPx}px ${labelFontFamily}`;
      ctx.lineWidth = Math.max(0.5, 2 * labelScaleFont * heightScale);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.strokeText(popText, sX, sY + popOffset);

      ctx.fillStyle = "rgba(235,235,235,0.90)";
      ctx.fillText(popText, sX, sY + popOffset);

      if (relationIconKinds.length > 0) {
        const drawList = [];
        for (let i = 0; i < relationIconKinds.length; i++) {
          const icon = this._getRelationIcon(relationIconKinds[i]);
          if (icon && icon.complete && icon.naturalWidth > 0) drawList.push(icon);
        }

        if (drawList.length > 0) {
          const baseSize = Math.max(8, Math.round(Number(this._relationIconSizePx) || 58));
          const baseGap = Math.max(1, Math.round(Number(this._relationIconGapPx) || 8));
          const baseSpacing = Math.max(1, Math.round(Number(this._relationIconSpacingPx) || 8));
          const iconLift = Math.max(0, Math.round(Number(this._relationIconLiftPx) || 0));
          const boundsPad = 1;
          const leftBound = sX - (maxWidth * 0.5) + boundsPad;
          const rightBound = sX + (maxWidth * 0.5) - boundsPad;
          const topBound = sY - (maxHeight * 0.5) + boundsPad;
          const bottomBound = sY + (maxHeight * 0.5) - boundsPad;
          if ((rightBound - leftBound) < 6 || (bottomBound - topBound) < 6) continue;

          const nameCenterY = sY + nameOffset;
          const nameTopY = nameCenterY - (nameH * 0.5);
          const count = drawList.length;

          let iconSize = baseSize;
          let iconSpacing = Math.max(1, Math.min(baseSpacing, Math.round(iconSize * 0.24)));
          let iconX = 0;
          let iconY = 0;
          let totalW = 0;
          let fitted = false;

          for (let pass = 0; pass < 7; pass++) {
            iconSpacing = Math.max(1, Math.min(baseSpacing, Math.round(iconSize * 0.24)));

            const widthCap = (maxWidth - ((count - 1) * iconSpacing) - 2) / count;
            const heightCap = nameTopY - topBound - baseGap - iconLift;
            const cappedSize = Math.min(iconSize, widthCap, heightCap);
            iconSize = Math.floor(cappedSize);
            if (!(iconSize > 4)) break;

            iconSpacing = Math.max(1, Math.min(baseSpacing, Math.round(iconSize * 0.24)));
            totalW = count * iconSize + (count - 1) * iconSpacing;
            iconX = Math.round(sX - totalW * 0.5);
            iconY = Math.round(nameTopY - baseGap - iconSize - iconLift);

            if (iconX < leftBound) iconX = Math.round(leftBound);
            if ((iconX + totalW) > rightBound) iconX = Math.round(rightBound - totalW);
            if (iconY < topBound) iconY = Math.round(topBound);
            if ((iconY + iconSize) > bottomBound) iconY = Math.round(bottomBound - iconSize);

            if (iconGroupFitsOwner(iconX, iconY, iconSize, iconSpacing, id, count)) {
              fitted = true;
              break;
            }

            iconSize = Math.floor(iconSize * 0.84);
          }

          if (!fitted || !(iconSize > 4)) continue;

          const prevSmooth = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false;
          let cursorX = iconX;

          for (let i = 0; i < drawList.length; i++) {
            ctx.drawImage(drawList[i], cursorX, iconY, iconSize, iconSize);
            cursorX += iconSize + iconSpacing;
          }
          ctx.imageSmoothingEnabled = prevSmooth;
        }
      }
    }

    ctx.restore();
  }

  _drawRubberLineScreen(ctx, v, rubberLine) {
    if (!rubberLine) return;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);

    const x0 = rubberLine.x0;
    const y0 = rubberLine.y0;
    const x1 = rubberLine.x1;
    const y1 = rubberLine.y1;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Soft outer stroke for contrast.
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Bright inner stroke with a subtle gradient.
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, "rgba(255, 240, 160, 0.95)");
    grad.addColorStop(1, "rgba(255, 200, 90, 0.95)");
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.restore();
  }

  _drawBrushGhostScreen(ctx, v, brushGhost) {
    if (!brushGhost) return;
    const cx = Number(brushGhost.x);
    const cy = Number(brushGhost.y);
    const radiusTiles = Math.max(0, Number(brushGhost.radiusTiles) || 0);
    const sizePx = Math.max(1, Number(brushGhost.sizePx) || 1);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const s = v.worldToScreen(cx + 0.5, cy + 0.5);
    const zoom = Math.max(0.0001, Number(v.zoom) || 1);
    const radiusScreen = Math.max(0.5, (radiusTiles + 0.5) * zoom);

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(s.x, s.y, radiusScreen, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(115, 230, 255, 0.12)";
    ctx.fill();

    ctx.lineWidth = 2.0;
    ctx.strokeStyle = "rgba(115, 230, 255, 0.90)";
    ctx.stroke();

    const label = `${sizePx}px`;
    const padX = 8;
    const padY = 5;
    ctx.font = "600 13px system-ui, sans-serif";
    const tw = Math.ceil(ctx.measureText(label).width);
    const bw = tw + padX * 2;
    const bh = 22;
    const bx = s.x - (bw * 0.5);
    const by = s.y - radiusScreen - bh - 8;

    ctx.fillStyle = "rgba(6, 12, 20, 0.86)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(115, 230, 255, 0.55)";
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.fillStyle = "rgba(222, 247, 255, 0.98)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, s.x, by + bh * 0.5);
    ctx.restore();
  }

  _drawIntentArrowsScreen(ctx, v, arrows) {
    if (!arrows || !arrows.length) return;
    const zoom = Number(v.zoom) || 1;
    const camDx = Number(v.dx) || 0;
    const camDy = Number(v.dy) || 0;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      if (!a) continue;

      const sX = camDx + (Number(a.x) || 0) * zoom;
      const sY = camDy + (Number(a.y) || 0) * zoom;
      const dirX = Number(a.dx) || 0;
      const dirY = Number(a.dy) || 0;
      // Constant screen-space size (no zoom scaling).
      const len = 30;

      if (dirX === 0 && dirY === 0) continue;

      const px = -dirY;
      const py = dirX;
      const curve = ((Number(a.t) || 0.5) - 0.5) * 0.28 * len;

      const sx = sX - dirX * len * 0.4;
      const sy = sY - dirY * len * 0.4;
      const ex = sX + dirX * len * 0.6;
      const ey = sY + dirY * len * 0.6;
      const cx = (sx + ex) * 0.5 + px * curve;
      const cy = (sy + ey) * 0.5 + py * curve;

      const isWar = String(a.kind || "") === "war";
      const base = isWar ? { r: 255, g: 120, b: 120 } : { r: 110, g: 225, b: 255 };
      const alpha = 0.65 + 0.25 * (Number(a.t) || 0.5);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Soft outer stroke
      ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},${Math.min(0.55, alpha * 0.75)})`;
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();

      // Bright inner stroke
      ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},${Math.min(0.95, alpha)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();

      // Arrowhead
      const ang = Math.atan2(dirY, dirX);
      const head = clamp(7, 16, len * 0.4);
      const spread = Math.PI / 6;

      const hx1 = ex - Math.cos(ang - spread) * head;
      const hy1 = ey - Math.sin(ang - spread) * head;
      const hx2 = ex - Math.cos(ang + spread) * head;
      const hy2 = ey - Math.sin(ang + spread) * head;

      ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},${Math.min(0.95, alpha)})`;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(hx1, hy1);
      ctx.lineTo(hx2, hy2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  _drawNukeLaunchPreviewScreen(ctx, v, preview) {
    if (!preview) return;

    const sx = Number(preview.startX);
    const sy = Number(preview.startY);
    const cx = Number(preview.controlX);
    const cy = Number(preview.controlY);
    const tx = Number(preview.targetX);
    const ty = Number(preview.targetY);
    if (![sx, sy, cx, cy, tx, ty].every(Number.isFinite)) return;

    const s0 = v.worldToScreen(sx, sy);
    const c0 = v.worldToScreen(cx, cy);
    const t0 = v.worldToScreen(tx, ty);
    const linearPath = String(preview.pathKind || "").toLowerCase() === "line" || !!preview.linearPath;
    const isHydrogen = String(preview.type || "") === "hydrogen";

    const base = isHydrogen
      ? { r: 255, g: 124, b: 84 }
      : { r: 255, g: 214, b: 126 };
    const dashA = isHydrogen ? 0.70 : 0.62;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // Outer contrast line.
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    if (linearPath) ctx.lineTo(t0.x, t0.y);
    else ctx.quadraticCurveTo(c0.x, c0.y, t0.x, t0.y);
    ctx.stroke();

    // Inner dashed guidance line.
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},${dashA.toFixed(3)})`;
    ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = -((performance.now() * 0.03) % 100);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    if (linearPath) ctx.lineTo(t0.x, t0.y);
    else ctx.quadraticCurveTo(c0.x, c0.y, t0.x, t0.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Target blast marker (irregular when outline data is available).
    const outline = Array.isArray(preview.blastOutline) ? preview.blastOutline : null;
    if (outline && outline.length >= 3) {
      ctx.beginPath();
      for (let i = 0; i < outline.length; i++) {
        const p = outline[i];
        if (!p) continue;
        const ox = Number(p.x);
        const oy = Number(p.y);
        if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
        const s = v.worldToScreen(ox, oy);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},0.10)`;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},0.48)`;
      ctx.stroke();
    } else {
      const blastR = Math.max(2, (Number(preview.blastRadiusTiles) || 0) * v.zoom);
      if (blastR > 1) {
        ctx.beginPath();
        ctx.arc(t0.x, t0.y, blastR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},0.10)`;
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},0.48)`;
        ctx.stroke();
      }
    }

    // End-point lock marker.
    ctx.beginPath();
    ctx.arc(t0.x, t0.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},0.90)`;
    ctx.fill();

    ctx.restore();
  }

  _drawNukeFlightsScreen(ctx, v, flights, showDestinationOverlay = true) {
    if (!Array.isArray(flights) || flights.length === 0) return;
    const zoom = Number(v.zoom) || 1;
    const dx = Number(v.dx) || 0;
    const dy = Number(v.dy) || 0;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const quadAt = (p0x, p0y, p1x, p1y, p2x, p2y, t) => {
      const u = 1 - t;
      return {
        x: (u * u * p0x) + (2 * u * t * p1x) + (t * t * p2x),
        y: (u * u * p0y) + (2 * u * t * p1y) + (t * t * p2y)
      };
    };
    const quadTan = (p0x, p0y, p1x, p1y, p2x, p2y, t) => ({
      x: (2 * (1 - t) * (p1x - p0x)) + (2 * t * (p2x - p1x)),
      y: (2 * (1 - t) * (p1y - p0y)) + (2 * t * (p2y - p1y))
    });
    const lineAt = (p0x, p0y, p1x, p1y, t) => ({
      x: p0x + (p1x - p0x) * t,
      y: p0y + (p1y - p0y) * t
    });
    const lineTan = (p0x, p0y, p1x, p1y) => ({
      x: p1x - p0x,
      y: p1y - p0y
    });
    const drawPixelDiamond = (x, y, angle, color, variant, sprite = null, spriteSizePx = 0) => {
      const kind = String(variant || "atomic");
      const isAbm = kind === "abm";
      const isHydrogen = kind === "hydrogen";
      const hasSprite = !!(sprite && sprite.complete && sprite.naturalWidth > 0);
      const profile = isAbm
        ? { px: 2.0, rows: [1, 3, 5, 7, 5, 3, 1], defaultSpriteSize: 15 }
        : isHydrogen
          ? { px: 2.4, rows: [1, 3, 5, 7, 9, 11, 9, 7, 5, 3, 1], defaultSpriteSize: 24 }
          : { px: 2.3, rows: [1, 3, 5, 7, 9, 7, 5, 3, 1], defaultSpriteSize: 21 };

      ctx.save();
      ctx.translate(x, y);
      const spriteOffset = hasSprite ? (Number(this._missileSpriteHeadingOffsetRad) || 0) : 0;
      ctx.rotate(angle + spriteOffset);
      ctx.imageSmoothingEnabled = false;

      if (hasSprite) {
        const s = Math.max(2, Math.round(Number(spriteSizePx) || profile.defaultSpriteSize));
        ctx.globalAlpha = 0.98;
        ctx.drawImage(sprite, Math.round(-s * 0.5), Math.round(-s * 0.5), s, s);
        ctx.globalAlpha = 1;
        ctx.restore();
        return;
      }

      const px = profile.px;
      const rows = profile.rows;
      const totalRows = rows.length;
      const y0 = -Math.floor(totalRows * 0.5) * px;
      let maxRow = 1;
      for (let i = 0; i < rows.length; i++) {
        const rv = rows[i] | 0;
        if (rv > maxRow) maxRow = rv;
      }

      ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},0.98)`;
      for (let ry = 0; ry < totalRows; ry++) {
        const count = rows[ry] | 0;
        const x0 = -Math.floor(count * 0.5) * px;
        for (let rx = 0; rx < count; rx++) {
          ctx.fillRect(x0 + rx * px, y0 + ry * px, px, px);
        }
      }

      // Center strip creates pixel-art depth and keeps missile readable at all zooms.
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(-0.5 * px, y0 + px, px, (totalRows - 2) * px);

      // Bright nose pixels to emphasize heading.
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect((maxRow * 0.5 + 0.12) * px, -0.5 * px, px, px);
      ctx.fillRect((maxRow * 0.5 + 1.12) * px, -0.5 * px, px, px);

      // Dark tail pixel for contrast.
      ctx.fillStyle = "rgba(12,12,12,0.62)";
      ctx.fillRect((-maxRow * 0.5 - 1.2) * px, -0.5 * px, px, px);
      ctx.restore();
    };

    for (let i = 0; i < flights.length; i++) {
      const f = flights[i];
      if (!f) continue;
      const duration = Math.max(0.05, Number(f.durationS) || 0.05);
      const t = clamp((Number(f.ageS) || 0) / duration, 0, 1);

      const sx = Number(f.startX);
      const sy = Number(f.startY);
      const cx = Number(f.controlX);
      const cy = Number(f.controlY);
      const tx = Number(f.targetX);
      const ty = Number(f.targetY);
      if (![sx, sy, cx, cy, tx, ty].every(Number.isFinite)) continue;
      const midX = (sx + tx) * 0.5;
      const midY = (sy + ty) * 0.5;
      const isMidControl = Math.abs(cx - midX) <= 0.0001 && Math.abs(cy - midY) <= 0.0001;

      const isAbm = String(f.flightKind || "") === "abm" || String(f.type || "") === "abm";
      const isHydrogen = String(f.type || "") === "hydrogen";
      const linearPath = String(f.pathKind || "").toLowerCase() === "line" || !!f.linearPath || isMidControl;
      const variant = isAbm ? "abm" : (isHydrogen ? "hydrogen" : "atomic");
      const iconSizes = this._missileIconSizePx || { atomic: 40, hydrogen: 46, abm: 34 };
      const base = isAbm
        ? { r: 130, g: 220, b: 255 }
        : isHydrogen
          ? { r: 255, g: 104, b: 72 }
          : { r: 255, g: 228, b: 150 };
      if (isAbm && f.homing) {
        const hwx = Number(f.posX);
        const hwy = Number(f.posY);
        if (!Number.isFinite(hwx) || !Number.isFinite(hwy)) continue;
        const hpX = dx + hwx * zoom;
        const hpY = dy + hwy * zoom;

        // Homing trail (latest points only, bounded on world side for performance).
        const trail = Array.isArray(f.trail) ? f.trail : null;
        if (showDestinationOverlay && trail && trail.length >= 2) {
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},0.44)`;
          ctx.beginPath();
          for (let ti = 0; ti < trail.length; ti++) {
            const tp0 = trail[ti];
            if (!tp0) continue;
            const tx0 = Number(tp0.x) || hwx;
            const ty0 = Number(tp0.y) || hwy;
            const tpX = dx + tx0 * zoom;
            const tpY = dy + ty0 * zoom;
            if (ti === 0) ctx.moveTo(tpX, tpY);
            else ctx.lineTo(tpX, tpY);
          }
          ctx.stroke();
        } else if (showDestinationOverlay) {
          const sx0 = dx + (Number(f.startX) || hwx) * zoom;
          const sy0 = dy + (Number(f.startY) || hwy) * zoom;
          ctx.lineWidth = 1.1;
          ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},0.32)`;
          ctx.beginPath();
          ctx.moveTo(sx0, sy0);
          ctx.lineTo(hpX, hpY);
          ctx.stroke();
        }

        const vx = Number(f.velX) || 0;
        const vy = Number(f.velY) || 0;
        const vLen = Math.hypot(vx, vy) || 1;
        const dirx = vx / vLen;
        const diry = vy / vLen;
        const lifeS = Math.max(0.05, Number(f.maxLifeS) || duration);
        const lifeT = clamp((Number(f.ageS) || 0) / lifeS, 0, 1);
        const liftPx = 0;
        const mx = hpX;
        const my = hpY - liftPx;

        ctx.beginPath();
        ctx.ellipse(hpX, hpY, 5.2, 2.7, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.fill();

        const missileIcon = this._getMissileIcon(variant);
        drawPixelDiamond(
          mx,
          my,
          Math.atan2(diry, dirx),
          base,
          variant,
          missileIcon,
          Number(iconSizes[variant]) || 34
        );

        const plume = 6.1 * (0.78 + 0.22 * (1 - lifeT));
        const px = mx - dirx * plume;
        const py = my - diry * plume;
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(150,225,255,0.58)";
        ctx.fill();
        continue;
      }

      // Path glow.
      const s0x = dx + sx * zoom;
      const s0y = dy + sy * zoom;
      const c0x = dx + cx * zoom;
      const c0y = dy + cy * zoom;
      const t0x = dx + tx * zoom;
      const t0y = dy + ty * zoom;
      if (showDestinationOverlay) {
        ctx.lineWidth = isAbm ? 1.5 : 2.0;
        ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},${isAbm ? "0.26" : "0.34"})`;
        ctx.beginPath();
        ctx.moveTo(s0x, s0y);
        if (linearPath) ctx.lineTo(t0x, t0y);
        else ctx.quadraticCurveTo(c0x, c0y, t0x, t0y);
        ctx.stroke();
        ctx.lineWidth = isAbm ? 0.9 : 1.2;
        ctx.strokeStyle = `rgba(${base.r},${base.g},${base.b},${isAbm ? "0.42" : "0.52"})`;
        ctx.beginPath();
        ctx.moveTo(s0x, s0y);
        if (linearPath) ctx.lineTo(t0x, t0y);
        else ctx.quadraticCurveTo(c0x, c0y, t0x, t0y);
        ctx.stroke();

        if (isAbm) {
          ctx.beginPath();
          ctx.arc(t0x, t0y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(155,228,255,0.32)";
          ctx.fill();
        }
      }

      const p = linearPath ? lineAt(sx, sy, tx, ty, t) : quadAt(sx, sy, cx, cy, tx, ty, t);
      const tan = linearPath ? lineTan(sx, sy, tx, ty) : quadTan(sx, sy, cx, cy, tx, ty, t);
      const wpX = dx + p.x * zoom;
      const wpY = dy + p.y * zoom;
      const tanLen = Math.hypot(tan.x, tan.y) || 1;
      const dirx = tan.x / tanLen;
      const diry = tan.y / tanLen;

      const peak = Math.sin(Math.PI * t);
      const liftPx = linearPath ? 0 : peak * (isAbm ? 10 : (isHydrogen ? 22 : 17));
      const mx = wpX;
      const my = wpY - liftPx;

      // Ground shadow.
      ctx.beginPath();
      ctx.ellipse(wpX, wpY, isAbm ? 5.0 : (isHydrogen ? 8.2 : 6.6), isAbm ? 2.6 : 3.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fill();

      // Missile body (pixel diamond silhouette).
      const missileIcon = this._getMissileIcon(variant);
      drawPixelDiamond(
        mx,
        my,
        Math.atan2(diry, dirx),
        base,
        variant,
        missileIcon,
        Number(iconSizes[variant]) || (isAbm ? 18 : (isHydrogen ? 28 : 24))
      );

      // Engine plume.
      const plume = (isAbm ? 5.9 : (isHydrogen ? 8.7 : 7.7)) * (0.75 + 0.25 * (1 - t));
      const px = mx - dirx * plume;
      const py = my - diry * plume;
      ctx.beginPath();
      ctx.arc(px, py, isAbm ? 2.1 : (isHydrogen ? 3.2 : 2.6), 0, Math.PI * 2);
      ctx.fillStyle = isAbm
        ? "rgba(150,225,255,0.58)"
        : isHydrogen
        ? "rgba(255,120,80,0.62)"
        : "rgba(255,220,140,0.58)";
      ctx.fill();
    }

    ctx.restore();
  }

  _drawAirborneMissionsScreen(ctx, v, missions) {
    if (!Array.isArray(missions) || missions.length <= 0) return;
    const zoom = Number(v.zoom) || 1;
    const dx = Number(v.dx) || 0;
    const dy = Number(v.dy) || 0;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const planeIcon = this._getAirbornePlaneIcon();
    const planeOffset = Number(this._airbornePlaneHeadingOffsetRad) || 0;
    const planeBaseSize = Math.max(8, Number(this._airbornePlaneIconSizePx) || 8);
    const tileSize = Math.max(1, Number(zoom) || 1);

    for (let i = 0; i < missions.length; i++) {
      const m = missions[i];
      if (!m) continue;
      const phase = String(m.phase || "flight");
      const owner = m.owner | 0;
      const tint = this.world.getOwnerTint
        ? this.world.getOwnerTint(owner)
        : { r: 220, g: 220, b: 220 };

      // Landed infantry pixels: nation color only, sized like world tiles.
      // Falling paradrop dots are intentionally hidden to keep visuals clean.
      if (phase === "drop" || phase === "expand") {
        const arr = Array.isArray(m.dropPixels) ? m.dropPixels : null;
        if (arr && arr.length > 0) {
          ctx.fillStyle = `rgb(${tint.r | 0},${tint.g | 0},${tint.b | 0})`;
          for (let j = 0; j < arr.length; j++) {
            const p = arr[j];
            if (!p) continue;
            if (!p.landed) continue;
            const cellX = Math.floor(Number(p.landX) || Number(p.x) || 0);
            const cellY = Math.floor(Number(p.landY) || Number(p.y) || 0);
            const px = dx + cellX * zoom;
            const py = dy + cellY * zoom;
            if (px < -tileSize || py < -tileSize || px > v.canvasW + tileSize || py > v.canvasH + tileSize) continue;
            ctx.fillRect(px, py, tileSize, tileSize);
          }
        }
      }

      if (phase !== "flight" && phase !== "drop") continue;

      const wx = Number(m.planeX);
      const wy = Number(m.planeY);
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const px = dx + wx * zoom;
      const py = dy + wy * zoom;
      if (px < -48 || py < -48 || px > v.canvasW + 48 || py > v.canvasH + 48) continue;

      let dirX = Number(m.dirX) || 0;
      let dirY = Number(m.dirY) || 0;
      if (Math.hypot(dirX, dirY) < 0.0001) {
        dirX = (Number(m.targetX) || wx) - wx;
        dirY = (Number(m.targetY) || wy) - wy;
      }
      const dirLen = Math.hypot(dirX, dirY) || 1;
      const angle = Math.atan2(dirY / dirLen, dirX / dirLen) + planeOffset;
      const drawSize = Math.max(14, Math.min(42, Math.round(planeBaseSize + zoom * 0.9)));

      // Subtle shadow under the plane.
      ctx.globalAlpha = 0.30;
      ctx.beginPath();
      ctx.ellipse(px, py + 2.0, drawSize * 0.24, drawSize * 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
      ctx.globalAlpha = 1;

      const hasIcon = !!(planeIcon && planeIcon.complete && planeIcon.naturalWidth > 0);
      if (hasIcon) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(planeIcon, Math.round(-drawSize * 0.5), Math.round(-drawSize * 0.5), drawSize, drawSize);
        ctx.restore();
      } else {
        // Fallback plane silhouette if custom icon is missing.
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillStyle = `rgb(${tint.r | 0},${tint.g | 0},${tint.b | 0})`;
        ctx.beginPath();
        ctx.moveTo(0, -drawSize * 0.34);
        ctx.lineTo(drawSize * 0.23, drawSize * 0.28);
        ctx.lineTo(0, drawSize * 0.18);
        ctx.lineTo(-drawSize * 0.23, drawSize * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  render(arg) {
    const opts = (arg && typeof arg === "object") ? arg : {};
    const rubberLine = opts.rubberLine || null;
    const brushGhost = opts.brushGhost || null;
    const selectedStructureId = opts.selectedStructureId || 0;
    const selectedShipId = opts.selectedShipId || 0;
    const intentArrows = Array.isArray(opts.intentArrows) ? opts.intentArrows : null;
    const nukePreview = opts.nukePreview || null;
    const nukeFlights = Array.isArray(opts.nukeFlights) ? opts.nukeFlights : null;
    const airborneMissions = Array.isArray(opts.airborneMissions) ? opts.airborneMissions : null;
    const cset = this._clientSettings || {};
    const usePoliticalMap = cset.politicalMapMode === true;
    const nowS = performance.now() * 0.001;
    const prevVfxT = Number(this._victoryVfxLastT) || nowS;
    const vfxDt = clamp(nowS - prevVfxT, 0, 0.060);
    this._victoryVfxLastT = nowS;
    this._updateVictoryVfx(vfxDt);

    this._updateSmoothZoom();
    let envDt = 0;
    if (cset.atmosphereEnabled !== false) {
      envDt = this._updateEnvironment(this.world);
    } else if (this._env) {
      this._env.rain.intensity = 0;
      this._env.rain.state = "clear";
      this._env.drops.length = 0;
    }
    const v = this._computeViewport();
    if (cset.atmosphereEnabled !== false) this._updateRainDrops(envDt, v);
    const vis = this._getVisibleWorldRect(v, 2);
    if (this.world && typeof this.world._setRenderInterestRect === "function") {
      this.world._setRenderInterestRect({
        x0: vis.sx | 0,
        y0: vis.sy | 0,
        x1: ((vis.sx + vis.sw - 1) | 0),
        y1: ((vis.sy + vis.sh - 1) | 0)
      });
    }

    // Keep base world + overlays updated
    if (usePoliticalMap) this.rebuildPoliticalMap(false);
    else this.rebuildWorldTexture(false);
    this.presentHeatmap();
    if (cset.showHatchOverlay !== false) this.presentHatch();
    if (cset.highlightNation) this.presentNationHighlight();
    this.presentSelection();
    this.presentHover();

    const ctx = this.ctx;

    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(0, 0, v.canvasW, v.canvasH);

    // ===== World-space pass (terrain + hover + selection + borders) =====
    // Render only the visible world region to avoid drawing off-screen tiles.
    this._drawWorldLayerCulled(ctx, usePoliticalMap ? this.politicalCanvas : this.worldCanvas, vis);
    if (cset.showHeatmap) this._drawWorldLayerCulled(ctx, this.heatmapCanvas, vis);
    if (cset.showHatchOverlay !== false && !this._hatchIdle) this._drawWorldLayerCulled(ctx, this.hatchCanvas, vis);
    if (cset.highlightNation) this._drawWorldLayerCulled(ctx, this.highlightCanvas, vis);
    this._drawClaimTransitionsWorld(ctx, v, vis);
    if ((this._hoverOwner | 0) !== OWNER.NONE) this._drawWorldLayerCulled(ctx, this.hoverCanvas, vis);
    if (this._selectionHasPixels) {
      this._drawWorldLayerCulled(ctx, this.selectionCanvas, vis);
      this._drawWorldLayerCulled(ctx, this.selectionOutlineCanvas, vis);
    }

    // ===== Screen-space pass (icons + labels + rubber line) =====
    this._drawDefenceRadiusScreen(ctx, v, selectedStructureId);
    this._drawIntentArrowsScreen(ctx, v, intentArrows);
    // Keep pre-launch placement guidance always visible; the setting only controls
    // destination/path overlays for already-launched missiles.
    this._drawNukeLaunchPreviewScreen(ctx, v, nukePreview);
    const showNukeDestinationOverlay = cset.nukeDestinationOverlay !== false;
    this._drawNukeFlightsScreen(ctx, v, nukeFlights, showNukeDestinationOverlay);
    this._drawAirborneMissionsScreen(ctx, v, airborneMissions);
    this._drawSpawnPicksScreen(ctx, v);
    this._drawStructuresScreen(ctx, v, selectedStructureId);
    if (cset.showShips !== false) this._drawShipsScreen(ctx, v, selectedShipId);
    if (cset.showNationLabels !== false) this._drawNationLabelsScreen(ctx, v);
    this._drawRubberLineScreen(ctx, v, rubberLine);
    this._drawBrushGhostScreen(ctx, v, brushGhost);
    if (cset.atmosphereEnabled !== false) {
      this._drawLightingOverlay(ctx, v, this.world);
      this._drawRain(ctx, v);
    }
    this._drawVictoryVfxScreen(ctx, v);
    this._drawScreenAlertFrame(ctx, v);

    ctx.restore();
  }
}

Renderer.prototype._updateSmoothZoom = function() {
  const now = performance.now();
  const last = this._lastRenderTime || now;
  const dt = Math.min(0.05, (now - last) / 1000);
  this._lastRenderTime = now;

  const zT = Number(this.zoomTarget) || this.zoom;
  const cT = this.cameraTarget || this.camera;
  const reduceMotion = !!(this._clientSettings && this._clientSettings.reduceMotion);

  if (reduceMotion) {
    this.zoom = zT;
    this.camera.x = cT.x;
    this.camera.y = cT.y;
    this._viewport = null;
    this._clampCameraToWorld();
    return;
  }

  const zDiff = Math.abs(this.zoom - zT);
  const cDiff = Math.abs(this.camera.x - cT.x) + Math.abs(this.camera.y - cT.y);

  if (zDiff < 0.0005 && cDiff < 0.02) {
    this.zoom = zT;
    this.camera.x = cT.x;
    this.camera.y = cT.y;
    return;
  }

  const k = Math.max(1, Number(this.zoomSmooth) || 14);
  const t = 1 - Math.exp(-k * dt);

  this.zoom = lerp(this.zoom, zT, t);
  this.camera.x = lerp(this.camera.x, cT.x, t);
  this.camera.y = lerp(this.camera.y, cT.y, t);

  this._viewport = null;
  this._clampCameraToWorld();
};
