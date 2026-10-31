import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.mjs';
import { genCode, haversineMeters, etaSeconds, normalizeProfile } from '../server/core.mjs';

const persistDir = mkdtempSync(path.join(tmpdir(), 'meetmap-test-'));
const server = await createServer({ persistPath: persistDir, silent: true });
await server.app.listen({ host: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${server.app.server.address().port}`;
const wsBase = base.replace('http://', 'ws://');

test.after(() => {
  server.close();
  try { rmSync(persistDir, { recursive: true, force: true }); } catch {}
});

/** Open a socket as a room member and await the first state snapshot. */
async function openSocket(code, token) {
  const ws = new WebSocket(`${wsBase}/api/ws?code=${code}&token=${token}`);
  const firstState = new Promise((resolve) => ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.type === 'state') resolve(msg);
  }, { once: true }));
  await once(ws, 'open');
  const state = await firstState;
  return { ws, state };
}

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const getJson = async (path) => (await fetch(base + path)).json();

test('genCode avoids lookalike characters', () => {
  for (let i = 0; i < 200; i++) {
    const code = genCode();
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.ok(!/[ILO0O1]/.test(code));
  }
});

test('normalizeProfile clamps name, validates color, guards emoji', () => {
  const p = normalizeProfile({ name: ' ' .repeat(60) + ' Raiden', color: '#FF8800', emoji: '🎯🎯🎯' });
  assert.equal(p.name, 'Raiden');
  assert.equal(p.color, '#ff8800');
  assert.equal(p.emoji, '🎯');
  assert.equal(normalizeProfile({ name: '' }).name, 'Explorer');
  assert.equal(normalizeProfile({ emoji: '<script>' }).emoji, '🙂');
});

test('haversine + eta are sane', () => {
  // ~111.2km per degree of latitude
  const d = haversineMeters({ lat: 10, lng: 0 }, { lat: 11, lng: 0 });
  assert.ok(Math.abs(d - 111_195) < 500, `got ${d}`);
  assert.ok(Math.abs(etaSeconds(1350, 'walk') - 1000) < 1e-6);
  assert.ok(Math.abs(etaSeconds(11000, 'drive') - 1000) < 1e-6);
});

test('create room -> join -> snapshot has two authorized members, tokens never leak', async () => {
  const created = await (await post('/api/rooms', {
    name: 'Friday Meetup',
    profile: { name: 'Asha', color: '#4fc3f7', emoji: '🐱' },
    shareOn: true,
  })).json();
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  assert.ok(created.token?.length >= 32);

  const joined = await (await post(`/api/rooms/${created.code}/join`, {
    profile: { name: 'Bo', color: '#ef476f', emoji: '🦊' },
    shareOn: true,
  })).json();

  const { ws, state } = await openSocket(created.code, created.token);
  const publicState = await getJson(`/api/rooms/${created.code}`);
  const allMembers = [...state.members, ...publicState.members];
  for (const m of allMembers) {
    assert.ok(!('token' in m), 'token leaked in snapshot');
    assert.ok(m.id && m.name);
  }
  const ids = new Set(publicState.members.map((m) => m.id));
  assert.equal(publicState.members.length, 2);
  assert.ok(ids.size === 2);

  const ws2 = await openSocket(created.code, joined.token);
  // Two independent connections in the same room see both members.
  assert.ok(ws2.state.members.length >= 2);
  ws.close(); ws2.ws.close();
});

test('location pushes are token-scoped; pausing strips coordinates server-side', async (t) => {
  const a = await (await post('/api/rooms', { profile: { name: 'Asha' }, shareOn: true })).json();

  // Wrong token cannot attach to the room's socket.
  const badWs = new WebSocket(`${wsBase}/api/ws?code=${a.code}&token=CORRUPTED_TOKEN`);
  await new Promise((resolve) => {
    badWs.addEventListener('close', resolve);
    badWs.addEventListener('error', resolve);
  });
  assert.ok(true);

  const good = await openSocket(a.code, a.token);
  // A member not in this room cannot mutate it.
  const outsider = await (await post('/api/rooms', { profile: { name: 'Outsider' }, shareOn: true })).json();

  const sees = new Promise((resolve) => good.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.type === 'state') resolve(msg);
  }, { once: true }));

  // Outsider's token cannot act inside Asha's room.
  const pushed = await post(`/api/rooms/${a.code}/leave`, { token: outsider.token });
  assert.equal(pushed.status, 401);

  // Asha pushes a location — the external watcher receives it.
  await post(`/api/rooms/${a.code}/destination`, { token: a.token, lat: 52.52, lng: 13.405, name: 'Kino', mode: 'walk' });
  const stateWithDestination = await sees;
  assert.ok(stateWithDestination.destination?.name === 'Kino');

  const pushWatcher = new Promise((resolve) => good.ws.addEventListener('message', (ev2) => {
    const m2 = JSON.parse(typeof ev2.data === 'string' ? ev2.data : ev2.data.toString());
    const me = m2.members?.find((mm) => mm.id === m2.members?.[0]?.id && mm.hasLoc);
    if (m2.type === 'state' && m2.members.some((x) => x.name === 'Asha' && x.hasLoc)) resolve(m2);
  }, { once: true }));
  // Send a location over the socket (it's a WS-only event by design).
  good.ws.send(JSON.stringify({ type: 'loc', lat: 52.5109, lng: 13.4045, accuracy: 12 }));
  const locState = await pushWatcher;
  const asha = locState.members.find((m) => m.name === 'Asha');
  assert.ok(asha && asha.hasLoc && Math.abs(asha.lat - 52.5109) < 1e-6);
  assert.ok(!('token' in asha));

  // Pause sharing -> coordinates vanish from the next broadcast.
  good.ws.send(JSON.stringify({ type: 'share', on: false }));
  await new Promise((resolve) => setTimeout(resolve, 30)).then(() => good.ws.send(JSON.stringify({
    type: 'loc', lat: 52.999, lng: 13.999, accuracy: 5,
  })));
  const after = await getJson(`/api/rooms/${a.code}`);
  const ashaAfter = after.members.find((m) => m.name === 'Asha');
  assert.equal(ashaAfter.hasLoc, false);
  assert.equal(ashaAfter.lat, undefined);
  good.ws.close();
});

test('owner can kick, member cannot; leaver disappears from snapshot', async () => {
  const owner = await (await post('/api/rooms', { profile: { name: 'Owner' } })).json();
  const m1 = await (await post(`/api/rooms/${owner.code}/join`, { profile: { name: 'Bo' } })).json();
  const m2 = await (await post(`/api/rooms/${owner.code}/join`, { profile: { name: 'Cy' } })).json();

  // Non-owner cannot kick.
  const noPerm = await post(`/api/rooms/${owner.code}/kick`, { token: m1.token, memberId: m2.memberId });
  assert.equal(noPerm.status, 403);

  // Owner kicks m2.
  const okKick = await post(`/api/rooms/${owner.code}/kick`, { token: owner.token, memberId: m2.memberId });
  assert.equal(okKick.status, 200);
  const after1 = await getJson(`/api/rooms/${owner.code}`);
  assert.ok(!after1.members.some((m) => m.id === m2.memberId));

  // m1 leaves on their own.
  await post(`/api/rooms/${owner.code}/leave`, { token: m1.token });
  const after2 = await getJson(`/api/rooms/${owner.code}`);
  assert.ok(!after2.members.some((m) => m.id === m1.memberId));
  assert.ok(after2.members.some((m) => m.name === 'Owner'));
});

test('chat and arrival status broadcast to the room', async () => {
  const room = await (await post('/api/rooms', { profile: { name: 'A' }, shareOn: true })).json();
  const sock = await openSocket(room.code, room.token);
  const next = new Promise((resolve) => sock.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.type === 'state' && m.messages.length) resolve(m);
  }, { once: true }));
  const chat = await post(`/api/rooms/${room.code}/chat`, { token: room.token, text: 'omw 5 min' });
  assert.equal(chat.status, 200);
  const state = await next;
  const last = state.messages.at(-1);
  assert.equal(last.text, 'omw 5 min');
  assert.equal(last.name, 'A');

  const statusNext = new Promise((resolve) => sock.ws.addEventListener('message', (ev2) => {
    const m2 = JSON.parse(typeof ev2.data === 'string' ? ev2.data : ev2.data.toString());
    if (m2.type === 'state' && m2.members.some((x) => x.arrived)) resolve(m2);
  }, { once: true }));
  await post(`/api/rooms/${room.code}/status`, { token: room.token, kind: 'arrived' });
  const arrivedState = await statusNext;
  assert.ok(arrivedState.members.some((m) => m.name === 'A' && m.arrived));
  sock.ws.close();
});

test('unknown room and bad payloads are rejected', async () => {
  assert.equal((await post('/api/rooms/ZZZZZZ/destination', { token: 'x', lat: 1, lng: 1 })).status, 404);
  const room = await (await post('/api/rooms', { profile: { name: 'A' } })).json();
  assert.equal((await post(`/api/rooms/${room.code}/destination`, { token: room.token, lat: 200, lng: 999 })).status, 400);
  assert.equal((await post(`/api/rooms/${room.code}/chat`, { token: room.token, text: '   ' })).status, 400);
});
