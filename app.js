// MTG Invest — controller dell'app.
// Dati reali: indice di tutte le stampe in carta (Scryfall bulk) + storico giornaliero (MTGJSON),
// prezzi in diretta da Scryfall. Le previsioni vengono da model.js, i cui coefficienti sono
// stimati e verificati su quello stesso storico da scripts/backtest.mjs.
import { forecast, statsToTech, FLAG, FIT, isLegal } from './model.js';
import * as D from './lib/data.js';

const DAY = 86400000;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- impostazioni e dati locali
const LS = {
  get(k, d) { try { const v = localStorage.getItem('mtgi2.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mtgi2.' + k, JSON.stringify(v)); } catch { toast('Spazio locale esaurito: esporta un backup'); } },
};
const DEFAULTS = { currency: 'eur', feePct: 8, horizon: 30, refreshMin: 10, alertPct: 8 };
const S = {
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  watch: LS.get('watch', []),
  portfolio: LS.get('portfolio', []),
};
const save = (...k) => k.forEach(x => LS.set(x, S[x]));

// Valore stimato per condizione, rispetto al prezzo Near Mint (scala Cardmarket).
const COND = { MT: 1, NM: 1, EX: 0.85, GD: 0.72, LP: 0.6, PL: 0.45, PO: 0.25 };
const COND_LABEL = { MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };

// ---------------------------------------------------------------- formattazione
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const cur = () => S.settings.currency;
function money(v, c = cur()) {
  if (v == null || !Number.isFinite(v)) return '—';
  return c === 'usd' ? '$' + nf2.format(v) : nf2.format(v) + ' €';
}
const pct = (x, sign = true) => (x == null || !Number.isFinite(x) ? '—' : (sign && x > 0 ? '+' : '') + (x * 100).toFixed(1).replace('.', ',') + '%');
const tone = x => (x == null ? '' : x > 0.002 ? 'up' : x < -0.002 ? 'down' : 'flat');
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

// ---------------------------------------------------------------- previsione di una carta
// Quale quotazione mostrare: la valuta scelta, altrimenti l'altra; e per le stampe che esistono
// solo in foil, la quotazione foil. Restituisce anche quale, così l'interfaccia può dirlo.
function quote(card, preferFoil = false) {
  const p = D.livePrices(card);
  const c = cur(), other = c === 'eur' ? 'usd' : 'eur';
  const order = preferFoil
    ? [[c, true], [other, true], [c, false], [other, false]]
    : [[c, false], [other, false], [c, true], [other, true]];
  for (const [currency, foil] of order) {
    const v = p[foil ? `${currency}_foil` : currency];
    if (v != null) return { v, currency, foil, exact: currency === c && foil === preferFoil };
  }
  return { v: null, currency: c, foil: preferFoil, exact: true };
}
const priceOf = (card, foil = false) => quote(card, foil).v;
const statsOf = card => card.stats || null;

function fc(card, { foil = false, horizon = S.settings.horizon, tech, series = null } = {}) {
  return forecast({
    card, price: priceOf(card, foil), series,
    tech: tech !== undefined ? tech : statsToTech(statsOf(card)),
    horizonDays: Number(horizon), feePct: S.settings.feePct / 100,
  });
}

// ---------------------------------------------------------------- grafici
function lineChart(points, { W = 680, H = 200, proj = null, fmt = v => nf2.format(v) } = {}) {
  const P = { l: 56, r: 14, t: 12, b: 22 };
  const pts = points.filter(p => p && p[1] != null);
  if (pts.length < 2) return '<div class="chart-empty">Storico non disponibile per questa stampa.</div>';
  const tMin = pts[0][0];
  const tMax = proj ? proj.at : pts[pts.length - 1][0];
  const vals = pts.map(p => p[1]).concat(proj ? [proj.low, proj.high, proj.expected] : []).filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { hi += 1; lo = Math.max(0, lo - 1); }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const x = t => P.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - P.l - P.r);
  const y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${d}L${x(pts[pts.length - 1][0]).toFixed(1)},${y(lo).toFixed(1)}L${x(tMin).toFixed(1)},${y(lo).toFixed(1)}Z`;
  const grid = [lo, (lo + hi) / 2, hi].map(v =>
    `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
    `<text x="${P.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('');
  const last = pts[pts.length - 1];
  const cone = proj ? `<path class="cone" d="M${x(last[0]).toFixed(1)},${y(last[1]).toFixed(1)}L${x(proj.at).toFixed(1)},${y(proj.high).toFixed(1)}L${x(proj.at).toFixed(1)},${y(proj.low).toFixed(1)}Z"/>
     <path class="proj" d="M${x(last[0]).toFixed(1)},${y(last[1]).toFixed(1)}L${x(proj.at).toFixed(1)},${y(proj.expected).toFixed(1)}"/>` : '';
  const dd = t => new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del prezzo">
    ${grid}<path class="area" d="${area}"/>${cone}<path class="line" d="${d}"/>
    <circle class="pt" cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3"/>
    <text x="${P.l}" y="${H - 5}">${dd(tMin)}</text>
    <text x="${x(last[0]).toFixed(1)}" y="${H - 5}" text-anchor="middle">oggi</text>
    ${proj ? `<text x="${W - P.r}" y="${H - 5}" text-anchor="end">+${proj.days}g</text>` : ''}</svg>`;
}

