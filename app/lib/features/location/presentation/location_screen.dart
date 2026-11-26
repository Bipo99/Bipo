import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/app_theme.dart';
import '../domain/location_snapshot.dart';
import 'location_controller.dart';
import 'location_format.dart';
import 'location_permission_screen.dart';

/// Nei test le tessere della mappa (immagini scaricate da OpenStreetMap)
/// vengono disattivate per non dipendere dalla rete.
final mapTilesEnabledProvider = Provider<bool>((ref) => true);

/// Centro iniziale quando non c'è ancora nessuna posizione: l'Italia.
const _italy = LatLng(42.5, 12.5);

/// Schermata Posizione: mappa a tutto schermo e pannello di controllo.
class LocationScreen extends ConsumerStatefulWidget {
  const LocationScreen({super.key});

  @override
  ConsumerState<LocationScreen> createState() => _LocationScreenState();
}

class _LocationScreenState extends ConsumerState<LocationScreen> {
  final _map = MapController();
  late final AppLifecycleListener _lifecycle;
  bool _mapReady = false;
  bool _centeredOnce = false;

  @override
  void initState() {
    super.initState();
    // Tornando dalle Impostazioni di sistema ricontrolla il permesso.
    _lifecycle = AppLifecycleListener(
      onResume: () =>
          ref.read(locationControllerProvider.notifier).refreshAccess(),
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _map.dispose();
    super.dispose();
  }

  void _centerOn(LocationSnapshot s, {double zoom = 16}) {
    if (!_mapReady) return;
    _map.move(LatLng(s.latitude, s.longitude), zoom);
  }

  /// Accende la condivisione passando, se serve, dalla schermata esplicativa.
  Future<void> _turnOn() async {
    final controller = ref.read(locationControllerProvider.notifier);
    final access = ref.read(locationControllerProvider).access;
    switch (access) {
      case LocationAccess.deniedForever:
        await controller.openAppSettings();
        return;
      case LocationAccess.serviceOff:
        await controller.openLocationSettings();
        return;
      case LocationAccess.notAsked:
      case LocationAccess.denied:
        final ok = await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => const LocationPermissionScreen()),
        );
        if (ok != true) return;
      case LocationAccess.granted:
        break;
    }
    await controller.enableSharing();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(locationControllerProvider);
    final tiles = ref.watch(mapTilesEnabledProvider);
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    // Al primo punto ricevuto la mappa si centra da sola.
    ref.listen(locationControllerProvider.select((s) => s.last), (prev, next) {
      if (next != null && !_centeredOnce) {
        _centeredOnce = true;
        _centerOn(next);
      }
      if (next == null) _centeredOnce = false;
    });

    final me = state.last;
    final point = me == null ? null : LatLng(me.latitude, me.longitude);

    return Scaffold(
      appBar: AppBar(title: const Text('Posizione')),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: point ?? _italy,
                    initialZoom: point == null ? 5 : 16,
                    onMapReady: () => _mapReady = true,
                    interactionOptions: const InteractionOptions(
                      flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                    ),
                  ),
                  children: [
                    if (tiles)
                      TileLayer(
                        urlTemplate:
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.bipo99.bipo',
                        tileBuilder: isDark ? darkModeTileBuilder : null,
                      ),
                    if (point != null && me != null) ...[
                      CircleLayer(
                        circles: [
                          CircleMarker(
                            point: point,
                            radius: me.accuracyMeters,
                            useRadiusInMeter: true,
                            color: AppColors.terracotta.withValues(alpha: 0.15),
                            borderColor: AppColors.terracotta.withValues(
                              alpha: 0.5,
                            ),
                            borderStrokeWidth: 1,
                          ),
                        ],
                      ),
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: point,
                            width: 44,
                            height: 44,
                            child: const _MeMarker(),
                          ),
                        ],
                      ),
                    ],
                    if (tiles)
                      const RichAttributionWidget(
                        alignment: AttributionAlignment.bottomLeft,
                        attributions: [
                          TextSourceAttribution('© OpenStreetMap contributors'),
                        ],
                      ),
                  ],
                ),
                if (me != null)
                  Positioned(
                    right: 16,
                    bottom: 16,
                    child: FloatingActionButton.small(
                      tooltip: 'Centra su di me',
                      onPressed: () => _centerOn(me),
                      child: const Icon(Icons.my_location_rounded),
                    ),
                  ),
                if (state.locating)
                  const Positioned(
                    top: 12,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: _Pill(text: 'Cerco la tua posizione…'),
                    ),
                  ),
              ],
            ),
          ),
          _ControlPanel(state: state, onTurnOn: _turnOn),
        ],
      ),
    );
  }
}

