/**
 * Nearest meetup spots (restaurants/cafés) via OpenStreetMap Overpass.
 * Pure query/parse functions are exported and unit-tested locally — the remote
 * endpoint is treated as a replaceable data source, not a dependency.
 */

export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const CATEGORIES = {
  restaurant: '🍽️ restaurant',
  fast_food: '🍔 fast food',
  cafe: '☕ café',
  bar: '🍹 bar',
  pub: '🍺 pub',
};

/** Builds the Overpass QL for POIs near a point. */
export function buildNearbyQuery({ lat, lng, radius = 1200 }) {
  const r = Math.max(80, Math.min(4000, Math.round(radius)));
  return [
    '[out:json][timeout:10];',
    '(',
    `node["amenity"~"^(restaurant|fast_food|cafe|bar|pub)$"](around:${r},${lat},${lng});`,
    `way["amenity"~"^(restaurant|fast_food|cafe|bar|pub)$"](around:${r},${lat},${lng});`,
    ');',
    'out center 60;',
  ].join('');
}

/** Parses an Overpass JSON response into a flat, app-ready list. */
export function parseOverpassResponse(json) {
  const out = [];
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  for (const el of elements) {
    const { lat, lng, name } = centerOf(el);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: `${el.type}/${el.id}`,
      name: name || 'Unnamed spot',
      lat,
      lng,
      kind: CATEGORIES[el.tags?.amenity] ?? '📍 spot',
      tags: { cuisine: el.tags?.cuisine, outdoor: el.tags?.['outdoor_seating'] === 'yes' },
    });
  }
  out.sort((a, b) => a._d - b._d);
  for (let i = 0; i < out.length; i += 1) out[i]._d = undefined;
  return out;
}

function centerOf(el) {
  const raw =
    el.type === 'node' ? { lat: el.lat, lng: el.lon } :
    el.center ? { lat: el.center.lat, lng: el.center.lon } :
    { lat: undefined, lng: undefined };
  return { ...raw, name: el.tags?.name ?? el.tags?.['en:name'] ?? el.tags?.brand ?? undefined };
}

/** Same mirror, ordered list; first one that answers wins. */
export async function fetchNearbyPlaces({ lat, lng, radius, fetchImpl = fetch }) {
  const data = buildNearbyQuery({ lat, lng, radius });
  const errors = [];
  for (const mirror of MIRRORS) {
    try {
      const res = await fetchImpl(mirror, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data }).toString(),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return { ok: true, source: new URL(mirror).host, places: parseOverpassResponse(json) };
    } catch (err) {
      errors.push(`${new URL(mirror).host}: ${err?.message ?? err}`);
    }
  }
  return { ok: false, error: errors.join(' | ') };
}
