// FILE: src/game/systems/structures.js

import { STRUCT_FOOTPRINT_R } from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

export function installStructures(World) {
    // ===== Structures =====

  World.prototype._canPlaceStructureFootprint = function(ownerId, cx, cy) {
    const oid = ownerId | 0;
    const x0 = cx | 0, y0 = cy | 0;
    const w = this.w, h = this.h;

    // Land structures must keep their full 3x3 footprint on owned land.
    // Only validating the center tile lets buildings visually spill into
    // ocean/enemy territory, which shows up most clearly in multiplayer.
    for (let dy = -STRUCT_FOOTPRINT_R; dy <= STRUCT_FOOTPRINT_R; dy++) {
      for (let dx = -STRUCT_FOOTPRINT_R; dx <= STRUCT_FOOTPRINT_R; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const idx = y * w + x;
        if (!this.land[idx]) return false;
        if ((this.owner[idx] | 0) !== oid) return false;

        const sid = this._structAt[idx] | 0;
        if (!sid) continue;

        const st = this._structureById.get(sid);
        if (st) return false;

        // Stale footprint from a removed structure.
        if (!st) this._structAt[idx] = 0;
      }
    }
    return true;
  }

  World.prototype._canPlacePortFootprint = function(ownerId, cx, cy) {
    const oid = ownerId | 0;
    const x0 = cx | 0, y0 = cy | 0;
    const w = this.w | 0;
    const h = this.h | 0;

    // Ports are coastal structures, so their 3x3 footprint may extend over
    // ocean tiles, but never over foreign land or occupied tiles.
    for (let dy = -STRUCT_FOOTPRINT_R; dy <= STRUCT_FOOTPRINT_R; dy++) {
      for (let dx = -STRUCT_FOOTPRINT_R; dx <= STRUCT_FOOTPRINT_R; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const idx = y * w + x;

        if (this.land[idx] && ((this.owner[idx] | 0) !== oid)) return false;

        const sid = this._structAt[idx] | 0;
        if (!sid) continue;

        const st = this._structureById.get(sid);
        if (st) return false;

        if (!st) this._structAt[idx] = 0;
      }
    }
    return true;
  }

  World.prototype._canPlaceCoastalRigFootprint = function(ownerId, cx, cy) {
    const oid = ownerId | 0;
    const x0 = cx | 0, y0 = cy | 0;
    const w = this.w | 0;
    const h = this.h | 0;

    for (let dy = -STRUCT_FOOTPRINT_R; dy <= STRUCT_FOOTPRINT_R; dy++) {
      for (let dx = -STRUCT_FOOTPRINT_R; dx <= STRUCT_FOOTPRINT_R; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const idx = y * w + x;
        if (this.land[idx]) return false;

        const sid = this._structAt[idx] | 0;
        if (!sid) continue;

        const st = this._structureById.get(sid);
        if (!st) {
          this._structAt[idx] = 0;
          continue;
        }
        if ((st.owner | 0) === oid && ((st.x | 0) === x0) && ((st.y | 0) === y0)) continue;
        return false;
      }
    }
    return true;
  }

  World.prototype._canPlaceTypedStructureFootprint = function(type, ownerId, cx, cy) {
    const t = String(type || "");
    if (t === "coastal_rig") return this._canPlaceCoastalRigFootprint(ownerId, cx, cy);
    if (t === "port") return this._canPlacePortFootprint(ownerId, cx, cy);
    return this._canPlaceStructureFootprint(ownerId, cx, cy);
  }

  World.prototype._markStructureFootprint = function(structId, cx, cy) {
    const sid = structId | 0;
    const x0 = cx | 0, y0 = cy | 0;
    const w = this.w, h = this.h;

    for (let dy = -STRUCT_FOOTPRINT_R; dy <= STRUCT_FOOTPRINT_R; dy++) {
      for (let dx = -STRUCT_FOOTPRINT_R; dx <= STRUCT_FOOTPRINT_R; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const idx = y * w + x;
        this._structAt[idx] = sid;
      }
    }
  }

  World.prototype._clearStructureFootprint = function(structId, cx, cy) {
    const sid = structId | 0;
    const x0 = cx | 0, y0 = cy | 0;
    const w = this.w, h = this.h;

    for (let dy = -STRUCT_FOOTPRINT_R; dy <= STRUCT_FOOTPRINT_R; dy++) {
      for (let dx = -STRUCT_FOOTPRINT_R; dx <= STRUCT_FOOTPRINT_R; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const idx = y * w + x;
        if ((this._structAt[idx] | 0) === sid) this._structAt[idx] = 0;
      }
    }
  }

  World.prototype._addStructure = function(type, ownerId, x, y) {
    const id = this._nextStructId++;
    const st = {
      id,
      type: String(type),
      owner: ownerId | 0,
      x: x | 0,
      y: y | 0,
      count: 1,
      data: {}
    };

    this.structures.push(st);
    this._structureById.set(id, st);
    this._defencePostCacheReady = false;
    if (typeof this._markStructureCountCacheDirty === "function") this._markStructureCountCacheDirty();
    if (st.type === "coastal_rig" && Array.isArray(this._coastalRigStructures)) this._coastalRigStructures.push(st);
    if (st.type === "radar_station" && typeof this._markRadarCoverageDirty === "function") this._markRadarCoverageDirty();

    // Occupy a 3x3 footprint for collision and stack selection.
    this._markStructureFootprint(id, st.x, st.y);
    return st;
  }




  World.prototype._findNearbyOwnedEmpty = function(ownerId, cx, cy, r) {
      const w = this.w, h = this.h;
      const tries = 240;

      for (let t = 0; t < tries; t++) {
        const dx = ((this._rng() * (r * 2 + 1)) | 0) - r;
        const dy = ((this._rng() * (r * 2 + 1)) | 0) - r;
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const idx = y * w + x;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== ownerId) continue;
        if (!this._canPlaceStructureFootprint(ownerId, x, y)) continue;
        return { x, y };
      }

      return null;
    }
}