/// Indicatore "sono qui".
class _MeMarker extends StatelessWidget {
  const _MeMarker();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'La tua posizione',
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.terracotta,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(blurRadius: 8, color: Colors.black26)],
        ),
        child: const Icon(
          Icons.favorite_rounded,
          color: Colors.white,
          size: 20,
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      elevation: 2,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 10),
            Flexible(child: Text(text)),
          ],
        ),
      ),
    );
  }
}

/// Pannello in basso: interruttore, stato, modalità, avvisi sui permessi.
class _ControlPanel extends ConsumerWidget {
  const _ControlPanel({required this.state, required this.onTurnOn});

  final LocationState state;
  final Future<void> Function() onTurnOn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final controller = ref.read(locationControllerProvider.notifier);
    final me = state.last;

    return Material(
      color: theme.colorScheme.surfaceContainerLow,
      child: SafeArea(
        top: false,
        // Il pannello occupa al massimo metà schermo e scorre se serve
        // (es. con testo molto grande): la mappa resta sempre visibile.
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.5,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Condividi la mia posizione',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(_statusLine(state)),
                  value: state.sharing,
                  onChanged: (on) =>
                      on ? onTurnOn() : controller.disableSharing(),
                ),
                if (me != null) ...[
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _InfoChip(
                        icon: Icons.schedule_rounded,
                        text: 'Aggiornata ${LocationFormat.ago(me.timestamp)}',
                      ),
                      _InfoChip(
                        icon: me.batterySaver
                            ? Icons.battery_saver_rounded
                            : Icons.battery_std_rounded,
                        text: LocationFormat.battery(me),
                      ),
                      _InfoChip(
                        icon: Icons.gps_fixed_rounded,
                        text: 'Precisione ±${me.accuracyMeters.round()} m',
                      ),
                    ],
                  ),
                ],
                if (state.sharing) ...[
                  const SizedBox(height: 12),
                  SegmentedButton<LocationMode>(
                    segments: const [
                      ButtonSegment(
                        value: LocationMode.precise,
                        icon: Icon(Icons.gps_fixed_rounded),
                        label: Text('Precisa'),
                      ),
                      ButtonSegment(
                        value: LocationMode.batterySaver,
                        icon: Icon(Icons.eco_rounded),
                        label: Text('Risparmio'),
                      ),
                    ],
                    selected: {state.mode},
                    onSelectionChanged: (s) => controller.setMode(s.first),
                  ),
                ],
                ..._notices(context, state, controller),
                const SizedBox(height: 12),
                Text(
                  'Il tuo partner apparirà su questa mappa dopo l\'accoppiamento (Fase 1).',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _statusLine(LocationState s) {
    if (!s.sharing) return 'Spenta: nessuno vede dove sei';
    if (s.locating) return 'Accesa: sto cercando il segnale…';
    return s.mode == LocationMode.precise
        ? 'Accesa · aggiornamenti precisi'
        : 'Accesa · risparmio batteria';
  }

  List<Widget> _notices(
    BuildContext context,
    LocationState s,
    LocationController c,
  ) {
    Widget notice(String text, {String? action, VoidCallback? onTap}) =>
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: _Notice(text: text, action: action, onTap: onTap),
        );
    return [
      if (s.error != null) notice(s.error!),
      if (s.access == LocationAccess.deniedForever)
        notice(
          'Hai negato il permesso di posizione. Per condividerla, attivalo nelle Impostazioni del telefono.',
          action: 'Apri Impostazioni',
          onTap: c.openAppSettings,
        ),
      if (s.access == LocationAccess.serviceOff)
        notice(
          'La localizzazione del telefono è spenta.',
          action: 'Attivala',
          onTap: c.openLocationSettings,
        ),
      if (s.access == LocationAccess.denied && !s.sharing)
        notice('Permesso non concesso. Puoi riprovare quando vuoi.'),
    ];
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Chip(
    avatar: Icon(icon, size: 18),
    label: Text(text),
    visualDensity: VisualDensity.compact,
  );
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.action, this.onTap});
  final String text;
  final String? action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.sand.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(14),
      ),
      // Testo sopra e pulsante sotto: niente sbordamenti con testo grande.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline_rounded),
              const SizedBox(width: 10),
              Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
            ],
          ),
          if (action != null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: onTap, child: Text(action!)),
            ),
        ],
      ),
    );
  }
}
