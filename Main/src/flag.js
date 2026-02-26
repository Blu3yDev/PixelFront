// src/flag.js
// Structured flag model + renderer used by main menu editor and in-game labels.

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const FLAG_LAYOUT_OPTIONS = Object.freeze([
  "solid",
  "horizontal_stripes",
  "vertical_stripes",
  "nordic_cross",
  "diagonal_split",
  "canton",
  "centered_cross",
  "saltire",
  "pale",
  "fess",
  "quarterly",
  "hoist_triangle"
]);

export const FLAG_SHAPE_OPTIONS = Object.freeze([
  "none",
  "line",
  "rect",
  "circle",
  "diamond",
  "triangle",
  "star",
  "chevron",
  "ring",
  "crescent",
  "cross",
  "pentagon",
  "hexagon"
]);

export const FLAG_MAX_SHAPES = 24;
export const FLAG_MAX_STROKES = 240;
export const FLAG_MAX_STROKE_POINTS = 420;

export function createDefaultFlag() {
  return sanitizeFlag({
    layout: "horizontal_stripes",
    colors: ["#203a8f", "#f2f2f2", "#d42c2c"],
    stripeCount: 3,
    border: { enabled: true, color: "#121212", width: 1 },
    strokes: [],
    shapes: [
      { enabled: true, type: "star", color: "#f2d85c", x: 0.5, y: 0.5, w: 0.28, h: 0.28, rotation: 0, opacity: 1 }
    ]
  });
}

export function createPresetFlag(key = "default") {
  const k = String(key || "").toLowerCase();
  if (k === "tricolor") {
    return sanitizeFlag({
      layout: "vertical_stripes",
      colors: ["#1f8b4c", "#f5f5f5", "#d73a3a"],
      stripeCount: 3,
      border: { enabled: true, color: "#101010", width: 1 },
      strokes: [],
      shapes: []
    });
  }
  if (k === "nordic") {
    return sanitizeFlag({
      layout: "nordic_cross",
      colors: ["#17408f", "#f2d24f", "#f5f5f5"],
      stripeCount: 3,
      border: { enabled: true, color: "#101010", width: 1 },
      strokes: [],
      shapes: []
    });
  }
  if (k === "canton_star") {
    return sanitizeFlag({
      layout: "canton",
      colors: ["#b52323", "#203a8f", "#f5f5f5"],
      stripeCount: 3,
      border: { enabled: true, color: "#101010", width: 1 },
      strokes: [],
      shapes: [
        { enabled: true, type: "star", color: "#ffffff", x: 0.72, y: 0.52, w: 0.24, h: 0.24, rotation: 0, opacity: 1 },
        { enabled: true, type: "star", color: "#ffffff", x: 0.20, y: 0.20, w: 0.10, h: 0.10, rotation: 0, opacity: 1 }
      ]
    });
  }
  if (k === "quartered") {
    return sanitizeFlag({
      layout: "quarterly",
      colors: ["#203a8f", "#f2f2f2", "#c62b2b"],
      stripeCount: 4,
      border: { enabled: true, color: "#101010", width: 1 },
      strokes: [],
      shapes: [{ enabled: true, type: "ring", color: "#f2d24f", x: 0.5, y: 0.5, w: 0.34, h: 0.34, rotation: 0, opacity: 1 }]
    });
  }
  if (k === "saltire") {
    return sanitizeFlag({
      layout: "saltire",
      colors: ["#17408f", "#f5f5f5", "#c62b2b"],
      stripeCount: 3,
      border: { enabled: true, color: "#101010", width: 1 },
      strokes: [],
      shapes: []
    });
  }
  return createDefaultFlag();
}

