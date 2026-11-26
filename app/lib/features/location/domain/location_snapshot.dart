/// Una "fotografia" della mia posizione: è ciò che il partner vedrà.
class LocationSnapshot {
  const LocationSnapshot({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.timestamp,
    this.batteryLevel,
    this.batterySaver = false,
  });

  final double latitude;
  final double longitude;

  /// Raggio di incertezza in metri (più è piccolo, più è precisa).
  final double accuracyMeters;

  /// Momento in cui il telefono ha rilevato la posizione.
  final DateTime timestamp;

  /// Livello batteria 0–100, `null` se il dispositivo non lo fornisce.
  final int? batteryLevel;

  /// `true` se il telefono è in modalità risparmio energetico.
  final bool batterySaver;

  LocationSnapshot copyWith({int? batteryLevel, bool? batterySaver}) =>
      LocationSnapshot(
        latitude: latitude,
        longitude: longitude,
        accuracyMeters: accuracyMeters,
        timestamp: timestamp,
        batteryLevel: batteryLevel ?? this.batteryLevel,
        batterySaver: batterySaver ?? this.batterySaver,
      );
}

/// Stato del permesso di localizzazione, semplificato per l'interfaccia.
enum LocationAccess {
  /// Non ancora chiesto: va mostrata prima la schermata esplicativa.
  notAsked,

  /// Concesso (almeno "mentre usi l'app").
  granted,

  /// Rifiutato, ma si può richiedere di nuovo.
  denied,

  /// Rifiutato in modo permanente: si cambia solo dalle Impostazioni.
  deniedForever,

  /// Il GPS / servizi di localizzazione del telefono sono spenti.
  serviceOff,
}

/// Precisione delle rilevazioni: "precisa" consuma di più,
/// "risparmio" aggiorna meno spesso e con meno precisione.
enum LocationMode { precise, batterySaver }
