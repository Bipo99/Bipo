import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'core/firebase/firebase_bootstrap.dart';
import 'core/storage/preferences.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final (status, prefs) = await (
    initFirebase(),
    SharedPreferences.getInstance(),
  ).wait;
  runApp(
    ProviderScope(
      overrides: [
        firebaseStatusProvider.overrideWithValue(status),
        preferencesProvider.overrideWithValue(prefs),
      ],
      child: const BipoApp(),
    ),
  );
}