export function createRandomFlag() {
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const randColor = () => {
    const n = () => ((Math.random() * 210 + 25) | 0).toString(16).padStart(2, "0");
    return `#${n()}${n()}${n()}`;
  };
  const rand01 = (a, b) => a + Math.random() * (b - a);
  const layout = pick(FLAG_LAYOUT_OPTIONS);
  const colorA = randColor();
  let colorB = randColor();
  let colorC = randColor();
  if (colorB === colorA) colorB = "#f0f0f0";
  if (colorC === colorA || colorC === colorB) colorC = "#1a1a1a";

  const shapeCount = clampInt(((Math.random() * 5) | 0) + 1, 1, FLAG_MAX_SHAPES);
  const shapes = [];
  for (let i = 0; i < shapeCount; i++) {
    shapes.push({
      enabled: i === 0 ? true : Math.random() > 0.25,
      type: pick(FLAG_SHAPE_OPTIONS.slice(1)),
      color: randColor(),
      x: rand01(0.18, 0.82),
      y: rand01(0.18, 0.82),
      w: rand01(0.10, 0.42),
      h: rand01(0.10, 0.42),
      rotation: ((Math.random() * 360) | 0) - 180,
      opacity: rand01(0.55, 1)
    });
  }

  return sanitizeFlag({
    layout,
    colors: [colorA, colorB, colorC],
    stripeCount: ((Math.random() * 6) | 0) + 2,
    border: { enabled: true, color: randColor(), width: ((Math.random() * 3) | 0) + 1 },
    strokes: [],
    shapes
  });
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampRange(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  const f = Math.floor(n);
  if (f < lo) return lo;
  if (f > hi) return hi;
  return f;
}

function sanitizeColor(raw, fallback) {
  const text = String(raw || "").trim();
  if (HEX_COLOR_RE.test(text)) return text.toLowerCase();
  return String(fallback || "#ffffff").toLowerCase();
}

function normalizeRotationDeg(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  let v = Math.round(n);
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

export function sanitizeFlag(next) {
  const def = {
    layout: "horizontal_stripes",
    colors: ["#203a8f", "#f2f2f2", "#d42c2c"],
    stripeCount: 3,
    border: { enabled: true, color: "#121212", width: 1 },
    strokes: [],
    shapes: []
  };
  const src = (next && typeof next === "object") ? next : {};
  const layoutRaw = String(src.layout || def.layout).toLowerCase();
  const layout = FLAG_LAYOUT_OPTIONS.includes(layoutRaw) ? layoutRaw : def.layout;

  const colorSrc = Array.isArray(src.colors) ? src.colors : def.colors;
  const colors = [
    sanitizeColor(colorSrc[0], def.colors[0]),
    sanitizeColor(colorSrc[1], def.colors[1]),
    sanitizeColor(colorSrc[2], def.colors[2])
  ];

  const borderSrc = (src.border && typeof src.border === "object") ? src.border : def.border;
  const border = {
    enabled: Boolean(borderSrc.enabled),
    color: sanitizeColor(borderSrc.color, def.border.color),
    width: clampInt(borderSrc.width, 1, 8)
  };

  const rawShapes = Array.isArray(src.shapes) ? src.shapes : def.shapes;
  const shapes = [];
  const maxShapes = FLAG_MAX_SHAPES;
  for (let i = 0; i < rawShapes.length && i < maxShapes; i++) {
    const rs = (rawShapes[i] && typeof rawShapes[i] === "object") ? rawShapes[i] : {};
    const typeRaw = String(rs.type || "none").toLowerCase();
    const type = FLAG_SHAPE_OPTIONS.includes(typeRaw) ? typeRaw : "none";
    shapes.push({
      enabled: Boolean(rs.enabled) && type !== "none",
      type,
      color: sanitizeColor(rs.color, "#ffffff"),
      x: clamp01(rs.x == null ? 0.5 : rs.x),
      y: clamp01(rs.y == null ? 0.5 : rs.y),
      w: clampRange(rs.w == null ? 0.2 : rs.w, 0.04, 1),
      h: clampRange(rs.h == null ? 0.2 : rs.h, 0.04, 1),
      rotation: normalizeRotationDeg(rs.rotation),
      opacity: clampRange(rs.opacity == null ? 1 : rs.opacity, 0.05, 1)
    });
  }

  const rawStrokes = Array.isArray(src.strokes) ? src.strokes : def.strokes;
  const strokes = [];
  const maxStrokes = FLAG_MAX_STROKES;
  for (let i = 0; i < rawStrokes.length && i < maxStrokes; i++) {
    const rs = (rawStrokes[i] && typeof rawStrokes[i] === "object") ? rawStrokes[i] : {};
    const pointsRaw = Array.isArray(rs.points) ? rs.points : [];
    const points = [];
    for (let j = 0; j < pointsRaw.length && j < FLAG_MAX_STROKE_POINTS; j++) {
      const p = (pointsRaw[j] && typeof pointsRaw[j] === "object") ? pointsRaw[j] : {};
      points.push({
        x: clamp01(p.x),
        y: clamp01(p.y)
      });
    }
    if (points.length <= 0) continue;
    const tool = String(rs.tool || "brush").toLowerCase() === "eraser" ? "eraser" : "brush";
    strokes.push({
      tool,
      color: sanitizeColor(rs.color, "#ffffff"),
      size: clampRange(rs.size == null ? 0.032 : rs.size, 0.003, 0.24),
      opacity: clampRange(rs.opacity == null ? 1 : rs.opacity, 0.05, 1),
      points
    });
  }

  return {
    layout,
    colors,
    stripeCount: clampInt(src.stripeCount, 2, 7),
    border,
    strokes,
    shapes
  };
}

function drawStarPath(ctx, rOuter, rInner, points = 5) {
  const pts = Math.max(3, points | 0);
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const ang = (-Math.PI / 2) + (i * Math.PI / pts);
    const r = (i % 2 === 0) ? rOuter : rInner;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawPolygonPath(ctx, radius, points = 5, rotation = -Math.PI / 2) {
  const pts = Math.max(3, points | 0);
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const ang = rotation + (Math.PI * 2 * i / pts);
    const x = Math.cos(ang) * radius;
    const y = Math.sin(ang) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawShape(ctx, shape, x, y, w, h, color, rotationDeg, opacity = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Number(rotationDeg) || 0) * Math.PI / 180);
  ctx.fillStyle = color;
  ctx.globalAlpha = clampRange(opacity, 0.05, 1);

  const hw = w * 0.5;
  const hh = h * 0.5;
  const t = String(shape || "none");

  if (t === "rect") {
    ctx.fillRect(-hw, -hh, w, h);
  } else if (t === "line") {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, hh * 2);
    ctx.lineCap = "round";
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.strokeStyle = color;
    ctx.stroke();
  } else if (t === "circle") {
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (t === "diamond") {
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, 0);
    ctx.lineTo(0, hh);
    ctx.lineTo(-hw, 0);
    ctx.closePath();
    ctx.fill();
  } else if (t === "triangle") {
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, hh);
    ctx.lineTo(-hw, hh);
    ctx.closePath();
    ctx.fill();
  } else if (t === "star") {
    drawStarPath(ctx, Math.max(hw, hh), Math.max(hw, hh) * 0.45, 5);
    ctx.fill();
  } else if (t === "chevron") {
    ctx.beginPath();
    ctx.moveTo(-hw, -hh * 0.65);
    ctx.lineTo(0, hh * 0.65);
    ctx.lineTo(hw, -hh * 0.65);
    ctx.lineTo(hw, -hh);
    ctx.lineTo(0, hh * 0.28);
    ctx.lineTo(-hw, -hh);
    ctx.closePath();
    ctx.fill();
  } else if (t === "ring") {
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    ctx.ellipse(0, 0, hw * 0.58, hh * 0.58, 0, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  } else if (t === "crescent") {
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    ctx.ellipse(hw * 0.36, -hh * 0.06, hw * 0.76, hh * 0.76, 0, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  } else if (t === "cross") {
    const barW = Math.max(2, w * 0.3);
    const barH = Math.max(2, h * 0.3);
    ctx.fillRect(-barW * 0.5, -hh, barW, h);
    ctx.fillRect(-hw, -barH * 0.5, w, barH);
  } else if (t === "pentagon") {
    drawPolygonPath(ctx, Math.max(hw, hh), 5);
    ctx.fill();
  } else if (t === "hexagon") {
    drawPolygonPath(ctx, Math.max(hw, hh), 6);
    ctx.fill();
  }

  ctx.restore();
}

function drawStrokes(ctx, w, h, flag) {
  const strokes = Array.isArray(flag?.strokes) ? flag.strokes : [];
  if (strokes.length <= 0) return;

  // Draw paint strokes on an isolated layer so eraser only affects paint content.
  const layer = (typeof document !== "undefined" && typeof document.createElement === "function")
    ? document.createElement("canvas")
    : null;
  if (!layer || typeof layer.getContext !== "function") return;
  layer.width = w;
  layer.height = h;
  const lctx = layer.getContext("2d", { alpha: true });
  if (!lctx) return;
  lctx.clearRect(0, 0, w, h);
  lctx.lineJoin = "round";
  lctx.lineCap = "round";

  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (!s || !Array.isArray(s.points) || s.points.length <= 0) continue;
    const isEraser = String(s.tool || "brush") === "eraser";
    const strokeWidthPx = Math.max(1, clampRange(s.size, 0.003, 0.24) * Math.min(w, h));
    lctx.save();
    lctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    lctx.globalAlpha = clampRange(s.opacity, 0.05, 1);
    lctx.strokeStyle = isEraser ? "#000000" : sanitizeColor(s.color, "#ffffff");
    lctx.lineWidth = strokeWidthPx;
    const points = s.points;
    const p0 = points[0];
    const x0 = clamp01(p0?.x) * w;
    const y0 = clamp01(p0?.y) * h;
    if (points.length === 1) {
      lctx.beginPath();
      lctx.arc(x0, y0, strokeWidthPx * 0.5, 0, Math.PI * 2);
      lctx.fillStyle = isEraser ? "#000000" : sanitizeColor(s.color, "#ffffff");
      lctx.fill();
    } else if (points.length === 2) {
      lctx.beginPath();
      lctx.moveTo(x0, y0);
      const p1 = points[1];
      lctx.lineTo(clamp01(p1?.x) * w, clamp01(p1?.y) * h);
      lctx.stroke();
    } else {
      // Quadratic midpoint smoothing for fluid brush lines.
      lctx.beginPath();
      lctx.moveTo(x0, y0);
      for (let j = 1; j < points.length - 1; j++) {
        const p = points[j];
        const pn = points[j + 1];
        const px = clamp01(p?.x) * w;
        const py = clamp01(p?.y) * h;
        const nx = clamp01(pn?.x) * w;
        const ny = clamp01(pn?.y) * h;
        const mx = (px + nx) * 0.5;
        const my = (py + ny) * 0.5;
        lctx.quadraticCurveTo(px, py, mx, my);
      }
      const pe = points[points.length - 1];
      lctx.lineTo(clamp01(pe?.x) * w, clamp01(pe?.y) * h);
      lctx.stroke();
    }
    lctx.restore();
  }

  ctx.drawImage(layer, 0, 0);
}

function drawLayout(ctx, w, h, flag) {
  const c0 = flag.colors[0];
  const c1 = flag.colors[1];
  const c2 = flag.colors[2];
  const stripes = clampInt(flag.stripeCount, 2, 7);
  const layout = String(flag.layout || "solid");

  ctx.fillStyle = c0;
  ctx.fillRect(0, 0, w, h);

  if (layout === "horizontal_stripes") {
    const hh = h / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 3 === 0 ? c0 : (i % 3 === 1 ? c1 : c2);
      ctx.fillRect(0, i * hh, w, hh + 1);
    }
  } else if (layout === "vertical_stripes") {
    const ww = w / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 3 === 0 ? c0 : (i % 3 === 1 ? c1 : c2);
      ctx.fillRect(i * ww, 0, ww + 1, h);
    }
  } else if (layout === "nordic_cross") {
    const outerW = Math.max(2, Math.round(w * 0.18));
    const outerH = Math.max(2, Math.round(h * 0.24));
    const innerW = Math.max(1, Math.round(outerW * 0.52));
    const innerH = Math.max(1, Math.round(outerH * 0.52));
    const x = Math.round(w * 0.36) - (outerW * 0.5);
    const y = Math.round(h * 0.50) - (outerH * 0.5);
    ctx.fillStyle = c1;
    ctx.fillRect(0, y, w, outerH);
    ctx.fillRect(x, 0, outerW, h);
    ctx.fillStyle = c2;
    ctx.fillRect(0, Math.round(h * 0.50) - (innerH * 0.5), w, innerH);
    ctx.fillRect(Math.round(w * 0.36) - (innerW * 0.5), 0, innerW, h);
  } else if (layout === "diagonal_split") {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = c1;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = c2;
    ctx.fill();
  } else if (layout === "canton") {
    const cw = Math.round(w * 0.44);
    const ch = Math.round(h * 0.54);
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, cw, ch);
  } else if (layout === "centered_cross") {
    const outerW = Math.max(2, Math.round(w * 0.2));
    const outerH = Math.max(2, Math.round(h * 0.28));
    const innerW = Math.max(1, Math.round(outerW * 0.5));
    const innerH = Math.max(1, Math.round(outerH * 0.5));
    ctx.fillStyle = c1;
    ctx.fillRect(Math.round((w - outerW) * 0.5), 0, outerW, h);
    ctx.fillRect(0, Math.round((h - outerH) * 0.5), w, outerH);
    ctx.fillStyle = c2;
    ctx.fillRect(Math.round((w - innerW) * 0.5), 0, innerW, h);
    ctx.fillRect(0, Math.round((h - innerH) * 0.5), w, innerH);
  } else if (layout === "saltire") {
    const lineW = Math.max(2, Math.round(Math.min(w, h) * 0.2));
    const lineInner = Math.max(1, Math.round(lineW * 0.45));
    ctx.strokeStyle = c1;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.strokeStyle = c2;
    ctx.lineWidth = lineInner;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();
  } else if (layout === "pale") {
    const barW = Math.max(2, Math.round(w * 0.32));
    ctx.fillStyle = c1;
    ctx.fillRect(Math.round((w - barW) * 0.5), 0, barW, h);
    const inner = Math.max(1, Math.round(barW * 0.45));
    ctx.fillStyle = c2;
    ctx.fillRect(Math.round((w - inner) * 0.5), 0, inner, h);
  } else if (layout === "fess") {
    const barH = Math.max(2, Math.round(h * 0.32));
    ctx.fillStyle = c1;
    ctx.fillRect(0, Math.round((h - barH) * 0.5), w, barH);
    const inner = Math.max(1, Math.round(barH * 0.45));
    ctx.fillStyle = c2;
    ctx.fillRect(0, Math.round((h - inner) * 0.5), w, inner);
  } else if (layout === "quarterly") {
    const hw = Math.round(w * 0.5);
    const hh = Math.round(h * 0.5);
    ctx.fillStyle = c1;
    ctx.fillRect(hw, 0, w - hw, hh);
    ctx.fillRect(0, hh, hw, h - hh);
    ctx.fillStyle = c2;
    ctx.fillRect(hw, hh, w - hw, h - hh);
  } else if (layout === "hoist_triangle") {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.round(w * 0.52), Math.round(h * 0.5));
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = c1;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.round(w * 0.36), Math.round(h * 0.5));
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = c2;
    ctx.fill();
  }
}

