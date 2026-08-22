/**
 * useFeedActiveIndex — encapsula la lógica de autoplay/pause del feed vertical.
 *
 * Combina tres señales independientes:
 *   1. Viewability: el ítem más visible (≥70 %, durante ≥100 ms) define activeIndex.
 *   2. AppState: cuando la app va a background/inactive, ningún ítem está activo.
 *   3. Foco de tab: cuando se navega fuera del feed, ningún ítem está activo.
 *
 * #207 le agregó un efecto de salida: cuando (2) y (3) dicen que el feed dejó
 * de verse, se vacía la cola de impresiones de anuncios. El porqué vive aquí y
 * no en un hook aparte está explicado abajo, junto al efecto.
 *
 * Devuelve `viewabilityConfigCallbackPairs` (ref estable para FlashList v2,
 * que lanza si la referencia cambia tras el montaje) y un helper `isItemActive`.
 *
 * ponytail: tres booleans simples + un useRef — sin librería de estado extra.
 *   `ViewabilityConfigCallbackPairs` no está en el index público de flash-list v2;
 *   se deriva de FlashListProps para no depender de sub-paths internos.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router'; // SDK 56: useFocusEffect en expo-router, NO en @react-navigation/native
import type { FlashListProps, ViewToken } from '@shopify/flash-list';

import { ad_impression_queue } from '../lib/adImpressionQueue';
import type { FeedItem } from '../lib/interleaveAds';

// ViewabilityConfigCallbackPairs no se re-exporta en el index público de flash-list v2,
// por lo que se deriva de FlashListProps para evitar imports de sub-paths privados.
// 170.4: FeedItem (heterogéneo, propiedades+anuncios) — el hook es genérico en
// runtime (solo usa `index`, nunca el shape del item), por eso este es
// puramente un cambio de TIPO, sin comportamiento nuevo que testear aquí.
type FeedViewabilityPairs = NonNullable<
  FlashListProps<FeedItem>['viewabilityConfigCallbackPairs']
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

  // ── Señal 1: viewability — array estable (FlashList v2 lanza si cambia) ───
  // set_active_index (de useState) es estable por contrato de React, por lo
  // que capturarlo en la inicialización del useMemo (deps []) es seguro.
  // ponytail: useMemo en vez de useRef.current — misma referencia estable
  // entre renders, sin leer un ref durante el render (react-hooks/refs).
  const pairs = useMemo<FeedViewabilityPairs>(
    () => [
      {
        viewabilityConfig: {
          itemVisiblePercentThreshold: 70,
          minimumViewTime: 100,
        },
        onViewableItemsChanged: ({
          viewableItems,
        }: {
          viewableItems: ViewToken<FeedItem>[];
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
    ],
    [],
  );

  // ── Salida del feed: vaciar la cola de impresiones (#207) ─────────────────
  //
  // 🔴 POR QUÉ VIVE AQUÍ. Hasta #207 la cola de `adImpressionQueue` solo se
  // vaciaba al llegar a 10 exposiciones, y `ad_max_per_session` es 5: nunca se
  // vaciaba. Las impresiones se encolaban y morían con el proceso —
  // `ad_impressions` llevaba semanas congelada. El módulo daba por hecho «el
  // flush que manda es el de salir de la pantalla», y ese flush no existía.
  // El arreglo NO es un hook nuevo: sería un segundo cable que FeedScreen
  // tendría que acordarse de conectar, y un cable olvidado es exactamente el
  // bug. Este hook ya calcula la señal —y ya lo llama el único consumidor.
  //
  // 🔴 POR QUÉ ES UN EFECTO Y NO UN LISTENER DE AppState PROPIO. `AdFeedItem`
  // cierra y ENCOLA su exposición en un efecto que reacciona a `isActive`. Un
  // listener propio correría en el mismo tick que el de arriba, o sea ANTES de
  // que React re-renderice al hijo: vaciaría una cola vacía y perdería la
  // última exposición, la que la persona acababa de ver. Como efecto pasivo
  // del padre, en cambio, corre DESPUÉS de los de los hijos del mismo commit.
  //
  // ponytail: sin flush en el desmontaje. Salir del feed pasa siempre por el
  // blur del tab (que ya dispara esto), y en un desmontaje los cleanups corren
  // de padre a hijo — el flush llegaría antes de que el hijo encole, justo el
  // orden que este efecto evita. Un force-stop no ejecuta cleanups de ninguna
  // forma. Techo conocido: sin persistencia, un force-stop pierde el batch
  // (decisión ya tomada en 170.7 — subcontar sí, duplicar facturable no).
  const is_feed_visible = is_app_active && is_focused;
  useEffect(() => {
    if (is_feed_visible) return;
    void ad_impression_queue.flush();
  }, [is_feed_visible]);

  // ── Helper compuesto ───────────────────────────────────────────────────────
  const isItemActive = useCallback(
    (index: number): boolean => index === active_index && is_feed_visible,
    [active_index, is_feed_visible],
  );

  return {
    viewabilityConfigCallbackPairs: pairs,
    isItemActive,
  };
}
