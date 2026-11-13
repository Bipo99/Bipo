import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/config/app_config.dart';
import '../../firebase_options.dart';

/// Esito del collegamento a Firebase all'avvio.
enum FirebaseStatus {
  /// I parametri del progetto non sono ancora stati inseriti.
  notConfigured,

  /// Collegato correttamente.
  connected,

  /// Parametri presenti ma l'inizializzazione è fallita.
  error,
}

/// Stato di Firebase, deciso una volta all'avvio in `main.dart`.
final firebaseStatusProvider = Provider<FirebaseStatus>(
  (ref) => FirebaseStatus.notConfigured,
);

/// Inizializza Firebase e, in sviluppo, collega gli emulatori locali.
/// Non lancia mai eccezioni: in caso di problemi restituisce uno stato,
/// così l'app si apre comunque e mostra cosa non va.
Future<FirebaseStatus> initFirebase() async {
  if (!DefaultFirebaseOptions.isConfigured && !AppConfig.useEmulators) {
    return FirebaseStatus.notConfigured;
  }
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );

    if (AppConfig.useEmulators) {
      final host = AppConfig.emulatorHost;
      FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
      await FirebaseAuth.instance.useAuthEmulator(host, 9099);
    }

    // Cache offline: i dati restano disponibili anche senza rete e le
    // scritture vengono inviate appena torna la connessione.
    FirebaseFirestore.instance.settings = const Settings(
      persistenceEnabled: true,
      cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
    );
    return FirebaseStatus.connected;
  } catch (e, st) {
    debugPrint('Errore di inizializzazione Firebase: $e\n$st');
    return FirebaseStatus.error;
  }
}
