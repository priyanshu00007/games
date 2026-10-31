# Desk Racer

Miniature desk-coaster time-trial racing game built with Three.js and the
Rapier physics engine. Procedural desk diorama, a looping coaster track, and a
1:87-scale micro kart with a WebAudio engine synth.

No API keys. No network calls at runtime (the 3D models are fetched from a
static CDN and cached).

## Run locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev      # http://localhost:3000
```

## Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Production build to `dist/` (downloads models once) |
| `npm run preview` | Serve the production build |
| `npm run lint` | Type-check with `tsc --noEmit` |

## Project layout

```
src/
  main.js                      Entry, render loop, cameras, HUD
  scene/                       Procedural desk, track, kart, room builders
  physics/KartPhysicsController.js
  audio/WebAudioSynth.js
  style.css                    HUD styling
public/assets/                 Audio loops and data files
```

## Notes

- Models are proxied from a static CDN in dev (`vite.config.ts`) and downloaded
  into `dist/assets/models/` during `npm run build`, so building requires
  internet access once.
- Physics (Rapier WASM) and post-processing are loaded lazily so the first
  frame appears quickly.
