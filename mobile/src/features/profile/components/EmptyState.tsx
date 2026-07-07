/**
 * EmptyState — estado vacío de marca, reutilizable (subtarea 16.6 + 15.9;
 * pulido flash 2026-07-06: íconos Phosphor en vez de emoji, CTA opcional y
 * variante oscura para el feed inmersivo).
 *
 * Uso base (grid de propiedades del perfil):
 *   <EmptyState is_own_profile={true} />
 *
 * Uso con copy/CTA personalizado (cualquier pantalla):
 *   <EmptyState icon={MagnifyingGlass} message="Sin resultados"
 *               subtitle="Prueba otro filtro."
 *               cta_label="Publicar" onPressCta={...} dark />
 *
 * Cableado: se pasa como ListEmptyComponent a FlatList/FlashList o se
 * renderiza directo en pantallas de estado.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HouseLine, type Icon } from 'phosphor-react-native';

import { colors, radii, shadows, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  is_own_profile?: boolean;
  // ponytail: override props para reusar fuera del dominio profile
  message?: string;
  subtitle?: string;
  /** Ícono Phosphor (default: HouseLine). */
  icon?: Icon;
  /** Etiqueta del botón de acción; sin ella no se pinta CTA. */
  cta_label?: string;
  onPressCta?: () => void;
  /** Variante para fondos oscuros (feed inmersivo). */
  dark?: boolean;
}

// ---------------------------------------------------------------------------
// Constantes de copy
// ---------------------------------------------------------------------------

const DEFAULT_TITLE = 'Aún no hay propiedades';

const SUBTITLE_OWN = 'Publica tu primera propiedad';
const SUBTITLE_OTHER = 'Este agente aún no tiene publicaciones';

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function EmptyState({
  is_own_profile = false,
  message,
  subtitle: subtitle_prop,
  icon,
  cta_label,
  onPressCta,
  dark = false,
}: EmptyStateProps) {
  const title    = message       ?? DEFAULT_TITLE;
  const subtitle = subtitle_prop ?? (is_own_profile ? SUBTITLE_OWN : SUBTITLE_OTHER);
  const IconCmp  = icon          ?? HouseLine;

  return (
    <View style={styles.container}>
      {/* Ícono de marca sobre disco tintado */}
      <View
        style={[styles.icon_disc, dark && styles.icon_disc_dark]}
        importantForAccessibility="no"
      >
        <IconCmp
          size={34}
          color={dark ? colors.primary_soft : colors.primary}
          weight="duotone"
        />
      </View>

      <Text style={[styles.title, dark && styles.title_dark]}>{title}</Text>
      <Text style={[styles.subtitle, dark && styles.subtitle_dark]}>{subtitle}</Text>

      {cta_label && onPressCta ? (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.cta_pressed]}
          onPress={onPressCta}
          accessibilityRole="button"
          accessibilityLabel={cta_label}
        >
          <Text style={styles.cta_label}>{cta_label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_32,
    paddingHorizontal: spacing.s_24,
  },
  icon_disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary_tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s_16,
  },
  icon_disc_dark: {
    backgroundColor: 'rgba(94,147,121,0.16)',
  },
  title: {
    ...type_scale.h1,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.s_8,
  },
  title_dark: {
    color: colors.paper,
  },
  subtitle: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
  },
  subtitle_dark: {
    color: colors.gray_1,
  },
  cta: {
    marginTop: spacing.s_16,
    paddingVertical: 12,
    paddingHorizontal: spacing.s_24,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
    ...shadows.primary,
  },
  cta_pressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
  cta_label: {
    ...type_scale.body,
    fontFamily: 'HankenGrotesk_600SemiBold',
    color: colors.on_primary,
  },
});
