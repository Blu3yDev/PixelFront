// FILE: src/game/systems/war.js

import {
  ATTACK_COMMIT_MAX,
  ATTACK_COMMIT_MIN,
  BURST_CAPTURE_K,
  BURST_EXPAND_GOLD_PER_TILE,
  BURST_EXPAND_INFANTRY_PER_TILE,
  BURST_MAX_FLIPS_PER_TICK,
  BURST_NEUTRAL_WORK_MUL,
  BURST_CARRY_CAP,
  CAPITAL_DEFENCE_BONUS,
  CAPITAL_DEFENCE_RADIUS_TILES,
  DEFENCE_POST_MAX_BONUS,
  DEFENCE_POST_RADIUS_TILES,
  DEFENCE_POST_STACK_K,
  EXPAND_INFANTRY_RESERVE_FRAC,
  EXPAND_INFANTRY_RESERVE_MIN,
  EXPAND_TILE_COST_BY_BIOME,
  EXPAND_TILE_COST_GLOBAL_MUL,
  NEUTRAL_WORK_RATE,
  OP_CAPTURE_K,
  OP_MAX_FLIPS_PER_TICK,
  OP_CARRY_CAP,
  OWNER,
  WAR_CAPTURE_CASUALTIES_ATTACKER,
  WAR_CAPTURE_CASUALTIES_DEFENDER,
  WAR_CAPTURE_ATTACK_FLOOR,
  WAR_ENGAGE_TROOPS_PER_CONTACT,
  WAR_FIRE_K,
  WAR_GOLD_PER_CAPTURE_TILE,
  WAR_GOLD_PER_CONTACT_S,
  WAR_MAX_FLIPS_PER_STEP,
  WAR_EXHAUSTION_GRACE_S,
  WAR_EXHAUSTION_GAIN_PER_S,
  WAR_EXHAUSTION_MULTI_WAR_GAIN_BONUS,
  WAR_EXHAUSTION_PAUSE_RECOVER_PER_S,
  WAR_EXHAUSTION_PEACE_RECOVER_PER_S,
  WAR_EXHAUSTION_RAMP_S,
  WAR_EXHAUSTION_STABILITY_MAX_PENALTY,
  WAR_EXHAUSTION_WARTIME_DECAY_PER_S,
  WAR_MIN_INF_TO_ADVANCE,
  WAR_PASSIVE_PLAYER_DEFENCE_MUL,
  WAR_PASSIVE_PLAYER_FLIP_DAMP,
  WAR_POWER_SATURATION,
  WAR_STABILITY_BASE_WAR_PENALTY,
  WAR_SUPERIORITY_EXP,
  WAR_SUPERIORITY_MUL_MAX,
  WAR_SUPERIORITY_MUL_MIN,
  WAR_MIN_STABILITY,
  WAR_OCCUPY_TROOPS_PER_TILE,
  WAR_STEP_S,
  WAR_STABILITY_LOSS_MUL_MAX,
  WAR_STABILITY_LOSS_MUL_MIN,
  WORLD_PACE_BASE_TILES_PER_NATION,
  WORLD_PACE_MAX_MUL,
  WORLD_PACE_MIN_MUL,
  attackCommitFromRatio
} from "../config.js";
import { clamp01, clampInt, lerp } from "../utils.js";

function sampleSetEntries(set, rng, maxSamples, maxScan) {
  if (!set || set.size === 0) return [];

  const take = Math.max(1, maxSamples | 0);
  const scanCap = Math.min(set.size, Math.max(take, maxScan | 0));
  const out = [];

  let it = set.values();
  const skip = (rng() * set.size) | 0;
  for (let i = 0; i < skip; i++) {
    const n = it.next();
    if (n.done) {
      it = set.values();
      break;
    }
  }

  let scanned = 0;
  let seen = 0;
  while (scanned < scanCap) {
    let n = it.next();
    if (n.done) {
      it = set.values();
      n = it.next();
      if (n.done) break;
    }

    const idx = n.value | 0;
    scanned++;
    seen++;

    if (out.length < take) {
      out.push(idx);
      continue;
    }

    const j = (rng() * seen) | 0;
    if (j < take) out[j] = idx;
  }

  return out;
}

function commitFraction(nation) {
  const ratioRaw = Number(nation?.attackRatio);
  if (Number.isFinite(ratioRaw)) {
    return attackCommitFromRatio(clamp01(ratioRaw));
  }

  const raw = Number(nation?.aggression ?? nation?.attackCommit);
  if (Number.isFinite(raw)) {
    return Math.max(ATTACK_COMMIT_MIN, Math.min(ATTACK_COMMIT_MAX, clamp01(raw)));
  }

  return attackCommitFromRatio(0.20);
}

function shouldRunOpMaintenance(op, now, intervalS) {
  const base = Math.max(0.08, Number(intervalS) || 0.25);
  const prevBase = Number(op?._maintBaseS);
  let every = Number(op?._maintEveryS);
  if (!Number.isFinite(every) || every <= 0 || !Number.isFinite(prevBase) || Math.abs(prevBase - base) > 1e-6) {
    const seed =
      ((((op?.id | 0) * 1103515245) ^
      (((op?.attacker | 0) * 2654435761) >>> 0) ^
      (((op?.defender | 0) * 1597334677) >>> 0)) >>> 0);
    const jitter = ((seed % 1000) / 999) - 0.5; // [-0.5, +0.5]
    every = Math.max(0.08, base * (1 + jitter * 0.40)); // [0.8x, 1.2x]
    op._maintBaseS = base;
    op._maintEveryS = every;
  }

  const nextAt = Number(op?._maintAt || 0);
  if (!Number.isFinite(nextAt) || now >= nextAt) {
    op._maintAt = now + every;
    return true;
  }
  return false;
}

function frontlineWidthMul(frontlineCount, baseline = 8) {
  const count = Math.max(1, Number(frontlineCount) || 1);
  const base = Math.max(1, Number(baseline) || 8);
  const m = Math.sqrt(count / base);
  // Narrow fronts are slower, wide fronts are faster, but keep bounded.
  return Math.max(0.72, Math.min(2.45, m));
}

