/**
 * PropertiesGrid — grilla 3 columnas de propiedades del agente.
 *
 * Usa FlatList con numColumns={layout.grid_cols} (no ScrollView+map) para
 * aprovechar el renderizado virtualizado.
 *
 * ⚠️ 179.2 — pasó de 2 columnas con padding lateral a 3 columnas BORDE A BORDE
 * (referencia: perfil de Instagram, Abraham 2026-08-16). El ancho de celda se
 * calcula con grid_tile_width() y se pasa al tile: con `gap` + flex:1 la última
 * fila parcial estiraba sus celdas a todo el ancho, justo lo que la referencia
 * no hace.
 *
 * Props:
 *   owner_user_id  — user_id del agente cuyas propiedades se muestran.
 *   onPressProperty — callback con el property_id al tocar una celda.
 *
 * Estados:
 *   loading → GridSkeleton (grilla fantasma, mismo layout: no salta).
 *   error   → texto discreto con el mensaje.
 *   vacío   → FlatList vacío; ListEmptyComponent lo maneja 16.6.
 */

import React from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridSkeleton } from '@/components/GridSkeleton';
import { PropertyGridCard } from '@/components/PropertyGridCard';
import {
  colors,
  floating_content_clearance,
  grid_tile_width,
  layout,
  spacing,
  type_scale,
} from '@/theme/theme';
import { usePropertiesGrid } from '../hooks/usePropertiesGrid';
import type { GridProperty } from '../types';
import { EmptyState } from './EmptyState';

// ---------------------------------------------------------------------------
// Tipos de props
// ---------------------------------------------------------------------------

export interface PropertiesGridProps {
  owner_user_id: string;
  onPressProperty: (property_id: string) => void;
  /** Controla el copy del EmptyState: propio vs. ajeno. */
  is_own_profile?: boolean;
  /**
   * true cuando ProfileScreen se renderiza dentro de (tabs) (tab "Perfil"),
   * donde hay tab bar debajo del contenido — GlassTabBar flotando
   * (position:absolute) en Android (#65.6) o NativeTabs anclada en iOS
   * (#65.10). false en la ruta empujada /profile/[id] (Stack fuera de
   * (tabs)), que NO tiene tab bar — ahí el padding extra sería espacio en
   * blanco injustificado.
   * Default false: el caller (ProfileScreen) reenvía lo que reciba de su ruta.
   */
  under_floating_tab_bar?: boolean;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PropertiesGrid({
  owner_user_id,
  onPressProperty,
  is_own_profile = false,
  under_floating_tab_bar = false,
}: PropertiesGridProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile_width = grid_tile_width(width);
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
      numColumns={layout.grid_cols}
      columnWrapperStyle={styles.column_wrapper}
      contentContainerStyle={[
        styles.list_content,
        under_floating_tab_bar && {
          // #65.11: floating_content_clearance resuelve por plataforma — en
          // iOS (NativeTabs, barra nativa anclada) insets.bottom ya incluye
          // el alto de la barra, solo hace falta un margen chico.
          paddingBottom: insets.bottom + floating_content_clearance,
        },
      ]}
      renderItem={({ item }) => (
        <PropertyGridCard
          item={item}
          width={tile_width}
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
  // Borde a borde: sin padding horizontal (la portada llega al filo).
  list_content: {
    paddingBottom: spacing.s_24,
  },
  column_wrapper: {
    gap: layout.grid_tile_gap,
    marginBottom: layout.grid_tile_gap,
  },
});
