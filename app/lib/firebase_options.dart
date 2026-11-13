// Parametri di collegamento al progetto Firebase.
//
// Questi valori NON sono segreti: Firebase li include in ogni app e la vera
// protezione dei dati sono le regole di sicurezza di Firestore.
// Vengono compilati nella Fase 0, dopo la creazione del progetto in console.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  DefaultFirebaseOptions._();

  /// `true` quando i parametri sono stati compilati.
  static bool get isConfigured => web.apiKey.isNotEmpty;

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'Piattaforma non supportata: solo iOS, Android e web.',
        );
    }
  }

  // TODO(fase-0): incollare qui i valori dalla console Firebase.
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: '',
    appId: '',
    messagingSenderId: '',
    projectId: '',
    authDomain: '',
    storageBucket: '',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: '',
    appId: '',
    messagingSenderId: '',
    projectId: '',
    storageBucket: '',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: '',
    appId: '',
    messagingSenderId: '',
    projectId: '',
    storageBucket: '',
    iosBundleId: 'com.bipo99.bipo',
  );
}