export function installWar(World) {
  World.prototype._capitalSiegeReady = function(attackerId, defenderId, capIdx, overrun = 0) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    const idx = capIdx | 0;
    if (A <= 0 || D <= 0 || A === D || idx < 0) return false;
    if (!this.land[idx]) return false;
    if ((this.owner[idx] | 0) !== D) return false;

    const w = this.w | 0;
    const h = this.h | 0;
    const x = idx % w;
    const y = (idx / w) | 0;

    let atk4 = 0;
    if (x > 0 && this.land[idx - 1] && ((this.owner[idx - 1] | 0) === A)) atk4++;
    if (x + 1 < w && this.land[idx + 1] && ((this.owner[idx + 1] | 0) === A)) atk4++;
    if (y > 0 && this.land[idx - w] && ((this.owner[idx - w] | 0) === A)) atk4++;
    if (y + 1 < h && this.land[idx + w] && ((this.owner[idx + w] | 0) === A)) atk4++;

    let landLocal = 0;
    let atkLocal = 0;
    let defLocal = 0;
    const r = 2;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const ii = yy * w + xx;
        if (!this.land[ii]) continue;
        landLocal++;
        const o = this.owner[ii] | 0;
        if (o === A) atkLocal++;
        else if (o === D) defLocal++;
      }
    }

    const over = clamp01(Number(overrun) || 0);
    const minAtk4 = over >= 0.86 ? 1 : 2;
    if (atk4 < minAtk4) return false;

    const minAtkLocalStatic = Math.max(4, Math.ceil(9 - over * 4));
    if (atkLocal < minAtkLocalStatic) return false;

    const minAtkShare = Math.max(0.18, 0.34 - over * 0.14);
    if (atkLocal < Math.ceil(landLocal * minAtkShare)) return false;

    const maxDefMul = over >= 0.92 ? 2.0 : 1.4;
    if (defLocal > Math.ceil(atkLocal * maxDefMul)) return false;

    return true;
  };

  // Larger maps need a higher simulation pace so full-conquest games don't drag.
  World.prototype._worldPaceScale = function() {
    const n = Math.max(1, this._nationCount | 0);
    const tilesPerNation = (Math.max(1, this.w | 0) * Math.max(1, this.h | 0)) / n;
    const base = Math.max(1, Number(WORLD_PACE_BASE_TILES_PER_NATION) || 1);
    const ratio = Math.sqrt(Math.max(0.25, tilesPerNation / base));
    return Math.max(WORLD_PACE_MIN_MUL, Math.min(WORLD_PACE_MAX_MUL, ratio));
  };

  World.prototype._expandInfantryReserve = function(ownerId) {
    const A = ownerId | 0;
    const nat = this.nation[A];
    if (!nat) return 0;
    const inf = Math.max(0, Number(nat.infantry) || 0);
    return Math.max(EXPAND_INFANTRY_RESERVE_MIN, inf * EXPAND_INFANTRY_RESERVE_FRAC);
  };

  World.prototype._expandUsableInfantry = function(ownerId) {
    const A = ownerId | 0;
    const nat = this.nation[A];
    if (!nat) return 0;
    const inf = Math.max(0, Number(nat.infantry) || 0);
    const reserve = this._expandInfantryReserve(A);
    return Math.max(0, inf - reserve);
  };

  World.prototype._expandTileCost = function(idx) {
    const i = idx | 0;
    const costMul = Math.max(0.01, Number(EXPAND_TILE_COST_GLOBAL_MUL) || 1);
    const biomeArr = this.biome;
    if (biomeArr && i >= 0 && i < biomeArr.length) {
      const b = biomeArr[i] | 0;
      if (b >= 0 && b < EXPAND_TILE_COST_BY_BIOME.length) {
        const c = Number(EXPAND_TILE_COST_BY_BIOME[b]);
        if (Number.isFinite(c) && c > 0) return c * costMul;
      }
    }
    return 1 * costMul;
  };

  World.prototype._expandMinTileCost = function() {
    const cached = Number(this._expandMinTileCostCache);
    if (Number.isFinite(cached) && cached > 0) return cached;

    const costMul = Math.max(0.01, Number(EXPAND_TILE_COST_GLOBAL_MUL) || 1);
    let best = Infinity;
    for (let i = 0; i < EXPAND_TILE_COST_BY_BIOME.length; i++) {
      const c = Number(EXPAND_TILE_COST_BY_BIOME[i]);
      if (!Number.isFinite(c) || c <= 0) continue;
      const scaled = c * costMul;
      if (scaled < best) best = scaled;
    }
    if (!Number.isFinite(best) || best <= 0) best = 1;
    this._expandMinTileCostCache = best;
    return best;
  };

  World.prototype._expandEffortPerSec = function(ownerId, frontierCount, paceMul = 1, speedMul = 1, infantryBase = null) {
    let usable = 0;
    const base = Number(infantryBase);
    if (Number.isFinite(base)) usable = Math.max(0, base);
    else usable = this._expandUsableInfantry(ownerId);
    if (usable <= 0) return 0;
    const front = Math.max(1, Number(frontierCount) || 1);
    const pace = Math.max(0, Number(paceMul) || 0);
    const speed = Math.max(0, Number(speedMul) || 0);
    return NEUTRAL_WORK_RATE * Math.sqrt(usable) * Math.sqrt(front) * pace * speed;
  };

  World.prototype._warSuperiorityMul = function(attackerId, defenderId, attackingNow = 0) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return 1;

    const exp = Math.max(0, Number(WAR_SUPERIORITY_EXP) || 0);
    const minMul = Math.max(0.05, Number(WAR_SUPERIORITY_MUL_MIN) || 0.55);
    const maxMul = Math.max(minMul, Number(WAR_SUPERIORITY_MUL_MAX) || 2.5);
    if (exp <= 0) return 1;

    const def = this.nation[D];
    if (!def || !def.alive || def.collapsed) return 1;

    const atk = Math.max(0, Number(attackingNow) || 0);
    const defCommit = commitFraction(def);
    const defForce = Math.max(0, (Number(def.infantry) || 0) * defCommit);
    const ratio = (atk + 1) / (defForce + 1);
    let mul = Math.pow(ratio, exp);

    // Breakthrough scaling: if committed defenders are very thin, overwhelming
    // stacks should convert into clearly faster tile progress.
    const thinDef = clamp01(1 - (defForce / 300));
    if (ratio > 6) {
      const overrun = 1 + Math.min(1.9, Math.log2(ratio / 6) * (0.24 + 0.24 * thinDef));
      mul *= overrun;
    }
    if (ratio > 12) {
      const collapse = 1 + Math.min(2.2, Math.log2(ratio / 12) * (0.26 + 0.36 * thinDef));
      mul *= collapse;
    }

    // Keep baseline cap for normal wars, but allow a larger cap when the
    // defender has almost no committed frontline force.
    const overpower = Math.max(0, Math.log2(ratio) - 2);
    const effectiveMax = maxMul * (1 + 2.0 * thinDef + Math.min(1.7, overpower * 0.38 * thinDef));
    return Math.max(minMul, Math.min(effectiveMax, mul));
  };

  World.prototype._warAnnexPressure = function(attackerId, defenderId, attackingNow = 0) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return 0;

    const atk = this.nation[A];
    const def = this.nation[D];
    if (!atk || !def || !atk.alive || !def.alive) return 0;

    const atkNowRaw = Number(attackingNow);
    const atkNow = (Number.isFinite(atkNowRaw) && atkNowRaw > 0)
      ? atkNowRaw
      : Math.max(0, (Number(atk.infantry) || 0) * commitFraction(atk));

    const defCommit = commitFraction(def);
    const defForce = Math.max(0, (Number(def.infantry) || 0) * defCommit);
    const defInf = Math.max(0, Number(def.infantry) || 0);
    const ratio = (atkNow + 1) / (defForce + 1);
    const land = Math.max(0, this.landOwnedCount[D] | 0);

    let score = 0;
    if (def.collapsed) score += 0.28;
    if (!def.capital) score += 0.16;

    if (defForce <= 4) score += 0.44;
    else if (defForce <= 24) score += 0.34;
    else if (defForce <= 80) score += 0.18;

    if (defInf <= WAR_MIN_INF_TO_ADVANCE * 0.35) score += 0.20;

    if (land <= 140) score += 0.25;
    else if (land <= 260) score += 0.14;

    if (ratio >= 12) score += 0.25;
    else if (ratio >= 6) score += 0.14;
    else if (ratio >= 3) score += 0.06;

    return clamp01(score);
  };

  World.prototype._tryAnnexBrokenFrontline = function(attackerId, defenderId, attackingNow = 0, attackOp = null) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    const nAtk = this.nation[A];
    const nDef = this.nation[D];
    if (!nAtk || !nDef || !nAtk.alive || !nDef.alive) return { captured: 0, effort: 0, pressure: 0 };

    const pressure = this._warAnnexPressure(A, D, attackingNow);
    if (pressure < 0.70) return { captured: 0, effort: 0, pressure };

    const land = Math.max(0, this.landOwnedCount[D] | 0);
    if (land <= 0) return { captured: 0, effort: 0, pressure };

    let maxTiles = 0;
    if (pressure >= 0.90) maxTiles = land <= 220 ? 5 : 3;
    else if (pressure >= 0.80) maxTiles = land <= 220 ? 3 : 2;
    else maxTiles = land <= 160 ? 2 : 1;

    const atkNowRaw = Number(attackingNow);
    const atkNow = (Number.isFinite(atkNowRaw) && atkNowRaw > 0)
      ? atkNowRaw
      : Math.max(0, Number(nAtk.infantry) || 0);
    const contactCap = Math.max(1, Math.floor(Math.sqrt(Math.max(1, atkNow)) / 11)) + 1;
    maxTiles = Math.min(maxTiles, contactCap, Math.max(1, Math.ceil(land * 0.05)));

    const minOccPerTile = WAR_OCCUPY_TROOPS_PER_TILE * Math.max(0.34, 0.64 - 0.18 * pressure);
    if (attackOp && this._isAttackOperation(attackOp) && ((attackOp.attacker | 0) === A)) {
      const poolNow = Math.max(0, Number(attackOp.attackPool) || 0);
      const byPool = Math.floor(poolNow / Math.max(0.10, minOccPerTile));
      maxTiles = Math.min(maxTiles, byPool);
    } else {
      const byInf = Math.floor(Math.max(0, Number(nAtk.infantry) || 0) / Math.max(0.10, minOccPerTile));
      maxTiles = Math.min(maxTiles, byInf);
    }
    if (maxTiles <= 0) return { captured: 0, effort: 0, pressure };

    const capture = this._captureFrontlineTiles(A, D, maxTiles, { overrun: pressure, annex: true });
    const captured = capture.captured | 0;
    if (captured <= 0) return { captured: 0, effort: 0, pressure };

    const effort = Math.max(0, Number(capture.effort) || captured);
    const occupyMul = Math.max(0.34, 0.64 - 0.18 * pressure);
    const spend = WAR_OCCUPY_TROOPS_PER_TILE * effort * occupyMul;

    if (attackOp && this._isAttackOperation(attackOp) && ((attackOp.attacker | 0) === A)) {
      this._spendAttackPool(attackOp, spend);
    } else {
      nAtk.infantry = Math.max(0, (Number(nAtk.infantry) || 0) - spend);
    }

    const casualtyEffort = effort * Math.max(0.36, 0.66 - 0.22 * pressure);
    const avgWeakness = clamp01((Number(capture.avgWeakness) || 0) * 0.78 + pressure * 0.22);
    const encircled = capture.encircled | 0;
    const encircledFrac = clamp01(
      Number(capture.encircledFrac) ||
      (captured > 0 ? (encircled / captured) : 0)
    );
    this._applyWarCaptureCasualties(A, D, casualtyEffort, attackOp, {
      captured,
      encircled,
      encircledFrac,
      avgWeakness
    });
    this._applyWarCaptureGoldCost(A, effort * Math.max(0.34, 0.68 - 0.24 * pressure));

    return { captured, effort, pressure };
  };

  World.prototype._tryAutoAnnexCollapsedNation = function(attackerId, defenderId, attackingNow = 0, attackOp = null) {
    const A = attackerId | 0;
    const D = defenderId | 0;
    if (A <= 0 || D <= 0 || A === D) return { captured: 0, effort: 0, annexed: false };

    const nAtk = this.nation[A];
    const nDef = this.nation[D];
    if (!nAtk || !nDef || !nAtk.alive || !nDef.alive) return { captured: 0, effort: 0, annexed: false };

    const land = Math.max(0, this.landOwnedCount[D] | 0);
    if (land <= 0) return { captured: 0, effort: 0, annexed: false };

    const pressure = this._warAnnexPressure(A, D, attackingNow);
    const defInf = Math.max(0, Number(nDef.infantry) || 0);
    const defPop = Math.max(0, Number(nDef.population) || 0);
    const defCommit = commitFraction(nDef);
    const defCommitted = Math.max(0, defInf * defCommit);
    const capBroken = !nDef.capital || nDef.collapsed;

    // Hard gate: only fire for truly broken nations.
    const trulyCollapsed =
      capBroken &&
      pressure >= 0.88 &&
      defInf <= 2 &&
      defCommitted <= 1 &&
      (defPop <= 2500 || nDef.collapsed);
    if (!trulyCollapsed) return { captured: 0, effort: 0, annexed: false };

    let tiles = null;
    if (typeof this._getOwnerTiles === "function") {
      const arr = this._getOwnerTiles(D);
      if (arr && arr.length > 0) tiles = arr.slice();
    }
    if (!tiles) {
      tiles = [];
      const owner = this.owner;
      const landArr = this.land;
      for (let i = 0; i < owner.length; i++) {
        if (!landArr[i]) continue;
        if ((owner[i] | 0) === D) tiles.push(i);
      }
    }
    if (!tiles.length) return { captured: 0, effort: 0, annexed: false };

    let captured = 0;
    this._beginOwnerBatch();
    try {
      for (let i = 0; i < tiles.length; i++) {
        const idx = tiles[i] | 0;
        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== D) continue;
        this._setOwner(idx, A);
        captured++;
      }
    } finally {
      this._endOwnerBatch();
    }
    if (captured <= 0) return { captured: 0, effort: 0, annexed: false };

    // Deep collapse annexes should still have a small occupation/casualty burden.
    const effort = captured * Math.max(0.08, 0.24 - pressure * 0.12);
    const spend = effort * Math.max(0.20, WAR_OCCUPY_TROOPS_PER_TILE * 0.18);
    if (attackOp && this._isAttackOperation(attackOp) && ((attackOp.attacker | 0) === A)) {
      this._spendAttackPool(attackOp, spend);
    } else {
      nAtk.infantry = Math.max(0, (Number(nAtk.infantry) || 0) - spend);
    }

    this._applyWarCaptureCasualties(A, D, effort, attackOp, {
      captured,
      encircled: captured,
      encircledFrac: 1,
      avgWeakness: 1
    });
    this._applyWarCaptureGoldCost(A, effort * 0.60);
    this._pushEvent(`${this._nameOf(A)} rapidly annexed the remnants of ${this._nameOf(D)}.`);
    return { captured, effort, annexed: true };
  };

  World.prototype._hasActiveAttackOperation = function(attacker, defender) {
    const A = attacker | 0;
    const D = defender | 0;
    const ops = this.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;
      if ((op.attacker | 0) !== A) continue;
      if ((op.defender | 0) !== D) continue;
      const kind = String(op.kind || "");
      if (kind === "war" || kind === "burstWar") return true;
    }
    return false;
  };

  // ===== Operations (player/AI initiated) =====
  World.prototype._tickOperations = function(dt, cadenceTicks = 1) {
    const baseDt = Math.max(0, Number(dt) || 0);
    if (!(baseDt > 0)) return;
    const cadence = Math.max(1, cadenceTicks | 0);
    const opCount = Math.max(0, this.operations.length | 0);
    let aiCadence = cadence;
    if (opCount >= 80) aiCadence = Math.max(aiCadence, 4);
    else if (opCount >= 48) aiCadence = Math.max(aiCadence, 3);
    else if (opCount >= 24) aiCadence = Math.max(aiCadence, 2);
    const pace = this._worldPaceScale();
    const tiles = Math.max(1, (this.w | 0) * (this.h | 0));
    const heavy = tiles >= 1_200_000;
    const huge = tiles >= 2_000_000;
    const maxCheckBase = huge ? 3400 : (heavy ? 6200 : 12000);
    const maxAddWarBase = huge ? 5200 : (heavy ? 9200 : 16000);
    const maxAddNeutralBase = huge ? 6200 : (heavy ? 10200 : 18000);
    let opLoad = 1.0;
    if (opCount >= 96) opLoad = 0.30;
    else if (opCount >= 72) opLoad = 0.40;
    else if (opCount >= 56) opLoad = 0.52;
    else if (opCount >= 40) opLoad = 0.64;
    else if (opCount >= 24) opLoad = 0.78;
    const maxCheck = Math.max(360, Math.round(maxCheckBase * opLoad));
    const maxAddWar = Math.max(560, Math.round(maxAddWarBase * opLoad));
    const maxAddNeutral = Math.max(760, Math.round(maxAddNeutralBase * opLoad));
    let maintBudget = opCount >= 96 ? 8 : (opCount >= 72 ? 12 : (opCount >= 56 ? 16 : (opCount >= 40 ? 22 : 32)));
    let frontierRebuildBudget = opCount >= 96 ? 4 : (opCount >= 72 ? 6 : (opCount >= 56 ? 8 : (opCount >= 40 ? 12 : 18)));
    const warMaintEvery = huge ? 0.32 : 0.24;
    const neutralMaintEvery = huge ? 0.36 : 0.26;
    const nowRel = Number(this.time) || 0;

    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i];
      if (!op || typeof op !== "object") {
        this._dropOperationAt(i, false);
        continue;
      }
      const A = op.attacker | 0;
      const isPlayerOp = (A === OWNER.PLAYER);
      const opCadence = (A === OWNER.PLAYER) ? cadence : aiCadence;
      const opWorkMul = (A === OWNER.PLAYER) ? 1.0 : opLoad;
      const nat = this.nation[A];
      if (!nat || !nat.alive) {
        this._dropOperationAt(i, true);
        continue;
      }

      if ((op._opTickCadence | 0) !== opCadence || !Number.isFinite(op._opTickPhase)) {
        op._opTickCadence = opCadence;
        op._opTickPhase = (this._rng() * opCadence) | 0;
      }

      op._opTickAcc = Math.max(0, Number(op._opTickAcc) || 0) + baseDt;

      if (((this._simTick + (op._opTickPhase | 0)) % opCadence) !== 0) {
        continue;
      }

      dt = op._opTickAcc;
      op._opTickAcc = 0;
      if (!(dt > 0)) continue;

      // ===== Burst neutral expansion =====
      if (op.kind === "burst") {
        const attackingNow = this._initAttackPool(op);
        op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
        op.claimed = Math.max(0, Number(op.casualties) || 0);
        if (attackingNow <= 0) {
          if (A === OWNER.PLAYER) this._pushEvent("Burst expansion ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
          continue;
        }

        const borderCount = Math.max(1, this._borderSet[A]?.size || 0);
        const perSec = this._expandEffortPerSec(A, borderCount, pace, BURST_NEUTRAL_WORK_MUL, attackingNow);
        op.carry += perSec * dt;
        op.carry = Math.min(op.carry, BURST_CARRY_CAP * pace);

        let flips = 0;
        const flipCap = Math.max(1, Math.round(BURST_MAX_FLIPS_PER_TICK * pace * opWorkMul));
        const extraTroop = Math.max(0, Number(BURST_EXPAND_INFANTRY_PER_TILE) || 0);
        const minTileCost = this._expandMinTileCost() + extraTroop;
        const goldCostPerTile = Math.max(0, Number(BURST_EXPAND_GOLD_PER_TILE) || 0);
        const probeCap = Math.max(4, Math.min(72, Math.round(Math.max(6, borderCount) * (0.50 + 0.50 * opWorkMul))));
        // _pickBurstNeutralTile scans the frontier in chunks; require repeated misses before concluding "no frontier".
        const noFrontierLimit = Math.max(6, Math.min(32, Math.ceil(borderCount / 1800)));
        let stalledNoTile = false;
        this._beginOwnerBatch();
        try {
          while (op.carry > 0 && flips < flipCap) {
            const poolNow = Math.max(0, Number(op.attackPool) || 0);
            if (poolNow <= 0) break;
            if ((nat.gold || 0) < goldCostPerTile) break;

            let idx = -1;
            let tileCost = 0;
            for (let probe = 0; probe < probeCap; probe++) {
              const cand = this._pickBurstNeutralTile(A, op);
              if (cand < 0) continue;
              const cost = this._expandTileCost(cand) + extraTroop;
              if (cost <= op.carry + 1e-6 && cost <= poolNow + 1e-6) {
                idx = cand;
                tileCost = cost;
                break;
              }
            }
            if (idx < 0) {
              const canAffordOne =
                (op.carry + 1e-6 >= minTileCost) &&
                (poolNow + 1e-6 >= minTileCost) &&
                ((nat.gold || 0) >= goldCostPerTile);
              if (canAffordOne) {
                op._noFrontierStreak = Math.max(0, Number(op._noFrontierStreak) || 0) + 1;
                // Force a fresh border snapshot while probing for frontier.
                op.borderBuildAt = 0;
                op.borderBuildOwnerVersion = -1;
                if (op._noFrontierStreak >= noFrontierLimit) stalledNoTile = true;
              } else {
                op._noFrontierStreak = 0;
              }
              break;
            }

            op._noFrontierStreak = 0;

            op.carry -= tileCost;
            this._spendAttackPool(op, tileCost);
            nat.gold = Math.max(0, (nat.gold || 0) - goldCostPerTile);
            this._setOwner(idx, A);
            op.tilesCaptured++;
            flips++;
          }
        } finally {
          this._endOwnerBatch();
        }

        op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
        op.claimed = Math.max(0, Number(op.casualties) || 0);

        if (stalledNoTile) {
          if (A === OWNER.PLAYER) this._pushEvent("Burst expansion ended (no reachable neutral frontier).");
          this._dropOperationAt(i, true);
          continue;
        }

        if ((Number(op.attackPool) || 0) < minTileCost) {
          if (A === OWNER.PLAYER) this._pushEvent("Burst expansion ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
          continue;
        }

        continue;
      }

      // ===== Burst war (continuous attack stack) =====
      if (op.kind === "burstWar") {
        const D = op.defender | 0;
        if (!this.nation[D]?.alive) {
          this._dropOperationAt(i, true);
          continue;
        }

        const pAD = this._pair(A, D);
        const alliedAD = (this._alliedUntil[pAD] || 0) > nowRel;
        const atWarAD = (this._atWar[pAD] === 1) && !alliedAD;
        if (!atWarAD || alliedAD) {
          this._dropOperationAt(i, true);
          continue;
        }
        if ((this._ceasefireUntil[pAD] || 0) > nowRel) {
          // Attack stack waits during ceasefire.
          continue;
        }

        const attackingNow = this._initAttackPool(op);
        op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
        op.claimed = Math.max(0, Number(op.casualties) || 0);

        if (attackingNow < WAR_OCCUPY_TROOPS_PER_TILE) {
          if (A === OWNER.PLAYER) this._pushEvent("Attack ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
          continue;
        }

        // If borders no longer touch, end early.
        if (!this._bordersTouch(A, D)) {
          this._pushEvent(`${this._nameOf(A)} attack ended (no frontline contact).`);
          this._dropOperationAt(i, true);
          continue;
        }

        const now = Number(this.time) || 0;
        const nextWidthAt = Number(op._frontWidthAt || 0);
        if (!Number.isFinite(nextWidthAt) || now >= nextWidthAt) {
          const front = this._collectFrontlineCandidates(A, D, 140, 3400);
          op._frontWidth = Math.max(1, (front?.length | 0) || 1);
          op._frontWidthAt = now + 0.25;
        }
        const widthMul = frontlineWidthMul(op._frontWidth, 10);
        const stability = this._stabilityFactor(A);
        const attackPressure = Math.max(1, attackingNow + WAR_CAPTURE_ATTACK_FLOOR);
        const superiorityMul = this._warSuperiorityMul(A, D, attackingNow);
        const overrun = this._warAnnexPressure(A, D, attackingNow);
        const collapseBoost = (!this.nation[D]?.capital || this.nation[D]?.collapsed)
          ? (1 + Math.min(2.2, overrun * 2.1))
          : 1;
        const perSec = (BURST_CAPTURE_K * Math.sqrt(attackPressure)) * stability * pace * widthMul * superiorityMul * collapseBoost;
        op.carry += perSec * dt;
        op.carry = Math.min(op.carry, BURST_CARRY_CAP * pace * collapseBoost);

        const maxByTroops = Math.max(0, Math.floor(attackingNow / WAR_OCCUPY_TROOPS_PER_TILE));
        const burstFlipCap = Math.max(1, Math.round(BURST_MAX_FLIPS_PER_TICK * pace * opWorkMul * collapseBoost));
        const flipsWant = Math.min(burstFlipCap, Math.floor(op.carry), maxByTroops);
        if (flipsWant >= 1) {
          op.carry -= flipsWant;
          const capture = this._captureFrontlineTiles(A, D, flipsWant, { overrun });
          const captured = capture.captured | 0;
          if (captured > 0) {
            const effort = Math.max(0, Number(capture.effort) || captured);
            const avgWeakness = clamp01(Number(capture.avgWeakness) || 0);
            const encircled = capture.encircled | 0;
            const encircledFrac = clamp01(
              Number(capture.encircledFrac) ||
              (captured > 0 ? (encircled / captured) : 0)
            );
            this._spendAttackPool(op, WAR_OCCUPY_TROOPS_PER_TILE * effort);
            op.tilesCaptured += captured;
            this._applyWarCaptureCasualties(A, D, effort, op, {
              captured,
              encircled,
              encircledFrac,
              avgWeakness
            });
            this._applyWarCaptureGoldCost(A, effort);
            op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
            op.claimed = Math.max(0, Number(op.casualties) || 0);
          }
        }

        const annex = this._tryAnnexBrokenFrontline(A, D, Math.max(0, Number(op.attackPool) || 0), op);
        if ((annex.captured | 0) > 0) {
          op.tilesCaptured = Math.max(0, Number(op.tilesCaptured) || 0) + (annex.captured | 0);
          op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
          op.claimed = Math.max(0, Number(op.casualties) || 0);
        }
        const autoAnnex = this._tryAutoAnnexCollapsedNation(A, D, Math.max(0, Number(op.attackPool) || 0), op);
        if ((autoAnnex.captured | 0) > 0) {
          op.tilesCaptured = Math.max(0, Number(op.tilesCaptured) || 0) + (autoAnnex.captured | 0);
          op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
          op.claimed = Math.max(0, Number(op.casualties) || 0);
        }

        continue;
      }

      // ===== Focus war selection op =====
      if (op.kind === "war") {
        const D = op.defender | 0;
        if (!this.nation[D]?.alive) {
          this._dropOperationAt(i, true);
          continue;
        }
        const pAD = this._pair(A, D);
        const alliedAD = (this._alliedUntil[pAD] || 0) > nowRel;
        const atWarAD = (this._atWar[pAD] === 1) && !alliedAD;
        if (!atWarAD || alliedAD) {
          this._dropOperationAt(i, true);
          continue;
        }
        if ((this._ceasefireUntil[pAD] || 0) > nowRel) {
          continue;
        }

        // Keep focus-op sets consistent with the live world state.
        let runMaint = false;
        if (isPlayerOp) runMaint = shouldRunOpMaintenance(op, this.time, warMaintEvery);
        else if (maintBudget > 0 && shouldRunOpMaintenance(op, this.time, warMaintEvery)) {
          runMaint = true;
          maintBudget--;
        }
        if (runMaint) {
          let checked = 0;
          for (const idx0 of op.target) {
            const idx = idx0 | 0;
            if (!this.land[idx] || (this.owner[idx] | 0) !== D) {
              op.target.delete(idx);
              op.frontier.delete(idx);
            }
            if (++checked >= maxCheck) break;
          }

          checked = 0;
          for (const idx0 of op.frontier) {
            const idx = idx0 | 0;
            if (!op.target.has(idx) || !this.land[idx] || (this.owner[idx] | 0) !== D) {
              op.frontier.delete(idx);
            }
            if (++checked >= maxCheck) break;
          }
        }

        op.claimed = op.total - op.target.size;

        if (op.target.size === 0) {
          this._pushEvent(`${this._nameOf(A)} completed a focus attack.`);
          this._dropOperationAt(i, true);
          continue;
        }

        // Rebuild stale frontier.
        if (op.frontier.size === 0) {
          if (!isPlayerOp && frontierRebuildBudget <= 0) continue;
          if (!isPlayerOp) frontierRebuildBudget--;
          let added = 0;
          for (const idx0 of op.target) {
            const idx = idx0 | 0;
            if (!this.land[idx]) { op.target.delete(idx); continue; }
            if ((this.owner[idx] | 0) !== D) { op.target.delete(idx); continue; }
            if (this._touchesOwner4(idx, A)) {
              op.frontier.add(idx);
              if (++added >= maxAddWar) break;
            }
          }
        }

        if (op.frontier.size === 0) {
          this._pushEvent(`${this._nameOf(A)} focus attack ended (no reachable frontline).`);
          this._dropOperationAt(i, true);
          continue;
        }

        const attackingNow = this._initAttackPool(op);
        if (attackingNow < WAR_OCCUPY_TROOPS_PER_TILE) {
          if (A === OWNER.PLAYER) this._pushEvent("Focus attack ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
          continue;
        }

        const widthMul = frontlineWidthMul(op.frontier?.size || 1, 6);
        const stability = this._stabilityFactor(A);
        const attackPressure = Math.max(1, attackingNow + WAR_CAPTURE_ATTACK_FLOOR);
        const superiorityMul = this._warSuperiorityMul(A, D, attackingNow);
        const overrun = this._warAnnexPressure(A, D, attackingNow);
        const collapseBoost = (!this.nation[D]?.capital || this.nation[D]?.collapsed)
          ? (1 + Math.min(2.2, overrun * 2.0))
          : 1;
        const perSec = (OP_CAPTURE_K * Math.sqrt(attackPressure)) * stability * pace * widthMul * superiorityMul * collapseBoost;
        op.carry += perSec * dt;
        op.carry = Math.min(op.carry, OP_CARRY_CAP * pace * collapseBoost);

        let flips = 0;
        const opFlipCap = Math.max(1, Math.round(OP_MAX_FLIPS_PER_TICK * pace * opWorkMul * collapseBoost));
        this._beginOwnerBatch();
        try {
          while (op.carry >= 1 && flips < opFlipCap) {
            const poolNow = Math.max(0, Number(op.attackPool) || 0);
            if (poolNow < WAR_OCCUPY_TROOPS_PER_TILE) break;

            op.carry -= 1;

            const idx = this._pickOpFrontierTile(op, A);
            if (idx < 0) break;
            const weakness = this._enemyTileWeakness(A, D, idx);
            const effectiveWeakness = clamp01(Math.max(weakness, overrun * 0.80));
            const effort = this._captureEffortForWeakness(effectiveWeakness) * Math.max(0.40, 1 - 0.30 * overrun);
            const spend = WAR_OCCUPY_TROOPS_PER_TILE * effort;
            if (poolNow + 1e-6 < spend) break;
            const defInf = Math.max(0, Number(this.nation[D]?.infantry) || 0);
            const collapseBypass = (overrun >= 0.90) && (defInf <= WAR_MIN_INF_TO_ADVANCE * 0.28);
            if (!collapseBypass && this._defenceBlocksCapture(D, idx, (0.30 * effectiveWeakness) + (0.42 * overrun))) continue;

            this._spendAttackPool(op, spend);
            this._setOwner(idx, A);
            op.target.delete(idx);
            op.frontier.delete(idx);
            flips++;

            this._addOpFrontierFrom(idx, op, A);
            const encircled = effectiveWeakness >= 0.62 ? 1 : 0;
            this._applyWarCaptureCasualties(A, D, effort, op, {
              captured: 1,
              encircled,
              encircledFrac: encircled,
              avgWeakness: effectiveWeakness
            });
            this._applyWarCaptureGoldCost(A, effort);
          }
        } finally {
          this._endOwnerBatch();
        }

        op.claimed = op.total - op.target.size;

        if (op.target.size === 0) {
          this._pushEvent(`${this._nameOf(A)} completed a focus attack.`);
          this._dropOperationAt(i, true);
        } else if ((Number(op.attackPool) || 0) < WAR_OCCUPY_TROOPS_PER_TILE) {
          if (A === OWNER.PLAYER) this._pushEvent("Focus attack ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
        } else {
          const autoAnnex = this._tryAutoAnnexCollapsedNation(A, D, Math.max(0, Number(op.attackPool) || 0), op);
          if ((autoAnnex.captured | 0) > 0) {
            op.tilesCaptured = Math.max(0, Number(op.tilesCaptured) || 0) + (autoAnnex.captured | 0);
            op.total = Math.max(1, (Number(op.attackPool) || 0) + (Number(op.casualties) || 0));
            op.claimed = Math.max(0, Number(op.casualties) || 0);
            if (op.target && op.target.size > 0) {
              op.target.clear();
              op.frontier.clear();
              this._dropOperationAt(i, true);
            }
          }
        }

        continue;
      }

      // ===== Neutral selection op =====
      if (op.kind === "neutral") {
        let runMaint = false;
        if (isPlayerOp) runMaint = shouldRunOpMaintenance(op, this.time, neutralMaintEvery);
        else if (maintBudget > 0 && shouldRunOpMaintenance(op, this.time, neutralMaintEvery)) {
          runMaint = true;
          maintBudget--;
        }
        if (runMaint) {
          let checked = 0;
          for (const idx0 of op.target) {
            const idx = idx0 | 0;
            if (!this.land[idx] || (this.owner[idx] | 0) !== OWNER.NONE) {
              op.target.delete(idx);
              op.frontier.delete(idx);
            }
            if (++checked >= maxCheck) break;
          }

          checked = 0;
          for (const idx0 of op.frontier) {
            const idx = idx0 | 0;
            if (!op.target.has(idx) || !this.land[idx] || (this.owner[idx] | 0) !== OWNER.NONE) {
              op.frontier.delete(idx);
            }
            if (++checked >= maxCheck) break;
          }
        }

        op.claimed = op.total - op.target.size;

        if (op.target.size === 0) {
          this._pushEvent(`${this._nameOf(A)} completed expansion.`);
          this._dropOperationAt(i, true);
          continue;
        }

        // Rebuild stale frontier if needed.
        if (op.frontier.size === 0) {
          if (!isPlayerOp && frontierRebuildBudget <= 0) continue;
          if (!isPlayerOp) frontierRebuildBudget--;
          let added = 0;
          for (const idx0 of op.target) {
            const idx = idx0 | 0;
            if (!this.land[idx]) { op.target.delete(idx); continue; }
            if ((this.owner[idx] | 0) !== OWNER.NONE) { op.target.delete(idx); continue; }
            if (this._touchesOwner4(idx, A)) {
              op.frontier.add(idx);
              if (++added >= maxAddNeutral) break;
            }
          }
          this._rebuildNeutralWaveOrder(op, A);
        }

        if (op.frontier.size === 0) {
          this._pushEvent(`${this._nameOf(A)} expansion ended (no reachable frontier).`);
          this._dropOperationAt(i, true);
          continue;
        }

        const attackingNow = this._initAttackPool(op);
        if (attackingNow <= 0) {
          if (A === OWNER.PLAYER) this._pushEvent("Expansion ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
          continue;
        }

        const frontNow = Math.max(1, (op.frontier?.size | 0) || 1);
        const perSec = this._expandEffortPerSec(A, frontNow, pace, 1, attackingNow);
        op.carry += perSec * dt;
        op.carry = Math.min(op.carry, OP_CARRY_CAP * pace);

        let flips = 0;
        const neutralFlipCap = Math.max(1, Math.round(OP_MAX_FLIPS_PER_TICK * pace * opWorkMul));
        const minTileCost = this._expandMinTileCost();
        const probeCap = Math.max(4, Math.min(96, Math.round(Math.max(6, frontNow) * (0.50 + 0.50 * opWorkMul))));
        this._beginOwnerBatch();
        try {
          while (op.carry > 0 && flips < neutralFlipCap) {
            const poolNow = Math.max(0, Number(op.attackPool) || 0);
            if (poolNow <= 0) break;

            let idx = -1;
            let tileCost = 0;
            for (let probe = 0; probe < probeCap; probe++) {
              const cand = this._pickOpFrontierTile(op, A);
              if (cand < 0) break;
              const cost = this._expandTileCost(cand);
              if (cost <= op.carry + 1e-6 && cost <= poolNow + 1e-6) {
                idx = cand;
                tileCost = cost;
                break;
              }
            }
            if (idx < 0) break;

            op.carry -= tileCost;
            this._spendAttackPool(op, tileCost);
            this._setOwner(idx, A);
            op.target.delete(idx);
            op.frontier.delete(idx);
            flips++;

            this._addOpFrontierFrom(idx, op, A);
          }
        } finally {
          this._endOwnerBatch();
        }

        op.claimed = op.total - op.target.size;

        if (op.target.size === 0) {
          this._pushEvent(`${this._nameOf(A)} completed expansion.`);
          this._dropOperationAt(i, true);
        } else if ((Number(op.attackPool) || 0) < minTileCost) {
          if (A === OWNER.PLAYER) this._pushEvent("Expansion ended (no attacking troops remaining).");
          this._dropOperationAt(i, true);
        }
      }
    }
  };

  World.prototype._tickWarExhaustion = function(dt) {
    const step = Math.max(0, Number(dt) || 0);
    if (!(step > 0)) return;
    const now = Number(this.time) || 0;

    const len = (this._nationCount | 0) + 1;
    let activeCount = this._warActiveCountScratch;
    if (!activeCount || activeCount.length !== len) {
      activeCount = this._warActiveCountScratch = new Int16Array(len);
    } else {
      activeCount.fill(0);
    }

    const pairs = this._activeWarPairs;
    if (pairs && pairs.size > 0) {
      const stride = (this._nationCount + 1) | 0;
      for (const key of pairs) {
        const pairKey = key | 0;
        const A = (pairKey / stride) | 0;
        const B = (pairKey - A * stride) | 0;
        if (A <= 0 || B <= 0 || A === B) continue;
        if (!this.nation[A]?.alive || !this.nation[B]?.alive) continue;

        const pAB = this._pair(A, B);
        const alliedAB = (this._alliedUntil[pAB] || 0) > now;
        if (alliedAB) continue;
        const ceasefireAB = (this._ceasefireUntil[pAB] || 0) > now;
        if ((this._atWar[pAB] !== 1) || ceasefireAB) continue;
        activeCount[A] = (activeCount[A] | 0) + 1;
        activeCount[B] = (activeCount[B] | 0) + 1;
      }
    }

    const grace = Math.max(0, Number(WAR_EXHAUSTION_GRACE_S) || 0);
    const rampS = Math.max(1e-3, Number(WAR_EXHAUSTION_RAMP_S) || 1);
    const gainBase = Math.max(0, Number(WAR_EXHAUSTION_GAIN_PER_S) || 0);
    const multiWarGainBonus = Math.max(0, Number(WAR_EXHAUSTION_MULTI_WAR_GAIN_BONUS) || 0);
    const pauseRecover = Math.max(0, Number(WAR_EXHAUSTION_PAUSE_RECOVER_PER_S) || 0);
    const peaceRecover = Math.max(0, Number(WAR_EXHAUSTION_PEACE_RECOVER_PER_S) || 0);
    const warTimeDecay = Math.max(0, Number(WAR_EXHAUSTION_WARTIME_DECAY_PER_S) || 0);

    const exhaustion = this._warExhaustion;
    const warTime = this._warExhaustionWarTime;
    for (let id = 1; id <= this._nationCount; id++) {
      const n = this.nation[id];
      let x = clamp01(Number(exhaustion[id]) || 0);
      let t = Math.max(0, Number(warTime[id]) || 0);

      if (!n || !n.alive || n.collapsed) {
        t = Math.max(0, t - step * warTimeDecay * 2.0);
        x = Math.max(0, x - step * peaceRecover);
      } else {
        const fronts = activeCount[id] | 0;
        const atWar = (this._warsByNation[id] | 0) > 0;

        if (fronts > 0) {
          const frontTimeMul = Math.min(2.6, 1 + Math.max(0, fronts - 1) * 0.30);
          t += step * frontTimeMul;

          const over = t - grace;
          if (over > 0 && gainBase > 0) {
            const ramp = Math.min(1, over / rampS);
            const frontMul = 1 + Math.max(0, fronts - 1) * multiWarGainBonus;
            const gain = gainBase * (0.35 + 0.65 * ramp) * frontMul;
            x = Math.min(1, x + step * gain);
          }
        } else {
          t = Math.max(0, t - step * warTimeDecay);
          x = Math.max(0, x - step * (atWar ? pauseRecover : peaceRecover));
        }
      }

      exhaustion[id] = x;
      warTime[id] = t;
      if (n) {
        n.warExhaustion = x;
        n.warExhaustionPct = Math.round(x * 100);
      }
    }
  };

  // ===== Ongoing warfront solver (all wars) =====
  World.prototype._tickWarfront = function(dt) {
    const pairs = this._activeWarPairs;
    if (!pairs || pairs.size === 0) {
      this._warfrontPairTotal = 0;
      if (this._warPairLastSolveAt) this._warPairLastSolveAt.clear();
      if (this._warPairKeysScratch) this._warPairKeysScratch.length = 0;
      if (this._warContactCache) this._warContactCache.clear();
      this._warfrontHotspotBudget = 0;
      if (this._warfrontActiveAttackPairSet) this._warfrontActiveAttackPairSet.clear();
      return;
    }

    const keys = this._warPairKeysScratch || [];
    keys.length = 0;
    for (const key of pairs) keys.push(key | 0);
    const total = keys.length | 0;
    if (total <= 0) {
      this._warfrontPairTotal = 0;
      if (this._warPairLastSolveAt) this._warPairLastSolveAt.clear();
      if (this._warContactCache) this._warContactCache.clear();
      this._warfrontHotspotBudget = 0;
      if (this._warfrontActiveAttackPairSet) this._warfrontActiveAttackPairSet.clear();
      return;
    }

    if (!this._warPairLastSolveAt) this._warPairLastSolveAt = new Map();
    const lastSolveAt = this._warPairLastSolveAt;
    const now = Number(this.time) || 0;
    this._warfrontPairTotal = total;
    const passOwnerVersion = this.ownerVersion | 0;
    const catchupMul = total >= 80 ? 3 : (total >= 56 ? 4 : (total >= 36 ? 6 : 10));
    const maxCatchupDt = Math.max(dt, WAR_STEP_S * catchupMul);

    // Precompute active attack-operation pairs once for this warfront pass.
    let activeAttackPairs = this._warfrontActiveAttackPairSet;
    if (!activeAttackPairs) activeAttackPairs = this._warfrontActiveAttackPairSet = new Set();
    activeAttackPairs.clear();
    const ops = this.operations || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;
      const kind = String(op.kind || "");
      if (kind !== "war" && kind !== "burstWar") continue;
      const a = op.attacker | 0;
      const b = op.defender | 0;
      if (a <= 0 || b <= 0 || a === b) continue;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      activeAttackPairs.add(this._pair(lo, hi));
    }

    const start = clampInt(this._warPairScanOffset | 0, 0, Math.max(0, total - 1));
    const budgetFrac = total >= 80 ? 0.18 : (total >= 56 ? 0.22 : (total >= 36 ? 0.27 : 0.34));
    const budgetMin = total >= 80 ? 14 : 18;
    const budgetMax = total >= 80 ? 72 : (total >= 56 ? 88 : 120);
    const budget = (total <= 24)
      ? total
      : clampInt(Math.ceil(total * budgetFrac), budgetMin, budgetMax);
    this._warfrontHotspotBudget = total >= 80 ? 10 : (total >= 56 ? 16 : (total >= 36 ? 24 : 40));

    const stride = (this._nationCount + 1) | 0;
    let processed = 0;
    let scanned = 0;
    for (let s = 0; s < total && processed < budget; s++) {
      scanned = s + 1;
      const key = keys[(start + s) % total] | 0;
      const A = (key / stride) | 0;
      const B = (key - A * stride) | 0;
      if (A <= 0 || B <= 0 || A === B) continue;
      if (!this.nation[A]?.alive || !this.nation[B]?.alive) continue;

      const pAB = this._pair(A, B);
      const alliedAB = (this._alliedUntil[pAB] || 0) > now;
      const ceasefireAB = (this._ceasefireUntil[pAB] || 0) > now;
      const warActiveAB = !alliedAB && (this._atWar[pAB] === 1) && !ceasefireAB;
      if (!warActiveAB) {
        lastSolveAt.delete(key);
        continue;
      }
      if (!this._bordersTouch(A, B, passOwnerVersion)) {
        // War can exist without contact; do not accumulate catch-up time while separated.
        lastSolveAt.set(key, now);
        continue;
      }

      const prev = Number(lastSolveAt.get(key));
      let pairDt = dt;
      if (Number.isFinite(prev) && now > prev) pairDt = now - prev;
      pairDt = Math.max(dt, Math.min(maxCatchupDt, pairDt));
      lastSolveAt.set(key, now);

      processed++;
      this._solveWarPair(A, B, pairDt, passOwnerVersion);
      if (this.gameOver) return;
    }

    this._warPairScanOffset = (start + Math.max(1, scanned)) % total;
  };

  // ===== War solver internals =====
  World.prototype._solveWarPair = function(A, B, dt, ownerVersionHint = (this.ownerVersion | 0)) {
    const lo = (A | 0) < (B | 0) ? (A | 0) : (B | 0);
    const hi = (A | 0) < (B | 0) ? (B | 0) : (A | 0);
    const pairKey = this._pair(lo, hi);
    if (this._warfrontActiveAttackPairSet?.has(pairKey)) return;

    const nA = this.nation[A];
    const nB = this.nation[B];
    if (!nA || !nB || !nA.alive || !nB.alive) return;

    const canA = nA.infantry >= WAR_MIN_INF_TO_ADVANCE;
    const canB = nB.infantry >= WAR_MIN_INF_TO_ADVANCE;
    const manualOnlyA = (A | 0) === OWNER.PLAYER;
    const manualOnlyB = (B | 0) === OWNER.PLAYER;
    const canAutoAttackA = canA && !manualOnlyA;
    const canAutoAttackB = canB && !manualOnlyB;

    if (!canAutoAttackA && !canAutoAttackB) return;

    const contacts = this._estimateContactCount(A, B, ownerVersionHint);
    if (contacts > 0) {
      const intensity = (canA && canB) ? 1.0 : 0.55;
      const aIntensity = manualOnlyA ? (intensity * 0.62) : intensity;
      const bIntensity = manualOnlyB ? (intensity * 0.62) : intensity;
      this._applyWarLogisticsCost(A, B, contacts, dt, intensity);
      this._applyContactCasualties(A, B, contacts, dt, aIntensity, bIntensity);
    }

    const stabA = this._stabilityFactor(A);
    const stabB = this._stabilityFactor(B);
    const commitA = commitFraction(nA);
    const commitB = commitFraction(nB);

    const forceA = Math.max(0, (nA.infantry || 0) * commitA);
    const forceB = Math.max(0, (nB.infantry || 0) * commitB);
    const reserveA = Math.max(0, (nA.infantry || 0) - forceA);
    const reserveB = Math.max(0, (nB.infantry || 0) - forceB);

    // Player is manual-attack only: no auto-counterattack, but gets extra defensive holding power.
    const passiveDefMul = Math.max(1.0, Number(WAR_PASSIVE_PLAYER_DEFENCE_MUL) || 1.0);
    const passiveDefMulA = manualOnlyA ? passiveDefMul : 1.0;
    const passiveDefMulB = manualOnlyB ? passiveDefMul : 1.0;
    const attA = canAutoAttackA ? (forceA * stabA) : 0;
    const defA = Math.max(1, (reserveA + forceA * (canAutoAttackA ? 0.35 : 0.95)) * stabA * passiveDefMulA);
    const attB = canAutoAttackB ? (forceB * stabB) : 0;
    const defB = Math.max(1, (reserveB + forceB * (canAutoAttackB ? 0.35 : 0.95)) * stabB * passiveDefMulB);

    const pressureA = attA / (defB + 1);
    const pressureB = attB / (defA + 1);
    const net = pressureA - pressureB;

    let attacker = 0;
    let defender = 0;
    if (canAutoAttackA && !canAutoAttackB) {
      attacker = A;
      defender = B;
    } else if (!canAutoAttackA && canAutoAttackB) {
      attacker = B;
      defender = A;
    } else {
      attacker = net >= 0 ? A : B;
      defender = net >= 0 ? B : A;
    }
    const nAtk = this.nation[attacker];
    const nDef = this.nation[defender];
    if (!nAtk || !nDef) return;
    if (nAtk.infantry < (WAR_MIN_INF_TO_ADVANCE + WAR_OCCUPY_TROOPS_PER_TILE)) return;

    // Pace scales with world size so giant maps can still resolve in a reasonable time.
    const power = Math.abs(net);
    const saturation = Math.max(0.1, Number(WAR_POWER_SATURATION) || 0.85);
    const frac = power / (power + saturation);
    const pace = this._worldPaceScale();
    const stepScale = Math.max(0.75, Math.min(10, dt / Math.max(1e-6, WAR_STEP_S)));
    const stepCap = Math.max(1, Math.round(WAR_MAX_FLIPS_PER_STEP * pace * stepScale));
    let flipsWant = clampInt(Math.floor(frac * stepCap), 0, stepCap);

    const passiveDefender = (defender | 0) === OWNER.PLAYER;
    if (passiveDefender) {
      const damp = Math.max(1.0, Number(WAR_PASSIVE_PLAYER_FLIP_DAMP) || 1.05);
      flipsWant = Math.floor(flipsWant / damp);
    }

    const atkNow = Math.max(0, Number(nAtk.infantry) || 0) * commitFraction(nAtk);
    const superiorityMul = this._warSuperiorityMul(attacker, defender, atkNow);
    const overrun = this._warAnnexPressure(attacker, defender, atkNow);
    const collapseRush = (!nDef.capital || nDef.collapsed)
      ? (1 + Math.min(2.8, overrun * 1.95))
      : 1;
    const flipMul = Math.max(0.25, superiorityMul * collapseRush);
    const flipCap = Math.max(stepCap, Math.round(stepCap * Math.min(4.8, flipMul)));
    flipsWant = clampInt(Math.floor(Math.max(1, flipsWant) * flipMul), 0, flipCap);

    const atkCommit = commitFraction(nAtk);
    const reserveFloor = Math.max(WAR_MIN_INF_TO_ADVANCE, nAtk.infantry * (1 - atkCommit));
    const availForOccupy = Math.max(0, nAtk.infantry - reserveFloor);
    const maxByOcc = Math.floor(availForOccupy / WAR_OCCUPY_TROOPS_PER_TILE);
    if (flipsWant <= 0 && maxByOcc > 0) flipsWant = 1;
    flipsWant = Math.min(flipsWant, maxByOcc);
    if (flipsWant <= 0) return;

    const capture = this._captureFrontlineTiles(attacker, defender, flipsWant, { overrun });
    const captured = capture.captured | 0;
    if (captured <= 0) return;
    let effort = Math.max(0, Number(capture.effort) || captured);
    const avgWeakness = clamp01(Number(capture.avgWeakness) || 0);
    const encircled = capture.encircled | 0;
    const encircledFrac = clamp01(
      Number(capture.encircledFrac) ||
      (captured > 0 ? (encircled / captured) : 0)
    );
    if (passiveDefender) effort *= 1.18;

    // Occupation / manpower spent to hold ground.
    nAtk.infantry = Math.max(0, nAtk.infantry - effort * WAR_OCCUPY_TROOPS_PER_TILE);
    this._applyWarCaptureCasualties(attacker, defender, effort, null, {
      captured,
      encircled,
      encircledFrac,
      avgWeakness
    });
    this._applyWarCaptureGoldCost(attacker, effort);

    // Low-capability defenders collapse faster but still consume some attacker resources.
    this._tryAnnexBrokenFrontline(attacker, defender, atkNow, null);
    this._tryAutoAnnexCollapsedNation(attacker, defender, atkNow, null);
  };

  World.prototype._collectFrontlineCandidates = function(attacker, defender, maxTake = 180, maxScan = 7200, outArr = null) {
    const borderSet = this._borderSet[defender];
    const out = Array.isArray(outArr) ? outArr : [];
    out.length = 0;
    if (!borderSet || borderSet.size === 0) return out;

    const want = Math.max(1, maxTake | 0);
    const size = borderSet.size | 0;
    const cap = Math.min(size, Math.max(want, maxScan | 0));
    if (cap <= 0) return out;
    let it = borderSet.values();
    const skip = (this._rng() * size) | 0;
    for (let s = 0; s < skip; s++) {
      const n = it.next();
      if (n.done) {
        it = borderSet.values();
        break;
      }
    }

    let scanned = 0;
    while (scanned < cap && out.length < want) {
      let n = it.next();
      if (n.done) {
        it = borderSet.values();
        n = it.next();
        if (n.done) break;
      }

      const idx = n.value | 0;
      scanned++;
      if (!this.land[idx]) {
        borderSet.delete(idx);
        continue;
      }
      if ((this.owner[idx] | 0) !== defender) {
        borderSet.delete(idx);
        continue;
      }
      if (!this._touchesOwner4(idx, attacker)) continue;
      out.push(idx);
    }

    return out;
  };

  // Encirclement score (0..1): higher when attacker controls most adjacent ground
  // and defender has fewer direct escape/support neighbors.
  World.prototype._encirclementScore = function(attacker, defender, idx) {
    const A = attacker | 0;
    const D = defender | 0;
    const i = idx | 0;
    if (!this.land[i]) return 0;
    if ((this.owner[i] | 0) !== D) return 0;

    const w = this.w | 0;
    const h = this.h | 0;
    const x = i % w;
    const y = (i / w) | 0;

    let atk4 = 0;
    let def4 = 0;
    let open4 = 0;
    let other4 = 0;
    const owner = this.owner;
    const land = this.land;
    let ni = 0;
    let o = 0;

    if (x <= 0) open4++;
    else {
      ni = i - 1;
      if (!land[ni]) open4++;
      else {
        o = owner[ni] | 0;
        if (o === A) atk4++;
        else if (o === D) def4++;
        else if (o === OWNER.NONE) open4++;
        else other4++;
      }
    }

    if (x + 1 >= w) open4++;
    else {
      ni = i + 1;
      if (!land[ni]) open4++;
      else {
        o = owner[ni] | 0;
        if (o === A) atk4++;
        else if (o === D) def4++;
        else if (o === OWNER.NONE) open4++;
        else other4++;
      }
    }

    if (y <= 0) open4++;
    else {
      ni = i - w;
      if (!land[ni]) open4++;
      else {
        o = owner[ni] | 0;
        if (o === A) atk4++;
        else if (o === D) def4++;
        else if (o === OWNER.NONE) open4++;
        else other4++;
      }
    }

    if (y + 1 >= h) open4++;
    else {
      ni = i + w;
      if (!land[ni]) open4++;
      else {
        o = owner[ni] | 0;
        if (o === A) atk4++;
        else if (o === D) def4++;
        else if (o === OWNER.NONE) open4++;
        else other4++;
      }
    }

    let score = 0;
// Buffed: reward true surround + deny "thin corridor" breakthroughs.
if (atk4 >= 2) score += (atk4 - 1) * 0.24; // 2->0.24, 3->0.48, 4->0.72
if (atk4 === 4) score += 0.08;
if (def4 <= 1) score += 0.22;
if (open4 === 0) score += 0.18;
if (open4 <= 1 && atk4 >= 3) score += 0.06;
if (other4 === 0 && open4 === 0 && atk4 >= 3) score += 0.12;
score -= def4 * 0.06;

    return clamp01(score);
  };

  World.prototype._enemyTileWeakness = function(attacker, defender, idx) {
    const A = attacker | 0;
    const D = defender | 0;
    const i = idx | 0;
    if (!this.land[i]) return 0;
    if ((this.owner[i] | 0) !== D) return 0;

    const w = this.w;
    const x = i % w;
    const y = (i / w) | 0;

    let def4 = 0;
    let def8 = 0;
    let atk8 = 0;
    let neutral8 = 0;
    let other8 = 0;
    let land8 = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
        const ni = yy * w + xx;
        if (!this.land[ni]) continue;

        land8++;
        const o = this.owner[ni] | 0;
        if (o === D) {
          def8++;
          if (dx === 0 || dy === 0) def4++;
        } else if (o === A) {
          atk8++;
        } else if (o === OWNER.NONE) {
          neutral8++;
        } else {
          other8++;
        }
      }
    }

    const encScore = this._encirclementScore(A, D, i);

    // Ignore coast/edge oddities and only target true enclave-like pockets.
    let pocket = 0;
    if (land8 >= 5) {
      if (def4 === 0 && def8 <= 1 && atk8 >= 5 && neutral8 <= 1 && other8 === 0) pocket = 1.0;
      else if (def4 <= 1 && def8 <= 2 && atk8 >= 4 && neutral8 <= 1 && other8 <= 1) pocket = 0.70;
      else if (def4 <= 1 && def8 <= 3 && atk8 >= 3 && neutral8 <= 2 && other8 <= 1) pocket = 0.35;
    }

    return clamp01(Math.max(pocket, encScore * 0.95));
  };

  World.prototype._captureEffortForWeakness = function(weakness) {
    const w = clamp01(weakness);
    return 1 - 0.68 * w;
  };

// Capital siege gate:

  World.prototype._captureFrontlineTiles = function(attacker, defender, want, options = null) {
    const opts = (options && typeof options === "object") ? options : null;
    const overrunRaw = Number(opts?.overrun);
    const overrun = Number.isFinite(overrunRaw)
      ? clamp01(overrunRaw)
      : this._warAnnexPressure(attacker | 0, defender | 0, 0);
    const annexMode = !!opts?.annex;

    const picksScratch = this._warCapturePicksScratch || (this._warCapturePicksScratch = []);
    const picks = this._collectFrontlineCandidates(
      attacker,
      defender,
      Math.max(64, (want | 0) * 18),
      Math.max(7200, (want | 0) * 520),
      picksScratch
    );
    if (!picks.length) return { captured: 0, effort: 0 };
    const capStructId = this.nation?.[defender]?.capital | 0;
    const capStruct = capStructId ? this._structureById?.get(capStructId) : null;
    const capAnchorIdx = capStruct ? (((capStruct.y | 0) * (this.w | 0)) + (capStruct.x | 0)) : -1;

    let got = 0;
    let effort = 0;
    let weaknessSum = 0;
    let encircled = 0;
    this._beginOwnerBatch();
    try {
      while (got < want && picks.length > 0) {
        let pick = -1;
        let best = -1;
        let bestWeakness = -1;
        const probe = Math.min(6, picks.length);
        for (let s = 0; s < probe; s++) {
          const p = (this._rng() * picks.length) | 0;
          const v = picks[p] | 0;
          const score = this._enemyTileWeakness(attacker, defender, v);
          if (score > best || (score === best && this._rng() < 0.35)) {
            best = score;
            bestWeakness = score;
            pick = p;
          }
        }
        if (pick < 0) pick = (this._rng() * picks.length) | 0;

        const idx = picks[pick] | 0;
        picks[pick] = picks[picks.length - 1] | 0;
        picks.pop();

        if (!this.land[idx]) continue;
        if ((this.owner[idx] | 0) !== defender) continue;
        if (!this._touchesOwner4(idx, attacker)) continue;
        if (idx === capAnchorIdx && !this._capitalSiegeReady(attacker, defender, capAnchorIdx, overrun)) continue;

        let weakness = bestWeakness;
        if (!(weakness >= 0)) weakness = this._enemyTileWeakness(attacker, defender, idx);
        const effectiveWeakness = clamp01(Math.max(weakness, overrun * (annexMode ? 0.84 : 0.76)));
        const defInf = Math.max(0, Number(this.nation?.[defender]?.infantry) || 0);
        const collapseBypass = (overrun >= 0.90) && (defInf <= WAR_MIN_INF_TO_ADVANCE * 0.28);
        const defenceWeakBonus = (0.30 * effectiveWeakness) + ((annexMode ? 0.50 : 0.40) * overrun);
        if (!collapseBypass && this._defenceBlocksCapture(defender, idx, defenceWeakBonus)) continue;

        if (typeof this._markTilePressureAround === "function") {
          this._markTilePressureAround(idx, 3.6);
        }
        this._setOwner(idx, attacker);
        got++;
        weaknessSum += effectiveWeakness;
        if (effectiveWeakness >= 0.62) encircled++;
        const effortMul = annexMode
          ? Math.max(0.40, 1 - 0.38 * overrun)
          : Math.max(0.40, 1 - 0.30 * overrun);
        effort += this._captureEffortForWeakness(effectiveWeakness) * effortMul;
      }
    } finally {
      this._endOwnerBatch();
    }
    const avgWeakness = got > 0 ? (weaknessSum / got) : 0;
    return {
      captured: got,
      effort,
      avgWeakness,
      encircled,
      encircledFrac: got > 0 ? (encircled / got) : 0
    };
  };

  // ===== Attrition + costs =====
  World.prototype._applyWarLogisticsCost = function(A, B, contacts, dt, intensityMul = 1.0) {
    const nA = this.nation[A];
    const nB = this.nation[B];
    if (!nA || !nB) return;

    // Logistics cost scales with contact length and committed frontline troops.
    const cA = commitFraction(nA);
    const cB = commitFraction(nB);
    const aMul = 0.35 + 0.95 * cA;
    const bMul = 0.35 + 0.95 * cB;
    const costBase = contacts * WAR_GOLD_PER_CONTACT_S * dt * intensityMul;

    nA.gold = Math.max(0, (nA.gold || 0) - costBase * aMul);
    nB.gold = Math.max(0, (nB.gold || 0) - costBase * bMul);
  };

  World.prototype._applyWarCaptureGoldCost = function(attacker, capturedTiles) {
    const nA = this.nation[attacker];
    if (!nA) return;
    const cost = Math.max(0, capturedTiles) * WAR_GOLD_PER_CAPTURE_TILE;
    nA.gold = Math.max(0, (nA.gold || 0) - cost);
  };

  // Contact attrition: based on engaged committed troops and stability.
  // Optional multipliers allow attack-ops to increase intensity.
  World.prototype._applyContactCasualties = function(A, B, contacts, dt, aIntensityMul = 1.0, bIntensityMul = 1.0) {
    const nA = this.nation[A];
    const nB = this.nation[B];
    if (!nA || !nB) return;
    if (contacts <= 0 || dt <= 0) return;

    const cA = commitFraction(nA);
    const cB = commitFraction(nB);

    const stabA = this._stabilityFactor(A);
    const stabB = this._stabilityFactor(B);

    // Engagement: only committed troops can actually fight per unit time at the frontline.
    const contactCap = Math.max(1, contacts) * WAR_ENGAGE_TROOPS_PER_CONTACT;
    const committedA = Math.max(0, (nA.infantry || 0) * cA);
    const committedB = Math.max(0, (nB.infantry || 0) * cB);
    const engagedA = Math.min(committedA, contactCap);
    const engagedB = Math.min(committedB, contactCap);

    // If one side can't meaningfully engage, casualties should be small.
    const intensity = Math.min(1.0, Math.sqrt((engagedA + 1) * (engagedB + 1)) / (contactCap + 1));
    const duel = 0.75 + 0.75 * intensity;

    // Low stability increases losses.
    const lossMulA = lerp(WAR_STABILITY_LOSS_MUL_MAX, WAR_STABILITY_LOSS_MUL_MIN, clamp01(stabA));
    const lossMulB = lerp(WAR_STABILITY_LOSS_MUL_MAX, WAR_STABILITY_LOSS_MUL_MIN, clamp01(stabB));

    const base = WAR_FIRE_K * dt * duel;
    const lossA = engagedA * base * lossMulA * aIntensityMul;
    const lossB = engagedB * base * lossMulB * bIntensityMul;

    if (typeof this._markTilePressureAround === "function" && ((this._warfrontHotspotBudget | 0) > 0)) {
      this._warfrontHotspotBudget = Math.max(0, (this._warfrontHotspotBudget | 0) - 1);
      const hotTake = clampInt(Math.min(40, Math.max(6, contacts | 0)), 6, 40);
      const hotScratch = this._warHotspotScratch || (this._warHotspotScratch = []);
      const hotspots = this._collectFrontlineCandidates(A, B, hotTake, Math.max(220, hotTake * 22), hotScratch);
      if (hotspots && hotspots.length > 0) {
        const totalLoss = Math.max(0, lossA + lossB);
        const perTile = totalLoss / Math.max(1, hotspots.length * 18);
        const pressure = Math.max(0.35, Math.min(3.8, perTile));
        for (let i = 0; i < hotspots.length; i++) {
          this._markTilePressureAround(hotspots[i] | 0, pressure);
        }
      }
    }

    nA.infantry = Math.max(0, (nA.infantry || 0) - lossA);
    nB.infantry = Math.max(0, (nB.infantry || 0) - lossB);
  };

  // Capture casualties are in addition to occupation cost.
  // Losses are based on commitment + stability.
  World.prototype._applyWarCaptureCasualties = function(attacker, defender, capturedTiles, attackOp = null, captureMeta = null) {
    const nA = this.nation[attacker];
    const nD = this.nation[defender];
    if (!nA || !nD) return;
    if (capturedTiles <= 0) return;

    const cA = commitFraction(nA);
    const cD = commitFraction(nD);
    const stabA = this._stabilityFactor(attacker);
    const stabD = this._stabilityFactor(defender);

    const lossMulA = lerp(WAR_STABILITY_LOSS_MUL_MAX, WAR_STABILITY_LOSS_MUL_MIN, clamp01(stabA));
    const lossMulD = lerp(WAR_STABILITY_LOSS_MUL_MAX, WAR_STABILITY_LOSS_MUL_MIN, clamp01(stabD));

    // Simplified per-capture losses: mostly driven by commitment and stability.
    let aPer = WAR_CAPTURE_CASUALTIES_ATTACKER * (0.85 + 0.65 * cA) * lossMulA;
    let dPer = WAR_CAPTURE_CASUALTIES_DEFENDER * (0.85 + 0.45 * cD) * lossMulD;

    const m = (captureMeta && typeof captureMeta === "object") ? captureMeta : null;
    if (m) {
      const captured = Math.max(1, Number(m.captured) || 1);
      const avgWeakness = clamp01(Number(m.avgWeakness) || 0);
      const encircledFromFrac = Number(m.encircledFrac);
      const encircledFrac = clamp01(
        Number.isFinite(encircledFromFrac)
          ? encircledFromFrac
          : ((Math.max(0, Number(m.encircled) || 0)) / captured)
      );
      const encPressure = clamp01((encircledFrac * 0.62) + (avgWeakness * 0.38));
      const atkMul = Math.max(0.72, 1 - encPressure * 0.24);
      const defMul = Math.min(1.42, 1 + encPressure * 0.34);
      aPer *= atkMul;
      dPer *= defMul;
    }

    const aLoss = capturedTiles * aPer;
    const dLoss = capturedTiles * dPer;

    // Track defender losses for UI (enemy casualties) when this capture is part of an attack operation.
    if (attackOp && this._isAttackOperation(attackOp) && ((attackOp.attacker | 0) === (attacker | 0))) {
      attackOp.enemyCasualties = Math.max(0, Number(attackOp.enemyCasualties) || 0) + dLoss;
    }

    if (attackOp && this._isAttackOperation(attackOp) && ((attackOp.attacker | 0) === (attacker | 0))) {
      this._spendAttackPool(attackOp, aLoss);
    } else {
      nA.infantry = Math.max(0, (nA.infantry || 0) - aLoss);
    }
    nD.infantry = Math.max(0, (nD.infantry || 0) - dLoss);
  };

  // Approximate contact length between A and B from sampled frontline candidates.
  World.prototype._estimateContactCount = function(A, B, ownerVersionHint = (this.ownerVersion | 0)) {
    const a = A | 0;
    const b = B | 0;
    if (a <= 0 || b <= 0 || a === b) return 0;

    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = this._pair(lo, hi);
    const now = Number(this.time) || 0;
    const terrVer = this._nationTerritoryVersion;
    const vA = terrVer ? (terrVer[a] >>> 0) : (ownerVersionHint >>> 0);
    const vB = terrVer ? (terrVer[b] >>> 0) : (ownerVersionHint >>> 0);
    const cache = this._warContactCache;
    const cached = cache ? cache.get(key) : null;
    const ttl = 0.40;
    if (
      cached &&
      (cached.vA >>> 0) === vA &&
      (cached.vB >>> 0) === vB &&
      Number.isFinite(cached.at) &&
      (now - cached.at) <= ttl
    ) {
      return cached.count | 0;
    }

    const bA = this._borderSet[a];
    const bB = this._borderSet[b];
    if (!bA || bA.size === 0 || !bB || bB.size === 0) {
      if (cache) cache.set(key, { at: now, vA, vB, count: 0 });
      return 0;
    }

    const pairTotal = this._warfrontPairTotal | 0;
    const take = pairTotal >= 80 ? 72 : (pairTotal >= 56 ? 96 : (pairTotal >= 36 ? 132 : 180));
    const scanCapRaw = pairTotal >= 80 ? 1800 : (pairTotal >= 56 ? 2800 : (pairTotal >= 36 ? 3600 : 5200));
    const scanA = bA.size <= bB.size;
    const scanSet = scanA ? bA : bB;
    const from = scanA ? a : b;
    const to = scanA ? b : a;
    const scanCap = Math.min(scanSet.size | 0, scanCapRaw | 0);
    if (scanCap <= 0) {
      if (cache) cache.set(key, { at: now, vA, vB, count: 0 });
      return 0;
    }

    let hits = 0;
    let scanned = 0;
    let it = scanSet.values();
    const skip = (this._rng() * Math.max(1, scanSet.size | 0)) | 0;
    for (let s = 0; s < skip; s++) {
      const n = it.next();
      if (n.done) {
        it = scanSet.values();
        break;
      }
    }

    while (scanned < scanCap && hits < take) {
      let n = it.next();
      if (n.done) {
        it = scanSet.values();
        n = it.next();
        if (n.done) break;
      }
      const idx = n.value | 0;
      scanned++;
      if ((this.owner[idx] | 0) !== from) continue;
      if (this._touchesOwner4(idx, to)) hits++;
    }

    const count = hits | 0;
    if (cache) cache.set(key, { at: now, vA, vB, count });
    return count;
  };

  // ===== Defence Posts (tile-level capture resistance) =====
  World.prototype._defencePostStacksAt = function(ownerId, idx) {
    const r = Number(DEFENCE_POST_RADIUS_TILES) || 0;
    if (r <= 0) return 0;

    const w = this.w;
    const x = idx % w;
    const y = (idx / w) | 0;
    const r2 = r * r;

    const oid = ownerId | 0;
    let stacks = 0;
    const useCached = !!this._defencePostCacheReady;
    const list = useCached
      ? (this._defencePostsByOwner?.[oid] || [])
      : (this.structures || []);
    if (!list.length) return 0;

    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (!st) continue;
      if (!useCached) {
        if (String(st.type || "") !== "defence_post") continue;
        if ((st.owner | 0) !== oid) continue;
      }

      const dx = (st.x | 0) - x;
      const dy = (st.y | 0) - y;
      if ((dx * dx + dy * dy) <= r2) {
        stacks += (st.count | 0) || 1;
      }
    }

    return stacks;
  };

  World.prototype._defencePostBonusAt = function(ownerId, idx) {
    const stacks = this._defencePostStacksAt(ownerId, idx);
    if (stacks <= 0) return 0;
    const maxBonus = clamp01(DEFENCE_POST_MAX_BONUS);
    const k = Math.max(0, Number(DEFENCE_POST_STACK_K) || 0);
    if (maxBonus <= 0 || k <= 0) return 0;
    return maxBonus * (1 - Math.exp(-k * stacks));
  };

  World.prototype._capitalDefenceBonusAt = function(ownerId, idx) {
    const r = Number(CAPITAL_DEFENCE_RADIUS_TILES) || 0;
    const maxBonus = clamp01(CAPITAL_DEFENCE_BONUS);
    if (r <= 0 || maxBonus <= 0) return 0;

    const oid = ownerId | 0;
    const capId = this.nation?.[oid]?.capital | 0;
    if (!capId) return 0;

    const cap = this._structureById?.get(capId);
    if (!cap || String(cap.type || "") !== "capital") return 0;

    const w = this.w | 0;
    const x = idx % w;
    const y = (idx / w) | 0;
    const dx = (cap.x | 0) - x;
    const dy = (cap.y | 0) - y;
    if ((dx * dx + dy * dy) > (r * r)) return 0;

    return maxBonus;
  };

  World.prototype._defenceBonusAt = function(ownerId, idx) {
    const post = this._defencePostBonusAt(ownerId, idx);
    const cap = this._capitalDefenceBonusAt(ownerId, idx);
    if (post <= 0 && cap <= 0) return 0;
    let bonus = 0;
    if (post <= 0) bonus = cap;
    else if (cap <= 0) bonus = post;
    else bonus = clamp01(post + cap * (1 - post));

    const oid = ownerId | 0;
    const n = this.nation?.[oid];
    if (!n || !n.alive) return bonus;

    const commit = commitFraction(n);
    const defendReady = Math.max(0, (Number(n.infantry) || 0) * commit);
    const breakPoint = Math.max(14, WAR_MIN_INF_TO_ADVANCE * 0.32);
    if (n.collapsed || defendReady < breakPoint) {
      const readiness = clamp01(defendReady / breakPoint);
      const floor = n.collapsed ? 0.22 : 0.36;
      const scale = floor + (1 - floor) * readiness;
      bonus *= scale;
    }

    return bonus;
  };

  World.prototype._defenceBlocksCapture = function(defenderId, idx, weaknessBonus = 0) {
    const bonus = this._defenceBonusAt(defenderId, idx);
    if (bonus <= 0) return false;

    // Bonus is a capture-resistance percentage (0..1). Keep a hard floor so captures always progress.
    const weak = Math.max(0, Number(weaknessBonus) || 0);
    const chance = Math.min(0.90, Math.max(0.27, 1 - bonus + weak));
    return this._rng() > chance;
  };

  // Stability factor: 0.32..1.00. Lower = weaker pushes + higher losses.
  World.prototype._stabilityFactor = function(id) {
    const n = this.nation[id];
    const land = Math.max(1, this.landOwnedCount[id] | 0);
    const cities = Math.max(0, this._cityCount[id] | 0);
    const citySupport = Math.min(1, cities / Math.max(1, 2 + (land / 520)));
    const mobilization = clamp01(Number(n?.mobilization ?? 0.45));
    const exRaw = this._warExhaustion ? this._warExhaustion[id] : (n?.warExhaustion ?? 0);
    const exhaustion = clamp01(Number(exRaw) || 0);
    const exhaustionPenalty = Math.max(0, Number(WAR_EXHAUSTION_STABILITY_MAX_PENALTY) || 0.10) * Math.pow(exhaustion, 1.15);
    const activeWarPenalty = this._anyWar(id) ? Math.max(0, Number(WAR_STABILITY_BASE_WAR_PENALTY) || 0.02) : 0.0;
    const warPenalty = activeWarPenalty + exhaustionPenalty;
    const s = 0.64 + 0.30 * citySupport - 0.16 * mobilization - warPenalty;
    return Math.max(WAR_MIN_STABILITY, Math.min(1.0, s));
  };

  World.prototype._bordersTouch = function(A, B, ownerVersionHint = (this.ownerVersion | 0)) {
    const a = A | 0;
    const b = B | 0;
    if (a <= 0 || b <= 0 || a === b) return false;

    if (!this._bordersTouchCache) this._bordersTouchCache = new Map();

    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const cacheKey = this._pair(lo, hi);
    const terrVer = this._nationTerritoryVersion;
    const vLo = terrVer ? (terrVer[lo] >>> 0) : (ownerVersionHint >>> 0);
    const vHi = terrVer ? (terrVer[hi] >>> 0) : (ownerVersionHint >>> 0);
    const now = Number(this.time) || 0;
    const cached = this._bordersTouchCache.get(cacheKey);
    if (cached && ((cached.vLo >>> 0) === vLo) && ((cached.vHi >>> 0) === vHi)) {
      if ((cached.t | 0) === 1) return true;
      if ((Number(cached.until) || 0) > now) return false;
    }

    const bA = this._borderSet[a];
    const bB = this._borderSet[b];
    if (!bA || bA.size === 0 || !bB || bB.size === 0) {
      this._bordersTouchCache.set(cacheKey, { vLo, vHi, t: 0 });
      return false;
    }

    const scanA = bA.size <= bB.size;
    const scanSet = scanA ? bA : bB;
    const from = scanA ? a : b;
    const to = scanA ? b : a;

    const pairTotal = this._warfrontPairTotal | 0;
    const MAX_CHECKS = pairTotal >= 80 ? 2000 : (pairTotal >= 56 ? 3200 : (pairTotal >= 36 ? 5200 : 12000));
    let checks = 0;
    let truncated = false;
    let touches = false;
    let it = scanSet.values();
    const skip = (this._rng() * scanSet.size) | 0;
    for (let s = 0; s < skip; s++) {
      const n = it.next();
      if (n.done) {
        it = scanSet.values();
        break;
      }
    }

    const scanCap = Math.min(scanSet.size, MAX_CHECKS);
    while (checks < scanCap) {
      let n = it.next();
      if (n.done) {
        it = scanSet.values();
        n = it.next();
        if (n.done) break;
      }
      const idx = n.value | 0;
      checks++;
      if ((this.owner[idx] | 0) !== from) continue;
      if (this._touchesOwner4(idx, to)) {
        touches = true;
        break;
      }
    }
    truncated = scanSet.size > scanCap;

    // Cache definitive results only; avoid sticky false when scan was capped.
    if (touches) {
      this._bordersTouchCache.set(cacheKey, { vLo, vHi, t: 1, until: 0 });
    } else {
      const ttl = truncated ? 0.22 : 1.20;
      this._bordersTouchCache.set(cacheKey, { vLo, vHi, t: 0, until: now + ttl });
    }
    return touches;
  };
}
