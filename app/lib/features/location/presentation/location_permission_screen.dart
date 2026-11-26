import 'package:material_ui/material_ui.dart';

/// Schermata esplicativa mostrata PRIMA della richiesta di sistema.
/// Restituisce `true` se l'utente vuole procedere.
class LocationPermissionScreen extends StatelessWidget {
  const LocationPermissionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget point(IconData icon, String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: theme.colorScheme.primary),
          const SizedBox(width: 14),
          Expanded(child: Text(text, style: theme.textTheme.bodyLarge)),
        ],
      ),
    );

    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          children: [
            Icon(
              Icons.place_rounded,
              size: 64,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(height: 16),
            Text(
              'Condividere la tua posizione',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),
            point(
              Icons.favorite_rounded,
              'Il tuo partner vedrà sulla mappa dove sei, l\'orario dell\'ultimo aggiornamento e il livello della batteria.',
            ),
            point(
              Icons.toggle_on_rounded,
              'Condividi solo quando lo decidi tu: puoi spegnere la condivisione in qualsiasi momento, e la posizione viene subito dimenticata.',
            ),
            point(
              Icons.lock_rounded,
              'Nessun altro può vederla: niente pubblicità, niente terze parti.',
            ),
            point(
              Icons.phone_iphone_rounded,
              'Per ora la posizione si aggiorna mentre l\'app è aperta. L\'aggiornamento in background arriverà più avanti, con una sua spiegazione.',
            ),
            const SizedBox(height: 12),
            Text(
              'Nella prossima finestra il telefono ti chiederà il permesso: scegli "Consenti mentre usi l\'app".',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      // Pulsanti sempre visibili in basso, senza dover scorrere.
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Continua'),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Non ora'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
