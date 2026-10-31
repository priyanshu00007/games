/**
 * Pure, dependency-free domain helpers for MeetMap.
 * Exported and side-effect-free so the server logic is testable with plain
 * `node --test` (no network, no sockets).
 */
import { randomUUID, randomBytes } from 'node:crypto';

/** A member's location older than this is flagged `stale` in snapshots. */
export const LOC_STALE_MS = 60_000;
/** Adaptive sharing: server cap on how often one member may push locations. */
export const LOC_MIN_INTERVAL_MS = 1_200;
/** A room with no connected members for this long is collected. */
export const ROOM_IDLE_MS = 30 * 60_000;
/** Hard ceiling on a room's lifetime (temporary sessions only). */
export const ROOM_MAX_LIFETIME_MS = 24 * 60 * 60_000;
/** Max chat text length. */
export const CHAT_MAX = 240;
/** Member status values clients may set. */
export const STATUS_KINDS = ['arrived', 'late', 'waiting', 'clear'];

export const COLOR_PALETTE = [
  '#4fc3f7', '#ffd166', '#06d6a0', '#ef476f',
  '#a78bfa', '#f4a261', '#90be6d', '#f9844a',
];

/** Visibly-ambiguous characters excluded so codes are readable aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function genCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function genToken() {
  return randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
}

/**
 * Great-circle distance in meters between {lat,lng} points.
 */
export function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * ETA in seconds from a distance. Walking ~1.35 m/s, driving ~11 m/s.
 * Deliberately conservative — the client upgrades this with real route data.
 */
export function etaSeconds(meters, mode = 'walk') {
  const speed = mode === 'drive' ? 11 : 1.35;
  return meters / speed;
}

const EMOJI_SAFE = /^[\p{Extended_Pictographic}]{1,2}$/u;

export function normalizeProfile(input = {}) {
  const name = sanitizeText(input.name, 32) || 'Explorer';
  const color =
    typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color)
      ? input.color.toLowerCase()
      : COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  const rawEmoji = Array.from(String(input.emoji ?? '🙂'));
  const emoji = EMOJI_SAFE.test(rawEmoji[0] ?? '') ? rawEmoji[0] : '🙂';
  return { name, color, emoji };
}

export function sanitizeText(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isFiniteLatLng(lat, lng) {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -85 && lat <= 85 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/**
 * The single source of truth for what other members may see about someone.
 * Tokens never leave the server; coordinates disappear entirely the moment a
 * member pauses sharing — no "last known" leak.
 */
export function membersSnapshot(room, now = Date.now()) {
  const out = [];
  for (const m of room.members.values()) {
    const hasLoc =
      m.shareOn &&
      m.connected &&
      typeof m.lat === 'number' &&
      typeof m.lng === 'number' &&
      m.lastLocTs !== undefined &&
      now - m.lastLocTs < 5 * LOC_STALE_MS;
    out.push({
      id: m.id,
      name: m.name,
      color: m.color,
      emoji: m.emoji,
      shareOn: m.shareOn,
      connected: m.connected,
      isOwner: m.token === room.ownerToken,
      arrived: m.arrived === true,
      status: m.status ?? 'active',
      hasLoc,
      lat: hasLoc ? m.lat : undefined,
      lng: hasLoc ? m.lng : undefined,
      accuracy: hasLoc ? m.accuracy : undefined,
      lastLocTs: hasLoc ? m.lastLocTs : undefined,
      stale: hasLoc ? now - m.lastLocTs > LOC_STALE_MS : undefined,
    });
  }
  return out;
}

/**
 * Full-room snapshot that gets broadcast and REST-served.
 * Shape-level parity with the planned RN client payload.
 */
export function roomSnapshot(room, now = Date.now()) {
  return {
    type: 'state',
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    destination: room.destination,
    members: membersSnapshot(room, now),
    messages: room.messages.slice(-60),
    serverTime: now,
  };
}

export function roomIsIdle(room, now = Date.now()) {
  if (room.members.size === 0) return now - room.createdAt > ROOM_IDLE_MS;
  for (const m of room.members.values()) if (now - m.lastSeen < ROOM_IDLE_MS) return false;
  return true;
}

export function roomExpired(room, now = Date.now()) {
  return now - room.createdAt > ROOM_MAX_LIFETIME_MS;
}
