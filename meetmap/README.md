# MeetMap / MapMeet

Real-time social navigation: **rooms + consent-based live location + a shared meeting
point + per-member ETA & arrival**, built to run end-to-end on a local network in
production-ish architecture.

```
meetmap/
├── server/            Fastify + WebSocket gateway (rooms, auth, POI search, fan-out)
│   ├── index.mjs      REST + /api/ws (token-scoped, strips coords on pause)
│   ├── core.mjs       pure domain helpers (codes, tokens, geo, snapshots)
│   └── places.mjs     nearest meetup spots (Overpass mirrors + fallbacks)
├── mapmeet/           the mobile app → Expo / React Native (see its README)
├── src/…              Desktop web slice (same gateway contract, optional)
└── test/              node --test integration + unit suites
```

## Why this split

TheRN app (`mapmeet/`) is the primary client per product decision. The gateway is
platform-neutral (plain HTTP + WS), so a web slice and future Expo/PostGIS upgrades
reuse the exact same contract — see `mapmeet/README.md` for the phone runbook and
`server/README.md`-level details below.

## Privacy model (enforced server-side, not client-side)

- Location sharing is **explicitly opt-in per session** and revocable at any moment.
- The **server** strips coordinates the instant a member pauses sharing or disconnects;
  the "paused" state is shared as a status, never as a last-known position leak.
- Snapshot payloads contain **no tokens** ever; rooms are only readable by their members.
- Location pushes are rate-limited per member (adaptive: fast while moving, slow heartbeat
  when parked) and identity is device-generated (name/emoji/color) — no accounts.

## Verified (from this machine)

- `node --test test/` — **13/13** integration tests (rooms, join/leave/kick, token-scoped
  sockets, coordinate stripping on pause, chat/arrival broadcast, POI query/parse,
  gateway places route)
- `tsc --noEmit` (app) — clean; `expo export --platform android` bundles cleanly
- OSRM walking-route probe live OK; Overpass is proxied behind the gateway with three
  mirrors + failover so the mobile app never depends on one provider

## Two-terminal run

```bash
# terminal 1 — gateway
node server/index.mjs            # listens on :3100

# terminal 2 — phone app
cd mapmeet && npm run start      # scan QR in Expo Go
```
