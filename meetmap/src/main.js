/**
 * MeetMap client entry: binds store + map + DOM.
 */
import './styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { MeetMapClient, loadIdentity, saveIdentity } from './store.js';
import { haversineMeters, fmtEta, fmtDistance, STATUS_CHIP, shouldPushLocation } from './geo.js';

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const el = {
  home: $('home-screen'), room: $('room-screen'),
  name: $('inp-name'), code: $('inp-code'),
  create: $('btn-create'), join: $('btn-join'),
  colors: $('color-row'), emojis: $('emoji-row'),
  roomName: $('room-name'), connDot: $('conn-dot'), connText: $('conn-text'),
  memberCount: $('member-count'), invite: $('btn-invite'), leave: $('btn-leave'),
  dest: $('btn-dest'), destCard: $('dest-card'), destName: $('dest-name'), destEta: $('dest-eta'), destClear: $('btn-dest-clear'),
  sheet: $('sheet'), sheetGrip: $('sheet-grip'), memberList: $('member-list'),
  chatLog: $('chat-log'), chatInput: $('inp-chat'), chatSend: $('btn-chat-send'),
  shareBanner: $('share-banner'), shareText: $('share-text'), shareToggle: $('btn-share-toggle'),
  recenter: $('btn-recenter'), toast: $('toast'),
};

let identity = loadIdentity() ?? { name: '', emoji: '🙂', color: null };
let shareOn = true;
let myFix = null;              // last accepted geolocation fix {lat,lng,accuracy,ts}
let watchId = null;
let map = null;                // maplibregl.Map
const memberMarkers = new Map(); // memberId -> {marker, el}
let lastContest = new Date(0);

const client = new MeetMapClient({
  onState: render,
  onConnection: ({ kind, text }) => {
    el.connDot.dataset.kind = kind;
    el.connText.textContent = text;
  },
  onToast: () => {},
});
window.__meetmap = client; // for debugging/demo scripting

// ------------------------------------------------------- identity pickers
const COLOR_PALETTE = ['#4fc3f7', '#ffd166', '#06d6a0', '#ef476f', '#a78bfa', '#f4a261', '#90be6d', '#f9844a'];
const EMOJI_SET = ['🙂', '🐱', '🦊', '🐧', '🐢', '🦉', '🐝', '🌵', '⛵', '🎧'];

function buildPickers() {
  el.colors.innerHTML = '';
  COLOR_PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch' + ((identity.color ?? COLOR_PALETTE[i % 8]) === c ? ' active' : '');
    b.style.background = c;
    b.dataset.color = c;
    b.addEventListener('click', () => { identity.color = c; saveIdentity(identity); buildPickers(); });
    el.colors.appendChild(b);
  });
  el.emojis.innerHTML = '';
  EMOJI_SET.forEach((e) => {
    const b = document.createElement('button');
    b.className = 'swatch' + ((identity.emoji ?? '🙂') === e ? ' active' : '');
    b.textContent = e;
    b.dataset.emoji = e;
    b.addEventListener('click', () => { identity.emoji = e; saveIdentity(identity); buildPickers(); });
    el.emojis.appendChild(b);
  });
  el.name.value = identity.name ?? '';
}
buildPickers();

// ------------------------------------------------------------------ enter
async function enterRoom(mode) {
  const name = (el.name.value || 'Explorer').trim();
  identity = { name, emoji: identity.emoji ?? '🙂', color: identity.color ?? COLOR_PALETTE[Math.floor(Math.random() * 8)] };
  saveIdentity(identity);

  const payload = { profile: identity, shareOn };
  try {
    if (mode === 'create') {
      await client.createRoom(payload);
    } else {
      const code = (el.code.value || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter the 6-character room code');
      await client.joinRoom(code, payload);
    }
    el.home.classList.add('hidden');
    el.room.classList.remove('hidden');
    initMap();
    startSharing();
  } catch (err) {
    toast(err.message || 'Something went wrong');
  }
}
el.create.addEventListener('click', () => enterRoom('create'));
el.join.addEventListener('click', () => enterRoom('join'));
el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterRoom('join'); });

