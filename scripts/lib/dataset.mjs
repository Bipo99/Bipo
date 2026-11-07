// Lettura lato Node dei dati prodotti da build-data.mjs (gli stessi file che usa il browser).
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { FLAG } from '../../model.js';

const DAY = 86400000;

export async function loadMeta(dir = 'data') {
  return JSON.parse(await readFile(new URL(`../../${dir}/meta.json`, import.meta.url), 'utf8'));
}

const readGz = async (dir, name) =>
  JSON.parse(gunzipSync(await readFile(new URL(`../../${dir}/${name}`, import.meta.url))));

// Trasforma una riga compatta dell'indice nell'oggetto carta usato da model.js e dall'app.
export function toCard(row, meta) {
  const [id, name, set, cn, rarity, released, edhrec, flags, eur, usd, eur_foil, usd_foil, oracle, legal, stats] = row;
  return {
    id, name, set, setName: meta.index.sets[set] || set, cn,
    rarity: meta.index.rarities[rarity] || 'rare',
    released: new Date(Date.parse(meta.index.epoch) + released * DAY).toISOString().slice(0, 10),
    edhrec, flags, legal: (legal || 0) & 0xff, banned: ((legal || 0) >> 8) & 0xff, oracle,
    prices: { eur, usd, eur_foil, usd_foil }, stats: stats || null,
  };
}

export async function loadCards(meta, dir = 'data', { parts = Infinity } = {}) {
  const out = [];
  for (const p of meta.index.parts.slice(0, parts)) {
    for (const row of (await readGz(dir, p.name)).cards) out.push(toCard(row, meta));
  }
  return out;
}

// Storico di uno shard: { id: { e:[off,vals], u:[...], ef:[...], uf:[...] } }
const shardCache = new Map();
export async function loadShard(id, dir = 'data') {
  const sh = id.slice(0, 2);
  if (!shardCache.has(sh)) {
    shardCache.set(sh, readGz(dir, `hist/${sh}.json.gz`).catch(() => ({ cards: {} })));
  }
  return (await shardCache.get(sh)).cards[id] || null;
}

// Converte la forma compatta in [[timestampMs, prezzo]] per model.js.
export function toSeries(entry, key, axis) {
  const s = entry?.[key];
  if (!s) return [];
  const [off, vals] = s;
  const start = Date.parse(axis.start);
  const out = [];
  for (let i = 0; i < vals.length; i++) if (vals[i] != null) out.push([start + (off + i) * DAY, vals[i]]);
  return out;
}

export const hasHistory = card => !!(card.flags & FLAG.history);
