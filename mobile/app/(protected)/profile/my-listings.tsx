/**
 * Ruta Stack — mis publicaciones del agente autenticado.
 *
 * Pantalla 9 del mockup canónico: accesible desde el perfil propio
 * vía el botón "Mis publicaciones" en ProfileScreen (solo is_own_profile).
 *
 * Alcance 17.1 — scaffolding:
 *   - Header Stack con título "Mis publicaciones" (mismo estilo que edit.tsx).
 *   - Stats placeholder estático (datos reales: 17.2).
 *   - FlatList vacío listo para recibir items (17.3) y filtros (17.6).
 *   - EmptyState reutilizado de features/profile/components.
 *
 * 17.7 — acciones reales:
 *   - pause/unpause llaman a EF update-property-status.
 *   - close abre ClosePropertyDialog (requiere motivo).
 *   - delete abre DeletePropertyDialog (confirmación destructiva).
 *   - Tras acción exitosa → refetch de la lista.
 */
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { ClosePropertyDialog } from '@/features/profile/components/ClosePropertyDialog';
import { DeletePropertyDialog } from '@/features/profile/components/DeletePropertyDialog';
import { EmptyState } from '@/features/profile/components/EmptyState';
import {
  FilterTabs,
  type FilterValue,
} from '@/features/profile/components/FilterTabs';
import {
  PropertyActionMenu,
  type PropertyActionCallbacks,
} from '@/features/profile/components/PropertyActionMenu';
import { PropertyListItem } from '@/features/profile/components/PropertyListItem';
import { useMyProperties } from '@/features/profile/hooks/useMyProperties';
import { usePropertyActions } from '@/features/profile/hooks/usePropertyActions';
import type { MyProperty } from '@/features/profile/types';
import type { ClosedReason } from '@/features/profile/hooks/usePropertyActions';
import { colors, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Tipos — ListingItem es MyProperty; renderItem se expande en 17.3
// ---------------------------------------------------------------------------

/** Alias semántico para el FlatList de esta pantalla. */
type ListingItem = MyProperty;

// ---------------------------------------------------------------------------
// Sub-componente: fila de estadísticas
// ---------------------------------------------------------------------------

/** Fila de estadísticas con conteos reales del array completo. */
function StatsRow({ count_active, count_paused }: { count_active: number; count_paused: number }) {
  return (
    <View style={styles.stats_row}>
      <Text style={styles.stats_text}>
        <Text style={styles.stats_count}>{count_active}</Text> activas
        {'  ·  '}
        <Text style={styles.stats_count}>{count_paused}</Text> pausadas
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function MyListingsScreen() {
  const router = useRouter();
  // 17.2: hook real; renderItem=null hasta 17.3 (ListingCard)
  const { data, refetch } = useMyProperties();
  const listings: ListingItem[] = data ?? [];

  // Acciones de mutación (17.7). isWorking (#25): true mientras una mutación está
  // en vuelo → deshabilita las acciones del menú para evitar disparos concurrentes.
  const { pauseProperty, unpauseProperty, closeProperty, deleteProperty, isWorking } =
    usePropertyActions();

  // ── Filtro de status (17.6) ──────────────────────────────────────────────
  const [active_filter, set_active_filter] = useState<FilterValue>('all');

  /** Conteos calculados sobre el array completo (no el filtrado). */
  const counts: Record<FilterValue, number> = {
    all:    listings.length,
    active: listings.filter((i) => i.status === 'active').length,
    paused: listings.filter((i) => i.status === 'paused').length,
    closed: listings.filter((i) => i.status === 'closed').length,
  };

  /**
   * Array filtrado que recibe el FlatList.
   * 'all' muestra TODOS los items (draft/pending_review/needs_changes/suspended
   * también aparecen aquí — no tienen tab propio; ver FilterTabs.tsx §decisión).
   */
  const filtered_listings: ListingItem[] =
    active_filter === 'all'
      ? listings
      : listings.filter((i) => i.status === active_filter);

  // ── Menú de tres puntos (17.4) ───────────────────────────────────────────
  // null = cerrado; MyProperty = abierto para ese item
  const [menu_item, set_menu_item] = useState<MyProperty | null>(null);

  const close_menu = () => set_menu_item(null);

  // ── Estado de diálogos de confirmación (17.7) ────────────────────────────
  const [close_dialog_item, set_close_dialog_item] = useState<MyProperty | null>(null);
  const [delete_dialog_item, set_delete_dialog_item] = useState<MyProperty | null>(null);

  /**
   * Devuelve los callbacks del menú para un item dado.
   * 17.7: pause/unpause llaman directo; close/delete abren diálogos.
   * 17.8: on_edit debe navegar al wizard con los datos del item.
   */
  const get_menu_callbacks = (item: MyProperty): PropertyActionCallbacks => ({
    // #25: si ya hay una acción en vuelo, las filas del menú se atenúan y no
    // disparan (corta el doble-tap por reapertura del menú).
    disabled: isWorking,
    on_edit: () => {
      close_menu();
      // 17.8 — navega al wizard en edit mode pasando propertyId como param
      router.push({
        pathname: '/(protected)/publish/step1',
        params: { propertyId: item.id },
      });
    },
    on_toggle_pause: () => {
      close_menu();
      // Lanza la acción asíncrona sin bloquear el handler del menú.
      const action = item.status === 'active' ? pauseProperty : unpauseProperty;
      void action({ property_id: item.id }).then((result) => {
        if (result.ok) {
          refetch();
        } else {
          Alert.alert('Error', result.error ?? 'No se pudo actualizar el estado.');
        }
      });
    },
    on_close: () => {
      close_menu();
      set_close_dialog_item(item);
    },
    on_delete: () => {
      close_menu();
      set_delete_dialog_item(item);
    },
  });

  return (
    <>
      {/* Header Stack — mismo estilo que edit.tsx para consistencia */}
      <Stack.Screen
        options={{
          title: 'Mis publicaciones',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
        }}
      />

      {/*
        FlatList vacío:
          - ListHeaderComponent → StatsRow + placeholder para filtros (17.6)
          - ListEmptyComponent  → EmptyState (is_own_profile: esta pantalla es solo propia)
          - renderItem          → PropertyListItem con on_menu_press cableado (17.4)
        contentContainerStyle con flexGrow:1 para que el EmptyState quede centrado.
      */}
      <FlatList<ListingItem>
        style={styles.list}
        contentContainerStyle={styles.list_content}
        data={filtered_listings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PropertyListItem
            item={item}
            on_press={() => {
              // ponytail: navegación a detalle/editar — se implementa en subtarea posterior
            }}
            on_menu_press={() => set_menu_item(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header_block}>
            <StatsRow count_active={counts.active} count_paused={counts.paused} />
            <FilterTabs
              value={active_filter}
              on_change={set_active_filter}
              counts={counts}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState is_own_profile />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Menú de tres puntos — renderiza fuera del FlatList para z-index correcto */}
      <PropertyActionMenu
        visible={menu_item !== null}
        item={menu_item}
        on_dismiss={close_menu}
        callbacks={menu_item ? get_menu_callbacks(menu_item) : {
          on_edit: close_menu,
          on_toggle_pause: close_menu,
          on_close: close_menu,
          on_delete: close_menu,
        }}
      />

      {/* Diálogo de cierre — requiere motivo (17.7) */}
      {close_dialog_item !== null && (
        <ClosePropertyDialog
          visible
          property_id={close_dialog_item.id}
          on_dismiss={() => set_close_dialog_item(null)}
          on_confirm={async ({ property_id, closed_reason }: { property_id: string; closed_reason: ClosedReason }) => {
            const result = await closeProperty({ property_id, closed_reason });
            if (result.ok) {
              set_close_dialog_item(null);
              refetch();
            } else {
              Alert.alert('Error', result.error ?? 'No se pudo cerrar la publicación.');
            }
          }}
        />
      )}

      {/* Diálogo de eliminación — confirmación destructiva (17.7) */}
      {delete_dialog_item !== null && (
        <DeletePropertyDialog
          visible
          property_id={delete_dialog_item.id}
          on_dismiss={() => set_delete_dialog_item(null)}
          on_confirm={async ({ property_id }: { property_id: string }) => {
            const result = await deleteProperty({ property_id });
            if (result.ok) {
              set_delete_dialog_item(null);
              refetch();
            } else {
              Alert.alert('Error', result.error ?? 'No se pudo eliminar la publicación.');
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro (mismo registro visual que edit.tsx / perfil)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list_content: {
    flexGrow: 1,
    paddingHorizontal: spacing.s_16,
    paddingBottom: spacing.s_32,
  },

  // ── Separador entre items ─────────────────────────────────────────────────
  separator: {
    height: spacing.s_8,
  },

  // ── Bloque de cabecera (stats + filtros) ──────────────────────────────────
  header_block: {
    // paddingHorizontal viene del contentContainerStyle (s_16) — no duplicar
    paddingTop: spacing.s_16,
    paddingBottom: spacing.s_8,
  },

  // ── Fila de estadísticas ──────────────────────────────────────────────────
  stats_row: {
    marginBottom: spacing.s_12,
  },
  stats_text: {
    ...type_scale.body,
    color: colors.gray_2,
  },
  stats_count: {
    ...type_scale.body,
    color: colors.ink,
    // ponytail: no peso extra (ya es body); resaltar solo con color
  },

});
