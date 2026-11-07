// Stima e verifica del modello di previsione sullo storico REALE.
//
// Metodo: walk-forward (a ogni data si usa solo il passato), minimi quadrati sulle carte di
// addestramento e misura dei risultati su carte MAI usate per la stima (out-of-sample).
// Scrive i coefficienti dentro model.js, fra i marcatori FIT-START/FIT-END, e il riepilogo
// in data/backtest.json, che l'app mostra all'utente.
//
// Uso: node scripts/backtest.mjs [--horizon 30] [--minPrice 2] [--write]
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadMeta, loadCards, toSeries } from './lib/dataset.mjs';
import { fundamentals, technicals, features, forecast, FIT } from '../model.js';

const DAY = 86400000;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const pct = x => (x * 100).toFixed(1) + '%';
const FEATURES = ['m30', 'm90', 'score', 'fromHigh', 'logPrice'];

// Metà delle carte serve a stimare, metà a verificare: la divisione dipende solo dall'id.
const isTrain = id => (id.charCodeAt(0) + id.charCodeAt(1) + id.charCodeAt(2)) % 2 === 0;

async function allShards() {
  const base = new URL('../data/hist/', import.meta.url);
  const out = new Map();
  for (const f of await readdir(base)) {
    if (!f.endsWith('.json.gz')) continue;
    for (const [id, e] of Object.entries(JSON.parse(gunzipSync(await readFile(new URL(f, base)))).cards)) out.set(id, e);
  }
  return out;
}

// Minimi quadrati con intercetta, via equazioni normali + eliminazione di Gauss.
function ols(X, y) {
  const k = X[0].length + 1;
  const A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (let r = 0; r < X.length; r++) {
    const row = [1, ...X[r]];
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j];
      A[i][k] += row[i] * y[r];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] *= 1 + 1e-9; // minima regolarizzazione
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  return Array.from({ length: k }, (_, i) => (Math.abs(A[i][i]) < 1e-12 ? 0 : A[i][k] / A[i][i]));
}

