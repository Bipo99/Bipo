// Motore di previsione: funzioni pure, nessuna dipendenza dal DOM.
// Combina (1) fondamentali della carta e (2) trend dello storico prezzi.
// NON è consulenza finanziaria: è un modello euristico e trasparente.

const DAY = 86400000;

export function linreg(points) {
  // points: [[x, y]] -> { slope, intercept, r2 }
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n ? points[0][1] : 0, r2: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const rden = Math.sqrt(den * (n * syy - sy * sy));
  const r2 = rden === 0 ? 0 : ((n * sxy - sx * sy) / rden) ** 2;
  return { slope, intercept, r2 };
}

export function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

// Analisi tecnica sullo storico: [[timestampMs, price]] ordinati per tempo.
export function technicals(series) {
  const pts = series.filter(([, p]) => p > 0);
  if (pts.length < 3) return null;
  const t0 = pts[0][0];
  const spanDays = (pts[pts.length - 1][0] - t0) / DAY;
  if (spanDays < 2) return null;
  // regressione sul log-prezzo -> rendimento giornaliero composto
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
  const emaFast = ema(prices, 5), emaSlow = ema(prices, 20);
  const first = prices[0], last = prices[prices.length - 1];
  return {
    spanDays, samples: pts.length, dailyDrift, dailyVol, r2: lr.r2,
    changePct: (last - first) / first,
    momentum: emaSlow ? (emaFast - emaSlow) / emaSlow : 0,
    high: Math.max(...prices), low: Math.min(...prices),
  };
}

// Punteggio fondamentale 0-100 a partire dall'oggetto carta di Scryfall.
export function fundamentals(card, price, now = Date.now()) {
  const f = [];
  const add = (pts, label) => f.push({ pts, label });
  const legal = card.legalities || {};
  const games = card.games || [];

  if (!games.includes('paper')) {
    add(-60, 'Non esiste in versione fisica: nessun mercato su cui venderla');
  }
  if (card.reserved) add(22, 'Reserved List: Wizards ha promesso di non ristamparla mai');
  else if (card.reprint) add(-4, 'Già ristampata: il rischio di altre ristampe resta alto');
  else add(4, 'Prima stampa: nessuna ristampa finora');

  const rank = card.edhrec_rank;
  if (rank != null) {
    if (rank <= 500) add(18, `Domanda molto alta in Commander (EDHREC #${rank})`);
    else if (rank <= 2500) add(11, `Buona domanda in Commander (EDHREC #${rank})`);
    else if (rank <= 8000) add(4, `Domanda media in Commander (EDHREC #${rank})`);
    else add(-6, `Domanda bassa (EDHREC #${rank})`);
  }

  const formats = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper'];
  const legalIn = formats.filter(k => legal[k] === 'legal' || legal[k] === 'restricted');
  if (legal.commander === 'legal') add(6, 'Legale in Commander, il formato che muove più soldi');
  if (legal.commander === 'banned') add(-18, 'Bandita in Commander');
  if (legalIn.includes('modern') || legalIn.includes('legacy')) add(5, 'Legale nei formati Eternal/Modern (domanda stabile)');
  if (legal.standard === 'legal') add(-3, 'In Standard: prezzi volatili, crolla quando esce dalla rotazione');
  if (Object.values(legal).filter(v => v === 'banned').length >= 2) add(-6, 'Bandita in più formati');

  if (card.rarity === 'mythic') add(5, 'Rarità mitica (offerta più scarsa)');
  else if (card.rarity === 'rare') add(2, 'Rarità rara');
  else if (card.rarity === 'common' || card.rarity === 'uncommon') add(-6, 'Comune/non comune: grandi tirature');

  if (card.released_at) {
    const ageDays = (now - Date.parse(card.released_at)) / DAY;
    if (ageDays < 0) add(-12, 'Preorder: i prezzi di prevendita di solito scendono dopo l\'uscita');
    else if (ageDays < 60) add(-12, 'Uscita da meno di 60 giorni: fase in cui i prezzi scendono per l\'offerta delle buste');
    else if (ageDays < 180) add(-4, 'Set recente: l\'offerta è ancora alta');
    else if (ageDays > 730) add(5, 'Set di più di 2 anni fa: le buste sono fuori stampa');
  }

  if (price != null) {
    if (price < 1) add(-30, 'Carta da bulk (<1): commissioni e spedizione si mangiano ogni guadagno');
    else if (price < 3) add(-8, 'Prezzo basso: margini erosi dalle commissioni');
    else if (price > 100) add(3, 'Fascia alta: asset più liquido e "blue chip"');
  }

  const score = Math.max(0, Math.min(100, Math.round(50 + f.reduce((a, x) => a + x.pts, 0))));
  return { score, factors: f.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)) };
}

// Previsione a orizzonte H giorni + segnale operativo.
export function forecast({ card, price, series = [], horizonDays = 30, feePct = 0.08, now = Date.now() }) {
  const fund = fundamentals(card, price, now);
  const tech = technicals(series);
  // Fondamentali: +/-10% atteso a 30 giorni ai valori estremi
  const fundDrift30 = ((fund.score - 50) / 50) * 0.10;
  let drift30 = fundDrift30, vol30 = 0.18, weightTech = 0;
  if (tech) {
    // Peso del trend in base a quanta storia abbiamo e a quanto il fit è pulito
    weightTech = Math.min(1, tech.spanDays / 30) * (0.4 + 0.4 * tech.r2);
    const techDrift30 = Math.max(-0.5, Math.min(0.5, (1 + tech.dailyDrift) ** 30 - 1));
    // Mean reversion: chi è salito molto in fretta tende a ritracciare
    const mr = tech.changePct > 0.6 && tech.spanDays < 30 ? -0.08 : 0;
    drift30 = weightTech * techDrift30 + (1 - weightTech) * fundDrift30 + mr;
    if (tech.dailyVol > 0) vol30 = Math.min(0.8, tech.dailyVol * Math.sqrt(30));
  }
  const scale = horizonDays / 30;
  const drift = (1 + drift30) ** scale - 1;
  const vol = vol30 * Math.sqrt(scale);
  const expected = price != null ? price * (1 + drift) : null;
  const lowP = price != null ? price * Math.exp(Math.log(1 + drift) - vol) : null;
  const highP = price != null ? price * Math.exp(Math.log(1 + drift) + vol) : null;
  // Rialzo minimo per andare in pari dopo le commissioni di vendita
  const breakEven = feePct / (1 - feePct);
  const netEdge = drift - breakEven;

  let signal, tone;
  const notInvestable = !(card.games || []).includes('paper') || price == null;
  if (notInvestable) { signal = 'NON INVESTIBILE'; tone = 'muted'; }
  else if (fund.score >= 68 && netEdge > 0.02) { signal = 'COMPRA'; tone = 'up'; }
  else if (fund.score >= 58 && drift > 0) { signal = 'ACCUMULA'; tone = 'up'; }
  else if (drift < -0.06 || fund.score < 35 || price < 1) { signal = 'VENDI / EVITA'; tone = 'down'; }
  else { signal = 'MANTIENI'; tone = 'flat'; }

  const confidence = Math.round(100 * Math.min(0.85, 0.3 + weightTech * 0.5 + (tech ? 0.05 : 0)));
  return { signal, tone, drift, vol, expected, low: lowP, high: highP, breakEven, netEdge,
    fund, tech, confidence, horizonDays };
}
