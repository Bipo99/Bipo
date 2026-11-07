// Lettura in streaming dei file giganti di MTGJSON (AllPrintings ~1,5 GB, AllPrices ~1,2 GB
// una volta decompressi): niente viene scritto su disco e in memoria resta solo ciò che serve.
import { createGunzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';

const BASE = 'https://mtgjson.com/api/v5/';

async function* gunzipStream(file, onProgress) {
  const res = await fetch(BASE + file, { headers: { 'User-Agent': 'MTGInvest/1.0 (+github)' } });
  if (!res.ok) throw new Error(`MTGJSON ${file}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, lastPct = -5;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length;
      const pct = Math.floor((got / total) * 100);
      if (onProgress && total && pct >= lastPct + 5) { lastPct = pct; onProgress(pct); }
      cb(null, chunk);
    },
  });
  yield* Readable.fromWeb(res.body).pipe(counter).pipe(createGunzip());
}

// Mappa scryfallId -> uuid MTGJSON, solo per gli id richiesti.
// In ogni oggetto carta le chiavi sono in ordine alfabetico, quindi "identifiers" precede "uuid":
// leggiamo lo scryfallId dentro il blocco identifiers e l'uuid che lo segue.
export async function mapScryfallToUuid(wantedIds, onProgress) {
  const want = wantedIds instanceof Set ? wantedIds : new Set(wantedIds);
  const out = new Map();
  let tail = '';
  const SPLIT = '"identifiers":{';
  for await (const chunk of gunzipStream('AllPrintings.json.gz', onProgress)) {
    const parts = (tail + chunk.toString('latin1')).split(SPLIT);
    tail = parts.pop();
    for (const seg of parts) {
      // seg termina appena prima di un blocco identifiers: contiene lo scryfallId del blocco
      // precedente (se c'era) e l'uuid della stessa carta.
      const sid = seg.match(/"scryfallId":"([0-9a-f-]{36})"/);
      const uid = seg.match(/"uuid":"([0-9a-f-]{36})"/);
      if (sid && uid && want.has(sid[1])) out.set(sid[1], uid[1]);
    }
    if (tail.length > 1 << 20) tail = tail.slice(-(1 << 20)); // il tail serve solo a ricucire i confini
  }
  const sid = tail.match(/"scryfallId":"([0-9a-f-]{36})"/);
  const uid = tail.match(/"uuid":"([0-9a-f-]{36})"/);
  if (sid && uid && want.has(sid[1])) out.set(sid[1], uid[1]);
  return out;
}

// Scorre AllPrices e passa a onCard(uuid, block) i soli uuid richiesti, uno alla volta:
// il chiamante riduce subito il blocco a ciò che gli serve e niente resta in memoria.
export async function streamPrices(uuids, onCard, onProgress) {
  const want = uuids instanceof Set ? uuids : new Set(uuids);
  let seen = 0;
  let buf = '', started = false;
  const KEY = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})":\{/g;

  for await (const chunk of gunzipStream('AllPrices.json.gz', onProgress)) {
    buf += chunk.toString('latin1');
    if (!started) {
      const i = buf.indexOf('"data":{');
      if (i < 0) { buf = buf.slice(-16); continue; }
      buf = buf.slice(i + 8); started = true;
    }
    let cut = 0;
    KEY.lastIndex = 0;
    let m;
    while ((m = KEY.exec(buf))) {
      if (!want.has(m[1])) { cut = m.index + m[0].length - 1; continue; }
      const end = matchBrace(buf, m.index + m[0].length - 1);
      if (end < 0) break; // oggetto incompleto: aspetta il prossimo chunk
      try { onCard(m[1], JSON.parse(buf.slice(m.index + m[0].length - 1, end + 1))); seen++; } catch {}
      cut = end;
      KEY.lastIndex = end;
    }
    buf = buf.slice(Math.max(0, cut));
    if (seen === want.size) break;
  }
  return seen;
}

function matchBrace(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

// Serie giornaliere [data, prezzo] di un mercato, dal blocco prezzi MTGJSON di una carta.
export function seriesOf(block, vendor, finish = 'normal') {
  const v = block?.paper?.[vendor]?.retail?.[finish];
  return v ? Object.entries(v).sort((a, b) => (a[0] < b[0] ? -1 : 1)) : [];
}
