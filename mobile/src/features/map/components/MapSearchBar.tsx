/**
 * MapSearchBar.tsx — Barra de búsqueda flotante sobre el mapa (#11.7).
 *
 * Liquid glass: BlurView (expo-blur) tint='light' intensity=30 + overlay
 * translúcido de colors.paper para legibilidad. Patrón idéntico a
 * PropertyMiniCard.tsx (reusar > reescribir).
 *
 * Posicionamiento: absolute top con offset de safe area vía useSafeAreaInsets
 * (SafeAreaProvider montado en app/_layout.tsx — garantizado).
 *
 * Props controladas: value / on_change → el padre (MapContent) posee el estado.
 *
 * ponytail: ícono 'options-outline' (filtros) es puramente visual. Los filtros
 *   reales (precio, tipo, operación) son trabajo futuro fuera del scope de #11.
 */

import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface MapSearchBarProps {
  value: string;
  on_change: (text: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function MapSearchBar({ value, on_change }: MapSearchBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.container, { top: insets.top + spacing.s_8 }]}
    >
      {/* ── Liquid Glass: capa blur ────────────────────────────────────────── */}
      <BlurView tint="light" intensity={30} style={StyleSheet.absoluteFill} />

      {/*
       * Overlay semi-translúcido para legibilidad del texto.
       * ponytail: rgba derivado de colors.paper (#F6F2EB) a 0.72 — mismo overlay
       *   que PropertyMiniCard.tsx para coherencia visual.
       */}
      <View style={styles.overlay} />

      {/* ── Fila de contenido ─────────────────────────────────────────────── */}
      <View style={styles.row}>
        <Ionicons name="search" size={18} color={colors.gray_2} />

        <TextInput
          style={styles.input}
          value={value}
          onChangeText={on_change}
          placeholder="Buscar zona o ciudad"
          placeholderTextColor={colors.gray_2}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        {/* ponytail: filtros reales (precio/tipo/operación) = trabajo futuro (#11 scope) */}
        <Ionicons name="options-outline" size={20} color={colors.gray_2} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * Pill flotante absoluto en la parte superior de la pantalla.
   * overflow:'hidden' permite que BlurView y overlay queden recortados por
   * el borderRadius. El `top` se inyecta dinámicamente via insets.top + s_8.
   */
  container: {
    position: 'absolute',
    left: spacing.s_16,
    right: spacing.s_16,
    borderRadius: radii.r_pill,
    overflow: 'hidden',
    borderWidth: 1,
    // ponytail: borde idéntico al de PropertyMiniCard — rgba de colors.paper_3
    borderColor: 'rgba(227, 220, 207, 0.60)',
    ...shadows.md,
  },

  /**
   * Overlay semi-translúcido encima del blur.
   * rgba(246, 242, 235, 0.72) = colors.paper a 0.72 de opacidad.
   */
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(246, 242, 235, 0.72)',
  },

  /** Fila: lupa | input | sliders. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    gap: spacing.s_8,
  },

  /**
   * TextInput controlado. padding/margin 0 para no romper el layout vertical
   * de la pill. fontFamily sans_semibold para diferenciarse del placeholder.
   */
  input: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
    padding: 0,
    margin: 0,
  },
});
