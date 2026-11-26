import 'package:bipo/app/theme/app_theme.dart';
import 'package:bipo/core/firebase/firebase_bootstrap.dart';
import 'package:bipo/core/storage/preferences.dart';
import 'package:bipo/features/location/presentation/location_controller.dart';
import 'package:bipo/features/location/presentation/location_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_location_service.dart';

/// Monta una schermata con tutte le dipendenze finte (GPS, preferenze, rete).
Future<Widget> testApp(
  Widget home, {
  FakeLocationService? location,
  FirebaseStatus firebase = FirebaseStatus.notConfigured,
  ThemeMode mode = ThemeMode.light,
  Map<String, Object> prefs = const {},
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  return ProviderScope(
    overrides: [
      preferencesProvider.overrideWithValue(sp),
      locationServiceProvider.overrideWithValue(
        location ?? FakeLocationService(),
      ),
      mapTilesEnabledProvider.overrideWithValue(false),
      firebaseStatusProvider.overrideWithValue(firebase),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: mode,
      home: home,
    ),
  );
}
