import 'package:go_router/go_router.dart';

import '../../features/home/presentation/home_screen.dart';
import '../../features/location/presentation/location_screen.dart';

/// Tutte le schermate dell'app. Nelle prossime fasi qui aggiungeremo i
/// "cancelli": chi non è loggato va al login, chi non è accoppiato al codice invito.
final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        GoRoute(
          path: 'posizione',
          builder: (context, state) => const LocationScreen(),
        ),
      ],
    ),
  ],
);
