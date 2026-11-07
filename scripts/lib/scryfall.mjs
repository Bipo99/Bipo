// Client Scryfall condiviso da tutti gli script di build (Node) — rispetta il limite di ~10 req/s.
const API = 'https://api.scryfall.com';
const UA = { 'User-Agent': 'MTGInvest/1.0 (+github)', Accept: 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;

// Scryfall chiede 50-100 ms fra le richieste; stiamo volutamente più larghi (4 req/s)
// e rispettiamo il 429 aspettando prima di riprovare, come chiede la loro documentazione.
export async function api(path, init, attempt = 0) {
  const wait = last + 250 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  let res;
  try {
    res = await fetch(API + path, { ...init, headers: { ...UA, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch (e) {
    if (attempt >= 3) throw e;
    await sleep(2000 * 2 ** attempt);
    return api(path, init, attempt + 1);
  }
  if (res.status === 429) {
    if (attempt >= 3) throw new Error('Scryfall 429: limite di richieste superato anche dopo le attese');
    const back = 65000 * (attempt + 1);
    console.warn(`  Scryfall ci chiede di rallentare: attendo ${Math.round(back / 1000)}s…`);
    await sleep(back);
    return api(path, init, attempt + 1);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 404) throw new Error(`Scryfall ${res.status}: ${data?.details || path}`);
  return data;
}

export async function search(q, { order = 'edhrec', dir = 'auto', unique = 'cards', max = 350 } = {}) {
  const out = [];
  let url = `/cards/search?q=${encodeURIComponent(q)}&order=${order}&dir=${dir}&unique=${unique}`;
  while (url && out.length < max) {
    const page = await api(url);
    if (page?.object === 'error') break;
    out.push(...page.data);
    url = page.has_more ? page.next_page.replace(API, '') : null;
  }
  return out.slice(0, max);
}

export async function collection(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 75) {
    const data = await api('/cards/collection', {
      method: 'POST',
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map(id => ({ id })) }),
    });
    out.push(...(data?.data || []));
  }
  return out;
}

// Riduce una carta Scryfall ai campi che servono all'app e al modello.
export function slim(c) {
  const face = c.image_uris || c.card_faces?.[0]?.image_uris || {};
  const n = v => (v == null ? null : Number(v));
  return {
    id: c.id, oracle_id: c.oracle_id, name: c.name, set: c.set, set_name: c.set_name, cn: c.collector_number,
    rarity: c.rarity, released_at: c.released_at, reserved: c.reserved, reprint: c.reprint,
    edhrec_rank: c.edhrec_rank ?? null, legalities: c.legalities, games: c.games,
    type_line: c.type_line || c.card_faces?.[0]?.type_line || '',
    prices: { eur: n(c.prices?.eur), usd: n(c.prices?.usd), eur_foil: n(c.prices?.eur_foil), usd_foil: n(c.prices?.usd_foil) },
    img: face.normal || null, thumb: face.small || null,
    purchase: { cardmarket: c.purchase_uris?.cardmarket || null, tcgplayer: c.purchase_uris?.tcgplayer || null },
    uri: c.scryfall_uri,
  };
}

// Solo carte fisiche, mai stampe digitali.
export const isPaper = c => (c.games || []).includes('paper') && !c.digital;