// -------------------------------------------------------------------- map
function initMap() {
  if (map) return;
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [13.405, 52.52],
    zoom: 12,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
  map.on('click', (e) => {
    if (el.room.classList.contains('hidden')) return;
    if (!pendingDest) return;
    pendingDest = false;
    setDestination(e.lngLat.wrap());
  });
}

let pendingDest = false;

async function setDestination({ lat, lng }) {
  const res = await client.setDestination({ lat, lng, name: 'Meeting point', mode: 'walk' });
  if (!res.ok) toast('Could not set meeting point');
}

el.dest.addEventListener('click', () => {
  pendingDest = !pendingDest;
  toast(pendingDest ? 'Tap the map to drop the meeting point' : 'Cancelled');
});
el.destClear.addEventListener('click', () => client.clearDestination());
el.recenter.addEventListener('click', () => {
  if (myFix && map) map.easeTo({ center: [myFix.lng, myFix.lat], zoom: 14 });
});

// -------------------------------------------------------------- geolocation
function startSharing() {
  if (!('geolocation' in navigator)) {
    toast('This browser has no geolocation — enable a simulated fix instead');
    return;
  }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition((pos) => {
    const { latitude, longitude, accuracy, timestamp } = pos.coords;
    const fix = { lat: latitude, lng: longitude, accuracy, ts: timestamp || Date.now() };
    if (shouldPushLocation(myFix, fix, Date.now())) {
      client.pushLocation(fix);
      myFix = fix;
      render();
      if (map) map.easeTo?.({ center: [fix.lng, fix.lat], duration: 800 });
    }
  }, (err) => toast(`GPS error: ${err.message}`), { enableHighAccuracy: true, maximumAge: 2000, timeout: 12_000 });
}

function stopSharing() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

el.shareToggle.addEventListener('click', () => {
  shareOn = !shareOn;
  client.setSharing(shareOn);
  if (shareOn) startSharing(); else stopSharing();
  renderShareBanner();
});
function renderShareBanner() {
  el.shareBanner.dataset.on = shareOn ? 'on' : 'off';
  el.shareText.textContent = shareOn ? 'Sharing live location' : 'Sharing paused — nobody can see you';
  el.shareToggle.textContent = shareOn ? 'Pause' : 'Resume';
}

// ------------------------------------------------------------------ render
function memberRow(m, isMe) {
  const row = document.createElement('div');
  row.className = 'member-row';
  const dist = m.hasLoc && myFix ? fmtDistance(haversineMeters(myFix, m)) : 'no fix';
  const chip = isMe ? 'you' : (STATUS_CHIP[m.status ?? (m.shareOn ? 'active' : 'off')] ?? '');
  row.innerHTML = `
    <span class="avatar" style="--c:${m.color}">${m.emoji}</span>
    <span class="member-info">
      <span class="member-name">${m.name}${m.isOwner ? ' 👑' : ''}${isMe ? ' (you)' : ''}</span>
      <span class="member-sub">${m.connected ? (chip || (m.shareOn ? 'live' : 'paused')) : 'offline'} ${m.hasLoc ? `· ${dist}` : ''}${m.stale ? ' · stale' : ''}</span>
    </span>`;
  if (!isMe && m.isOwner === false) {
    const kick = document.createElement('button');
    kick.className = 'link-btn';
    kick.textContent = 'remove';
    kick.addEventListener('click', async () => {
      const r = await client.kickMember(m.id);
      if (r && !r.ok) toast(r.status === 403 ? 'Only the room owner can remove members' : 'Could not remove member');
    });
    row.appendChild(kick);
  }
  return row;
}

function render(state) {
  if (!client.session) return;
  const s = state ?? client.state;
  el.roomName.textContent = s.roomName || `Room ${client.session.code}`;
  const members = s.members ?? [];
  const online = members.filter((m) => m.connected).length;
  el.memberCount.textContent = `${online}/${members.length} members`;
  el.memberList.innerHTML = '';
  for (const m of members) el.memberList.appendChild(memberRow(m, m.id === client.session.memberId));

  el.destCard.classList.toggle('hidden', !s.destination);
  if (s.destination) {
    el.destName.textContent = s.destination.name;
    if (myFix) {
      const d = haversineMeters({ lat: myFix.lat, lng: myFix.lng }, s.destination);
      el.destEta.textContent = `${fmtDistance(d)} · ~${fmtEta(d / (s.destination.mode === 'drive' ? 11 : 1.35))} as the crow flies`;
    } else el.destEta.textContent = 'waiting for your location…';
  }
  renderChat(s.messages ?? []);
  renderMarkers(s.destination);
  renderShareBanner();
}

