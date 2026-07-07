/**
 * PrimaryButton — botón CTA reutilizable con efecto "liquid glass".
 *
 * El efecto glass en React Native no puede usar `backdrop-filter` (CSS/web),
 * por lo que se construye así:
 *   1. BlurView (expo-blur) crea el fondo desenfocado sobre la superficie de atrás.
 *   2. Un overlay translúcido tintado con SALVIA (#5A8A5E) se superpone al blur,
 *      simulando el tinte cromático del liquid glass.
 *   3. La prop `surface` controla la OPACIDAD del overlay:
 *      - 'light' → superficie clara (onboarding, gestión): overlay más sólido (0.82)
 *        para mantener legibilidad del texto blanco sobre fondo paper.
 *      - 'dark' → superficie oscura (feed): overlay más translúcido (0.48)
 *        para que el contenido del feed se transparente como un cristal de AR.
 *
 * Uso en 6.6 (guardar perfil): loading={isSaving} para feedback async.
 * Reutilizable en CTAs principales: agregar video, iniciar sesión, switch mapa/feed.
 *
 * @example
 *   <PrimaryButton label="Continuar" onPress={handle_continue} surface="light" />
 *   <PrimaryButton label="Saltar" variant="ghost" onPress={handle_skip} surface="light" />
 *   <PrimaryButton label="Guardar" onPress={handle_save} loading={saving} surface="light" />
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { BlurView } from 'expo-blur';

// ---------------------------------------------------------------------------
// Tokens de diseño alineados con el personality kit de Urbea
// ---------------------------------------------------------------------------

/** Color de marca primario — SALVIA. */
const COLOR_SALVIA = '#1A5E44';

/** Opacidad del overlay tintado en superficie CLARA (onboarding/gestión). */
const OVERLAY_OPACITY_LIGHT = 0.82;

/** Opacidad del overlay tintado en superficie OSCURA (feed). */
const OVERLAY_OPACITY_DARK = 0.48;

/** Intensidad de blur para BlurView (0–100, Expo). */
const BLUR_INTENSITY_LIGHT = 60;
const BLUR_INTENSITY_DARK = 80;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PrimaryButtonProps extends Omit<PressableProps, 'style'> {
  /** Texto del botón. */
  label: string;
  /** 'primary' → liquid glass salvia | 'ghost' → borde fino, fondo transparente. */
  variant?: 'primary' | 'ghost';
  /** Superficie de fondo: varía opacidad del overlay. Default 'light'. */
  surface?: 'light' | 'dark';
  /** Muestra ActivityIndicator y deshabilita el botón. */
  loading?: boolean;
  /** Icono opcional a la izquierda del texto. */
  icon?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function PrimaryButton({
  label,
  variant = 'primary',
  surface = 'light',
  loading = false,
  icon,
  disabled,
  onPress,
  accessibilityLabel,
  ...rest
}: PrimaryButtonProps) {
  const is_disabled = disabled === true || loading;

  const blur_intensity = surface === 'light' ? BLUR_INTENSITY_LIGHT : BLUR_INTENSITY_DARK;
  const overlay_opacity = surface === 'light' ? OVERLAY_OPACITY_LIGHT : OVERLAY_OPACITY_DARK;

  const accessible_label = accessibilityLabel ?? label;

  if (variant === 'ghost') {
    return (
      <Pressable
        onPress={onPress}
        disabled={is_disabled}
        accessibilityRole="button"
        accessibilityLabel={accessible_label}
        accessibilityState={{ busy: loading, disabled: is_disabled }}
        style={({ pressed }) => [
          styles.ghost_base,
          pressed && !is_disabled && styles.ghost_pressed,
          is_disabled && styles.ghost_disabled,
        ]}
        {...rest}
      >
        {icon !== undefined && <View style={styles.icon_wrap}>{icon}</View>}
        <Text
          style={[
            styles.ghost_text,
            is_disabled && styles.ghost_text_disabled,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  // variant === 'primary' → liquid glass
  return (
    <Pressable
      onPress={onPress}
      disabled={is_disabled}
      accessibilityRole="button"
      accessibilityLabel={accessible_label}
      accessibilityState={{ busy: loading, disabled: is_disabled }}
      style={({ pressed }) => [
        styles.pill_base,
        is_disabled && styles.pill_disabled_outer,
        pressed && !is_disabled && styles.pill_pressed,
      ]}
      {...rest}
    >
      {/* Capa 1: BlurView — efecto frosted glass sobre la superficie de atrás */}
      <BlurView
        intensity={is_disabled ? 0 : blur_intensity}
        tint={surface === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
      />

      {/* Capa 2: overlay tintado salvia — simula el tinte cromático liquid glass */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.salvia_overlay,
          {
            opacity: is_disabled ? 0.35 : overlay_opacity,
            backgroundColor: COLOR_SALVIA,
          },
        ]}
      />

      {/* Capa 3: borde sutil (reflejo de luz) */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.glass_border,
        ]}
      />

      {/* Capa 4: contenido */}
      <View style={styles.content_row}>
        {icon !== undefined && <View style={styles.icon_wrap}>{icon}</View>}
        {loading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text
            style={[
              styles.primary_text,
              is_disabled && styles.primary_text_disabled,
            ]}
          >
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const PILL_RADIUS = 100;
const PILL_HEIGHT = 54;

const styles = StyleSheet.create({
  // ── Primary (liquid glass) ─────────────────────────────────────────────────
  pill_base: {
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pill_pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  pill_disabled_outer: {
    opacity: 0.45,
  },
  salvia_overlay: {
    borderRadius: PILL_RADIUS,
  },
  glass_border: {
    borderRadius: PILL_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  content_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 1,
  },
  primary_text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  primary_text_disabled: {
    color: 'rgba(255,255,255,0.6)',
  },
  icon_wrap: {
    marginRight: 8,
  },

  // ── Ghost / secundario ─────────────────────────────────────────────────────
  ghost_base: {
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    borderWidth: 1.5,
    borderColor: COLOR_SALVIA,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 24,
  },
  ghost_pressed: {
    backgroundColor: 'rgba(90,138,94,0.08)',
    transform: [{ scale: 0.985 }],
  },
  ghost_disabled: {
    borderColor: '#C4C4C4',
    opacity: 0.5,
  },
  ghost_text: {
    fontSize: 16,
    fontWeight: '500',
    color: COLOR_SALVIA,
    letterSpacing: 0.1,
  },
  ghost_text_disabled: {
    color: '#9CA3AF',
  },
});
