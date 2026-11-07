// Livello dati dell'app: carica l'indice completo delle stampe e lo storico reale,
// tiene tutto in cache nel browser e aggiorna i prezzi in diretta da Scryfall.
import { FLAG } from '../model.js';

const DAY = 86400000;
const BASE = new URL('../data/', import.meta.url).href;
const DB_NAME = 'mtg-invest';
const DB_VER = 1;

// ------------------------------------------------------------------ cache su IndexedDB
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const t = db.transaction('blobs').objectStore('blobs').get(key);
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    });
  } catch { return undefined; }
}
async function cacheSet(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction('blobs', 'readwrite').objectStore('blobs').put(value, key);
      t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
  } catch { /* quota piena o modalità privata: si continua senza cache */ }
}
export async function clearCache() {
  try {
    const db = await idb();
    await new Promise(res => { const t = db.transaction('blobs', 'readwrite').objectStore('blobs').clear(); t.onsuccess = res; t.onerror = res; });
  } catch {}
}

// ------------------------------------------------------------------ download + gunzip
async function fetchGz(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (typeof DecompressionStream === 'function') {
    const ds = res.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(ds).text());
  }
  throw new Error('Questo browser non supporta DecompressionStream');
}

// ------------------------------------------------------------------ stato
export const state = {
  meta: null, backtest: null,
  cards: [],                 // tutte le stampe, oggetti carta
  byId: new Map(),
  byOracle: new Map(),       // oracle_id -> [carte] (le varianti della stessa carta)
  loaded: 0, total: 0, ready: false,
};

function rowToCard(row, meta) {
  const [id, name, set, cn, rarity, released, edhrec, flags, eur, usd, eur_foil, usd_foil, oracle, legal, stats] = row;
  return {
    id, name, set, setName: meta.index.sets[set] || set, cn,
    rarity: meta.index.rarities[rarity] || 'rare',
    releasedDays: released,
    released: new Date(Date.parse(meta.index.epoch) + released * DAY).toISOString().slice(0, 10),
    edhrec: edhrec || 0, flags, legal: (legal || 0) & 0xff, banned: ((legal || 0) >> 8) & 0xff, oracle,
    prices: { eur, usd, eur_foil, usd_foil },
    stats: stats || null,
    search: name.toLowerCase(),
  };
}

function addPart(rows, meta) {
  for (const row of rows) {
    const c = rowToCard(row, meta);
    if (state.byId.has(c.id)) continue;
    state.byId.set(c.id, c);
    state.cards.push(c);
    const arr = state.byOracle.get(c.oracle);
    if (arr) arr.push(c); else state.byOracle.set(c.oracle, [c]);
  }
  state.loaded = state.cards.length;
}

// Modalità snapshot: un unico file con tutto dentro, per l'anteprima che non può
// raggiungere la rete. I dati sono gli stessi, solo ridotti alle carte più scambiate.
let snapshotHistory = null;
export const isSnapshot = () => !!globalThis.MTGI_SNAPSHOT;

async function loadSnapshot(onProgress) {
  const snap = await (await fetch(globalThis.MTGI_SNAPSHOT)).json();
  state.meta = snap;
  state.backtest = snap.backtest || null;
  state.total = snap.cards.length;
  snapshotHistory = snap.history || {};
  addPart(snap.cards, snap);
  state.ready = true;
  onProgress?.(state.loaded, state.total, true);
  onProgress?.(state.loaded, state.total, false, true);
  return state;
}

