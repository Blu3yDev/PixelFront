// FILE: src/game/systems/navy.js

import { OWNER, PORT_TRADE_COOLDOWN_S, PORT_TRADE_REWARD_BASE_GOLD, PORT_TRADE_REWARD_MAX_GOLD, PORT_TRADE_REWARD_PER_PIXEL, TRADE_EVENT_COOLDOWN_S, TRADE_SHIP_HP, TRADE_SHIP_MAX_OUTGOING, TRADE_SHIP_RESPAWN_S, TRADE_SHIP_REWARD_GOLD, TRADE_SHIP_SPEED_CPS, TRADE_TRAIL_FADE_S, TRADE_TRAIL_MAX_POINTS, TRADE_TRAIL_POINT_SPACING, TRADE_TRIP_STEPS_MAX, TRADE_TRIP_STEPS_MIN, TRADE_WANDER_MAX_S, TRADE_WANDER_MIN_S, TRANSPORT_SPEED_CPS, WARSHIP_CHASE_TILES, WARSHIP_DETECT_TILES, WARSHIP_DPS, WARSHIP_HP, WARSHIP_LAUNCH_GOLD_COST, WARSHIP_MAX_ACTIVE, WARSHIP_RAID_LOOT_TRADE_GOLD, WARSHIP_RAID_LOOT_TRANSPORT_GOLD, WARSHIP_RAID_LOOT_WARSHIP_GOLD, WARSHIP_RANGE_TILES, WARSHIP_SPEED_CPS, WAR_EVENT_COOLDOWN_S } from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