export function renderFlagToCanvas(canvas, flagInput, opts = null) {
  if (!canvas || typeof canvas.getContext !== "function") return;
  const flag = sanitizeFlag(flagInput);
  const options = (opts && typeof opts === "object") ? opts : {};
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const w = Math.max(1, canvas.width | 0);
  const h = Math.max(1, canvas.height | 0);
  const smoothing = options.smoothing === true;
  ctx.imageSmoothingEnabled = smoothing;
  ctx.clearRect(0, 0, w, h);

  drawLayout(ctx, w, h, flag);

  const shapes = Array.isArray(flag.shapes) ? flag.shapes : [];
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (!s || !s.enabled || String(s.type || "none") === "none") continue;
    const x = clamp01(s.x) * w;
    const y = clamp01(s.y) * h;
    const sw = Math.max(2, clampRange(s.w, 0.04, 1) * w);
    const sh = Math.max(2, clampRange(s.h, 0.04, 1) * h);
    drawShape(ctx, s.type, x, y, sw, sh, sanitizeColor(s.color, "#ffffff"), s.rotation, s.opacity);
  }

  drawStrokes(ctx, w, h, flag);

  if (flag.border && flag.border.enabled) {
    const bw = clampInt(flag.border.width, 1, 8);
    ctx.lineWidth = bw;
    ctx.strokeStyle = sanitizeColor(flag.border.color, "#101010");
    ctx.strokeRect(bw * 0.5, bw * 0.5, w - bw, h - bw);
  }
}
