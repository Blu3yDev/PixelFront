// FILE: src/game/systems/events.js

import { OWNER } from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

export function installEvents(World) {
    // ===== Labels =====

  World.prototype._rebuildLabelStats = function() {
      const len = this._nationCount + 1;
      let sumX = this._labelSumX;
      let sumY = this._labelSumY;
      let cnt = this._labelCount;

      if (!sumX || sumX.length !== len) sumX = this._labelSumX = new Float64Array(len);
      else sumX.fill(0);
      if (!sumY || sumY.length !== len) sumY = this._labelSumY = new Float64Array(len);
      else sumY.fill(0);
      if (!cnt || cnt.length !== len) cnt = this._labelCount = new Int32Array(len);
      else cnt.fill(0);

      const owner = this.owner;
      const land = this.land;
      const nations = this.nation;
      const w = this.w | 0;

      for (let i = 0; i < owner.length; i++) {
        if (!land[i]) continue;
        const o = owner[i] | 0;
        if (o <= 0) continue;
        if (!nations[o]?.alive) continue;

        cnt[o]++;
        sumX[o] += (i % w);
        sumY[o] += ((i / w) | 0);
      }

      if (typeof this._markAllLabelsDirty === "function") this._markAllLabelsDirty();
    }

  World.prototype._ensureLabelDirtyState = function() {
      const len = (this._nationCount | 0) + 1;
      if (!this._labelDirtyFlags || this._labelDirtyFlags.length !== len) {
        this._labelDirtyFlags = new Uint8Array(len);
      }
      if (!Array.isArray(this._labelDirtyQueue)) {
        this._labelDirtyQueue = [];
      }
      if (!Number.isFinite(this._labelDirtyHead)) {
        this._labelDirtyHead = 0;
      }
    }

  World.prototype._markLabelDirty = function(ownerId) {
      const id = ownerId | 0;
      if (id <= 0 || id > (this._nationCount | 0)) return;
      this._ensureLabelDirtyState();

      const flags = this._labelDirtyFlags;
      if (flags[id]) return;
      flags[id] = 1;
      this._labelDirtyQueue.push(id);
    }

  World.prototype._markAllLabelsDirty = function() {
      this._ensureLabelDirtyState();
      const flags = this._labelDirtyFlags;
      const q = this._labelDirtyQueue;

      q.length = 0;
      this._labelDirtyHead = 0;
      flags.fill(0);
      for (let id = 1; id <= this._nationCount; id++) {
        flags[id] = 1;
        q.push(id);
      }
    }

  World.prototype._recomputeLabelForNation = function(ownerId) {
      const id = ownerId | 0;
      if (id <= 0 || id > (this._nationCount | 0)) return;

      if (!this.nation[id]?.alive) {
        this._labelPos[id] = null;
        return;
      }

      const cnt = this._labelCount;
      const sumX = this._labelSumX;
      const sumY = this._labelSumY;
      if (!cnt || !sumX || !sumY || (id >= cnt.length) || (id >= sumX.length) || (id >= sumY.length)) {
        this._labelPos[id] = null;
        return;
      }
      if ((cnt[id] | 0) <= 0) {
        this._labelPos[id] = null;
        return;
      }

      let x = clampInt(Math.round(sumX[id] / cnt[id]), 0, this.w - 1);
      let y = clampInt(Math.round(sumY[id] / cnt[id]), 0, this.h - 1);
      const snapped = this._findLargestOwnedLabelTile(id, x, y) || this._findNearestOwnedLabelTile(id, x, y);
      if (!snapped) {
        this._labelPos[id] = null;
        return;
      }

      x = snapped.x | 0;
      y = snapped.y | 0;
      this._labelPos[id] = { x, y };
    }

  World.prototype._countOwnedNeighbors8 = function(ownerId, idxRaw) {
      const oid = ownerId | 0;
      const idx = idxRaw | 0;
      const owner = this.owner;
      const land = this.land;
      const w = this.w | 0;
      const h = this.h | 0;
      if (!owner || !land) return 0;
      if (idx < 0 || idx >= owner.length) return 0;

      const x = idx % w;
      const y = (idx / w) | 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const ni = yy * w + xx;
          if (!land[ni]) continue;
          if ((owner[ni] | 0) === oid) count++;
        }
      }

      return count;
    }

  World.prototype._findNearestOwnedLabelTile = function(ownerId, cxRaw, cyRaw) {
      const oid = ownerId | 0;
      if (oid <= 0) return null;

      const owner = this.owner;
      const land = this.land;
      const w = this.w | 0;
      const h = this.h | 0;
      if (!owner || !land || !(w > 0) || !(h > 0)) return null;

      const cx = clampInt(Math.round(Number(cxRaw) || 0), 0, w - 1);
      const cy = clampInt(Math.round(Number(cyRaw) || 0), 0, h - 1);
      let bestIdx = -1;
      let bestD2 = Infinity;

      const ownedTiles = (typeof this._getOwnerTiles === "function")
        ? this._getOwnerTiles(oid)
        : null;

      if (Array.isArray(ownedTiles) && ownedTiles.length > 0) {
        for (let i = 0; i < ownedTiles.length; i++) {
          const idx = ownedTiles[i] | 0;
          if (idx < 0 || idx >= owner.length) continue;
          if (!land[idx] || (owner[idx] | 0) !== oid) continue;
          const x = idx % w;
          const y = (idx / w) | 0;
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = idx;
            if (d2 <= 0) break;
          }
        }

        if (bestIdx >= 0 && Number.isFinite(bestD2)) {
          let bestSupport = this._countOwnedNeighbors8(oid, bestIdx);
          const d2Window = bestD2 + 9;
          for (let i = 0; i < ownedTiles.length; i++) {
            const idx = ownedTiles[i] | 0;
            if (idx < 0 || idx >= owner.length) continue;
            if (!land[idx] || (owner[idx] | 0) !== oid) continue;
            const x = idx % w;
            const y = (idx / w) | 0;
            const dx = x - cx;
            const dy = y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 > d2Window) continue;

            const support = this._countOwnedNeighbors8(oid, idx);
            if (
              support > bestSupport ||
              (support === bestSupport && d2 < bestD2)
            ) {
              bestSupport = support;
              bestD2 = d2;
              bestIdx = idx;
            }
          }
        }
      } else {
        for (let idx = 0; idx < owner.length; idx++) {
          if (!land[idx]) continue;
          if ((owner[idx] | 0) !== oid) continue;
          const x = idx % w;
          const y = (idx / w) | 0;
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = idx;
            if (d2 <= 0) break;
          }
        }
      }

      if (bestIdx < 0) return null;
      return {
        x: bestIdx % w,
        y: (bestIdx / w) | 0
      };
    }

  World.prototype._ensureLabelAnchorBuffers = function() {
      const n = this.owner ? (this.owner.length | 0) : 0;
      if (!(n > 0)) return false;
      if (!this._labelVisitMark || this._labelVisitMark.length !== n) {
        this._labelVisitMark = new Int32Array(n);
        this._labelVisitToken = 1;
      }
      if (!this._labelFloodQueue || this._labelFloodQueue.length !== n) {
        this._labelFloodQueue = new Int32Array(n);
      }
      return true;
    }

  World.prototype._findLargestOwnedLabelTile = function(ownerId, cxRaw, cyRaw) {
      const oid = ownerId | 0;
      if (oid <= 0) return null;

      const owner = this.owner;
      const land = this.land;
      const w = this.w | 0;
      const h = this.h | 0;
      if (!owner || !land || !(w > 0) || !(h > 0)) return null;

      const ownedTiles = (typeof this._getOwnerTiles === "function")
        ? this._getOwnerTiles(oid)
        : null;
      if (!Array.isArray(ownedTiles) || ownedTiles.length <= 0) return null;

      if (!this._ensureLabelAnchorBuffers()) return null;
      const visit = this._labelVisitMark;
      const queue = this._labelFloodQueue;
      let token = (this._labelVisitToken | 0) + 1;
      if (token <= 0 || token >= 2147483000) {
        visit.fill(0);
        token = 1;
      }
      this._labelVisitToken = token;

      const cx = clampInt(Math.round(Number(cxRaw) || 0), 0, w - 1);
      const cy = clampInt(Math.round(Number(cyRaw) || 0), 0, h - 1);

      let bestIdx = -1;
      let bestSize = 0;
      let bestNearD2 = Infinity;
      let bestSupport = -1;

      for (let i = 0; i < ownedTiles.length; i++) {
        const start = ownedTiles[i] | 0;
        if (start < 0 || start >= owner.length) continue;
        if (!land[start] || (owner[start] | 0) !== oid) continue;
        if ((visit[start] | 0) === token) continue;

        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        visit[start] = token;

        let size = 0;
        let sumX = 0;
        let sumY = 0;
        while (head < tail) {
          const cur = queue[head++] | 0;
          size++;
          const x = cur % w;
          const y = (cur / w) | 0;
          sumX += x;
          sumY += y;

          if (x > 0) {
            const ni = cur - 1;
            if ((visit[ni] | 0) !== token && land[ni] && ((owner[ni] | 0) === oid)) {
              visit[ni] = token;
              queue[tail++] = ni;
            }
          }
          if (x + 1 < w) {
            const ni = cur + 1;
            if ((visit[ni] | 0) !== token && land[ni] && ((owner[ni] | 0) === oid)) {
              visit[ni] = token;
              queue[tail++] = ni;
            }
          }
          if (y > 0) {
            const ni = cur - w;
            if ((visit[ni] | 0) !== token && land[ni] && ((owner[ni] | 0) === oid)) {
              visit[ni] = token;
              queue[tail++] = ni;
            }
          }
          if (y + 1 < h) {
            const ni = cur + w;
            if ((visit[ni] | 0) !== token && land[ni] && ((owner[ni] | 0) === oid)) {
              visit[ni] = token;
              queue[tail++] = ni;
            }
          }
        }

        if (size <= 0) continue;
        const ccx = sumX / size;
        const ccy = sumY / size;

        let compBestIdx = queue[0] | 0;
        let compBestD2 = Infinity;
        let compBestSupport = this._countOwnedNeighbors8(oid, compBestIdx);
        const supportStep = tail > 1600 ? 6 : (tail > 700 ? 4 : (tail > 260 ? 2 : 1));
        for (let qi = 0; qi < tail; qi++) {
          const idx = queue[qi] | 0;
          const x = idx % w;
          const y = (idx / w) | 0;
          const dx = x - ccx;
          const dy = y - ccy;
          const d2 = dx * dx + dy * dy;
          let support = compBestSupport;
          if (supportStep === 1 || ((qi % supportStep) === 0) || (d2 <= (compBestD2 + 0.85))) {
            support = this._countOwnedNeighbors8(oid, idx);
          }
          if (
            d2 < compBestD2 ||
            (Math.abs(d2 - compBestD2) <= 0.40 && support > compBestSupport)
          ) {
            compBestD2 = d2;
            compBestSupport = support;
            compBestIdx = idx;
          }
        }

        const bx = compBestIdx % w;
        const by = (compBestIdx / w) | 0;
        const nearDx = bx - cx;
        const nearDy = by - cy;
        const nearD2 = nearDx * nearDx + nearDy * nearDy;

        if (
          size > bestSize ||
          (size === bestSize && (
            nearD2 < bestNearD2 ||
            (nearD2 === bestNearD2 && compBestSupport > bestSupport)
          ))
        ) {
          bestSize = size;
          bestIdx = compBestIdx;
          bestNearD2 = nearD2;
          bestSupport = compBestSupport;
        }
      }

      if (bestIdx < 0) return null;
      return {
        x: bestIdx % w,
        y: (bestIdx / w) | 0
      };
    }

  World.prototype._recomputeLabels = function() {
      const len = this._nationCount + 1;
      if (!this._labelSumX || this._labelSumX.length !== len ||
          !this._labelSumY || this._labelSumY.length !== len ||
          !this._labelCount || this._labelCount.length !== len) {
        this._rebuildLabelStats();
      }

      this._ensureLabelDirtyState();
      const q = this._labelDirtyQueue;
      let head = this._labelDirtyHead | 0;
      let pending = (q ? (q.length - head) : 0) | 0;
      if (!q || pending <= 0) {
        // Bootstrap/recovery: if alive nations have no cached label yet, schedule a full pass once.
        let missing = 0;
        for (let id = 1; id <= this._nationCount; id++) {
          if (!this.nation[id]?.alive) continue;
          if (!this._labelPos[id]) missing++;
        }
        if (missing <= 0) return;
        this._markAllLabelsDirty();
        head = this._labelDirtyHead | 0;
        pending = (this._labelDirtyQueue.length - head) | 0;
        if (pending <= 0) return;
      }

      const nations = Math.max(1, this._nationCount | 0);
      const tiles = Math.max(1, (this.w | 0) * (this.h | 0));
      const pressure = (tiles / 1_000_000) + (nations / 180);

      let budget = clampInt(Math.ceil(nations * 0.28), 8, 140);
      if (pressure >= 3.0) budget = clampInt(Math.ceil(nations * 0.14), 6, 54);
      else if (pressure >= 2.0) budget = clampInt(Math.ceil(nations * 0.20), 7, 88);

      const take = Math.min(pending | 0, budget | 0);
      const flags = this._labelDirtyFlags;
      for (let i = 0; i < take; i++) {
        const id = q[head++] | 0;
        if (id <= 0 || id > this._nationCount) continue;
        if (flags && id < flags.length) flags[id] = 0;
        this._recomputeLabelForNation(id);
      }

      this._labelDirtyHead = head;
      // Keep queue compact without O(n) churn every tick.
      if (head >= q.length) {
        q.length = 0;
        this._labelDirtyHead = 0;
      } else if (head > 2048 && head * 2 >= q.length) {
        q.splice(0, head);
        this._labelDirtyHead = 0;
      }
    }

    // ===== Relations helpers =====

  World.prototype._pair = function(a, b) {
      return (a | 0) * (this._nationCount + 1) + (b | 0);
    }

  World.prototype._setWar = function(a, b, v) {
      const A = a | 0, B = b | 0;
      if (A <= 0 || B <= 0 || A === B) return;
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      const was = (this._atWar[pAB] === 1);
      const next = v ? 1 : 0;

      this._atWar[pAB] = next;
      this._atWar[pBA] = next;

      if (was === !!next) return;

      const lo = A < B ? A : B;
      const hi = A < B ? B : A;
      const key = this._pair(lo, hi);
      if (this._warContactCache) this._warContactCache.delete(key);

      if (next) {
        this._activeWarPairs.add(key);
        if (this._warPairLastSolveAt) this._warPairLastSolveAt.set(key, this.time || 0);
        this._warsByNation[A] = (this._warsByNation[A] | 0) + 1;
        this._warsByNation[B] = (this._warsByNation[B] | 0) + 1;
        if (typeof this._cancelTradeDealsForWar === "function") {
          this._cancelTradeDealsForWar(A, B);
        }
      } else {
        this._activeWarPairs.delete(key);
        if (this._warPairLastSolveAt) this._warPairLastSolveAt.delete(key);
        if ((this._warsByNation[A] | 0) > 0) this._warsByNation[A]--;
        if ((this._warsByNation[B] | 0) > 0) this._warsByNation[B]--;
      }
    }

  World.prototype._setAlliance = function(a, b, until) {
      const A = a | 0, B = b | 0;
      const t = Math.max(this.time, until || 0);
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._alliedUntil[pAB] = t;
      this._alliedUntil[pBA] = t;
    }

  World.prototype._setCeasefire = function(a, b, until) {
      const A = a | 0, B = b | 0;
      const t = Math.max(this.time, until || 0);
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._ceasefireUntil[pAB] = t;
      this._ceasefireUntil[pBA] = t;
    }

  World.prototype._setPending = function(a, b, from, until) {
      const A = a | 0, B = b | 0;
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._pendingUntil[pAB] = until;
      this._pendingUntil[pBA] = until;
      this._pendingFrom[pAB] = from | 0;
      this._pendingFrom[pBA] = from | 0;
    }

  World.prototype._setCeasefirePending = function(a, b, from, until) {
      const A = a | 0, B = b | 0;
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._ceasefirePendingUntil[pAB] = until;
      this._ceasefirePendingUntil[pBA] = until;
      this._ceasefirePendingFrom[pAB] = from | 0;
      this._ceasefirePendingFrom[pBA] = from | 0;
    }

  World.prototype._clearPending = function(a, b) {
      const A = a | 0, B = b | 0;
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._pendingUntil[pAB] = 0;
      this._pendingUntil[pBA] = 0;
      this._pendingFrom[pAB] = 0;
      this._pendingFrom[pBA] = 0;
    }

  World.prototype._clearCeasefirePending = function(a, b) {
      const A = a | 0, B = b | 0;
      const pAB = this._pair(A, B);
      const pBA = this._pair(B, A);
      this._ceasefirePendingUntil[pAB] = 0;
      this._ceasefirePendingUntil[pBA] = 0;
      this._ceasefirePendingFrom[pAB] = 0;
      this._ceasefirePendingFrom[pBA] = 0;
    }

  World.prototype._getActiveAlliesOf = function(id) {
      const A = id | 0;
      const out = [];
      for (let B = 1; B <= this._nationCount; B++) {
        if (B === A) continue;
        const p = this._pair(A, B);
        if (this._alliedUntil[p] > this.time) out.push(B);
      }
      return out;
    }

  World.prototype._getActiveAllyOf = function(id) {
      const allies = this._getActiveAlliesOf(id);
      return allies.length ? allies[0] : 0;
    }

  World.prototype._countAllies = function(id) {
      return this._getActiveAlliesOf(id).length;
    }

  World.prototype._anyWar = function(id) {
      const A = id | 0;
      return A > 0 && ((this._warsByNation[A] | 0) > 0);
    }

    // ===== Events / naming =====

  World.prototype._nameOf = function(id) {
      const n = this.nation[id];
      return n ? n.name : `Nation ${id}`;
    }

  World.prototype._isPlayerFacingEvent = function(text, extra = null) {
      const x = extra && typeof extra === "object" ? extra : null;
      const from = x ? (x.from | 0) : 0;
      const to = x ? (x.to | 0) : 0;
      if (from === OWNER.PLAYER || to === OWNER.PLAYER) return true;

      const s = String(text || "");
      if (!s) return false;

      // Keep core game-state/system messages even if no explicit player actor fields exist.
      if (s === "World regenerated." || s === "Victory." || s === "Defeat.") return true;
      if (s.includes("Rebels rise up!")) return true;

      // Player-facing language generated by existing event messages.
      if (/\bYou\b/.test(s)) return true;
      if (/\byour\b/i.test(s)) return true;

      return false;
    }

  World.prototype._isGlobalRelevantEvent = function(text, extra = null) {
      const x = extra && typeof extra === "object" ? extra : null;
      const kind = String(x?.kind || "").toLowerCase();
      if (
        kind === "war_declared" ||
        kind === "alliance_formed" ||
        kind === "ally_request" ||
        kind === "ceasefire_request" ||
        kind === "nation_collapsed" ||
        kind === "nation_eliminated" ||
        kind === "nuke_incoming"
      ) return true;

      const s = String(text || "");
      if (!s) return false;
      if (s === "World regenerated." || s === "Victory." || s === "Defeat.") return true;

      const l = s.toLowerCase();
      if (l.includes("declared war")) return true;
      if (l.includes("captured") && l.includes("capital")) return true;
      if (l.includes("collapses")) return true;
      if (l.includes("eliminated")) return true;
      if (l.includes("alliance")) return true;
      if (l.includes("ceasefire")) return true;
      if (l.includes("incoming")) return true;
      if (l.includes("launched a") && l.includes("missile")) return true;
      if (l.includes("detonated")) return true;
      if (l.includes("intercepted")) return true;
      if (l.includes("rebels rise up")) return true;

      return false;
    }

  World.prototype._pushEvent = function(text) {
      const extra = arguments.length > 1 ? arguments[1] : null;
      if (!this._nextEventId) this._nextEventId = 1;
      const ev = { id: this._nextEventId++, t: this.time, text: String(text || "") };
      if (extra && typeof extra === "object") Object.assign(ev, extra);

      const globalRelevant = this._isGlobalRelevantEvent(ev.text, ev);
      const playerRelevant = this._isPlayerFacingEvent(ev.text, ev);
      if (!globalRelevant && !playerRelevant) return null;

      if (globalRelevant) {
        if (!Array.isArray(this.globalEvents)) this.globalEvents = [];
        const cap = Math.max(30, Number(this._maxGlobalEvents) || 220);
        this.globalEvents.push(ev);
        if (this.globalEvents.length > cap) {
          this.globalEvents.splice(0, this.globalEvents.length - cap);
        }
      }

      if (playerRelevant) {
        if (!Array.isArray(this.events)) this.events = [];
        const cap = Math.max(30, Number(this._maxEvents) || 90);
        this.events.push(ev);
        if (this.events.length > cap) {
          this.events.splice(0, this.events.length - cap);
        }
      }

      return ev;
    }
}
