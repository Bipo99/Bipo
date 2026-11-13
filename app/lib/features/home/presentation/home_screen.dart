import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/firebase/firebase_bootstrap.dart';
import 'widgets/feature_card.dart';
import 'widgets/urgent_button.dart';

/// Home: pulsante urgente in alto, riepilogo di cosa condivido, quattro card.
/// In questa fase le card sono segnaposto: ogni fase successiva ne attiva una.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  void _comingSoon(BuildContext context, String what, int phase) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('$what arriva nella Fase $phase')));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final status = ref.watch(firebaseStatusProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Bipo',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            UrgentButton(
              onPressed: () => _comingSoon(context, 'Il messaggio urgente', 5),
            ),
            const SizedBox(height: 16),
            const _SharingSummary(),
            const SizedBox(height: 16),
            // Due card per riga che crescono in altezza con il testo:
            // nessun taglio anche con la dimensione del testo al massimo.
            _CardRow(
              children: [
                FeatureCard(
                  icon: Icons.place_rounded,
                  title: 'Posizione',
                  subtitle: 'In arrivo',
                  accent: AppColors.terracotta,
                  onTap: () => _comingSoon(context, 'La posizione', 3),
                ),
                FeatureCard(
                  icon: Icons.mood_rounded,
                  title: 'Umore',
                  subtitle: 'In arrivo',
                  accent: const Color(0xFFD9A441),
                  onTap: () => _comingSoon(context, "L'umore", 2),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _CardRow(
              children: [
                FeatureCard(
                  icon: Icons.work_outline_rounded,
                  title: 'Cosa sto facendo',
                  subtitle: 'In arrivo',
                  accent: AppColors.sage,
                  onTap: () => _comingSoon(context, "L'attività", 2),
                ),
                FeatureCard(
                  icon: Icons.medication_rounded,
                  title: 'Farmaci',
                  subtitle: 'In arrivo',
                  accent: const Color(0xFF7A8CC9),
                  onTap: () => _comingSoon(context, 'I farmaci', 4),
                ),
              ],
            ),
            const SizedBox(height: 24),
            _FirebaseStatusChip(status: status),
          ],
        ),
      ),
    );
  }
}

/// Riga di due card della stessa altezza.
class _CardRow extends StatelessWidget {
  const _CardRow({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: children[0]),
          const SizedBox(width: 14),
          Expanded(child: children[1]),
        ],
      ),
    );
  }
}

/// Riquadro sempre visibile con ciò che sto condividendo in questo momento.
class _SharingSummary extends StatelessWidget {
  const _SharingSummary();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(
            Icons.visibility_off_rounded,
            color: theme.colorScheme.onSecondaryContainer,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Stai condividendo: niente, per ora.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSecondaryContainer,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Indicatore tecnico della Fase 0: dice se l'app è collegata a Firebase.
class _FirebaseStatusChip extends StatelessWidget {
  const _FirebaseStatusChip({required this.status});

  final FirebaseStatus status;

  @override
  Widget build(BuildContext context) {
    final (icon, text) = switch (status) {
      FirebaseStatus.connected => (
        Icons.cloud_done_rounded,
        'Collegata a Firebase',
      ),
      FirebaseStatus.notConfigured => (
        Icons.cloud_off_rounded,
        'Firebase non ancora collegato',
      ),
      FirebaseStatus.error => (
        Icons.error_outline_rounded,
        'Errore di collegamento a Firebase',
      ),
    };
    return Center(
      child: Chip(avatar: Icon(icon, size: 18), label: Text(text)),
    );
  }
}
