# PixelFront Multiplayer Service

This service powers:
- Create lobby
- Join by code
- Poll lobby state
- Start lobby (host only)
- Leave lobby
- Realtime lobby updates (`/ws`)
- Realtime in-match command relay (`match_cmd`)

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
  - In-match command relay (`match_cmd`)
- Legacy compatibility:
  - `GET /api/lobbies/:code?sessionId=...`
  - `POST /api/lobbies/:code/start`
  - `POST /api/lobbies/:code/leave`

## Environment variables

- `PORT` (default `8080`)
- `CORS_ORIGIN` (default `*`)
- `MAX_PLAYERS_PER_LOBBY` (default `8`)
- `LOBBY_IDLE_TTL_MS` (default `21600000`, 6 hours)

## Render deploy

You can deploy this folder directly as a Render Web Service, or use `render.yaml`.
Runtime should be **Node**, not Python.

## Full setup checklist (Render + Vercel)

1. Deploy `MultiplayerServer` to Render as a Web Service.
2. Wait for service URL, e.g. `https://pixelfront-multiplayer.onrender.com`.
3. In Render env vars:
   - `CORS_ORIGIN=https://YOURDOMAIN.com,https://www.YOURDOMAIN.com`
   - (optional) `MAX_PLAYERS_PER_LOBBY=8`
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

- If players load different worlds:
  - Make sure both frontend and backend are fully redeployed to latest code.
  - Host must start lobby after backend update (old lobbies may miss the locked `worldSpec`).
  - Confirm both clients are on the same Vercel build (hard refresh both browsers).
