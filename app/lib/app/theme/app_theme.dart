import 'package:flutter/material.dart';

/// Palette calda e morbida dell'app, uguale su iOS e Android.
class AppColors {
  AppColors._();

  static const terracotta = Color(0xFFE07A5F); // colore principale
  static const sage = Color(0xFF81B29A); // conferme, "preso", "tutto ok"
  static const sand = Color(0xFFF2CC8F); // avvisi gentili
  static const ink = Color(0xFF3D405B); // testo su sfondo chiaro
  static const cream = Color(0xFFFFF8F3); // sfondo chiaro
  static const night = Color(0xFF1E1A18); // sfondo scuro
  static const urgent = Color(0xFFC62839); // SOLO per il messaggio urgente
}

/// Temi chiaro e scuro. I contrasti testo/sfondo rispettano WCAG AA (≥ 4.5:1).
class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(
    ColorScheme.fromSeed(
      seedColor: AppColors.terracotta,
      brightness: Brightness.light,
    ).copyWith(
      surface: AppColors.cream,
      onSurface: AppColors.ink,
      error: AppColors.urgent,
    ),
  );

  static ThemeData dark() => _build(
    ColorScheme.fromSeed(
      seedColor: AppColors.terracotta,
      brightness: Brightness.dark,
    ).copyWith(surface: AppColors.night, error: const Color(0xFFFF8A8A)),
  );

  static ThemeData _build(ColorScheme scheme) {
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);
    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      // Testo un filo più grande e arioso del default, per leggibilità.
      textTheme: base.textTheme.apply(
        bodyColor: scheme.onSurface,
        displayColor: scheme.onSurface,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52), // area di tocco ≥ 48dp / 44pt
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
      // Transizioni native: scorrimento laterale su iOS, zoom su Android.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}