// ---------------------------------------------------------------- righe
function cardRow(card, { foil = false, extra = '' } = {}) {
  const f = fc(card, { foil });
  const q = quote(card, foil);
  const ch = statsOf(card)?.[0];
  const tags = [
    card.flags & FLAG.reserved ? '<span class="tag gold">Reserved</span>' : '',
    card.flags & FLAG.upcoming ? '<span class="tag pre">Preordine</span>' : '',
    foil ? '<span class="tag foil">Foil</span>' : '',
  ].join('');
  return `<div class="row" data-open="${card.id}">
    <img class="thumb" loading="lazy" decoding="async" src="${D.imageUrl(card.id)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="cell">
      <div class="name">${esc(card.name)} ${tags}</div>
      <div class="sub">${esc(card.setName)} · #${esc(card.cn)} · ${esc(card.rarity)}</div>
      ${extra}
    </div>
    <div class="nums">
      <div class="price">${money(q.v, q.currency)}${q.foil && !foil ? ' <span class="tag foil">foil</span>' : ''}</div>
      <div class="chg ${tone(ch)}">${ch == null ? '<span class="hint">senza storico</span>' : pct(ch) + ' 30g'}</div>
      <span class="badge ${f.tone}">${f.signal}</span>
    </div>
    <button class="star ${S.watch.includes(card.id) ? 'on' : ''}" data-star="${card.id}" aria-label="Aggiungi alla watchlist">★</button>
  </div>`;
}
const kpi = (label, value, sub = '', cls = '') =>
  `<div class="kpi"><div class="kl">${label}</div><div class="kv ${cls}">${value}</div><div class="ks">${sub}</div></div>`;

// ---------------------------------------------------------------- portafoglio
function portfolioStats() {
  const fee = S.settings.feePct / 100;
  let cost = 0, value = 0, future = 0, missing = 0;
  const lots = [];
  for (const l of S.portfolio) {
    const card = D.state.byId.get(l.id);
    if (!card) { missing++; continue; }
    const k = COND[l.cond] ?? 1;
    const base = quote(card, l.foil).v ?? 0;
    const p = base * k;
    const f = fc(card, { foil: l.foil });
    const exp = (f.expected ?? base) * k;
    cost += l.qty * l.buy; value += l.qty * p; future += l.qty * exp;
    lots.push({ l, card, p, f, val: l.qty * p, pl: l.qty * (p * (1 - fee) - l.buy) });
  }
  const net = value * (1 - fee);
  return { cost, value, net, future, pl: net - cost, plPct: cost ? (net - cost) / cost : 0, lots, missing };
}

