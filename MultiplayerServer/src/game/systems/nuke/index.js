// FILE: src/game/systems/nuke/index.js

import { NUKE_WARHEAD, OWNER } from "../../config.js";
import { clamp01, clampInt } from "../../utils.js";

const BLAST_OUTLINE_POINTS = 72;
const BLAST_DROP_EDGE_START = 0.78;
const BLAST_DROP_EDGE_FACTOR = 0.58;

export function installNuke(World) {
  World.prototype._nukeSpec = function(warheadType) {
    const t = String(warheadType || "").toLowerCase();
    return NUKE_WARHEAD[t] || null;
  };

  World.prototype._flightPointAt = function(flight, t01) {
    const t = clamp01(t01);
    const sx = Number(flight?.startX) || 0;
    const sy = Number(flight?.startY) || 0;
    const tx = Number(flight?.targetX) || 0;
    const ty = Number(flight?.targetY) || 0;
    const linear = String(flight?.pathKind || "").toLowerCase() === "line" || !!flight?.linearPath;
    if (linear) {
      return {
        x: sx + (tx - sx) * t,
        y: sy + (ty - sy) * t
      };
    }

    const u = 1 - t;
    const cx = Number(flight?.controlX) || ((sx + tx) * 0.5);
    const cy = Number(flight?.controlY) || ((sy + ty) * 0.5);
    return {
      x: (u * u * sx) + (2 * u * t * cx) + (t * t * tx),
      y: (u * u * sy) + (2 * u * t * cy) + (t * t * ty)
    };
  };

  World.prototype._flightTangentAt = function(flight, t01) {
    const t = clamp01(t01);
    const sx = Number(flight?.startX) || 0;
    const sy = Number(flight?.startY) || 0;
    const tx = Number(flight?.targetX) || 0;
    const ty = Number(flight?.targetY) || 0;
    const linear = String(flight?.pathKind || "").toLowerCase() === "line" || !!flight?.linearPath;
    if (linear) return { x: tx - sx, y: ty - sy };

    const cx = Number(flight?.controlX) || ((sx + tx) * 0.5);
    const cy = Number(flight?.controlY) || ((sy + ty) * 0.5);
    return {
      x: (2 * (1 - t) * (cx - sx)) + (2 * t * (tx - cx)),
      y: (2 * (1 - t) * (cy - sy)) + (2 * t * (ty - cy))
    };
  };

  World.prototype._nukeHash01 = function(a, b, c = 0) {
    const aa = a | 0;
    const bb = b | 0;
    const cc = c | 0;
    let h = (Math.imul(aa, 374761393) ^ Math.imul(bb, 668265263) ^ Math.imul(cc, 1442695041)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
  };

  World.prototype._nukeBlastRadiusScale = function(angleRad, seed = 1) {
    const s = seed >>> 0;
    const p0 = (s & 1023) * 0.013;
    const p1 = ((s >>> 10) & 1023) * 0.017 + 0.9;
    const p2 = ((s >>> 20) & 1023) * 0.021 + 2.1;
    const n0 = Math.sin(angleRad * 2.7 + p0) * 0.15;
    const n1 = Math.sin(angleRad * 4.9 + p1) * 0.10;
    const n2 = Math.sin(angleRad * 8.5 + p2) * 0.07;
    return Math.max(0.60, Math.min(1.36, 1 + n0 + n1 + n2));
  };

  World.prototype._buildNukeBlastOutline = function(cx, cy, radiusTiles, seed, pointCount = BLAST_OUTLINE_POINTS) {
    const r = Math.max(0, Number(radiusTiles) || 0);
    const out = [];
    if (r <= 0) return out;

    const points = Math.max(16, pointCount | 0);
    const twoPi = Math.PI * 2;
    const minX = 0.5;
    const minY = 0.5;
    const maxX = this.w - 0.5;
    const maxY = this.h - 0.5;

    for (let i = 0; i < points; i++) {
      const a = (i / points) * twoPi;
      const noise = (this._nukeHash01(i, seed | 0, 0x9E3779B9) - 0.5) * 0.20;
      const localScale = Math.max(0.56, Math.min(1.42, this._nukeBlastRadiusScale(a, seed) + noise));
      const edgeR = Math.max(0.5, r * localScale);
      const x = Math.max(minX, Math.min(maxX, Number(cx) + Math.cos(a) * edgeR));
      const y = Math.max(minY, Math.min(maxY, Number(cy) + Math.sin(a) * edgeR));
      out.push({ x, y });
    }

    return out;
  };

  World.prototype._collectBlastTiles = function(cx, cy, radiusTiles, seed, capTiles = 0) {
    const r = Math.max(0, Number(radiusTiles) || 0);
    if (r <= 0) return { indices: [], ownerHits: new Map() };

    const cap = Math.max(0, capTiles | 0);
    const maxR = r * 1.42;
    const minX = Math.max(0, Math.floor(Number(cx) - maxR));
    const maxX = Math.min(this.w - 1, Math.ceil(Number(cx) + maxR));
    const minY = Math.max(0, Math.floor(Number(cy) - maxR));
    const maxY = Math.min(this.h - 1, Math.ceil(Number(cy) + maxR));
    const seen = new Set();
    const scored = [];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.w + x;
        if (!this.land[idx]) continue;
        const tx = x + 0.5;
        const ty = y + 0.5;
        const dx = tx - Number(cx);
        const dy = ty - Number(cy);
        const dist = Math.hypot(dx, dy);
        if (dist > maxR) continue;

        const angle = Math.atan2(dy, dx);
        const scaleNoise = (this._nukeHash01(x, y, (seed | 0) ^ 0xA5A5A5A5) - 0.5) * 0.20;
        const localScale = Math.max(0.54, Math.min(1.44, this._nukeBlastRadiusScale(angle, seed) + scaleNoise));
        const localR = Math.max(0.42, r * localScale);
        if (dist > localR) continue;

        const edge01 = dist / Math.max(0.0001, localR);
        if (edge01 > BLAST_DROP_EDGE_START) {
          const dropP = ((edge01 - BLAST_DROP_EDGE_START) / (1 - BLAST_DROP_EDGE_START)) * BLAST_DROP_EDGE_FACTOR;
          if (this._nukeHash01(x ^ (seed | 0), y, 0x68BC21EB) < dropP) continue;
        }

        if (seen.has(idx)) continue;
        seen.add(idx);
        const scoreNoise = this._nukeHash01(idx, seed | 0, 0x1B873593);
        scored.push({ idx, score: dist * (0.82 + scoreNoise * 0.36) });
      }
    }

    const centerX = clampInt(Math.floor(Number(cx) || 0), 0, this.w - 1);
    const centerY = clampInt(Math.floor(Number(cy) || 0), 0, this.h - 1);
    const centerIdx = centerY * this.w + centerX;
    if (this.land[centerIdx] && !seen.has(centerIdx)) {
      seen.add(centerIdx);
      scored.push({ idx: centerIdx, score: 0 });
    }

    if (cap > 0 && scored.length > cap) {
      scored.sort((a, b) => a.score - b.score);
      scored.length = cap;
    }

    const out = new Array(scored.length);
    const ownerHits = new Map();
    for (let i = 0; i < scored.length; i++) {
      const idx = scored[i].idx | 0;
      out[i] = idx;
      const o = this.owner[idx] | 0;
      if (o <= OWNER.NONE) continue;
      ownerHits.set(o, (ownerHits.get(o) || 0) + 1);
    }

    return { indices: out, ownerHits };
  };

  World.prototype._destroyStructuresInBlastTiles = function(tileIndices, capStructures = 0) {
    if (!Array.isArray(tileIndices) || tileIndices.length <= 0) return 0;

    const cap = Math.max(0, capStructures | 0);
    const footprint = new Set(tileIndices);
    const hit = [];

    for (let i = 0; i < this.structures.length; i++) {
      const st = this.structures[i];
      if (!st) continue;
      const sx = st.x | 0;
      const sy = st.y | 0;
      let struck = false;
      for (let yy = sy - 1; yy <= sy + 1 && !struck; yy++) {
        if (yy < 0 || yy >= this.h) continue;
        for (let xx = sx - 1; xx <= sx + 1; xx++) {
          if (xx < 0 || xx >= this.w) continue;
          const idx = yy * this.w + xx;
          if (!footprint.has(idx)) continue;
          struck = true;
          break;
        }
      }
      if (!struck) continue;
      hit.push(st.id | 0);
    }

    if (cap > 0 && hit.length > cap) hit.length = cap;

    let removed = 0;
    for (let i = 0; i < hit.length; i++) {
      const sid = hit[i] | 0;
      if (!sid) continue;
      const st = this._structureById.get(sid);
      if (!st) continue;
      if (String(st.type || "") === "capital") {
        const capOwner = st.owner | 0;
        if (capOwner > 0) this._onCapitalCaptured(capOwner, OWNER.NONE, sid);
      } else {
        this._removeStructureById(sid);
      }
      removed++;
    }
    return removed;
  };

  World.prototype._buildMissileArc = function(st, targetX, targetY, warheadType) {
    const spec = this._nukeSpec(warheadType);
    if (!st || !spec) return null;

    const tx = clampInt(targetX | 0, 0, this.w - 1);
    const ty = clampInt(targetY | 0, 0, this.h - 1);
    const sx = (st.x | 0) + 0.5;
    const sy = (st.y | 0) + 0.5;
    const ex = tx + 0.5;
    const ey = ty + 0.5;
    const dist = Math.hypot(ex - sx, ey - sy);

    const speed = Math.max(1, Number(spec.flightSpeedTilesPerS) || 1);
    const baseFlightTimeS = Math.max(0, Number(spec.baseFlightTimeS) || 0);
    const durationS = Math.max(0.1, baseFlightTimeS + (dist / speed));

    const seed = (((st.id | 0) * 2654435761) ^ ((tx + 1) * 73856093) ^ ((ty + 1) * 19349663) ^ (spec.key === "hydrogen" ? 0x9E3779B9 : 0x7F4A7C15)) >>> 0;
    const blastRadiusTiles = Math.max(1, Number(spec.blastRadiusTiles) || 1);

    return {
      type: spec.key,
      label: spec.label,
      startX: sx,
      startY: sy,
      controlX: (sx + ex) * 0.5,
      controlY: (sy + ey) * 0.5,
      targetX: ex,
      targetY: ey,
      durationS,
      pathKind: "line",
      linearPath: true,
      blastSeed: seed,
      blastOutline: this._buildNukeBlastOutline(ex, ey, blastRadiusTiles, seed, BLAST_OUTLINE_POINTS),
      blastRadiusTiles,
      neutralizeTileCap: Math.max(0, Number(spec.neutralizeTileCap) || 0),
      structureDestroyCap: Math.max(0, Number(spec.structureDestroyCap) || 0),
      launchStabilityPenaltyPct: Math.max(0, Number(spec.launchStabilityPenaltyPct) || 0)
    };
  };

  World.prototype._detonateWarhead = function(flight) {
    if (!flight) return 0;

    const txf = Math.max(0.5, Math.min(this.w - 0.5, Number(flight.targetX) || 0.5));
    const tyf = Math.max(0.5, Math.min(this.h - 0.5, Number(flight.targetY) || 0.5));
    const blastRadius = Math.max(1, Number(flight.blastRadiusTiles) || 1);
    const blastCap = Math.max(0, Number(flight.neutralizeTileCap) || 0);
    const structCap = Math.max(0, Number(flight.structureDestroyCap) || 0);

    let blastSeed = Number(flight.blastSeed) || 0;
    if (!blastSeed) {
      const tx = clampInt(Math.floor(txf), 0, this.w - 1);
      const ty = clampInt(Math.floor(tyf), 0, this.h - 1);
      blastSeed = (((flight.id | 0) * 2654435761) ^ ((tx + 1) * 73856093) ^ ((ty + 1) * 19349663)) >>> 0;
    }

    const blast = this._collectBlastTiles(txf, tyf, blastRadius, blastSeed, blastCap);
    const affected = Array.isArray(blast.indices) ? blast.indices : [];
    const ownerHits = blast.ownerHits instanceof Map ? blast.ownerHits : new Map();

    for (let i = 0; i < affected.length; i++) {
      this._pushNukeNeutralizeFx(affected[i] | 0, this.time);
    }

    let neutralized = 0;
    this._beginOwnerBatch();
    try {
      for (let i = 0; i < affected.length; i++) {
        const idx = affected[i] | 0;
        if (idx < 0 || idx >= (this.w * this.h)) continue;
        if (!this.land[idx]) continue;
        const curOwner = this.owner[idx] | 0;
        if (curOwner <= OWNER.NONE) continue;
        this._setOwner(idx, OWNER.NONE);
        neutralized++;
      }
    } finally {
      this._endOwnerBatch();
    }

    const structuresDestroyed = this._destroyStructuresInBlastTiles(affected, structCap);

    const attacker = flight.owner | 0;
    if (attacker > OWNER.NONE && ownerHits.size > 0) {
      for (const [defender, tilesHit] of ownerHits.entries()) {
        const D = defender | 0;
        if (D <= OWNER.NONE || D === attacker || tilesHit <= 0) continue;
        this._forceWarForNuke(attacker, D, "nuclear strike damage");
        this._pushEvent(`${String(flight.label || "Warhead")} impact on ${this._nameOf(D)} territory.`, {
          kind: "nuke_impact",
          from: attacker,
          to: D
        });
      }
    }

    if ((flight.owner | 0) === OWNER.PLAYER) {
      this._pushEvent(
        `${String(flight.label || "Warhead")} detonated `
        + `(${neutralized} tiles neutralized, ${structuresDestroyed} structures destroyed).`
      );
    }
    return neutralized;
  };
}
