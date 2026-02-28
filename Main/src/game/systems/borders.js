// FILE: src/game/systems/borders.js

import {
  BIOME,
  BIOME_COLORS,
  CAPITAL_CAPTURE_GOLD_BASE,
  CAPITAL_CAPTURE_GOLD_MAX,
  CAPITAL_CAPTURE_GOLD_PER_LAND,
  OWNER,
  RIVER_STYLE,
  SPECKLE_MAX_CHECKS_PER_PASS,
  SPECKLE_MIN_AGE_S,
  WORLDGEN
} from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

function gradeOwnedRgb(r, g, b) {
  const contrast = 1.12;
  const sat = 1.18;
  const dark = 0.92;

  let rr = (r - 128) * contrast + 128;
  let gg = (g - 128) * contrast + 128;
  let bb = (b - 128) * contrast + 128;

  const l = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  rr = l + (rr - l) * sat;
  gg = l + (gg - l) * sat;
  bb = l + (bb - l) * sat;

  rr *= dark;
  gg *= dark;
  bb *= dark;

  return { r: rr, g: gg, b: bb };
}

const BURST_BORDER_REBUILD_INTERVAL_S = 0.18;
const BURST_BORDER_REBUILD_OWNER_DELTA = 220;

function createMinHeap(capacity = 1024) {
  const cap = Math.max(16, capacity | 0);
  return {
    pri: new Float64Array(cap),
    idx: new Int32Array(cap),
    len: 0
  };
}

function heapClear(h) {
  if (!h) return;
  h.len = 0;
}

function heapSize(h) {
  return h ? (h.len | 0) : 0;
}

function heapGrow(h) {
  if (!h) return;
  const nextCap = Math.max(16, (h.pri.length << 1) | 0);
  const nextPri = new Float64Array(nextCap);
  const nextIdx = new Int32Array(nextCap);
  nextPri.set(h.pri);
  nextIdx.set(h.idx);
  h.pri = nextPri;
  h.idx = nextIdx;
}

function heapPush(h, tileIdx, priority) {
  if (!h) return;
  if ((h.len | 0) >= (h.pri.length | 0)) heapGrow(h);

  let i = h.len | 0;
  h.len = (h.len + 1) | 0;
  const p = Number(priority);
  const t = tileIdx | 0;

  while (i > 0) {
    const parent = ((i - 1) >> 1) | 0;
    if (p >= h.pri[parent]) break;
    h.pri[i] = h.pri[parent];
    h.idx[i] = h.idx[parent];
    i = parent;
  }

  h.pri[i] = p;
  h.idx[i] = t;
}

function heapPop(h) {
  if (!h || (h.len | 0) <= 0) return -1;

  const top = h.idx[0] | 0;
  h.len = (h.len - 1) | 0;
  if ((h.len | 0) <= 0) return top;

  const lastPri = h.pri[h.len];
  const lastIdx = h.idx[h.len] | 0;
  let i = 0;

  while (true) {
    const left = ((i << 1) + 1) | 0;
    if (left >= (h.len | 0)) break;
    const right = (left + 1) | 0;
    const child = (right < (h.len | 0) && h.pri[right] < h.pri[left]) ? right : left;
    if (lastPri <= h.pri[child]) break;
    h.pri[i] = h.pri[child];
    h.idx[i] = h.idx[child];
    i = child;
  }

  h.pri[i] = lastPri;
  h.idx[i] = lastIdx;
  return top;
}