async function main() {
  const H = arg('--horizon', 30), MINP = arg('--minPrice', 2);
  const write = process.argv.includes('--write');
  const meta = await loadMeta();
  const cards = await loadCards(meta);
  const hist = await allShards();
  const axis = meta.axis;
  console.log(`Dati reali: ${cards.length} stampe, ${hist.size} con storico, asse ${axis.start} +${axis.days} giorni`);

  // ------------------------------------------------ campioni walk-forward
  const rows = [];
  let dropped = 0;
  for (const card of cards) {
    const entry = hist.get(card.id);
    if (!entry) continue;
    const key = card.prices.eur != null ? 'e' : 'u';
    const full = toSeries(entry, key, axis);
    if (full.length < 70) continue;

    for (const cut of [full.length - H - 1, full.length - H - 15]) {
      if (cut < 40) continue;
      const train = full.slice(0, cut + 1);
      const now = train[train.length - 1][0];
      const target = full.find(([t]) => t >= now + H * DAY);
      if (!target) continue;
      const p0 = train[train.length - 1][1], p1 = target[1];
      if (!(p0 >= MINP && p1 > 0)) continue;
      if (train.filter(([t]) => t >= now - 45 * DAY).length < 36) continue; // serie troppo bucata
      const actual = (p1 - p0) / p0;
      if (Math.abs(actual) > 2) { dropped++; continue; }                     // oltre il 200%: errore di listino

      const tech = technicals(train);
      const fund = fundamentals(card, p0, now);
      const x = features(card, p0, tech, fund);
      if (FEATURES.some(f => !Number.isFinite(x[f]))) continue;
      rows.push({ id: card.id, name: card.name, p0, p1, actual, y: Math.log(p1 / p0),
                  x, score: fund.score, vol: tech?.dailyVol ?? null, train: isTrain(card.id) });
    }
  }
  if (rows.length < 500) throw new Error(`Troppi pochi campioni: ${rows.length}`);

  const tr = rows.filter(r => r.train), te = rows.filter(r => !r.train);
  console.log(`\nCampioni: ${rows.length} (${new Set(rows.map(r => r.id)).size} carte) · ` +
              `stima ${tr.length} · verifica ${te.length} · scartati ${dropped}`);
  console.log(`Variazione reale a ${H} giorni: mediana ${pct(quant(rows.map(r => r.actual), 0.5))}, ` +
              `media ${pct(mean(rows.map(r => r.actual)))}, 10°-90° ${pct(quant(rows.map(r => r.actual), 0.1))} / ${pct(quant(rows.map(r => r.actual), 0.9))}`);

  // ------------------------------------------------ stima
  const beta = ols(tr.map(r => FEATURES.map(f => r.x[f])), tr.map(r => r.y));
  const fit = { bias: beta[0], ...Object.fromEntries(FEATURES.map((f, i) => [f, beta[i + 1]])) };
  console.log('\nCoefficienti stimati (rendimento logaritmico a 30 giorni):');
  for (const [k, v] of Object.entries(fit)) console.log(`  ${k.padEnd(10)} ${v >= 0 ? ' ' : ''}${v.toFixed(4)}`);

  // ------------------------------------------------ verifica out-of-sample
  const predict = r => Math.exp(Math.max(-FIT.maxDrift, Math.min(FIT.maxDrift,
    fit.bias + FEATURES.reduce((a, f) => a + fit[f] * r.x[f], 0)))) - 1;
  const models = {
    'nessuna variazione': () => 0,
    'segui il trend': r => r.x.m30,
    'solo fondamentali': r => r.x.score * 0.10,
    'modello stimato': predict,
  };
  const base = mean(te.map(r => Math.abs(r.actual)));
  console.log(`\nVerifica su ${te.length} casi di carte mai usate per la stima:`);
  console.log('modello               MAE     meglio del "niente"   direzione giusta');
  const summary = {};
  for (const [name, f] of Object.entries(models)) {
    const mae = mean(te.map(r => Math.abs(f(r) - r.actual)));
    const used = te.filter(r => Math.abs(f(r)) > 0.01);
    const hit = used.length ? used.filter(r => Math.sign(f(r)) === Math.sign(r.actual)).length / used.length : 0;
    summary[name] = { mae, skill: 1 - mae / base, direction: hit, cases: used.length };
    console.log(`${name.padEnd(20)} ${pct(mae).padStart(6)} ${((1 - mae / base) * 100).toFixed(1).padStart(10)}%` +
                `   ${pct(hit).padStart(7)} su ${used.length} casi`);
  }

  // copertura dell'intervallo e resa per segnale, col modello stimato
  const applied = { ...FIT, ...fit };
  let inBand = 0;
  const bySignal = {};
  for (const r of te) {
    const f = forecast({ card: cards.find(c => c.id === r.id) || { flags: 0, rarity: 'rare' }, price: r.p0,
                         series: [], horizonDays: H, fit: applied });
    void f;
    const d = predict(r), sd = r.vol ? r.vol * Math.sqrt(H) : 0.18;
    const lo = r.p0 * Math.exp(Math.log(1 + d) - sd), hi = r.p0 * Math.exp(Math.log(1 + d) + sd);
    if (r.p1 >= lo && r.p1 <= hi) inBand++;
    const bucket = d > 0.04 ? 'previsto in salita' : d < -0.04 ? 'previsto in calo' : 'previsto stabile';
    (bySignal[bucket] ||= []).push(r.actual);
  }
  const coverage = inBand / te.length;
  console.log(`\nIntervallo ±1σ: contiene il prezzo reale nel ${pct(coverage)} dei casi (atteso ~68%)`);
  console.log('\nrendimento reale medio a 30 giorni, per fascia di previsione:');
  for (const [k, v] of Object.entries(bySignal).sort((a, b) => mean(b[1]) - mean(a[1]))) {
    console.log(`  ${k.padEnd(20)} ${pct(mean(v)).padStart(7)} medio · ${pct(quant(v, 0.5)).padStart(7)} mediano · ${v.length} casi`);
  }

  const best = summary['modello stimato'];
  const quality = {
    mae: best.mae, skill: best.skill, direction: best.direction, coverage,
    samples: te.length, cards: new Set(te.map(r => r.id)).size, horizon: H,
    beatsNaive: best.skill > 0 && best.direction > 0.52,
  };
  const out = { run: new Date().toISOString(), horizon: H, minPrice: MINP, dataAxis: axis,
                samples: rows.length, train: tr.length, test: te.length, dropped,
                marketMoveMedian: quant(rows.map(r => r.actual), 0.5), fit, models: summary, quality,
                byBucket: Object.fromEntries(Object.entries(bySignal).map(([k, v]) =>
                  [k, { n: v.length, mean: mean(v), median: quant(v, 0.5) }])) };
  await writeFile(new URL('../data/backtest.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');

  if (write) {
    const path = new URL('../model.js', import.meta.url);
    const src = await readFile(path, 'utf8');
    const literal = JSON.stringify({ ...fit, volScale: FIT.volScale, maxDrift: FIT.maxDrift,
                                     minHistoryDays: FIT.minHistoryDays, quality }, null, 2)
      .replace(/"([a-zA-Z]+)":/g, '$1:');
    const next = src.replace(/\/\* FIT-START \*\/[\s\S]*?\/\* FIT-END \*\//,
      `/* FIT-START */${literal}/* FIT-END */`);
    if (next === src) throw new Error('Marcatori FIT-START/FIT-END non trovati in model.js');
    await writeFile(path, next);
    console.log('\nCoefficienti scritti in model.js');
  }
  console.log('Scritto data/backtest.json');
}

main().catch(e => { console.error(e.stack); process.exit(1); });
