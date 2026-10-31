# Stockfish (optional opponent)

`stockfish.js` + `stockfish.wasm` are the **Stockfish 19 lite, single-threaded**
build, vendored here so `npm install` stays small (the full npm package ships a
99 MB WASM file that this game never uses).

- Upstream: https://github.com/nmrugg/stockfish.js (npm package `stockfish`)
- Engine: https://github.com/official-stockfish/Stockfish
- License: GPL-3.0 — see `LICENSE-GPL3.txt`

## Why these two files

| Build | Size | Notes |
|---|---|---|
| **lite single (used here)** | 1.85 MB | No cross-origin isolation headers required, works on any static host |
| full single | 99 MB | Far stronger but far too heavy to ship |
| lite / full multi-threaded | ~1.7 / 2.8 MB | Need `SharedArrayBuffer` (COOP + COEP headers) |

## How it is loaded

Nothing here is downloaded until the player picks the **Grandmaster
(Stockfish)** opponent. The game then creates a Web Worker from
`/stockfish/stockfish.js`, which resolves its own WASM as
`/stockfish/stockfish.wasm` (same folder, `.js` → `.wasm`).

Stockfish speaks the raw UCI protocol over `postMessage`; see
`src/chess/stockfish.js` for the adapter.
