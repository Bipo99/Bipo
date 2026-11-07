// Costruisce TUTTI i dati del sito, da fonti reali:
//   data/meta.json      — info della build, indice dei set, liste pronte, indice di mercato
//   data/index.json.gz  — ogni stampa in carta (varianti comprese) con i prezzi di oggi  [Scryfall bulk]
//   data/hist/XX.json.gz— storico giornaliero reale, in 256 shard caricati su richiesta   [MTGJSON]
//
// Uso: node scripts/build-data.mjs [--out data] [--days 100]
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { bulkCards } from './lib/bulk.mjs';
import { mapScryfallToUuid, streamPrices, seriesOf } from './lib/mtgjson.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = (...a) => console.log(...a);
const progress = label => p => process.stdout.write(`\r  ${label} ${p}%  `);

const RARITY = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const EPOCH = Date.parse('1993-08-05'); // Limited Edition Alpha
const DAY = 86400000;
const FLAG = { reserved: 1, reprint: 2, promo: 4, foilOnly: 8, upcoming: 16, history: 32, etched: 64 };
// Legalità compresse in due maschere di bit (un bit per formato), nell'ordine di FORMATS.
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];
const legalMasks = leg => {
  let legal = 0, banned = 0;
  FORMATS.forEach((f, i) => {
    const v = leg?.[f];
    if (v === 'legal' || v === 'restricted') legal |= 1 << i;
    else if (v === 'banned') banned |= 1 << i;
  });
  return (banned << 8) | legal;
};

const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
// Mediana di 3 punti attorno a i: smorza i picchi di un solo giorno (errori di listino).
function median3(vals, i) {
  const w = [vals[i - 1], vals[i], vals[i + 1]].filter(v => v != null).sort((a, b) => a - b);
  return w.length ? w[w.length >> 1] : null;
}
const num = v => (v == null || v === '' ? null : Number(v));

