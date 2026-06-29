/**
 * useFeedActiveIndex — encapsula la lógica de autoplay/pause del feed vertical.
 *
 * Combina tres señales independientes:
 *   1. Viewability: el ítem más visible (≥70 %, durante ≥100 ms) define activeIndex.
 *   2. AppState: cuando la app va a background/inactive, ningún ítem está activo.
 *   3. Foco de tab: cuando se navega fuera del feed, ningún ítem está activo.
 *
 * Devuelve `viewabilityConfigCallbackPairs` (ref estable para FlashList v2,
 * que lanza si la referencia cambia tras el montaje) y un helper `isItemActive`.
 *
 * ponytail: tres booleans simples + un useRef — sin librería de estado extra.
 *   `ViewabilityConfigCallbackPairs` no está en el index público de flash-list v2;
 *   se deriva de FlashListProps para no depender de sub-paths internos.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router'; // SDK 56: useFocusEffect en expo-router, NO en @react-navigation/native
import type { FlashListProps, ViewToken } from '@shopify/flash-list';

import type { FeedPropertyWithUrl } from '../types';

// ViewabilityConfigCallbackPairs no se re-exporta en el index público de flash-list v2,
// por lo que se deriva de FlashListProps para evitar imports de sub-paths privados.
type FeedViewabilityPairs = NonNullable<
  FlashListProps<FeedPropertyWithUrl>['viewabilityConfigCallbackPairs']
>;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type UseFeedActiveIndexResult = {
  /** Pares viewabilityConfig/callback estables para pasar a FlashList. */
  viewabilityConfigCallbackPairs: FeedViewabilityPairs;
  /** Devuelve true solo si el ítem en `index` debe reproducirse. */
  isItemActive: (index: number) => boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useFeedActiveIndex(): UseFeedActiveIndexResult {
  const [active_index, set_active_index] = useState(0);
  const [is_app_active, set_is_app_active] = useState(true);
  const [is_focused, set_is_focused] = useState(true);

  // ── Señal 2: AppState ──────────────────────────────────────────────────────
  useEffect(() => {
    const handle_app_state_change = (next_state: AppStateStatus) => {
      set_is_app_active(next_state === 'active');
    };
    const sub = AppState.addEventListener('change', handle_app_state_change);
    return () => sub.remove();
  }, []);

  // ── Señal 3: foco de tab ───────────────────────────────────────────────────
  // useFocusEffect de expo-router (SDK 56) aguarda a que el estado de
  // navegación cargue antes de disparar, lo que evita race conditions en
  // el arranque del tab. El cleanup se llama al perder el foco.
  useFocusEffect(
    useCallback(() => {
      set_is_focused(true);
      return () => {
        set_is_focused(false);
      };
    }, []),
  );

  // ── Señal 1: viewability — ref estable (FlashList v2 lanza si cambia) ─────
  // set_active_index (de useState) es estable por contrato de React, por lo
  // que capturarlo en la inicialización del ref es seguro.
  const pairs_ref = useRef<FeedViewabilityPairs>([
    {
      viewabilityConfig: {
        itemVisiblePercentThreshold: 70,
        minimumViewTime: 100,
      },
      onViewableItemsChanged: ({
        viewableItems,
      }: {
        viewableItems: ViewToken<FeedPropertyWithUrl>[];
      }) => {
        const most_visible = viewableItems[0];
        if (
          most_visible !== undefined &&
          most_visible.index !== null &&
          most_visible.index !== undefined
        ) {
          set_active_index(most_visible.index);
        }
      },
    },
  ]);

  // ── Helper compuesto ───────────────────────────────────────────────────────
  const isItemActive = useCallback(
    (index: number): boolean => index === active_index && is_app_active && is_focused,
    [active_index, is_app_active, is_focused],
  );

  return {
    viewabilityConfigCallbackPairs: pairs_ref.current,
    isItemActive,
  };
}
