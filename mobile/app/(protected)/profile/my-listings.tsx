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
 * Subtarea 17.1.
 */
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

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
import type { MyProperty } from '@/features/profile/types';
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
  // 17.2: hook real; renderItem=null hasta 17.3 (ListingCard)
  const { loading: _loading, error: _error, data } = useMyProperties();
  const listings: ListingItem[] = data ?? [];

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

  /**
   * Devuelve los callbacks del menú para un item dado.
   * TODO 17.7: reemplazar stubs con mutaciones reales (invocar EF update-property-status).
   * TODO 17.8: on_edit debe navegar al wizard con los datos del item.
   */
  const get_menu_callbacks = (_item: MyProperty): PropertyActionCallbacks => ({
    on_edit: () => {
      // TODO 17.8 — navegar al wizard de edición con _item.id
      console.log('[menu] editar', _item.id);
      Alert.alert('Próximamente', 'Edición disponible en la siguiente versión.');
    },
    on_toggle_pause: () => {
      // TODO 17.7 — llamar EF update-property-status (active↔paused)
      const next = _item.status === 'active' ? 'paused' : 'active';
      console.log('[menu] toggle pause', _item.id, '→', next);
      Alert.alert('Próximamente', `Cambio a ${next} disponible en la siguiente versión.`);
    },
    on_close: () => {
      // TODO 17.7 — confirmar y llamar EF update-property-status → closed
      console.log('[menu] cerrar', _item.id);
      Alert.alert('Próximamente', 'Cierre disponible en la siguiente versión.');
    },
    on_delete: () => {
      // TODO 17.7 — confirmación destructiva y delete
      console.log('[menu] eliminar', _item.id);
      Alert.alert('Próximamente', 'Eliminación disponible en la siguiente versión.');
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
