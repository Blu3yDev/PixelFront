# PixelFront Multiplayer Service

This service powers:
- Create lobby
- Join by code
- Poll lobby state
- Start lobby (host only)
- Leave lobby
- Realtime lobby updates (`/ws`)
- Authoritative in-match simulation (server runs the world)
- Authoritative snapshots (`snapshot_delta`) + resync (`full_sync`)
- Authoritative command validation + ack/reject (`cmd_ack` / `cmd_reject`)

It uses in-memory storage for now (good for prototyping, not production persistence).

## Local run

1. Open a terminal in `MultiplayerServer`.
2. Run `npm install`.
3. Run `npm start`.
4. Service starts on `http://localhost:8080`.

## API endpoints

- `GET /health`
- `POST /api/lobbies/create`
- `POST /api/lobbies/join`
- `POST /api/lobbies/state`
- `POST /api/lobbies/start`
- `POST /api/lobbies/leave`
- `WS /ws?code=...&sessionId=...`
  - Lobby realtime events (`hello`, `lobby_update`, `started`, `pong`)
  - In-match authoritative events (`snapshot_delta`, `full_sync`, `cmd_ack`, `cmd_reject`)
- Legacy compatibility:
  - `GET /api/lobbies/:code?sessionId=...`
  - `POST /api/lobbies/:code/start`
  - `POST /api/lobbies/:code/leave`

## Environment variables

- `PORT` (default `8080`)
- `CORS_ORIGIN` (default `*`)
- `MAX_PLAYERS_PER_LOBBY` (default `8`)
- `LOBBY_IDLE_TTL_MS` (default `21600000`, 6 hours)
- `MATCH_SNAPSHOT_INTERVAL_MS` (default `60`, snapshot cadence in ms)
- `MATCH_SNAPSHOT_FORCE_INTERVAL_MS` (default `240`, max delay before a snapshot is forced while backlogged)
- `MATCH_STATE_HASH_EVERY_TICKS` (default `24`, include `stateHash` every N sim ticks)
- `MATCH_SNAPSHOT_STATS_INTERVAL_MS` (default `220`, nation stats/leaderboard cadence on deltas)
- `MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS` (default `320`, diplomacy relations cadence on deltas)
- `MATCH_SNAPSHOT_EVENTS_INTERVAL_MS` (default `550`, global events cadence on deltas)
- `MATCH_LAG_WARN_INTERVAL_MS` (default `5000`, server lag warning throttle)
- `MATCH_MAX_STEPS_PER_PUMP` (default `8`, max sim steps per server pump)
- `MATCH_PUMP_INTERVAL_MS` (default `16`, runtime pump interval in ms)
- `MATCH_MAX_BACKLOG_MS` (default `250`, max queued sim time under load)
- `MATCH_MAX_WORLD_WIDTH` (default `960`)
- `MATCH_MAX_WORLD_HEIGHT` (default `540`)
- `MATCH_MAX_WORLD_TILES` (default `220000`)
- `MATCH_MAX_AI_COUNT` (default `6`)
- `WS_DEBUG_LOGS` (default `0`, set `1` for temporary websocket reject diagnostics)
- `PIXELFRONT_MAIN_SRC_DIR` (optional explicit path to `Main/src`; alias `PF_MAIN_SRC_DIR`)
- `PIXELFRONT_MAIN_ROOT` (optional explicit repo root containing `Main`; alias `PF_MAIN_ROOT`)
- `PIXELFRONT_EARTHMAP_DIR` (optional explicit path to `Main/src/EarthMap`; alias `PF_EARTHMAP_DIR`)

Note: the server also applies dynamic per-lobby safety caps based on human player count
to avoid heavy AI/world specs causing lag spikes on smaller deployments.

## Render deploy

You can deploy this folder directly as a Render Web Service, or use `render.yaml`.
Runtime should be **Node**, not Python.

## Railway path notes

If your service runs from `/app/server.js`, the server first tries local `src` runtime files, then `Main/src` candidates.

The repo now includes a vendored runtime fallback in `MultiplayerServer/src`:
- `MultiplayerServer/src/game` (authoritative World runtime)
- `MultiplayerServer/src/EarthMap` (Earth assets)

