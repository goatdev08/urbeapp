/**
 * EmptyState — estado vacío para el grid de propiedades del perfil.
 *
 * Muestra un ícono discreto + título + subtítulo cuando el agente
 * no tiene propiedades publicadas.
 *
 * Props:
 *   is_own_profile — varía el copy: propio (CTA de publicar) vs. ajeno (lectura).
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
}

// ---------------------------------------------------------------------------
// Constantes de copy
// ---------------------------------------------------------------------------

const TITLE = 'Aún no hay propiedades';

const SUBTITLE_OWN = 'Publica tu primera propiedad';
const SUBTITLE_OTHER = 'Este agente aún no tiene publicaciones';

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function EmptyState({ is_own_profile = false }: EmptyStateProps) {
  const subtitle = is_own_profile ? SUBTITLE_OWN : SUBTITLE_OTHER;

  return (
    <View style={styles.container}>
      {/* Ícono discreto — casa vacía en texto, sin dep. de librería de íconos */}
      <Text style={styles.icon} importantForAccessibility="no">
        🏠
      </Text>

      <Text style={styles.title}>{TITLE}</Text>
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