// ---------------------------------------------------------------- viste
function renderRadar() {
  const meta = D.state.meta, st = portfolioStats();
  const pts = meta.market.points.map((v, i) => [Date.parse(meta.axis.start) + i * DAY, v]).filter(p => p[1] != null);
  const first = pts[0]?.[1], last = pts[pts.length - 1]?.[1];
  const mkt = first ? (last - first) / first : null;

  $('#kpis').innerHTML =
    kpi('Mercato (90 giorni)', pct(mkt), `${nf0.format(meta.market.sample)} carte nell'indice`, tone(mkt)) +
    kpi('Carte seguite', String(tracked().length), `${nf0.format(meta.counts.printings)} stampe disponibili`) +
    kpi('Portafoglio', money(st.value), `netto ${money(st.net)}`) +
    kpi('P/L netto', money(st.pl), pct(st.plPct), tone(st.pl));

  $('#index-note').textContent = `${meta.market.basis} · fonte MTGJSON`;
  $('#market-chart').innerHTML = lineChart(pts, { fmt: v => v.toFixed(0) });

  const moverRow = m => {
    const c = D.state.byId.get(m.id);
    return c ? cardRow(c) : '';
  };
  $('#movers-up').innerHTML = meta.movers.up.slice(0, 8).map(moverRow).join('') || '<p class="hint">In caricamento…</p>';
  $('#movers-down').innerHTML = meta.movers.down.slice(0, 8).map(moverRow).join('') || '<p class="hint">In caricamento…</p>';

  // occasioni: previsione netta più alta fra le carte con un mercato vero
  const cands = [];
  for (const c of D.state.cards) {
    const p = priceOf(c);
    if (!(p >= 3 && p <= 400)) continue;
    const s = statsOf(c);
    if (!s || s[4] < 0.8 || s[5] < 60) continue;       // serve una serie continua e lunga
    const f = fc(c);
    if (f.netEdge > 0 && f.tone === 'up') cands.push({ c, f });
  }
  cands.sort((a, b) => b.f.netEdge - a.f.netEdge);
  $('#opportunities').innerHTML = cands.slice(0, 10).map(({ c, f }) => cardRow(c, {
    extra: `<div class="why">Attesa ${pct(f.drift)} a ${f.horizonDays}g · netto commissioni ${pct(f.netEdge)} · qualità ${f.fund.score}/100</div>`,
  })).join('') || '<p class="hint">Oggi nessuna carta supera i costi di vendita. Anche non comprare è una decisione.</p>';

  const pre = D.state.cards.filter(c => c.flags & FLAG.upcoming).sort((a, b) => (priceOf(b) ?? 0) - (priceOf(a) ?? 0));
  $('#preorders').innerHTML = pre.slice(0, 8).map(c => cardRow(c)).join('') ||
    '<p class="hint">Nessun preordine nell\'ultima build dei dati.</p>';
}

let marketShown = 100;
function filteredCards() {
  const f = new FormData($('#filters'));
  const q = String(f.get('q') || '').trim().toLowerCase();
  const min = f.get('min') ? Number(f.get('min')) : null;
  const max = f.get('max') ? Number(f.get('max')) : null;
  const rarity = f.get('rarity');
  const out = [];
  for (const c of D.state.cards) {
    if (q && !c.search.includes(q)) continue;
    if (rarity && c.rarity !== rarity) continue;
    if (f.get('reserved') && !(c.flags & FLAG.reserved)) continue;
    if (f.get('upcoming') && !(c.flags & FLAG.upcoming)) continue;
    if (f.get('history') && !(c.flags & FLAG.history)) continue;
    if (f.get('commander') && !isLegal(c, 'commander')) continue;
    const p = priceOf(c);
    if (min != null && !(p >= min)) continue;
    if (max != null && !(p != null && p <= max)) continue;
    out.push(c);
  }
  const sort = f.get('sort');
  const price = c => priceOf(c) ?? -1;
  const noPrice = c => (priceOf(c) == null ? 1 : 0);
  if (sort === 'price-desc') out.sort((a, b) => price(b) - price(a));
  else if (sort === 'price-asc') out.sort((a, b) => price(a) - price(b));
  else if (sort === 'edhrec') out.sort((a, b) => (a.edhrec || 1e9) - (b.edhrec || 1e9));
  else if (sort === 'new') out.sort((a, b) => b.releasedDays - a.releasedDays);
  else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name) || price(b) - price(a));
  else out.sort((a, b) => noPrice(a) - noPrice(b) || fc(b).netEdge - fc(a).netEdge);
  return out;
}
function renderMarket() {
  const t0 = performance.now();
  const list = filteredCards();
  const shown = list.slice(0, marketShown);
  $('#result-count').textContent =
    `${nf0.format(list.length)} stampe trovate su ${nf0.format(D.state.loaded)} caricate · ${Math.round(performance.now() - t0)} ms`;
  $('#market-results').innerHTML = shown.map(c => cardRow(c)).join('') || '<p class="hint">Nessun risultato con questi filtri.</p>';
  $('#more').hidden = list.length <= shown.length;
}