So deploying only `MultiplayerServer` works out of the box.

Set these Railway env vars when needed:
- `PIXELFRONT_MAIN_SRC_DIR=/app/Main/src`
- `PIXELFRONT_EARTHMAP_DIR=/app/Main/src/EarthMap`

If your deploy does not include `/app/Main`, deploy from the repository root (so both `Main` and `MultiplayerServer` are present) and run:
- Build command: `npm install --prefix MultiplayerServer`
- Start command: `node MultiplayerServer/server.js`

## Full setup checklist (Render + Vercel)

1. Deploy `MultiplayerServer` to Render as a Web Service.
2. Wait for service URL, e.g. `https://pixelfront-multiplayer.onrender.com`.
3. In Render env vars:
   - `CORS_ORIGIN=https://YOURDOMAIN.com,https://www.YOURDOMAIN.com`
   - `MAX_PLAYERS_PER_LOBBY=8`
   - `LOBBY_IDLE_TTL_MS=21600000`
   - `MATCH_SNAPSHOT_INTERVAL_MS=60`
   - `MATCH_SNAPSHOT_FORCE_INTERVAL_MS=240`
   - `MATCH_STATE_HASH_EVERY_TICKS=24`
   - `MATCH_SNAPSHOT_STATS_INTERVAL_MS=220`
   - `MATCH_SNAPSHOT_RELATIONS_INTERVAL_MS=320`
   - `MATCH_SNAPSHOT_EVENTS_INTERVAL_MS=550`
   - `MATCH_LAG_WARN_INTERVAL_MS=5000`
   - `MATCH_MAX_STEPS_PER_PUMP=8`
   - `MATCH_PUMP_INTERVAL_MS=16`
   - `MATCH_MAX_BACKLOG_MS=250`
   - `MATCH_MAX_WORLD_WIDTH=960`
   - `MATCH_MAX_WORLD_HEIGHT=540`
   - `MATCH_MAX_WORLD_TILES=220000`
   - `MATCH_MAX_AI_COUNT=6`
4. In Vercel project env vars (Production + Preview):
   - `VITE_MULTIPLAYER_API_URL=https://pixelfront-multiplayer.onrender.com`
5. Redeploy Vercel after setting env vars.
6. Redeploy Render after changing CORS.
7. Hard refresh the game tab after deploy to avoid stale JS bundle.

## Troubleshooting

- If UI says `Set VITE_MULTIPLAYER_API_URL to enable Create/Join`:
  - Confirm var name is exactly `VITE_MULTIPLAYER_API_URL`.
  - Confirm it is set in the same Vercel project/environment you're deploying.
  - Trigger a fresh deployment (env vars are build-time for Vite).

- If Railway still logs old module import paths:
  - Your deployment is running stale code.
  - Check `GET /health`; it now returns `build` and `runtimeMainSrc`.
  - Startup logs should include `[multiplayer-server] build=...` and then `[runtime-init] main-src=...`.

- If Create/Join fails with network error:
  - Verify Render service is online (`GET /health`).
  - Verify `CORS_ORIGIN` includes your exact site origin.
  - Free Render instances may cold start (10-20s) on first request.

- If browser says `No 'Access-Control-Allow-Origin' header`:
  - Most often the backend was unavailable (`5xx`) or restarting, not a frontend bug.
  - Check Render logs first; if service is not listening, CORS headers will not be returned.
  - Confirm `CORS_ORIGIN` is exactly `https://pixelfront-official.vercel.app` (protocol required, no trailing slash).
  - Redeploy Render after env changes.

- If `/api/lobbies/state` returns `400` repeatedly:
  - Session/lobby is stale (common after backend restart, because lobbies are in-memory).
  - Create a fresh lobby and rejoin.
  - Frontend now auto-resets stale sessions, but old tabs may need hard refresh.

- If players load different worlds:
  - Make sure both frontend and backend are fully redeployed to latest code.
  - Host must start lobby after backend update (old lobbies may miss the locked `worldSpec`).
  - Confirm both clients are on the same Vercel build (hard refresh both browsers).
