# MTG Invest

Strumento di analisi per chi investe in **carte fisiche di Magic: The Gathering**.
Copre **tutte le stampe in carta**, varianti e preordini compresi, con prezzi reali, storico reale
e un modello di previsione i cui coefficienti sono **stimati sui dati e verificati fuori campione**.

Nessuna carta digitale: Arena e MTGO sono esclusi, perché lì non esiste un mercato in denaro.

## Che cosa c'è dentro

| Sezione | Cosa fa |
|---|---|
| **Radar** | Indice del mercato a 90 giorni, carte in maggiore salita e discesa, occasioni secondo il modello, preordini e uscite recenti |
| **Mercato** | Ricerca e filtri su tutte le stampe (prezzo, rarità, Reserved List, preordini, Commander), ordinabili anche per previsione netta |
| **Scheda carta** | Prezzi Cardmarket ed eBay/TCGplayer, grafico dello storico reale con cono di previsione, fattori del segnale uno per uno, **tutte le stampe della stessa carta** a confronto |
| **Watchlist** | Carte seguite, prezzi ricontrollati in continuo e notifica quando una si muove oltre la soglia |
| **Portafoglio** | Posizioni con quantità, **condizione** (MT/NM/EX/GD/LP/PL/PO) e prezzo di carico, P/L al netto delle commissioni, allocazione e avviso di concentrazione |
| **Modello** | Il rapporto di verifica completo: quanto il modello ci prende, dove sbaglia, e quanto hanno reso davvero le sue previsioni |

## I dati sono reali

| Cosa | Fonte | Dimensione |
|---|---|---|
| Carte e prezzi di oggi | [Scryfall](https://scryfall.com/docs/api) (bulk `default_cards`) | ~103.500 stampe in carta, ~894 set |
| Storico giornaliero dei prezzi | [MTGJSON](https://mtgjson.com) (`AllPrices`) | ~100.800 stampe, 100 giorni |
| Prezzi in diretta | API di Scryfall, dal browser | solo le carte che segui |

L'indice completo viene scaricato a parti (la prima rende l'app subito utilizzabile) e tenuto in
cache nel browser; lo storico è diviso in 256 blocchi e si scarica solo quello della carta aperta.
Risultato: avvio in meno di un secondo e ricerca fra 103.000 stampe in circa 10 millisecondi.

**Aggiornamento continuo.** Scryfall e MTGJSON rinfrescano i listini all'incirca una volta al
giorno. La GitHub Action ricostruisce i dati **ogni 6 ore** e ripubblica il sito, così ogni
variazione entra poche ore dopo che esce; l'app, mentre è aperta, ricontrolla da sola i prezzi
delle carte che segui ogni 10 minuti e quando torni sulla scheda.

## Il modello, e quanto vale davvero

`scripts/backtest.mjs` stima il modello e lo verifica col metodo walk-forward: a ogni data usa
**solo il passato**, prevede a 30 giorni e confronta con quello che è successo. La stima avviene su
metà delle carte, la verifica sull'altra metà, **mai usata per stimarlo**.

Risultati dell'ultima verifica (~16.000 casi fuori campione):

| modello | errore medio | meglio del «non cambia» | direzione giusta |
|---|---|---|---|
| non cambia niente | 8,8% | — | — |
| segui il trend | 13,6% | −54,1% | 43,8% |
| solo fondamentali | 9,5% | −8,4% | 48,8% |
| **modello stimato** | **8,8%** | **+0,5%** | **53,5%** |

E, soprattutto, quanto hanno reso davvero le sue previsioni a 30 giorni:

| previsione | resa media reale | casi |
|---|---|---|
| in salita | **+9,6%** | 511 |
| stabile | +1,0% | 14.553 |
| in calo | **−5,0%** | 1.221 |

Due cose vanno dette con chiarezza:

1. **Il mercato delle carte a 30 giorni è quasi imprevedibile**: la variazione mediana è 0,0%.
   Il vantaggio del modello è piccolo. Reale, misurato, ma piccolo.
2. **Inseguire il trend fa perdere soldi.** Il risultato più netto della verifica è il coefficiente
   negativo su `m30`: una carta che è appena corsa tende a rientrare, non a continuare. Il modello
   è quindi contrarian, non trend-following — ed è il contrario di quello che fa la maggior parte
   delle persone sui gruppi di compravendita.

L'intervallo «±1σ» mostrato nell'app contiene il prezzo reale nel 70,6% dei casi, contro il 68%
teorico: l'incertezza dichiarata è onesta.

> Previsioni statistiche, **non consulenza finanziaria**. Ristampe annunciate e ban possono
> dimezzare un prezzo in un giorno e nessun modello li vede arrivare. Non investire soldi che non
> puoi permetterti di perdere.

## Pubblicare il sito

**Una cosa va fatta a mano, una volta sola:** su GitHub apri *Settings → Pages* e imposta
**Source: GitHub Actions**. Il token delle Action non ha il permesso di attivare Pages da sé.

Fatto quello, il resto è automatico: `.github/workflows/pages.yml` scarica i dati, ristima il
modello, lancia i test e pubblica. Parte a ogni push, **ogni 6 ore** e a mano da *Actions → Run
workflow*. In CI il giro completo dura meno di due minuti.

L'indirizzo del sito sarà `https://bipo99.github.io/Bipo/`.

## Lavorarci in locale

```bash
node scripts/build-data.mjs      # scarica i dati reali in data/ (~25 MB, circa 1 minuto)
node scripts/backtest.mjs --write # ristima il modello e aggiorna i coefficienti in model.js
node --test tests/*.test.mjs      # test
python3 -m http.server 8000       # poi apri http://localhost:8000
```

La cartella `data/` non è versionata: è un prodotto della build.

## Struttura

```
index.html  app.js  styles.css      interfaccia
model.js                            previsioni: fondamentali + coefficienti stimati
lib/data.js                         indice, storico, cache e prezzi in diretta
scripts/build-data.mjs              costruisce indice e storico dalle fonti
scripts/backtest.mjs                stima, verifica e scrive i coefficienti
scripts/lib/                        client Scryfall, lettori in streaming di MTGJSON
tests/                              test del modello
```