function renderWatch() {
  const cards = S.watch.map(id => D.state.byId.get(id)).filter(Boolean);
  $('#watch-note').textContent = cards.length
    ? `aggiornate ogni ${S.settings.refreshMin} minuti · avviso oltre il ${S.settings.alertPct}%`
    : '';
  $('#watch-list').innerHTML = cards.length
    ? cards.map(c => cardRow(c)).join('')
    : '<p class="hint">Vuota. Cerca una carta e premi ★ per seguirla: i suoi prezzi verranno controllati in continuo.</p>';
}

function renderPortfolio() {
  const st = portfolioStats();
  $('#pf-kpis').innerHTML =
    kpi('Investito', money(st.cost)) +
    kpi('Valore di mercato', money(st.value), `netto ${money(st.net)}`) +
    kpi('P/L netto', money(st.pl), pct(st.plPct), tone(st.pl)) +
    kpi(`Atteso a ${S.settings.horizon}g`, money(st.future), st.value ? pct((st.future - st.value) / st.value) : '', tone(st.future - st.value));

  const total = st.value || 1;
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#a3e635', '#ec4899', '#94a3b8'];
  const sorted = [...st.lots].sort((a, b) => b.val - a.val);
  $('#pf-alloc').innerHTML = sorted.length ? `<div class="panel">
      <div class="alloc">${sorted.map((x, i) => `<span style="width:${(x.val / total) * 100}%;background:${colors[i % colors.length]}"></span>`).join('')}</div>
      <div class="legend">${sorted.slice(0, 8).map((x, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(x.card.name)} ${pct(x.val / total, false)}</span>`).join('')}</div>
      ${sorted[0].val / total > 0.4 ? '<p class="small flat">Più del 40% del valore è in una sola carta: una ristampa annunciata può colpire duro. Valuta di diversificare.</p>' : ''}
    </div>` : '';

  $('#pf-list').innerHTML = st.lots.length ? st.lots.map(({ l, card, p, pl }) => cardRow(card, {
    foil: l.foil,
    extra: `<div class="lot">${l.qty}× ${esc(l.cond || 'NM')} a ${money(l.buy)} · vale ${money(p)} · P/L netto
      <b class="${tone(pl)}">${money(pl)}</b> <button class="link" data-del="${l.lid}">rimuovi</button></div>`,
  })).join('') : '<p class="hint">Nessuna posizione. Apri una carta e usa «Aggiungi al portafoglio».</p>';
  if (st.missing) $('#pf-list').insertAdjacentHTML('beforeend',
    `<p class="hint">${st.missing} posizioni sono ancora in caricamento…</p>`);
}

function renderModel() {
  const b = D.state.backtest, meta = D.state.meta;
  if (!b) { $('#model-report').innerHTML = '<div class="panel"><p class="hint">Rapporto di verifica non disponibile in questa build.</p></div>'; return; }
  const q = b.quality;
  const rows = Object.entries(b.models).map(([name, m]) =>
    `<tr${name === 'modello stimato' ? ' class="me"' : ''}><td>${esc(name)}</td><td class="n">${pct(m.mae, false)}</td>
     <td class="n ${tone(m.skill)}">${pct(m.skill)}</td><td class="n">${m.cases ? pct(m.direction, false) : '—'}</td>
     <td class="n">${nf0.format(m.cases)}</td></tr>`).join('');
  const buckets = Object.entries(b.byBucket).sort((a, c) => c[1].mean - a[1].mean).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="n ${tone(v.mean)}">${pct(v.mean)}</td><td class="n">${pct(v.median)}</td><td class="n">${nf0.format(v.n)}</td></tr>`).join('');
  const coef = Object.entries(b.fit).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="n ${tone(v)}">${v.toFixed(4)}</td></tr>`).join('');

  $('#model-report').innerHTML = `
    <div class="kpis">
      ${kpi('Direzione giusta', pct(q.direction, false), `su ${nf0.format(q.samples)} casi fuori campione`, q.direction > 0.5 ? 'up' : 'down')}
      ${kpi('Errore medio', pct(q.mae, false), `a ${q.horizon} giorni`)}
      ${kpi('Meglio del «non cambia»', pct(q.skill), q.skill > 0 ? 'vantaggio reale ma piccolo' : 'nessun vantaggio', tone(q.skill))}
      ${kpi('Intervallo ±1σ', pct(q.coverage, false), 'copertura attesa 68%')}
    </div>
    <div class="panel">
      <h2>Come leggere questi numeri</h2>
      <p class="small">Il modello è <strong>stimato sui prezzi reali</strong> di ${nf0.format(meta.counts.withHistory)} stampe
        e verificato su carte <strong>mai usate per stimarlo</strong>: è il controllo che distingue una previsione da un
        racconto. Il mercato a ${q.horizon} giorni è quasi imprevedibile — la variazione mediana è ${pct(b.marketMoveMedian)} —
        quindi azzeccare la direzione nel ${pct(q.direction, false)} dei casi è un vantaggio piccolo ma reale.
        Non è una macchina da soldi e non va usata come tale.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>modello</th><th class="n">errore medio</th><th class="n">meglio del «non cambia»</th><th class="n">direzione giusta</th><th class="n">casi</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>
    <div class="panel">
      <h2>Quanto hanno reso davvero le previsioni</h2>
      <p class="small">Rendimento reale a ${q.horizon} giorni delle carte fuori campione, raggruppate per quello che il
        modello aveva previsto. È la verifica che conta per chi investe.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>previsione</th><th class="n">resa media</th><th class="n">mediana</th><th class="n">casi</th></tr></thead>
        <tbody>${buckets}</tbody></table></div>
    </div>
    <div class="panel">
      <h2>Coefficienti stimati</h2>
      <p class="small">Previsione del rendimento logaritmico a 30 giorni. Il segno negativo su <code>m30</code> è il
        risultato più netto della verifica: nel mercato delle carte <strong>una corsa recente tende a rientrare</strong>,
        quindi inseguire il trend fa perdere soldi.</p>
      <div class="scroll-x"><table><thead><tr><th>variabile</th><th class="n">coefficiente</th></tr></thead><tbody>${coef}</tbody></table></div>
      <p class="hint">m30 e m90: variazione negli ultimi 30 e 90 giorni · score: punteggio dei fondamentali ·
        fromHigh: distanza dal massimo recente · logPrice: livello di prezzo.</p>
    </div>
    <div class="panel">
      <h2>Da dove vengono i dati</h2>
      <ul class="small">
        <li><strong>Carte e prezzi di oggi:</strong> ${esc(meta.source.cards)} — ${nf0.format(meta.counts.printings)} stampe
          in carta di ${nf0.format(meta.counts.sets)} set, varianti comprese.</li>
        <li><strong>Storico giornaliero:</strong> ${esc(meta.source.history)} — ${nf0.format(meta.counts.withHistory)} stampe,
          ${meta.axis.days} giorni fino al ${esc(meta.today)}.</li>
        <li><strong>Prezzi in diretta:</strong> API di Scryfall, interrogata dall'app per le carte che segui. La fonte
          aggiorna i listini circa una volta al giorno: l'app li ricontrolla ogni ${S.settings.refreshMin} minuti e
          mostra il cambio appena esce.</li>
        <li><strong>Ultima build dei dati:</strong> ${esc(new Date(meta.built).toLocaleString('it-IT'))}.</li>
      </ul>
      <p class="small flat">Previsioni statistiche, non consulenza finanziaria. Ristampe annunciate e ban possono
        dimezzare un prezzo in un giorno: nessun modello li vede arrivare.</p>
    </div>`;
}

function renderAll() {
  if (!D.state.meta) return;
  renderRadar(); renderWatch(); renderPortfolio();
  if ($('#tab-market').classList.contains('active')) renderMarket();
  if ($('#tab-model').classList.contains('active')) renderModel();
}

// ---------------------------------------------------------------- scheda carta
async function openCard(id) {
  const card = D.state.byId.get(id) || await D.fetchCard(id);
  if (!card) return toast('Carta non trovata');
  const dlg = $('#card-dialog');
  let foil = false;
  let series = null;

  const draw = () => {
    const p = D.livePrices(card);
    const f = fc(card, { foil, series, tech: series && series.length ? undefined : statsToTech(statsOf(card)) });
    const q = quote(card, foil);
    const price = q.v;
    const variants = (D.state.byOracle.get(card.oracle) || [card])
      .slice().sort((a, b) => (priceOf(b) ?? 0) - (priceOf(a) ?? 0));
    const last = series?.length ? series[series.length - 1] : null;
    const proj = last && f.expected != null
      ? { at: last[0] + f.horizonDays * DAY, expected: f.expected, low: f.low, high: f.high, days: f.horizonDays } : null;
    const st = statsOf(card);

    $('#card-detail').innerHTML = `
      <button class="close" data-close aria-label="Chiudi">✕</button>
      <div class="detail">
        <div class="art">
          <img src="${D.imageUrl(card.id, 'normal')}" alt="${esc(card.name)}" loading="lazy" onerror="this.style.display='none'">
        </div>
        <div class="body">
          <div>
            <h2>${esc(card.name)}</h2>
            <div class="meta-line">${esc(card.setName)} · #${esc(card.cn)} · ${esc(card.rarity)} · uscita ${esc(card.released)}
              ${card.flags & FLAG.reserved ? '<span class="tag gold">Reserved List</span>' : ''}
              ${card.flags & FLAG.upcoming ? '<span class="tag pre">Preordine</span>' : ''}
              ${card.edhrec ? `<span class="tag">EDHREC #${card.edhrec}</span>` : ''}</div>
          </div>
          <div class="quotes">
            <div><span>Cardmarket</span><b>${money(p.eur, 'eur')}</b><span>foil ${money(p.eur_foil, 'eur')}</span></div>
            <div><span>TCGplayer</span><b>${money(p.usd, 'usd')}</b><span>foil ${money(p.usd_foil, 'usd')}</span></div>
            <div><span>Stampe di questa carta</span><b>${variants.length}</b><span>varianti sul mercato</span></div>
          </div>
          <div class="seg">
            <button data-foil="0" class="${foil ? '' : 'on'}">Normale</button>
            <button data-foil="1" class="${foil ? 'on' : ''}">Foil</button>
          </div>
          <div class="signal-box">
            <div class="row-between">
              <span class="badge big ${f.tone}">${f.signal}</span>
              <span class="hint">${q.exact || q.v == null ? '' : `quotazione ${q.foil ? 'foil ' : ''}${q.currency === 'eur' ? 'Cardmarket' : 'TCGplayer'} · `}affidabilità ${f.confidence}% · orizzonte ${f.horizonDays} giorni</span>
            </div>
            <div class="sgrid">
              <div><span>Prezzo atteso</span><b>${money(f.expected)}</b><span class="${tone(f.drift)}">${pct(f.drift)}</span></div>
              <div><span>Intervallo probabile</span><b>${money(f.low)} – ${money(f.high)}</b><span>±1σ, verificato al ${pct(FIT.quality?.coverage ?? 0.68, false)}</span></div>
              <div><span>Qualità dei fondamentali</span><b>${f.fund.score}/100</b><span>ristampe, domanda, formati</span></div>
              <div><span>Serve per andare in pari</span><b>${pct(f.breakEven)}</b><span>commissioni ${S.settings.feePct}%</span></div>
            </div>
            ${f.notes.length ? `<div class="notes">${f.notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}
          </div>
          <div>${series === null ? '<div class="chart-empty">Carico lo storico reale…</div>' : lineChart(series, { proj })}</div>
          ${st ? `<p class="hint">Storico reale di ${st[5]} giorni · 30 giorni ${pct(st[0])} · 90 giorni ${pct(st[1])} ·
            distanza dal massimo ${pct(st[2])} · volatilità mensile ${pct(st[3], false)}</p>` : ''}
          <div>
            <h3>Perché questo segnale</h3>
            <ul class="factors">${f.fund.factors.slice(0, 8).map(x =>
              `<li class="${x.pts > 0 ? 'up' : x.pts < 0 ? 'down' : ''}"><b>${x.pts > 0 ? '+' : ''}${x.pts}</b> ${esc(x.label)}</li>`).join('')}</ul>
          </div>
          <div class="actions">
            <button data-watch>${S.watch.includes(card.id) ? '★ Seguita' : '☆ Segui'}</button>
            <a class="btn ghost" target="_blank" rel="noopener" href="https://www.cardmarket.com/it/Magic/Products/Search?searchString=${encodeURIComponent(card.name)}">Cardmarket ↗</a>
            <a class="btn ghost" target="_blank" rel="noopener" href="https://scryfall.com/card/${encodeURIComponent(card.set)}/${encodeURIComponent(card.cn)}">Scryfall ↗</a>
          </div>
          <form class="addlot" data-addlot>
            <label>Quantità<input name="qty" type="number" min="1" value="1" required></label>
            <label>Condizione<select name="cond">${Object.keys(COND).map(k =>
              `<option value="${k}"${k === 'NM' ? ' selected' : ''}>${k} · ${COND_LABEL[k]}${COND[k] < 1 ? ` (${Math.round(COND[k] * 100)}%)` : ''}</option>`).join('')}</select></label>
            <label>Prezzo pagato<input name="buy" type="number" min="0" step="0.01" value="${price ?? ''}" required></label>
            <button type="submit">Aggiungi al portafoglio${foil ? ' (foil)' : ''}</button>
          </form>
          <div>
            <h3>Tutte le stampe di ${esc(card.name)}</h3>
            <div class="scroll-x"><table>
              <thead><tr><th>set</th><th>n°</th><th>rarità</th><th class="n">prezzo</th><th class="n">foil</th><th class="n">30g</th><th>segnale</th></tr></thead>
              <tbody>${variants.slice(0, 60).map(v => {
                const vf = fc(v), vs = statsOf(v);
                return `<tr class="pick${v.id === card.id ? ' me' : ''}" data-open="${v.id}">
                  <td>${esc(v.setName)}${v.flags & FLAG.reserved ? ' ★' : ''}</td><td>${esc(v.cn)}</td><td>${esc(v.rarity)}</td>
                  <td class="n">${money(priceOf(v))}</td><td class="n">${money(priceOf(v, true))}</td>
                  <td class="n ${tone(vs?.[0])}">${vs?.[0] == null ? '—' : pct(vs[0])}</td>
                  <td><span class="badge ${vf.tone}">${vf.signal}</span></td></tr>`;
              }).join('')}</tbody></table></div>
            ${variants.length > 60 ? `<p class="hint">Mostrate le 60 stampe più costose di ${variants.length}.</p>` : ''}
          </div>
        </div>
      </div>`;
  };

  const loadSeries = () => {
    const q = quote(card, foil);
    return D.series(card, q.currency, q.foil)
      .then(s => { series = s; draw(); })
      .catch(() => { series = []; draw(); });
  };

  draw();
  if (!dlg.open) dlg.showModal();
  loadSeries();   // lo shard pesa ~70 KB e serve solo per il grafico

  dlg.onclick = e => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const fb = e.target.closest('[data-foil]');
    if (fb) { foil = fb.dataset.foil === '1'; series = null; draw(); loadSeries(); return; }
    if (e.target.closest('[data-refresh-card]')) { D.refresh([card.id]).then(() => draw()); return; }
    if (e.target.closest('[data-watch]')) { toggleWatch(card.id); draw(); return; }
    const open = e.target.closest('[data-open]');
    if (open && open.dataset.open !== card.id) { dlg.close(); openCard(open.dataset.open); }
  };
  dlg.onsubmit = e => {
    if (!e.target.matches('[data-addlot]')) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    S.portfolio.push({ lid: crypto.randomUUID(), id: card.id, qty: Number(fd.get('qty')), buy: Number(fd.get('buy')),
      cond: fd.get('cond'), foil, cur: cur(), date: new Date().toISOString().slice(0, 10) });
    save('portfolio');
    toast(`Aggiunto: ${fd.get('qty')}× ${card.name}`);
    renderAll(); dlg.close();
  };
}

