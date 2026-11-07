# MTG Invest

App web (funziona anche da telefono come app) per **investire nelle carte di Magic: The Gathering**:
prezzi aggiornati automaticamente, watchlist, portafoglio con profitti e perdite al netto delle commissioni,
e **previsioni di mercato** con segnali COMPRA / ACCUMULA / MANTIENI / VENDI.

## ⚠️ Da sapere prima di investire: MTG Arena

Le carte di **MTG Arena non hanno valore monetario**: non si vendono, non si scambiano e non esiste un mercato
secondario (ci sono solo wildcard e gemme). Per guadagnare bisogna operare sul mercato delle **carte fisiche**
(Cardmarket in Europa, TCGplayer negli USA) o su **MTGO** (tix). L'app:

- traccia i prezzi reali di Cardmarket (€), TCGplayer ($) e MTGO (tix);
- indica quali carte sono anche su Arena (filtro «Solo carte presenti su Arena»);
- segna come **NON INVESTIBILE** le carte solo digitali.

## Funzioni

| Sezione | Cosa fa |
|---|---|
| **Dashboard** | Valore del portafoglio, P/L netto, valore previsto, segnali sulle tue carte, scanner con le opportunità del giorno |
| **Mercato** | Ricerca libera (accetta anche la sintassi di Scryfall) + scanner già pronti: Blue chip Commander, Reserved List, Staple Modern/Legacy, Mai ristampate, Uscite recenti, Su Arena e in carta |
| **Scheda carta** | Prezzi su tutti i mercati, normale/foil, grafico dello storico con il "cono" di previsione, segnale spiegato fattore per fattore, rialzo minimo per andare in pari, link per comprare |
| **Watchlist** | Carte seguite con aggiornamento automatico e notifiche se il prezzo si muove oltre la soglia impostata |
| **Portafoglio** | Posizioni con prezzo di carico, P/L, allocazione e avviso di concentrazione, export/import del backup |

## Il modello di previsione (`model.js`)

Trasparente e verificabile, nessuna scatola nera:

1. **Fondamentali (0–100)**: Reserved List (mai ristampabile), ristampe, domanda in Commander (classifica EDHREC),
   formati in cui è legale, ban, rarità, età del set (le uscite recenti tendono a scendere, i set fuori stampa a salire),
   fascia di prezzo (sotto 1 €/$ le commissioni si mangiano il margine).
2. **Tecnica**: regressione sul log-prezzo (trend), volatilità, momentum con medie mobili esponenziali (EMA 5 contro EMA 20),
   correzione per i rialzi troppo rapidi (mean reversion).
3. **Combinazione**: il peso del trend cresce con la lunghezza e la pulizia dello storico; altrimenti decidono i fondamentali.
4. **Segnale**: COMPRA solo se il rialzo atteso supera il **break-even delle commissioni** di almeno il 2%.

> Sono stime statistiche, **non consulenza finanziaria**. Ristampe annunciate e ban possono far crollare un prezzo
> in un giorno. Diversifica e investi solo quello che puoi permetterti di perdere.

## Dati e "tempo reale"

- Fonte: [API di Scryfall](https://scryfall.com/docs/api), gratuita, senza chiave. Scryfall aggiorna i prezzi
  **circa una volta al giorno**: l'app li ricontrolla ogni N minuti (di default 15) e mostra subito ogni variazione.
- Lo **storico** viene salvato nel browser a ogni aggiornamento.
- Per avere uno storico anche quando l'app è chiusa c'è la GitHub Action `.github/workflows/snapshot.yml`:
  ogni giorno salva i prezzi delle carte in `data/watchlist.json` dentro `data/history.json`, e l'app lo carica in automatico.

## Avvio

Non c'è niente da installare: è HTML, CSS e JavaScript puro.

```bash
python3 -m http.server 8000   # poi apri http://localhost:8000
```

### Pubblicarla online (gratis) con GitHub Pages

1. Su GitHub apri il repository: *Settings → Pages → Deploy from a branch* e scegli il branch e la cartella `/ (root)`.
2. Apri l'URL che GitHub ti dà; dal telefono usa «Aggiungi a schermata Home».
3. Storico automatico: nell'app vai su *Watchlist → Esporta per lo storico automatico*, copia l'elenco `ids`
   in `data/watchlist.json` e fai commit. La Action gira ogni giorno (puoi anche lanciarla a mano da *Actions*).

## Test

```bash
node --test tests/*.test.mjs
```
