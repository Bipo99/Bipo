import { forecast } from './model.js';

const API = 'https://api.scryfall.com';
const HOUR = 3600000, DAY = 24 * HOUR;
const COLS = { eur: 1, usd: 2, eur_foil: 3, usd_foil: 4, tix: 5 };

// ---------- storage ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('mtgi.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mtgi.' + k, JSON.stringify(v)); } catch (e) { toast('Spazio locale esaurito: esporta un backup'); } },
};
const DEFAULTS = { currency: 'eur', refreshMin: 15, feePct: 8, horizon: 30, alertPct: 10, noticeDismissed: false };
const S = {
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  watch: LS.get('watch', []),
  cards: LS.get('cards', {}),
  history: LS.get('history', {}),
  portfolio: LS.get('portfolio', []),
  lastUpdate: LS.get('lastUpdate', null),
  remoteHistory: {},
};
const save = (...keys) => keys.forEach(k => LS.set(k, S[k]));

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v == null || v === '' ? null : Number(v));
const nf = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(p, cur = S.settings.currency) {
  if (p == null || isNaN(p)) return '—';
  if (cur === 'usd') return '$' + nf.format(p);
  if (cur === 'tix') return nf.format(p) + ' tix';
  return nf.format(p) + ' €';
}
const pct = (x, sign = true) => (x == null || isNaN(x) ? '—' : (sign && x > 0 ? '+' : '') + (x * 100).toFixed(1).replace('.', ',') + '%');
const toneOf = x => (x > 0.001 ? 'up' : x < -0.001 ? 'down' : 'flat');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- Scryfall API (max ~10 req/s) ----------
let lastCall = 0;
async function api(path, opts = {}) {
  const wait = lastCall + 110 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(API + path, { ...opts, headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) throw new Error(data.details || 'Errore API ' + res.status);
  return data;
}

function slim(c) {
  const face = c.image_uris || c.card_faces?.[0]?.image_uris || {};
  return {
    id: c.id, name: c.name, set: c.set, set_name: c.set_name, cn: c.collector_number, rarity: c.rarity,
    released_at: c.released_at, reserved: c.reserved, reprint: c.reprint, edhrec_rank: c.edhrec_rank,
    legalities: c.legalities, games: c.games, prices: c.prices, type_line: c.type_line || c.card_faces?.[0]?.type_line,
    img: face.normal, thumb: face.small, purchase: c.purchase_uris || {}, uri: c.scryfall_uri, arena_id: c.arena_id,
    oracle_id: c.oracle_id, fetchedAt: Date.now(),
  };
}

function priceOf(card, foil = false, cur = S.settings.currency) {
  const p = card?.prices || {};
  if (cur === 'tix') return num(p.tix);
  const base = num(p[cur]), f = num(p[cur + '_foil']);
  return foil ? (f ?? base) : (base ?? f);
}

// ---------- price history ----------
function snapshot(card) {
  const p = card.prices || {};
  const row = [Date.now(), num(p.eur), num(p.usd), num(p.eur_foil), num(p.usd_foil), num(p.tix)];
  const h = S.history[card.id] || (S.history[card.id] = []);
  const last = h[h.length - 1];
  if (last) {
    const same = row.slice(1).every((v, i) => v === last[i + 1]);
    if (same && row[0] - last[0] < 6 * HOUR) return;
  }
  h.push(row);
  if (h.length > 500) h.splice(0, h.length - 500);
}

function seriesFor(id, foil = false, cur = S.settings.currency) {
  const col = cur === 'tix' ? COLS.tix : COLS[foil ? cur + '_foil' : cur];
  const rows = [...(S.remoteHistory[id] || []), ...(S.history[id] || [])].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of rows) {
    const v = r[col] ?? (foil ? null : r[col + 2]); // fallback foil se manca la non-foil
    if (v == null) continue;
    if (out.length && Math.abs(out[out.length - 1][0] - r[0]) < HOUR) { out[out.length - 1] = [r[0], v]; continue; }
    out.push([r[0], v]);
  }
  return out;
}

