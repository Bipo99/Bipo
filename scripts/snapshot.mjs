// Salva ogni giorno una "fotografia" dei prezzi delle carte in data/watchlist.json
// dentro data/history.json. Viene eseguito dalla GitHub Action (Node 20+, nessuna dipendenza).
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../data/', import.meta.url);
const num = v => (v == null ? null : Number(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, ROOT), 'utf8')); } catch { return fallback; }
}

export function appendRows(history, cards, date) {
  for (const c of cards) {
    const p = c.prices || {};
    const row = [date, num(p.eur), num(p.usd), num(p.eur_foil), num(p.usd_foil)];
    const rows = (history.cards[c.id] ||= []);
    if (rows.length && rows[rows.length - 1][0] === date) rows[rows.length - 1] = row; // una riga al giorno
    else rows.push(row);
    if (rows.length > 1100) rows.splice(0, rows.length - 1100); // ~3 anni
    history.names[c.id] = c.name;
  }
  history.updated = new Date().toISOString();
  return history;
}

async function main() {
  const watch = await readJSON('watchlist.json', { ids: [] });
  const ids = [...new Set(watch.ids || [])];
  const history = await readJSON('history.json', { updated: null, names: {}, cards: {} });
  history.names ||= {}; history.cards ||= {};
  if (!ids.length) { console.log('watchlist.json vuota: niente da fare'); return; }
  const date = new Date().toISOString().slice(0, 10);
  const got = [];
  for (let i = 0; i < ids.length; i += 75) {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'MTGInvest/1.0' },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map(id => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    const data = await res.json();
    got.push(...data.data);
    if (data.not_found?.length) console.warn('Non trovate:', data.not_found.map(x => x.id).join(', '));
    await sleep(150);
  }
  appendRows(history, got, date);
  await writeFile(new URL('history.json', ROOT), JSON.stringify(history) + '\n');
  console.log(`Salvati i prezzi di ${got.length} carte per il ${date}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