async function main() {
  const OUT = new URL('../' + arg('--out', 'data') + '/', import.meta.url);
  const DAYS = Number(arg('--days', 100));
  const today = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();

  // ---------------------------------------------------------------- 1. indice
  log('Scryfall · bulk "default_cards" (tutte le stampe)…');
  const sets = new Map(), rows = [], idList = [];
  let total = 0;
  for await (const c of bulkCards('default_cards', progress('scaricato'))) {
    total++;
    if (!(c.games || []).includes('paper') || c.digital) continue;
    const p = c.prices || {};
    const eur = num(p.eur), usd = num(p.usd), eurF = num(p.eur_foil), usdF = num(p.usd_foil);
    if (eur == null && usd == null && eurF == null && usdF == null && !c.reserved) continue; // senza mercato
    if (!sets.has(c.set)) sets.set(c.set, c.set_name);
    const finishes = c.finishes || [];
    const flags =
      (c.reserved ? FLAG.reserved : 0) | (c.reprint ? FLAG.reprint : 0) | (c.promo ? FLAG.promo : 0) |
      (!finishes.includes('nonfoil') ? FLAG.foilOnly : 0) | (c.released_at > today ? FLAG.upcoming : 0) |
      (finishes.includes('etched') ? FLAG.etched : 0);
    rows.push([
      c.id, c.name, c.set, c.collector_number, Math.max(0, RARITY.indexOf(c.rarity)),
      Math.round((Date.parse(c.released_at) - EPOCH) / DAY), c.edhrec_rank || 0, flags,
      eur, usd, eurF, usdF, c.oracle_id, legalMasks(c.legalities), 0,
    ]);
    idList.push(c.id);
  }
  log(`\r  ${total} oggetti letti · ${rows.length} stampe in carta con mercato · ${sets.size} set`);

  // ---------------------------------------------------------------- 2. mappa id
  log('MTGJSON · AllPrintings (mappa Scryfall → MTGJSON)…');
  const uuidBySid = await mapScryfallToUuid(new Set(idList), progress('scaricato'));
  const sidByUuid = new Map([...uuidBySid].map(([s, u]) => [u, s]));
  log(`\r  ${uuidBySid.size} stampe collegate allo storico            `);

  // ---------------------------------------------------------------- 3. storico
  const axisStart = new Date(Date.parse(today) - (DAYS - 1) * DAY).toISOString().slice(0, 10);
  const idx = new Map();
  for (let i = 0; i < DAYS; i++) idx.set(new Date(Date.parse(axisStart) + i * DAY).toISOString().slice(0, 10), i);

  const shards = new Map();           // "xx" -> [stringhe JSON]
  const rowByFlagIdx = new Map(rows.map((r, i) => [r[0], i]));
  const movers = [];                  // {id, ch30, ch7, price}
  const indexSum = new Float64Array(DAYS), indexCnt = new Int32Array(DAYS);
  let withHistory = 0;

  log('MTGJSON · AllPrices (storico giornaliero reale)…');
  await streamPrices(new Set(sidByUuid.keys()), (uuid, block) => {
    const id = sidByUuid.get(uuid);
    if (!id) return;
    const out = {};
    let primary = null;
    for (const [key, vendor, finish] of [['e', 'cardmarket', 'normal'], ['u', 'tcgplayer', 'normal'],
                                         ['ef', 'cardmarket', 'foil'], ['uf', 'tcgplayer', 'foil']]) {
      const pairs = seriesOf(block, vendor, finish);
      if (!pairs.length) continue;
      const arr = new Array(DAYS).fill(null);
      let first = -1, last = -1, n = 0;
      for (const [d, v] of pairs) {
        const i = idx.get(d);
        if (i === undefined || v == null) continue;
        arr[i] = round(v); n++;
        if (first < 0) first = i;
        last = i;
      }
      if (n < 2) continue;
      out[key] = [first, arr.slice(first, last + 1)];
      if (!primary || key === 'e') primary = out[key];
    }
    if (!primary) return;
    withHistory++;
    const ri = rowByFlagIdx.get(id);
    if (ri !== undefined) rows[ri][7] |= FLAG.history;

    // Statistiche riassuntive salvate NELL'INDICE: permettono all'app di calcolare la previsione
    // di tutte le carte senza scaricare lo storico, che serve solo per il grafico.
    {
      const [o, v] = primary;
      const last = median3(v, v.length - 1) ?? v[v.length - 1];
      const val = (i) => (i >= 0 ? median3(v, i) : null);
      const ch = n => { const p = val(v.length - 1 - n); return p > 0 && last > 0 ? round((last - p) / p, 4) : null; };
      const filled = v.filter(x => x != null);
      const hi = filled.length ? Math.max(...filled) : null;
      let sum = 0, n = 0, prev = null, prevI = 0;
      for (let i = 0; i < v.length; i++) {
        if (v[i] == null || v[i] <= 0) continue;
        if (prev != null) { const dt = Math.max(1, i - prevI); sum += (Math.log(v[i] / prev) / Math.sqrt(dt)) ** 2; n++; }
        prev = v[i]; prevI = i;
      }
      const vol30 = n > 1 ? round(Math.sqrt(sum / n) * Math.sqrt(30), 4) : null;
      const spanDays = v.length;
      if (ri !== undefined) {
        rows[ri][14] = [ch(30), ch(90), hi > 0 && last > 0 ? round((last - hi) / hi, 4) : null,
                        vol30, round(filled.length / Math.max(1, spanDays), 3), spanDays, o];
      }
    }

    // indice di mercato e variazioni, sulla serie principale (Cardmarket, altrimenti TCGplayer)
    const [off, vals] = primary;
    const lastV = median3(vals, vals.length - 1);
    if (lastV >= 1) {
      for (let i = 0; i < vals.length; i++) if (vals[i] != null) { indexSum[off + i] += vals[i] / lastV; indexCnt[off + i]++; }
      // Una variazione conta solo se la carta era già quotata e ha una serie davvero continua:
      // senza questo controllo le carte appena entrate sul mercato producono +40.000%.
      const v30 = median3(vals, vals.length - 1 - 30), v7 = median3(vals, vals.length - 1 - 7);
      const filled = vals.slice(Math.max(0, vals.length - 31)).filter(v => v != null).length;
      if (v30 >= 1 && filled >= 24 && vals.length >= 31) {
        const ch30 = (lastV - v30) / v30;
        if (Math.abs(ch30) <= 3) movers.push({ id, price: lastV, ch30: round(ch30, 4), ch7: v7 >= 1 ? round((lastV - v7) / v7, 4) : null });
      }
    }
    const sh = id.slice(0, 2);
    (shards.get(sh) || shards.set(sh, []).get(sh)).push(JSON.stringify(id) + ':' + JSON.stringify(out));

  }, progress('scaricato'));
  log(`\r  storico reale per ${withHistory} stampe                    `);

  // ---------------------------------------------------------------- 4. scrittura
  await rm(new URL('hist/', OUT), { recursive: true, force: true });
  await mkdir(new URL('hist/', OUT), { recursive: true });
  let bytes = 0;
  for (const [sh, parts] of shards) {
    const body = `{"start":"${axisStart}","days":${DAYS},"cards":{${parts.join(',')}}}`;
    const gz = gzipSync(Buffer.from(body), { level: 9 });
    bytes += gz.length;
    await writeFile(new URL(`hist/${sh}.json.gz`, OUT), gz);
  }

  // L'indice è diviso in parti ordinate per rilevanza (prezzo più alto prima): l'app è utilizzabile
  // appena arriva la parte 0 e carica le altre in sottofondo.
  const value = r => Math.max(r[8] ?? 0, r[9] ?? 0, (r[10] ?? 0) * 0.6, (r[11] ?? 0) * 0.6);
  rows.sort((a, b) => value(b) - value(a));
  const PART = 14000;
  const parts = [];
  for (let i = 0; i < rows.length; i += PART) {
    const gz = gzipSync(Buffer.from(JSON.stringify({ cards: rows.slice(i, i + PART) })), { level: 9 });
    const name = `index-${parts.length}.json.gz`;
    await writeFile(new URL(name, OUT), gz);
    parts.push({ name, cards: Math.min(PART, rows.length - i), bytes: gz.length });
  }
  const indexBytes = parts.reduce((a, p) => a + p.bytes, 0);

  // indice di mercato: media dei prezzi normalizzati (100 = oggi)
  const market = [];
  for (let i = 0; i < DAYS; i++) {
    if (indexCnt[i] < 200) { market.push(null); continue; }
    market.push(round((indexSum[i] / indexCnt[i]) * 100, 2));
  }
  movers.sort((a, b) => b.ch30 - a.ch30);
  const liquid = movers.filter(m => m.price >= 2);
  const meta = {
    built: new Date().toISOString(), today, source: { cards: 'scryfall.com (bulk default_cards)', history: 'mtgjson.com (AllPrices)' },
    index: {
      fields: ['id', 'name', 'set', 'cn', 'rarity', 'released', 'edhrec', 'flags', 'eur', 'usd', 'eur_foil', 'usd_foil', 'oracle', 'legal', 'stats'],
      statsFields: ['ch30', 'ch90', 'fromHigh', 'vol30', 'coverage', 'spanDays', 'offset'],
      rarities: RARITY, formats: FORMATS, epoch: '1993-08-05', sets: Object.fromEntries(sets), parts,
    },
    counts: { printings: rows.length, sets: sets.size, withHistory, upcoming: rows.filter(r => r[7] & FLAG.upcoming).length },
    axis: { start: axisStart, days: DAYS },
    market: { basis: 'media dei prezzi normalizzati delle carte con storico, 100 = oggi', points: market, sample: Math.max(...indexCnt) },
    movers: { up: liquid.slice(0, 40), down: liquid.slice(-40).reverse() },
    flags: FLAG,
  };
  await writeFile(new URL('meta.json', OUT), JSON.stringify(meta) + '\n');

  const mb = n => (n / 1e6).toFixed(1) + ' MB';
  log(`\nFatto in ${((Date.now() - t0) / 1000).toFixed(0)}s · index ${mb(indexBytes)} gz in ${parts.length} parti · ` +
      `storico ${mb(bytes)} gz in ${shards.size} shard · ${rows.length} stampe, ${withHistory} con storico`);
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1); });
