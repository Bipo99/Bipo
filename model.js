// Motore di previsione — funzioni pure, nessuna dipendenza dal DOM o dalla rete.
// Lo usano sia l'app nel browser sia gli script di backtest in Node, così il numero
// che vedi nell'app è esattamente quello che è stato misurato sui dati storici.
//
// NON è consulenza finanziaria: è un modello statistico dichiarato, con i suoi limiti.

export const DAY = 86400000;

// Bit dei flag, identici a quelli scritti da scripts/build-data.mjs.
export const FLAG = { reserved: 1, reprint: 2, promo: 4, foilOnly: 8, upcoming: 16, history: 32, etched: 64 };
export const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];
export const isLegal = (card, fmt) => !!(card.legal & (1 << FORMATS.indexOf(fmt)));
export const isBanned = (card, fmt) => !!(card.banned & (1 << FORMATS.indexOf(fmt)));
export const has = (card, flag) => !!(card.flags & flag);

// Coefficienti STIMATI sui dati reali da scripts/backtest.mjs (minimi quadrati, validati
// out-of-sample su carte mai usate per la stima). Vengono riscritti dallo script: non
// toccarli a mano. Il segno negativo su m30/m90 è il ritorno verso la media: nel mercato
// delle carte una corsa recente tende a rientrare, non a continuare.
export const FIT = /* FIT-START */{
  bias: 0.0094068778365762,
  "m30": -0.24083792973291626,
  "m90": 0,
  score: 0.04265982150574312,
  fromHigh: 0.12273994537165263,
  logPrice: -0.02618989645343523,
  volScale: 1,
  maxDrift: 0.35,
  minHistoryDays: 14,
  quality: {
    mae: 0.08752846694752993,
    skill: 0.004892650425034728,
    direction: 0.5345893719806764,
    coverage: 0.7062941357077065,
    samples: 16285,
    cards: 8350,
    horizon: 30,
    beatsNaive: true
  }
}/* FIT-END */;
export const CALIB = FIT; // nome storico, stesso oggetto

// ---------------------------------------------------------------- statistica di base
export function linreg(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n ? points[0][1] : 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  // Con una serie piatta n*syy - sy² vale zero a meno dell'errore di arrotondamento, che può
  // renderlo negativo: senza questo clamp la radice darebbe NaN e l'errore si propagherebbe.
  const vy = Math.max(0, n * syy - sy * sy);
  const rden = Math.sqrt(den * vy);
  const r2 = rden > 0 ? ((n * sxy - sx * sy) / rden) ** 2 : 0;
  return { slope, intercept: (sy - slope * sx) / n, r2: Number.isFinite(r2) ? r2 : 0 };
}

export function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

// ---------------------------------------------------------------- analisi del prezzo
// series: [[timestampMs, prezzo]] in ordine di tempo.
export function technicals(series) {
  const pts = series.filter(([, p]) => p > 0);
  if (pts.length < 5) return null;
  const t0 = pts[0][0];
  const spanDays = (pts[pts.length - 1][0] - t0) / DAY;
  if (spanDays < CALIB.minHistoryDays) return null;

  const lr = linreg(pts.map(([t, p]) => [(t - t0) / DAY, Math.log(p)]));
  const dailyDrift = Math.exp(lr.slope) - 1;

  const rets = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = Math.max((pts[i][0] - pts[i - 1][0]) / DAY, 1 / 24);
    rets.push(Math.log(pts[i][1] / pts[i - 1][1]) / Math.sqrt(dt));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const dailyVol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(rets.length - 1, 1));

  const prices = pts.map(([, p]) => p);
  const last = median(prices.slice(-3)) ?? prices[prices.length - 1];
  const tLast = pts[pts.length - 1][0];
  // Prezzo "robusto" a N giorni fa: mediana di 3 rilevazioni attorno a quella data,
  // così un singolo listino sbagliato non falsa la variazione.
  const at = n => {
    const target = tLast - n * DAY;
    let k = -1, best = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i][0] - target); if (d < best) { best = d; k = i; } }
    if (k < 0 || best > 6 * DAY) return null;
    return median(prices.slice(Math.max(0, k - 1), k + 2));
  };
  const high = Math.max(...prices), low = Math.min(...prices);
  const emaFast = ema(prices, 5), emaSlow = ema(prices, 20);
  const ch = n => { const p0 = at(n); return p0 > 0 ? (last - p0) / p0 : null; };

  return {
    spanDays, samples: pts.length, dailyDrift, dailyVol, r2: lr.r2, last,
    momentum: emaSlow ? (emaFast - emaSlow) / emaSlow : 0,
    high, low, fromHigh: high > 0 ? (last - high) / high : 0,
    ch7: ch(7), ch30: ch(30), ch90: ch(90),
    // quota di giorni effettivamente quotati: una serie piena indica un mercato liquido
    coverage: Math.min(1, pts.length / Math.max(1, spanDays)),
  };
}

