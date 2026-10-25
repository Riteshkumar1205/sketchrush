# SketchRush MVP

A room-based, real-time drawing and guessing game built with Node.js, Express, Socket.IO, and vanilla HTML/CSS/JavaScript.

## Requirements
- Node.js 18 or newer
- npm

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Create a room in one browser tab, then open a second tab or another browser at the same address and join using the six-character room code. Use two different nicknames to make testing easier.

## How to play
- The game starts when at least two players are in a room.
- Each game has five 60-second rounds. The drawer rotates between connected players.
- Only the drawer sees the secret word and can draw on the canvas.
- Other players guess in chat. A correct guess earns 100 points plus the remaining whole seconds; the drawer earns 40 points for a correct guess.
- The player with the highest score after five rounds wins.
- Select a brush color, use the eraser, or clear the canvas during your drawing turn.

## Useful endpoints
- `GET /` — game UI
- `GET /health` — basic server health JSON

## Deploy
This is a single Node.js web service. Push the repository to GitHub and create a Node Web Service on a host that supports persistent WebSocket connections (for example, Render). Build command: `npm install`; start command: `npm start`. Set `NODE_ENV=production` if desired. The app listens on `process.env.PORT` and binds to `0.0.0.0`.

Room state is held in memory. Restarting the server clears rooms, and this MVP is intended for a single server instance (no Redis adapter or horizontal scaling).