async function loadRemoteHistory() {
  // Storico giornaliero salvato dalla GitHub Action (se l'app è su GitHub Pages)
  try {
    const res = await fetch('data/history.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    for (const [id, rows] of Object.entries(data.cards || {})) {
      S.remoteHistory[id] = rows.map(([d, ...v]) => [Date.parse(d), ...v]);
    }
  } catch { /* nessuno storico remoto: va bene */ }
}

function fc(card, foil = false) {
  return forecast({
    card, price: priceOf(card, foil), series: seriesFor(card.id, foil),
    horizonDays: Number(S.settings.horizon), feePct: S.settings.feePct / 100,
  });
}

// ---------- refresh loop ----------
const trackedIds = () => [...new Set([...S.watch, ...S.portfolio.map(l => l.id)])];

async function refresh({ silent = false } = {}) {
  const ids = trackedIds();
  const dot = $('#live-dot');
  dot.className = 'dot busy';
  try {
    for (let i = 0; i < ids.length; i += 75) {
      const chunk = ids.slice(i, i + 75);
      const data = await api('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: chunk.map(id => ({ id })) }) });
      for (const c of data.data || []) {
        const prev = S.cards[c.id];
        const card = slim(c);
        checkAlert(prev, card);
        S.cards[c.id] = card;
        snapshot(card);
      }
    }
    S.lastUpdate = Date.now();
    save('cards', 'history', 'lastUpdate');
    dot.className = 'dot ok';
    if (!silent) toast(ids.length ? `Prezzi aggiornati: ${ids.length} ${ids.length === 1 ? 'carta' : 'carte'}` : 'Nessuna carta seguita: aggiungine una con ★');
  } catch (e) {
    dot.className = 'dot err';
    toast('Aggiornamento non riuscito: ' + e.message);
  }
  renderAll();
}

function checkAlert(prev, card) {
  if (!prev) return;
  const a = priceOf(prev), b = priceOf(card);
  if (!a || !b) return;
  const ch = (b - a) / a;
  if (Math.abs(ch) * 100 >= S.settings.alertPct) {
    const msg = `${card.name}: ${fmt(a)} → ${fmt(b)} (${pct(ch)})`;
    toast('📈 ' + msg);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('MTG Invest', { body: msg, icon: 'icon.svg' });
  }
}

let timer;
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => refresh({ silent: true }), Math.max(5, S.settings.refreshMin) * 60000);
}

// ---------- rendering ----------
function changeSince(id, foil, ms) {
  const s = seriesFor(id, foil);
  if (s.length < 2) return null;
  const last = s[s.length - 1];
  const ref = [...s].reverse().find(([t]) => last[0] - t >= ms) || s[0];
  return ref[1] ? (last[1] - ref[1]) / ref[1] : null;
}

function cardRow(card, { foil = false, extra = '' } = {}) {
  const f = fc(card, foil);
  const price = priceOf(card, foil);
  const ch = changeSince(card.id, foil, 7 * DAY);
  const starred = S.watch.includes(card.id);
  const arena = card.games?.includes('arena') ? '<span class="tag arena">Arena</span>' : '';
  const digital = !card.games?.includes('paper') ? '<span class="tag">solo digitale</span>' : '';
  return `<div class="row" data-action="open" data-id="${card.id}">
    ${card.thumb ? `<img class="thumb" loading="lazy" src="${esc(card.thumb)}" alt="">` : '<div class="thumb"></div>'}
    <div class="info">
      <div class="name">${esc(card.name)} ${foil ? '<span class="tag foil">Foil</span>' : ''}</div>
      <div class="meta">${esc(card.set_name)} · ${esc(card.rarity)} ${arena}${digital}</div>
      ${extra}
    </div>
    <div class="nums">
      <div class="price">${fmt(price)}</div>
      <div class="chg ${toneOf(ch)}">${ch == null ? 'nuovo' : pct(ch) + ' 7g'}</div>
      <span class="badge ${f.tone}">${f.signal}</span>
    </div>
    <button class="star ${starred ? 'on' : ''}" data-action="star" data-id="${card.id}" title="Watchlist" aria-label="Watchlist">★</button>
  </div>`;
}