// Ricostruisce l'essenziale di `technicals` dalle statistiche precalcolate nell'indice:
// l'app può così valutare tutte le carte senza scaricare lo storico completo.
export function statsToTech(stats) {
  if (!stats || !stats.length) return null;
  const [ch30, ch90, fromHigh, vol30, coverage, spanDays] = stats;
  if (spanDays == null || spanDays < CALIB.minHistoryDays) return null;
  return {
    approx: true, spanDays, samples: Math.round((coverage || 0) * spanDays),
    coverage: coverage ?? 1, dailyVol: vol30 != null ? vol30 / Math.sqrt(30) : 0,
    ch7: null, ch30: ch30 ?? null, ch90: ch90 ?? null, fromHigh: fromHigh ?? 0,
    dailyDrift: 0, r2: 0, momentum: 0, last: null, high: null, low: null,
  };
}

// ---------------------------------------------------------------- fondamentali
// Punteggio 0-100 costruito da fattori espliciti: ognuno è mostrato all'utente.
export function fundamentals(card, price, now = Date.now()) {
  const f = [];
  const add = (pts, label) => f.push({ pts, label });

  if (has(card, FLAG.reserved)) add(20, 'Reserved List: Wizards si è impegnata a non ristamparla mai');
  else if (has(card, FLAG.reprint)) add(-5, 'Già ristampata: il rischio di altre ristampe resta alto');
  else add(5, 'Mai ristampata finora');

  const rank = card.edhrec || 0;
  if (rank > 0) {
    if (rank <= 300) add(18, `Domanda altissima in Commander (EDHREC #${rank})`);
    else if (rank <= 1500) add(12, `Domanda alta in Commander (EDHREC #${rank})`);
    else if (rank <= 5000) add(5, `Domanda media in Commander (EDHREC #${rank})`);
    else if (rank <= 15000) add(-3, `Domanda modesta (EDHREC #${rank})`);
    else add(-8, `Poco giocata (EDHREC #${rank})`);
  } else add(-5, 'Nessun dato di gioco su EDHREC');

  if (isLegal(card, 'commander')) add(6, 'Legale in Commander, il formato che muove più mercato');
  if (isBanned(card, 'commander')) add(-16, 'Bandita in Commander: la domanda crolla');
  if (isLegal(card, 'modern') || isLegal(card, 'legacy')) add(5, 'Legale nei formati eterni: domanda stabile nel tempo');
  if (isLegal(card, 'standard')) add(-4, 'In Standard: prezzo gonfiato, scende alla rotazione');
  const bans = FORMATS.filter(x => isBanned(card, x)).length;
  if (bans >= 3) add(-6, `Bandita in ${bans} formati`);

  if (card.rarity === 'mythic') add(5, 'Mitica: tirature basse');
  else if (card.rarity === 'rare') add(2, 'Rara');
  else if (card.rarity === 'common' || card.rarity === 'uncommon') add(-5, 'Comune o non comune: tirature molto alte');

  if (has(card, FLAG.foilOnly)) add(3, 'Esiste solo in foil: offerta più scarsa');
  if (has(card, FLAG.promo)) add(-2, 'Stampa promozionale: mercato più sottile e irregolare');

  const released = card.released ? Date.parse(card.released) : null;
  if (released != null) {
    const age = (now - released) / DAY;
    if (age < 0) add(-14, 'In preordine: i prezzi di prevendita quasi sempre scendono dopo l\'uscita');
    else if (age < 60) add(-12, 'Uscita da meno di due mesi: le buste aperte stanno ancora aumentando l\'offerta');
    else if (age < 180) add(-5, 'Set recente: offerta ancora in crescita');
    else if (age > 365 * 10) add(6, 'Carta con più di 10 anni: offerta in carta che si consuma nel tempo');
    else if (age > 365 * 2) add(4, 'Set fuori stampa da oltre due anni');
  }

  if (price != null) {
    if (price < 1) add(-28, 'Sotto 1: commissioni e spedizione si mangiano qualsiasi guadagno');
    else if (price < 3) add(-9, 'Prezzo basso: margini erosi dai costi fissi di vendita');
    else if (price > 150) add(3, 'Fascia alta: asset più liquido, ma serve più capitale');
  }

  const score = Math.max(0, Math.min(100, Math.round(50 + f.reduce((a, x) => a + x.pts, 0))));
  return { score, factors: f.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)) };
}

