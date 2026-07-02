/**
 * SavedScreen — pantalla "Guardados".
 *
 * Muestra la grilla 2-col de propiedades guardadas por el usuario autenticado.
 * Reutiliza PropertyGridCard (shared component) y EmptyState (profile feature).
 *
 * Estados: loading (ActivityIndicator), error (texto + RefreshControl), lista
 * (FlatList numColumns=2 + RefreshControl para pull-to-refresh).
 *
 * Navigation: onPress → '/property/[id]' (Expo Router).
 *
 * ponytail: sin paginación aquí — la cantidad de guardados es acotada en la demo.
 * Se añade cursor-based loading si el dato lo justifica (tarea futura).
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { colors, spacing, type_scale } from '@/theme/theme';
import { PropertyGridCard } from '@/components/PropertyGridCard';
import { EmptyState } from '@/features/profile/components/EmptyState';
import type { GridProperty } from '@/features/profile/types';
import { useSavedProperties } from './hooks/useSavedProperties';

// ---------------------------------------------------------------------------
// Componente separador entre filas de la grilla
// ---------------------------------------------------------------------------

function GridRowSeparator() {
  return <View style={styles.row_gap} />;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export function SavedScreen(): React.JSX.Element {
  const router = useRouter();
  const { properties, loading, error, refetch } = useSavedProperties();
  const [is_refreshing, set_is_refreshing] = useState(false);

  const handle_refresh = useCallback(async () => {
    set_is_refreshing(true);
    await refetch();
    set_is_refreshing(false);
  }, [refetch]);

  const handle_press = useCallback(
    (id: string) => {
      router.push(`/property/${id}`);
    },
    [router],
  );

  // ── Loading inicial ───────────────────────────────────────────────────────
  if (loading && properties.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error && properties.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.error_text}>{error}</Text>
      </View>
    );
  }

  // ── Lista (incluye estado vacío vía ListEmptyComponent) ───────────────────
  return (
    <FlatList<GridProperty>
      data={properties}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.column_wrapper}
      contentContainerStyle={styles.list_content}
      ItemSeparatorComponent={GridRowSeparator}
      ListHeaderComponent={<View style={styles.list_header} />}
      ListEmptyComponent={
        // ponytail: EmptyState del perfil — texto diferente para "Guardados".
        // is_own_profile=false → copy neutro; sobreescribimos con children si
        // el copy difiere demasiado del perfil. Aquí usamos EmptyState con
        // prop is_own_profile=false y añadimos texto debajo del ícono vía
        // un wrapper. Alternativa simple: EmptyState custom inline.
        <View style={styles.empty_wrapper}>
          <Text style={styles.empty_icon} importantForAccessibility="no">
            🔖
          </Text>
          <Text style={styles.empty_title}>Aún no tienes propiedades guardadas</Text>
          <Text style={styles.empty_subtitle}>
            Guarda propiedades desde el feed para verlas aquí.
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={is_refreshing}
          onRefresh={handle_refresh}
          tintColor={colors.primary}
        />
      }
      renderItem={({ item }) => (
        <PropertyGridCard item={item} onPress={() => handle_press(item.id)} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const COL_GAP = spacing.s_12;
const H_PAD = spacing.s_16;

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  error_text: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
    paddingHorizontal: H_PAD,
  },
  list_content: {
    flexGrow: 1,
    paddingHorizontal: H_PAD,
    paddingBottom: spacing.s_32,
    backgroundColor: colors.paper,
  },
  list_header: {
    height: spacing.s_16,
  },
  column_wrapper: {
    gap: COL_GAP,
  },
  row_gap: {
    height: COL_GAP,
  },
  // ── Empty state ────────────────────────────────────────────────────────────
  empty_wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_32,
    paddingHorizontal: H_PAD,
  },
  empty_icon: {
    fontSize: 48,
    marginBottom: spacing.s_16,
    opacity: 0.55,
  },
  empty_title: {
    ...type_scale.h1,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.s_8,
  },
  empty_subtitle: {
    ...type_scale.body,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