function kpi(label, value, sub = '', tone = '') {
  return `<div class="kpi"><div class="kl">${label}</div><div class="kv ${tone}">${value}</div><div class="ks">${sub}</div></div>`;
}

function portfolioStats() {
  const cur = S.settings.currency, fee = S.settings.feePct / 100;
  let cost = 0, value = 0, future = 0, other = 0;
  const lots = [];
  for (const l of S.portfolio) {
    const card = S.cards[l.id];
    if (!card) continue;
    if ((l.cur || 'eur') !== cur) { other++; continue; }
    const p = priceOf(card, l.foil) ?? 0;
    const f = fc(card, l.foil);
    cost += l.qty * l.buy; value += l.qty * p; future += l.qty * (f.expected ?? p);
    lots.push({ l, card, p, f, val: l.qty * p, pl: l.qty * (p - l.buy) });
  }
  const net = value * (1 - fee);
  return { cost, value, net, future, pl: net - cost, plPct: cost ? (net - cost) / cost : 0, lots, other };
}

function renderDashboard() {
  const st = portfolioStats();
  const all = trackedIds().map(id => S.cards[id]).filter(Boolean);
  const fcs = all.map(c => ({ c, f: fc(c) }));
  const buys = fcs.filter(x => x.f.tone === 'up').length;
  const sells = fcs.filter(x => x.f.tone === 'down').length;
  $('#kpis').innerHTML =
    kpi('Valore portafoglio', fmt(st.value), `netto commissioni ${fmt(st.net)}`) +
    kpi('Profitto / perdita', fmt(st.pl), pct(st.plPct), toneOf(st.pl)) +
    kpi(`Previsione ${S.settings.horizon}g`, fmt(st.future), st.value ? pct((st.future - st.value) / st.value) : '', toneOf(st.future - st.value)) +
    kpi('Segnali', `<span class="up">${buys}↑</span> <span class="down">${sells}↓</span>`, `${all.length} carte seguite`);
  $('#arena-notice').hidden = S.settings.noticeDismissed;
  const order = { up: 0, down: 1, flat: 2, muted: 3 };
  fcs.sort((a, b) => order[a.f.tone] - order[b.f.tone] || b.f.fund.score - a.f.fund.score);
  $('#dash-signals').innerHTML = fcs.length
    ? fcs.slice(0, 12).map(({ c, f }) => cardRow(c, { extra: `<div class="why">${esc(f.fund.factors[0]?.label || '')}</div>` })).join('')
    : '<p class="muted">Nessuna carta seguita. Vai su <b>Mercato</b>, cerca una carta e premi ★.</p>';
}

function renderWatch() {
  const cards = S.watch.map(id => S.cards[id]).filter(Boolean);
  $('#watch-list').innerHTML = cards.length ? cards.map(c => cardRow(c)).join('')
    : '<p class="muted">La watchlist è vuota.</p>';
}

