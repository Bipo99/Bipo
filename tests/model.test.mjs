import test from 'node:test';
import assert from 'node:assert/strict';
import { linreg, technicals, statsToTech, fundamentals, forecast, features, FLAG, FIT, isLegal, isBanned } from '../model.js';

const DAY = 86400000;
const NOW = Date.parse('2026-11-07');
// legal: bit 5 = commander, bit 2 = modern, bit 3 = legacy
const LEGAL = (1 << 5) | (1 << 2) | (1 << 3);
const base = { name: 'Prova', rarity: 'mythic', released: '2015-06-18', edhrec: 300, flags: 0, legal: LEGAL, banned: 0 };

test('linreg trova la pendenza esatta', () => {
  const r = linreg([[0, 1], [1, 3], [2, 5]]);
  assert.equal(r.slope, 2);
  assert.ok(r.r2 > 0.999);
});

test('una serie piatta non produce NaN', () => {
  const flat = Array.from({ length: 40 }, (_, i) => [NOW - (39 - i) * DAY, 12600]);
  const t = technicals(flat);
  assert.ok(Number.isFinite(t.r2), 'r2 deve essere un numero');
  const f = forecast({ card: base, price: 12600, series: flat, now: NOW });
  assert.ok(Number.isFinite(f.drift) && Number.isFinite(f.vol) && Number.isFinite(f.expected));
});

test('le legalità si leggono dalla maschera di bit', () => {
  assert.ok(isLegal(base, 'commander'));
  assert.ok(!isLegal(base, 'standard'));
  assert.ok(!isBanned(base, 'commander'));
  assert.ok(isBanned({ ...base, banned: 1 << 5 }, 'commander'));
});

test('i fondamentali premiano la Reserved List e bocciano il bulk', () => {
  const rl = fundamentals({ ...base, flags: FLAG.reserved }, 200, NOW).score;
  const bulk = fundamentals({ ...base, rarity: 'common', edhrec: 30000 }, 0.3, NOW).score;
  assert.ok(rl > 80, `Reserved List dovrebbe stare in alto, invece ${rl}`);
  assert.ok(bulk < 40, `il bulk dovrebbe stare in basso, invece ${bulk}`);
  assert.ok(rl - bulk > 50, 'fra le due deve esserci un divario netto');
});

test('una carta sotto 1 non è investibile', () => {
  assert.equal(forecast({ card: base, price: 0.4, now: NOW }).signal, 'NON INVESTIBILE');
  assert.equal(forecast({ card: base, price: null, now: NOW }).signal, 'SENZA PREZZO');
});

test('il preordine viene segnalato e penalizzato', () => {
  const pre = { ...base, flags: FLAG.upcoming, released: '2026-12-01' };
  const f = forecast({ card: pre, price: 30, now: NOW });
  assert.ok(f.notes.some(n => n.includes('preordine')));
  assert.ok(f.fund.score < fundamentals(base, 30, NOW).score);
});

test('statsToTech ricostruisce le variabili usate dal modello', () => {
  const t = statsToTech([0.4, 0.1, -0.05, 0.3, 0.95, 89, 0]);
  assert.equal(t.ch30, 0.4);
  assert.ok(Math.abs(t.dailyVol * Math.sqrt(30) - 0.3) < 1e-9);
  assert.equal(statsToTech(null), null);
  assert.equal(statsToTech([0, 0, 0, 0, 1, 5, 0]), null, 'storico troppo corto');
});

test('la previsione segue il ritorno verso la media misurato sui dati', () => {
  const su = forecast({ card: base, price: 50, tech: statsToTech([0.6, 0.3, -0.02, 0.3, 1, 89, 0]), now: NOW });
  const giu = forecast({ card: base, price: 50, tech: statsToTech([-0.4, -0.3, -0.45, 0.3, 1, 89, 0]), now: NOW });
  assert.ok(FIT.m30 < 0, 'il coefficiente stimato su m30 deve essere negativo');
  assert.ok(su.drift < giu.drift, 'chi è corso di più deve avere una previsione peggiore di chi è crollato');
  assert.ok(su.low < su.expected && su.expected < su.high);
});

test('le commissioni alzano la soglia per guadagnare', () => {
  const f = forecast({ card: base, price: 10, feePct: 0.1, now: NOW });
  assert.ok(Math.abs(f.breakEven - 0.1111) < 1e-3);
  assert.ok(Math.abs(f.netEdge - (f.drift - f.breakEven)) < 1e-12);
});

test('l orizzonte allunga previsione e incertezza', () => {
  const t = statsToTech([-0.2, -0.1, -0.3, 0.25, 1, 89, 0]);
  const a = forecast({ card: base, price: 40, tech: t, horizonDays: 30, now: NOW });
  const b = forecast({ card: base, price: 40, tech: t, horizonDays: 90, now: NOW });
  assert.ok(b.vol > a.vol, 'a 90 giorni l incertezza deve essere maggiore');
  assert.ok(Math.abs(b.drift) > Math.abs(a.drift));
});

test('le variabili del modello restano nei limiti', () => {
  const t = statsToTech([50, 50, -0.99, 2, 1, 89, 0]);   // valori assurdi
  const x = features(base, 1e6, t, fundamentals(base, 1e6, NOW));
  for (const [k, v] of Object.entries(x)) assert.ok(Number.isFinite(v), `${k} non è finito`);
  assert.ok(Math.abs(x.m30) <= 0.5 && Math.abs(x.logPrice) <= 1);
});

test('il modello dichiara la qualità misurata', () => {
  assert.ok(FIT.quality, 'model.js deve contenere i risultati del backtest');
  assert.ok(FIT.quality.samples > 1000, 'il backtest deve avere abbastanza campioni');
  assert.ok(FIT.quality.direction > 0.5, 'la direzione deve battere il lancio della moneta');
  assert.ok(FIT.quality.coverage > 0.55 && FIT.quality.coverage < 0.85, 'intervallo ±1σ mal calibrato');
});
