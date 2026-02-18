// FILE: src/game/systems/navy.js

import { OWNER, TRADE_EVENT_COOLDOWN_S, TRADE_SHIP_HP, TRADE_SHIP_RESPAWN_S, TRADE_SHIP_REWARD_GOLD, TRADE_SHIP_SPEED_CPS, TRADE_TRAIL_FADE_S, TRADE_TRAIL_MAX_POINTS, TRADE_TRAIL_POINT_SPACING, TRADE_TRIP_STEPS_MAX, TRADE_TRIP_STEPS_MIN, TRADE_WANDER_MAX_S, TRADE_WANDER_MIN_S, TRANSPORT_SPEED_CPS, WARSHIP_CHASE_TILES, WARSHIP_DETECT_TILES, WARSHIP_DPS, WARSHIP_HP, WARSHIP_LAUNCH_GOLD_COST, WARSHIP_MAX_ACTIVE, WARSHIP_RAID_LOOT_TRADE_GOLD, WARSHIP_RAID_LOOT_TRANSPORT_GOLD, WARSHIP_RAID_LOOT_WARSHIP_GOLD, WARSHIP_RANGE_TILES, WARSHIP_SPEED_CPS, WAR_EVENT_COOLDOWN_S } from "../config.js";
import { clamp01, clamp8, clampInt, fbm01, hash01, lerp, mulberry32, noise2, ridgeFbm01, smoothstep01, title } from "../utils.js";

export function installNavy(World) {
  const _navySetStepOut = (out, x, y) => {
    if (!out) return { x, y };
    out.x = x | 0;
    out.y = y | 0;
    return out;
  };

  World.prototype._tickNavy = function(dt) {
      if (!(dt > 0)) return;

      const ships = this.ships;
      const removeShipAt = (idxRaw) => {
        const idx = idxRaw | 0;
        const last = (ships.length - 1) | 0;
        if (idx < 0 || idx > last) return;
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
          s.speed = TRADE_SHIP_SPEED_CPS;
          if (s.mode !== "toPort" && s.mode !== "wander") this._navyAssignTradeTrip(s);

          this._navyAdvanceTradeShip(s, dt);
          this._navyUpdateTradeTrail(s);

          const arrived = (s.nx == null && s.ny == null &&
            ((s.cx | 0) === (s.tx | 0)) &&
            ((s.cy | 0) === (s.ty | 0)));

          if (!arrived) continue;

          if (s.mode === "toPort") {
            // Trip complete: payout, then despawn and respawn after a cooldown (per-port-slot ship).
            n.gold += TRADE_SHIP_REWARD_GOLD;

            if (A === OWNER.PLAYER && this.time >= this._tradeEventCooldownUntil[A]) {
              this._tradeEventCooldownUntil[A] = this.time + TRADE_EVENT_COOLDOWN_S;
              this._pushEvent(`Trade ship returned (+${TRADE_SHIP_REWARD_GOLD} Gold).`);
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
            s.nx = null; s.ny = null; s.seg = 0;
            continue;
          }

          if (this.time >= (Number(s.wanderUntil) || 0)) {
            n.gold += TRADE_SHIP_REWARD_GOLD;

            if (A === OWNER.PLAYER && this.time >= this._tradeEventCooldownUntil[A]) {
              this._tradeEventCooldownUntil[A] = this.time + TRADE_EVENT_COOLDOWN_S;
              this._pushEvent(`Trade route completed (+${TRADE_SHIP_REWARD_GOLD} Gold).`);
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

        if (!tgt) continue;

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
          this._navySetTradeSlotCooldown(victimOwner, s.portKey, TRADE_SHIP_RESPAWN_S);
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

      // ---- Spawn trade ships (1 Port-slot = 1 Trade Ship; no global cap) ----
      // Build per-port slots and ensure each slot maintains one trade ship (after cooldown).
      const shipsByKey = this._navyTickShipsByKey || (this._navyTickShipsByKey = new Set());
      shipsByKey.clear();
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        if (s && s.kind === "trade" && s.portKey) shipsByKey.add(String(s.portKey));
      }

      for (let id = 1; id <= this._nationCount; id++) {
        const nat = this.nation[id];
        if (!nat || !nat.alive) continue;

        const ports = this._portsByOwner[id] || [];
        if (!ports.length) continue;

        for (let p = 0; p < ports.length; p++) {
          const st = ports[p];
          if (!st) continue;

          const c = ((st.count | 0) > 0 ? (st.count | 0) : 1) | 0;
          for (let slot = 0; slot < c; slot++) {
            const baseKey = String(st.id || ((st.x | 0) + "," + (st.y | 0)));
            let slotKeys = st._navySlotKeys;
            if (!Array.isArray(slotKeys) || slotKeys.length < c || String(st._navySlotKeyBase || "") !== baseKey) {
              slotKeys = new Array(c);
              for (let k = 0; k < c; k++) slotKeys[k] = `${baseKey}:${k}`;
              st._navySlotKeys = slotKeys;
              st._navySlotKeyBase = baseKey;
            }
            const key = slotKeys[slot];
            if (shipsByKey.has(key)) continue;
            if (!this._navyCanSpawnTradeForSlot(id, key)) continue;

            const ok = this._navySpawnTradeShipFromPortSlot(id, st, slot, key);
            if (ok && ok.ok) {
              shipsByKey.add(key);
            }
          }
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
      nat.gold = Math.max(0, (nat.gold || 0) - launchCost);

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
          const stuckTicks = s._stuckTicks | 0;
          const forcePath = (stuckTicks >= (kind === "transport" ? 2 : 4));
          const pathCadence = (kind === "transport") ? 0.20 : 0.28;
          const pathAllowedAt = Number(s._pathAllowedAt) || 0;
          let step = null;

          if (forcePath && now >= pathAllowedAt) {
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

      if ((s._stuckTicks | 0) >= 10) {
        if (String(s.kind || "") === "trade") {
          this._navyAssignTradeTrip(s);
        } else if (String(s.kind || "") === "war") {
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