function toggleWatch(id) {
  S.watch = S.watch.includes(id) ? S.watch.filter(x => x !== id) : [...S.watch, id];
  save('watch');
  if (S.watch.includes(id) && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  renderAll();
  refreshTracked({ silent: true });
}

// ---------------------------------------------------------------- aggiornamento in diretta
const tracked = () => [...new Set([...S.watch, ...S.portfolio.map(l => l.id)])];
let refreshing = false;
async function refreshTracked({ silent = false } = {}) {
  const ids = tracked();
  if (!ids.length) { if (!silent) toast('Nessuna carta seguita da aggiornare'); return; }
  if (refreshing) return;
  refreshing = true;
  $('#live').className = 'dot busy';
  try {
    const changed = await D.refresh(ids);
    $('#live').className = 'dot ok';
    $('#live').title = 'Prezzi aggiornati alle ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    for (const ch of changed) {
      const card = D.state.byId.get(ch.id);
      const a = ch.before[cur()], b = ch.after[cur()];
      if (!card || !a || !b) continue;
      const delta = (b - a) / a;
      if (Math.abs(delta) * 100 >= S.settings.alertPct) {
        const msg = `${card.name}: ${money(a)} → ${money(b)} (${pct(delta)})`;
        toast(msg);
        if ('Notification' in window && Notification.permission === 'granted') new Notification('MTG Invest', { body: msg, icon: 'icon.svg' });
      }
    }
    if (!silent) toast(`Prezzi aggiornati: ${ids.length} ${ids.length === 1 ? 'carta' : 'carte'}`);
    renderAll();
  } catch (e) {
    $('#live').className = 'dot err';
    $('#live').title = 'Aggiornamento non riuscito: ' + e.message;
    if (!silent) toast('Aggiornamento non riuscito: ' + e.message);
  } finally { refreshing = false; }
}
let timer;
const schedule = () => {
  clearInterval(timer);
  timer = setInterval(() => refreshTracked({ silent: true }), Math.max(2, S.settings.refreshMin) * 60000);
};

