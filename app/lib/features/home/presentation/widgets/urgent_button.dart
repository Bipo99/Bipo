import 'package:material_ui/material_ui.dart';

import '../../../../app/theme/app_theme.dart';

/// Pulsante rosso "Messaggio urgente", sempre in cima alla Home.
/// È l'unico elemento rosso dell'app, così non si confonde con nient'altro.
class UrgentButton extends StatelessWidget {
  const UrgentButton({super.key, required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.urgent,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(60),
        ),
        onPressed: onPressed,
        icon: const Icon(Icons.campaign_rounded, size: 26),
        label: const Text('Messaggio urgente'),
      ),
    );
  }
}
