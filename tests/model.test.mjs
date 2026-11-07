import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, fundamentals, technicals, linreg } from '../model.js';
import { appendRows } from '../scripts/snapshot.mjs';

const DAY = 86400000, NOW = Date.parse('2026-11-07');
const base = { games: ['paper', 'arena', 'mtgo'], legalities: { commander: 'legal', legacy: 'legal', modern: 'legal' },
  rarity: 'mythic', released_at: '2021-06-18', reprint: false, reserved: false, edhrec_rank: 300 };

test('linreg trova la pendenza esatta', () => {
  const r = linreg([[0, 1], [1, 3], [2, 5]]);
  assert.equal(r.slope, 2); assert.equal(r.intercept, 1); assert.ok(r.r2 > 0.999);
});

test('i fondamentali premiano la Reserved List e puniscono il bulk', () => {
  const rl = fundamentals({ ...base, reserved: true }, 200, NOW).score;
  const bulk = fundamentals({ ...base, rarity: 'common', edhrec_rank: 20000 }, 0.3, NOW).score;
  assert.ok(rl > 80, `rl=${rl}`); assert.ok(bulk < 40, `bulk=${bulk}`);
});

test('una carta solo Arena è NON INVESTIBILE', () => {
  const f = forecast({ card: { ...base, games: ['arena'] }, price: null, now: NOW });
  assert.equal(f.signal, 'NON INVESTIBILE');
});

test('un trend rialzista pulito porta a una previsione positiva', () => {
  const series = Array.from({ length: 40 }, (_, i) => [NOW - (39 - i) * DAY, 20 * 1.01 ** i]);
  const t = technicals(series);
  assert.ok(Math.abs(t.dailyDrift - 0.01) < 1e-6);
  const f = forecast({ card: base, price: series.at(-1)[1], series, now: NOW });
  assert.ok(f.drift > 0.1, `drift=${f.drift}`); assert.equal(f.tone, 'up');
  assert.ok(f.low < f.expected && f.expected < f.high);
});

test('un trend in calo su una carta nuova dà VENDI / EVITA', () => {
  const card = { ...base, released_at: '2026-10-20', edhrec_rank: 9000, rarity: 'rare' };
  const series = Array.from({ length: 30 }, (_, i) => [NOW - (29 - i) * DAY, 30 * 0.985 ** i]);
  const f = forecast({ card, price: series.at(-1)[1], series, now: NOW });
  assert.equal(f.signal, 'VENDI / EVITA');
});

test('il break-even include le commissioni', () => {
  const f = forecast({ card: base, price: 10, feePct: 0.1, now: NOW });
  assert.ok(Math.abs(f.breakEven - 0.1111) < 1e-3);
});

test('lo snapshot salva una sola riga al giorno', () => {
  const h = { names: {}, cards: {} };
  const c = { id: 'x', name: 'X', prices: { eur: '1.00', usd: '1.10' } };
  appendRows(h, [c], '2026-11-07');
  appendRows(h, [{ ...c, prices: { eur: '2.00' } }], '2026-11-07');
  appendRows(h, [c], '2026-11-08');
  assert.equal(h.cards.x.length, 2); assert.equal(h.cards.x[0][1], 2);
});

test('il bulk sotto 1 è sempre da evitare', () => {
  const f = forecast({ card: { ...base, rarity: 'common' }, price: 0.3, now: NOW });
  assert.equal(f.signal, 'VENDI / EVITA');
});
