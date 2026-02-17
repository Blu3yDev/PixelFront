// FILE: src/game/systems/airborne.js

import {
  AIRBASE_LAUNCH_RADIUS_TILES,
  AIRBASE_TRANSPORT_BUILD_GOLD_COST,
  AIRBASE_TRANSPORT_BUILD_TIME_S,
  AIRBORNE_COMMIT_FRAC,
  AIRBORNE_COMMIT_MAX_INFANTRY,
  AIRBORNE_COMMIT_MIN_INFANTRY,
  AIRBORNE_DROP_PIXELS_MAX,
  AIRBORNE_DROP_PIXELS_MIN,
  AIRBORNE_DROP_SPREAD_TILES,
  AIRBORNE_EXPAND_DURATION_S,
  AIRBORNE_PLANE_SPEED_TILES_PER_S,
  AIRBORNE_TILE_COST_ENEMY,
  AIRBORNE_TILE_COST_NEUTRAL,
  EXPAND_INFANTRY_RESERVE_FRAC,
  EXPAND_INFANTRY_RESERVE_MIN,
  OWNER
} from "../config.js";
import { clamp01, clampInt } from "../utils.js";

export function installAirborne(World) {
  World.prototype._getAirbaseById = function(structId) {
    const sid = structId | 0;
    if (!sid) return null;
    const st = this._structureById.get(sid);
    if (!st) return null;
    if (String(st.type || "") !== "airbase") return null;
    return st;
  };

  World.prototype._ensureAirbaseData = function(st) {
    if (!st || String(st.type || "") !== "airbase") return null;
    if (!st.data || typeof st.data !== "object") st.data = {};
    if (!st.data.airbase || typeof st.data.airbase !== "object") {
      st.data.airbase = {
        buildRemainingS: 0,
        buildTotalS: 0,
        readyTransports: 0
      };
    }
    const d = st.data.airbase;
    d.buildRemainingS = Math.max(0, Number(d.buildRemainingS) || 0);
    d.buildTotalS = Math.max(0, Number(d.buildTotalS) || 0);
    d.readyTransports = Math.max(0, d.readyTransports | 0);
    return d;
  };

  World.prototype._clearAirbaseState = function(st) {
    const d = this._ensureAirbaseData(st);
    if (!d) return;
    d.buildRemainingS = 0;
    d.buildTotalS = 0;
    d.readyTransports = 0;
    this._activeAirbaseBuildIds.delete(st.id | 0);
  };

  World.prototype.getAirbaseStatus = function(structId, ownerId = OWNER.PLAYER) {
    const st = this._getAirbaseById(structId | 0);
    if (!st) return { ok: false, reason: "Airbase not found." };

    const oid = ownerId | 0;
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Airbase." };

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const d = this._ensureAirbaseData(st);
    const buildRemainingS = Math.max(0, Number(d.buildRemainingS) || 0);
    const buildTotalS = Math.max(0, Number(d.buildTotalS) || 0);
    const isBuilding = buildRemainingS > 0.00001 && buildTotalS > 0;
    const readyTransports = Math.max(0, d.readyTransports | 0);
    const buildProgress01 = isBuilding
      ? Math.max(0, Math.min(1, 1 - (buildRemainingS / Math.max(0.1, buildTotalS))))
      : (readyTransports > 0 ? 1 : 0);
    const ownerGold = Math.max(0, Number(nat.gold) || 0);
    const reserveInf = Math.max(
      Number(EXPAND_INFANTRY_RESERVE_MIN) || 0,
      (Number(nat.infantry) || 0) * (Number(EXPAND_INFANTRY_RESERVE_FRAC) || 0)
    );
    const availableInfantry = Math.max(0, (Number(nat.infantry) || 0) - reserveInf);
    const launchMinInfantry = Math.max(1, Number(AIRBORNE_COMMIT_MIN_INFANTRY) || 1);
    const buildGoldCost = Math.max(0, Math.floor(Number(AIRBASE_TRANSPORT_BUILD_GOLD_COST) || 0));
    const buildTimeS = Math.max(1, Math.floor(Number(AIRBASE_TRANSPORT_BUILD_TIME_S) || 1));
    const launchRadiusTiles = Math.max(1, Math.floor(Number(AIRBASE_LAUNCH_RADIUS_TILES) || 1));
    const canLaunch = readyTransports > 0 && availableInfantry >= launchMinInfantry;

    return {
      ok: true,
      reason: "",
      airbaseId: st.id | 0,
      owner: st.owner | 0,
      ownerGold,
      readyTransports,
      buildRemainingS,
      buildTotalS,
      buildProgress01,
      isIdle: !isBuilding && readyTransports <= 0,
      isBuilding,
      isReady: readyTransports > 0,
      canLaunch,
      transport: {
        buildGoldCost,
        buildTimeS,
        launchRadiusTiles,
        affordable: ownerGold >= buildGoldCost,
        launchMinInfantry,
        availableInfantry
      }
    };
  };

  World.prototype.startAirbaseTransportBuild = function(structId, ownerId) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const oid = ownerId | 0;
    const st = this._getAirbaseById(structId | 0);
    if (!st) return { ok: false, reason: "Airbase not found." };
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Airbase." };

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const d = this._ensureAirbaseData(st);
    if ((Number(d.buildRemainingS) || 0) > 0.00001) return { ok: false, reason: "This Airbase is already building a transport plane." };
    if ((d.readyTransports | 0) > 0) return { ok: false, reason: "Transport ready. Launch it before starting another build." };

    const cost = Math.max(0, Math.floor(Number(AIRBASE_TRANSPORT_BUILD_GOLD_COST) || 0));
    if ((nat.gold || 0) < cost) return { ok: false, reason: `Not enough gold (need ${cost}).` };

    nat.gold = Math.max(0, (nat.gold || 0) - cost);
    d.buildTotalS = Math.max(0.1, Number(AIRBASE_TRANSPORT_BUILD_TIME_S) || 0.1);
    d.buildRemainingS = d.buildTotalS;
    this._activeAirbaseBuildIds.add(st.id | 0);

    if (oid === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(oid)} started building a Transport Plane.`);
    }
    return { ok: true, reason: "", status: this.getAirbaseStatus(st.id | 0, oid) };
  };

  World.prototype.launchAirbaseTransport = function(structId, ownerId, targetX, targetY) {
    if (this.gameOver) return { ok: false, reason: "Game over." };
    const oid = ownerId | 0;
    const st = this._getAirbaseById(structId | 0);
    if (!st) return { ok: false, reason: "Airbase not found." };
    if ((st.owner | 0) !== oid) return { ok: false, reason: "You do not control this Airbase." };

    const nat = this.nation[oid];
    if (!nat || !nat.alive) return { ok: false, reason: "Invalid owner." };

    const tx = clampInt(targetX | 0, 0, this.w - 1);
    const ty = clampInt(targetY | 0, 0, this.h - 1);
    const targetIdx = ty * this.w + tx;
    if (!this.land[targetIdx]) return { ok: false, reason: "Airborne transport can only target land tiles." };
    const targetOwner = this.owner[targetIdx] | 0;
    if (targetOwner > OWNER.NONE && targetOwner !== oid) {
      const rel = this.getRelation(oid, targetOwner);
      if (rel.allied) return { ok: false, reason: "Cannot launch airborne assaults onto allied territory." };
    }

    const d = this._ensureAirbaseData(st);
    if ((Number(d.buildRemainingS) || 0) > 0.00001) return { ok: false, reason: "Transport plane still building." };
    if ((d.readyTransports | 0) <= 0) return { ok: false, reason: "No ready transport plane at this Airbase." };

    const launchRadiusTiles = Math.max(1, Number(AIRBASE_LAUNCH_RADIUS_TILES) || 1);
    const sx = (st.x | 0) + 0.5;
    const sy = (st.y | 0) + 0.5;
    const ex = tx + 0.5;
    const ey = ty + 0.5;
    const dist = Math.hypot(ex - sx, ey - sy);
    if (dist > launchRadiusTiles) {
      return { ok: false, reason: `Target is out of range (max ${Math.floor(launchRadiusTiles)} tiles).` };
    }

    const reserveInf = Math.max(
      Number(EXPAND_INFANTRY_RESERVE_MIN) || 0,
      (Number(nat.infantry) || 0) * (Number(EXPAND_INFANTRY_RESERVE_FRAC) || 0)
    );
    const availableInf = Math.max(0, (Number(nat.infantry) || 0) - reserveInf);
    const desiredCommit = clampInt(
      Math.floor((Number(nat.infantry) || 0) * (Number(AIRBORNE_COMMIT_FRAC) || 0)),
      Math.max(1, Number(AIRBORNE_COMMIT_MIN_INFANTRY) || 1),
      Math.max(1, Number(AIRBORNE_COMMIT_MAX_INFANTRY) || 1)
    );
    const committedInfantry = clampInt(
      Math.floor(Math.min(desiredCommit, availableInf)),
      0,
      Math.max(1, Number(AIRBORNE_COMMIT_MAX_INFANTRY) || 1)
    );
    const minCommit = Math.max(1, Number(AIRBORNE_COMMIT_MIN_INFANTRY) || 1);
    if (committedInfantry < minCommit) {
      return { ok: false, reason: `Not enough infantry available for airborne launch (need at least ${minCommit} free troops).` };
    }

    d.readyTransports = Math.max(0, (d.readyTransports | 0) - 1);
    this._activeAirbaseBuildIds.delete(st.id | 0);
    nat.infantry = Math.max(0, (Number(nat.infantry) || 0) - committedInfantry);

    const planeSpeed = Math.max(1, Number(AIRBORNE_PLANE_SPEED_TILES_PER_S) || 1);
    const dropCount = clampInt(
      Math.round(committedInfantry / 24),
      Math.max(1, Number(AIRBORNE_DROP_PIXELS_MIN) || 1),
      Math.max(1, Number(AIRBORNE_DROP_PIXELS_MAX) || 1)
    );

    const mission = {
      id: this._nextAirborneMissionId++,
      kind: "airborne",
      owner: oid,
      airbaseId: st.id | 0,
      startX: sx,
      startY: sy,
      targetX: ex,
      targetY: ey,
      planeX: sx,
      planeY: sy,
      dirX: dist > 0.00001 ? (ex - sx) / dist : 1,
      dirY: dist > 0.00001 ? (ey - sy) / dist : 0,
      speedTilesPerS: planeSpeed,
      dropCount,
      dropSpreadTiles: Math.max(3, Number(AIRBORNE_DROP_SPREAD_TILES) || 3),
      dropPixels: [],
      dropsLanded: 0,
      phase: "flight", // flight -> drop -> expand -> done
      phaseElapsedS: 0,
      expandElapsedS: 0,
      expandDurationS: Math.max(4, Number(AIRBORNE_EXPAND_DURATION_S) || 4),
      carry: 0,
      frontier: [],
      frontierSet: new Set(),
      troopPool: committedInfantry,
      troopSpent: 0,
      troopsInitial: committedInfantry,
      capturedTiles: 0,
      launchedAt: Number(this.time) || 0
    };
    this.airborneMissions.push(mission);

    if (oid === OWNER.PLAYER) {
      this._pushEvent(`${this._nameOf(oid)} launched a Transport Plane from Airbase #${st.id | 0}.`);
    }

    return {
      ok: true,
      reason: "",
      launch: {
        airbaseId: st.id | 0,
        fromX: sx,
        fromY: sy,
        targetX: ex,
        targetY: ey,
        radiusTiles: launchRadiusTiles,
        committedInfantry,
        dropCount
      },
      mission,
      status: this.getAirbaseStatus(st.id | 0, oid)
    };
  };

  World.prototype._airborneAddFrontier = function(mission, idxRaw) {
    if (!mission) return;
    const idx = idxRaw | 0;
    if (idx < 0 || idx >= (this.w * this.h)) return;
    const set = mission.frontierSet;
    if (!set || set.has(idx)) return;
    set.add(idx);
    mission.frontier.push(idx);
  };

  World.prototype._airborneRemoveFrontierAt = function(mission, posRaw) {
    if (!mission || !Array.isArray(mission.frontier)) return;
    const pos = posRaw | 0;
    const arr = mission.frontier;
    if (pos < 0 || pos >= arr.length) return;
    const removed = arr[pos] | 0;
    const last = arr[arr.length - 1] | 0;
    arr[pos] = last;
    arr.pop();
    if (mission.frontierSet) mission.frontierSet.delete(removed);
  };

  World.prototype._airborneTryCaptureTile = function(mission, idxRaw, landingCapture = false) {
    if (!mission) return false;
    const idx = idxRaw | 0;
    if (idx < 0 || idx >= (this.w * this.h)) return false;
    if (!this.land[idx]) return false;

    const attacker = mission.owner | 0;
    const curOwner = this.owner[idx] | 0;
    if (curOwner === attacker) return false;
    if ((mission.troopPool || 0) <= 0.05) return false;

    if (curOwner > OWNER.NONE) {
      const rel = this.getRelation(attacker, curOwner);
      if (rel.allied) return false;
      if (!rel.atWar) {
        const warRes = this.declareWar(attacker, curOwner);
        if (!warRes?.ok) return false;
      }
    }

    let cost = curOwner <= OWNER.NONE
      ? Math.max(0.2, Number(AIRBORNE_TILE_COST_NEUTRAL) || 0.2)
      : Math.max(0.4, Number(AIRBORNE_TILE_COST_ENEMY) || 0.4);
    if (landingCapture) cost *= 0.86;
    if (curOwner > OWNER.NONE && typeof this._defenceBonusAt === "function") {
      const defenceBonus = clamp01(Number(this._defenceBonusAt(curOwner, idx)) || 0);
      cost *= (1 + defenceBonus * 0.90);
    }
    if ((mission.troopPool || 0) < cost) return false;

    this._setOwner(idx, attacker);
    mission.troopPool = Math.max(0, (Number(mission.troopPool) || 0) - cost);
    mission.troopSpent = Math.max(0, (Number(mission.troopSpent) || 0) + cost);
    mission.capturedTiles = (mission.capturedTiles | 0) + 1;
    this._airborneAddFrontier(mission, idx);

    if (curOwner > OWNER.NONE && curOwner !== attacker) {
      const defNat = this.nation[curOwner];
      if (defNat && defNat.alive) {
        const loss = cost * 0.45;
        defNat.infantry = Math.max(0, (Number(defNat.infantry) || 0) - loss);
      }
    }

    return true;
  };

  World.prototype._airborneClaimLandingPatch = function(mission, landX, landY) {
    if (!mission) return;
    const cx = clampInt(Math.floor(Number(landX) || 0), 0, this.w - 1);
    const cy = clampInt(Math.floor(Number(landY) || 0), 0, this.h - 1);
    for (let yy = cy - 1; yy <= cy + 2; yy++) {
      if (yy < 0 || yy >= this.h) continue;
      for (let xx = cx - 1; xx <= cx + 2; xx++) {
        if (xx < 0 || xx >= this.w) continue;
        const idx = yy * this.w + xx;
        this._airborneTryCaptureTile(mission, idx, true);
      }
    }
  };

  World.prototype._airborneBeginDropPhase = function(mission) {
    if (!mission) return;
    mission.phase = "drop";
    mission.phaseElapsedS = 0;
    mission.expandElapsedS = 0;
    mission.dropsLanded = 0;
    if (!Array.isArray(mission.dropPixels)) mission.dropPixels = [];
    mission.dropPixels.length = 0;

    const tx = Number(mission.targetX) || 0.5;
    const ty = Number(mission.targetY) || 0.5;
    const dirX = Number(mission.dirX) || 1;
    const dirY = Number(mission.dirY) || 0;
    const perpX = -dirY;
    const perpY = dirX;
    const spreadBase = Math.max(2, Number(mission.dropSpreadTiles) || 2);
    const spread = spreadBase * (1.12 + this._rng() * 0.36);
    const dropCount = Math.max(1, mission.dropCount | 0);

    for (let i = 0; i < dropCount; i++) {
      const ang = (this._rng() * Math.PI * 2);
      let radial01 = 0;
      const mix = this._rng();
      if (mix < 0.34) radial01 = Math.pow(this._rng(), 1.65); // center-fill component
      else if (mix < 0.88) radial01 = Math.sqrt(this._rng()); // area-uniform disk
      else radial01 = Math.pow(this._rng(), 0.42); // occasional far scatter
      const rad = radial01 * spread * (0.84 + this._rng() * 0.44);
      const landX = Math.max(0.5, Math.min(this.w - 0.5, tx + Math.cos(ang) * rad + (this._rng() - 0.5) * 1.5));
      const landY = Math.max(0.5, Math.min(this.h - 0.5, ty + Math.sin(ang) * rad + (this._rng() - 0.5) * 1.5));
      const startBack = 1.6 + this._rng() * 1.8;
      const startSide = (this._rng() - 0.5) * 2.1;
      const startX = tx - dirX * startBack + perpX * startSide;
      const startY = ty - dirY * startBack + perpY * startSide;
      mission.dropPixels.push({
        x: startX,
        y: startY,
        startX,
        startY,
        landX,
        landY,
        progress: 0,
        speedMul: 0.58 + this._rng() * 0.62,
        landed: false
      });
    }
  };

  World.prototype._tickAirborneDropMission = function(mission, step) {
    if (!mission) return;
    mission.phaseElapsedS = (Number(mission.phaseElapsedS) || 0) + step;
    if (!Array.isArray(mission.dropPixels) || mission.dropPixels.length <= 0) {
      mission.phase = "expand";
      mission.phaseElapsedS = 0;
      return;
    }

    // Plane keeps drifting slowly while troops are dropping.
    mission.planeX = Math.max(0.5, Math.min(this.w - 0.5, (Number(mission.planeX) || 0.5) + (Number(mission.dirX) || 0) * step * 0.95));
    mission.planeY = Math.max(0.5, Math.min(this.h - 0.5, (Number(mission.planeY) || 0.5) + (Number(mission.dirY) || 0) * step * 0.95));

    let pending = 0;
    this._beginOwnerBatch();
    try {
      for (let i = 0; i < mission.dropPixels.length; i++) {
        const p = mission.dropPixels[i];
        if (!p) continue;
        if (p.landed) continue;
        const mul = Math.max(0.15, Number(p.speedMul) || 0.15);
        p.progress = Math.max(0, Math.min(1, (Number(p.progress) || 0) + step * (0.44 + mul * 0.32)));
        const t = p.progress;
        p.x = (Number(p.startX) || 0) + ((Number(p.landX) || 0) - (Number(p.startX) || 0)) * t;
        p.y = (Number(p.startY) || 0) + ((Number(p.landY) || 0) - (Number(p.startY) || 0)) * t;
        if (t >= 0.999) {
          p.landed = true;
          p.x = Number(p.landX) || p.x;
          p.y = Number(p.landY) || p.y;
          mission.dropsLanded = (mission.dropsLanded | 0) + 1;
          this._airborneClaimLandingPatch(mission, p.landX, p.landY);
        } else {
          pending++;
        }
      }

      if (pending > 0 && mission.phaseElapsedS <= 5.2) return;

      // Safety finalize: force-complete any slow drops.
      for (let i = 0; i < mission.dropPixels.length; i++) {
        const p = mission.dropPixels[i];
        if (!p || p.landed) continue;
        p.landed = true;
        p.progress = 1;
        p.x = Number(p.landX) || p.x;
        p.y = Number(p.landY) || p.y;
        mission.dropsLanded = (mission.dropsLanded | 0) + 1;
        this._airborneClaimLandingPatch(mission, p.landX, p.landY);
      }
    } finally {
      this._endOwnerBatch();
    }

    mission.phase = "expand";
    mission.phaseElapsedS = 0;
    mission.expandElapsedS = 0;
    if ((mission.owner | 0) === OWNER.PLAYER) {
      this._pushEvent("Airborne infantry landed and established footholds.");
    }
  };

  World.prototype._tickAirborneExpandMission = function(mission, step) {
    if (!mission) return;
    mission.expandElapsedS = (Number(mission.expandElapsedS) || 0) + step;
    if ((Number(mission.troopPool) || 0) <= 0.25) {
      mission.phase = "done";
      return;
    }
    if ((Number(mission.expandDurationS) || 0) > 0 && mission.expandElapsedS >= (Number(mission.expandDurationS) || 0)) {
      mission.phase = "done";
      return;
    }
    if (!Array.isArray(mission.frontier) || mission.frontier.length <= 0) {
      mission.phase = "done";
      return;
    }

    const frontierLen = mission.frontier.length;
    const workRate = 10 + Math.sqrt(Math.max(1, frontierLen)) * 2.6;
    mission.carry = (Number(mission.carry) || 0) + step * workRate;
    let attempts = Math.min(96, Math.floor(mission.carry));
    if (attempts <= 0) return;
    mission.carry -= attempts;

    this._beginOwnerBatch();
    try {
      while (attempts-- > 0) {
        if ((Number(mission.troopPool) || 0) <= 0.25) break;
        if (mission.frontier.length <= 0) break;

        const fi = (this._rng() * mission.frontier.length) | 0;
        const srcIdx = mission.frontier[fi] | 0;
        if (srcIdx < 0 || srcIdx >= (this.w * this.h) || (this.owner[srcIdx] | 0) !== (mission.owner | 0)) {
          this._airborneRemoveFrontierAt(mission, fi);
          continue;
        }

        const x = srcIdx % this.w;
        const y = (srcIdx / this.w) | 0;
        let bestIdx = -1;
        let bestScore = -1e9;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
            const ni = yy * this.w + xx;
            if (!this.land[ni]) continue;
            const owner = this.owner[ni] | 0;
            if (owner === (mission.owner | 0)) continue;

            if (owner > OWNER.NONE) {
              const rel = this.getRelation(mission.owner | 0, owner);
              if (rel.allied) continue;
            }

            const dtx = (xx + 0.5) - (Number(mission.targetX) || 0.5);
            const dty = (yy + 0.5) - (Number(mission.targetY) || 0.5);
            const dist = Math.hypot(dtx, dty);
            const targetBias = 1 / (1 + dist * 0.07);
            const defence = (owner > OWNER.NONE && typeof this._defenceBonusAt === "function")
              ? clamp01(Number(this._defenceBonusAt(owner, ni)) || 0)
              : 0;
            const score = this._rng() * 0.74 + targetBias * 0.44 - defence * 0.34;
            if (score > bestScore) {
              bestScore = score;
              bestIdx = ni;
            }
          }
        }

        if (bestIdx < 0) continue;
        const threshold = 0.32 + this._rng() * 0.22;
        if (bestScore < threshold) continue;

        if (!this._airborneTryCaptureTile(mission, bestIdx, false)) continue;
        if (this._rng() < 0.18) this._airborneAddFrontier(mission, srcIdx);
      }
    } finally {
      this._endOwnerBatch();
    }

    if ((Number(mission.troopPool) || 0) <= 0.25 || mission.frontier.length <= 0) {
      mission.phase = "done";
    }
  };

  World.prototype._tickAirborne = function(dt) {
    const step = Math.max(0, Number(dt) || 0);
    if (!(step > 0)) return;
    if (!Array.isArray(this.airborneMissions) || this.airborneMissions.length <= 0) return;

    for (let i = this.airborneMissions.length - 1; i >= 0; i--) {
      const m = this.airborneMissions[i];
      if (!m) {
        this.airborneMissions.splice(i, 1);
        continue;
      }

      const owner = m.owner | 0;
      const nat = this.nation[owner];
      if (!nat || !nat.alive) {
        this.airborneMissions.splice(i, 1);
        continue;
      }

      const phase = String(m.phase || "flight");
      if (phase === "flight") {
        const px = Number(m.planeX) || 0.5;
        const py = Number(m.planeY) || 0.5;
        const tx = Number(m.targetX) || px;
        const ty = Number(m.targetY) || py;
        const vx = tx - px;
        const vy = ty - py;
        const dist = Math.hypot(vx, vy);
        const speed = Math.max(0.25, Number(m.speedTilesPerS) || 0.25);
        const move = speed * step;
        if (dist <= move + 0.00001) {
          m.planeX = tx;
          m.planeY = ty;
          if (dist > 0.00001) {
            m.dirX = vx / dist;
            m.dirY = vy / dist;
          }
          this._airborneBeginDropPhase(m);
        } else if (dist > 0.00001) {
          const nx = vx / dist;
          const ny = vy / dist;
          m.dirX = nx;
          m.dirY = ny;
          m.planeX = px + nx * move;
          m.planeY = py + ny * move;
        }
      } else if (phase === "drop") {
        this._tickAirborneDropMission(m, step);
      } else if (phase === "expand") {
        this._tickAirborneExpandMission(m, step);
      }

      if (String(m.phase || "") !== "done") continue;

      const refundable = Math.max(0, Math.floor((Number(m.troopPool) || 0) * 0.35));
      if (refundable > 0 && nat && nat.alive) {
        nat.infantry = Math.max(0, (Number(nat.infantry) || 0) + refundable);
      }

      if (owner === OWNER.PLAYER) {
        const captured = Math.max(0, m.capturedTiles | 0);
        const initial = Math.max(0, Math.round(Number(m.troopsInitial) || 0));
        const netLoss = Math.max(0, initial - refundable);
        if (captured > 0) {
          this._pushEvent(`Airborne operation secured ${captured} tiles (net infantry loss: ${netLoss}).`);
        } else {
          this._pushEvent("Airborne operation failed to secure territory.");
        }
      }
      this.airborneMissions.splice(i, 1);
    }
  };
}

