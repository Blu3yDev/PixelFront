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
- `MATCH_SNAPSHOT_INTERVAL_MS` (default `66`, snapshot cadence in ms)
- `MATCH_MAX_STEPS_PER_PUMP` (default `8`, max sim steps per server pump)
- `MATCH_PUMP_INTERVAL_MS` (default `16`, runtime pump interval in ms)
- `MATCH_MAX_BACKLOG_MS` (default `250`, max queued sim time under load)
- `MATCH_MAX_WORLD_WIDTH` (default `1600`)
- `MATCH_MAX_WORLD_HEIGHT` (default `900`)
- `MATCH_MAX_WORLD_TILES` (default `700000`)
- `MATCH_MAX_AI_COUNT` (default `16`)
- `WS_DEBUG_LOGS` (default `0`, set `1` for temporary websocket reject diagnostics)

Note: the server also applies dynamic per-lobby safety caps based on human player count
to avoid heavy AI/world specs causing lag spikes on smaller deployments.

## Render deploy

You can deploy this folder directly as a Render Web Service, or use `render.yaml`.
Runtime should be **Node**, not Python.

## Full setup checklist (Render + Vercel)

1. Deploy `MultiplayerServer` to Render as a Web Service.
2. Wait for service URL, e.g. `https://pixelfront-multiplayer.onrender.com`.
3. In Render env vars:
   - `CORS_ORIGIN=https://YOURDOMAIN.com,https://www.YOURDOMAIN.com`
   - `MAX_PLAYERS_PER_LOBBY=8`
   - `LOBBY_IDLE_TTL_MS=21600000`
   - `MATCH_SNAPSHOT_INTERVAL_MS=66`
   - `MATCH_MAX_STEPS_PER_PUMP=8`
   - `MATCH_PUMP_INTERVAL_MS=16`
   - `MATCH_MAX_BACKLOG_MS=250`
   - `MATCH_MAX_WORLD_WIDTH=1600`
   - `MATCH_MAX_WORLD_HEIGHT=900`
   - `MATCH_MAX_WORLD_TILES=700000`
   - `MATCH_MAX_AI_COUNT=16`
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