// ---------------------------------------------------------------- eventi
const TABS = ['radar', 'market', 'watch', 'portfolio', 'model'];
function showTab(name) {
  if (!TABS.includes(name)) return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  if (name === 'market') renderMarket();
  if (name === 'model') renderModel();
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
}
document.addEventListener('click', e => {
  const tab = e.target.closest('.tabs [data-tab]');
  if (tab) return showTab(tab.dataset.tab);
  const star = e.target.closest('[data-star]');
  if (star) { e.stopPropagation(); toggleWatch(star.dataset.star); return; }
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); S.portfolio = S.portfolio.filter(l => l.lid !== del.dataset.del); save('portfolio'); renderAll(); return; }
  const open = e.target.closest('[data-open]');
  if (open && !e.target.closest('#card-dialog')) openCard(open.dataset.open);
});

$('#quick-search').addEventListener('submit', e => {
  e.preventDefault();
  $('#filters').elements.q.value = $('#q').value;
  showTab('market');
});
let typeTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => {
    if (!$('#q').value.trim()) return;
    $('#filters').elements.q.value = $('#q').value;
    marketShown = 100;
    if (!$('#tab-market').classList.contains('active')) showTab('market'); else renderMarket();
  }, 220);
});
$('#filters').addEventListener('input', () => { marketShown = 100; renderMarket(); });
$('#filters').addEventListener('submit', e => e.preventDefault());
$('#more').addEventListener('click', () => { marketShown += 100; renderMarket(); });
$('#refresh').addEventListener('click', () => refreshTracked());
$('#currency').addEventListener('change', e => { S.settings.currency = e.target.value; save('settings'); renderAll(); });

