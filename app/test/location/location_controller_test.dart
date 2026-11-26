import 'package:bipo/core/storage/preferences.dart';
import 'package:bipo/features/location/domain/location_snapshot.dart';
import 'package:bipo/features/location/presentation/location_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/fake_location_service.dart';

Future<(ProviderContainer, FakeLocationService, SharedPreferences)> _setup({
  Map<String, Object> prefs = const {},
  LocationAccess access = LocationAccess.notAsked,
  LocationAccess afterRequest = LocationAccess.granted,
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  final fake = FakeLocationService(
    access: access,
    accessAfterRequest: afterRequest,
  );
  final c = ProviderContainer(
    overrides: [
      preferencesProvider.overrideWithValue(sp),
      locationServiceProvider.overrideWithValue(fake),
    ],
  );
  addTearDown(c.dispose);
  c.read(locationControllerProvider); // avvia il controller
  await pumpEventQueue();
  return (c, fake, sp);
}

void main() {
  test('all\'avvio è spenta e il GPS non lavora', () async {
    final (c, fake, _) = await _setup();
    expect(c.read(locationControllerProvider).sharing, isFalse);
    expect(fake.isWatching, isFalse);
  });

  test(
    'accendendo chiede il permesso, rileva la posizione e la batteria',
    () async {
      final (c, fake, sp) = await _setup();
      await c.read(locationControllerProvider.notifier).enableSharing();
      expect(fake.requests, 1);
      expect(fake.isWatching, isTrue);
      expect(c.read(locationControllerProvider).locating, isTrue);

      fake.emit(fakeSnapshot());
      await pumpEventQueue();
      final s = c.read(locationControllerProvider);
      expect(s.sharing, isTrue);
      expect(s.locating, isFalse);
      expect(s.last!.latitude, 45.4642);
      expect(s.last!.batteryLevel, 76);
      expect(sp.getBool('location.sharing'), isTrue);
    },
  );

  test('permesso negato: resta spenta e non parte il GPS', () async {
    final (c, fake, sp) = await _setup(
      afterRequest: LocationAccess.deniedForever,
    );
    await c.read(locationControllerProvider.notifier).enableSharing();
    final s = c.read(locationControllerProvider);
    expect(s.sharing, isFalse);
    expect(s.access, LocationAccess.deniedForever);
    expect(fake.isWatching, isFalse);
    expect(sp.getBool('location.sharing'), isFalse);
  });

  test('con permesso già concesso non lo richiede di nuovo', () async {
    final (c, fake, _) = await _setup(access: LocationAccess.granted);
    await c.read(locationControllerProvider.notifier).enableSharing();
    expect(fake.requests, 0);
    expect(fake.isWatching, isTrue);
  });

  test('spegnendo si ferma il GPS e la posizione viene dimenticata', () async {
    final (c, fake, sp) = await _setup(access: LocationAccess.granted);
    final ctrl = c.read(locationControllerProvider.notifier);
    await ctrl.enableSharing();
    fake.emit(fakeSnapshot());
    await pumpEventQueue();

    await ctrl.disableSharing();
    final s = c.read(locationControllerProvider);
    expect(s.sharing, isFalse);
    expect(s.last, isNull);
    expect(fake.isWatching, isFalse);
    expect(sp.getBool('location.sharing'), isFalse);
  });

  test('riprende da sola se era accesa al riavvio dell\'app', () async {
    final (c, fake, _) = await _setup(
      prefs: {'location.sharing': true},
      access: LocationAccess.granted,
    );
    expect(c.read(locationControllerProvider).sharing, isTrue);
    expect(fake.isWatching, isTrue);
  });

  test('non riprende se nel frattempo il permesso è stato revocato', () async {
    final (c, fake, _) = await _setup(
      prefs: {'location.sharing': true},
      access: LocationAccess.denied,
    );
    expect(c.read(locationControllerProvider).sharing, isFalse);
    expect(fake.isWatching, isFalse);
  });

  test('cambiare modalità riavvia il GPS con le nuove impostazioni', () async {
    final (c, fake, sp) = await _setup(access: LocationAccess.granted);
    final ctrl = c.read(locationControllerProvider.notifier);
    await ctrl.enableSharing();
    await ctrl.setMode(LocationMode.batterySaver);
    expect(fake.watchedModes, [
      LocationMode.precise,
      LocationMode.batterySaver,
    ]);
    expect(sp.getString('location.mode'), 'batterySaver');
  });

  test('un errore del GPS mostra un messaggio senza bloccare l\'app', () async {
    final (c, fake, _) = await _setup(access: LocationAccess.granted);
    await c.read(locationControllerProvider.notifier).enableSharing();
    fake.fail(Exception('timeout'));
    await pumpEventQueue();
    final s = c.read(locationControllerProvider);
    expect(s.error, contains('Non riesco'));
    expect(s.locating, isFalse);
  });
}
