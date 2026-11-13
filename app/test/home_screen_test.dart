import 'package:bipo/app/theme/app_theme.dart';
import 'package:bipo/core/firebase/firebase_bootstrap.dart';
import 'package:bipo/features/home/presentation/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap({ThemeMode mode = ThemeMode.light}) => ProviderScope(
  child: MaterialApp(
    theme: AppTheme.light(),
    darkTheme: AppTheme.dark(),
    themeMode: mode,
    home: const HomeScreen(),
  ),
);

void main() {
  testWidgets('la Home mostra il pulsante urgente e le quattro card', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());

    expect(find.text('Messaggio urgente'), findsOneWidget);
    for (final t in ['Posizione', 'Umore', 'Cosa sto facendo', 'Farmaci']) {
      expect(find.text(t), findsOneWidget);
    }
    expect(find.text('Stai condividendo: niente, per ora.'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Firebase non ancora collegato'),
      200,
    );
    expect(find.text('Firebase non ancora collegato'), findsOneWidget);
  });

  testWidgets('toccare una card avvisa in che fase arriva', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.tap(find.text('Umore'));
    await tester.pump();
    expect(find.text("L'umore arriva nella Fase 2"), findsOneWidget);
  });

  testWidgets('funziona anche con tema scuro e testo grande', (tester) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
        child: _wrap(mode: ThemeMode.dark),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Messaggio urgente'), findsOneWidget);
  });

  testWidgets('lo stato di Firebase si riflette nella Home', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          firebaseStatusProvider.overrideWithValue(FirebaseStatus.connected),
        ],
        child: MaterialApp(theme: AppTheme.light(), home: const HomeScreen()),
      ),
    );
    await tester.scrollUntilVisible(find.text('Collegata a Firebase'), 200);
    expect(find.text('Collegata a Firebase'), findsOneWidget);
  });
}
