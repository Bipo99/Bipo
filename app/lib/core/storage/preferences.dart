import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Preferenze locali del telefono (es. "condivisione posizione attiva").
/// Viene caricato una volta in `main.dart` e iniettato qui.
final preferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError(
    'preferencesProvider va inizializzato in main()',
  ),
);
