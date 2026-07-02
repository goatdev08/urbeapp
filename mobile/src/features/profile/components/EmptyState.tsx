/**
 * EmptyState — estado vacío reutilizable (subtarea 16.6 + 15.9).
 *
 * Uso base (grid de propiedades del perfil):
 *   <EmptyState is_own_profile={true} />
 *
 * Uso con copy personalizado (cualquier pantalla):
 *   <EmptyState message="Sin resultados" subtitle="Prueba otro filtro." icon="🔍" />
 *
 * Props opcionales message/subtitle/icon sobreescriben los valores por defecto;
 * los usos actuales de profile sin esas props siguen igual.
 *
 * Cableado: se pasa como ListEmptyComponent al FlatList de PropertiesGrid.
 * Subtarea 16.6.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  is_own_profile?: boolean;
  // ponytail: override props para reusar fuera del dominio profile
  message?: string;
  subtitle?: string;
  icon?: string;
}

// ---------------------------------------------------------------------------
// Constantes de copy
// ---------------------------------------------------------------------------

const DEFAULT_TITLE = 'Aún no hay propiedades';
const DEFAULT_ICON = '🏠';

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
}: EmptyStateProps) {
  const title    = message       ?? DEFAULT_TITLE;
  const subtitle = subtitle_prop ?? (is_own_profile ? SUBTITLE_OWN : SUBTITLE_OTHER);
  const ico      = icon          ?? DEFAULT_ICON;

  return (
    <View style={styles.container}>
      {/* Ícono discreto en texto, sin dep. de librería de íconos */}
      <Text style={styles.icon} importantForAccessibility="no">
        {ico}
      </Text>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
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
  icon: {
    fontSize: 48,
    marginBottom: spacing.s_16,
    opacity: 0.55,
  },
  title: {
    ...type_scale.h1,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.s_8,
  },
  subtitle: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
