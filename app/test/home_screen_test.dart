import 'package:bipo/core/firebase/firebase_bootstrap.dart';
import 'package:bipo/features/home/presentation/home_screen.dart';
import 'package:bipo/features/location/domain/location_snapshot.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'helpers/fake_location_service.dart';
import 'helpers/test_app.dart';

void main() {
  testWidgets('la Home mostra il pulsante urgente e le quattro card', (
    tester,
  ) async {
    await tester.pumpWidget(await testApp(const HomeScreen()));
    await tester.pump();

    expect(find.text('Messaggio urgente'), findsOneWidget);
    for (final t in ['Posizione', 'Umore', 'Cosa sto facendo', 'Farmaci']) {
      expect(find.text(t), findsOneWidget);
    }
    expect(find.text('Condivisione spenta'), findsOneWidget);
    expect(find.text('Stai condividendo: niente, per ora.'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Firebase non ancora collegato'),
      200,
    );
    expect(find.text('Firebase non ancora collegato'), findsOneWidget);
  });

  testWidgets('toccare una card non ancora pronta dice da che fase arriva', (
    tester,
  ) async {
    await tester.pumpWidget(await testApp(const HomeScreen()));
    await tester.tap(find.text('Umore'));
    await tester.pump();
    expect(find.text('Umore: disponibile dalla Fase 2'), findsOneWidget);
  });

  testWidgets('con la posizione accesa la Home lo dice chiaramente', (
    tester,
  ) async {
    final gps = FakeLocationService(access: LocationAccess.granted);
    await tester.pumpWidget(
      await testApp(
        const HomeScreen(),
        location: gps,
        prefs: {'location.sharing': true},
      ),
    );
    await tester.pump();
    gps.emit(fakeSnapshot());
    await tester.pump();
    await tester.pump();

    expect(find.text('Stai condividendo: posizione.'), findsOneWidget);
    expect(find.text('Accesa · adesso'), findsOneWidget);
  });

  testWidgets('funziona anche con tema scuro e testo grande', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
        child: await testApp(const HomeScreen(), mode: ThemeMode.dark),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Messaggio urgente'), findsOneWidget);
  });

  testWidgets('lo stato di Firebase si riflette nella Home', (tester) async {
    await tester.pumpWidget(
      await testApp(const HomeScreen(), firebase: FirebaseStatus.connected),
    );
    await tester.scrollUntilVisible(find.text('Collegata a Firebase'), 200);
    expect(find.text('Collegata a Firebase'), findsOneWidget);
  });
}
