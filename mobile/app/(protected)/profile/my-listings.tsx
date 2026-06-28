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
import React from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { EmptyState } from '@/features/profile/components/EmptyState';
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

/** Placeholder estático de conteo. Los valores reales llegan en 17.2. */
function StatsRow() {
  return (
    <View style={styles.stats_row}>
      {/* ponytail: placeholder estático — datos reales en 17.2 */}
      <Text style={styles.stats_text}>
        <Text style={styles.stats_count}>0</Text> activas
        {'  ·  '}
        <Text style={styles.stats_count}>0</Text> pausadas
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
          - renderItem          → null placeholder, reemplazado en 17.3 con ListingCard
        contentContainerStyle con flexGrow:1 para que el EmptyState quede centrado.
      */}
      <FlatList<ListingItem>
        style={styles.list}
        contentContainerStyle={styles.list_content}
        data={listings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PropertyListItem
            item={item}
            on_press={() => {
              // ponytail: navegación a detalle/editar — se implementa en subtarea posterior
            }}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header_block}>
            <StatsRow />
            {/* Placeholder del bloque de filtros (17.6) */}
            <View style={styles.filters_placeholder} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState is_own_profile />
        }
        showsVerticalScrollIndicator={false}
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

  // ── Placeholder filtros (17.6 conectará aquí) ────────────────────────────
  filters_placeholder: {
    // Altura 0: sin espacio visual hasta que 17.6 lo pueble
    height: 0,
  },
});
