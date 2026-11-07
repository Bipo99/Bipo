// Crea uno snapshot autonomo per l'anteprima (Artifact), che non può fare richieste esterne:
// un solo file JSON con le carte più scambiate, i loro dati reali e il loro storico reale.
// Uso: node scripts/build-snapshot.mjs [--max 4000] [--out /percorso/snapshot.json]
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadMeta } from './lib/dataset.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const MAX = Number(arg('--max', 4000));
  const out = arg('--out', new URL('../data/snapshot.json', import.meta.url).pathname);
  const meta = await loadMeta();
  const base = new URL('../data/', import.meta.url);

  // righe dell'indice (già ordinate per rilevanza dalla build)
  const rows = [];
  for (const p of meta.index.parts) {
    if (rows.length >= MAX) break;
    const part = JSON.parse(gunzipSync(await readFile(new URL(p.name, base))));
    for (const r of part.cards) {
      if (rows.length >= MAX) break;
      if (r[8] == null && r[9] == null) continue;   // senza prezzo
      rows.push(r);
    }
  }
  const keep = new Set(rows.map(r => r[0]));

  // storico solo delle carte tenute
  const hist = {};
  for (const f of await readdir(new URL('hist/', base))) {
    if (!f.endsWith('.json.gz')) continue;
    const shard = JSON.parse(gunzipSync(await readFile(new URL(`hist/${f}`, base))));
    for (const [id, e] of Object.entries(shard.cards)) if (keep.has(id)) hist[id] = e;
  }

  // nel meta teniamo solo i set citati e i movers presenti nello snapshot
  const sets = {};
  for (const r of rows) sets[r[2]] = meta.index.sets[r[2]];
  const snap = {
    ...meta,
    snapshot: true,
    counts: { ...meta.counts, printings: rows.length, included: rows.length },
    index: { ...meta.index, sets, parts: [] },
    movers: {
      up: meta.movers.up.filter(m => keep.has(m.id)),
      down: meta.movers.down.filter(m => keep.has(m.id)),
    },
    cards: rows,
    history: hist,
    backtest: JSON.parse(await readFile(new URL('backtest.json', base), 'utf8')),
  };
  const text = JSON.stringify(snap);
  await writeFile(out, text);
  console.log(`Snapshot: ${rows.length} stampe, ${Object.keys(hist).length} con storico, ` +
              `${(text.length / 1e6).toFixed(1)} MB → ${out}`);
}

main().catch(e => { console.error(e.stack); process.exit(1); });
