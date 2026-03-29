// FILE: src/game/systems/divisions.js

import { GAME_MODE, OWNER } from "../config.js";
import { clamp01 } from "../utils.js";

const DIVISION_TYPES = Object.freeze({
  infantry: Object.freeze({
    id: "infantry",
    name: "Infantry Division",
    maxInfantry: 120,
    trainTimeS: 24,
    attackRangeTiles: 4.8,
    mobility: 1.05,
    moveTilesPerS: 2.35,
    captureCostNeutral: 8,
    captureCostEnemy: 14,
    combatPowerMul: 1.18,
    reinforcePerS: 4.1
  })
});

function divisionSpec(typeRaw) {
  const type = String(typeRaw || "infantry").toLowerCase();
  return DIVISION_TYPES[type] || DIVISION_TYPES.infantry;
}

function sqDist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function orderCenterFromIndices(indices, width) {
  const arr = Array.isArray(indices) ? indices : [];
  if (!arr.length || !(width > 0)) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < arr.length; i++) {
    const idx = arr[i] | 0;
    sumX += (idx % width) + 0.5;
    sumY += ((idx / width) | 0) + 0.5;
  }
  return { x: sumX / arr.length, y: sumY / arr.length };
}

function ordinalSuffix(valueRaw) {
  const value = Math.abs(valueRaw | 0);
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = value % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function divisionName(ownerSerialRaw, spec) {
  const serial = Math.max(1, ownerSerialRaw | 0);
  const shortName = String(spec?.name || "Division").replace(/\s+Division$/i, "");
  return `${serial}${ordinalSuffix(serial)} ${shortName} Division`;
}

export function installDivisions(World) {
  World.prototype._normalizeGameMode = function(rawMode) {
    const mode = String(rawMode || GAME_MODE.CLASSIC).trim().toLowerCase();
    if (mode === GAME_MODE.DIVISIONS) return GAME_MODE.DIVISIONS;
    if (mode === GAME_MODE.CONTINENTAL) return GAME_MODE.CONTINENTAL;
    return GAME_MODE.CLASSIC;
  };

  World.prototype._isDivisionsMode = function() {
    return this._normalizeGameMode(this._gameMode) === GAME_MODE.DIVISIONS;
  };

  World.prototype._resetDivisionState = function() {
    this.divisions = [];
    this._nextDivisionId = 1;
    this._divisionSerialByOwner = new Int32Array((this._nationCount | 0) + 1);
    this._divisionAiTrainCooldownUntil = new Float32Array((this._nationCount | 0) + 1);
    this._divisionAiOrderCooldownUntil = new Float32Array((this._nationCount | 0) + 1);
  };

  World.prototype.getDivisionSpec = function(typeRaw) {
    return divisionSpec(typeRaw);
  };

  World.prototype.getDivisionById = function(idRaw) {
    const id = idRaw | 0;
    if (!(id > 0)) return null;
    const list = Array.isArray(this.divisions) ? this.divisions : [];
    for (let i = 0; i < list.length; i++) {
      const div = list[i];
      if ((div?.id | 0) === id) return div;
    }
    return null;
  };

  World.prototype.getDivisionAt = function(xRaw, yRaw, radiusRaw = 1.45) {
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const radius = Math.max(0.25, Number(radiusRaw) || 1.45);
    const limitSq = radius * radius;
    const list = Array.isArray(this.divisions) ? this.divisions : [];
    let best = null;
    let bestD = limitSq;
    for (let i = list.length - 1; i >= 0; i--) {
      const div = list[i];
      if (!div || !(Number(div.infantry) > 0) || !this.nation?.[div.owner | 0]?.alive) continue;
      const px = Number(div.px);
      const py = Number(div.py);
      const dx = x + 0.5 - (Number.isFinite(px) ? px : (Number(div.x) || 0) + 0.5);
      const dy = y + 0.5 - (Number.isFinite(py) ? py : (Number(div.y) || 0) + 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD) continue;
      bestD = d2;
      best = div;
    }
    return best;
  };

  World.prototype._divisionOrderLookup = function(order) {
    if (!order || typeof order !== "object") return null;
    if (order.lookup instanceof Set) return order.lookup;
    const arr = Array.isArray(order.indices)
      ? order.indices
      : (Array.isArray(order.lookup) ? order.lookup : []);
    order.lookup = new Set(arr.map((idx) => idx | 0));
    return order.lookup;
  };

  World.prototype._divisionOrderIncludes = function(div, idxRaw) {
    const order = div?.order;
    if (!order || typeof order !== "object") return false;
    const lookup = this._divisionOrderLookup(order);
    return !!lookup?.has?.(idxRaw | 0);
  };

  World.prototype._ensureBarracksDivisionTraining = function(st) {
    if (!st || typeof st !== "object") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.divisionTraining || typeof st.data.divisionTraining !== "object") {
      st.data.divisionTraining = { queue: [] };
    }
    const d = st.data.divisionTraining;
    if (!Array.isArray(d.queue)) d.queue = [];
    return d;
  };

  World.prototype.getBarracksDivisionStatus = function(structIdRaw, ownerIdRaw = OWNER.PLAYER) {
    if (!this._isDivisionsMode()) return { ok: false, reason: "Division training is only available in Divisions mode." };

    const structId = structIdRaw | 0;
    const ownerId = ownerIdRaw | 0;
    const st = this._structureById?.get?.(structId) || null;
    if (!st || String(st.type || "") !== "barracks") return { ok: false, reason: "Barracks not found." };
    if ((st.owner | 0) !== ownerId) return { ok: false, reason: "Barracks does not belong to that nation." };

    const nation = this.nation?.[ownerId];
    if (!nation || !nation.alive) return { ok: false, reason: "Nation unavailable." };

    const training = this._ensureBarracksDivisionTraining(st);
    const spec = divisionSpec("infantry");
    const availableReserve = Math.max(0, Math.floor(Number(nation.infantry) || 0));
    const maxTrainable = Math.max(0, Math.floor(availableReserve / Math.max(1, spec.maxInfantry | 0)));
    const queue = Array.isArray(training?.queue) ? training.queue : [];
    const current = queue[0] || null;
    const currentRemainingS = Math.max(0, Number(current?.remainingS) || 0);
    const currentTotalS = Math.max(0.001, Number(current?.totalS) || Number(spec.trainTimeS) || 1);
    const progress01 = current
      ? clamp01(1 - (currentRemainingS / currentTotalS))
      : 0;
    const canQueue = !!(this._isStructureOperational?.(st) && maxTrainable > 0);
    let reason = "";
    if (!this._isStructureOperational?.(st)) {
      reason = this._getStructureInactiveReason?.(st) || "Barracks unavailable.";
    } else if (maxTrainable <= 0) {
      reason = `Need ${spec.maxInfantry} reserve infantry per division.`;
    }

    return {
      ok: true,
      reason,
      canQueue,
      queueLength: queue.length | 0,
      queuedType: String(current?.type || ""),
      queuedLabel: current ? String(divisionSpec(current.type).name) : "",
      queuedRemainingS: currentRemainingS,
      queuedProgress01: progress01,
      availableReserve,
      maxTrainable,
      options: [
        {
          id: spec.id,
          label: spec.name,
          costInfantry: spec.maxInfantry | 0,
          trainTimeS: Math.max(1, Math.round(Number(spec.trainTimeS) || 1)),
          maxTrainable,
          disabled: !canQueue,
          reason
        }
      ]
    };
  };

  World.prototype._findDivisionSpawnCell = function(ownerIdRaw, xRaw, yRaw) {
    const ownerId = ownerIdRaw | 0;
    const x = xRaw | 0;
    const y = yRaw | 0;
    const w = this.w | 0;
    const h = this.h | 0;
    const canUse = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
      const idx = cy * w + cx;
      if (!this._isGameplayLand(idx)) return false;
      return (this.owner[idx] | 0) === ownerId;
    };
    if (canUse(x, y)) return { x, y };
    for (let r = 1; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx;
          const cy = y + dy;
          if (canUse(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    const owned = (typeof this._getOwnerTiles === "function") ? this._getOwnerTiles(ownerId) : null;
    if (owned && owned.length > 0) {
      const idx = owned[(this._rng() * owned.length) | 0] | 0;
      return { x: idx % w, y: (idx / w) | 0 };
    }
    return { x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) };
  };

  World.prototype._spawnDivision = function(ownerIdRaw, typeRaw, xRaw, yRaw, sourceStructIdRaw = 0) {
    const ownerId = ownerIdRaw | 0;
    const nation = this.nation?.[ownerId];
    if (!nation || !nation.alive) return null;

    const spec = divisionSpec(typeRaw);
    const spawn = this._findDivisionSpawnCell(ownerId, xRaw, yRaw);
    if (!spawn) return null;

    const serials = this._divisionSerialByOwner;
    let serial = 1;
    if (serials && serials.length > ownerId) {
      serials[ownerId] = Math.max(0, serials[ownerId] | 0) + 1;
      serial = serials[ownerId] | 0;
    }

    const id = Math.max(1, this._nextDivisionId | 0);
    this._nextDivisionId = id + 1;

    const div = {
      id,
      entityKind: "division",
      owner: ownerId,
      type: spec.id,
      name: divisionName(serial, spec),
      x: spawn.x | 0,
      y: spawn.y | 0,
      px: (spawn.x | 0) + 0.5,
      py: (spawn.y | 0) + 0.5,
      infantry: Math.max(1, spec.maxInfantry | 0),
      maxInfantry: Math.max(1, spec.maxInfantry | 0),
      supply: 100,
      experienceDays: 0,
      mobility: Math.max(0.1, Number(spec.mobility) || 1),
      attackRangeTiles: Math.max(1, Number(spec.attackRangeTiles) || 1),
      captureAcc: 0,
      moveAcc: 0,
      lastAttackedAt: -9999,
      sourceStructId: sourceStructIdRaw | 0,
      order: null
    };

    if (!Array.isArray(this.divisions)) this.divisions = [];
    this.divisions.push(div);
    this._markNationActivity?.(ownerId, 10);
    return div;
  };

  World.prototype.queueDivisionTraining = function(structIdRaw, ownerIdRaw = OWNER.PLAYER, typeRaw = "infantry", quantityRaw = 1) {
    if (!this._isDivisionsMode()) return { ok: false, reason: "Division training is only available in Divisions mode." };

    const structId = structIdRaw | 0;
    const ownerId = ownerIdRaw | 0;
    const quantity = Math.max(1, quantityRaw | 0);
    const st = this._structureById?.get?.(structId) || null;
    if (!st || String(st.type || "") !== "barracks") return { ok: false, reason: "Barracks not found." };
    if ((st.owner | 0) !== ownerId) return { ok: false, reason: "Barracks does not belong to that nation." };
    if (!this._isStructureOperational?.(st)) return { ok: false, reason: this._getStructureInactiveReason?.(st) || "Barracks unavailable." };

    const nation = this.nation?.[ownerId];
    if (!nation || !nation.alive) return { ok: false, reason: "Nation unavailable." };

    const spec = divisionSpec(typeRaw);
    const availableReserve = Math.max(0, Math.floor(Number(nation.infantry) || 0));
    const maxTrainable = Math.max(0, Math.floor(availableReserve / Math.max(1, spec.maxInfantry | 0)));
    if (maxTrainable <= 0) return { ok: false, reason: `Need ${spec.maxInfantry} reserve infantry per division.` };

    const queueCount = Math.max(1, Math.min(quantity, maxTrainable));
    nation.infantry = Math.max(0, (Number(nation.infantry) || 0) - (queueCount * spec.maxInfantry));

    const training = this._ensureBarracksDivisionTraining(st);
    for (let i = 0; i < queueCount; i++) {
      training.queue.push({
        type: spec.id,
        totalS: Math.max(1, Number(spec.trainTimeS) || 1),
        remainingS: Math.max(1, Number(spec.trainTimeS) || 1)
      });
    }
    this._markNationActivity?.(ownerId, 8);

    if (ownerId === OWNER.PLAYER) {
      const noun = queueCount === 1 ? "division" : "divisions";
      this._pushEvent(`${queueCount} ${spec.name} ${noun} queued at Barracks.`);
    }

    return {
      ok: true,
      queued: queueCount,
      reason: "",
      status: this.getBarracksDivisionStatus(structId, ownerId)
    };
  };

  World.prototype.issueDivisionOrder = function(divisionIdRaw, ownerIdRaw = OWNER.PLAYER, indicesRaw = []) {
    if (!this._isDivisionsMode()) return { ok: false, reason: "Division orders are only available in Divisions mode." };

    const divisionId = divisionIdRaw | 0;
    const ownerId = ownerIdRaw | 0;
    const div = this.getDivisionById(divisionId);
    if (!div) return { ok: false, reason: "Division not found." };
    if ((div.owner | 0) !== ownerId) return { ok: false, reason: "Division does not belong to that nation." };

    const src = Array.isArray(indicesRaw) ? indicesRaw : [];
    const next = [];
    const seen = new Set();
    for (let i = 0; i < src.length; i++) {
      const idx = src[i] | 0;
      if (seen.has(idx)) continue;
      if (!this._isGameplayLand(idx)) continue;
      seen.add(idx);
      next.push(idx);
    }
    if (next.length <= 0) return { ok: false, reason: "Paint a land area for the division order." };

    const center = orderCenterFromIndices(next, this.w | 0);
    let aggressive = false;
    let hasStagingCell = false;
    let hasAttackableHostile = false;
    let blockedHostileOwner = 0;
    for (let i = 0; i < next.length; i++) {
      const idx = next[i] | 0;
      const owner = this.owner[idx] | 0;
      if (owner === ownerId || owner === OWNER.NONE) {
        hasStagingCell = true;
        continue;
      }
      aggressive = true;
      if (this._divisionCanAttackOwner(div, owner)) {
        hasAttackableHostile = true;
      } else if (!(blockedHostileOwner > 0)) {
        blockedHostileOwner = owner;
      }
    }
    if (aggressive && !hasStagingCell && !hasAttackableHostile && (blockedHostileOwner > OWNER.NONE)) {
      const rel = this.getRelation?.(ownerId, blockedHostileOwner) || null;
      return {
        ok: false,
        reason: rel?.atWar
          ? "Ceasefire is active on that border. Wait or paint a staging area on your side."
          : "Declare war first, or paint a staging area on your side of the border."
      };
    }
    div.order = {
      indices: next,
      lookup: new Set(next),
      centerX: Number(center.x) || 0,
      centerY: Number(center.y) || 0,
      aggressive,
      createdAt: Number(this.time) || 0
    };
    this._markNationActivity?.(ownerId, 10);
    return { ok: true, reason: "", division: div };
  };

  World.prototype.clearDivisionOrder = function(divisionIdRaw, ownerIdRaw = OWNER.PLAYER) {
    const div = this.getDivisionById(divisionIdRaw);
    const ownerId = ownerIdRaw | 0;
    if (!div) return { ok: false, reason: "Division not found." };
    if ((div.owner | 0) !== ownerId) return { ok: false, reason: "Division does not belong to that nation." };
    div.order = null;
    return { ok: true, reason: "", division: div };
  };

  World.prototype._tickDivisionTraining = function(dtRaw) {
    if (!this._isDivisionsMode()) return;
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;
    const structures = Array.isArray(this.structures) ? this.structures : [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st || String(st.type || "") !== "barracks") continue;
      const training = st?.data?.divisionTraining;
      const queue = Array.isArray(training?.queue) ? training.queue : null;
      if (!queue || queue.length <= 0) continue;
      if (!this._isStructureOperational?.(st)) continue;

      const current = queue[0];
      current.remainingS = Math.max(0, (Number(current.remainingS) || 0) - dt);
      if ((Number(current.remainingS) || 0) > 0.00001) continue;

      const spawned = this._spawnDivision(st.owner | 0, current.type, st.x | 0, st.y | 0, st.id | 0);
      queue.shift();
      if (spawned && (st.owner | 0) === OWNER.PLAYER) {
        this._pushEvent(`${spawned.name} has deployed from Barracks.`);
      }
    }
  };

  World.prototype._divisionSupplyFactor = function(div) {
    return 0.35 + (clamp01((Number(div?.supply) || 0) / 100) * 0.65);
  };

  World.prototype._divisionExperienceFactor = function(div) {
    const days = Math.max(0, Number(div?.experienceDays) || 0);
    return 1 + Math.min(0.28, days * 0.0045);
  };

  World.prototype._divisionCombatPowerPerS = function(div) {
    const infantry = Math.max(0, Number(div?.infantry) || 0);
    if (!(infantry > 0)) return 0;
    const spec = divisionSpec(div?.type);
    return infantry
      * 0.022
      * (Number(spec.combatPowerMul) || 1)
      * this._divisionSupplyFactor(div)
      * this._divisionExperienceFactor(div);
  };

  World.prototype._divisionCanRecoverSupply = function(div) {
    const x = Math.round(Number(div?.px) - 0.5);
    const y = Math.round(Number(div?.py) - 0.5);
    if (x < 0 || y < 0 || x >= (this.w | 0) || y >= (this.h | 0)) return false;
    const idx = y * (this.w | 0) + x;
    if ((this.owner[idx] | 0) === (div.owner | 0)) return true;
    return !!this._touchesOwner4?.(idx, div.owner | 0);
  };

  World.prototype._divisionCanAttackOwner = function(div, ownerIdRaw) {
    const ownerId = ownerIdRaw | 0;
    const selfOwner = div?.owner | 0;
    if (ownerId <= OWNER.NONE || ownerId === selfOwner) return false;
    const rel = this.getRelation?.(selfOwner, ownerId) || null;
    if (!rel?.atWar || rel?.ceasefire || rel?.allied) return false;
    return true;
  };

  World.prototype._divisionCanOccupyIdx = function(div, idxRaw) {
    const idx = idxRaw | 0;
    if (!this._isGameplayLand(idx)) return false;
    const owner = this.owner[idx] | 0;
    return owner === OWNER.NONE || owner === (div?.owner | 0);
  };

  World.prototype._divisionCellIdx = function(div) {
    const w = this.w | 0;
    const h = this.h | 0;
    const px = Number(div?.px);
    const py = Number(div?.py);
    const x = Math.max(0, Math.min(w - 1, Math.round((Number.isFinite(px) ? px : ((Number(div?.x) || 0) + 0.5)) - 0.5)));
    const y = Math.max(0, Math.min(h - 1, Math.round((Number.isFinite(py) ? py : ((Number(div?.y) || 0) + 0.5)) - 0.5)));
    return (y * w + x) | 0;
  };

  World.prototype._divisionBestFiringCellForTarget = function(div, targetXRaw, targetYRaw) {
    const targetX = Number(targetXRaw);
    const targetY = Number(targetYRaw);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;

    const w = this.w | 0;
    const h = this.h | 0;
    const range = Math.max(1, Number(div?.attackRangeTiles) || 1);
    const rangeSq = range * range;
    const px = Number(div?.px) || ((Number(div?.x) || 0) + 0.5);
    const py = Number(div?.py) || ((Number(div?.y) || 0) + 0.5);
    const minX = Math.max(0, Math.floor(targetX - range - 1));
    const maxX = Math.min(w - 1, Math.ceil(targetX + range + 1));
    const minY = Math.max(0, Math.floor(targetY - range - 1));
    const maxY = Math.min(h - 1, Math.ceil(targetY + range + 1));

    let best = null;
    let bestScore = Infinity;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * w + x) | 0;
        if (!this._divisionCanOccupyIdx(div, idx)) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (sqDist(cx, cy, targetX, targetY) > (rangeSq + 0.0001)) continue;
        const owner = this.owner[idx] | 0;
        const score = sqDist(px, py, cx, cy) + (owner === OWNER.NONE ? 0.18 : 0);
        if (score >= bestScore) continue;
        bestScore = score;
        best = { x, y };
      }
    }

    return best;
  };

  World.prototype._divisionSelectHostileDivisionTarget = function(div) {
    const list = Array.isArray(this.divisions) ? this.divisions : [];
    if (!list.length || !(Number(div?.infantry) > 0)) return null;

    const orderLookup = this._divisionOrderLookup(div?.order);
    const range = Math.max(1, Number(div?.attackRangeTiles) || 1);
    const rangeSq = range * range;
    const px = Number(div?.px) || ((Number(div?.x) || 0) + 0.5);
    const py = Number(div?.py) || ((Number(div?.y) || 0) + 0.5);

    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < list.length; i++) {
      const enemy = list[i];
      if (!enemy || enemy === div || !(Number(enemy.infantry) > 0)) continue;
      if ((enemy.owner | 0) === (div.owner | 0)) continue;
      if (!this._divisionCanAttackOwner(div, enemy.owner | 0)) continue;

      const ex = Number(enemy.px) || ((Number(enemy.x) || 0) + 0.5);
      const ey = Number(enemy.py) || ((Number(enemy.y) || 0) + 0.5);
      const d2 = sqDist(px, py, ex, ey);
      const enemyIdx = this._divisionCellIdx(enemy);
      const inRange = d2 <= (rangeSq + 0.0001);
      const inOrder = !!orderLookup?.has?.(enemyIdx);
      if (!inRange && !inOrder) continue;

      const goal = this._divisionBestFiringCellForTarget(div, ex, ey);
      if (!goal && !inRange) continue;
      const goalD2 = goal ? sqDist(px, py, goal.x + 0.5, goal.y + 0.5) : 0;
      const score = goalD2 + (d2 * 0.18) + (inRange ? -1000 : 0) + (inOrder ? -180 : 0);
      if (score >= bestScore) continue;
      bestScore = score;
      best = { enemy, enemyIdx, inRange, inOrder, goal };
    }

    return best;
  };

  World.prototype._divisionOrderNeedsRefresh = function(div) {
    const order = div?.order;
    if (!order || typeof order !== "object") return true;
    const indices = Array.isArray(order.indices) ? order.indices : [];
    if (indices.length <= 0) return true;

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i] | 0;
      if (!this._isGameplayLand(idx)) continue;
      const owner = this.owner[idx] | 0;
      if (owner === (div.owner | 0)) continue;
      if (owner === OWNER.NONE) return false;
      if (this._divisionCanAttackOwner(div, owner)) return false;
    }

    return !this._divisionSelectHostileDivisionTarget(div);
  };

  World.prototype._divisionFrontlineStageForTarget = function(div, targetIdxRaw) {
    const idx = targetIdxRaw | 0;
    if (!this._isGameplayLand(idx)) return null;
    const targetOwner = this.owner[idx] | 0;
    if (!this._divisionCanAttackOwner(div, targetOwner)) return null;

    const w = this.w | 0;
    const x = idx % w;
    const y = (idx / w) | 0;
    const rangedCell = this._divisionBestFiringCellForTarget(div, x + 0.5, y + 0.5);
    if (rangedCell) return rangedCell;
    const px = Number(div?.px) || ((Number(div?.x) || 0) + 0.5);
    const py = Number(div?.py) || ((Number(div?.y) || 0) + 0.5);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < neighbors.length; i++) {
      const nx = neighbors[i][0];
      const ny = neighbors[i][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= (this.h | 0)) continue;
      const ni = ny * w + nx;
      if (!this._divisionCanOccupyIdx(div, ni)) continue;
      const cellOwner = this.owner[ni] | 0;
      const score = sqDist(px, py, nx + 0.5, ny + 0.5) + (cellOwner === OWNER.NONE ? 0.12 : 0);
      if (score >= bestScore) continue;
      bestScore = score;
      best = { x: nx, y: ny };
    }
    return best;
  };

  World.prototype._tickDivisionSustainment = function(div, dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    const ownerId = div.owner | 0;
    const nation = this.nation?.[ownerId];
    if (!nation || !nation.alive) return;

    div.experienceDays = Math.max(0, Number(div.experienceDays) || 0) + (dt / 12);

    if (this._divisionCanRecoverSupply(div)) {
      div.supply = Math.min(100, (Number(div.supply) || 0) + (dt * 12));
      const spec = divisionSpec(div.type);
      const missing = Math.max(0, (Number(div.maxInfantry) || 0) - (Number(div.infantry) || 0));
      if (missing > 0) {
        const reserve = Math.max(0, Number(nation.infantry) || 0);
        const refill = Math.min(missing, reserve, dt * (Number(spec.reinforcePerS) || 0));
        if (refill > 0) {
          nation.infantry = Math.max(0, reserve - refill);
          div.infantry = Math.min(Number(div.maxInfantry) || 0, (Number(div.infantry) || 0) + refill);
        }
      }
      return;
    }

    div.supply = Math.max(0, (Number(div.supply) || 0) - (dt * (div.order ? 2.4 : 0.9)));
  };

  World.prototype._divisionFindGoalCell = function(div) {
    const order = div?.order;
    if (!order || typeof order !== "object") return null;
    const indices = Array.isArray(order.indices) ? order.indices : [];
    if (!indices.length) return null;

    const hostileDivTarget = this._divisionSelectHostileDivisionTarget(div);
    if (hostileDivTarget?.goal) return hostileDivTarget.goal;
    if (hostileDivTarget?.enemyIdx >= 0) {
      const stage = this._divisionFrontlineStageForTarget(div, hostileDivTarget.enemyIdx);
      if (stage) return stage;
    }

    let bestFrontline = null;
    let bestFrontlineD = Infinity;
    let bestNeutral = null;
    let bestNeutralD = Infinity;
    let bestAny = null;
    let bestAnyD = Infinity;
    const px = Number(div.px) || ((Number(div.x) || 0) + 0.5);
    const py = Number(div.py) || ((Number(div.y) || 0) + 0.5);

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i] | 0;
      if (!this._isGameplayLand(idx)) continue;
      const x = (idx % (this.w | 0)) + 0.5;
      const y = ((idx / (this.w | 0)) | 0) + 0.5;
      const d2 = sqDist(px, py, x, y);
      const owner = this.owner[idx] | 0;
      if ((owner === OWNER.NONE || owner === (div.owner | 0)) && d2 < bestAnyD) {
        bestAnyD = d2;
        bestAny = { x: idx % (this.w | 0), y: (idx / (this.w | 0)) | 0 };
      }
      if (owner === OWNER.NONE && d2 < bestNeutralD) {
        bestNeutralD = d2;
        bestNeutral = { x: idx % (this.w | 0), y: (idx / (this.w | 0)) | 0 };
        continue;
      }
      if (owner <= OWNER.NONE || owner === (div.owner | 0)) continue;
      const stage = this._divisionFrontlineStageForTarget(div, idx);
      if (!stage) continue;
      const stageD2 = sqDist(px, py, stage.x + 0.5, stage.y + 0.5);
      if (stageD2 < bestFrontlineD) {
        bestFrontlineD = stageD2;
        bestFrontline = stage;
      }
    }

    if (bestFrontline) return bestFrontline;
    if (bestNeutral) return bestNeutral;
    if (bestAny) return bestAny;
    return {
      x: Math.max(0, Math.min((this.w | 0) - 1, Math.round((Number(order.centerX) || 0) - 0.5))),
      y: Math.max(0, Math.min((this.h | 0) - 1, Math.round((Number(order.centerY) || 0) - 0.5)))
    };
  };

  World.prototype._stepDivisionTowardGoal = function(div, dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    const goal = this._divisionFindGoalCell(div);
    if (!goal) return;

    const spec = divisionSpec(div.type);
    const speed = Math.max(0.1, Number(spec.moveTilesPerS) || 0.1)
      * Math.max(0.2, Number(div.mobility) || 1)
      * this._divisionSupplyFactor(div);
    let px = Number(div.px);
    let py = Number(div.py);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      px = (Number(div.x) || 0) + 0.5;
      py = (Number(div.y) || 0) + 0.5;
    }

    const cx = Math.max(0, Math.min((this.w | 0) - 1, Math.round(px - 0.5)));
    const cy = Math.max(0, Math.min((this.h | 0) - 1, Math.round(py - 0.5)));
    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [1, -1], [-1, 1], [1, 1]
    ];

    let nextCell = { x: cx, y: cy };
    if (cx !== (goal.x | 0) || cy !== (goal.y | 0)) {
      let bestScore = sqDist(cx + 0.5, cy + 0.5, (goal.x | 0) + 0.5, (goal.y | 0) + 0.5);
      for (let i = 0; i < neighbors.length; i++) {
        const nx = cx + neighbors[i][0];
        const ny = cy + neighbors[i][1];
        if (nx < 0 || ny < 0 || nx >= (this.w | 0) || ny >= (this.h | 0)) continue;
        const idx = ny * (this.w | 0) + nx;
        if (!this._divisionCanOccupyIdx(div, idx)) continue;
        const owner = this.owner[idx] | 0;
        const score = sqDist(nx + 0.5, ny + 0.5, (goal.x | 0) + 0.5, (goal.y | 0) + 0.5)
          + (owner === OWNER.NONE ? 0.06 : 0);
        if (score >= bestScore - 0.0001) continue;
        bestScore = score;
        nextCell = { x: nx, y: ny };
      }
    }

    const targetPx = nextCell.x + 0.5;
    const targetPy = nextCell.y + 0.5;
    const dx = targetPx - px;
    const dy = targetPy - py;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 0.0001)) {
      div.x = cx | 0;
      div.y = cy | 0;
      div.px = px;
      div.py = py;
      return;
    }

    const travel = Math.min(dist, speed * dt);
    div.px = px + ((dx / dist) * travel);
    div.py = py + ((dy / dist) * travel);
    div.x = Math.max(0, Math.min((this.w | 0) - 1, Math.round(div.px - 0.5)));
    div.y = Math.max(0, Math.min((this.h | 0) - 1, Math.round(div.py - 0.5)));
  };

  World.prototype._divisionSelectCaptureTarget = function(div) {
    const order = div?.order;
    if (!order || typeof order !== "object") return null;
    const lookup = this._divisionOrderLookup(order);
    if (!lookup || lookup.size <= 0) return null;

    const range = Math.max(1, Number(div.attackRangeTiles) || 1);
    const rangeSq = range * range;
    const px = Number(div.px) || ((Number(div.x) || 0) + 0.5);
    const py = Number(div.py) || ((Number(div.y) || 0) + 0.5);

    const orderCx = Number(order.centerX) || px;
    const orderCy = Number(order.centerY) || py;
    let best = null;
    let bestScore = Infinity;

    for (const idx0 of lookup.values()) {
      const idx = idx0 | 0;
      if (!this._isGameplayLand(idx)) continue;
      const owner = this.owner[idx] | 0;
      if (owner === (div.owner | 0)) continue;
      if (owner > OWNER.NONE) {
        if (!this._divisionCanAttackOwner(div, owner)) continue;
        if (!this._touchesOwner4?.(idx, div.owner | 0)) continue;
      }
      const tx = (idx % (this.w | 0)) + 0.5;
      const ty = ((idx / (this.w | 0)) | 0) + 0.5;
      const d2 = sqDist(px, py, tx, ty);
      if (d2 > rangeSq) continue;
      const centerD2 = sqDist(orderCx, orderCy, tx, ty);
      const score = d2 + (centerD2 * 0.22) + (owner === OWNER.NONE ? 18 : 0);
      if (score >= bestScore) continue;
      bestScore = score;
      best = { idx, owner };
    }

    return best;
  };

  World.prototype._tickDivisionTileCapture = function(div, dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0) || !div?.order) return;
    const spec = divisionSpec(div.type);
    div.captureAcc = Math.max(0, Number(div.captureAcc) || 0)
      + (this._divisionCombatPowerPerS(div) * dt * (div.order?.aggressive ? 1.42 : 1.08));

    let flips = 0;
    const flipCap = 3;
    while (flips < flipCap) {
      const target = this._divisionSelectCaptureTarget(div);
      if (!(target?.idx >= 0)) break;

      const idx = target.idx | 0;
      const owner = target.owner | 0;
      const baseCost = owner === OWNER.NONE
        ? Math.max(1, Number(spec.captureCostNeutral) || 1)
        : Math.max(1, Number(spec.captureCostEnemy) || 1);
      const defendingDivision = this.getDivisionAt(idx % (this.w | 0), (idx / (this.w | 0)) | 0, 0.95);
      const defenderPenalty = defendingDivision && ((defendingDivision.owner | 0) !== (div.owner | 0))
        ? 1.45
        : 1;
      const captureCost = baseCost * defenderPenalty;
      if ((Number(div.captureAcc) || 0) < captureCost) break;

      div.captureAcc = Math.max(0, (Number(div.captureAcc) || 0) - captureCost);
      this._setOwner(idx, div.owner | 0);
      flips++;
    }
  };

  World.prototype._tickDivisionEngagements = function(dtRaw) {
    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;
    const list = Array.isArray(this.divisions) ? this.divisions : [];
    if (list.length <= 1) return;

    const losses = new Float32Array(list.length);

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !this.nation?.[a.owner | 0]?.alive || !(Number(a.infantry) > 0)) continue;
      const aRange = Math.max(1, Number(a.attackRangeTiles) || 1);
      const ax = Number(a.px) || ((Number(a.x) || 0) + 0.5);
      const ay = Number(a.py) || ((Number(a.y) || 0) + 0.5);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b || (b.owner | 0) === (a.owner | 0) || !this.nation?.[b.owner | 0]?.alive || !(Number(b.infantry) > 0)) continue;
        const rel = this.getRelation?.(a.owner | 0, b.owner | 0) || null;
        if (!rel?.atWar || rel?.ceasefire || rel?.allied) continue;
        const bRange = Math.max(1, Number(b.attackRangeTiles) || 1);
        const bx = Number(b.px) || ((Number(b.x) || 0) + 0.5);
        const by = Number(b.py) || ((Number(b.y) || 0) + 0.5);
        const d2 = sqDist(ax, ay, bx, by);
        const aCanFire = d2 <= ((aRange * aRange) + 0.0001);
        const bCanFire = d2 <= ((bRange * bRange) + 0.0001);
        if (!aCanFire && !bCanFire) continue;

        const bIdx = this._divisionCellIdx(b);
        const aIdx = this._divisionCellIdx(a);
        if (aCanFire) {
          const aBonus = this._divisionOrderIncludes(a, bIdx) ? 1.22 : 1;
          losses[j] += this._divisionCombatPowerPerS(a) * dt * 1.12 * aBonus;
        }
        if (bCanFire) {
          const bBonus = this._divisionOrderIncludes(b, aIdx) ? 1.22 : 1;
          losses[i] += this._divisionCombatPowerPerS(b) * dt * 1.12 * bBonus;
        }
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const div = list[i];
      if (!div) continue;
      const loss = Math.max(0, Number(losses[i]) || 0);
      if (loss > 0) {
        div.infantry = Math.max(0, (Number(div.infantry) || 0) - loss);
        div.supply = Math.max(0, (Number(div.supply) || 0) - (loss * 0.18));
        div.lastAttackedAt = Number(this.time) || 0;
      }
      if ((Number(div.infantry) || 0) > 0) continue;
      if ((div.owner | 0) === OWNER.PLAYER) {
        this._pushEvent(`${String(div.name || "A division")} was destroyed.`);
      }
      list.splice(i, 1);
    }
  };

  World.prototype._tickDivisions = function(dtRaw) {
    if (!this._isDivisionsMode()) return;

    const dt = Math.max(0, Number(dtRaw) || 0);
    if (!(dt > 0)) return;

    this._tickDivisionTraining(dt);

    const list = Array.isArray(this.divisions) ? this.divisions : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const div = list[i];
      const ownerId = div?.owner | 0;
      if (!div || !this.nation?.[ownerId]?.alive) {
        list.splice(i, 1);
        continue;
      }

      this._tickDivisionSustainment(div, dt);
      if (div.order) this._stepDivisionTowardGoal(div, dt);
      this._tickDivisionTileCapture(div, dt);
    }

    this._tickDivisionEngagements(dt);
  };

  const originalTickWarfront = World.prototype._tickWarfront;
  World.prototype._tickWarfront = function(...args) {
    if (this._isDivisionsMode()) return;
    return originalTickWarfront.apply(this, args);
  };

  World.prototype._divisionBorderTargets = function(ownerIdRaw) {
    const ownerId = ownerIdRaw | 0;
    const border = this._borderTilesByOwner?.[ownerId];
    if (!border || border.length <= 0) return { neutral: [], enemyByOwner: new Map() };
    const w = this.w | 0;
    const h = this.h | 0;
    const neutral = [];
    const neutralSeen = new Set();
    const enemyByOwner = new Map();
    const seenByOwner = new Map();
    for (let i = 0; i < border.length; i++) {
      const idx = border[i] | 0;
      const x = idx % w;
      const y = (idx / w) | 0;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ];
      for (let j = 0; j < neighbors.length; j++) {
        const nx = neighbors[j][0];
        const ny = neighbors[j][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!this._isGameplayLand(ni)) continue;
        const owner = this.owner[ni] | 0;
        if (owner === OWNER.NONE) {
          if (neutralSeen.has(ni)) continue;
          neutralSeen.add(ni);
          neutral.push(ni);
          continue;
        }
        if (owner <= OWNER.NONE || owner === ownerId) continue;
        let arr = enemyByOwner.get(owner);
        let seen = seenByOwner.get(owner);
        if (!arr) {
          arr = [];
          seen = new Set();
          enemyByOwner.set(owner, arr);
          seenByOwner.set(owner, seen);
        }
        if (seen.has(ni)) continue;
        seen.add(ni);
        arr.push(ni);
      }
    }
    return { neutral, enemyByOwner };
  };

  World.prototype._sampleDivisionOrderArea = function(seedIndicesRaw, ownerFilterRaw = null, limitRaw = 42) {
    const seedIndices = Array.isArray(seedIndicesRaw) ? seedIndicesRaw : [];
    if (seedIndices.length <= 0) return [];
    const limit = Math.max(12, limitRaw | 0);
    const wantOwner = ownerFilterRaw == null ? null : (ownerFilterRaw | 0);
    const w = this.w | 0;
    const q = [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < seedIndices.length; i++) {
      const idx = seedIndices[i] | 0;
      if (!this._isGameplayLand(idx) || seen.has(idx)) continue;
      if (wantOwner != null && (this.owner[idx] | 0) !== wantOwner) continue;
      seen.add(idx);
      q.push(idx);
      if (q.length >= 6) break;
    }
    while (q.length > 0 && out.length < limit) {
      const idx = q.shift() | 0;
      out.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ];
      for (let i = 0; i < neighbors.length; i++) {
        const nx = neighbors[i][0];
        const ny = neighbors[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= (this.h | 0)) continue;
        const ni = ny * w + nx;
        if (!this._isGameplayLand(ni) || seen.has(ni)) continue;
        if (wantOwner != null && (this.owner[ni] | 0) !== wantOwner) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    return out;
  };

  World.prototype._queueDivisionAiTraining = function(ownerIdRaw) {
    const ownerId = ownerIdRaw | 0;
    if ((Number(this._divisionAiTrainCooldownUntil?.[ownerId]) || 0) > (Number(this.time) || 0)) return;
    const nation = this.nation?.[ownerId];
    if (!nation || !nation.alive) return;

    const barracks = [];
    const structures = Array.isArray(this.structures) ? this.structures : [];
    for (let i = 0; i < structures.length; i++) {
      const st = structures[i];
      if (!st || (st.owner | 0) !== ownerId || String(st.type || "") !== "barracks") continue;
      if (!this._isStructureOperational?.(st)) continue;
      barracks.push(st);
    }
    if (!barracks.length) return;

    let queued = 0;
    for (let i = 0; i < barracks.length; i++) {
      queued += Math.max(0, barracks[i]?.data?.divisionTraining?.queue?.length | 0);
    }
    let activeDivisions = 0;
    const list = Array.isArray(this.divisions) ? this.divisions : [];
    for (let i = 0; i < list.length; i++) {
      if ((list[i]?.owner | 0) === ownerId) activeDivisions++;
    }
    const desired = Math.max(1, Math.min(12, Math.round((barracks.length * 1.8) + ((this.landOwnedCount?.[ownerId] || 0) / 2200))));
    if ((activeDivisions + queued) >= desired) return;

    const pick = barracks[(this._rng() * barracks.length) | 0];
    const res = this.queueDivisionTraining(pick.id | 0, ownerId, "infantry", 1);
    if (res?.ok) {
      this._divisionAiTrainCooldownUntil[ownerId] = (Number(this.time) || 0) + (14 + this._rng() * 10);
    }
  };

  World.prototype._issueDivisionAiOrders = function(ownerIdRaw) {
    const ownerId = ownerIdRaw | 0;
    if ((Number(this._divisionAiOrderCooldownUntil?.[ownerId]) || 0) > (Number(this.time) || 0)) return;

    const list = Array.isArray(this.divisions) ? this.divisions : [];
    const idle = [];
    for (let i = 0; i < list.length; i++) {
      const div = list[i];
      if (!div || (div.owner | 0) !== ownerId || !(Number(div.infantry) > 0)) continue;
      const hasUsableOrder = div.order && Array.isArray(div.order.indices) && div.order.indices.length > 0 && !this._divisionOrderNeedsRefresh(div);
      if (hasUsableOrder) continue;
      div.order = null;
      idle.push(div);
    }
    if (!idle.length) return;

    const borderTargets = this._divisionBorderTargets(ownerId);
    const wars = [];
    for (let id = 1; id <= (this._nationCount | 0); id++) {
      if (id === ownerId) continue;
      const rel = this.getRelation?.(ownerId, id);
      if (rel?.atWar && !rel?.ceasefire) wars.push(id);
    }

    for (let i = 0; i < idle.length; i++) {
      const div = idle[i];
      let orderArea = [];
      if (wars.length > 0) {
        let bestOwner = wars[0] | 0;
        let bestTiles = borderTargets.enemyByOwner.get(bestOwner) || [];
        for (let j = 1; j < wars.length; j++) {
          const enemyId = wars[j] | 0;
          const arr = borderTargets.enemyByOwner.get(enemyId) || [];
          if (arr.length > bestTiles.length) {
            bestOwner = enemyId;
            bestTiles = arr;
          }
        }
        orderArea = this._sampleDivisionOrderArea(bestTiles, bestOwner, 54);
      } else if (borderTargets.neutral.length > 0) {
        orderArea = this._sampleDivisionOrderArea(borderTargets.neutral, OWNER.NONE, 48);
      }

      if (orderArea.length <= 0) continue;
      this.issueDivisionOrder(div.id | 0, ownerId, orderArea);
    }

    this._divisionAiOrderCooldownUntil[ownerId] = (Number(this.time) || 0) + (8 + this._rng() * 8);
  };

  World.prototype._tickDivisionAI = function(_dtRaw) {
    if (!this._isDivisionsMode()) return;
    for (let id = 2; id <= (this._nationCount | 0); id++) {
      const nation = this.nation?.[id];
      if (!nation || !nation.alive) continue;
      this._queueDivisionAiTraining(id);
      this._issueDivisionAiOrders(id);
    }
  };

  const originalStartNeutral = World.prototype.startNeutral;
  World.prototype.startNeutral = function(indices, attackerId = OWNER.PLAYER, ...rest) {
    if (this._isDivisionsMode()) {
      const attacker = attackerId | 0;
      const arr = Array.isArray(indices) ? indices : Array.from(indices || []);
      let touchesFrontline = false;
      for (let i = 0; i < arr.length; i++) {
        const idx = arr[i] | 0;
        if ((this.owner[idx] | 0) !== OWNER.NONE) continue;
        if (this._touchesOwner4?.(idx, attacker)) {
          touchesFrontline = true;
          break;
        }
      }
      if (touchesFrontline) {
        return { ok: false, reason: "Divisions mode uses infantry divisions for land expansion. Overseas transport landings still work." };
      }
    }
    return originalStartNeutral.call(this, indices, attackerId, ...rest);
  };

  const originalStartWarFocus = World.prototype.startWarFocus;
  World.prototype.startWarFocus = function(attackerId, defenderId, indices, ...rest) {
    if (this._isDivisionsMode()) {
      const attacker = attackerId | 0;
      const defender = defenderId | 0;
      const arr = Array.isArray(indices) ? indices : Array.from(indices || []);
      let touchesFrontline = false;
      for (let i = 0; i < arr.length; i++) {
        const idx = arr[i] | 0;
        if ((this.owner[idx] | 0) !== defender) continue;
        if (this._touchesOwner4?.(idx, attacker)) {
          touchesFrontline = true;
          break;
        }
      }
      if (touchesFrontline) {
        return { ok: false, reason: "Divisions mode uses infantry divisions for frontline attacks. Overseas transport landings still work." };
      }
    }
    return originalStartWarFocus.call(this, attackerId, defenderId, indices, ...rest);
  };

  const originalStartBurstExpand = World.prototype.startBurstExpand;
  World.prototype.startBurstExpand = function(...args) {
    if (this._isDivisionsMode()) {
      return { ok: false, reason: "Divisions mode disables burst expansion." };
    }
    return originalStartBurstExpand.apply(this, args);
  };

  const originalStartBurstAttack = World.prototype.startBurstAttack;
  World.prototype.startBurstAttack = function(...args) {
    if (this._isDivisionsMode()) {
      return { ok: false, reason: "Divisions mode uses division orders instead of burst attacks." };
    }
    return originalStartBurstAttack.apply(this, args);
  };

  const originalStartAirbaseTransportBuild = World.prototype.startAirbaseTransportBuild;
  World.prototype.startAirbaseTransportBuild = function(...args) {
    if (this._isDivisionsMode()) {
      return { ok: false, reason: "Divisions mode disables transport plane land grabs. Use infantry divisions instead." };
    }
    return originalStartAirbaseTransportBuild.apply(this, args);
  };

  const originalLaunchAirbaseTransport = World.prototype.launchAirbaseTransport;
  World.prototype.launchAirbaseTransport = function(...args) {
    if (this._isDivisionsMode()) {
      return { ok: false, reason: "Divisions mode disables transport plane land grabs. Use infantry divisions instead." };
    }
    return originalLaunchAirbaseTransport.apply(this, args);
  };

  const originalOnStructureOwnerChanged = World.prototype._onStructureOwnerChanged;
  World.prototype._onStructureOwnerChanged = function(st, oldOwner, newOwner) {
    if (String(st?.type || "") === "barracks" && st?.data?.divisionTraining) {
      st.data.divisionTraining = { queue: [] };
    }
    return originalOnStructureOwnerChanged.call(this, st, oldOwner, newOwner);
  };

  const originalOnStructureRemoved = World.prototype._onStructureRemoved;
  World.prototype._onStructureRemoved = function(st) {
    if (String(st?.type || "") === "barracks" && st?.data?.divisionTraining) {
      st.data.divisionTraining = { queue: [] };
    }
    return originalOnStructureRemoved.call(this, st);
  };
}
