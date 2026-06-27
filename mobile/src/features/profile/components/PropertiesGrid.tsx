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
 *   loading → ActivityIndicator centrado.
 *   error   → texto discreto con el mensaje.
 *   vacío   → FlatList vacío; ListEmptyComponent lo maneja 16.6.
 *
 * Celda: placeholder mínima inline (price + status, fondo paper_2, radius r_16).
 * TODO 16.5: reemplazar por <PropertyGridCard>.
 *
 * ponytail: cálculo de ancho de celda vía Dimensions — se recalcula solo
 * si el layout de la pantalla cambia (onLayout en el contenedor sería más
 * robusto, pero Dimensions es suficiente para la demo de 3 semanas).
 */

import React from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, radii, spacing, type_scale } from '@/theme/theme';
import { usePropertiesGrid } from '../hooks/usePropertiesGrid';
import type { GridProperty } from '../types';

// ---------------------------------------------------------------------------
// Constantes de layout
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = Dimensions.get('window').width;
const HORIZONTAL_PADDING = spacing.s_16;
const COLUMN_GAP = spacing.s_8;
// Ancho de cada celda: (pantalla - 2 padding lateral - gap entre columnas) / 2
const CELL_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - COLUMN_GAP) / 2;
// Proporción 3:4 para la celda (foto vertical típica de propiedad)
const CELL_HEIGHT = CELL_WIDTH * (4 / 3);

// ---------------------------------------------------------------------------
// Tipos de props
// ---------------------------------------------------------------------------

export interface PropertiesGridProps {
  owner_user_id: string;
  onPressProperty: (property_id: string) => void;
}

// ---------------------------------------------------------------------------
// Celda placeholder (reemplazar en 16.5)
// ---------------------------------------------------------------------------

function PropertyCell({
  item,
  on_press,
}: {
  item: GridProperty;
  on_press: () => void;
}): React.JSX.Element {
  // TODO 16.5: reemplazar por <PropertyGridCard item={item} onPress={on_press} />
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={on_press}
      style={styles.cell}
    >
      {/* Área de thumbnail — placeholder hasta que 16.5 implemente el card real */}
      <View style={styles.cell_thumb_placeholder} />
      <View style={styles.cell_info}>
        <Text style={styles.cell_price} numberOfLines={1}>
          ${item.price.toLocaleString('es-MX')}
        </Text>
        <Text style={styles.cell_status} numberOfLines={1}>
          {item.status}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PropertiesGrid({
  owner_user_id,
  onPressProperty,
}: PropertiesGridProps): React.JSX.Element {
  const { loading, error, data } = usePropertiesGrid(owner_user_id);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
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
        <PropertyCell
          item={item}
          on_press={() => onPressProperty(item.id)}
        />
      )}
      // TODO 16.6: ListEmptyComponent para el estado vacío global
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
  cell: {
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_16,
    overflow: 'hidden',
  },
  cell_thumb_placeholder: {
    flex: 1,
    backgroundColor: colors.paper_3,
  },
  cell_info: {
    padding: spacing.s_8,
  },
  cell_price: {
    ...type_scale.body,
    color: colors.ink,
    fontWeight: '600',
  },
  cell_status: {
    ...type_scale.caption,
    color: colors.gray_2,
    textTransform: 'uppercase',
  },
});
