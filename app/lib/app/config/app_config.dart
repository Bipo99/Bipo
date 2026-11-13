/// Configurazione dell'ambiente ("flavor") in cui gira l'app.
///
/// Si sceglie in fase di build con `--dart-define=FLAVOR=dev` oppure `prod`:
/// - **dev**: l'app parla con l'emulatore Firebase locale (dati finti, per i test);
/// - **prod**: l'app parla con il vero progetto Firebase (i nostri dati).
///
/// Se non si specifica nulla si usa `prod`, che è ciò che vogliamo nelle build
/// che finiscono sui nostri telefoni.
enum Flavor { dev, prod }

class AppConfig {
  AppConfig._();

  static const String _flavorName = String.fromEnvironment(
    'FLAVOR',
    defaultValue: 'prod',
  );

  /// Ambiente corrente.
  static Flavor get flavor => _flavorName == 'dev' ? Flavor.dev : Flavor.prod;

  /// In sviluppo ci si collega agli emulatori invece che al cloud.
  static bool get useEmulators => flavor == Flavor.dev;

  /// Indirizzo degli emulatori (10.0.2.2 è il "localhost" visto dall'emulatore Android).
  static const String emulatorHost = String.fromEnvironment(
    'EMULATOR_HOST',
    defaultValue: 'localhost',
  );
}
