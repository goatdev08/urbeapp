/**
 * SavedScreen — pantalla "Guardados".
 *
 * Muestra la grilla 3-col de propiedades guardadas por el usuario autenticado.
 * Reutiliza PropertyGridCard (shared component) y EmptyState (profile feature).
 *
 * Estados: loading (ActivityIndicator), error (texto + RefreshControl), lista
 * (FlatList numColumns=layout.grid_cols + RefreshControl para pull-to-refresh).
 *
 * ⚠️ 179.2 — misma grilla que el perfil: 3 columnas borde a borde con el tile
 * de portada. El ancho de celda se calcula con grid_tile_width() y se pasa al
 * item (ver PropertiesGrid para el porqué de no usar flex:1).
 *
 * Navigation: onPress → '/property/[id]' (Expo Router).
 *
 * Dos puntos de entrada (180.4): el tab `(tabs)/saved` (no-agentes) y la ruta
 * del Stack `profile/saved` (la que abre el botón del perfil, porque para un
 * agente el tab está con `href: null` y no es navegable). Las props solo
 * ajustan el layout — la pantalla es la misma. El título "Guardados" se
 * pinta en dos lugares distintos según el acceso: el Stack header propio en
 * `profile/saved` (has_header=true) o, si no hay Stack header (el tab
 * directo), un título en el propio `ListHeaderComponent` — sin esto el tab
 * arrancaba sin ningún título visible arriba.
 *
 * ponytail: sin paginación aquí — la cantidad de guardados es acotada en la demo.
 * Se añade cursor-based loading si el dato lo justifica (tarea futura).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BookmarkSimple } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  colors,
  floating_content_clearance,
  grid_tile_width,
  layout,
  spacing,
  type_scale,
} from '@/theme/theme';
import { GridSkeleton } from '@/components/GridSkeleton';
import { EmptyState } from '@/features/profile/components/EmptyState';
import type { GridProperty } from '@/features/profile/types';
import { SavedGridItem } from './components/SavedGridItem';
import { useSavedProperties } from './hooks/useSavedProperties';

// ---------------------------------------------------------------------------
// Componente separador entre filas de la grilla
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export interface SavedScreenProps {
  /**
   * false cuando la pantalla se abre como ruta del Stack (`/profile/saved`),
   * que NO tiene tab bar debajo: sin esto sobra el despeje inferior.
   * Default true — el tab `(tabs)/saved` sí la lleva (#65.6/#65.11).
   */
  under_floating_tab_bar?: boolean;
  /**
   * true cuando la ruta trae header de navegación propio: entonces el inset
   * superior ya lo aplica el header y este componente no debe repetirlo.
   */
  has_header?: boolean;
}

export function SavedScreen({
  under_floating_tab_bar = true,
  has_header = false,
}: SavedScreenProps = {}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile_width = grid_tile_width(width);
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

  // ── Refetch al re-enfocar el tab (#155) ──────────────────────────────────
  // Como tab (slot 4 no-agentes) la pantalla queda montada tras la primera
  // visita y el hook solo consulta al montar: guardar/quitar desde el feed o
  // el detalle dejaba esta lista desfasada. Se salta el PRIMER foco porque
  // coincide con el mount (el hook ya fetchea ahí — evita la query doble).
  const is_first_focus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (is_first_focus.current) {
        is_first_focus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

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
      numColumns={layout.grid_cols}
      columnWrapperStyle={styles.column_wrapper}
      contentContainerStyle={[
        styles.list_content,
        // #65.6: GlassTabBar (Android) flota (position:absolute) sobre esta
        // pantalla y ya no reserva alto — sin este despeje la última fila
        // queda tapada tras la barra al hacer scroll hasta el fondo.
        // #65.11: floating_content_clearance resuelve por plataforma — en
        // iOS (NativeTabs, barra nativa anclada) insets.bottom ya incluye el
        // alto de la barra, solo hace falta un margen chico.
        {
          paddingBottom: under_floating_tab_bar
            ? insets.bottom + floating_content_clearance
            : insets.bottom + spacing.s_16,
        },
      ]}
      // 179.2: la grilla es borde a borde y el primer tile llegaba a tocar el
      // status bar (antes lo disimulaba el padding lateral de las cards); esta
      // pantalla no tiene header de navegación propio.
      //
      // Cuando se entra por el tab (has_header=false, usuarios no-agente) no
      // hay Stack header que pinte el título "Guardados" — a diferencia del
      // otro acceso (botón del perfil → /profile/saved, que SÍ trae Stack
      // header con ese título). Sin esto el tab arrancaba con un simple
      // espaciador y ningún título visible arriba.
      ListHeaderComponent={
        has_header ? (
          <View style={{ height: spacing.s_8 }} />
        ) : (
          <View style={[styles.header, { paddingTop: insets.top + spacing.s_16 }]}>
            <Text style={styles.title}>Guardados</Text>
          </View>
        )
      }
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
          width={tile_width}
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
  // Borde a borde: sin padding horizontal (la portada llega al filo).
  list_content: {
    flexGrow: 1,
    // paddingBottom real se aplica inline (insets.bottom + floating_content_clearance, #65.6/#65.11)
    backgroundColor: colors.paper,
  },
  // ── Título del tab (solo cuando !has_header, ver ListHeaderComponent) ──────
  header: {
    paddingHorizontal: layout.screen_inset,
    paddingBottom: spacing.s_16,
  },
  title: {
    ...type_scale.h1,
    color: colors.ink,
  },
  column_wrapper: {
    gap: layout.grid_tile_gap,
    marginBottom: layout.grid_tile_gap,
  },
  // ── Empty state ────────────────────────────────────────────────────────────
  empty_wrapper: {
    flex: 1,
    justifyContent: 'center',
  },
});