const pfForm = $('#pf-settings');
for (const k of ['feePct', 'horizon', 'refreshMin', 'alertPct']) if (pfForm.elements[k]) pfForm.elements[k].value = S.settings[k];
pfForm.addEventListener('submit', e => {
  e.preventDefault();
  for (const [k, v] of new FormData(pfForm)) S.settings[k] = Number(v);
  save('settings'); schedule(); renderAll(); toast('Impostazioni salvate');
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 2, settings: S.settings, watch: S.watch, portfolio: S.portfolio }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mtg-invest-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.watch) || !Array.isArray(d.portfolio)) throw new Error('file non riconosciuto');
    S.watch = d.watch; S.portfolio = d.portfolio; S.settings = { ...DEFAULTS, ...(d.settings || {}) };
    save('watch', 'portfolio', 'settings');
    renderAll(); refreshTracked({ silent: true }); toast('Backup importato');
  } catch (err) { toast('Importazione fallita: ' + err.message); }
});
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Cancellare watchlist, portafoglio e cache dei dati in questo browser?')) return;
  Object.keys(localStorage).filter(k => k.startsWith('mtgi2.')).forEach(k => localStorage.removeItem(k));
  await D.clearCache();
  location.reload();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTracked({ silent: true }); });
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

// ---------------------------------------------------------------- avvio
(async function boot() {
  $('#currency').value = S.settings.currency;
  try {
    await D.load({
      onProgress: (loaded, total, first, done) => {
        $('#load-bar').style.width = Math.round((loaded / total) * 100) + '%';
        $('#load-text').textContent = done ? `${nf0.format(loaded)} stampe pronte` : `${nf0.format(loaded)} di ${nf0.format(total)} stampe…`;
        if (first) { renderAll(); if (location.hash.slice(1)) showTab(location.hash.slice(1)); }
        if (done) { renderAll(); setTimeout(() => { $('#loading').hidden = true; }, 1500); }
      },
    });
  } catch (e) {
    $('#load-text').innerHTML = `Dati non caricati: ${esc(e.message)}. Se stai aprendo il file in locale, ` +
      'servi la cartella con un server (<code>python3 -m http.server</code>).';
    return;
  }
  schedule();
  refreshTracked({ silent: true });
})();
