import 'dart:async';

import 'package:bipo/features/location/data/location_service.dart';
import 'package:bipo/features/location/domain/location_snapshot.dart';

/// GPS finto: i test decidono permessi e posizioni da emettere.
class FakeLocationService implements LocationService {
  FakeLocationService({
    this.access = LocationAccess.notAsked,
    this.accessAfterRequest = LocationAccess.granted,
  });

  LocationAccess access;
  LocationAccess accessAfterRequest;
  int requests = 0;
  int settingsOpened = 0;
  final watchedModes = <LocationMode>[];
  StreamController<LocationSnapshot>? _ctrl;

  bool get isWatching =>
      _ctrl != null && !_ctrl!.isClosed && _ctrl!.hasListener;

  void emit(LocationSnapshot s) => _ctrl!.add(s);
  void fail(Object e) => _ctrl!.addError(e);

  @override
  Future<LocationAccess> checkAccess() async => access;

  @override
  Future<LocationAccess> requestAccess() async {
    requests++;
    access = accessAfterRequest;
    return access;
  }

  @override
  Stream<LocationSnapshot> watch(LocationMode mode) {
    watchedModes.add(mode);
    _ctrl?.close();
    _ctrl = StreamController<LocationSnapshot>();
    return _ctrl!.stream;
  }

  @override
  Future<({int? level, bool saver})> readBattery() async =>
      (level: 76, saver: false);

  @override
  Future<void> openAppSettings() async => settingsOpened++;

  @override
  Future<void> openLocationSettings() async => settingsOpened++;
}

LocationSnapshot fakeSnapshot({double lat = 45.4642, double lng = 9.19}) =>
    LocationSnapshot(
      latitude: lat,
      longitude: lng,
      accuracyMeters: 12,
      timestamp: DateTime.now(),
    );
