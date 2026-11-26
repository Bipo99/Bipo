import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../domain/location_snapshot.dart';

/// Accesso a GPS e batteria. È un'interfaccia così nei test si usa un finto.
abstract class LocationService {
  Future<LocationAccess> checkAccess();
  Future<LocationAccess> requestAccess();
  Stream<LocationSnapshot> watch(LocationMode mode);
  Future<({int? level, bool saver})> readBattery();
  Future<void> openAppSettings();
  Future<void> openLocationSettings();
}

/// Implementazione reale basata su `geolocator` e `battery_plus`,
/// con impostazioni specifiche per Android, iOS e web.
class DeviceLocationService implements LocationService {
  DeviceLocationService({Battery? battery}) : _battery = battery ?? Battery();

  final Battery _battery;

  @override
  Future<LocationAccess> checkAccess() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceOff;
    }
    return _map(await Geolocator.checkPermission(), asked: false);
  }

  @override
  Future<LocationAccess> requestAccess() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceOff;
    }
    return _map(await Geolocator.requestPermission(), asked: true);
  }

  LocationAccess _map(LocationPermission p, {required bool asked}) {
    switch (p) {
      case LocationPermission.always:
      case LocationPermission.whileInUse:
        return LocationAccess.granted;
      case LocationPermission.deniedForever:
        return LocationAccess.deniedForever;
      case LocationPermission.denied:
      case LocationPermission.unableToDetermine:
        // Prima della richiesta "denied" significa solo "non ancora chiesto".
        return asked ? LocationAccess.denied : LocationAccess.notAsked;
    }
  }

  /// Impostazioni per piattaforma:
  /// - precisa: GPS, aggiorna ogni ~10 m di spostamento;
  /// - risparmio: rete/Wi-Fi, aggiorna ogni ~100 m e al massimo ogni 2 minuti.
  LocationSettings _settings(LocationMode mode) {
    final precise = mode == LocationMode.precise;
    final accuracy = precise ? LocationAccuracy.high : LocationAccuracy.medium;
    final distance = precise ? 10 : 100;
    if (kIsWeb) {
      return LocationSettings(accuracy: accuracy, distanceFilter: distance);
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return AndroidSettings(
          accuracy: accuracy,
          distanceFilter: distance,
          intervalDuration: Duration(seconds: precise ? 15 : 120),
        );
      case TargetPlatform.iOS:
        return AppleSettings(
          accuracy: accuracy,
          distanceFilter: distance,
          activityType: ActivityType.other,
          pauseLocationUpdatesAutomatically: !precise,
        );
      default:
        return LocationSettings(accuracy: accuracy, distanceFilter: distance);
    }
  }

  @override
  Stream<LocationSnapshot> watch(LocationMode mode) async* {
    final settings = _settings(mode);
    // Prima una rilevazione immediata, così la mappa non resta vuota
    // finché non ci si sposta; poi gli aggiornamenti continui.
    try {
      yield _toSnapshot(
        await Geolocator.getCurrentPosition(locationSettings: settings)
            .timeout(const Duration(seconds: 20)),
      );
    } on TimeoutException {
      final last = kIsWeb ? null : await Geolocator.getLastKnownPosition();
      if (last != null) yield _toSnapshot(last);
    }
    yield* Geolocator.getPositionStream(locationSettings: settings)
        .map(_toSnapshot);
  }

  LocationSnapshot _toSnapshot(Position p) => LocationSnapshot(
    latitude: p.latitude,
    longitude: p.longitude,
    accuracyMeters: p.accuracy,
    timestamp: p.timestamp,
  );

  @override
  Future<({int? level, bool saver})> readBattery() async {
    int? level;
    var saver = false;
    // Alcuni browser (es. Safari) non espongono la batteria: non è un errore.
    try {
      level = await _battery.batteryLevel;
    } catch (_) {}
    try {
      saver = await _battery.isInBatterySaveMode;
    } catch (_) {}
    return (level: level, saver: saver);
  }

  @override
  Future<void> openAppSettings() => Geolocator.openAppSettings();

  @override
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}