export function installBorders(World) {
    // ===== Speckle cleanup =====

  World.prototype._speckleCleanupLocal = function() {
      let checks = 0;
      const qLenStart = this._speckleQueue.length | 0;
      let maxChecks = SPECKLE_MAX_CHECKS_PER_PASS | 0;
      if (qLenStart >= 120000) maxChecks = Math.min(maxChecks, 1800);
      else if (qLenStart >= 80000) maxChecks = Math.min(maxChecks, 2400);
      else if (qLenStart >= 40000) maxChecks = Math.min(maxChecks, 3200);
      else maxChecks = Math.min(maxChecks, 4800);
      const hasPerfNow = (typeof performance !== "undefined" && performance && typeof performance.now === "function");
      const cleanupStartMs = hasPerfNow ? performance.now() : 0;
      const cleanupBudgetMs = qLenStart >= 120000
        ? 1.35
        : qLenStart >= 80000
          ? 1.55
          : qLenStart >= 40000
            ? 1.8
            : 2.2;
      const retryLater = [];
      let counts = this._speckleNeighborCounts;
      let touched = this._speckleNeighborTouched;
      const wantLen = (this._nationCount | 0) + 1;
      if (!counts || counts.length < wantLen) {
        counts = this._speckleNeighborCounts = new Int16Array(wantLen);
      }
      if (!touched || touched.length < wantLen) {
        touched = this._speckleNeighborTouched = new Int16Array(wantLen);
      }
      const maxOwner = counts.length - 1;

      while (this._speckleQueue.length > 0 && checks < maxChecks) {
        if (hasPerfNow && checks >= 192 && (performance.now() - cleanupStartMs) >= cleanupBudgetMs) break;
        const idx = this._speckleQueue.pop();
        if (!this._speckleSet.has(idx)) continue;
        checks++;

        if (!this.land[idx]) { this._speckleSet.delete(idx); continue; }

        const age = this.time - (this.ownerStamp[idx] || 0);
        if (age < SPECKLE_MIN_AGE_S) {
          // Keep candidate for a later pass once ownership is old enough to stabilize.
          if ((retryLater.length | 0) < 32000) retryLater.push(idx);
          else this._speckleSet.delete(idx);
          continue;
        }

        const cur = this.owner[idx] | 0;

        let curCount = 0;
        let touchedCount = 0;

        const x = idx % this.w;
        const y = (idx / this.w) | 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
            const ni = yy * this.w + xx;
            if (!this.land[ni]) continue;
            const o = this.owner[ni] | 0;
            if (o === cur) curCount++;
            if (o >= 0 && o <= maxOwner) {
              if ((counts[o] | 0) <= 0) touched[touchedCount++] = o;
              counts[o] = (counts[o] | 0) + 1;
            }
          }
        }

        let bestO = cur;
        let bestC = curCount;
        for (let ti = 0; ti < touchedCount; ti++) {
          const o = touched[ti] | 0;
          const c = counts[o] | 0;
          counts[o] = 0;
          if (o > 0 && this.nation[o]?.collapsed) continue;
          if (c > bestC) { bestC = c; bestO = o; }
        }

        if (bestO === cur) {
          this._speckleSet.delete(idx);
          continue;
        }

        const neutralHoleFill = (cur === OWNER.NONE && bestO > OWNER.NONE && bestC >= 5);
        const enclaveFlip = (bestC >= 5 && curCount <= 3);
        if (neutralHoleFill || enclaveFlip) {
          this._speckleSet.delete(idx);
          this._setOwner(idx, bestO);
          continue;
        }

        this._speckleSet.delete(idx);
      }

      if (retryLater.length > 0) {
        const cap = 180000;
        const q = this._speckleQueue;
        const room = Math.max(0, cap - (q.length | 0));
        const keep = Math.min(room, retryLater.length | 0);
        for (let i = 0; i < keep; i++) {
          q.push(retryLater[i] | 0);
        }
        if (keep < (retryLater.length | 0)) {
          for (let i = keep; i < retryLater.length; i++) {
            this._speckleSet.delete(retryLater[i] | 0);
          }
        }
      }
    }

    // ===== Border + owner operations =====

  World.prototype._resetPixelDirtyBounds = function() {
      this._pixelDirtyPending = false;
      this._pixelDirtyFull = false;
      this._pixelDirtyMinX = this.w;
      this._pixelDirtyMinY = this.h;
      this._pixelDirtyMaxX = -1;
      this._pixelDirtyMaxY = -1;
    }

  World.prototype._resetPixelDirtyTiles = function() {
      if (Array.isArray(this._pixelDirtyTiles)) this._pixelDirtyTiles.length = 0;
      if (Array.isArray(this._pixelDirtyTilesBack)) this._pixelDirtyTilesBack.length = 0;
      this._pixelDirtyTilesOverflow = false;
      this._pixelDirtyTileEpoch = ((this._pixelDirtyTileEpoch >>> 0) + 1) >>> 0;
      if ((this._pixelDirtyTileEpoch >>> 0) === 0) {
        this._pixelDirtyTileEpoch = 1;
        if (this._pixelDirtyTileStamp) this._pixelDirtyTileStamp.fill(0);
      }
    }

  World.prototype._markAllPixelsDirty = function() {
      this._pixelDirtyPending = true;
      this._pixelDirtyFull = true;
      this._pixelDirtyMinX = 0;
      this._pixelDirtyMinY = 0;
      this._pixelDirtyMaxX = this.w - 1;
      this._pixelDirtyMaxY = this.h - 1;
      this._pixelDirtyTilesOverflow = true;
      if (Array.isArray(this._pixelDirtyTiles)) this._pixelDirtyTiles.length = 0;
      if (Array.isArray(this._pixelDirtyTilesBack)) this._pixelDirtyTilesBack.length = 0;
    }

  World.prototype._markPixelDirty = function(idx) {
      if (this._suspendPixelDirtyTracking) return;
      if (this._pixelDirtyFull) {
        this._pixelDirtyPending = true;
        return;
      }

      const w = this.w | 0;
      const x = idx % w;
      const y = (idx / w) | 0;

      if (!this._pixelDirtyPending) {
        this._pixelDirtyPending = true;
        this._pixelDirtyMinX = x;
        this._pixelDirtyMaxX = x;
        this._pixelDirtyMinY = y;
        this._pixelDirtyMaxY = y;
        return;
      }

      if (x < this._pixelDirtyMinX) this._pixelDirtyMinX = x;
      if (x > this._pixelDirtyMaxX) this._pixelDirtyMaxX = x;
      if (y < this._pixelDirtyMinY) this._pixelDirtyMinY = y;
      if (y > this._pixelDirtyMaxY) this._pixelDirtyMaxY = y;

      if (this._pixelDirtyTilesOverflow) return;
      const stamp = this._pixelDirtyTileStamp;
      const list = this._pixelDirtyTiles;
      const ownerLen = this.owner ? (this.owner.length | 0) : 0;
      if (!stamp || !Array.isArray(list) || stamp.length !== ownerLen) return;

      let epoch = this._pixelDirtyTileEpoch >>> 0;
      if (epoch === 0) {
        epoch = 1;
        this._pixelDirtyTileEpoch = 1;
        stamp.fill(0);
      }

      if ((stamp[idx] >>> 0) === epoch) return;
      stamp[idx] = epoch;

      const limit = Math.max(10000, Number(this._pixelDirtyTileOverflowLimit) | 0);
      if (list.length >= limit) {
        this._pixelDirtyTilesOverflow = true;
        list.length = 0;
        return;
      }
      list.push(idx | 0);
    }

  World.prototype._consumePixelDirtyRect = function() {
      if (!this._pixelDirtyPending) return null;

      let rect = null;
      if (this._pixelDirtyFull) {
        rect = { x: 0, y: 0, w: this.w | 0, h: this.h | 0, full: true };
      } else {
        const minX = this._pixelDirtyMinX | 0;
        const minY = this._pixelDirtyMinY | 0;
        const maxX = this._pixelDirtyMaxX | 0;
        const maxY = this._pixelDirtyMaxY | 0;
        if (maxX >= minX && maxY >= minY) {
          rect = {
            x: minX,
            y: minY,
            w: (maxX - minX + 1) | 0,
            h: (maxY - minY + 1) | 0,
            full: false
          };
        }
      }

      this._resetPixelDirtyBounds();
      return rect;
    }

  World.prototype._consumePixelDirtyTiles = function() {
      if (this._pixelDirtyFull || this._pixelDirtyTilesOverflow) {
        this._resetPixelDirtyTiles();
        return { full: true, items: null };
      }

      const items = Array.isArray(this._pixelDirtyTiles) ? this._pixelDirtyTiles : null;
      if (!items || items.length === 0) {
        return { full: false, items: [] };
      }

      const back = Array.isArray(this._pixelDirtyTilesBack) ? this._pixelDirtyTilesBack : [];
      back.length = 0;
      this._pixelDirtyTiles = back;
      this._pixelDirtyTilesBack = items;

      this._pixelDirtyTileEpoch = ((this._pixelDirtyTileEpoch >>> 0) + 1) >>> 0;
      if ((this._pixelDirtyTileEpoch >>> 0) === 0) {
        this._pixelDirtyTileEpoch = 1;
        if (this._pixelDirtyTileStamp) this._pixelDirtyTileStamp.fill(0);
      }

      return { full: false, items };
    }

  World.prototype._queuePixelWrite = function(idx) {
      if (idx < 0 || idx >= (this.owner?.length || 0)) return;

      if (!this._pixelWriteStamp) return;
      let epoch = this._pixelWriteEpoch >>> 0;
      if (epoch === 0) {
        epoch = 1;
        this._pixelWriteEpoch = 1;
        this._pixelWriteStamp.fill(0);
      }

      if (this._pixelWriteStamp[idx] === epoch) return;
      this._pixelWriteStamp[idx] = epoch;
      this._pixelWriteList.push(idx | 0);
    }

  World.prototype._setRenderInterestRect = function(rectRaw) {
      const w = this.w | 0;
      const h = this.h | 0;
      if (!(w > 0 && h > 0)) return;

      if (!this._renderInterestEnabled) {
        this._renderInterestRect = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
        this._flushDeferredPixelWrites(26000);
        return;
      }

      if (!rectRaw || typeof rectRaw !== "object") {
        this._renderInterestRect = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
        this._flushDeferredPixelWrites(12000);
        return;
      }

      const x0 = Math.max(0, Math.min(w - 1, rectRaw.x0 | 0));
      const y0 = Math.max(0, Math.min(h - 1, rectRaw.y0 | 0));
      const x1 = Math.max(x0, Math.min(w - 1, rectRaw.x1 | 0));
      const y1 = Math.max(y0, Math.min(h - 1, rectRaw.y1 | 0));
      this._renderInterestRect = { x0, y0, x1, y1 };

      const visibleArea = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
      const totalArea = Math.max(1, w * h);
      const frac = visibleArea / totalArea;
      // Keep deferred catch-up strong enough that visible frontlines do not look holey.
      const budget = frac <= 0.12 ? 22000 : (frac <= 0.25 ? 14000 : 8000);
      this._flushDeferredPixelWrites(budget);
    }

  World.prototype._pixelIsInRenderInterest = function(idxRaw) {
      if (!this._renderInterestEnabled) return true;

      const rect = this._renderInterestRect;
      if (!rect) return true;

      const idx = idxRaw | 0;
      const w = this.w | 0;
      if (idx < 0 || idx >= (w * (this.h | 0))) return false;

      const x = idx % w;
      const y = (idx / w) | 0;
      const margin = Math.max(0, this._renderInterestMargin | 0);
      const x0 = (rect.x0 | 0) - margin;
      const y0 = (rect.y0 | 0) - margin;
      const x1 = (rect.x1 | 0) + margin;
      const y1 = (rect.y1 | 0) + margin;

      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }

  World.prototype._queueDeferredPixelWrite = function(idxRaw) {
      const idx = idxRaw | 0;
      if (idx < 0 || idx >= (this.owner?.length || 0)) return;

      if (!this._pixelDeferredStamp) return;
      let epoch = this._pixelDeferredEpoch >>> 0;
      if (epoch === 0) {
        epoch = 1;
        this._pixelDeferredEpoch = 1;
        this._pixelDeferredStamp.fill(0);
      }

      if (this._pixelDeferredStamp[idx] === epoch) return;
      this._pixelDeferredStamp[idx] = epoch;
      this._pixelDeferredList.push(idx);
    }

  World.prototype._flushDeferredPixelWrites = function(maxWritesRaw = 0) {
      const list = this._pixelDeferredList;
      if (!list || list.length === 0) return 0;

      let writesLeft = maxWritesRaw > 0 ? (maxWritesRaw | 0) : 0x7fffffff;
      let wrote = 0;
      for (let i = list.length - 1; i >= 0 && writesLeft > 0; i--) {
        const idx = list[i] | 0;
        if (!this._pixelIsInRenderInterest(idx)) continue;

        this._writePixel(idx);
        writesLeft--;
        wrote++;

        const last = list.length - 1;
        if (i !== last) list[i] = list[last] | 0;
        list.pop();
        if (this._pixelDeferredStamp) this._pixelDeferredStamp[idx] = 0;
      }

      if (list.length === 0) {
        this._pixelDeferredEpoch = (this._pixelDeferredEpoch + 1) >>> 0;
        if (this._pixelDeferredEpoch === 0) {
          this._pixelDeferredEpoch = 1;
          if (this._pixelDeferredStamp) this._pixelDeferredStamp.fill(0);
        }
      }
      return wrote;
    }

  World.prototype._beginOwnerBatch = function() {
      const next = (this._ownerBatchDepth | 0) + 1;
      this._ownerBatchDepth = next;
      if (next === 1) {
        const list = this._ownerBatchNeighborList;
        if (Array.isArray(list)) list.length = 0;

        const stamp = this._ownerBatchNeighborStamp;
        if (stamp && stamp.length === (this.owner?.length || 0)) {
          let epoch = ((this._ownerBatchNeighborEpoch >>> 0) + 1) >>> 0;
          if (epoch === 0) {
            stamp.fill(0);
            epoch = 1;
          }
          this._ownerBatchNeighborEpoch = epoch;
        } else if (this._ownerBatchNeighbors) {
          this._ownerBatchNeighbors.clear();
        }
        this._ownerBatchVersionDirty = false;
      }
    }

  World.prototype._recordOwnerBatchNeighbors = function(idxRaw) {
      const idx = idxRaw | 0;
      const w = this.w | 0;
      const h = this.h | 0;
      if (idx < 0 || idx >= (w * h)) return;

      const stamp = this._ownerBatchNeighborStamp;
      const list = this._ownerBatchNeighborList;
      const epoch = this._ownerBatchNeighborEpoch >>> 0;

      if (stamp && Array.isArray(list) && stamp.length === (w * h) && epoch > 0) {
        const x = idx % w;
        const y = (idx / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          const row = yy * w;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const ni = (row + xx) | 0;
            if ((stamp[ni] >>> 0) === epoch) continue;
            stamp[ni] = epoch;
            list.push(ni);
          }
        }
        return;
      }

      const set = this._ownerBatchNeighbors;
      if (!set) return;

      const x = idx % w;
      const y = (idx / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          set.add((yy * w + xx) | 0);
        }
      }
    }

  World.prototype._endOwnerBatch = function() {
      let next = (this._ownerBatchDepth | 0) - 1;
      if (next < 0) next = 0;
      this._ownerBatchDepth = next;
      if (next > 0) return;

      const list = this._ownerBatchNeighborList;
      if (Array.isArray(list) && list.length > 0) {
        const count = list.length | 0;
        for (let i = 0; i < count; i++) {
          this._refreshBorderCell(list[i] | 0);
        }

        if (this._authoritativeSyncApplying) {
          list.length = 0;
          if (this._ownerBatchVersionDirty) {
            this.ownerVersion++;
            this._ownerBatchVersionDirty = false;
          }
          return;
        }

        const speckleBudget = count >= 30000 ? 1800 : (count >= 12000 ? 3000 : (count >= 5000 ? 5000 : 9000));
        if (count <= speckleBudget) {
          for (let i = 0; i < count; i++) {
            this._queueSpeckleCell(list[i] | 0);
          }
        } else {
          const stride = Math.max(1, Math.floor(count / Math.max(1, speckleBudget)));
          let k = 0;
          let queued = 0;
          for (let i = 0; i < count; i++) {
            const idx = list[i] | 0;
            if ((k++ % stride) !== 0) continue;
            this._queueSpeckleCell(idx);
            if (++queued >= speckleBudget) break;
          }
        }

        list.length = 0;
        if (this._ownerBatchVersionDirty) {
          this.ownerVersion++;
          this._ownerBatchVersionDirty = false;
        }
        return;
      }

      const set = this._ownerBatchNeighbors;
      if (!set || set.size === 0) {
        if (this._ownerBatchVersionDirty) {
          this.ownerVersion++;
          this._ownerBatchVersionDirty = false;
        }
        return;
      }

      for (const idx0 of set) {
        const idx = idx0 | 0;
        this._refreshBorderCell(idx);
      }

      if (this._authoritativeSyncApplying) {
        set.clear();
        if (this._ownerBatchVersionDirty) {
          this.ownerVersion++;
          this._ownerBatchVersionDirty = false;
        }
        return;
      }

      const setSize = set.size | 0;
      const speckleBudget = setSize >= 30000 ? 3200 : (setSize >= 12000 ? 5200 : (setSize >= 5000 ? 7600 : 9800));
      if (setSize <= speckleBudget) {
        for (const idx0 of set) {
          const idx = idx0 | 0;
          this._queueSpeckleCell(idx);
        }
      } else {
        const stride = Math.max(1, Math.floor(setSize / Math.max(1, speckleBudget)));
        let k = 0;
        let queued = 0;
        for (const idx0 of set) {
          const idx = idx0 | 0;
          if ((k++ % stride) !== 0) continue;
          this._queueSpeckleCell(idx);
          if (++queued >= speckleBudget) break;
        }
      }

      set.clear();

      if (this._ownerBatchVersionDirty) {
        this.ownerVersion++;
        this._ownerBatchVersionDirty = false;
      }
    }

  World.prototype._flushQueuedPixelWrites = function() {
      const list = this._pixelWriteList;
      if (!list || list.length === 0) {
        this._flushDeferredPixelWrites(5000);
        return;
      }

      const headlessAuthoritative = !!this._headlessAuthoritative;
      if (headlessAuthoritative) {
        const pending = Array.isArray(this._ownerDirtyPending) ? this._ownerDirtyPending : null;
        const limit = Math.max(10000, Number(this._ownerDirtyOverflowLimit) | 0);
        let overflow = !!this._ownerDirtyOverflow;

        while (list.length > 0) {
          const idx = list.pop() | 0;
          if (pending && !overflow) {
            if (pending.length >= limit) {
              overflow = true;
              this._ownerDirtyOverflow = true;
              pending.length = 0;
            } else {
              pending.push(idx);
            }
          }
        }

        this._pixelWriteEpoch = (this._pixelWriteEpoch + 1) >>> 0;
        if (this._pixelWriteEpoch === 0) {
          this._pixelWriteEpoch = 1;
          if (this._pixelWriteStamp) this._pixelWriteStamp.fill(0);
        }
        if (this._pixelDeferredList) this._pixelDeferredList.length = 0;
        return;
      }

      const listLen = list.length | 0;
      const hasPlayerOps = (typeof this._hasPlayerVisualOperation === "function") && this._hasPlayerVisualOperation();
      const tiles = Math.max(1, (this.w | 0) * (this.h | 0));
      let budget = tiles >= 2_000_000 ? 4500 : (tiles >= 1_200_000 ? 7000 : 11000);
      if (listLen >= 250000) budget = Math.min(budget, 3200);
      else if (listLen >= 120000) budget = Math.min(budget, 4500);
      else if (listLen >= 60000) budget = Math.min(budget, 6000);
      else if (listLen >= 25000) budget = Math.min(budget, 8200);
      if (hasPlayerOps) budget = Math.max(2400, Math.floor(budget * 0.95));

      const pending = Array.isArray(this._ownerDirtyPending) ? this._ownerDirtyPending : null;
      const limit = Math.max(10000, Number(this._ownerDirtyOverflowLimit) | 0);
      let overflow = !!this._ownerDirtyOverflow;
      if (pending && !overflow && (listLen > Math.max(16000, Math.floor(limit * 0.24)))) {
        overflow = true;
        this._ownerDirtyOverflow = true;
        pending.length = 0;
      }

      for (let i = list.length - 1; i >= 0 && budget > 0; i--) {
        const idx = list[i] | 0;
        if (this._pixelIsInRenderInterest(idx)) this._writePixel(idx);
        else this._queueDeferredPixelWrite(idx);

        if (pending && !overflow) {
          if (pending.length >= limit) {
            overflow = true;
            this._ownerDirtyOverflow = true;
            pending.length = 0;
          } else {
            pending.push(idx);
          }
        }

        const last = list.length - 1;
        if (i !== last) list[i] = list[last] | 0;
        list.pop();
        budget--;
      }

      if (list.length === 0) {
        this._pixelWriteEpoch = (this._pixelWriteEpoch + 1) >>> 0;
        if (this._pixelWriteEpoch === 0) {
          this._pixelWriteEpoch = 1;
          if (this._pixelWriteStamp) this._pixelWriteStamp.fill(0);
        }
      }
    }

  World.prototype._ownerTileAttach = function(ownerId, idx) {
      const oid = ownerId | 0;
      if (oid <= 0 || !this._ownerTiles || !this._ownerTilePos) return;
      const arr = this._ownerTiles[oid];
      if (!arr) return;
      this._ownerTilePos[idx] = arr.length;
      arr.push(idx);
    }

  World.prototype._ownerTileDetach = function(ownerId, idx) {
      const oid = ownerId | 0;
      if (oid <= 0 || !this._ownerTiles || !this._ownerTilePos) return;
      const arr = this._ownerTiles[oid];
      if (!arr || arr.length === 0) return;

      let pos = this._ownerTilePos[idx] | 0;
      if (pos < 0 || pos >= arr.length || (arr[pos] | 0) !== (idx | 0)) {
        pos = arr.indexOf(idx);
        if (pos < 0) {
          this._ownerTilePos[idx] = -1;
          return;
        }
      }

      const lastPos = arr.length - 1;
      const lastIdx = arr[lastPos] | 0;
      arr[pos] = lastIdx;
      arr.pop();

      if (pos !== lastPos) this._ownerTilePos[lastIdx] = pos;
      this._ownerTilePos[idx] = -1;
    }

  World.prototype._getOwnerTiles = function(ownerId) {
      const oid = ownerId | 0;
      if (oid <= 0 || !this._ownerTiles) return null;
      return this._ownerTiles[oid] || null;
    }

  World.prototype._touchesOwner4 = function(idx, ownerVal) {
      const w = this.w | 0;
      const h = this.h | 0;
      const x = idx % w;
      const y = (idx / w) | 0;
      const target = ownerVal | 0;
      const owner = this.owner;
      const land = this.land;

      let ni = 0;
      if (x > 0) {
        ni = idx - 1;
        if (land[ni] && ((owner[ni] | 0) === target)) return true;
      }
      if (x + 1 < w) {
        ni = idx + 1;
        if (land[ni] && ((owner[ni] | 0) === target)) return true;
      }
      if (y > 0) {
        ni = idx - w;
        if (land[ni] && ((owner[ni] | 0) === target)) return true;
      }
      if (y + 1 < h) {
        ni = idx + w;
        if (land[ni] && ((owner[ni] | 0) === target)) return true;
      }
      return false;
    }

  World.prototype._touchesOwner8 = function(idx, ownerVal) {
      const w = this.w;
      const x = idx % w;
      const y = (idx / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
          const ni = yy * w + xx;
          if (!this.land[ni]) continue;
          if ((this.owner[ni] | 0) === ownerVal) return true;
        }
      }
      return false;
    }

  World.prototype._isBorderCell = function(idx) {
      if (!this.land[idx]) return false;
      const o = this.owner[idx] | 0;
      if (o <= 0) return false;

      const w = this.w | 0;
      const h = this.h | 0;
      const x = idx % w;
      const y = (idx / w) | 0;

      let ni = 0;
      if (x <= 0) return true;
      ni = idx - 1;
      if (!this.land[ni] || ((this.owner[ni] | 0) !== o)) return true;

      if (x + 1 >= w) return true;
      ni = idx + 1;
      if (!this.land[ni] || ((this.owner[ni] | 0) !== o)) return true;

      if (y <= 0) return true;
      ni = idx - w;
      if (!this.land[ni] || ((this.owner[ni] | 0) !== o)) return true;

      if (y + 1 >= h) return true;
      ni = idx + w;
      if (!this.land[ni] || ((this.owner[ni] | 0) !== o)) return true;

      return false;
    }

  World.prototype._isRenderBorderCell = function(idx) {
      // Visual-only border pixels. We render a border when:
      //  - owned land touches water / map edge
      //  - owned land touches neutral land
      //  - owned land touches another owner, but only one side draws the border to avoid "double-thick clumps"
      if (!this.land[idx]) return false;

      const o = this.owner[idx] | 0;
      if (o <= 0) return false;

      const w = this.w | 0;
      const h = this.h | 0;
      const x = idx % w;
      const y = (idx / w) | 0;
      let ni = 0;
      let no = 0;

      if (x <= 0) return true;
      ni = idx - 1;
      if (!this.land[ni]) return true;
      no = this.owner[ni] | 0;
      if (no === OWNER.NONE) return true;
      if (no > 0 && no !== o && o < no) return true;

      if (x + 1 >= w) return true;
      ni = idx + 1;
      if (!this.land[ni]) return true;
      no = this.owner[ni] | 0;
      if (no === OWNER.NONE) return true;
      if (no > 0 && no !== o && o < no) return true;

      if (y <= 0) return true;
      ni = idx - w;
      if (!this.land[ni]) return true;
      no = this.owner[ni] | 0;
      if (no === OWNER.NONE) return true;
      if (no > 0 && no !== o && o < no) return true;

      if (y + 1 >= h) return true;
      ni = idx + w;
      if (!this.land[ni]) return true;
      no = this.owner[ni] | 0;
      if (no === OWNER.NONE) return true;
      if (no > 0 && no !== o && o < no) return true;

      return false;
    }


  World.prototype._refreshBorderCell = function(idxRaw) {
      const idx = idxRaw | 0;
      if (idx < 0 || idx >= (this.owner?.length || 0)) return;

      const currentBorderOwner = this._borderOwnerByTile ? (this._borderOwnerByTile[idx] | 0) : 0;

      if (!this.land[idx]) {
        if (currentBorderOwner > 0) this._borderSet[currentBorderOwner].delete(idx);
        return;
      }

      const o = this.owner[idx] | 0;
      if (o <= 0) {
        if (currentBorderOwner > 0) this._borderSet[currentBorderOwner].delete(idx);
        return;
      }

      const isB = this._isBorderCell(idx);
      if (!isB) {
        if (currentBorderOwner > 0) this._borderSet[currentBorderOwner].delete(idx);
        return;
      }

      this._borderSet[o].add(idx);
    }

  World.prototype._updateBorderCell = function(idx) {
      this._refreshBorderCell(idx);
    }

  World.prototype._updateBorderAround = function(idx, oldOwner, newOwner) {
      const w = this.w | 0;
      const h = this.h | 0;
      const x = idx % w;
      const y = (idx / w) | 0;

      this._refreshBorderCell(idx);
      if (x > 0) this._refreshBorderCell(idx - 1);
      if (x + 1 < w) this._refreshBorderCell(idx + 1);
      if (y > 0) this._refreshBorderCell(idx - w);
      if (y + 1 < h) this._refreshBorderCell(idx + w);
    }

  World.prototype._setOwner = function(idx, newOwner) {
      if (!this.land[idx]) return;

      const oldOwner = this.owner[idx] | 0;
      const nOwner = newOwner | 0;
      if (oldOwner === nOwner) return;
      const syncApplying = !!this._authoritativeSyncApplying;

      if (nOwner > 0 && !this.nation[nOwner]?.alive) return;

      const w = this.w;
      const x = idx % w;
      const y = (idx / w) | 0;
      const inBatch = (this._ownerBatchDepth | 0) > 0;

      if (oldOwner > 0) {
        this._ownerTileDetach(oldOwner, idx);
        this.landOwnedCount[oldOwner]--;
        if (this._labelCount && this._labelCount.length > oldOwner) {
          this._labelCount[oldOwner]--;
          this._labelSumX[oldOwner] -= x;
          this._labelSumY[oldOwner] -= y;
        }
        if (typeof this._markLabelDirty === "function") this._markLabelDirty(oldOwner);
      }
      if (nOwner > 0) {
        this._ownerTileAttach(nOwner, idx);
        this.landOwnedCount[nOwner]++;
        if (this._labelCount && this._labelCount.length > nOwner) {
          this._labelCount[nOwner]++;
          this._labelSumX[nOwner] += x;
          this._labelSumY[nOwner] += y;
        }
        if (typeof this._markLabelDirty === "function") this._markLabelDirty(nOwner);
      }

      this.owner[idx] = nOwner;
      this.ownerStamp[idx] = this.time;
      const terrVer = this._nationTerritoryVersion;
      if (terrVer && terrVer.length) {
        if (oldOwner > 0) {
          let v = ((terrVer[oldOwner] >>> 0) + 1) >>> 0;
          if (v === 0) v = 1;
          terrVer[oldOwner] = v;
        }
        if (nOwner > 0 && nOwner !== oldOwner) {
          let v = ((terrVer[nOwner] >>> 0) + 1) >>> 0;
          if (v === 0) v = 1;
          terrVer[nOwner] = v;
        }
      }
      if (!this._suspendOwnerVersionBump && !syncApplying && nOwner > OWNER.NONE && typeof this._pushClaimFx === "function") {
        const playerRelated = oldOwner === OWNER.PLAYER || nOwner === OWNER.PLAYER;
        if (!inBatch || playerRelated || ((idx & 7) === 0)) {
          this._pushClaimFx(idx, nOwner, oldOwner, this.time);
        }
      }
      if (!this._suspendOwnerVersionBump && !syncApplying && typeof this._markTilePressureAround === "function") {
        if (!inBatch || (((idx + (this._simTick | 0)) & 3) === 0)) {
          const pressureWeight = (oldOwner > 0 && nOwner > 0) ? 2.4 : 1.15;
          this._markTilePressureAround(idx, pressureWeight);
        }
      }
      if (oldOwner === OWNER.PLAYER || nOwner === OWNER.PLAYER) {
        this._lastPlayerOwnershipChangeAt = this.time;
      }

      if (!this._suspendOwnerVersionBump) {
        if (inBatch) this._ownerBatchVersionDirty = true;
        else this.ownerVersion++;
      }

      // During world generation we skip per-change visual churn; full rebuild happens once.
      if (!this._suspendOwnerVersionBump) {
        // Defer and dedupe pixel updates to reduce repeated work under mass captures.
        this._queuePixelWrite(idx);
        if (!syncApplying && !this._headlessAuthoritative) {
          if (x > 0) this._queuePixelWrite(idx - 1);
          if (x + 1 < w) this._queuePixelWrite(idx + 1);
          if (y > 0) this._queuePixelWrite(idx - w);
          if (y + 1 < this.h) this._queuePixelWrite(idx + w);
        }

        if (inBatch) this._recordOwnerBatchNeighbors(idx);
        else if (syncApplying) this._refreshBorderCell(idx);
        else this._updateBorderAround(idx, oldOwner, nOwner);
      }

      if (!this._suspendOwnerVersionBump) {
        if (!inBatch && !syncApplying) this._pushSpeckleCandidates(idx);
      }
      if (!syncApplying) {
        const sid = this._structAt[idx] | 0;
        if (sid) {
          const st = this._structureById.get(sid);
          if (st) {
            // Footprint tiles map to the same structure id; only the anchor tile triggers capture/destruction.
            const w = this.w;
            const tx = idx % w;
            const ty = (idx / w) | 0;
            if (((st.x | 0) === tx) && ((st.y | 0) === ty)) {
              if (st.type === "capital") {
                const capOwner = st.owner | 0;
                if (capOwner !== nOwner && capOwner > 0) {
                  this._onCapitalCaptured(capOwner, nOwner, sid);
                }
              } else if ((st.owner | 0) !== nOwner) {
                // Non-capital structures transfer ownership on capture.
                const oldStructOwner = st.owner | 0;
                st.owner = nOwner;
                if (typeof this._onStructureOwnerChanged === "function") {
                  this._onStructureOwnerChanged(st, oldStructOwner, nOwner);
                }
              }
            }
          }
        }

        // Elimination: no remaining land tiles.
        if (oldOwner > 0 && this.nation[oldOwner]?.alive && (this.landOwnedCount[oldOwner] | 0) <= 0) {
          this._eliminateNation(oldOwner, nOwner, idx);
        }
      }

      this.dirty = true;
    }

  World.prototype._onCapitalCaptured = function(defeatedOwner, captorOwner, capStructId) {
      const n = this.nation[defeatedOwner];
      if (!n || !n.alive) return;
      const collapseDurationS = 140;
      const collapseRecoveryS = 180;

      // Capital tile already flipped ownership in _setOwner(). Here we collapse the nation.
      this._removeStructureById(capStructId);

      let bonusGold = 0;
      if (captorOwner > 0 && this.nation[captorOwner]) {
        const land = Math.max(0, this.landOwnedCount[defeatedOwner] | 0);
        bonusGold = Math.round(CAPITAL_CAPTURE_GOLD_BASE + land * CAPITAL_CAPTURE_GOLD_PER_LAND);
        bonusGold = Math.min(CAPITAL_CAPTURE_GOLD_MAX, Math.max(CAPITAL_CAPTURE_GOLD_BASE, bonusGold));

        const captor = this.nation[captorOwner];
        captor.gold = (captor.gold || 0) + bonusGold;
      }

      if (!n.collapsed) {
        n.collapsed = true;
        n.collapsedAt = this.time;
        n.collapsedUntil = this.time + collapseDurationS;
        n.collapseRecoveryUntil = n.collapsedUntil + collapseRecoveryS;
        n.capital = null;

        // Immediate collapse shock so stats match the loss of central control.
        n.mobilization = Math.min(clamp01(n.mobilization ?? 0.45), 0.25);
        n.attackRatio = Math.min(clamp01(n.attackRatio ?? 0.20), 0.20);
        n.aggression = Math.min(Math.max(0, Number(n.aggression) || 0), 0.20);
        n.attackCommit = Math.min(Math.max(0, Number(n.attackCommit) || n.aggression || 0), 0.20);
        n.gold = Math.max(0, (Number(n.gold) || 0) * 0.44);
        n.population = Math.max(0, (Number(n.population) || 0) * 0.56);
        n.infantry = Math.max(0, (Number(n.infantry) || 0) * 0.46);
        if (typeof this._recomputeNationEconomySnapshot === "function") {
          this._recomputeNationEconomySnapshot(defeatedOwner, {
            forceCollapseClamp: true,
            collapsedInfantryKeepFrac: 0.30
          });
        }

        const bonusNote = bonusGold > 0 ? ` (+${bonusGold} gold)` : "";
        const recoveryNote = ` ${this._nameOf(defeatedOwner)} can still fight through the collapse and will recover stronger soon.`;
        if (captorOwner > 0) {
          this._pushEvent(`${this._nameOf(captorOwner)} captured ${this._nameOf(defeatedOwner)}'s capital - ${this._nameOf(defeatedOwner)} collapses.${bonusNote}${recoveryNote}`, {
            kind: "nation_collapsed",
            from: captorOwner,
            to: defeatedOwner
          });
        } else {
          this._pushEvent(`${this._nameOf(defeatedOwner)}'s capital was destroyed - ${this._nameOf(defeatedOwner)} collapses.${recoveryNote}`, {
            kind: "nation_collapsed",
            from: OWNER.NONE,
            to: defeatedOwner
          });
        }
      } else {
        n.collapsedUntil = Math.max(Number(n.collapsedUntil) || 0, this.time + collapseDurationS * 0.6);
        n.collapseRecoveryUntil = Math.max(Number(n.collapseRecoveryUntil) || 0, n.collapsedUntil + collapseRecoveryS);
        const bonusNote = bonusGold > 0 ? ` (+${bonusGold} gold)` : "";
        if (captorOwner > 0) this._pushEvent(`${this._nameOf(captorOwner)} captured ${this._nameOf(defeatedOwner)}'s capital.${bonusNote}`, {
          kind: "capital_captured",
          from: captorOwner,
          to: defeatedOwner
        });
        else this._pushEvent(`${this._nameOf(defeatedOwner)}'s capital was destroyed.`, {
          kind: "capital_captured",
          from: OWNER.NONE,
          to: defeatedOwner
        });
      }

      // Cancel any operations owned by the collapsed nation (they can no longer act).
      for (let i = this.operations.length - 1; i >= 0; i--) {
        const op = this.operations[i];
        if ((op.attacker | 0) === defeatedOwner) {
          if (this.focusOpId === op.id) this.focusOpId = 0;
          this.operations.splice(i, 1);
        }
      }

      this.dirty = true;
    }

  World.prototype._checkGameOver = function() {
      if (this.gameOver && (this.gameOver.winner | 0) > 0) return;

      const alive = [];
      for (let id = 1; id <= this._nationCount; id++) {
        if (this.nation[id]?.alive) alive.push(id);
      }

      // In authoritative multiplayer, outcome is session-scoped and derived server-side.
      // Keep global hard-stop only for true last-nation-standing.
      const humanIds = (this._humanNationIds instanceof Set)
        ? Array.from(this._humanNationIds.values())
            .map((id) => Math.max(1, Number(id) | 0))
            .filter((id, idx, arr) => id <= (this._nationCount | 0) && arr.indexOf(id) === idx)
        : [];
      const multiplayerSessionScoped = humanIds.length > 1;
      if (multiplayerSessionScoped) {
        this.matchOutcome = null;
        if (!this.gameOver && alive.length <= 1) {
          const finalWinner = alive.length === 1 ? (alive[0] | 0) : 0;
          if (finalWinner > 0) this.gameOver = { winner: finalWinner };
        }
        return;
      }

      const playerAlive = !!this.nation[OWNER.PLAYER]?.alive;
      if (!playerAlive) {
        // Pick a reasonable leader while the player is defeated.
        let winner = 0;
        let best = -1;
        for (const id of alive) {
          const land = this.landOwnedCount[id] | 0;
          if (land > best) { best = land; winner = id; }
        }

        if (!this.matchOutcome || this.matchOutcome.result !== "loss") {
          this.matchOutcome = { result: "loss", winner, at: this.time };
          this._pushEvent(`Defeat.`);
        } else if ((this.matchOutcome.winner | 0) <= 0 && winner > 0) {
          this.matchOutcome.winner = winner;
        }

        // Optional hard end after spectating: stop once only one nation remains alive.
        if (!this.gameOver && alive.length <= 1) {
          const finalWinner = alive.length === 1 ? (alive[0] | 0) : (winner | 0);
          if (finalWinner > 0) this.gameOver = { winner: finalWinner };
        }
        return;
      }

      if (alive.length === 1 && alive[0] === OWNER.PLAYER) {
        this.matchOutcome = { result: "win", winner: OWNER.PLAYER, at: this.time };
        this.gameOver = { winner: OWNER.PLAYER };
        this._pushEvent(`Victory.`);
      }
    }

  World.prototype._removeStructureById = function(structId) {
      const sid = structId | 0;
      if (!sid) return;

      const st = this._structureById.get(sid);
      if (!st) return;

      this._clearStructureFootprint(sid, st.x, st.y);
      if (typeof this._onStructureRemoved === "function") {
        this._onStructureRemoved(st);
      }

      this._structureById.delete(sid);
      const j = this.structures.findIndex((s) => s.id === sid);
      if (j >= 0) this.structures.splice(j, 1);
    }

  World.prototype._eliminateNation = function(defeatedOwner, killerOwner, deathIdx = -1) {
      const n = this.nation[defeatedOwner];
      if (!n || !n.alive) return;
      const dIdx = deathIdx | 0;
      const px = dIdx >= 0 ? (dIdx % this.w) : -1;
      const py = dIdx >= 0 ? ((dIdx / this.w) | 0) : -1;

      n.alive = false;
      n.collapsed = false;
      n.capital = null;
      n.population = 0;
      n.popCap = 0;
      n.infantry = 0;
      n.troopsCap = 0;
      n.gold = 0;

      // Remove structures still attributed to this nation.
      for (let i = this.structures.length - 1; i >= 0; i--) {
        const st = this.structures[i];
        if ((st.owner | 0) !== defeatedOwner) continue;
        this._clearStructureFootprint(st.id, st.x, st.y);
        if (typeof this._onStructureRemoved === "function") {
          this._onStructureRemoved(st);
        }
        this._structureById.delete(st.id);
        this.structures.splice(i, 1);
      }

      // Cancel operations owned by or targeting this nation.
      for (let i = this.operations.length - 1; i >= 0; i--) {
        const op = this.operations[i];
        if ((op.attacker | 0) === defeatedOwner || (op.defender | 0) === defeatedOwner) {
          if (this.focusOpId === op.id) this.focusOpId = 0;
          this.operations.splice(i, 1);
        }
      }

      // Clear diplomacy timers involving this nation.
      for (let other = 1; other <= this._nationCount; other++) {
        if (other === defeatedOwner) continue;
        this._setAlliance(defeatedOwner, other, 0);
        this._clearPending(defeatedOwner, other);
        this._setCeasefire(defeatedOwner, other, 0);
        this._clearCeasefirePending(defeatedOwner, other);
        this._setWar(defeatedOwner, other, false);
      }

      this._pushEvent(`${this._nameOf(defeatedOwner)} was eliminated.`, {
        kind: "nation_eliminated",
        from: killerOwner | 0,
        to: defeatedOwner,
        x: px,
        y: py
      });
      this.dirty = true;

      this._checkGameOver();
    }
  World.prototype._recountLandOwnedCounts = function() {
      this.landOwnedCount.fill(0);
      for (let i = 0; i < this.owner.length; i++) {
        if (!this.land[i]) continue;
        const o = this.owner[i] | 0;
        if (o > 0) this.landOwnedCount[o]++;
      }
    }

  World.prototype._pushSpeckleCandidates = function(idx) {
      const w = this.w;
      const x = idx % w;
      const y = (idx / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
          const ni = yy * w + xx;
          this._queueSpeckleCell(ni);
        }
      }
    }

  World.prototype._queueSpeckleCell = function(idxRaw) {
      const idx = idxRaw | 0;
      if (idx < 0 || idx >= (this.owner?.length || 0)) return;
      if (this._speckleQueue && this._speckleQueue.length >= 180000) return;
      if (!this._speckleSet.has(idx)) {
        this._speckleSet.add(idx);
        this._speckleQueue.push(idx);
      }
    }

  World.prototype._writePixel = function(idx) {
      this._markPixelDirty(idx);

      const p = idx * 4;

      const b = this.biome[idx] | 0;
      const base = BIOME_COLORS[b] || { r: 70, g: 70, b: 70 };

      // Shade multiplier 0..1-ish
      const sh = (this.shade[idx] | 0) / 255;
      const riverVal = this.river ? (this.river[idx] | 0) : 0;

      if (!this.land[idx]) {
        // Water: depth-based color + coastal blending for smoother shore transitions.
        const sea = this._seaLevel | 0;
        const hb = this.height[idx] | 0;
        const depth = clamp01((sea - hb) / 125); // 0 coast -> 1 deep

        const tMid = clamp01((depth - 0.16) / 0.40);
        const tDeep = clamp01((depth - 0.56) / 0.44);

        // Coast distance in water cells (precomputed for ocean). Fallback to local touch check.
        const waterDistRaw = this._waterDist ? (this._waterDist[idx] | 0) : 65535;
        const waterDistSmooth = this._waterDistSmooth ? Number(this._waterDistSmooth[idx]) : NaN;
        let coastDist = Number.isFinite(waterDistSmooth) && waterDistSmooth < 65535
          ? waterDistSmooth
          : ((waterDistRaw === 65535) ? 9999 : waterDistRaw);
        if (coastDist > 999 && this._touchesLand4(idx)) coastDist = 0;

        const coastBand = clampInt(Number(WORLDGEN.shelfDist ?? 18) * 0.45, 3, 18);
        const coastT = clamp01(1 - (coastDist / Math.max(1, coastBand))); // 1 at coast

        // Anchor colors: richer blue shelves -> deep ocean navy.
        const c0 = { r: 44, g: 116, b: 170 };
        const c1 = { r: 24, g: 82, b: 138 };
        const c2 = { r: 6, g: 30, b: 80 };

        let r = lerp(c0.r, c1.r, tMid);
        let g = lerp(c0.g, c1.g, tMid);
        let bl = lerp(c0.b, c1.b, tMid);
        r = lerp(r, c2.r, tDeep);
        g = lerp(g, c2.g, tDeep);
        bl = lerp(bl, c2.b, tDeep);

        const x = idx % this.w;
        const y = (idx / this.w) | 0;

        // Subtle wave variation to avoid flat color blocks.
        const nA = hash01((x * 67) | 0, (y * 31) | 0) - 0.5;
        const nB = hash01((x * 19 + 37) | 0, (y * 53 + 71) | 0) - 0.5;
        const wave = (nA * 0.65 + nB * 0.35);
        const waveAmp = (7 + coastT * 9) * (1 - tDeep * 0.55);
        r += wave * waveAmp * 0.32;
        g += wave * waveAmp * 0.55;
        bl += wave * waveAmp * 0.75;

        // Coast tint: keep some shoreline lift but avoid warm geometric rings.
        if (coastT > 0) {
          const sediment = coastT * coastT;
          r = lerp(r, 86, 0.16 * sediment);
          g = lerp(g, 130, 0.18 * sediment);
          bl = lerp(bl, 182, 0.14 * sediment);
        }

        // Blend nearby land colors with 8-neighbor sampling for smoother coast transitions.
        if (coastDist <= 2.5 || depth < 0.24) {
          let lr = 0, lg = 0, lb = 0, count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const yy = y + oy;
            if (yy < 0 || yy >= this.h) continue;
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const xx = x + ox;
              if (xx < 0 || xx >= this.w) continue;
              const ni = yy * this.w + xx;
              if (!this.land[ni]) continue;
              const bc = BIOME_COLORS[this.biome[ni] | 0] || { r: 90, g: 120, b: 90 };
              lr += bc.r;
              lg += bc.g;
              lb += bc.b;
              count++;
            }
          }

          if (count > 0) {
            const inv = 1 / count;
            const blendAmt = clamp01((0.26 - depth) / 0.26) * 0.16 + clamp01((2.6 - coastDist) / 2.6) * 0.08;
            r = lerp(r, lr * inv, blendAmt);
            g = lerp(g, lg * inv, blendAmt);
            bl = lerp(bl, lb * inv, blendAmt * 0.9);
          }
        }

        // Thin shoreline foam highlight.
        const foamShore = clamp01((0.20 - depth) / 0.20);
        if (foamShore > 0.001) {
          const foam = foamShore * (0.11 + 0.10 * (wave + 0.5));
          r = lerp(r, 220, foam);
          g = lerp(g, 232, foam);
          bl = lerp(bl, 240, foam);
        } else if (coastDist <= 3) {
          const ring = (3 - coastDist) / 3;
          const foam = ring * (0.05 + 0.06 * (wave + 0.5));
          r = lerp(r, 224, foam);
          g = lerp(g, 235, foam);
          bl = lerp(bl, 234, foam);
        }

        // Slight deep-ocean cool shift.
        const deepCool = tDeep * 0.18;
        r = lerp(r, 18, deepCool);
        g = lerp(g, 52, deepCool);
        bl = lerp(bl, 88, deepCool);

        // Apply shading (water keeps softer contrast than land).
        const shW = 0.73 + 0.27 * sh;
        r *= shW; g *= shW; bl *= shW;

        // Sea-ice tint near poles: stronger only in shallow/coastal water.
        const lat = Math.abs((y / Math.max(1, this.h - 1)) * 2 - 1);
        const iceStart = clamp01(Number(WORLDGEN.iceLatStart ?? 0.84));
        const iceEnd = clamp01(Number(WORLDGEN.iceLatEnd ?? 0.97));
        if (lat > iceStart && iceEnd > iceStart) {
          const t = clamp01((lat - iceStart) / (iceEnd - iceStart));
          const strength = clamp01(Number(WORLDGEN.iceStrength ?? 0.25));
          const shallow = clamp01((0.34 - depth) / 0.34);
          const a = t * t * strength * shallow;
          r = lerp(r, 214, a);
          g = lerp(g, 226, a);
          bl = lerp(bl, 236, a);
        }

        this.viewPixels[p + 0] = clamp8(r);
        this.viewPixels[p + 1] = clamp8(g);
        this.viewPixels[p + 2] = clamp8(bl);
        this.viewPixels[p + 3] = 255;
        return;
      }

      const o = this.owner[idx] | 0;

      if (o === OWNER.NONE) {
        // Neutral land = biome color (the “world map” look)
        const jitter = 0.94 + 0.08 * hash01(idx % this.w, (idx / this.w) | 0);
        let r = base.r * sh * jitter;
        let g = base.g * sh * jitter;
        let bl = base.b * sh * jitter;

        if (riverVal > 0 && !this._isRenderBorderCell(idx)) {
          const a = clamp01((riverVal / 255) * (RIVER_STYLE?.alpha ?? 0.65));
          const rc = RIVER_STYLE?.color || { r: 45, g: 120, b: 190 };
          r = lerp(r, rc.r, a);
          g = lerp(g, rc.g, a);
          bl = lerp(bl, rc.b, a);
        }

        this.viewPixels[p + 0] = clamp8(r);
        this.viewPixels[p + 1] = clamp8(g);
        this.viewPixels[p + 2] = clamp8(bl);
        this.viewPixels[p + 3] = 255;
        return;
      }

      // Render border as an actual pixel (no stroke). This is purely visual and does not affect gameplay logic.
      if (this._isRenderBorderCell(idx)) {
        const tint = this.getOwnerTint(o);
        const borderMul = 0.35 + 0.25 * sh; // darker but still tied to terrain shade
        const graded = gradeOwnedRgb(tint.r * borderMul, tint.g * borderMul, tint.b * borderMul);
        this.viewPixels[p + 0] = clamp8(graded.r);
        this.viewPixels[p + 1] = clamp8(graded.g);
        this.viewPixels[p + 2] = clamp8(graded.b);
        this.viewPixels[p + 3] = 255;
        return;
      }

      // Owned land = blend(ownerTint, biome) so terrain still reads.
      const tint = this.getOwnerTint(o);
      const t = WORLDGEN.ownerBlend;

      const r = lerp(base.r, tint.r, t);
      const g = lerp(base.g, tint.g, t);
      const bl = lerp(base.b, tint.b, t);

      const jitter = 0.93 + 0.10 * hash01(idx % this.w, (idx / this.w) | 0);
      let rr = r * sh * jitter;
      let gg = g * sh * jitter;
      let bb = bl * sh * jitter;

      if (riverVal > 0) {
        const a = clamp01((riverVal / 255) * (RIVER_STYLE?.alpha ?? 0.65));
        const rc = RIVER_STYLE?.color || { r: 45, g: 120, b: 190 };
        rr = lerp(rr, rc.r, a);
        gg = lerp(gg, rc.g, a);
        bb = lerp(bb, rc.b, a);
      }

      const graded = gradeOwnedRgb(rr, gg, bb);

      this.viewPixels[p + 0] = clamp8(graded.r);
      this.viewPixels[p + 1] = clamp8(graded.g);
      this.viewPixels[p + 2] = clamp8(graded.b);
      this.viewPixels[p + 3] = 255;
    }

  World.prototype._rebuildAllPixels = function() {
      const wasSuspended = !!this._suspendPixelDirtyTracking;
      this._suspendPixelDirtyTracking = true;
      for (let i = 0; i < this.owner.length; i++) this._writePixel(i);
      this._suspendPixelDirtyTracking = wasSuspended;
      this._markAllPixelsDirty();
      this.dirty = true;
    }

  World.prototype._rebuildAllBorders = function() {
      for (let i = 0; i <= this._nationCount; i++) this._borderSet[i].clear();

      for (let i = 0; i < this.owner.length; i++) {
        if (!this.land[i]) continue;
        const o = this.owner[i] | 0;
        if (o <= 0) continue;
        if (this._isBorderCell(i)) this._borderSet[o].add(i);
      }
    }

    // ===== Ops helper logic =====

  World.prototype._pickFromSetFrontier = function(frontierSet, expectedOwnerVal, targetSet = null) {
      if (!frontierSet || frontierSet.size === 0) return -1;

      const expect = expectedOwnerVal | 0;
      const size = frontierSet.size;

      // Randomized scan window to avoid getting stuck on stale early-inserted elements.
      const skip = (this._rng() * size) | 0;
      let it = frontierSet.values();
      for (let s = 0; s < skip; s++) {
        const n = it.next();
        if (n.done) { it = frontierSet.values(); break; }
      }

      let chosen = -1;
      let k = 0;

      const maxScan = Math.min(size, 4096);
      let scanned = 0;

      while (scanned < maxScan) {
        let n = it.next();
        if (n.done) { it = frontierSet.values(); continue; }

        const v = n.value | 0;
        scanned++;

        if (targetSet && !targetSet.has(v)) {
          frontierSet.delete(v);
          continue;
        }

        if (!this.land[v]) {
          frontierSet.delete(v);
          continue;
        }

        const o = this.owner[v] | 0;
        if (o !== expect) {
          frontierSet.delete(v);
          continue;
        }

        k++;
        if (this._rng() < 1 / k) chosen = v;
      }

      // Small frontier: fallback to a full scan to maximize reliability.
      if (chosen < 0 && frontierSet.size > 0 && frontierSet.size <= 4096) {
        k = 0;
        for (const v0 of frontierSet) {
          const v = v0 | 0;

          if (targetSet && !targetSet.has(v)) { frontierSet.delete(v); continue; }
          if (!this.land[v]) { frontierSet.delete(v); continue; }
          if ((this.owner[v] | 0) !== expect) { frontierSet.delete(v); continue; }

          k++;
          if (this._rng() < 1 / k) chosen = v;
        }
      }

      return chosen;
    }

  World.prototype._terrainCaptureMul = function(idx) {
      const b = this.biome ? (this.biome[idx] | 0) : -1;
      if (b === BIOME.MOUNTAIN || b === BIOME.ALPINE || b === BIOME.ICE_SHEET) return 2.0;
      if (b === BIOME.HIGHLAND || b === BIOME.BADLANDS || b === BIOME.TUNDRA) return 1.5;
      return 1.0;
    }

  World.prototype._opFrontierExpectedOwner = function(op) {
      if (!op) return OWNER.NONE;
      return (op.kind === "neutral") ? OWNER.NONE : (op.defender | 0);
    }

  World.prototype._opFrontierPriority = function(attackerId, idx) {
      const A = attackerId | 0;
      const w = this.w | 0;
      const h = this.h | 0;
      const x = (idx % w) | 0;
      const y = ((idx / w) | 0);

      let ownedByMe = 0;
      let ni = 0;
      if (x > 0) {
        ni = idx - 1;
        if ((this.owner[ni] | 0) === A) ownedByMe++;
      }
      if (x + 1 < w) {
        ni = idx + 1;
        if ((this.owner[ni] | 0) === A) ownedByMe++;
      }
      if (y > 0) {
        ni = idx - w;
        if ((this.owner[ni] | 0) === A) ownedByMe++;
      }
      if (y + 1 < h) {
        ni = idx + w;
        if ((this.owner[ni] | 0) === A) ownedByMe++;
      }

      const mag = this._terrainCaptureMul(idx);
      const jitter = ((this._rng() * 8) | 0) + 10;
      const tickNow = ((this._simTick | 0) || 0);
      return (jitter * (1 - ownedByMe * 0.5 + mag * 0.5)) + tickNow;
    }

  World.prototype._isOpFrontierCandidate = function(op, attackerId, idx) {
      if (!op || !op.target || !op.frontier) return false;
      const A = attackerId | 0;
      const i = idx | 0;
      const expect = this._opFrontierExpectedOwner(op);
      if (!op.target.has(i)) return false;
      if (!this.land[i]) return false;
      if ((this.owner[i] | 0) !== expect) return false;
      if (!this._touchesOwner4(i, A)) return false;
      return true;
    }

  World.prototype._ensureOpFrontierQueue = function(op) {
      if (!op) return null;
      if (!op.frontierQ) {
        const base = Math.max(256, ((op.frontier?.size || 0) * 2) | 0);
        op.frontierQ = createMinHeap(base);
      }
      return op.frontierQ;
    }

  World.prototype._rebuildOpFrontierQueue = function(op, attackerId) {
      if (!op || !op.frontier || !op.target) return 0;
      const A = attackerId | 0;
      const q = this._ensureOpFrontierQueue(op);
      heapClear(q);

      if (op.frontier.size === 0) return 0;

      for (const idx0 of op.frontier) {
        const idx = idx0 | 0;
        if (!this._isOpFrontierCandidate(op, A, idx)) {
          op.frontier.delete(idx);
          continue;
        }
        heapPush(q, idx, this._opFrontierPriority(A, idx));
      }
      return heapSize(q);
    }

  World.prototype._rebuildNeutralFrontierRing = function(op, attackerId) {
      if (!op || op.kind !== "neutral" || !op.frontier || !op.target) return 0;
      const A = attackerId | 0;
      const ring = [];

      for (const idx0 of op.frontier) {
        const idx = idx0 | 0;
        if (!this._isOpFrontierCandidate(op, A, idx)) {
          op.frontier.delete(idx);
          continue;
        }
        ring.push(idx);
      }

      if (ring.length > 1) {
        for (let i = ring.length - 1; i > 0; i--) {
          const j = (this._rng() * (i + 1)) | 0;
          const t = ring[i];
          ring[i] = ring[j];
          ring[j] = t;
        }
      }

      op.neutralRing = ring;
      op.neutralRingPos = 0;
      op._neutralRingDirty = 0;
      return ring.length | 0;
    }

  World.prototype._pickNeutralFrontierRingTile = function(op, attackerId) {
      if (!op || !op.frontier || !op.target || op.frontier.size === 0) return -1;
      const A = attackerId | 0;

      let ring = Array.isArray(op.neutralRing) ? op.neutralRing : null;
      if (!ring || ring.length === 0 || (op.neutralRingPos | 0) >= (ring.length | 0)) {
        this._rebuildNeutralFrontierRing(op, A);
        ring = Array.isArray(op.neutralRing) ? op.neutralRing : null;
      }
      if (!ring || ring.length === 0) return -1;

      while ((op.neutralRingPos | 0) < (ring.length | 0)) {
        const idx = ring[op.neutralRingPos] | 0;
        op.neutralRingPos = (op.neutralRingPos + 1) | 0;
        if (!this._isOpFrontierCandidate(op, A, idx)) {
          op.frontier.delete(idx);
          op._neutralRingDirty = 1;
          continue;
        }
        return idx;
      }

      // Ring exhausted: rebuild once so newly-added frontier cells can be consumed next.
      if (op._neutralRingDirty) {
        this._rebuildNeutralFrontierRing(op, A);
        ring = Array.isArray(op.neutralRing) ? op.neutralRing : null;
        if (!ring || ring.length === 0) return -1;
        while ((op.neutralRingPos | 0) < (ring.length | 0)) {
          const idx = ring[op.neutralRingPos] | 0;
          op.neutralRingPos = (op.neutralRingPos + 1) | 0;
          if (!this._isOpFrontierCandidate(op, A, idx)) {
            op.frontier.delete(idx);
            continue;
          }
          return idx;
        }
      }

      return -1;
    }

  World.prototype._pickOpFrontierTile = function(op, attackerId) {
      if (!op || !op.frontier || !op.target || op.frontier.size === 0) return -1;
      const A = attackerId | 0;
      if ((op.kind || "") === "neutral") return this._pickNeutralFrontierRingTile(op, A);
      const q = this._ensureOpFrontierQueue(op);

      if (heapSize(q) <= 0) this._rebuildOpFrontierQueue(op, A);
      if (heapSize(q) <= 0) return -1;

      let tries = Math.min(2048, Math.max(128, (heapSize(q) * 2) | 0));
      while (tries-- > 0 && heapSize(q) > 0) {
        const idx = heapPop(q);
        if (idx < 0) break;
        if (!this._isOpFrontierCandidate(op, A, idx)) {
          op.frontier.delete(idx);
          continue;
        }
        return idx;
      }

      if (op.frontier.size <= 0) return -1;

      this._rebuildOpFrontierQueue(op, A);
      tries = Math.min(1024, Math.max(64, heapSize(q) | 0));
      while (tries-- > 0 && heapSize(q) > 0) {
        const idx = heapPop(q);
        if (idx < 0) break;
        if (!this._isOpFrontierCandidate(op, A, idx)) {
          op.frontier.delete(idx);
          continue;
        }
        return idx;
      }

      return -1;
    }

  World.prototype._addOpFrontierFrom = function(idx, op, A) {
      if (!op || !op.target || !op.frontier) return;
      const attacker = A | 0;
      const expect = this._opFrontierExpectedOwner(op);
      const isNeutral = (op.kind === "neutral");
      const w = this.w | 0;
      const h = this.h | 0;
      const x = (idx % w) | 0;
      const y = ((idx / w) | 0);
      const q = isNeutral ? null : this._ensureOpFrontierQueue(op);
      const tryAdd = (ni) => {
        if (!op.target.has(ni)) return;
        if (!this.land[ni]) return;
        if ((this.owner[ni] | 0) !== expect) return;
        if (!this._touchesOwner4(ni, attacker)) return;

        op.frontier.add(ni);
        if (isNeutral) op._neutralRingDirty = 1;
        else heapPush(q, ni, this._opFrontierPriority(attacker, ni));
      };

      if (x > 0) tryAdd((idx - 1) | 0);
      if (x + 1 < w) tryAdd((idx + 1) | 0);
      if (y > 0) tryAdd((idx - w) | 0);
      if (y + 1 < h) tryAdd((idx + w) | 0);
    }

  // Backward-compatible neutral-op helper names.
  World.prototype._rebuildNeutralWaveOrder = function(op, attackerId) {
      this._rebuildNeutralFrontierRing(op, attackerId);
    }

  World.prototype._pickNeutralOpTile = function(op, A) {
      return this._pickNeutralFrontierRingTile(op, A);
    }

  World.prototype._addNeutralFrontierFrom = function(idx, op, A) {
      this._addOpFrontierFrom(idx, op, A);
    }

  World.prototype._addWarFrontierFrom = function(idx, op, A) {
      this._addOpFrontierFrom(idx, op, A);
    }

  World.prototype._pickNeutralFrontierTile8 = function(ownerId) {
      // Kept name for backward compatibility; behavior is now 4-neighbor (Von Neumann) for cleaner frontlines.
      const borderSet = this._borderSet[ownerId];
      if (!borderSet || borderSet.size === 0) return -1;

      let it = borderSet.values();
      const skip = (this._rng() * borderSet.size) | 0;
      for (let s = 0; s < skip; s++) {
        const n = it.next();
        if (n.done) {
          it = borderSet.values();
          break;
        }
      }

      const tries = Math.min(borderSet.size, 640);
      for (let t = 0; t < tries; t++) {
        let next = it.next();
        if (next.done) {
          it = borderSet.values();
          next = it.next();
          if (next.done) break;
        }

        const idx = next.value | 0;
        if ((this.owner[idx] | 0) !== ownerId) continue;

        const w = this.w | 0;
        const h = this.h | 0;
        const x = idx % w;
        const y = (idx / w) | 0;
        let ni = 0;

        if (x > 0) {
          ni = idx - 1;
          if (this.land[ni] && ((this.owner[ni] | 0) === OWNER.NONE)) return ni;
        }
        if (x + 1 < w) {
          ni = idx + 1;
          if (this.land[ni] && ((this.owner[ni] | 0) === OWNER.NONE)) return ni;
        }
        if (y > 0) {
          ni = idx - w;
          if (this.land[ni] && ((this.owner[ni] | 0) === OWNER.NONE)) return ni;
        }
        if (y + 1 < h) {
          ni = idx + w;
          if (this.land[ni] && ((this.owner[ni] | 0) === OWNER.NONE)) return ni;
        }
      }

      return -1;
    }


  World.prototype._pickBurstNeutralTile = function(ownerId, op) {
      const A = ownerId | 0;

      // Use capital as a stable sort-center when available, otherwise fall back to any owned border.
      const cap = this._getCapitalXY(A);
      let capX = (cap && typeof cap === "object" && !Array.isArray(cap)) ? (cap.x ?? null) : null;
      let capY = (cap && typeof cap === "object" && !Array.isArray(cap)) ? (cap.y ?? null) : null;
      if (Array.isArray(cap)) { capX = cap[0] ?? null; capY = cap[1] ?? null; }

      if (capX == null || capY == null) {
        const borderFallback = (op && Array.isArray(op.borderList) && op.borderList.length)
          ? op.borderList
          : (this._borderSet && this._borderSet[A] ? Array.from(this._borderSet[A]) : []);
        if (borderFallback.length) {
          const bi = borderFallback[(this._rng() * borderFallback.length) | 0];
          capX = bi % this.w;
          capY = (bi / this.w) | 0;
        } else {
          capX = (this.w * 0.5) | 0;
          capY = (this.h * 0.5) | 0;
        }
      }

      if (!op) {
        const border = Array.from(this._borderSet[A]);
        if (!border.length) return -1;
        const bi = border[(this._rng() * border.length) | 0];
        if ((this.owner[bi] | 0) !== A) return -1;
        return this._pickNeutralNeighborAny(bi);
      }

      // Rebuild border list on a short timer and after large ownership deltas.
      // Avoid rebuilding/sorting every tick during burst expansion; that causes visible stutter.
      const frontierSize = Math.max(0, this._borderSet[A]?.size || 0);
      const rebuildInterval = frontierSize >= 12000
        ? 0.55
        : (frontierSize >= 6000 ? 0.40 : (frontierSize >= 2500 ? 0.28 : BURST_BORDER_REBUILD_INTERVAL_S));
      const rebuildOwnerDelta = frontierSize >= 12000
        ? 900
        : (frontierSize >= 6000 ? 520 : (frontierSize >= 2500 ? 340 : BURST_BORDER_REBUILD_OWNER_DELTA));
      const ownerVer = this._nationTerritoryVersion
        ? (this._nationTerritoryVersion[A] >>> 0)
        : (this.ownerVersion >>> 0);
      const prevOwnerVer = (op.borderBuildOwnerVersion >>> 0);
      const ownerDelta = (ownerVer - prevOwnerVer) >>> 0;
      const needBorderRebuild =
        !op.borderList ||
        !op.borderList.length ||
        ownerDelta >= rebuildOwnerDelta ||
        this.time - (op.borderBuildAt || 0) > rebuildInterval;

      if (needBorderRebuild) {
        const borderList = Array.from(this._borderSet[A]);
        if (!borderList.length) return -1;

        // Keep fill order mixed without paying full shuffle cost on huge frontiers.
        if (borderList.length <= 2200) {
          for (let i = borderList.length - 1; i > 0; i--) {
            const j = (this._rng() * (i + 1)) | 0;
            const t = borderList[i];
            borderList[i] = borderList[j];
            borderList[j] = t;
          }
        } else {
          const swaps = Math.min(borderList.length, 768);
          for (let i = 0; i < swaps; i++) {
            const a = (this._rng() * borderList.length) | 0;
            const b = (this._rng() * borderList.length) | 0;
            const t = borderList[a];
            borderList[a] = borderList[b];
            borderList[b] = t;
          }
        }

        op.borderList = borderList;
        op.borderBuildAt = this.time;
        op.borderBuildOwnerVersion = ownerVer;
        op.borderCursor = (this._rng() * borderList.length) | 0;
      }

      const borderList = op.borderList;
      if (!borderList || !borderList.length) return -1;

      // Sweep the full border and pick any adjacent neutral land tile.
      const tries = borderList.length >= 12000
        ? 1400
        : (borderList.length >= 6000 ? 2000 : Math.min(borderList.length, 2600));
      for (let t = 0; t < tries; t++) {
        const bi = borderList[op.borderCursor++ % borderList.length];
        if (bi < 0) continue;
        if ((this.owner[bi] | 0) !== A) continue;

        const ni = this._pickNeutralNeighborAny(bi);
        if (ni >= 0) return ni;
      }

      return -1;
    }

  World.prototype._pickNeutralNeighborAny = function(borderIdx) {
      const w = this.w | 0;
      const h = this.h | 0;
      const bx = borderIdx % w;
      const by = (borderIdx / w) | 0;
      const owner = this.owner;
      const land = this.land;

      let chosen = -1;
      let seen = 0;
      let idx = 0;

      if (bx + 1 < w) {
        idx = borderIdx + 1;
        if (land[idx] && ((owner[idx] | 0) === OWNER.NONE)) {
          seen++;
          if ((this._rng() * seen) < 1) chosen = idx;
        }
      }
      if (bx > 0) {
        idx = borderIdx - 1;
        if (land[idx] && ((owner[idx] | 0) === OWNER.NONE)) {
          seen++;
          if ((this._rng() * seen) < 1) chosen = idx;
        }
      }
      if (by + 1 < h) {
        idx = borderIdx + w;
        if (land[idx] && ((owner[idx] | 0) === OWNER.NONE)) {
          seen++;
          if ((this._rng() * seen) < 1) chosen = idx;
        }
      }
      if (by > 0) {
        idx = borderIdx - w;
        if (land[idx] && ((owner[idx] | 0) === OWNER.NONE)) {
          seen++;
          if ((this._rng() * seen) < 1) chosen = idx;
        }
      }

      return chosen;
    }


  World.prototype._rebuildBurstAimBand = function(op, aimX, aimY) {
      if (!op || !op.borderList || !op.borderList.length) return;

      const maxDim = Math.max(this.w, this.h);
      // Wide bias band: affects a large arc of the frontier rather than a narrow beam.
      let radius = Math.max(24, (0.38 * maxDim) | 0);
      let r2 = radius * radius;

      let band = [];
      for (let i = 0; i < op.borderList.length; i++) {
        const idx = op.borderList[i];
        const x = idx % this.w;
        const y = (idx / this.w) | 0;
        const dx = x - aimX;
        const dy = y - aimY;
        if (dx * dx + dy * dy <= r2) band.push(idx);
      }

      // If the band is too small (e.g., aim is far away), loosen the radius.
      if (band.length < 24 && op.borderList.length > 0) {
        radius = Math.max(radius, (0.55 * maxDim) | 0);
        r2 = radius * radius;
        band = [];
        for (let i = 0; i < op.borderList.length; i++) {
          const idx = op.borderList[i];
          const x = idx % this.w;
          const y = (idx / this.w) | 0;
          const dx = x - aimX;
          const dy = y - aimY;
          if (dx * dx + dy * dy <= r2) band.push(idx);
        }
      }

      op.aimBand = band;
      op.aimCursor = band.length ? this._closestBorderCursor(band, aimX, aimY) : 0;
      op.aimBandAt = this.time;
      op.aimBandX = aimX;
      op.aimBandY = aimY;
    }

    // Prefer filling outward on the whole frontier; apply a mild, wide bias toward the aim point.
  World.prototype._pickNeutralNeighborTowardAim = function(borderIdx, aimX, aimY) {
      const bx = borderIdx % this.w;
      const by = (borderIdx / this.w) | 0;

      const dirs4 = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const cand = [];
      const pushCand = (x, y) => {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const ni = y * this.w + x;
        if ((this.land[ni] | 0) === 0) return;
        if ((this.owner[ni] | 0) !== 0) return;
        cand.push({ ni, x, y });
      };

      for (const [dx, dy] of dirs4) pushCand(bx + dx, by + dy);
      if (!cand.length) return -1;

      const maxDim = Math.max(this.w, this.h);
      const sigma = 0.30 * maxDim; // wide (not narrow)
      const inv2s2 = 1 / (2 * sigma * sigma);
      const bias = 0.45; // mild cursor bias

      let sum = 0;
      for (const c of cand) {
        const dx = c.x - aimX;
        const dy = c.y - aimY;
        const d2 = dx * dx + dy * dy;
        // Soft preference for closer-to-aim tiles; keep randomness to avoid a thin beam.
        let w = 1 + bias * Math.exp(-d2 * inv2s2);
        w *= 0.85 + 0.30 * this._rng(); // jitter to keep the front wide
        c.w = w;
        sum += w;
      }

      let r = this._rng() * sum;
      for (const c of cand) {
        r -= c.w;
        if (r <= 0) return c.ni;
      }
      return cand[cand.length - 1].ni;
    }
  World.prototype._closestBorderCursor = function(borderList, aimX, aimY) {
      if (!borderList || borderList.length === 0) return 0;
      const w = this.w;
      let bestI = 0;
      let bestD2 = Infinity;

      // Scan a sample if border is huge.
      const n = borderList.length;
      const step = n > 5000 ? Math.ceil(n / 2000) : 1;

      for (let i = 0; i < n; i += step) {
        const idx = borderList[i];
        const x = idx % w;
        const y = (idx / w) | 0;
        const dx = x - aimX, dy = y - aimY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestI = i;
        }
      }
      return bestI | 0;
    }

  World.prototype._getCapitalXY = function(ownerId) {
      const id = ownerId | 0;
      const capId = this.nation[id]?.capital;
      if (!capId) return null;
      const st = this._structureById.get(capId);
      if (!st) return null;
      return { x: st.x | 0, y: st.y | 0 };
    }


}
