/**
 * MeetMap client — side-effect-free pieces (geo math + WS protocol helpers).
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

export function etaSeconds(meters, mode = 'walk') {
  const speed = mode === 'drive' ? 11 : 1.35;
  return meters / speed;
}

export function fmtEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.round(seconds / 60);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const STATUS_KINDS = ['arrived', 'late', 'waiting', 'clear'];

export const STATUS_CHIP = {
  arrived: '✅ here',
  late: '🐢 late',
  waiting: '⏳ waiting',
  active: '',
  off: '⏸ paused',
};

/**
 * Adaptive share cadence: fast while moving, slow when stationary.
 * Returns true when an update should be pushed.
 */
export function shouldPushLocation(prev, next, now) {
  if (!prev) return true;
  const moved = haversineMeters(prev, next);
  const age = now - (prev.ts ?? 0);
  if (moved > 12) return age > 1500;    // moving: at most ~1/s after 12 m
  return age > 5000;                     // stationary: heartbeat every 5 s
}
