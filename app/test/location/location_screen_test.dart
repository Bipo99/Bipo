import 'package:bipo/features/location/domain/location_snapshot.dart';
import 'package:bipo/features/location/presentation/location_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../helpers/fake_location_service.dart';
import '../helpers/test_app.dart';

void main() {
  Future<void> phone(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  testWidgets('prima del permesso di sistema mostra la spiegazione', (
    tester,
  ) async {
    await phone(tester);
    final gps = FakeLocationService();
    await tester.pumpWidget(
      await testApp(const LocationScreen(), location: gps),
    );
    await tester.pumpAndSettle();
    expect(find.text('Spenta: nessuno vede dove sei'), findsOneWidget);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(find.text('Condividere la tua posizione'), findsOneWidget);
    expect(
      gps.requests,
      0,
      reason: 'il permesso non va chiesto prima di "Continua"',
    );

    await tester.tap(find.text('Continua'));
    // L'indicatore "cerco la posizione" gira di continuo: niente pumpAndSettle.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(gps.requests, 1);
    expect(gps.isWatching, isTrue);
    expect(find.text('Cerco la tua posizione…'), findsOneWidget);

    gps.emit(fakeSnapshot());
    await tester.pump();
    await tester.pump();
    expect(find.text('Accesa · aggiornamenti precisi'), findsOneWidget);
    expect(find.text('Aggiornata adesso'), findsOneWidget);
    expect(find.text('Batteria 76%'), findsOneWidget);
    expect(find.text('Precisione ±12 m'), findsOneWidget);
    expect(find.bySemanticsLabel('La tua posizione'), findsOneWidget);
  });

  testWidgets('"Non ora" lascia tutto spento', (tester) async {
    await phone(tester);
    final gps = FakeLocationService();
    await tester.pumpWidget(
      await testApp(const LocationScreen(), location: gps),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Non ora'));
    await tester.pumpAndSettle();
    expect(gps.requests, 0);
    expect(gps.isWatching, isFalse);
    expect(find.text('Spenta: nessuno vede dove sei'), findsOneWidget);
  });

  testWidgets('permesso negato per sempre: porta alle Impostazioni', (
    tester,
  ) async {
    await phone(tester);
    final gps = FakeLocationService(access: LocationAccess.deniedForever);
    await tester.pumpWidget(
      await testApp(const LocationScreen(), location: gps),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Hai negato il permesso'), findsOneWidget);
    await tester.tap(find.text('Apri Impostazioni'));
    expect(gps.settingsOpened, 1);
  });

  testWidgets('spegnendo, la posizione sparisce dalla mappa', (tester) async {
    await phone(tester);
    final gps = FakeLocationService(access: LocationAccess.granted);
    await tester.pumpWidget(
      await testApp(
        const LocationScreen(),
        location: gps,
        prefs: {'location.sharing': true},
      ),
    );
    await tester.pump();
    gps.emit(fakeSnapshot());
    await tester.pump();
    await tester.pump();
    expect(find.bySemanticsLabel('La tua posizione'), findsOneWidget);

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(find.text('Spenta: nessuno vede dove sei'), findsOneWidget);
    expect(find.bySemanticsLabel('La tua posizione'), findsNothing);
    expect(gps.isWatching, isFalse);
  });

  testWidgets('tema scuro e testo grande senza errori di layout', (
    tester,
  ) async {
    await phone(tester);
    final gps = FakeLocationService(access: LocationAccess.granted);
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
        child: await testApp(
          const LocationScreen(),
          location: gps,
          mode: ThemeMode.dark,
          prefs: {'location.sharing': true},
        ),
      ),
    );
    await tester.pump();
    gps.emit(fakeSnapshot());
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