function renderPortfolio() {
  const st = portfolioStats();
  $('#pf-kpis').innerHTML =
    kpi('Investito', fmt(st.cost)) +
    kpi('Valore di mercato', fmt(st.value), `netto ${fmt(st.net)}`) +
    kpi('P/L netto', fmt(st.pl), pct(st.plPct), toneOf(st.pl)) +
    kpi(`Atteso a ${S.settings.horizon}g`, fmt(st.future), st.value ? pct((st.future - st.value) / st.value) : '', toneOf(st.future - st.value));
  const total = st.value || 1;
  const colors = ['#7c5cff', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#a3e635', '#ec4899', '#94a3b8'];
  const sorted = [...st.lots].sort((a, b) => b.val - a.val);
  $('#pf-alloc').innerHTML = sorted.length ? `<div class="alloc">${sorted.map((x, i) =>
    `<span style="width:${(x.val / total) * 100}%;background:${colors[i % colors.length]}" title="${esc(x.card.name)} ${pct(x.val / total, false)}"></span>`).join('')}</div>
    <div class="legend">${sorted.slice(0, 8).map((x, i) => `<span><i style="background:${colors[i]}"></i>${esc(x.card.name)} ${pct(x.val / total, false)}</span>`).join('')}</div>
    ${sorted[0] && sorted[0].val / total > 0.4 ? '<p class="warn small">⚠ Più del 40% del portafoglio è in una sola carta: una ristampa annunciata può costarti cara. Diversifica.</p>' : ''}` : '';
  $('#pf-list').innerHTML = st.lots.length ? st.lots.map(({ l, card, p, pl }) => cardRow(card, {
    foil: l.foil,
    extra: `<div class="lot">${l.qty}× a ${fmt(l.buy)} · P/L <b class="${toneOf(pl)}">${fmt(pl)}</b>
      <button class="link" data-action="remove-lot" data-lid="${l.lid}">rimuovi</button></div>`,
  })).join('') : '<p class="muted">Nessuna posizione aperta.</p>';
  if (st.other) $('#pf-list').insertAdjacentHTML('beforeend', `<p class="muted small">${st.other} posizioni registrate in un'altra valuta non sono incluse: cambia valuta nelle impostazioni per vederle.</p>`);
}

function renderStatus() {
  $('#last-update').textContent = S.lastUpdate
    ? 'Aggiornato ' + new Date(S.lastUpdate).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : 'In attesa';
}

function renderAll() { renderStatus(); renderDashboard(); renderWatch(); renderPortfolio(); }

// ---------- chart ----------
function chartSVG(series, f) {
  const W = 640, H = 220, P = { l: 52, r: 12, t: 12, b: 26 };
  if (series.length < 2) {
    return `<div class="chart-empty">Lo storico si costruisce da adesso: ogni aggiornamento aggiunge un punto.
      Aggiungi la carta alla watchlist perché venga tracciata anche in futuro.</div>`;
  }
  const t0 = series[0][0], tLast = series[series.length - 1][0];
  const tEnd = tLast + f.horizonDays * DAY;
  const vals = series.map(s => s[1]).concat([f.low, f.high].filter(v => v != null));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { hi += 1; lo = Math.max(0, lo - 1); }
  const x = t => P.l + ((t - t0) / (tEnd - t0)) * (W - P.l - P.r);
  const y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = series.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = series[series.length - 1];
  const cone = f.expected != null
    ? `<path d="M${x(tLast)},${y(last[1])} L${x(tEnd)},${y(f.high)} L${x(tEnd)},${y(f.low)} Z" class="cone"/>
       <path d="M${x(tLast)},${y(last[1])} L${x(tEnd)},${y(f.expected)}" class="proj"/>` : '';
  const ticks = [lo, (lo + hi) / 2, hi].map(v => `<text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${nf.format(v)}</text>
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('');
  const d = t => new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Storico prezzi e previsione">
    ${ticks}${cone}<path d="${line}" class="line"/>
    <circle cx="${x(tLast)}" cy="${y(last[1])}" r="3.5" class="pt"/>
    <text x="${P.l}" y="${H - 6}">${d(t0)}</text>
    <text x="${x(tLast)}" y="${H - 6}" text-anchor="middle">oggi</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end">+${f.horizonDays}g</text></svg>`;
}

// ---------- detail dialog ----------
async function openCard(id) {
  let card = S.cards[id] || searchCache[id];
  const dlg = $('#card-dialog');
  if (!card || Date.now() - (card.fetchedAt || 0) > HOUR) {
    try { card = slim(await api('/cards/' + id)); } catch (e) { if (!card) return toast(e.message); }
  }
  searchCache[id] = card;
  if (S.cards[id]) { S.cards[id] = card; snapshot(card); save('cards', 'history'); }
  let foil = false;
  const draw = () => {
    const f = fc(card, foil);
    const p = card.prices || {};
    const series = seriesFor(card.id, foil);
    const starred = S.watch.includes(card.id);
    const t = f.tech;
    $('#card-detail').innerHTML = `
      <button class="close" data-close aria-label="Chiudi">✕</button>
      <div class="detail">
        <div class="dimg">${card.img ? `<img src="${esc(card.img)}" alt="${esc(card.name)}">` : ''}</div>
        <div class="dbody">
          <h2>${esc(card.name)}</h2>
          <div class="meta">${esc(card.type_line)} · ${esc(card.set_name)} #${esc(card.cn)} · ${esc(card.rarity)}
            ${card.reserved ? '<span class="tag gold">Reserved List</span>' : ''}
            ${card.games?.includes('arena') ? '<span class="tag arena">Arena</span>' : ''}</div>
          <div class="prices">
            <div><span>Cardmarket</span><b>${fmt(num(p.eur), 'eur')}</b><small>foil ${fmt(num(p.eur_foil), 'eur')}</small></div>
            <div><span>TCGplayer</span><b>${fmt(num(p.usd), 'usd')}</b><small>foil ${fmt(num(p.usd_foil), 'usd')}</small></div>
            <div><span>MTGO</span><b>${fmt(num(p.tix), 'tix')}</b><small>Cardhoarder</small></div>
          </div>
          <div class="seg"><button class="${!foil ? 'on' : ''}" data-foil="0">Normale</button><button class="${foil ? 'on' : ''}" data-foil="1">Foil</button></div>
          <div class="signal ${f.tone}">
            <div><span class="badge ${f.tone} big">${f.signal}</span></div>
            <div class="sgrid">
              <div><span>Prezzo atteso a ${f.horizonDays}g</span><b>${fmt(f.expected)}</b><small class="${toneOf(f.drift)}">${pct(f.drift)}</small></div>
              <div><span>Intervallo probabile</span><b>${fmt(f.low)} – ${fmt(f.high)}</b><small>±1σ</small></div>
              <div><span>Punteggio fondamentali</span><b>${f.fund.score}/100</b><small>affidabilità ${f.confidence}%</small></div>
              <div><span>Rialzo minimo per andare in pari</span><b>${pct(f.breakEven)}</b><small>commissioni ${S.settings.feePct}%</small></div>
            </div>
          </div>
          ${chartSVG(series, f)}
          ${t ? `<div class="tech small muted">Storico ${Math.round(t.spanDays)} giorni (${t.samples} punti) · trend ${pct(t.dailyDrift * 30)}/mese ·
            volatilità ${pct(t.dailyVol * Math.sqrt(30), false)}/mese · min ${fmt(t.low)} · max ${fmt(t.high)}</div>` : ''}
          <h3>Perché questo segnale</h3>
          <ul class="factors">${f.fund.factors.map(x => `<li class="${x.pts > 0 ? 'up' : x.pts < 0 ? 'down' : ''}"><b>${x.pts > 0 ? '+' : ''}${x.pts}</b> ${esc(x.label)}</li>`).join('')}
            ${t ? `<li><b>${pct(t.momentum)}</b> Momentum (media mobile esponenziale breve contro lunga)</li>` : ''}</ul>
          <div class="actions">
            <button data-act="watch">${starred ? '★ In watchlist' : '☆ Aggiungi alla watchlist'}</button>
            ${card.purchase.cardmarket ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(card.purchase.cardmarket)}">Cardmarket ↗</a>` : ''}
            ${card.purchase.tcgplayer ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(card.purchase.tcgplayer)}">TCGplayer ↗</a>` : ''}
            <a class="btn ghost" target="_blank" rel="noopener" href="${esc(card.uri)}">Scryfall ↗</a>
          </div>
          <form class="addlot" data-addlot>
            <h3>Aggiungi al portafoglio</h3>
            <label>Quantità <input name="qty" type="number" min="1" value="1" required></label>
            <label>Prezzo di acquisto (${S.settings.currency.toUpperCase()}) <input name="buy" type="number" min="0" step="0.01" value="${priceOf(card, foil) ?? ''}" required></label>
            <button type="submit">Aggiungi ${foil ? '(foil)' : ''}</button>
          </form>
        </div>
      </div>`;
  };
  draw();
  dlg.onclick = e => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const fb = e.target.closest('[data-foil]');
    if (fb) { foil = fb.dataset.foil === '1'; draw(); }
    if (e.target.closest('[data-act="watch"]')) { toggleWatch(card); draw(); }
  };
  dlg.onsubmit = e => {
    if (!e.target.matches('[data-addlot]')) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    S.portfolio.push({ lid: crypto.randomUUID(), id: card.id, qty: Number(fd.get('qty')), buy: Number(fd.get('buy')),
      foil, cur: S.settings.currency, date: new Date().toISOString() });
    S.cards[card.id] = card; snapshot(card);
    save('portfolio', 'cards', 'history');
    toast(`Aggiunto: ${fd.get('qty')}× ${card.name}`);
    renderAll(); dlg.close();
  };
  if (!dlg.open) dlg.showModal();
}

function toggleWatch(card) {
  if (S.watch.includes(card.id)) S.watch = S.watch.filter(x => x !== card.id);
  else {
    S.watch.push(card.id); S.cards[card.id] = card; snapshot(card);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  save('watch', 'cards', 'history');
  renderAll();
}

// ---------- market / scanner ----------
const searchCache = {};
const pkey = () => (S.settings.currency === 'tix' ? 'tix' : S.settings.currency);
const PRESETS = [
  { name: 'Blue chip Commander', q: p => `f:commander ${p}>=10 game:paper`, order: 'edhrec' },
  { name: 'Reserved List', q: p => `is:reserved ${p}>=1`, order: 'edhrec' },
  { name: 'Staple Modern/Legacy', q: p => `(f:modern or f:legacy) -f:standard ${p}>=5`, order: 'edhrec' },
  { name: 'Mai ristampate', q: p => `not:reprint -is:reserved f:commander ${p}>=5 date<${isoDaysAgo(365)}`, order: 'edhrec' },
  { name: 'Uscite recenti (rischio calo)', q: p => `date>=${isoDaysAgo(60)} ${p}>=3 game:paper`, order: pkey() },
  { name: 'Su Arena e in carta', q: p => `game:arena game:paper ${p}>=3`, order: 'edhrec' },
];
function isoDaysAgo(n) { return new Date(Date.now() - n * DAY).toISOString().slice(0, 10); }

async function search(q, order = 'edhrec') {
  const unique = /\bunique:/.test(q) ? '' : '&unique=cards';
  const data = await api(`/cards/search?order=${order}${unique}&q=${encodeURIComponent(q)}`);
  if (data.object === 'error') return [];
  return (data.data || []).map(c => (searchCache[c.id] = slim(c)));
}

async function runMarket(q, order) {
  const box = $('#market-results');
  box.innerHTML = '<p class="muted">Ricerca…</p>';
  try {
    const cards = await search(q, order);
    box.innerHTML = cards.length ? cards.slice(0, 60).map(c => cardRow(c)).join('') : '<p class="muted">Nessun risultato.</p>';
  } catch (e) { box.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

async function scanOpportunities() {
  const box = $('#dash-opps');
  const cached = LS.get('opps', null);
  let cards;
  if (cached && Date.now() - cached.t < 6 * HOUR && cached.cur === S.settings.currency) cards = cached.cards;
  else {
    try {
      const p = pkey();
      const [a, b] = [await search(`f:commander ${p}>=3 ${p}<=150 game:paper date<${isoDaysAgo(180)}`, 'edhrec'),
        await search(`(is:reserved or not:reprint) ${p}>=5 game:paper date<${isoDaysAgo(365)}`, 'edhrec')];
      const seen = new Set();
      cards = [...a, ...b].filter(c => !seen.has(c.oracle_id) && seen.add(c.oracle_id));
      LS.set('opps', { t: Date.now(), cur: S.settings.currency, cards });
    } catch (e) { box.innerHTML = `<p class="down">Scanner non disponibile: ${esc(e.message)}</p>`; return; }
  }
  cards.forEach(c => (searchCache[c.id] = c));
  const ranked = cards.map(c => S.cards[c.id] || c).map(c => ({ c, f: fc(c) })).filter(x => x.f.tone === 'up')
    .sort((x, y) => y.f.fund.score - x.f.fund.score || y.f.netEdge - x.f.netEdge).slice(0, 10);
  box.innerHTML = ranked.length ? ranked.map(({ c, f }) => cardRow(c, {
    extra: `<div class="why">Punteggio ${f.fund.score}/100 · atteso ${pct(f.drift)} a ${f.horizonDays}g</div>` })).join('')
    : '<p class="muted">Nessuna opportunità forte oggi: anche non comprare è una scelta da investitore.</p>';
}

// ---------- events ----------
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === tab));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab.dataset.tab));
    return;
  }
  const star = e.target.closest('[data-action="star"]');
  if (star) { e.stopPropagation(); const c = S.cards[star.dataset.id] || searchCache[star.dataset.id]; if (c) { toggleWatch(c); star.classList.toggle('on'); } return; }
  const rm = e.target.closest('[data-action="remove-lot"]');
  if (rm) { e.stopPropagation(); if (confirm('Rimuovere questa posizione?')) { S.portfolio = S.portfolio.filter(l => l.lid !== rm.dataset.lid); save('portfolio'); renderAll(); } return; }
  const row = e.target.closest('[data-action="open"]');
  if (row && !e.target.closest('#card-dialog')) openCard(row.dataset.id);
});

$('#search-form').addEventListener('submit', e => {
  e.preventDefault();
  let q = $('#search-q').value.trim();
  if (!q) return;
  if ($('#only-arena').checked) q += ' game:arena';
  runMarket(q, 'edhrec');
});
$('#presets').innerHTML = PRESETS.map((p, i) => `<button class="chip" data-preset="${i}">${p.name}</button>`).join('');
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const p = PRESETS[b.dataset.preset];
  runMarket(p.q(pkey()) + ($('#only-arena').checked ? ' game:arena' : ''), p.order);
});

$('#refresh-btn').addEventListener('click', () => refresh());
$('#dismiss-notice').addEventListener('click', () => { S.settings.noticeDismissed = true; save('settings'); renderDashboard(); });

const sf = $('#settings-form');
for (const [k, v] of Object.entries(S.settings)) if (sf.elements[k]) sf.elements[k].value = v;
sf.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(sf);
  const prevCur = S.settings.currency;
  for (const [k, v] of fd) S.settings[k] = k === 'currency' ? v : Number(v);
  save('settings'); schedule(); renderAll();
  if (prevCur !== S.settings.currency) scanOpportunities();
  toast('Impostazioni salvate');
});
sf.insertAdjacentHTML('beforeend', '<button type="button" class="ghost" id="notif-btn">Attiva le notifiche sui prezzi</button>');
$('#notif-btn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Questo browser non supporta le notifiche');
  toast((await Notification.requestPermission()) === 'granted' ? 'Notifiche attive' : 'Notifiche negate');
});

function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#export-watch').addEventListener('click', () => download('watchlist.json',
  { ids: trackedIds(), names: Object.fromEntries(trackedIds().map(id => [id, S.cards[id]?.name])) }));
$('#export-pf').addEventListener('click', () => download(`mtg-invest-backup-${isoDaysAgo(0)}.json`,
  { version: 1, settings: S.settings, watch: S.watch, portfolio: S.portfolio, cards: S.cards, history: S.history }));
$('#import-pf').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.portfolio) || !Array.isArray(d.watch)) throw new Error('file non valido');
    Object.assign(S, { watch: d.watch, portfolio: d.portfolio, cards: d.cards || {}, history: d.history || {} });
    S.settings = { ...DEFAULTS, ...(d.settings || {}) };
    save('watch', 'portfolio', 'cards', 'history', 'settings');
    toast('Backup importato'); refresh({ silent: true });
  } catch (err) { toast('Importazione fallita: ' + err.message); }
});
$('#wipe').addEventListener('click', () => {
  if (!confirm('Cancellare watchlist, portafoglio e storico salvati in questo browser?')) return;
  Object.keys(localStorage).filter(k => k.startsWith('mtgi.')).forEach(k => localStorage.removeItem(k));
  location.reload();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - (S.lastUpdate || 0) > S.settings.refreshMin * 60000) refresh({ silent: true });
});

// ---------- boot ----------
(async function boot() {
  renderAll();
  await loadRemoteHistory();
  renderAll();
  schedule();
  if (trackedIds().length) refresh({ silent: true }); else $('#live-dot').className = 'dot ok';
  scanOpportunities();
})();
