import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/storage/preferences.dart';
import '../data/location_service.dart';
import '../domain/location_snapshot.dart';

/// Servizio GPS/batteria; nei test viene sostituito con un finto.
final locationServiceProvider = Provider<LocationService>(
  (ref) => DeviceLocationService(),
);

/// Stato della condivisione della posizione mostrato dall'interfaccia.
@immutable
class LocationState {
  const LocationState({
    this.sharing = false,
    this.mode = LocationMode.precise,
    this.access = LocationAccess.notAsked,
    this.last,
    this.error,
    this.locating = false,
  });

  /// La condivisione è accesa (scelta dell'utente, ricordata tra un avvio e l'altro).
  final bool sharing;
  final LocationMode mode;
  final LocationAccess access;

  /// Ultima posizione rilevata; `null` se la condivisione è spenta.
  final LocationSnapshot? last;

  /// Messaggio d'errore leggibile, se qualcosa è andato storto.
  final String? error;

  /// `true` mentre si attende la prima rilevazione.
  final bool locating;

  LocationState copyWith({
    bool? sharing,
    LocationMode? mode,
    LocationAccess? access,
    LocationSnapshot? last,
    bool clearLast = false,
    String? error,
    bool clearError = false,
    bool? locating,
  }) => LocationState(
    sharing: sharing ?? this.sharing,
    mode: mode ?? this.mode,
    access: access ?? this.access,
    last: clearLast ? null : (last ?? this.last),
    error: clearError ? null : (error ?? this.error),
    locating: locating ?? this.locating,
  );
}

final locationControllerProvider =
    NotifierProvider<LocationController, LocationState>(LocationController.new);

/// Logica della condivisione posizione:
/// - il GPS lavora SOLO quando la condivisione è accesa (privacy e batteria);
/// - spegnendola, l'ultima posizione viene dimenticata;
/// - la scelta (accesa/spenta, precisa/risparmio) resta salvata sul telefono.
class LocationController extends Notifier<LocationState> {
  static const _kSharing = 'location.sharing';
  static const _kMode = 'location.mode';

  StreamSubscription<LocationSnapshot>? _sub;

  // Letti una volta in build(): così non si usa `ref` dopo un'attesa,
  // quando il controller potrebbe essere già stato distrutto.
  late LocationService _service;
  late SharedPreferences _prefs;

  @override
  LocationState build() {
    ref.onDispose(() => _sub?.cancel());
    _service = ref.read(locationServiceProvider);
    _prefs = ref.read(preferencesProvider);
    final sharing = _prefs.getBool(_kSharing) ?? false;
    final mode = _prefs.getString(_kMode) == LocationMode.batterySaver.name
        ? LocationMode.batterySaver
        : LocationMode.precise;
    // Controllo del permesso e, se era accesa, ripresa della condivisione.
    Future.microtask(() => _restore(sharing));
    return LocationState(mode: mode);
  }

  Future<void> _restore(bool wasSharing) async {
    final access = await _service.checkAccess();
    if (!ref.mounted) return;
    state = state.copyWith(access: access);
    if (wasSharing && access == LocationAccess.granted) {
      _start();
    }
  }

  /// Aggiorna lo stato del permesso (es. al ritorno dalle Impostazioni).
  Future<void> refreshAccess() async {
    final access = await _service.checkAccess();
    if (!ref.mounted) return;
    state = state.copyWith(access: access);
  }

  /// Accende la condivisione. Chiede il permesso di sistema se serve:
  /// l'interfaccia deve aver già mostrato la schermata esplicativa.
  Future<void> enableSharing() async {
    var access = await _service.checkAccess();
    if (access == LocationAccess.notAsked || access == LocationAccess.denied) {
      access = await _service.requestAccess();
    }
    if (!ref.mounted) return;
    state = state.copyWith(access: access, clearError: true);
    if (access != LocationAccess.granted) {
      state = state.copyWith(sharing: false);
      await _persistSharing(false);
      return;
    }
    _start();
    await _persistSharing(true);
  }

  /// Spegne la condivisione e dimentica l'ultima posizione.
  /// L'interfaccia si aggiorna SUBITO; GPS e salvataggio seguono.
  Future<void> disableSharing() async {
    final sub = _sub;
    _sub = null;
    state = state.copyWith(
      sharing: false,
      locating: false,
      clearLast: true,
      clearError: true,
    );
    await sub?.cancel();
    await _persistSharing(false);
  }

  /// Passa tra modalità precisa e risparmio batteria.
  Future<void> setMode(LocationMode mode) async {
    state = state.copyWith(mode: mode);
    if (state.sharing) _start();
    await _prefs.setString(_kMode, mode.name);
  }

  Future<void> openAppSettings() => _service.openAppSettings();
  Future<void> openLocationSettings() => _service.openLocationSettings();

  Future<void> _persistSharing(bool value) => _prefs.setBool(_kSharing, value);

  void _start() {
    _sub?.cancel();
    state = state.copyWith(sharing: true, locating: state.last == null);
    _sub = _service
        .watch(state.mode)
        .listen(
          _onSnapshot,
          onError: (Object e) {
            if (!ref.mounted) return;
            debugPrint('Errore posizione: $e');
            state = state.copyWith(
              locating: false,
              error:
                  'Non riesco a rilevare la posizione. Controlla che il GPS sia '
                  'acceso e riprova.',
            );
            // Il permesso potrebbe essere stato revocato dalle Impostazioni.
            refreshAccess();
          },
        );
  }

  Future<void> _onSnapshot(LocationSnapshot s) async {
    final battery = await _service.readBattery();
    if (!ref.mounted || !state.sharing) return;
    state = state.copyWith(
      last: s.copyWith(
        batteryLevel: battery.level,
        batterySaver: battery.saver,
      ),
      locating: false,
      clearError: true,
    );
  }
}
