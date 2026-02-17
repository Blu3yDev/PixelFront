# PixelFront Multiplayer Service (Phase 2)

This service powers the Phase 2 lobby flow used by the main menu:
- Create lobby
- Join by code
- Poll lobby state
- Start lobby (host only)
- Leave lobby

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
