/**
 * PropertiesGrid — grilla 2 columnas de propiedades del agente.
 *
 * Usa FlatList con numColumns={2} (no ScrollView+map) para aprovechar
 * el renderizado virtualizado.
 *
 * Props:
 *   owner_user_id  — user_id del agente cuyas propiedades se muestran.
 *   onPressProperty — callback con el property_id al tocar una celda.
 *
 * Estados:
 *   loading → GridSkeleton (grilla fantasma).
 *   error   → texto discreto con el mensaje.
 *   vacío   → FlatList vacío; ListEmptyComponent lo maneja 16.6.
 *
 * Celda: <PropertyGridCard> (implementado en 16.5). flex:1 en la card +
 * aspectRatio:4/5 en el media — sin cálculo manual de CELL_WIDTH/CELL_HEIGHT.
 */

import React from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GridSkeleton } from '@/components/GridSkeleton';
import { PropertyGridCard } from '@/components/PropertyGridCard';
import { colors, spacing, type_scale } from '@/theme/theme';
import { usePropertiesGrid } from '../hooks/usePropertiesGrid';
import type { GridProperty } from '../types';
import { EmptyState } from './EmptyState';

// ---------------------------------------------------------------------------
// Constantes de layout
// ---------------------------------------------------------------------------

// ponytail: CELL_WIDTH/CELL_HEIGHT eliminados — PropertyGridCard usa flex:1 +
// aspectRatio:4/5 en el media, el grid calcula el ancho automáticamente.
const HORIZONTAL_PADDING = spacing.s_16;
const COLUMN_GAP = spacing.s_8;

// ---------------------------------------------------------------------------
// Tipos de props
// ---------------------------------------------------------------------------

export interface PropertiesGridProps {
  owner_user_id: string;
  onPressProperty: (property_id: string) => void;
  /** Controla el copy del EmptyState: propio vs. ajeno. */
  is_own_profile?: boolean;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PropertiesGrid({
  owner_user_id,
  onPressProperty,
  is_own_profile = false,
}: PropertiesGridProps): React.JSX.Element {
  const { loading, error, data } = usePropertiesGrid(owner_user_id);

  if (loading) {
    // Grilla fantasma en lugar de spinner: sin salto de layout al llegar data.
    return <GridSkeleton />;
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error_text}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList<GridProperty>
      data={data ?? []}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.column_wrapper}
      contentContainerStyle={styles.list_content}
      renderItem={({ item }) => (
        <PropertyGridCard
          item={item}
          onPress={() => onPressProperty(item.id)}
        />
      )}
      ListEmptyComponent={<EmptyState is_own_profile={is_own_profile} />}
      scrollEnabled={false}
      // La pantalla padre (profile) es el scroll container; deshabilitar scroll
      // propio evita scroll anidado. Si la grilla se extrae de ese contexto,
      // cambiar a scrollEnabled={true}.
    />
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_32,
  },
  error_text: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
    paddingHorizontal: spacing.s_16,
  },
  list_content: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: spacing.s_24,
  },
  column_wrapper: {
    gap: COLUMN_GAP,
    marginBottom: COLUMN_GAP,
  },
});
