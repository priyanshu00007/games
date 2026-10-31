# Wizard Chess 3D — Sanctum Edition

An interactive 3D Gothic-cathedral chess game built with React, Three.js and a
local chess engine. Sculpted stone pieces, cinematic melee captures, stone
shatter physics, and a cast of AI opponents with distinct personalities.

No API keys. No network calls. Everything runs locally in the browser.

## Run locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev      # http://localhost:9000
```

## Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Type-check with `tsc --noEmit` |

## Controls

- **Click** a piece to move · **Left-drag** orbit · **Right-drag** pan · **Scroll** zoom
- **WASD + R/F** fly camera · **H** hide HUD · **Esc** close panels

## Opponent personalities

Pick an opponent from the HUD — each has its own evaluation style, search
depth and blunder rate, so no two games feel the same. See
`src/chess/personalities.js` for the roster.

## Optional: Stockfish

The default opponent is the bundled lightweight engine (chess.js + negamax
search). For grandmaster-strength play you can switch on Stockfish, which is
loaded lazily on demand and falls back to the built-in engine if unavailable.

## Project layout

```
src/
  App.tsx                 React HUD shell
  wizardChessEngine.js    Three.js scene, board, animation, rules glue
  chess/
    engine.js             negamax + alpha-beta + piece-square evaluation
    personalities.js      opponent roster and tuning
    stockfish.js          lazy optional Stockfish adapter
  styles.css              HUD styling
```
