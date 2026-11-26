import '../domain/location_snapshot.dart';

/// Testi brevi condivisi tra la card della Home e la schermata mappa.
class LocationFormat {
  LocationFormat._();

  static String time(DateTime t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  /// "adesso", "3 min fa", "alle 14:32".
  static String ago(DateTime t, {DateTime? now}) {
    final diff = (now ?? DateTime.now()).difference(t);
    if (diff.inSeconds < 60) return 'adesso';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min fa';
    return 'alle ${time(t)}';
  }

  static String battery(LocationSnapshot s) {
    if (s.batteryLevel == null) return 'Batteria non disponibile';
    final saver = s.batterySaver ? ' · risparmio energetico' : '';
    return 'Batteria ${s.batteryLevel}%$saver';
  }
}