function renderChat(messages) {
  el.chatLog.innerHTML = '';
  for (const msg of messages.slice(-40)) {
    const row = document.createElement('div');
    row.className = `chat-row ${msg.kind === 'event' ? 'chat-event' : ''}`;
    row.innerHTML = `<span class="avatar avatar-s" style="--c:${msg.color}">${msg.emoji}</span>
      <span><strong style="color:${msg.color}">${msg.name}</strong> ${msg.text}</span>`;
    el.chatLog.appendChild(row);
  }
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function renderMarkers(destination) {
  if (!map) return;
  const members = client.state.members ?? [];
  const seen = new Set();

  for (const m of members) {
    if (m.id === client.session.memberId || !m.hasLoc || !m.connected) continue;
    seen.add(m.id);
    let entry = memberMarkers.get(m.id);
    if (!entry) {
      const node = document.createElement('div');
      node.className = 'map-pin';
      node.style.setProperty('--c', m.color);
      node.innerHTML = `<span>${m.emoji}</span>`;
      const marker = new maplibregl.Marker({ element: node }).setLngLat([m.lng, m.lat]).addTo(map);
      entry = { marker, node, coords: [m.lat, m.lng] };
      memberMarkers.set(m.id, entry);
    } else {
      entry.marker.setLngLat([m.lng, m.lat]);
      entry.coords = [m.lat, m.lng];
    }
  }
  // Cleanup stale markers of members who paused/left.
  for (const [id, entry] of [...memberMarkers]) {
    if (!seen.has(id)) { entry.marker.remove(); memberMarkers.delete(id); }
  }

  // Destination pin
  if (destination && !map.__destMarker) {
    const node = document.createElement('div');
    node.className = 'map-dest';
    node.textContent = '📍';
    map.__destMarker = new maplibregl.Marker({ element: node }).setLngLat([destination.lng, destination.lat]).addTo(map);
  } else if (!destination && map.__destMarker) {
    map.__destMarker.remove(); map.__destMarker = null;
  } else if (destination && map.__destMarker) {
    map.__destMarker.setLngLat([destination.lng, destination.lat]);
  }
}

// ------------------------------------------------------------------- misc
el.sheetGrip.addEventListener('click', () => el.sheet.classList.toggle('collapsed'));
el.chatSend.addEventListener('click', sendChatMsg);
el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMsg(); });
function sendChatMsg() {
  const text = el.chatInput.value.trim();
  if (!text) return;
  client.sendChat(text);
  el.chatInput.value = '';
}
document.querySelectorAll('.status-btn').forEach((b) => {
  b.addEventListener('click', async () => {
    const kind = b.dataset.status;
    client.setState(kind);
    if (kind !== 'arrived') el.memberList.querySelectorAll('.member-row').forEach((r) => r.classList.remove('is-me-arrived'));
  });
});

el.leave.addEventListener('click', async () => {
  await client.leave();
  stopSharing();
  for (const [, entry] of [...memberMarkers]) entry.marker.remove();
  memberMarkers.clear();
  el.room.classList.add('hidden');
  el.home.classList.remove('hidden');
});

el.invite.addEventListener('click', async () => {
  const code = client.session?.code;
  if (!code) return;
  const url = `${location.origin}/?join=${code}`;
  try {
    await navigator.clipboard.writeText(`Join my MeetMap room: code ${code} — ${url}`);
    toast('Invite copied to clipboard');
  } catch {
    toast(`Room code: ${code}`);
  }
});

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

// ------------------------------------------------------------------ boot
const params = new URLSearchParams(location.search);
if (params.get('join')) el.code.value = params.get('join').toUpperCase();
const session = (function () { try { return JSON.parse(sessionStorage.getItem('meetmap.session.v1')); } catch { return null; } })();
if (session?.code && session?.token) {
  // Session restored in a hot reload: re-attach the socket, but ask the user
  // to re-enter from home since identity consent is explicit.
  console.info('[meetmap] previous session detected on this tab; restart sharing from home');
}
