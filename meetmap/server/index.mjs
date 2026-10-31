/**
 * MeetMap realtime gateway.
 *
 * REST (Fastify): create/join/leave/kick rooms, shared destination, status, chat.
 * WS (/api/ws): one socket per authorized member; every authorized member gets
 * the same sanitized snapshot. Tokens never appear in snapshots or logs.
 *
 * Privacy invariants enforced here (not in the client):
 *   - location coordinates are stripped server-side the moment sharing pauses
 *   - only room members can ever receive a room's contents (401 otherwise)
 *   - location pushes are token-scoped and rate-limited per member
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNearbyPlaces } from './places.mjs';
import {
  genCode, genToken, isFiniteLatLng, normalizeProfile,
  roomExpired, roomIsIdle, roomSnapshot, sanitizeText,
  CHAT_MAX, LOC_MIN_INTERVAL_MS, STATUS_KINDS,
} from './core.mjs';

const PERSIST_DEFAULT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export async function createServer({ persistPath = PERSIST_DEFAULT, silent = false } = {}) {
  const app = Fastify({
    logger: silent ? false : { level: 'warn' },
    jsonBodyParserOptions: { bodyLimit: 64 * 1024 },
  });
  /** @type {Map<string, any>} room code -> room */
  const rooms = new Map();
  /** @type {Map<string, Map<string, import('ws').WebSocket>>} code -> token -> socket */
  const sockets = new Map();

  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 128 * 1024 } });

  // ------------------------------------------------------------------ store
  let saveTimer = null;
  function loadPersisted() {
    if (!persistPath) return;
    try {
      const raw = fs.readFileSync(path.join(persistPath, 'rooms.json'), 'utf8');
      const now = Date.now();
      for (const r of JSON.parse(raw) || []) {
        if (roomExpired(r, now)) continue;
        for (const m of r.members) { m.connected = false; m.connectedSince = undefined; }
        rooms.set(r.code, {
          ...r,
          members: new Map(r.members.map((m) => [m.token, m])),
          messages: r.messages ?? [],
        });
      }
    } catch {
      /* first boot or unreadable file */
    }
  }
  function scheduleSave() {
    if (!persistPath) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(persistPath, { recursive: true });
        const rows = [...rooms.values()].map((r) => ({
          code: r.code, name: r.name, createdAt: r.createdAt, ownerToken: r.ownerToken,
          destination: r.destination,
          members: [...r.members.values()].map((m) => ({ ...m, connected: false })),
          messages: r.messages.slice(-60),
        }));
        fs.writeFileSync(path.join(persistPath, 'rooms.json.tmp'), JSON.stringify(rows));
        fs.renameSync(path.join(persistPath, 'rooms.json.tmp'), path.join(persistPath, 'rooms.json'));
      } catch { /* best-effort persistence */ }
    }, 500);
  }
  loadPersisted();

  // -------------------------------------------------------------- broadcasting
  function broadcast(room) {
    const payload = JSON.stringify(roomSnapshot(room));
    const conns = sockets.get(room.code);
    if (conns) for (const [token, ws] of conns) {
      if (!room.members.has(token)) continue;
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
    scheduleSave();
  }

  function authMember(room, token) {
    const m = room?.members.get(String(token ?? ''));
    if (!m) return null;
    m.lastSeen = Date.now();
    return m;
  }

  const fail = (reply, code, text) => reply.code(code).send({ error: text });

  app.get('/api/health', (_req, reply) => reply.send({ ok: true, rooms: rooms.size }));

  app.get('/api/places/nearby', async (req, reply) => {
    const lat = Number(req.query?.lat);
    const lng = Number(req.query?.lng);
    const radius = Number(req.query?.radius) || 1200;
    if (!isFiniteLatLng(lat, lng)) return fail(reply, 400, 'Invalid coordinates');
    const result = await fetchNearbyPlaces({ lat, lng, radius });
    if (!result.ok) return fail(reply, 502, `Place search unavailable (${result.error})`);
    reply.send({ ok: true, source: result.source, places: result.places });
  });

  // -------------------------------------------------------------------- rooms
  function newRoom(name) {
    let code = genCode();
    while (rooms.has(code)) code = genCode();
    const room = {
      code, name: sanitizeText(name, 48) || 'Meetup',
      createdAt: Date.now(), ownerToken: null,
      members: new Map(), destination: null, messages: [],
    };
    rooms.set(code, room);
    return room;
  }

  function addMember(room, profile, shareOn, owner = false) {
    const { name, color, emoji } = profile;
    const member = {
      id: genToken().slice(0, 12),
      token: genToken(),
      name, color, emoji,
      shareOn: !!shareOn,
      connected: false,
      arrived: false, status: 'active',
      joinedAt: Date.now(), lastSeen: Date.now(),
      owner: false,
      lastLocPush: 0,
    };
    if (owner) { room.ownerToken = member.token; member.owner = true; }
    room.members.set(member.token, member);
    return member;
  }

  app.post('/api/rooms', (req, reply) => {
    const room = newRoom(req.body?.name);
    const member = addMember(room, normalizeProfile(req.body?.profile), req.body?.shareOn !== false, true);
    broadcast(room);
    reply.send({ code: room.code, token: member.token, memberId: member.id });
  });

  app.post('/api/rooms/:code/join', (req, reply) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room || roomExpired(room)) return fail(reply, 404, 'Room not found or expired');
    const member = addMember(room, normalizeProfile(req.body?.profile), req.body?.shareOn !== false);
    broadcast(room);
    reply.send({ code: room.code, token: member.token, memberId: member.id });
  });

  app.get('/api/rooms/:code', (req, reply) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room || roomExpired(room)) return fail(reply, 404, 'Room not found or expired');
    const snap = roomSnapshot(room);
    delete snap.type;
    reply.send(snap);
  });

  function findRoom(req, reply) {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room || roomExpired(room)) { fail(reply, 404, 'Room not found or expired'); return null; }
    return room;
  }

  app.post('/api/rooms/:code/leave', (req, reply) => {
    const room = findRoom(req, reply); if (!room) return;
    const member = authMember(room, req.body?.token);
    if (!member) return fail(reply, 401, 'Not a member of this room');
    dropMember(room, member.token);
    reply.send({ ok: true });
  });

  app.post('/api/rooms/:code/kick', (req, reply) => {
    const room = findRoom(req, reply); if (!room) return;
    const me = authMember(room, req.body?.token);
    if (!me || me.token !== room.ownerToken) return fail(reply, 403, 'Only the room owner can remove members');
    const target = [...room.members.values()].find((m) => m.id === String(req.body?.memberId ?? ''));
    if (!target) return fail(reply, 404, 'Member not found');
    if (target.token === room.ownerToken) return fail(reply, 400, 'Owner cannot remove themselves');
    dropMember(room, target.token);
    reply.send({ ok: true });
  });

  function dropMember(room, token) {
    room.members.delete(token);
    const conns = sockets.get(room.code);
    const ws = conns?.get(token);
    if (ws) { conns.delete(token); try { ws.close(4000, 'left'); } catch {} }
    broadcast(room);
  }

  // ------------------------------------------------------- destination & status
  app.post('/api/rooms/:code/destination', (req, reply) => {
    const room = findRoom(req, reply); if (!room) return;
    const member = authMember(room, req.body?.token);
    if (!member) return fail(reply, 401, 'Not a member of this room');
    const { lat, lng } = req.body ?? {};
    if (!isFiniteLatLng(lat, lng)) return fail(reply, 400, 'Invalid coordinates');
    const clear = req.body?.clear === true;
    room.destination = clear ? null : {
      lat, lng,
      name: sanitizeText(req.body?.name, 64) || 'Meeting point',
      mode: req.body?.mode === 'drive' ? 'drive' : 'walk',
      setBy: member.id,
      ts: Date.now(),
    };
    room.messages.push({
      id: genToken().slice(0, 10), memberId: member.id, name: member.name,
      color: member.color, emoji: member.emoji, kind: 'event',
      text: clear ? 'cleared the meeting point' : `set the meeting point: ${room.destination.name}`,
      ts: Date.now(),
    });
    broadcast(room);
    reply.send({ ok: true, destination: room.destination });
  });

  app.post('/api/rooms/:code/status', (req, reply) => {
    const room = findRoom(req, reply); if (!room) return;
    const member = authMember(room, req.body?.token);
    if (!member) return fail(reply, 401, 'Not a member of this room');
    const kind = req.body?.kind;
    if (!STATUS_KINDS.includes(kind)) return fail(reply, 400, 'Unknown status');
    member.status = kind === 'clear' ? 'active' : kind;
    member.arrived = kind === 'arrived' ? true : member.arrived && kind === undefined;
    if (kind !== 'arrived') member.arrived = false;
    broadcast(room);
    reply.send({ ok: true, status: member.status, arrived: member.arrived });
  });

  app.post('/api/rooms/:code/chat', (req, reply) => {
    const room = findRoom(req, reply); if (!room) return;
    const member = authMember(room, req.body?.token);
    if (!member) return fail(reply, 401, 'Not a member of this room');
    const text = sanitizeText(req.body?.text, CHAT_MAX);
    if (!text) return fail(reply, 400, 'Empty message');
    room.messages.push({
      id: genToken().slice(0, 10), memberId: member.id, name: member.name,
      color: member.color, emoji: member.emoji, kind: 'chat', text, ts: Date.now(),
    });
    broadcast(room);
    reply.send({ ok: true });
  });

  // ------------------------------------------------------------------- sockets
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const q = req.query ?? {};
    const room = rooms.get(String(q.code ?? '').toUpperCase());
    const member = room && authMember(room, q.token);
    if (!room || !member) { try { socket.close(4001, 'unauthorized'); } catch {} return; }

    let conns = sockets.get(room.code);
    if (!conns) { conns = new Map(); sockets.set(room.code, conns); }
    conns.set(member.token, socket);
    member.connected = true;
    broadcast(room);

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      const fresh = authMember(room, member.token);
      if (!fresh) return;
      switch (msg.type) {
        case 'ping': socket.send(JSON.stringify({ type: 'pong', t: Date.now() })); break;
        case 'share': {
          const on = !!msg.on;
          if (member.shareOn === on) break;
          member.shareOn = on;
          if (!on) { member.lat = undefined; member.lng = undefined; member.accuracy = undefined; member.lastLocTs = undefined; }
          broadcast(room);
          break;
        }
        case 'loc': {
          if (!member.shareOn) return; // sharing must be explicitly ON
          if (!isFiniteLatLng(msg.lat, msg.lng)) return;
          const now = Date.now();
          if (now - member.lastLocPush < LOC_MIN_INTERVAL_MS) return; // adaptive cap
          member.lastLocPush = now;
          member.lat = msg.lat; member.lng = msg.lng;
          member.accuracy = typeof msg.accuracy === 'number' && msg.accuracy >= 0 ? msg.accuracy : undefined;
          member.lastLocTs = now;
          member.lastSeen = now;
          broadcast(room);
          break;
        }
        case 'chat': {
          const text = sanitizeText(msg.text, CHAT_MAX);
          if (!text) return;
          room.messages.push({
            id: genToken().slice(0, 10), memberId: member.id, name: member.name,
            color: member.color, emoji: member.emoji, kind: 'chat', text, ts: Date.now(),
          });
          broadcast(room);
          break;
        }
        case 'status': {
          const kind = msg.kind;
          if (!STATUS_KINDS.includes(kind)) return;
          member.status = kind === 'clear' ? 'active' : kind;
          member.arrived = kind === 'arrived';
          broadcast(room);
          break;
        }
        default: break;
      }
    });

    socket.on('close', () => {
      const conns2 = sockets.get(room.code);
      if (conns2?.get(member.token) === socket) conns2.delete(member.token);
      if (room.members.get(member.token)?.connected) {
        member.connected = false;
        member.connectedSince = undefined;
        member.lat = undefined; member.lng = undefined; member.accuracy = undefined; member.lastLocTs = undefined;
        broadcast(room);
      }
    });
  });

  // -------------------------------------------------------------- housekeeping
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (roomExpired(room, now) || roomIsIdle(room, now)) {
        for (const ws of (sockets.get(code)?.values() || [])) try { ws.close(4002, 'room closed'); } catch {}
        sockets.delete(code);
        rooms.delete(code);
        scheduleSave();
      }
    }
  }, 60_000);
  sweeper.unref?.();

  const close = () => { clearInterval(sweeper); try { app.close(); } catch {} };

  return { app, rooms, broadcast, close };
}

export async function start({ host = process.env.HOST ?? '127.0.0.1', port = Number(process.env.PORT) || 3100, persistPath = PERSIST_DEFAULT, silent = false } = {}) {
  const server = await createServer({ persistPath, silent });
  await server.app.listen({ host, port });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start({ host: '0.0.0.0', silent: false }).then((s) => {
    const addr = s.app.server.address();
    console.log(`[meetmap] gateway listening on http://${addr?.address}:${addr?.port}`);
  }).catch((err) => { console.error(err); process.exit(1); });
}
