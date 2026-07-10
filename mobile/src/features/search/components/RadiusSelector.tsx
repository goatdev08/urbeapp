/**
 * RadiusSelector.tsx — Selector de radio de búsqueda (#58.2).
 *
 * Reemplaza el segmented-control de 4 pills (5/10/20/50 km, #42.1) por un
 * slider continuo (0–50 km, step 1 km) + un toggle "Sin límite" que colapsa
 * el filtro a `radius_m = null` (búsqueda global, #58.1/#58.3/#58.4 ya
 * soportan `null` en feed/mapa/RPC).
 *
 * Mapea a `FilterState.radius_m`, parámetro exclusivo de la RPC
 * `properties_within_radius`; NUNCA viaja por build_filter_query (invariante A1).
 *
 * ponytail: drag con `PanResponder` (API core de React Native, cero
 * dependencia nueva) en vez de react-native-gesture-handler `GestureDetector`.
 * El plan original de la subtarea proponía gesture-handler + reanimated
 * (ambos ya instalados), pero `GestureDetector` engancha internamente el
 * sistema de "worklets" de reanimated (`useEvent`, animated event system) que
 * el mock de test de este repo no reproduce (justificadamente: es un mock
 * ligero pensado para animaciones simples tipo LikeButton, no para el motor
 * de gestos completo) — replicarlo a fondo es sobre-ingeniería para un
 * componente cuyo único comportamiento CONTRATADO/testeable es
 * accessibilityAction increment/decrement (el drag en sí no es simulable en
 * Jest de cualquier forma). PanResponder cumple el mismo requisito no
 * negociable (sin módulo nativo nuevo → OTA-safe) con muchas menos piezas.
 * Techo conocido: sin animación con physics/spring en el thumb (no se pidió).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de rango
// ─────────────────────────────────────────────────────────────────────────────

const MIN_RADIUS_M = 0;
const MAX_RADIUS_M = 50000;
const STEP_M = 1000;

/** Default al desactivar "sin límite" cuando no hay valor numérico previo recordado. */
const DEFAULT_RADIUS_M = 5000;

const THUMB_SIZE = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, v));
}

function round_to_step(v: number): number {
  return Math.round(v / STEP_M) * STEP_M;
}

