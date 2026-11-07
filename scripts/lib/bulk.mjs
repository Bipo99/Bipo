// Lettura in streaming dei bulk di Scryfall (JSONL gzip su data.scryfall.io).
import { createGunzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { api } from './scryfall.mjs';

export async function bulkInfo(type = 'default_cards') {
  const list = await api('/bulk-data');
  const entry = (list?.data || []).find(d => d.type === type);
  if (!entry) throw new Error(`Bulk "${type}" non disponibile`);
  return entry;
}

// Itera una carta alla volta: il file non viene mai tenuto in memoria per intero.
export async function* bulkCards(type = 'default_cards', onProgress) {
  const info = await bulkInfo(type);
  const res = await fetch(info.jsonl_download_uri, { headers: { 'User-Agent': 'MTGInvest/1.0 (+github)' } });
  if (!res.ok) throw new Error(`Bulk ${type}: HTTP ${res.status}`);
  const total = info.compressed_size || Number(res.headers.get('content-length')) || 0;
  let got = 0, lastPct = -5;
  const counter = new Transform({
    transform(chunk, _e, cb) {
      got += chunk.length;
      const pct = Math.floor((got / total) * 100);
      if (onProgress && total && pct >= lastPct + 5) { lastPct = pct; onProgress(pct); }
      cb(null, chunk);
    },
  });
  let tail = '';
  for await (const chunk of Readable.fromWeb(res.body).pipe(counter).pipe(createGunzip())) {
    const lines = (tail + chunk.toString('utf8')).split('\n');
    tail = lines.pop();
    for (const line of lines) {
      if (line.length < 2) continue;
      try { yield JSON.parse(line.endsWith(',') ? line.slice(0, -1) : line); } catch {}
    }
  }
  if (tail.trim().length > 2) { try { yield JSON.parse(tail.replace(/[,\]]\s*$/, '')); } catch {} }
  return info;
}