// Carica meta + prima parte (l'app è già usabile), poi il resto in sottofondo.
export async function load({ onProgress } = {}) {
  if (isSnapshot()) return loadSnapshot(onProgress);
  state.meta = await (await fetch(BASE + 'meta.json', { cache: 'no-cache' })).json();
  state.backtest = await fetch(BASE + 'backtest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const meta = state.meta;
  state.total = meta.counts.printings;
  const stamp = meta.built;

  const parts = meta.index.parts;
  const loadPart = async (p, i) => {
    const key = `${stamp}:${p.name}`;
    let data = await cacheGet(key);
    if (!data) { data = await fetchGz(BASE + p.name); cacheSet(key, data); }
    addPart(data.cards, meta);
    onProgress?.(state.loaded, state.total, i === 0);
  };

  await loadPart(parts[0], 0);
  state.ready = true;
  (async () => {
    for (let i = 1; i < parts.length; i++) {
      try { await loadPart(parts[i], i); } catch (e) { console.warn('parte non caricata', parts[i].name, e); }
    }
    onProgress?.(state.loaded, state.total, false, true);
  })();
  return state;
}

// ------------------------------------------------------------------ storico (shard su richiesta)
const shardPromises = new Map();
export async function history(id) {
  if (snapshotHistory) return snapshotHistory[id] || null;
  const sh = id.slice(0, 2);
  if (!shardPromises.has(sh)) {
    const key = `${state.meta.built}:hist/${sh}`;
    shardPromises.set(sh, (async () => {
      let data = await cacheGet(key);
      if (!data) {
        data = await fetchGz(`${BASE}hist/${sh}.json.gz`).catch(() => ({ cards: {} }));
        cacheSet(key, data);
      }
      return data;
    })());
  }
  const shard = await shardPromises.get(sh);
  return shard.cards?.[id] || null;
}

const SERIES_KEY = { eur: 'e', usd: 'u', eur_foil: 'ef', usd_foil: 'uf' };

// Serie [[timestampMs, prezzo]] pronta per model.js, con i prezzi in diretta in coda.
export async function series(card, currency = 'eur', foil = false) {
  const entry = await history(card.id);
  const axis = state.meta.axis;
  const key = SERIES_KEY[foil ? `${currency}_foil` : currency];
  const out = [];
  if (entry?.[key]) {
    const [off, vals] = entry[key];
    const start = Date.parse(axis.start);
    for (let i = 0; i < vals.length; i++) if (vals[i] != null) out.push([start + (off + i) * DAY, vals[i]]);
  }
  const live = live_.get(card.id);
  const now = live?.at ?? Date.parse(state.meta.today);
  const p = (live?.prices || card.prices)[foil ? `${currency}_foil` : currency];
  if (p != null) {
    if (out.length && now - out[out.length - 1][0] < DAY / 2) out[out.length - 1] = [now, p];
    else out.push([now, p]);
  }
  return out;
}

export const hasHistory = card => !!(card.flags & FLAG.history);

// ------------------------------------------------------------------ prezzi in diretta (Scryfall)
const live_ = new Map();            // id -> { prices, at }
let lastCall = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function livePrices(card) {
  return live_.get(card.id)?.prices || card.prices;
}
export const liveAt = id => live_.get(id)?.at || null;

// Scryfall consiglia max ~10 richieste al secondo: qui ne facciamo al massimo 4.
export async function refresh(ids, { onCard } = {}) {
  if (isSnapshot()) return [];   // l'anteprima non può interrogare Scryfall
  const todo = [...new Set(ids)].filter(Boolean);
  const changed = [];
  for (let i = 0; i < todo.length; i += 75) {
    const wait = lastCall + 250 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: todo.slice(i, i + 75).map(id => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    const data = await res.json();
    for (const c of data.data || []) {
      const n = v => (v == null || v === '' ? null : Number(v));
      const prices = { eur: n(c.prices?.eur), usd: n(c.prices?.usd), eur_foil: n(c.prices?.eur_foil), usd_foil: n(c.prices?.usd_foil) };
      const before = livePrices({ id: c.id, prices: state.byId.get(c.id)?.prices || {} });
      live_.set(c.id, { prices, at: Date.now() });
      const card = state.byId.get(c.id);
      if (card) { card.prices = prices; card.name ||= c.name; }
      if (before && (before.eur !== prices.eur || before.usd !== prices.usd)) changed.push({ id: c.id, before, after: prices });
      onCard?.(c.id, prices);
    }
  }
  return changed;
}

// Carta non presente nell'indice (es. uscita dopo l'ultima build): la si prende al volo.
export async function fetchCard(id) {
  if (isSnapshot()) return null;
  const res = await fetch(`https://api.scryfall.com/cards/${id}`);
  if (!res.ok) return null;
  const c = await res.json();
  const n = v => (v == null || v === '' ? null : Number(v));
  const card = {
    id: c.id, name: c.name, set: c.set, setName: c.set_name, cn: c.collector_number, rarity: c.rarity,
    released: c.released_at, edhrec: c.edhrec_rank || 0, flags: (c.reserved ? FLAG.reserved : 0) | (c.reprint ? FLAG.reprint : 0),
    legal: 0, banned: 0, oracle: c.oracle_id, search: c.name.toLowerCase(),
    prices: { eur: n(c.prices?.eur), usd: n(c.prices?.usd), eur_foil: n(c.prices?.eur_foil), usd_foil: n(c.prices?.usd_foil) },
  };
  state.byId.set(card.id, card);
  return card;
}

// ------------------------------------------------------------------ immagini
// Gli URL delle immagini di Scryfall sono ricavabili dall'id: non serve salvarli nell'indice.
export const imageUrl = (id, size = 'small') =>
  `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