function format_km_label(value: number | null): string {
  if (value === null) return 'Sin límite';
  return `${Math.round(value / 1000)} km`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface RadiusSelectorProps {
  /**
   * Valor actual en metros (FilterContext.filters.radius_m).
   * null = "sin límite" — el toggle queda activado y el slider deshabilitado.
   */
  value: number | null;
  /** Callback al cambiar el radio (metros) o al activar "sin límite" (null). */
  onChange: (v: number | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function RadiusSelector({ value, onChange }: RadiusSelectorProps): React.JSX.Element {
  const is_unlimited = value === null;
  const effective_value = value ?? DEFAULT_RADIUS_M;

  // Recuerda el último valor numérico para restaurarlo al desactivar "sin
  // límite" (en vez de siempre caer a DEFAULT_RADIUS_M) — decisión de UX del
  // plan finalizado de #58.2. Un ref basta: no dispara render, solo se lee
  // en el press del toggle. Se escribe en un efecto (nunca en el cuerpo del
  // render) — mutar un ref durante el render es inseguro (react-hooks/refs).
  const last_numeric_ref = useRef(value ?? DEFAULT_RADIUS_M);
  useEffect(() => {
    if (value !== null) last_numeric_ref.current = value;
  }, [value]);

  const [track_width, set_track_width] = useState(0);
  const handle_track_layout = useCallback((e: LayoutChangeEvent) => {
    set_track_width(e.nativeEvent.layout.width);
  }, []);

  const handle_toggle_press = useCallback(() => {
    if (is_unlimited) {
      onChange(last_numeric_ref.current || DEFAULT_RADIUS_M);
    } else {
      onChange(null);
    }
  }, [is_unlimited, onChange]);

  const emit_stepped_change = useCallback(
    (next: number) => {
      const clamped = clamp(round_to_step(next));
      if (clamped === effective_value) return; // ya en el tope/piso, no-op
      onChange(clamped);
    },
    [effective_value, onChange],
  );

  const handle_accessibility_action = useCallback(
    (event: AccessibilityActionEvent) => {
      if (is_unlimited) return;
      const action = event.nativeEvent.actionName;
      if (action === 'increment') emit_stepped_change(effective_value + STEP_M);
      else if (action === 'decrement') emit_stepped_change(effective_value - STEP_M);
    },
    [is_unlimited, effective_value, emit_stepped_change],
  );

  // ── Drag (visual — no cubierto por los tests jest, ver nota ponytail) ──────
  // `locationX` es la posición del toque relativa al propio View del
  // responder — da el valor absoluto en cada `move` sin necesitar rastrear
  // un "valor de arranque" en un ref (los refs leídos dentro de closures
  // creadas en render disparan react-hooks/refs).
  const pan_responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !is_unlimited && track_width > 0,
        onMoveShouldSetPanResponder: () => !is_unlimited && track_width > 0,
        onPanResponderMove: (evt) => {
          if (track_width <= 0) return;
          const raw = (evt.nativeEvent.locationX / track_width) * MAX_RADIUS_M;
          emit_stepped_change(raw);
        },
      }),
    [is_unlimited, track_width, emit_stepped_change],
  );

  const ratio = effective_value / MAX_RADIUS_M;
  const usable_width = Math.max(track_width - THUMB_SIZE, 0);

  return (
    <View style={styles.container}>
      <Pressable
        testID="radius_unlimited_toggle"
        onPress={handle_toggle_press}
        style={styles.toggle_row}
        accessibilityRole="switch"
        accessibilityLabel="Sin límite (mostrar todo)"
        accessibilityState={{ checked: is_unlimited }}
      >
        <Text style={styles.toggle_label}>Sin límite (mostrar todo)</Text>
        <View style={[styles.switch_track, is_unlimited && styles.switch_track_on]}>
          <View style={[styles.switch_thumb, is_unlimited && styles.switch_thumb_on]} />
        </View>
      </Pressable>

      <Text testID="radius_value_label" style={styles.value_label}>
        {format_km_label(value)}
      </Text>

      <View
        testID="radius_slider"
        onLayout={handle_track_layout}
        style={[styles.track, is_unlimited && styles.track_disabled]}
        accessible
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: is_unlimited }}
        accessibilityValue={{
          min: MIN_RADIUS_M,
          max: MAX_RADIUS_M,
          now: effective_value,
          text: `${Math.round(effective_value / 1000)} kilómetros`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={handle_accessibility_action}
      >
        <View style={[styles.track_fill, { width: `${ratio * 100}%` }]} />
        <View style={[styles.thumb, { left: ratio * usable_width }]} />
        {/*
         * Overlay separado para el PanResponder del drag: si `panHandlers`
         * (onStartShouldSetResponder/onMoveShouldSetResponder) vive en el
         * MISMO nodo que testID+onAccessibilityAction, @testing-library/
         * react-native trata el nodo como "touch responder" y filtra TODOS
         * los eventos (incluido accessibilityAction) a través de
         * isEventEnabled(), que llama esas funciones y — en el entorno de
         * test, sin layout real, track_width=0 — devuelve false y silencia
         * el evento. Separar el overlay evita el falso negativo sin afectar
         * el drag real en dispositivo (mismo área visual, pointerEvents
         * "box-only" no aplica aquí porque no hay hijos interactivos).
         */}
        <View style={StyleSheet.absoluteFill} {...pan_responder.panHandlers} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos — modo gestión-claro, tokens de theme.ts
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: spacing.s_12,
  },
  toggle_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.ink,
  },
  switch_track: {
    width: 44,
    height: 26,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_3,
    padding: 2,
    justifyContent: 'center',
  },
  switch_track_on: {
    backgroundColor: colors.primary_tint,
  },
  switch_thumb: {
    width: 22,
    height: 22,
    borderRadius: radii.r_pill,
    backgroundColor: colors.gray_1,
  },
  switch_thumb_on: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
  },
  value_label: {
    fontFamily: fonts.sans_bold,
    fontSize: 16,
    color: colors.ink,
  },
  track: {
    height: THUMB_SIZE,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_2,
    justifyContent: 'center',
  },
  track_disabled: {
    opacity: 0.4,
  },
  track_fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary_tint,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
  },
});
