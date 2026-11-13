import 'package:flutter/material.dart';

import 'router/app_router.dart';
import 'theme/app_theme.dart';

/// Radice dell'interfaccia: tema chiaro/scuro automatico e navigazione.
class BipoApp extends StatelessWidget {
  const BipoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Bipo',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: appRouter,
    );
  }
}
