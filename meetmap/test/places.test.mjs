import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNearbyQuery, parseOverpassResponse, fetchNearbyPlaces } from '../server/places.mjs';
import { createServer } from '../server/index.mjs';

/** Canned Overpass payload: one node, one way with a center, one junk element. */
const CANNED = {
  version: 0.6,
  generator: 'Overpass API',
  elements: [
    {
      type: 'node', id: 111, lat: 52.5170, lon: 13.3790,
      tags: { amenity: 'restaurant', name: 'Trattoria Nonna', cuisine: 'italian', 'outdoor_seating': 'yes' },
    },
    {
      type: 'way', id: 222, center: { lat: 52.5140, lon: 13.3765 },
      tags: { amenity: 'cafe', name: 'Filter Coffee' },
    },
    { type: 'way', id: 333 },
    {
      type: 'node', id: 444, lat: 52.5200, lon: 13.3800,
      tags: { amenity: 'pub', name: 'The Crypt', other: 'x' },
    },
  ],
};

test('buildNearbyQuery clamps radius and matches all food POI classes', () => {
  const q = buildNearbyQuery({ lat: 52.5163, lng: 13.3777, radius: 9999 });
  assert.ok(q.includes('(around:4000,52.5163,13.3777)'));
  assert.ok(q.includes('restaurant|fast_food|cafe|bar|pub'));
  assert.ok(q.startsWith('[out:json][timeout:10];(node'));
  assert.ok(buildNearbyQuery({ lat: 1, lng: 2, radius: 1 }).includes('around:80'));
  assert.ok(buildNearbyQuery({ lat: 1, lng: 2 }).includes('around:1200'));
});

test('parseOverpassResponse flattens nodes and ways, drops aimless elements', () => {
  const places = parseOverpassResponse(CANNED);
  assert.equal(places.length, 3);
  assert.deepEqual(places.map((p) => p.id), ['node/111', 'way/222', 'node/444']);
  assert.equal(places[0].name, 'Trattoria Nonna');
  assert.equal(places[0].kind, '🍽️ restaurant');
  assert.equal(places[0].tags.cuisine, 'italian');
  assert.equal(places[1].kind, '☕ café');
  assert.ok(places[1].lat === 52.514 && places[1].lng === 13.3765);
  assert.equal(places[2].tags.cuisine, undefined);
});

test('parseOverpassResponse tolerates junk payloads', () => {
  assert.deepEqual(parseOverpassResponse(undefined), []);
  assert.deepEqual(parseOverpassResponse({ elements: 'nope' }), []);
  assert.deepEqual(parseOverpassResponse({ elements: [{ type: 'node', id: 1 }] }), []);
});

test('fetchNearbyPlaces falls through mirrors in order and shapes errors', async () => {
  const attempts = [];
  const failingFetch = async (url) => {
    attempts.push(String(url).replace(/^https:\/\//, '').split('/')[0]);
    return { ok: false, status: 502, json: async () => ({}) };
  };
  const notFound = await fetchNearbyPlaces({ lat: 1, lng: 1, fetchImpl: failingFetch });
  assert.equal(notFound.ok, false);
  assert.equal(attempts.length, 3);
  assert.match(notFound.error, /502/);

  const goodFetch = async () => ({ ok: true, status: 200, json: async () => CANNED });
  const found = await fetchNearbyPlaces({ lat: 52, lng: 13, fetchImpl: goodFetch });
  assert.equal(found.ok, true);
  assert.equal(found.places.length, 3);
});

test('gateway /api/places/nearby validates input and proxies the POI search', async (t) => {
  // Client-side calls must hit the real local server even while the module
  // global fetch is stubbed for the outbound Overpass lookup.
  const clientFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = clientFetch; });
  globalThis.fetch = (async () => ({
    ok: true, status: 200, json: async () => CANNED,
  }));

  const server = await createServer({ persistPath: null, silent: true });
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${server.app.server.address().port}`;
  t.after(async () => { await server.app.close(); });

  const bad = await clientFetch(`${base}/api/places/nearby?lat=999&lng=181`);
  assert.equal(bad.status, 400);

  const res = await clientFetch(`${base}/api/places/nearby?lat=52.5163&lng=13.3777&radius=800`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.source, 'string');
  assert.equal(body.places.length, 3);
  assert.ok(body.places[0].name.length > 0);
});
