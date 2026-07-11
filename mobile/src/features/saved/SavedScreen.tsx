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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BookmarkSimple } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, glass, spacing, type_scale } from '@/theme/theme';
import { GridSkeleton } from '@/components/GridSkeleton';
import { EmptyState } from '@/features/profile/components/EmptyState';
import type { GridProperty } from '@/features/profile/types';
import { SavedGridItem } from './components/SavedGridItem';
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
  const insets = useSafeAreaInsets();
  const { properties, loading, error, refetch } = useSavedProperties();
  const [is_refreshing, set_is_refreshing] = useState(false);

  // ── Estado local para quitado optimista ──────────────────────────────────
  // hidden_ids acumula ids quitados antes de que el servidor confirme.
  // Cuando refetch completa: si el id vuelve en properties → DELETE falló →
  // lo restauramos (useEffect cleanup). Si no vuelve → DELETE OK → no-op.
  const [hidden_ids, set_hidden_ids] = useState<ReadonlySet<string>>(new Set());

  // Restaura items que volvieron del servidor (indica que el DELETE falló).
  useEffect(() => {
    if (hidden_ids.size === 0) return;
    const server_ids = new Set(properties.map(p => p.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza hidden_ids (quitado optimista) con la lista del servidor tras refetch.
    set_hidden_ids(prev => {
      const next = new Set(prev);
      let changed = false;
      prev.forEach(id => {
        if (server_ids.has(id)) { next.delete(id); changed = true; }
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]); // hidden_ids excluido a propósito — se lee vía set_hidden_ids(prev)

  // Lista visible: propiedades del servidor menos las en vuelo (optimista).
  const displayed_properties = useMemo(
    () => properties.filter(p => !hidden_ids.has(p.id)),
    [properties, hidden_ids],
  );

  const handle_refresh = useCallback(async () => {
    set_is_refreshing(true);
    await refetch();
    set_is_refreshing(false);
  }, [refetch]);

  /** Oculta el item inmediatamente (optimista), con transición de layout
   *  para que la grilla se reacomode suave en vez de saltar. */
  const handle_removed = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    set_hidden_ids(prev => new Set([...prev, id]));
  }, []);

  /** Llamado post-DELETE para reconciliar con el servidor. */
  const handle_synced = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ── Loading inicial: grilla fantasma (sin salto de layout al llegar data) ──
  if (loading && displayed_properties.length === 0) {
    return <GridSkeleton />;
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error && displayed_properties.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.error_text}>{error}</Text>
      </View>
    );
  }

  // ── Lista (incluye estado vacío vía ListEmptyComponent) ───────────────────
  return (
    <FlatList<GridProperty>
      data={displayed_properties}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.column_wrapper}
      contentContainerStyle={[
        styles.list_content,
        // #65.6: GlassTabBar flota (position:absolute) sobre esta pantalla y ya
        // no reserva alto — sin este despeje la última fila queda tapada tras
        // la barra al hacer scroll hasta el fondo.
        { paddingBottom: insets.bottom + glass.floating_content_bottom_offset },
      ]}
      ItemSeparatorComponent={GridRowSeparator}
      ListHeaderComponent={<View style={styles.list_header} />}
      ListEmptyComponent={
        <View style={styles.empty_wrapper}>
          <EmptyState
            icon={BookmarkSimple}
            message="Aún no tienes guardados"
            subtitle="Guarda propiedades desde el feed para verlas aquí."
          />
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
        <SavedGridItem
          item={item}
          on_removed={handle_removed}
          on_synced={handle_synced}
        />
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
    // paddingBottom real se aplica inline (insets.bottom + glass token, #65.6)
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
    justifyContent: 'center',
  },
});
