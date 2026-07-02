/**
 * SavedGridItem — celda de la grilla "Guardados" con soporte de long-press.
 *
 * Envuelve PropertyGridCard para instanciar useSaveProperty por propiedad.
 * Long-press → Alert de confirmación → quitado optimista en padre + DELETE en background.
 *
 * Flujo:
 *   1. Usuario confirma "Quitar" → on_removed(id) (padre filtra inmediatamente)
 *   2. toggleSave() hace el DELETE (useSaveProperty con initialSaved=true)
 *   3. on_synced() dispara refetch() DESPUÉS del DELETE — sin race condition
 *   4. Si DELETE falla: useSaveProperty revierte isSaved; refetch trae el item
 *      de vuelta → SavedScreen lo restaura a la lista.
 *
 * ponytail: navegación manejada aquí con useRouter (no prop); mantiene
 * la interfaz mínima hacia SavedScreen (solo on_removed + on_synced).
 */

import React, { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { PropertyGridCard } from '@/components/PropertyGridCard';
import { useSaveProperty } from '@/features/feed/hooks/useSaveProperty';
import type { GridProperty } from '@/features/profile/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SavedGridItemProps {
  item: GridProperty;
  /** Callback inmediato para quitado optimista: el padre filtra localmente. */
  on_removed: (id: string) => void;
  /**
   * Callback post-DELETE para reconciliar con servidor (= refetch del padre).
   * Se llama DESPUÉS de que toggleSave() resuelve para evitar race condition.
   */
  on_synced: () => void | Promise<void>;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function SavedGridItem({
  item,
  on_removed,
  on_synced,
}: SavedGridItemProps): React.JSX.Element {
  const router = useRouter();
  const { toggleSave } = useSaveProperty({ property_id: item.id, initialSaved: true });

  const handle_press = useCallback(() => {
    router.push(`/property/${item.id}`);
  }, [router, item.id]);

  const handle_long_press = useCallback(() => {
    Alert.alert(
      'Quitar de guardados',
      '¿Quitar esta propiedad de tus guardados?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: () => {
            on_removed(item.id);          // (1) quitado optimista inmediato
            void (async () => {
              await toggleSave();          // (2) DELETE en Supabase
              void on_synced();            // (3) refetch post-DELETE (sin race)
            })();
          },
        },
      ],
    );
  }, [item.id, on_removed, on_synced, toggleSave]);

  return (
    <PropertyGridCard
      item={item}
      onPress={handle_press}
      onLongPress={handle_long_press}
    />
  );
}