export function installNavy(World) {
  const NAVY_PATH_CACHE_MAX = 640;
  const _navySetStepOut = (out, x, y) => {
    if (!out) return { x, y };
    out.x = x | 0;
    out.y = y | 0;
    return out;
  };
  const _navySetHidden = (obj, key, value) => {
    if (!obj || typeof obj !== "object") return value;
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc) {
      Object.defineProperty(obj, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
      });
      return value;
    }
    obj[key] = value;
    return value;
  };
  const _navyFormatCooldown = (secondsRaw) => {
    const total = Math.max(0, Math.ceil(Number(secondsRaw) || 0));
    const mins = (total / 60) | 0;
    const secs = total % 60;
    return mins > 0
      ? `${mins}:${String(secs).padStart(2, "0")}`
      : `${secs}s`;
  };
  const _navyPathCacheKey = (sx, sy, gx, gy, compId) => `${compId | 0}:${sx | 0},${sy | 0}>${gx | 0},${gy | 0}`;

  World.prototype._tickNavy = function(dt) {
      if (!(dt > 0)) return;

      const ships = this.ships;
      const removeShipAt = (idxRaw) => {
        const idx = idxRaw | 0;
        const last = (ships.length - 1) | 0;
        if (idx < 0 || idx > last) return;
        const removed = ships[idx];
        if (removed) this._navyOnShipRemoved(removed);
        if (idx !== last) ships[idx] = ships[last];
        ships.pop();
      };
      if (!this._waterComp || (this._waterComp.length !== (this.w * this.h)) || !((this._waterCompCount | 0) > 0)) {
        this._recomputeWaterComponents();
      }

      // ---- Update ships (movement / trips / landing) ----
      for (let i = ships.length - 1; i >= 0; i--) {
        const s = ships[i];
        if (!s) { removeShipAt(i); continue; }

        const A = (s.owner | 0);
        const n = this.nation[A];

        // If owner is gone or lost all ports, ships vanish.
        if (!n || !n.alive || ((this._portCount[A] | 0) <= 0)) {
          removeShipAt(i);
          continue;
        }

        const kind = String(s.kind || "");

        if (kind === "trade") {
          if ((s.sourcePortId | 0) > 0) {
            const sourcePort = this._structureById && typeof this._structureById.get === "function"
              ? this._structureById.get(s.sourcePortId | 0)
              : null;
            const targetOwnerId = s.targetOwnerId | 0;
            const targetPort = this._structureById && typeof this._structureById.get === "function"
              ? this._structureById.get(s.targetPortId | 0)
              : null;
            const allied = targetOwnerId > 0 && typeof this.getRelation === "function"
              ? !!this.getRelation(A, targetOwnerId)?.allied
              : false;
            if (!sourcePort || (sourcePort.owner | 0) !== A || String(sourcePort.type || "") !== "port" || !allied) {
              removeShipAt(i);
              continue;
            }
            if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(sourcePort)) {
              removeShipAt(i);
              continue;
            }
            if (!targetPort || String(targetPort.type || "") !== "port" || (targetPort.owner | 0) !== targetOwnerId) {
              removeShipAt(i);
              continue;
            }
          }

          s.speed = TRADE_SHIP_SPEED_CPS;
          if (s.mode !== "toPort" && s.mode !== "wander") this._navyAssignTradeTrip(s);

          this._navyAdvanceTradeShip(s, dt);
          this._navyUpdateTradeTrail(s);

          const arrived = (s.nx == null && s.ny == null &&
            ((s.cx | 0) === (s.tx | 0)) &&
            ((s.cy | 0) === (s.ty | 0)));

          if (!arrived) continue;

          if (s.mode === "toPort") {
            if ((s.sourcePortId | 0) > 0) {
              const reward = Math.max(0, Math.round(Number(s.tradeRewardGold) || 0));
              const completedSourcePort = this._structureById && typeof this._structureById.get === "function"
                ? this._structureById.get(s.sourcePortId | 0)
                : null;
              n.gold += reward;
              if (completedSourcePort && String(completedSourcePort.type || "") === "port") this._navyCompletePortTrade(completedSourcePort);
              if (A === OWNER.PLAYER && this.time >= this._tradeEventCooldownUntil[A]) {
                this._tradeEventCooldownUntil[A] = this.time + TRADE_EVENT_COOLDOWN_S;
                this._pushEvent(`Trade route completed (+${Math.round(reward)} Gold).`, {
                  kind: "trade_route_success",
                  from: A,
                  to: A,
                  rewardGold: Math.round(reward)
                });
              }
              removeShipAt(i);
              continue;
            }

            // Trip complete: payout, then despawn and respawn after a cooldown (per-port-slot ship).
            const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(A) : null;
            const rewardMul = 1 + Math.max(0, Number(researchBonuses?.tradeShipRewardMul) || 0);
            const reward = Math.max(0, TRADE_SHIP_REWARD_GOLD * rewardMul);
            n.gold += reward;

            if (A === OWNER.PLAYER && this.time >= this._tradeEventCooldownUntil[A]) {
              this._tradeEventCooldownUntil[A] = this.time + TRADE_EVENT_COOLDOWN_S;
              this._pushEvent(`Trade ship returned (+${Math.round(reward)} Gold).`, {
                kind: "trade_route_success",
                from: A,
                to: A,
                rewardGold: Math.round(reward)
              });
            }

            this._navySetTradeSlotCooldown(A, s.portKey, TRADE_SHIP_RESPAWN_S);
            removeShipAt(i);
            continue;
          }

          // Wander mode:
          // - If any non-owner port appears on the same water body, switch to it.
          // - Otherwise, roam until the wander timer ends, then pay out once.
          const compId = (s.comp | 0) || this._navyWaterCompAt((s.cx | 0), (s.cy | 0));
          s.comp = compId | 0;

          const destNow = this._navyPickOtherPortWaterTarget(A, compId, (s.cx | 0), (s.cy | 0));
          if (destNow) {
            s.mode = "toPort";
            s.tx = destNow.x | 0;
            s.ty = destNow.y | 0;
            s.wanderUntil = 0;
            this._navyClearShipRoute(s);
            s.nx = null; s.ny = null; s.seg = 0;
            continue;
          }

          if (this.time >= (Number(s.wanderUntil) || 0)) {
            const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(A) : null;
            const rewardMul = 1 + Math.max(0, Number(researchBonuses?.tradeShipRewardMul) || 0);
            const reward = Math.max(0, TRADE_SHIP_REWARD_GOLD * rewardMul);
            n.gold += reward;

            if (A === OWNER.PLAYER && this.time >= this._tradeEventCooldownUntil[A]) {
              this._tradeEventCooldownUntil[A] = this.time + TRADE_EVENT_COOLDOWN_S;
              this._pushEvent(`Trade route completed (+${Math.round(reward)} Gold).`, {
                kind: "trade_route_success",
                from: A,
                to: A,
                rewardGold: Math.round(reward)
              });
            }

            this._navySetTradeSlotCooldown(A, s.portKey, TRADE_SHIP_RESPAWN_S);
            removeShipAt(i);
            continue;
          }

          // Keep wandering: retarget to a new far-ish water tile.
          let t = null;
          for (let k = 0; k < 4; k++) {
            t = this._navyPickTradeTargetFromWater((s.cx | 0), (s.cy | 0));
            if (!t) continue;
            const md = Math.abs((t.x | 0) - (s.cx | 0)) + Math.abs((t.y | 0) - (s.cy | 0));
            if (md >= 12) break;
            t = null;
          }
          if (!t) t = { x: (s.cx | 0), y: (s.cy | 0) };

          s.tx = t.x | 0;
          s.ty = t.y | 0;
          this._navyClearShipRoute(s);
          s.nx = null; s.ny = null; s.seg = 0;
          continue;
        }

        if (kind === "transport") {
          s.speed = TRANSPORT_SPEED_CPS;
          // Smooth water movement (same interpolation core as trade ships).
          this._navyAdvanceTradeShip(s, dt);

          const arrived = (s.nx == null && s.ny == null &&
            ((s.cx | 0) === (s.tx | 0)) &&
            ((s.cy | 0) === (s.ty | 0)));

          if (!arrived) continue;

          // Arrived at the water tile adjacent to landing spot: attempt landing.
          const ok = this._navyLandTransport(s);
          removeShipAt(i); // transport disappears on arrival (whether success or failure)
          if (!ok) continue;
          continue;
        }

        if (kind === "war") {
          s.speed = WARSHIP_SPEED_CPS;
          // Smooth movement.
          this._navyAdvanceTradeShip(s, dt);

          const arrived = (s.nx == null && s.ny == null &&
            ((s.cx | 0) === (s.tx | 0)) &&
            ((s.cy | 0) === (s.ty | 0)));

          // Idle drift near anchor to avoid looking frozen.
          if (arrived && (this.time >= (Number(s.nextDriftAt) || 0))) {
            s.nextDriftAt = this.time + 1.7 + this._navyRng() * 0.9;

            const ax = (s.ax | 0), ay = (s.ay | 0);
            let pick = null;
            for (let k = 0; k < 6; k++) {
              const nx = ax + ((this._navyRng() * 9) | 0) - 4;
              const ny = ay + ((this._navyRng() * 9) | 0) - 4;
              if (!this._navyIsWater(nx, ny)) continue;
              // Keep in same ocean comp
              if ((s.comp | 0) && ((this._navyWaterCompAt(nx, ny) | 0) !== (s.comp | 0))) continue;
              pick = { x: nx, y: ny };
              break;
            }
            if (pick) {
              s.tx = pick.x | 0;
              s.ty = pick.y | 0;
              s.nx = null; s.ny = null; s.seg = 0;
            }
          }

          continue;
        }
      }

      // ---- Combat resolution (warships) ----
      // Build id->ship map and component buckets once (hot path).
      const idToShip = this._navyTickIdToShip || (this._navyTickIdToShip = new Map());
      idToShip.clear();
      const combatShips = this._navyTickCombatShips || (this._navyTickCombatShips = []);
      combatShips.length = 0;
      const shipsByComp = this._navyTickShipsByComp || (this._navyTickShipsByComp = new Map());
      shipsByComp.clear();
      const rigsByComp = this._navyTickRigsByComp || (this._navyTickRigsByComp = new Map());
      rigsByComp.clear();
      const now = Number(this.time) || 0;

      const cacheLen = (this._nationCount | 0) + 1;
      let relStamp = this._navyRelCacheStamp;
      let relOwner = this._navyRelCacheOwner;
      let relOk = this._navyRelCacheOk;
      if (!relStamp || relStamp.length !== cacheLen) relStamp = this._navyRelCacheStamp = new Uint32Array(cacheLen);
      if (!relOwner || relOwner.length !== cacheLen) relOwner = this._navyRelCacheOwner = new Int16Array(cacheLen);
      if (!relOk || relOk.length !== cacheLen) relOk = this._navyRelCacheOk = new Uint8Array(cacheLen);
      let relGen = ((this._navyRelCacheGen | 0) + 1) >>> 0;
      if (relGen === 0) {
        relGen = 1;
        relStamp.fill(0);
      }
      this._navyRelCacheGen = relGen;

      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (s && (s.id != null)) idToShip.set(s.id | 0, s);
        if (!s) continue;

        const k = String(s.kind || "");
        if (k !== "trade" && k !== "transport" && k !== "war") continue;
        if ((Number(s.hp ?? 1) <= 0)) continue;

        let c = (s.comp | 0);
        if (!c && this._navyIsWater((s.cx | 0), (s.cy | 0))) {
          c = this._navyWaterCompAt((s.cx | 0), (s.cy | 0)) | 0;
          if (c) s.comp = c;
        }
        combatShips.push(s);
        if (c) {
          let arr = shipsByComp.get(c);
          if (!arr) {
            arr = [];
            shipsByComp.set(c, arr);
          }
          arr.push(s);
        }
      }

      const structures = this.structures || [];
      for (let i = 0; i < structures.length; i++) {
        const st = structures[i];
        if (!st) continue;
        if (String(st.type || "") !== "coastal_rig") continue;
        if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(st)) continue;
        const owner = st.owner | 0;
        if (owner <= 0 || !this.nation[owner]?.alive) continue;
        const sx = st.x | 0;
        const sy = st.y | 0;
        if (!this._navyIsWater(sx, sy)) continue;
        const compId = this._navyWaterCompAt(sx, sy) | 0;
        if (!compId) continue;
        let arr = rigsByComp.get(compId);
        if (!arr) {
          arr = [];
          rigsByComp.set(compId, arr);
        }
        arr.push(st);
      }

      for (let i = 0; i < ships.length; i++) {
        const w = ships[i];
        if (!w || w.kind !== "war") continue;

        const A = (w.owner | 0);
        const wx = (w.cx | 0), wy = (w.cy | 0);
        let wComp = (w.comp | 0);
        if (!wComp && this._navyIsWater(wx, wy)) {
          wComp = this._navyWaterCompAt(wx, wy) | 0;
          if (wComp) w.comp = wComp;
        }

        // If targetId is invalid, clear.
        let tgt = null;
        if (w.targetId != null) tgt = idToShip.get(w.targetId | 0) || null;

        // Acquire target if needed.
        let tgtOwner = tgt ? (tgt.owner | 0) : 0;
        let tgtHostile = false;
        if (tgt && tgtOwner > 0 && tgtOwner !== A) {
          if ((relStamp[tgtOwner] >>> 0) === relGen && (relOwner[tgtOwner] | 0) === A) {
            tgtHostile = (relOk[tgtOwner] | 0) === 1;
          } else {
            const pAO = this._pair(A, tgtOwner);
            const alliedAO = (this._alliedUntil[pAO] || 0) > now;
            const ceasefireAO = (this._ceasefireUntil[pAO] || 0) > now;
            tgtHostile = !alliedAO && (this._atWar[pAO] === 1) && !ceasefireAO;
            relStamp[tgtOwner] = relGen;
            relOwner[tgtOwner] = A;
            relOk[tgtOwner] = tgtHostile ? 1 : 0;
          }
        }
        if (!tgt || tgtOwner === A || !tgtHostile || (wComp && ((tgt.comp | 0) !== wComp)) || (tgt.hp != null && tgt.hp <= 0)) {
          tgt = null;
          const nextRetargetAt = Number(w._retargetAt) || 0;
          if (now >= nextRetargetAt) {
            let best = null;
            let bestPri = -1;
            let bestDist = 1e9;
            const scanPool = wComp ? (shipsByComp.get(wComp) || combatShips) : combatShips;

            for (let j = 0; j < scanPool.length; j++) {
              const s = scanPool[j];
              if (!s || s === w) continue;
              const o = (s.owner | 0);
              if (o === A) continue;
              let hostile = false;
              if ((relStamp[o] >>> 0) === relGen && (relOwner[o] | 0) === A) {
                hostile = (relOk[o] | 0) === 1;
              } else {
                const pAO = this._pair(A, o);
                const alliedAO = (this._alliedUntil[pAO] || 0) > now;
                const ceasefireAO = (this._ceasefireUntil[pAO] || 0) > now;
                hostile = !alliedAO && (this._atWar[pAO] === 1) && !ceasefireAO;
                relStamp[o] = relGen;
                relOwner[o] = A;
                relOk[o] = hostile ? 1 : 0;
              }
              if (!hostile) continue;
              if (wComp && ((s.comp | 0) !== wComp)) continue;

              const d = Math.abs((s.cx | 0) - wx) + Math.abs((s.cy | 0) - wy);
              if (d > WARSHIP_DETECT_TILES) continue;

              const sk = String(s.kind || "");
              let pri = 0;
              if (sk === "war") pri = 3;
              else if (sk === "transport") pri = 2;
              else if (sk === "trade") pri = 1;
              if (pri < 1) continue;

              if (pri > bestPri || (pri === bestPri && d < bestDist)) {
                best = s; bestPri = pri; bestDist = d;
              }
            }

            tgt = best;
            w.targetId = tgt ? (tgt.id | 0) : 0;
            w._retargetAt = now + 0.16 + (this._navyRng() * 0.22);
          } else {
            continue;
          }
        }

        if (!tgt) {
          const rigPool = wComp ? (rigsByComp.get(wComp) || []) : [];
          let bestRig = null;
          let bestRigDist = 1e9;
          for (let j = 0; j < rigPool.length; j++) {
            const rig = rigPool[j];
            if (!rig) continue;
            const o = rig.owner | 0;
            if (o <= 0 || o === A) continue;

            let hostile = false;
            if ((relStamp[o] >>> 0) === relGen && (relOwner[o] | 0) === A) {
              hostile = (relOk[o] | 0) === 1;
            } else {
              const pAO = this._pair(A, o);
              const alliedAO = (this._alliedUntil[pAO] || 0) > now;
              const ceasefireAO = (this._ceasefireUntil[pAO] || 0) > now;
              hostile = !alliedAO && (this._atWar[pAO] === 1) && !ceasefireAO;
              relStamp[o] = relGen;
              relOwner[o] = A;
              relOk[o] = hostile ? 1 : 0;
            }
            if (!hostile) continue;

            const d = Math.abs((rig.x | 0) - wx) + Math.abs((rig.y | 0) - wy);
            if (d > (WARSHIP_CHASE_TILES + 2)) continue;
            if (d < bestRigDist) {
              bestRigDist = d;
              bestRig = rig;
            }
          }

          if (!bestRig) continue;
          if (bestRigDist <= WARSHIP_RANGE_TILES) {
            const sid = bestRig.id | 0;
            const aliveRig = this._structureById && typeof this._structureById.get === "function"
              ? this._structureById.get(sid)
              : null;
            if (aliveRig && String(aliveRig.type || "") === "coastal_rig") {
              this._removeStructureById(sid);
              const victimOwner = bestRig.owner | 0;
              const playerInvolved = (A === OWNER.PLAYER) || (victimOwner === OWNER.PLAYER);
              if (playerInvolved && this.time >= this._warEventCooldownUntil[OWNER.PLAYER]) {
                this._warEventCooldownUntil[OWNER.PLAYER] = this.time + WAR_EVENT_COOLDOWN_S;
                if (victimOwner === OWNER.PLAYER) this._pushEvent("Your Coastal Rig was destroyed by a warship.");
                else this._pushEvent("Enemy Coastal Rig destroyed.");
              }
            }
          } else {
            w.tx = bestRig.x | 0;
            w.ty = bestRig.y | 0;
          }
          continue;
        }

        const tx = (tgt.cx | 0), ty = (tgt.cy | 0);
        const dMan = Math.abs(tx - wx) + Math.abs(ty - wy);

        // Chase target if not in range yet.
        if (dMan > WARSHIP_RANGE_TILES && dMan <= WARSHIP_CHASE_TILES) {
          w.tx = tx | 0;
          w.ty = ty | 0;
          // keep anchor as initial (do not change)
        }

        if (dMan <= WARSHIP_RANGE_TILES) {
          tgt.hp = (Number(tgt.hp ?? 1) - WARSHIP_DPS * dt);
          tgt.lastHitBy = A;
          tgt.lastHitAt = this.time;
        }
      }

      // ---- Remove sunk ships + loot/events ----
      for (let i = ships.length - 1; i >= 0; i--) {
        const s = ships[i];
        if (!s) { removeShipAt(i); continue; }

        const hp = Number(s.hp ?? 1);
        if (hp > 0) continue;

        const victimOwner = (s.owner | 0);
        const killerOwner = (s.lastHitBy | 0);

        // Raid loot (small; avoids money printer).
        let loot = 0;
        if (s.kind === "trade") loot = WARSHIP_RAID_LOOT_TRADE_GOLD;
        else if (s.kind === "transport") loot = WARSHIP_RAID_LOOT_TRANSPORT_GOLD;
        else if (s.kind === "war") loot = WARSHIP_RAID_LOOT_WARSHIP_GOLD;

        if (loot > 0 && killerOwner > 0 && this.nation[killerOwner]?.alive && !this.nation[killerOwner]?.collapsed) {
          this.nation[killerOwner].gold += loot;
        }

        const playerInvolved = (victimOwner === OWNER.PLAYER) || (killerOwner === OWNER.PLAYER);
        if (playerInvolved && this.time >= this._warEventCooldownUntil[OWNER.PLAYER]) {
          this._warEventCooldownUntil[OWNER.PLAYER] = this.time + WAR_EVENT_COOLDOWN_S;

          if (s.kind === "trade") {
            if ((s.sourcePortId | 0) <= 0) this._navySetTradeSlotCooldown(victimOwner, s.portKey, TRADE_SHIP_RESPAWN_S);
            if (victimOwner === OWNER.PLAYER) this._pushEvent(`Your trade ship was sunk.`);
            else this._pushEvent(`Enemy trade ship sunk (+${loot} Gold).`);
          } else if (s.kind === "transport") {
            if (victimOwner === OWNER.PLAYER) this._pushEvent(`Your transport was sunk.`);
            else this._pushEvent(`Enemy transport sunk (+${loot} Gold).`);
          } else if (s.kind === "war") {
            if (victimOwner === OWNER.PLAYER) this._pushEvent(`Your warship was destroyed.`);
            else this._pushEvent(`Enemy warship destroyed (+${loot} Gold).`);
          }
        }

        removeShipAt(i);
      }

      // ---- AI-managed allied port trade launches ----
      // Player ports are now manual. AI ports periodically launch one trade ship per port when an allied port is reachable.
      for (let id = 2; id <= this._nationCount; id++) {
        const nat = this.nation[id];
        if (!nat || !nat.alive || nat.collapsed) continue;
        const manualNation =
          !!nat.isHuman ||
          nat.isAiControlled === false ||
          (this._humanNationIds instanceof Set && this._humanNationIds.has(id));
        if (manualNation) continue;

        const ports = this._portsByOwner[id] || [];
        if (!ports.length) continue;

        let activeCount = 0;
        if (TRADE_SHIP_MAX_OUTGOING > 0) {
          activeCount = this._tradeShipCount ? (this._tradeShipCount[id] | 0) : 0;
          if (activeCount <= 0) {
            for (let i = 0; i < ships.length; i++) {
              const ship = ships[i];
              if (ship && ship.kind === "trade" && ((ship.owner | 0) === id)) activeCount++;
            }
          }
        }

        for (let p = 0; p < ports.length; p++) {
          const st = ports[p];
          if (!st) continue;
          if (TRADE_SHIP_MAX_OUTGOING > 0 && activeCount >= TRADE_SHIP_MAX_OUTGOING) break;
          if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(st)) continue;

          const d = this._navyGetPortTradeRecord(st, true);
          if (!d || (d.activeShipId | 0) > 0) continue;
          if ((Number(d.cooldownUntil) || 0) > now) continue;
          if (now < (Number(d.aiRetryAt) || 0)) continue;

          let bestOwnerId = 0;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (let oid = 1; oid <= this._nationCount; oid++) {
            if ((oid | 0) === id) continue;
            const rel = (typeof this.getRelation === "function") ? this.getRelation(id, oid) : null;
            if (!rel?.allied) continue;
            const partner = this._navyFindBestPortTradePartner(id, st, oid);
            if (!partner) continue;
            if ((partner.distancePx | 0) < bestDistance) {
              bestDistance = partner.distancePx | 0;
              bestOwnerId = oid | 0;
            }
          }

          if (bestOwnerId <= 0) {
            d.aiRetryAt = now + 18 + (this._navyRng() * 24);
            continue;
          }

          const res = this.startPortTrade(st.id | 0, id, bestOwnerId, { silent: true });
          d.aiRetryAt = now + (res?.ok ? (16 + (this._navyRng() * 18)) : (10 + (this._navyRng() * 12)));
          if (res?.ok && TRADE_SHIP_MAX_OUTGOING > 0) activeCount++;
        }
      }

      // Update per-nation ship counts (used by AI dispatch + UI).
      if (this._tradeShipCount) this._tradeShipCount.fill(0);
      if (this._warShipCount) this._warShipCount.fill(0);
      if (this._transportCount) this._transportCount.fill(0);
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s) continue;
        const o = (s.owner | 0);
        if (o <= 0) continue;
        const k = String(s.kind || "");
        if (k === "trade") this._tradeShipCount[o] = (this._tradeShipCount[o] | 0) + 1;
        else if (k === "war") this._warShipCount[o] = (this._warShipCount[o] | 0) + 1;
        else if (k === "transport") this._transportCount[o] = (this._transportCount[o] | 0) + 1;
      }

      // Bucket current ships by water component for AI naval threat scans.
      const shipsByCompForAi = this._navyTickShipsByCompForAi || (this._navyTickShipsByCompForAi = new Map());
      shipsByCompForAi.clear();
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s) continue;
        const k = String(s.kind || "");
        if (k !== "trade" && k !== "transport" && k !== "war") continue;

        let c = (s.comp | 0);
        if (!c && this._navyIsWater((s.cx | 0), (s.cy | 0))) {
          c = this._navyWaterCompAt((s.cx | 0), (s.cy | 0)) | 0;
          if (c) s.comp = c;
        }
        if (!c) continue;

        let arr = shipsByCompForAi.get(c);
        if (!arr) {
          arr = [];
          shipsByCompForAi.set(c, arr);
        }
        arr.push(s);
      }

      // ---- Minimal defensive AI warship dispatch (stability first) ----
      // If an AI is at war and sees enemy ships in its ocean near its ports, it may launch a single warship.
      // Water connectivity is static after world generation, so do not recompute it per-AI.
      for (let id = 2; id <= this._nationCount; id++) {
        const n = this.nation[id];
        if (!n || !n.alive) continue;
        if ((this._portCount[id] | 0) <= 0) continue;
        if ((this._warShipCount[id] | 0) >= 1) continue; // defensive baseline only

        // Check if in any war; if none, skip.
        if (!this._anyWar(id)) continue;

        const ports = this._portsByOwner[id] || [];
        if (!ports.length) continue;

        // Find the nearest visible enemy ship to any port; if close enough, dispatch.
        let best = null;
        let bestD = 99999;
        for (let p = 0; p < ports.length; p++) {
          const st = ports[p];
          const spawn = this._navyPickAdjacentWater(st.x | 0, st.y | 0);
          if (!spawn) continue;
          const compId = this._navyWaterCompAt(spawn.x | 0, spawn.y | 0) | 0;
          if (!compId) continue;
          const inComp = shipsByCompForAi.get(compId) || [];
          for (let j = 0; j < inComp.length; j++) {
            const s = inComp[j];
            if (!s) continue;
            if ((s.owner | 0) === id) continue;
            if (s.kind !== "trade" && s.kind !== "transport" && s.kind !== "war") continue;

            const d = Math.abs((s.cx | 0) - (spawn.x | 0)) + Math.abs((s.cy | 0) - (spawn.y | 0));
            if (d < bestD) { bestD = d; best = { compId, spawn, tx: (s.cx | 0), ty: (s.cy | 0) }; }
          }
        }

        if (best && bestD <= 16) {
          const route = this._navyPickNearestPortSpawnTo(id, best.compId | 0, best.tx | 0, best.ty | 0);
          if (route) {
            this._navySpawnWarship(id, route.spawn, { x: best.tx | 0, y: best.ty | 0 }, best.compId | 0);
          }
        }
      }
    }

  World.prototype.getShipById = function(shipId) {
      const sid = shipId | 0;
      if (!sid) return null;
      const ships = this.ships;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s) continue;
        if ((s.id | 0) !== sid) continue;
        return s;
      }
      return null;
    }

  World.prototype.getShipAt = function(x, y, options = null) {
      const xx = x | 0;
      const yy = y | 0;
      if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return null;

      const opts = (options && typeof options === "object") ? options : null;
      const ownerFilter = opts ? (opts.ownerId | 0) : 0;
      const pickRadius = Math.max(0.35, Number(opts?.radiusTiles) || 0.92);
      const r2 = pickRadius * pickRadius;
      const cx = xx + 0.5;
      const cy = yy + 0.5;

      let best = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      const ships = this.ships;
      for (let i = ships.length - 1; i >= 0; i--) {
        const s = ships[i];
        if (!s) continue;
        const kind = String(s.kind || "");
        if (kind !== "trade" && kind !== "transport" && kind !== "war") continue;
        if (ownerFilter > 0 && ((s.owner | 0) !== ownerFilter)) continue;

        const sx = (typeof s.px === "number") ? Number(s.px) : ((s.cx | 0) + 0.5);
        const sy = (typeof s.py === "number") ? Number(s.py) : ((s.cy | 0) + 0.5);
        const dx = sx - cx;
        const dy = sy - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < bestD2) {
          best = s;
          bestD2 = d2;
        }
      }
      return best;
    }

  World.prototype.cancelShip = function(shipId, requesterId = OWNER.PLAYER) {
      const sid = shipId | 0;
      const ownerId = requesterId | 0;
      if (!sid) return { ok: false, reason: "Invalid ship id." };

      const ships = this.ships;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (!s) continue;
        if ((s.id | 0) !== sid) continue;
        if ((s.owner | 0) !== ownerId) return { ok: false, reason: "You can only cancel your own ships." };
        if (String(s.kind || "") !== "transport") return { ok: false, reason: "Only transport ships can be cancelled." };

        ships.splice(i, 1);
        if (ownerId === OWNER.PLAYER) this._pushEvent("Transport mission cancelled.");
        return { ok: true, reason: "" };
      }

      return { ok: false, reason: "Ship not found." };
    }

  World.prototype._navyEnsurePortTradeData = function(st) {
      if (!st || typeof st !== "object") return null;
      if (!st.data || typeof st.data !== "object") st.data = {};
      let d = st.data.portTrade;
      if (!d || typeof d !== "object") d = st.data.portTrade = {};
      d.activeShipId = Math.max(0, d.activeShipId | 0);
      d.targetOwnerId = Math.max(0, d.targetOwnerId | 0);
      d.targetPortId = Math.max(0, d.targetPortId | 0);
      d.distancePx = Math.max(0, Number(d.distancePx) || 0);
      d.routeDistancePx = Math.max(0, Number(d.routeDistancePx) || 0);
      d.rewardGold = Math.max(0, Number(d.rewardGold) || 0);
      d.startedAt = Math.max(0, Number(d.startedAt) || 0);
      d.lastCompletedAt = Math.max(0, Number(d.lastCompletedAt) || 0);
      d.cooldownUntil = Math.max(0, Number(d.cooldownUntil) || 0);
      d.aiRetryAt = Math.max(0, Number(d.aiRetryAt) || 0);
      return d;
    }

  World.prototype._navyClearPortTradeState = function(st) {
      const d = this._navyEnsurePortTradeData(st);
      if (!d) return null;
      d.activeShipId = 0;
      d.targetOwnerId = 0;
      d.targetPortId = 0;
      d.distancePx = 0;
      d.routeDistancePx = 0;
      d.rewardGold = 0;
      d.startedAt = 0;
      d.lastCompletedAt = Math.max(0, Number(this.time) || 0);
      return d;
    }

  World.prototype._navyCompletePortTrade = function(st) {
      const d = this._navyEnsurePortTradeData(st);
      if (!d) return null;
      d.activeShipId = 0;
      d.targetOwnerId = 0;
      d.targetPortId = 0;
      d.distancePx = 0;
      d.routeDistancePx = 0;
      d.rewardGold = 0;
      d.startedAt = 0;
      d.lastCompletedAt = Math.max(0, Number(this.time) || 0);
      d.cooldownUntil = d.lastCompletedAt + Math.max(0, Number(PORT_TRADE_COOLDOWN_S) || 0);
      d.aiRetryAt = Math.max(Number(d.aiRetryAt) || 0, d.cooldownUntil);
      return d;
    }

  World.prototype._navyGetPortTradeRecord = function(st, pruneStale = true) {
      const d = this._navyEnsurePortTradeData(st);
      if (!d) return null;
      if (!pruneStale || (d.activeShipId | 0) <= 0) return d;
      const ship = (typeof this.getShipById === "function")
        ? this.getShipById(d.activeShipId | 0)
        : null;
      if (!ship || String(ship.kind || "") !== "trade" || ((ship.sourcePortId | 0) !== (st.id | 0))) {
        this._navyClearPortTradeState(st);
      }
      return this._navyEnsurePortTradeData(st);
    }

  World.prototype._navyOnShipRemoved = function(ship) {
      if (!ship || String(ship.kind || "") !== "trade") return;
      const portId = ship.sourcePortId | 0;
      if (!portId) return;
      const st = this._structureById && typeof this._structureById.get === "function"
        ? this._structureById.get(portId)
        : null;
      if (!st || String(st.type || "") !== "port") return;
      const d = this._navyGetPortTradeRecord(st, false);
      if (!d || ((d.activeShipId | 0) !== (ship.id | 0))) return;
      this._navyClearPortTradeState(st);
    }

  World.prototype._navyClearShipRoute = function(ship) {
      if (!ship || typeof ship !== "object") return;
      _navySetHidden(ship, "_route", null);
      _navySetHidden(ship, "_routePos", 0);
      _navySetHidden(ship, "_routeGoalX", ship.tx | 0);
      _navySetHidden(ship, "_routeGoalY", ship.ty | 0);
    }

  World.prototype._navyPathCacheGet = function(x, y, tx, ty, compId = 0) {
      const cache = this._navyPathCache;
      if (!(cache instanceof Map) || cache.size <= 0) return null;
      const key = _navyPathCacheKey(x, y, tx, ty, compId);
      const route = cache.get(key);
      if (!Array.isArray(route) || route.length <= 0) return null;
      cache.delete(key);
      cache.set(key, route);
      return route;
    }

  World.prototype._navyPathCacheSet = function(x, y, tx, ty, compId = 0, route = null) {
      if (!Array.isArray(route) || route.length <= 0) return route;
      let cache = this._navyPathCache;
      if (!(cache instanceof Map)) cache = this._navyPathCache = new Map();
      const key = _navyPathCacheKey(x, y, tx, ty, compId);
      if (cache.has(key)) cache.delete(key);
      cache.set(key, route);
      while (cache.size > NAVY_PATH_CACHE_MAX) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return route;
    }

  World.prototype._navySetShipRoute = function(ship, route) {
      if (!ship || typeof ship !== "object") return null;
      const arr = (Array.isArray(route) && route.length > 0) ? route : null;
      _navySetHidden(ship, "_route", arr);
      _navySetHidden(ship, "_routePos", 0);
      _navySetHidden(ship, "_routeGoalX", ship.tx | 0);
      _navySetHidden(ship, "_routeGoalY", ship.ty | 0);
      return arr;
    }

  World.prototype._navyConsumeRouteStep = function(ship, compId = 0, out = null) {
      if (!ship || typeof ship !== "object") return null;
      const route = Array.isArray(ship._route) ? ship._route : null;
      if (!route || route.length <= 0) return null;
      const wantComp = compId | 0;
      const w = this.w | 0;
      let pos = Math.max(0, ship._routePos | 0);
      while (pos < route.length) {
        const idx = route[pos] | 0;
        const nx = (idx % w) | 0;
        const ny = ((idx / w) | 0);
        if ((Math.abs(nx - (ship.cx | 0)) + Math.abs(ny - (ship.cy | 0))) !== 1) {
          this._navyClearShipRoute(ship);
          return null;
        }
        if (!this._navyIsWater(nx, ny)) {
          this._navyClearShipRoute(ship);
          return null;
        }
        if (wantComp && ((this._navyWaterCompAt(nx, ny) | 0) !== wantComp)) {
          this._navyClearShipRoute(ship);
          return null;
        }
        _navySetHidden(ship, "_routePos", pos + 1);
        if ((pos + 1) >= route.length) _navySetHidden(ship, "_route", null);
        return _navySetStepOut(out, nx, ny);
      }
      this._navyClearShipRoute(ship);
      return null;
    }

    // Spawn a warship at a water spawn tile (usually adjacent to a Port) and send it toward a water target.
    // NOTE: Kept as a separate helper because both the player and AI can launch warships.
  World.prototype._navySpawnWarship = function(ownerId, spawn, target, compId) {
      const A = ownerId | 0;
      if (this.gameOver) return { ok: false, reason: "Game over." };

      const nat = this.nation[A];
      if (!nat || !nat.alive) return { ok: false, reason: "Invalid nation." };

      if (!spawn || spawn.x == null || spawn.y == null) return { ok: false, reason: "No spawn." };
      const sx = spawn.x | 0;
      const sy = spawn.y | 0;

      if (!this._navyIsWater(sx, sy)) return { ok: false, reason: "Warship spawn must be on water." };

      // Ensure water components exist so we can validate reachability.
      if (!this._waterComp || (this._waterComp.length !== (this.w * this.h)) || !((this._waterCompCount | 0) > 0)) {
        this._recomputeWaterComponents();
      }
      const c = (compId | 0) || (this._navyWaterCompAt(sx, sy) | 0);
      if (!c) return { ok: false, reason: "No valid ocean route." };

      const tx = (target && target.x != null) ? (target.x | 0) : sx;
      const ty = (target && target.y != null) ? (target.y | 0) : sy;

      if (!this._navyIsWater(tx, ty)) return { ok: false, reason: "Warship target must be on water." };
      const tc = (this._navyWaterCompAt(tx, ty) | 0);
      if (tc && tc !== c) return { ok: false, reason: "Target ocean is not reachable from that Port." };

      // Optional cap (0 = unlimited). canSendWarship() already enforces this for player launches,
      // but the AI also calls this method directly.
      if (WARSHIP_MAX_ACTIVE > 0) {
        let wc = 0;
        for (let i = 0; i < this.ships.length; i++) {
          const s = this.ships[i];
          if (s && s.kind === "war" && ((s.owner | 0) === A)) wc++;
        }
        if (wc >= WARSHIP_MAX_ACTIVE) return { ok: false, reason: `Warship cap reached (${WARSHIP_MAX_ACTIVE}).` };
      }

      const launchCost = Math.max(0, Number(WARSHIP_LAUNCH_GOLD_COST) || 0);
      if ((nat.gold || 0) < launchCost) {
        return { ok: false, reason: `Not enough gold to launch warship (need ${Math.floor(launchCost)}).` };
      }
      const oilNeed = (typeof this.getOilCostForAction === "function")
        ? Math.max(0, Number(this.getOilCostForAction("warship")) || 0)
        : 0;
      if (oilNeed > 0 && typeof this.canAffordResourceBundle === "function") {
        const oilRes = this.canAffordResourceBundle(A, { oil: oilNeed }, "Warship launch");
        if (!oilRes.ok) return oilRes;
      }
      nat.gold = Math.max(0, (nat.gold || 0) - launchCost);
      if (oilNeed > 0 && typeof this.spendResourceBundle === "function") {
        this.spendResourceBundle(A, { oil: oilNeed });
      }

      const ship = {
        id: (this._nextShipId++ | 0),
        kind: "war",
        owner: A,

        // Discrete cell position (water tile)
        cx: sx,
        cy: sy,

        // Interpolated world position (tile-center coordinates)
        px: sx + 0.5,
        py: sy + 0.5,

        // Current target cell
        tx: tx,
        ty: ty,

        // Segment interpolation toward next cell
        nx: null,
        ny: null,
        seg: 0,

        // Anchor (used for idle drift when not chasing)
        ax: sx,
        ay: sy,

        nextDriftAt: this.time + 1.2 + this._navyRng() * 0.9,

        speed: WARSHIP_SPEED_CPS,
        comp: c,

        hp: WARSHIP_HP,
        targetId: 0,

        createdAt: this.time
      };

      this.ships.push(ship);
      return { ok: true, reason: "" };
    }

  World.prototype._navySpawnTradeShip = function(ownerId) {
      const A = ownerId | 0;
      const ports = this._portsByOwner[A];
      if (!ports || ports.length === 0) return false;

      const pick = ports[(this._navyRng() * ports.length) | 0];
      if (!pick) return false;

      const spawn = this._navyPickAdjacentWater((pick.x | 0), (pick.y | 0));
      if (!spawn) return false;

      const compId = this._navyWaterCompAt(spawn.x | 0, spawn.y | 0) | 0;

      const ship = {
        id: (this._nextShipId++ | 0),
        kind: "trade",
        owner: A,

        // Discrete cell position (water tile)
        cx: (spawn.x | 0),
        cy: (spawn.y | 0),

        // Interpolated world position (tile-center coordinates)
        px: (spawn.x | 0) + 0.5,
        py: (spawn.y | 0) + 0.5,

        // Current target cell
        tx: (spawn.x | 0),
        ty: (spawn.y | 0),

        // Segment interpolation toward next cell
        nx: null,
        ny: null,
        seg: 0,

        mode: "wander",
        wanderUntil: 0,

        speed: TRADE_SHIP_SPEED_CPS,
        comp: compId,

        trail: [{ x: (spawn.x | 0) + 0.5, y: (spawn.y | 0) + 0.5, t: this.time }],
        createdAt: this.time
      };

      this._navyAssignTradeTrip(ship);
      this.ships.push(ship);
      return true;
    }

  World.prototype._navySetTradeSlotCooldown = function(ownerId, portKey, delayS) {
      const A = ownerId | 0;
      const k = (portKey != null) ? String(portKey) : "";
      if (!k) return;
      const d = (delayS != null) ? Number(delayS) : TRADE_SHIP_RESPAWN_S;
      const until = this.time + Math.max(0, d);
      this._tradeSlotRespawnAt.set(`${A}:${k}`, until);
    }

  World.prototype._navyCanSpawnTradeForSlot = function(ownerId, portKey) {
      const A = ownerId | 0;
      const k = (portKey != null) ? String(portKey) : "";
      if (!k) return true;
      const until = this._tradeSlotRespawnAt.get(`${A}:${k}`);
      return !(until != null && this.time < until);
    }

  World.prototype._navySpawnTradeShipFromPortSlot = function(ownerId, st, slotIndex, portKey) {
      const A = ownerId | 0;
      if (!st) return { ok: false, reason: "No port." };

      const spawn = this._navyPickAdjacentWater((st.x | 0), (st.y | 0));
      if (!spawn) return { ok: false, reason: "Port is not coastal." };

      const ship = {
        id: (this._nextShipId++ | 0),
        kind: "trade",
        owner: A,
        cx: spawn.x | 0,
        cy: spawn.y | 0,
        px: (spawn.x + 0.5),
        py: (spawn.y + 0.5),
        tx: spawn.x | 0,
        ty: spawn.y | 0,
        nx: null,
        ny: null,
        seg: 0,
        speed: TRADE_SHIP_SPEED_CPS,
        hp: TRADE_SHIP_HP,
        mode: "wander",
        wanderUntil: this.time + TRADE_WANDER_MIN_S,
        trail: [],
        trailAcc: 0,
        portKey: String(portKey || `${st.id || (st.x + "," + st.y)}:${slotIndex | 0}`)
      };

      this._navyAssignTradeTrip(ship);
      this.ships.push(ship);
      return { ok: true, reason: "" };
    }



  World.prototype._navyIsWater = function(x, y) {
      const xx = x | 0, yy = y | 0;
      if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return false;
      const idx = yy * this.w + xx;
      return !this.land[idx];
    }

  World.prototype._navyWaterCompAt = function(x, y) {
      const xx = x | 0, yy = y | 0;
      if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return 0;
      const idx = yy * this.w + xx;
      if (this.land[idx]) return 0;
      return (this._waterComp && this._waterComp[idx]) ? (this._waterComp[idx] | 0) : 0;
    }
  World.prototype._recomputeWaterComponents = function() {
      const w = this.w | 0;
      const h = this.h | 0;
      const n = w * h;

      if (!this._waterComp || this._waterComp.length !== n) {
        this._waterComp = new Int32Array(n);
      }

      const comp = this._waterComp;
      comp.fill(0);

      const land = this.land;
      const q = this._floodQ;

      let cid = 0;
      const sizeList = [0];
      const sampleList = [0];
      let maxSize = 0;

      for (let idx0 = 0; idx0 < n; idx0++) {
        if (land[idx0] || comp[idx0]) continue;

        cid++;
        comp[idx0] = cid;
        sampleList[cid] = idx0 | 0;

        let head = 0;
        let tail = 0;
        let compSize = 0;
        q[tail++] = idx0;

        while (head < tail) {
          const idx = q[head++] | 0;
          compSize++;
          const x = (idx % w) | 0;
          const y = ((idx / w) | 0);

          let ni = 0;

          if (x > 0) {
            ni = (idx - 1) | 0;
            if (!land[ni] && !comp[ni]) { comp[ni] = cid; q[tail++] = ni; }
          }
          if (x < w - 1) {
            ni = (idx + 1) | 0;
            if (!land[ni] && !comp[ni]) { comp[ni] = cid; q[tail++] = ni; }
          }
          if (y > 0) {
            ni = (idx - w) | 0;
            if (!land[ni] && !comp[ni]) { comp[ni] = cid; q[tail++] = ni; }
          }
          if (y < h - 1) {
            ni = (idx + w) | 0;
            if (!land[ni] && !comp[ni]) { comp[ni] = cid; q[tail++] = ni; }
          }
        }

        sizeList[cid] = compSize | 0;
        if (compSize > maxSize) maxSize = compSize;
      }

      this._waterCompCount = cid | 0;

      // Materialize component sizes and a stable sample tile per component.
      if (!this._waterCompSize || this._waterCompSize.length !== (cid + 1)) {
        this._waterCompSize = new Int32Array(cid + 1);
      } else {
        this._waterCompSize.fill(0);
      }
      if (!this._waterCompSampleIdx || this._waterCompSampleIdx.length !== (cid + 1)) {
        this._waterCompSampleIdx = new Int32Array(cid + 1);
      } else {
        this._waterCompSampleIdx.fill(0);
      }

      for (let c = 1; c <= cid; c++) {
        this._waterCompSize[c] = sizeList[c] | 0;
        this._waterCompSampleIdx[c] = sampleList[c] | 0;
      }

      // Ocean threshold: >= 10% of largest water body, with a small floor.
      const minOcean = Math.max(96, (maxSize * 0.10) | 0);
      this._oceanCompMinSize = minOcean | 0;

      if (!this._oceanComp || this._oceanComp.length !== (cid + 1)) {
        this._oceanComp = new Uint8Array(cid + 1);
      } else {
        this._oceanComp.fill(0);
      }

      for (let c = 1; c <= cid; c++) {
        if ((this._waterCompSize[c] | 0) >= minOcean) this._oceanComp[c] = 1;
      }
    }

  World.prototype._navyPickAdjacentWater = function(lx, ly, compId = 0, prevX = null, prevY = null, out = null) {
      const x = lx | 0, y = ly | 0;
      const w = this.w | 0, h = this.h | 0;
      const wantComp = (compId | 0);
      const pxx = (prevX == null) ? 0x7fffffff : (prevX | 0);
      const pyy = (prevY == null) ? 0x7fffffff : (prevY | 0);
      const avoidBacktrack = (prevX != null && prevY != null);

      const ok = (xx, yy) => {
        const idx = (yy * w + xx) | 0;
        if (this.land[idx]) return false;
        if (wantComp && this._waterComp && ((this._waterComp[idx] | 0) !== wantComp)) return false;
        return true;
      };

      let candCount = 0;
      let pickX = 0, pickY = 0;
      let backX = 0, backY = 0;
      let backCount = 0;

      const consider = (nx, ny) => {
        if (!ok(nx, ny)) return;
        if (avoidBacktrack && nx === pxx && ny === pyy) {
          backCount++;
          if ((this._navyRng() * backCount) < 1) { backX = nx; backY = ny; }
          return;
        }
        candCount++;
        if ((this._navyRng() * candCount) < 1) { pickX = nx; pickY = ny; }
      };

      if (x > 0) consider(x - 1, y);
      if (x + 1 < w) consider(x + 1, y);
      if (y > 0) consider(x, y - 1);
      if (y + 1 < h) consider(x, y + 1);

      if (candCount > 0) return _navySetStepOut(out, pickX, pickY);
      if (backCount > 0) return _navySetStepOut(out, backX, backY);
      return null;
    }
  World.prototype._navyStepWaterToward = function(x, y, tx, ty, px, py, out = null) {
      const w = this.w | 0, h = this.h | 0;
      const land = this.land;
      const pxx = (px == null) ? 0x7fffffff : (px | 0);
      const pyy = (py == null) ? 0x7fffffff : (py | 0);
      const avoidBacktrack = (px != null && py != null);

      const dx0 = (x - tx);
      const dy0 = (y - ty);
      const d02 = dx0 * dx0 + dy0 * dy0;

      let candCount = 0;
      let randX = 0, randY = 0;
      let bestX = 0, bestY = 0, bestD = 9e9, bestMd = 9e9;
      let backCount = 0;
      let backX = 0, backY = 0;

      const consider = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = (ny * w + nx) | 0;
        if (land[ni]) return;
        const isBack = avoidBacktrack && nx === pxx && ny === pyy;
        if (isBack) {
          backCount++;
          if ((this._navyRng() * backCount) < 1) { backX = nx; backY = ny; }
          return;
        }

        candCount++;
        if ((this._navyRng() * candCount) < 1) { randX = nx; randY = ny; }

        const dx = nx - tx;
        const dy = ny - ty;
        const d = dx * dx + dy * dy;
        const md = Math.abs(dx) + Math.abs(dy);
        if (d < bestD || (d === bestD && md < bestMd)) {
          bestD = d;
          bestMd = md;
          bestX = nx;
          bestY = ny;
        }
      };

      consider(x - 1, y);
      consider(x + 1, y);
      consider(x, y - 1);
      consider(x, y + 1);

      if (candCount <= 0) {
        if (backCount > 0) return _navySetStepOut(out, backX, backY);
        return null;
      }

      // Occasionally take a random neighbor to escape greedy traps, but not when close to target.
      if (d02 > 144 && this._navyRng() < 0.06) return _navySetStepOut(out, randX, randY);
      return _navySetStepOut(out, bestX, bestY);
    }

  World.prototype._navyStepWaterTowardPath = function(x, y, tx, ty, compId = 0, out = null) {
      const sx = x | 0, sy = y | 0;
      const gx = tx | 0, gy = ty | 0;
      const w = this.w | 0, h = this.h | 0;
      if (sx < 0 || sy < 0 || gx < 0 || gy < 0 || sx >= w || sy >= h || gx >= w || gy >= h) return null;
      if (sx === gx && sy === gy) return null;
      if (!this._navyIsWater(sx, sy) || !this._navyIsWater(gx, gy)) return null;

      const start = (sy * w + sx) | 0;
      const goal = (gy * w + gx) | 0;
      const wantComp = compId | 0;
      if (wantComp) {
        if ((this._navyWaterCompAt(sx, sy) | 0) !== wantComp) return null;
        if ((this._navyWaterCompAt(gx, gy) | 0) !== wantComp) return null;
      }

      const n = (w * h) | 0;
      const q = this._floodQ;
      let stamp = this._visitStamp;
      if (!stamp || stamp.length !== n) stamp = this._visitStamp = new Uint32Array(n);
      let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
      if (mark === 0) {
        stamp.fill(0);
        mark = 1;
        this._visitTick = 1;
      }

      let prev = this._navyPathPrev;
      if (!prev || prev.length !== n) prev = this._navyPathPrev = new Int32Array(n);

      let qh = 0, qt = 0;
      q[qt++] = start;
      stamp[start] = mark;
      prev[start] = -1;

      const land = this.land;
      while (qh < qt) {
        const idx = q[qh++] | 0;
        if (idx === goal) break;

        const cx = (idx % w) | 0;
        const cy = ((idx / w) | 0);

        const tryPush = (ni) => {
          if (stamp[ni] === mark) return;
          if (land[ni]) return;
          if (wantComp && this._waterComp && ((this._waterComp[ni] | 0) !== wantComp)) return;
          stamp[ni] = mark;
          prev[ni] = idx;
          q[qt++] = ni;
        };

        if (cx > 0) tryPush((idx - 1) | 0);
        if (cx < w - 1) tryPush((idx + 1) | 0);
        if (cy > 0) tryPush((idx - w) | 0);
        if (cy < h - 1) tryPush((idx + w) | 0);
      }

      if (stamp[goal] !== mark) return null;

      let cur = goal;
      let p = prev[cur] | 0;
      while (p !== -1 && p !== start) {
        cur = p;
        p = prev[cur] | 0;
      }
      if (p !== start) return null;

      return _navySetStepOut(out, (cur % w) | 0, ((cur / w) | 0));
    }

  World.prototype._navyBuildWaterPath = function(x, y, tx, ty, compId = 0) {
      const sx = x | 0, sy = y | 0;
      const gx = tx | 0, gy = ty | 0;
      const w = this.w | 0, h = this.h | 0;
      if (sx < 0 || sy < 0 || gx < 0 || gy < 0 || sx >= w || sy >= h || gx >= w || gy >= h) return null;
      if (sx === gx && sy === gy) return [];
      if (!this._navyIsWater(sx, sy) || !this._navyIsWater(gx, gy)) return null;

      const cached = this._navyPathCacheGet(sx, sy, gx, gy, compId);
      if (cached) return cached;

      const start = (sy * w + sx) | 0;
      const goal = (gy * w + gx) | 0;
      const wantComp = compId | 0;
      const comp = this._waterComp;
      if (wantComp) {
        if (!comp || (comp[start] | 0) !== wantComp || (comp[goal] | 0) !== wantComp) return null;
      }

      const n = (w * h) | 0;
      const q = this._floodQ;
      let stamp = this._visitStamp;
      if (!stamp || stamp.length !== n) stamp = this._visitStamp = new Uint32Array(n);
      let mark = (this._visitTick = (this._visitTick + 1) >>> 0) || 1;
      if (mark === 0) {
        stamp.fill(0);
        mark = 1;
        this._visitTick = 1;
      }

      let prev = this._navyPathPrev;
      if (!prev || prev.length !== n) prev = this._navyPathPrev = new Int32Array(n);

      let qh = 0, qt = 0;
      q[qt++] = start;
      stamp[start] = mark;
      prev[start] = -1;

      const land = this.land;
      while (qh < qt) {
        const idx = q[qh++] | 0;
        if (idx === goal) break;

        const cx = (idx % w) | 0;
        const cy = ((idx / w) | 0);

        const tryPush = (ni) => {
          if (stamp[ni] === mark) return;
          if (land[ni]) return;
          if (wantComp && comp && ((comp[ni] | 0) !== wantComp)) return;
          stamp[ni] = mark;
          prev[ni] = idx;
          q[qt++] = ni;
        };

        if (cx > 0) tryPush((idx - 1) | 0);
        if (cx < w - 1) tryPush((idx + 1) | 0);
        if (cy > 0) tryPush((idx - w) | 0);
        if (cy < h - 1) tryPush((idx + w) | 0);
      }

      if (stamp[goal] !== mark) return null;

      let len = 0;
      for (let cur2 = goal; cur2 !== start; cur2 = prev[cur2] | 0) {
        if (cur2 < 0) return null;
        len++;
        if (len > n) return null;
      }

      const route = new Array(len);
      let cur2 = goal;
      for (let i = len - 1; i >= 0; i--) {
        route[i] = cur2 | 0;
        cur2 = prev[cur2] | 0;
      }
      return this._navyPathCacheSet(sx, sy, gx, gy, compId, route);
    }


  World.prototype._navyPickTradeTargetFromWater = function(sx, sy) {
      let x = sx | 0, y = sy | 0;
      if (!this._navyIsWater(x, y)) return null;

      const steps = TRADE_TRIP_STEPS_MIN + ((this._navyRng() * (TRADE_TRIP_STEPS_MAX - TRADE_TRIP_STEPS_MIN + 1)) | 0);

      let bestX = x, bestY = y, bestDist = 0;

      // Momentum-based random walk over water.
      let lastDx = 0, lastDy = 0;
      const w = this.w | 0;
      const h = this.h | 0;
      const land = this.land;

      for (let i = 0; i < steps; i++) {
        let candCount = 0;
        let chooseX = x, chooseY = y, chooseDx = 0, chooseDy = 0;
        let momentumX = x, momentumY = y, momentumFound = false;
        const add = (nx, ny, dx, dy) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          if (land[ny * w + nx]) return;
          candCount++;
          if ((this._navyRng() * candCount) < 1) {
            chooseX = nx; chooseY = ny; chooseDx = dx; chooseDy = dy;
          }
          if (!momentumFound && dx === lastDx && dy === lastDy) {
            momentumX = nx; momentumY = ny; momentumFound = true;
          }
        };

        add(x - 1, y, -1, 0);
        add(x + 1, y, 1, 0);
        add(x, y - 1, 0, -1);
        add(x, y + 1, 0, 1);

        if (candCount <= 0) break;
        if ((lastDx || lastDy) && momentumFound && this._navyRng() < 0.65) {
          x = momentumX; y = momentumY;
        } else {
          x = chooseX; y = chooseY;
          lastDx = chooseDx; lastDy = chooseDy;
        }

        const md = Math.abs(x - sx) + Math.abs(y - sy);
        if (md > bestDist) { bestDist = md; bestX = x; bestY = y; }
      }

      return { x: bestX, y: bestY };
    }

  World.prototype._navyPickOtherPortWaterTarget = function(ownerId, compId, fromX, fromY) {
      const A = ownerId | 0;
      const wantComp = compId | 0;
      const fx = fromX | 0, fy = fromY | 0;

      const BEST_MAX = 8;
      let topCount = 0;
      const topD = new Float64Array(BEST_MAX);
      const topX = new Int32Array(BEST_MAX);
      const topY = new Int32Array(BEST_MAX);

      const pushBest = (d, x, y) => {
        if (topCount < BEST_MAX) {
          topD[topCount] = d;
          topX[topCount] = x | 0;
          topY[topCount] = y | 0;
          topCount++;
          return;
        }
        // Replace worst if better.
        let wi = 0;
        let wd = -1e18;
        for (let i = 0; i < topCount; i++) {
          if (topD[i] > wd) { wd = topD[i]; wi = i; }
        }
        if (d < wd) {
          topD[wi] = d;
          topX[wi] = x | 0;
          topY[wi] = y | 0;
        }
      };

      for (let oid = 1; oid <= this._nationCount; oid++) {
        if ((oid | 0) === A) continue;
        const nat = this.nation[oid | 0];
        if (!nat || !nat.alive || nat.collapsed) continue;

        const ports = this._portsByOwner[oid | 0];
        if (!ports || ports.length === 0) continue;

        for (let pi = 0; pi < ports.length; pi++) {
          const p = ports[pi];
          if (!p) continue;

          // Pick an adjacent water tile that is on the same water component.
          const px = p.x | 0, py = p.y | 0;
          const w = this.w | 0;
          const land = this.land;
          const comp = this._waterComp;

          let bestAdj = null;
          let bestAdjD = 9e9;

          const tryAdj = (ax, ay) => {
            if (ax < 0 || ay < 0 || ax >= this.w || ay >= this.h) return;
            const idx = (ay * w + ax) | 0;
            if (land[idx]) return;
            if (wantComp && comp && ((comp[idx] | 0) !== wantComp)) return;

            const dx = ax - fx;
            const dy = ay - fy;
            const d = dx * dx + dy * dy;
            if (d < bestAdjD) { bestAdjD = d; bestAdj = { x: ax, y: ay }; }
          };

          tryAdj(px - 1, py);
          tryAdj(px + 1, py);
          tryAdj(px, py - 1);
          tryAdj(px, py + 1);

          if (!bestAdj) continue;

          // Distance heuristic uses the destination water tile.
          pushBest(bestAdjD, bestAdj.x, bestAdj.y);
        }
      }

      if (topCount <= 0) return null;

      // Bias toward closer ports, but keep some variety (pick randomly from best 4).
      const pickN = Math.max(1, Math.min(topCount, 4));
      const used = new Uint8Array(BEST_MAX);
      let outX = topX[0] | 0;
      let outY = topY[0] | 0;
      for (let pick = 0; pick < pickN; pick++) {
        let bestI = -1;
        let bestVal = 1e18;
        for (let i = 0; i < topCount; i++) {
          if (used[i]) continue;
          const d = topD[i];
          if (d < bestVal) { bestVal = d; bestI = i; }
        }
        if (bestI < 0) break;
        used[bestI] = 1;
        if (pick === 0 || ((this._navyRng() * (pick + 1)) < 1)) {
          outX = topX[bestI] | 0;
          outY = topY[bestI] | 0;
        }
      }
      return { x: outX, y: outY };
    }

  World.prototype._navyFindBestPortTradePartner = function(ownerId, sourcePort, allyId) {
      const A = ownerId | 0;
      const B = allyId | 0;
      const st = sourcePort || null;
      if (!st || String(st.type || "") !== "port") return null;
      if ((st.owner | 0) !== A) return null;
      if (!this._waterComp || (this._waterComp.length !== (this.w * this.h)) || !((this._waterCompCount | 0) > 0)) {
        this._recomputeWaterComponents();
      }
      const sourceSpawn = this._navyPickAdjacentWater((st.x | 0), (st.y | 0));
      if (!sourceSpawn) return null;
      const compId = this._navyWaterCompAt(sourceSpawn.x | 0, sourceSpawn.y | 0) | 0;
      if (!compId) return null;

      const ports = this._portsByOwner[B] || [];
      let best = null;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < ports.length; i++) {
        const p = ports[i];
        if (!p || String(p.type || "") !== "port") continue;
        if ((p.owner | 0) !== B) continue;
        if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(p)) continue;
        const targetWater = this._navyPickAdjacentWater((p.x | 0), (p.y | 0), compId);
        if (!targetWater) continue;
        const dx = (p.x | 0) - (st.x | 0);
        const dy = (p.y | 0) - (st.y | 0);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = {
            sourcePort: st,
            targetPort: p,
            sourceSpawn,
            targetWater,
            compId,
            distancePx: Math.max(1, Math.round(Math.hypot(dx, dy)))
          };
        }
      }
      return best;
    }

  World.prototype._navyComputePortTradeReward = function(ownerId, routeDistancePx) {
      const A = ownerId | 0;
      const distancePx = Math.max(0, Number(routeDistancePx) || 0);
      const baseReward = Math.max(0, Number(PORT_TRADE_REWARD_BASE_GOLD) || 0);
      const perPixel = Math.max(0, Number(PORT_TRADE_REWARD_PER_PIXEL) || 0);
      const maxReward = Math.max(baseReward, Number(PORT_TRADE_REWARD_MAX_GOLD) || baseReward);
      const researchBonuses = (typeof this.getResearchBonuses === "function") ? this.getResearchBonuses(A) : null;
      const rewardMul = 1 + Math.max(0, Number(researchBonuses?.tradeShipRewardMul) || 0);
      const raw = Math.min(maxReward, baseReward + (distancePx * perPixel));
      return Math.max(0, Math.round(raw * rewardMul));
    }

  World.prototype._navyResolvePortTradeRoute = function(ownerId, partner) {
      const A = ownerId | 0;
      const p = (partner && typeof partner === "object") ? partner : null;
      if (!p || !p.sourceSpawn || !p.targetWater) return null;

      const route = this._navyBuildWaterPath(
        p.sourceSpawn.x | 0,
        p.sourceSpawn.y | 0,
        p.targetWater.x | 0,
        p.targetWater.y | 0,
        p.compId | 0
      );
      if (!route || route.length <= 0) return null;

      const routeDistancePx = Math.max(p.distancePx | 0, route.length | 0);
      return {
        sourcePort: p.sourcePort || null,
        targetPort: p.targetPort || null,
        sourceSpawn: p.sourceSpawn,
        targetWater: p.targetWater,
        compId: p.compId | 0,
        distancePx: Math.max(1, p.distancePx | 0),
        route,
        routeDistancePx: Math.max(1, routeDistancePx | 0),
        rewardGold: this._navyComputePortTradeReward(A, routeDistancePx)
      };
    }

  World.prototype.getPortTradeStatus = function(structId, ownerId = OWNER.PLAYER) {
      const sid = structId | 0;
      const A = ownerId | 0;
      const st = this._structureById && typeof this._structureById.get === "function"
        ? this._structureById.get(sid)
        : null;
      if (!st || String(st.type || "") !== "port") return { ok: false, reason: "Port not found." };
      if ((st.owner | 0) !== A) return { ok: false, reason: "You do not control this Port." };

      const out = {
        ok: true,
        reason: "",
        portId: sid,
        available: true,
        isActive: false,
        activeShipId: 0,
        activeTargetOwnerId: 0,
        activeTargetName: "",
        activeDistancePx: 0,
        activeRewardGold: 0,
        cooldownUntil: 0,
        cooldownRemainingS: 0,
        allies: []
      };

      if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(st)) {
        out.available = false;
        out.reason = (typeof this._getStructureInactiveReason === "function")
          ? this._getStructureInactiveReason(st)
          : "Port is unavailable.";
        return out;
      }

      const d = this._navyGetPortTradeRecord(st, true);
      if (d && (d.activeShipId | 0) > 0) {
        out.isActive = true;
        out.activeShipId = d.activeShipId | 0;
        out.activeTargetOwnerId = d.targetOwnerId | 0;
        out.activeTargetName = d.targetOwnerId > 0 ? this._nameOf(d.targetOwnerId | 0) : "";
        out.activeDistancePx = Math.max(0, Math.round(Number(d.distancePx) || 0));
        out.activeRewardGold = Math.max(0, Math.round(Number(d.rewardGold) || 0));
      }
      out.cooldownUntil = Math.max(0, Number(d?.cooldownUntil) || 0);
      out.cooldownRemainingS = Math.max(0, out.cooldownUntil - (Number(this.time) || 0));

      const sourceSpawn = this._navyPickAdjacentWater((st.x | 0), (st.y | 0));
      if (!sourceSpawn) {
        out.available = false;
        out.reason = "Port is not coastal.";
        return out;
      }
      const compId = this._navyWaterCompAt(sourceSpawn.x | 0, sourceSpawn.y | 0) | 0;
      if (!compId) {
        out.available = false;
        out.reason = "Port is not connected to an ocean route.";
        return out;
      }

      for (let oid = 1; oid <= this._nationCount; oid++) {
        if ((oid | 0) === A) continue;
        const nat = this.nation[oid];
        if (!nat || !nat.alive || nat.collapsed) continue;
        const rel = (typeof this.getRelation === "function") ? this.getRelation(A, oid) : null;
        if (!rel?.allied) continue;

        const partner = this._navyFindBestPortTradePartner(A, st, oid);
        const resolved = partner ? this._navyResolvePortTradeRoute(A, partner) : null;
        if (!resolved || (resolved.compId | 0) !== compId) {
          out.allies.push({
            nationId: oid | 0,
            name: this._nameOf(oid),
            distancePx: 0,
            disabled: true,
            reason: "No reachable allied port."
          });
          continue;
        }
        out.allies.push({
          nationId: oid | 0,
          name: this._nameOf(oid),
          distancePx: Math.max(1, resolved.distancePx | 0),
          routeDistancePx: Math.max(1, resolved.routeDistancePx | 0),
          rewardGold: Math.max(0, resolved.rewardGold | 0),
          disabled: false,
          targetPortId: resolved.targetPort?.id | 0
        });
      }

      out.allies.sort((a, b) => {
        const ad = a?.disabled ? 1 : 0;
        const bd = b?.disabled ? 1 : 0;
        if (ad !== bd) return ad - bd;
        const da = Math.max(0, Number(a?.distancePx) || 0);
        const db = Math.max(0, Number(b?.distancePx) || 0);
        if (da !== db) return da - db;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });

      if (!out.isActive) {
        if (out.cooldownRemainingS > 0.00001) {
          out.available = false;
          out.reason = `Trade cooldown: ${_navyFormatCooldown(out.cooldownRemainingS)} remaining.`;
        } else {
          const hasReachable = out.allies.some((ally) => !ally?.disabled);
          if (!hasReachable) {
            out.available = false;
            out.reason = out.allies.length > 0
              ? "No reachable allied port."
              : "Form an alliance to start sea trade.";
          }
        }
      }

      if (!out.isActive && out.cooldownRemainingS <= 0.00001) {
        out.cooldownRemainingS = 0;
        out.cooldownUntil = 0;
      }

      return out;
    }

  World.prototype.startPortTrade = function(structId, ownerId, allyId, options = null) {
      if (this.gameOver) return { ok: false, reason: "Game over." };
      const sid = structId | 0;
      const A = ownerId | 0;
      const B = allyId | 0;
      const st = this._structureById && typeof this._structureById.get === "function"
        ? this._structureById.get(sid)
        : null;
      if (!st || String(st.type || "") !== "port") return { ok: false, reason: "Port not found." };
      if ((st.owner | 0) !== A) return { ok: false, reason: "You do not control this Port." };
      if (B <= 0 || B === A) return { ok: false, reason: "Choose an allied nation." };
      if (!this.nation[A]?.alive || !this.nation[B]?.alive) return { ok: false, reason: "Invalid trade partner." };
      if (typeof this._isStructureOperational === "function" && !this._isStructureOperational(st)) {
        return {
          ok: false,
          reason: (typeof this._getStructureInactiveReason === "function")
            ? this._getStructureInactiveReason(st)
            : "Port is unavailable."
        };
      }

      const rel = (typeof this.getRelation === "function") ? this.getRelation(A, B) : null;
      if (!rel?.allied) return { ok: false, reason: "You can only trade with allies." };

      const portTrade = this._navyGetPortTradeRecord(st, true);
      if (portTrade && (portTrade.activeShipId | 0) > 0) {
        return { ok: false, reason: "This Port already has an active trade ship." };
      }
      const cooldownRemainingS = Math.max(0, (Number(portTrade?.cooldownUntil) || 0) - (Number(this.time) || 0));
      if (cooldownRemainingS > 0.00001) {
        return { ok: false, reason: `Trade cooldown: ${_navyFormatCooldown(cooldownRemainingS)} remaining.` };
      }

      const partner = this._navyFindBestPortTradePartner(A, st, B);
      const resolved = partner ? this._navyResolvePortTradeRoute(A, partner) : null;
      if (!resolved || !resolved.sourceSpawn || !resolved.targetWater) {
        return { ok: false, reason: "No reachable allied Port for that trade route." };
      }

      const route = resolved.route;
      const routeDistancePx = Math.max(1, resolved.routeDistancePx | 0);
      const rewardGold = Math.max(0, resolved.rewardGold | 0);
      const ship = {
        id: (this._nextShipId++ | 0),
        kind: "trade",
        owner: A,
        cx: resolved.sourceSpawn.x | 0,
        cy: resolved.sourceSpawn.y | 0,
        px: (resolved.sourceSpawn.x | 0) + 0.5,
        py: (resolved.sourceSpawn.y | 0) + 0.5,
        tx: resolved.targetWater.x | 0,
        ty: resolved.targetWater.y | 0,
        nx: null,
        ny: null,
        seg: 0,
        speed: TRADE_SHIP_SPEED_CPS,
        hp: TRADE_SHIP_HP,
        mode: "toPort",
        comp: resolved.compId | 0,
        trail: [],
        trailAcc: 0,
        sourcePortId: st.id | 0,
        targetOwnerId: B,
        targetPortId: resolved.targetPort?.id | 0,
        tradeDistancePx: Math.max(1, resolved.distancePx | 0),
        tradeRouteDistancePx: Math.max(1, routeDistancePx | 0),
        tradeRewardGold: Math.max(0, rewardGold | 0),
        createdAt: this.time
      };
      this._navySetShipRoute(ship, route);
      this.ships.push(ship);

      const d = this._navyEnsurePortTradeData(st);
      d.activeShipId = ship.id | 0;
      d.targetOwnerId = B;
      d.targetPortId = resolved.targetPort?.id | 0;
      d.distancePx = Math.max(1, resolved.distancePx | 0);
      d.routeDistancePx = Math.max(1, routeDistancePx | 0);
      d.rewardGold = Math.max(0, rewardGold | 0);
      d.startedAt = Math.max(0, Number(this.time) || 0);
      d.cooldownUntil = 0;

      const opts = (options && typeof options === "object") ? options : null;
      if (!opts?.silent && A === OWNER.PLAYER) {
        this._pushEvent(`Trade ship launched toward ${this._nameOf(B)} (${d.distancePx | 0}px).`);
      }

      return {
        ok: true,
        reason: "",
        trade: {
          shipId: ship.id | 0,
          targetOwnerId: B,
          targetOwnerName: this._nameOf(B),
          targetPortId: resolved.targetPort?.id | 0,
          distancePx: Math.max(1, resolved.distancePx | 0),
          routeDistancePx: Math.max(1, routeDistancePx | 0),
          rewardGold: Math.max(0, rewardGold | 0)
        }
      };
    }

  World.prototype._navyAssignTradeTrip = function(s) {
      const A = s.owner | 0;

      const cx = s.cx | 0;
      const cy = s.cy | 0;

      const compId = (s.comp | 0) || this._navyWaterCompAt(cx, cy);
      s.comp = compId | 0;

      const dest = this._navyPickOtherPortWaterTarget(A, compId, cx, cy);

      if (dest) {
        s.mode = "toPort";
        s.tx = dest.x | 0;
        s.ty = dest.y | 0;
        s.wanderUntil = 0;
      } else {
        s.mode = "wander";
        const dur = TRADE_WANDER_MIN_S + (this._navyRng() * (TRADE_WANDER_MAX_S - TRADE_WANDER_MIN_S));
        s.wanderUntil = this.time + dur;

        // Wander target = far-ish water tile on same body (random-walk).
        let t = null;
        for (let k = 0; k < 4; k++) {
          t = this._navyPickTradeTargetFromWater(cx, cy);
          if (!t) continue;
          const md = Math.abs((t.x | 0) - cx) + Math.abs((t.y | 0) - cy);
          if (md >= 18) break;
          t = null;
        }
        if (!t) t = { x: cx, y: cy };

        s.tx = t.x | 0;
        s.ty = t.y | 0;
      }

      // Reset segment interpolation.
      this._navyClearShipRoute(s);
      s.nx = null;
      s.ny = null;
      s.seg = 0;
    }

  World.prototype._navyAdvanceTradeShip = function(s, dt) {
      const speed = (Number(s.speed) || TRADE_SHIP_SPEED_CPS);
      let dist = dt * speed;
      if (!(dist > 0)) return;

      // Legacy/robustness: if old ships exist in memory, map them into the new fields.
      if (s.cx == null || s.cy == null) {
        s.cx = (s.x | 0);
        s.cy = (s.y | 0);
        s.seg = 0;
        s.nx = null;
        s.ny = null;
        s.comp = (s.comp | 0) || this._navyWaterCompAt(s.cx | 0, s.cy | 0);
        s.pcx = (s.cx | 0);
        s.pcy = (s.cy | 0);
      }

      if (s.pcx == null || s.pcy == null) { s.pcx = (s.cx | 0); s.pcy = (s.cy | 0); }

      if (!(Number(s.seg) >= 0)) s.seg = 0;
      if (!Number.isFinite(Number(s._stuckTicks))) s._stuckTicks = 0;
      const startCx = s.cx | 0;
      const startCy = s.cy | 0;
      const now = Number(this.time) || 0;
      const stepOut = this._navyStepOut || (this._navyStepOut = { x: 0, y: 0 });

      while (dist > 0) {
        if (s.nx == null || s.ny == null) {
          if (((s.cx | 0) === (s.tx | 0)) && ((s.cy | 0) === (s.ty | 0))) break;

          const kind = String(s.kind || "");
          const compId = (s.comp | 0);
          const usesPlannedRoute = (kind === "trade" || kind === "transport");
          const stuckTicks = s._stuckTicks | 0;
          const forcePath = (stuckTicks >= (kind === "transport" ? 2 : 4));
          const pathCadence = (kind === "transport") ? 0.75 : 0.28;
          const pathAllowedAt = Number(s._pathAllowedAt) || 0;
          let step = null;

          if (usesPlannedRoute) {
            if (Array.isArray(s._route) && (((s._routeGoalX | 0) !== (s.tx | 0)) || ((s._routeGoalY | 0) !== (s.ty | 0)))) {
              this._navyClearShipRoute(s);
            }
            step = this._navyConsumeRouteStep(s, compId, stepOut);
            if (!step && now >= pathAllowedAt) {
              const route = this._navyBuildWaterPath((s.cx | 0), (s.cy | 0), (s.tx | 0), (s.ty | 0), compId);
              if (route && route.length > 0) {
                this._navySetShipRoute(s, route);
                step = this._navyConsumeRouteStep(s, compId, stepOut);
              }
              s._pathAllowedAt = now + pathCadence;
            }
          }
          if (!step && forcePath && now >= pathAllowedAt) {
            step = this._navyStepWaterTowardPath((s.cx | 0), (s.cy | 0), (s.tx | 0), (s.ty | 0), (s.comp | 0), stepOut);
            s._pathAllowedAt = now + pathCadence;
          }
          if (!step) {
            step = this._navyStepWaterToward((s.cx | 0), (s.cy | 0), (s.tx | 0), (s.ty | 0), (s.pcx | 0), (s.pcy | 0), stepOut);
          }
          if (!step && !forcePath && now >= pathAllowedAt) {
            step = this._navyStepWaterTowardPath((s.cx | 0), (s.cy | 0), (s.tx | 0), (s.ty | 0), compId, stepOut);
            s._pathAllowedAt = now + pathCadence;
          }
          if (!step) {
            step = this._navyPickAdjacentWater((s.cx | 0), (s.cy | 0), compId, (s.pcx | 0), (s.pcy | 0), stepOut);
          }
          if (!step) break;

          s.nx = step.x | 0;
          s.ny = step.y | 0;
          s.seg = 0;
        }

        const seg = Number(s.seg) || 0;
        const remain = 1 - seg;

        if (dist < remain) {
          s.seg = seg + dist;
          dist = 0;
        } else {
          dist -= remain;
          s.pcx = (s.cx | 0);
          s.pcy = (s.cy | 0);
          s.cx = s.nx | 0;
          s.cy = s.ny | 0;
          s.nx = null;
          s.ny = null;
          s.seg = 0;
        }
      }

      const ax = (s.cx | 0) + 0.5;
      const ay = (s.cy | 0) + 0.5;

      if (s.nx != null && s.ny != null) {
        const bx = (s.nx | 0) + 0.5;
        const by = (s.ny | 0) + 0.5;
        const seg = Number(s.seg) || 0;
        s.px = ax + (bx - ax) * seg;
        s.py = ay + (by - ay) * seg;
      } else {
        s.px = ax;
        s.py = ay;
      }

      if (((s.cx | 0) === startCx) && ((s.cy | 0) === startCy)) {
        s._stuckTicks = (s._stuckTicks | 0) + 1;
      } else {
        s._stuckTicks = 0;
      }

      const kindNow = String(s.kind || "");
      const stuckLimit = kindNow === "transport" ? 6 : 10;
      if ((s._stuckTicks | 0) >= stuckLimit) {
        if (kindNow === "trade" && (s.sourcePortId | 0) > 0) {
          this._navyClearShipRoute(s);
          s.nx = null;
          s.ny = null;
          s.seg = 0;
          s._pathAllowedAt = 0;
          s._stuckTicks = 0;
        } else if (kindNow === "trade") {
          this._navyAssignTradeTrip(s);
        } else if (kindNow === "transport") {
          this._navyClearShipRoute(s);
          s.nx = null;
          s.ny = null;
          s.seg = 0;
          s._pathAllowedAt = 0;
          s._stuckTicks = 0;
        } else if (kindNow === "war") {
          s.targetId = 0;
          s.tx = s.ax | 0;
          s.ty = s.ay | 0;
          s.nx = null;
          s.ny = null;
          s.seg = 0;
        }
      }
    }

  World.prototype._navyUpdateTradeTrail = function(s) {
      const now = this.time;

      if (!s.trail) s.trail = [];
      const tr = s.trail;

      const x = (typeof s.px === "number") ? s.px : ((s.cx | 0) + 0.5);
      const y = (typeof s.py === "number") ? s.py : ((s.cy | 0) + 0.5);

      const last = tr.length ? tr[tr.length - 1] : null;
      const minD = TRADE_TRAIL_POINT_SPACING;
      const minD2 = minD * minD;

      if (!last) {
        tr.push({ x, y, t: now });
      } else {
        const dx = (x - last.x);
        const dy = (y - last.y);
        if ((dx * dx + dy * dy) >= minD2) tr.push({ x, y, t: now });
      }

      // Keep short + prune by age.
      if (tr.length > TRADE_TRAIL_MAX_POINTS) {
        tr.splice(0, tr.length - TRADE_TRAIL_MAX_POINTS);
      }
      if (tr.length) {
        let firstAlive = 0;
        const n = tr.length | 0;
        while (firstAlive < n && ((now - tr[firstAlive].t) > TRADE_TRAIL_FADE_S)) firstAlive++;
        if (firstAlive > 0) tr.splice(0, firstAlive);
      }
    }


}
