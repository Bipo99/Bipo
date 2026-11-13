# Bipo: la nostra app di coppia

App privata per due persone, senza pubblicità e senza analytics: posizione, umore,
cosa stiamo facendo, farmaci, messaggi urgenti e chat.

- **Codice:** Flutter (un'unica base per Android, iPhone e web) + Firebase.
- **Come si usa:** si apre dal link `https://<progetto>.web.app` (iPhone: *Condividi →
  Aggiungi alla schermata Home*). Su Android si può installare l'APK da
  `https://<progetto>.web.app/download/bipo.apk` per avere notifiche forti e
  posizione in background.
- **Niente da installare sul PC:** compilazione e pubblicazione avvengono su GitHub
  Actions (`.github/workflows/app.yml`) a ogni push sul branch dell'app.

## Struttura (feature-first)

```
lib/
  app/        avvio, configurazione (flavor), router, tema chiaro/scuro
  core/       servizi condivisi (Firebase, notifiche, permessi…)
  features/   una cartella per funzione: home, auth, pairing, mood, activity,
              location, medications, urgent, chat (ognuna con data/ domain/ presentation/)
test/         test automatici
```

## Ambienti (flavor)

| Flavor | Come | A cosa si collega |
|---|---|---|
| `prod` (predefinito) | nessun parametro | il vero progetto Firebase |
| `dev` | `--dart-define=FLAVOR=dev` | gli emulatori Firebase locali (dati finti, per i test) |

## Configurazione una tantum (Fase 0)

1. Crea il progetto su <https://console.firebase.google.com> e registra le app Web e Android.
2. Incolla i parametri in `lib/firebase_options.dart`.
3. Su GitHub → *Settings → Secrets and variables → Actions*:
   - Secret `FIREBASE_SERVICE_ACCOUNT`: il JSON della chiave dell'account di servizio;
   - Variable `FIREBASE_PROJECT_ID`: l'ID del progetto (es. `bipo-12345`).
4. Ogni push ricompila e ripubblica l'app.

## Comandi per chi sviluppa

```bash
flutter pub get
flutter analyze
flutter test
flutter build web --release --no-web-resources-cdn   # sito autonomo, niente CDN
flutter build apk --release
```

## Privacy

- Nessun SDK di analytics, crash reporting o pubblicità.
- La versione web è compilata senza CDN e il sito non è indicizzato dai motori di ricerca.
- I dati sono protetti dalle regole di sicurezza di Firestore (Fase 1).

## Note

- La chiave di firma `android/app/bipo-dev.keystore` è solo di **sviluppo**. Nella
  Fase 8 viene sostituita da una chiave privata custodita nei Secret di GitHub.