// ---------------------------------------------------------------- previsione
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// Le variabili su cui il modello è stimato. Le usano identiche il backtest e l'app.
export function features(card, price, tech, fund) {
  return {
    m30: tech?.ch30 != null ? clamp(Math.log1p(tech.ch30), 0.5) : 0,
    m90: tech?.ch90 != null ? clamp(Math.log1p(tech.ch90), 0.7) : 0,
    score: (fund.score - 50) / 50,
    fromHigh: tech ? clamp(tech.fromHigh, 0.8) : 0,
    logPrice: price > 0 ? clamp(Math.log(price) / 5, 1) : 0,
  };
}

export function forecast({ card, price, series = null, tech: techIn = null, horizonDays = 30,
                           feePct = 0.08, now = Date.now(), fit = FIT }) {
  const fund = fundamentals(card, price, now);
  // `tech` può arrivare già pronto (statistiche dell'indice) oppure essere calcolato dalla serie.
  const tech = techIn ?? (series && series.length ? technicals(series) : null);
  const x = features(card, price, tech, fund);
  const notes = [];

  // Previsione = combinazione lineare stimata sui dati reali (rendimento logaritmico a 30 giorni).
  let driftLog = fit.bias + fit.m30 * x.m30 + fit.m90 * x.m90 + fit.score * x.score +
                 fit.fromHigh * x.fromHigh + fit.logPrice * x.logPrice;
  if (!tech) { driftLog = fit.bias + fit.score * x.score; notes.push('Storico troppo corto: pesano solo i fondamentali'); }
  driftLog = clamp(Number.isFinite(driftLog) ? driftLog : 0, fit.maxDrift);

  if (tech && tech.ch30 > 0.5) notes.push('Salita molto rapida nell\'ultimo mese: storicamente una parte rientra');
  if (tech && tech.ch30 < -0.4 && fund.score >= 60) notes.push('Forte calo su una carta solida: possibile rimbalzo');
  if (has(card, FLAG.upcoming)) notes.push('Carta in preordine: il prezzo di prevendita è il meno affidabile di tutti');

  let vol30 = tech && tech.dailyVol > 0 ? Math.min(0.9, tech.dailyVol * Math.sqrt(30) * fit.volScale) : 0.18;
  if (!Number.isFinite(vol30) || vol30 <= 0) vol30 = 0.18;
  const wTech = tech ? Math.min(1, tech.spanDays / 45) * tech.coverage : 0;

  const scale = horizonDays / 30;
  const drift = Math.exp(driftLog * scale) - 1;
  const vol = vol30 * Math.sqrt(scale);
  const expected = price != null ? price * (1 + drift) : null;
  const low = price != null ? price * Math.exp(Math.log(1 + drift) - vol) : null;
  const high = price != null ? price * Math.exp(Math.log(1 + drift) + vol) : null;

  const breakEven = feePct / (1 - feePct);   // rialzo minimo per chiudere in pari dopo le commissioni
  const netEdge = drift - breakEven;

  let signal, tone;
  if (price == null) { signal = 'SENZA PREZZO'; tone = 'muted'; }
  else if (price < 1) { signal = 'NON INVESTIBILE'; tone = 'muted'; }
  else if (fund.score >= 65 && netEdge > 0.02) { signal = 'COMPRA'; tone = 'up'; }
  else if (fund.score >= 55 && netEdge > -0.01) { signal = 'ACCUMULA'; tone = 'up'; }
  else if (drift < -0.05 || fund.score < 35) { signal = 'VENDI / EVITA'; tone = 'down'; }
  else { signal = 'MANTIENI'; tone = 'flat'; }

  const confidence = Math.round(100 * Math.min(0.8, 0.25 + wTech * 0.55));
  return { signal, tone, drift, vol, expected, low, high, breakEven, netEdge, fund, tech, notes,
           confidence, horizonDays, wTech, features: x };
}
