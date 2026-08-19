/**
 * useFeedProperties — hook React que envuelve fetchFeedProperties y compone
 * el feed heterogéneo (propiedades + anuncios intercalados, 170.4).
 *
 * Expone: data (FeedItem[]), isLoading, error, nextCursor, loadInitial,
 * refetch, loadMore. Paginación acumulativa: loadMore apende al array
 * existente.
 *
 * `filters` (opcional, #12.7): al cambiar de identidad (el FilterProvider crea
 * un objeto nuevo en cada set_filter/clear_filters), loadInitial cambia de
 * identidad y el efecto de FeedScreen que depende de loadInitial se vuelve a
 * disparar — refetch automático al aplicar/limpiar filtros, sin plumbing extra.
 *
 * Coords (#42.2): useLocation().coords fluye a fetchFeedProperties vía deps
 * para la RPC de proximidad. Mientras coords sea null (gate de ubicación en
 * 'loading', ver (protected)/_layout.tsx) se pasa deps=undefined y el lib usa
 * su propio fallback GDL + lazy-require del cliente real. Igual que `filters`,
 * coords entra a las deps de loadInitial/loadMore → cuando la coord real llega
 * (cambia de null a objeto), loadInitial cambia de identidad y el efecto de
 * FeedScreen dispara el refetch automáticamente.
 *
 * Composición de anuncios (170.4, dependencias 170.1/170.2/170.3):
 *   - Tras cada fetch exitoso, se consulta el kill-switch `ads_feed_config()`
 *     (sin argumentos). Si `ads_enabled` es false, o la RPC falla/está
 *     malformada, o `deps.supabase` no expone `.rpc` (mock legado de los 14
 *     tests preexistentes de feed/__tests__) ⇒ FAIL-SOFT ABSOLUTO: el feed
 *     se compone solo de propiedades, sin lanzar ni marcar `error`.
 *   - Con ads_enabled=true, se consulta `ads_for_zone` con las coords del
 *     usuario y zona null/null (#195 — el feed hoy no tiene "zona vista"
 *     propia; el RPC resuelve por GPS). Cualquier fallo de esta RPC (error
 *     explícito, promesa rechazada, respuesta no-array) también degrada a
 *     feed normal.
 *   - `interleave_ads` (170.3, pura) decide el orden final; `already_shown_ref`
 *     acumula anuncios mostrados A TRAVÉS de loadInitial/loadMore/refetch
 *     durante la vida del hook (nunca se resetea) para sostener el cap de
 *     sesión (`ad_max_per_session`) entre páginas.
 *
 * ponytail: sin estado extra — loading único para initial y loadMore;
 * techo conocido: sin abort controller (el feed es efímero, sin race visible).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocation } from '@/features/location/LocationProvider';
import type { FilterState } from '@/features/search/types';
import { onPropertyDeleted } from '@/lib/propertyEvents';

import { fetchFeedProperties, type FeedPropertiesDeps } from '../lib/feedProperties';
import { interleave_ads, type FeedAd, type FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

export interface UseFeedPropertiesState {
  data: FeedItem[];
  isLoading: boolean;
  error: string | null;
  nextCursor: string | null;
  /** Carga la primera página (descarta estado previo). */
  loadInitial: () => Promise<void>;
  /** Alias de loadInitial para el patrón pull-to-refresh. */
  refetch: () => Promise<void>;
  /** Carga la siguiente página y apende al array existente. */
  loadMore: () => Promise<void>;
}

/** Config del kill-switch, forma de la fila de `ads_feed_config()`. */
type AdsFeedConfigRow = {
  ads_enabled: boolean;
  ad_frequency_n: number;
  ad_max_per_session: number;
};

const to_property_items = (properties: FeedPropertyWithUrl[]): FeedItem[] =>
  properties.map((property) => ({ kind: 'property', property }));

/**
 * Compone `properties` con anuncios intercalados, o degrada a solo-propiedades
 * ante CUALQUIER falla (gate 170.1 / fail-soft absoluto). `already_shown_ref`
 * se actualiza in-place con los anuncios usados en ESTA llamada.
 */
async function compose_feed_items(
  client: unknown,
  coords: { latitude: number; longitude: number },
  properties: FeedPropertyWithUrl[],
  already_shown_ref: { current: number },
  skip_first_position: boolean,
): Promise<FeedItem[]> {
  const rpc = (client as { rpc?: unknown } | null | undefined)?.rpc;
  if (typeof rpc !== 'function') return to_property_items(properties);
  const call_rpc = rpc as (fn: string, params?: unknown) => Promise<{ data: unknown; error: unknown }>;

  let config: AdsFeedConfigRow;
  try {
    const { data, error } = await call_rpc('ads_feed_config');
    if (error || !Array.isArray(data) || data.length === 0 || !data[0]?.ads_enabled) {
      return to_property_items(properties);
    }
    config = data[0] as AdsFeedConfigRow;
  } catch {
    return to_property_items(properties);
  }

  let ads: FeedAd[];
  try {
    const { data, error } = await call_rpc('ads_for_zone', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_neighborhood_id: null,
      p_municipality_id: null,
    });
    if (error || !Array.isArray(data)) return to_property_items(properties);
    ads = data as FeedAd[];
  } catch {
    return to_property_items(properties);
  }

  const items = interleave_ads(properties, ads, {
    every_n: config.ad_frequency_n,
    max_per_session: config.ad_max_per_session,
    min_gap_between_repeats: config.ad_frequency_n * 2,
    already_shown_count: already_shown_ref.current,
    skip_first_position,
  });

  already_shown_ref.current += items.filter((item) => item.kind === 'ad').length;

  return items;
}

export function useFeedProperties(filters?: FilterState): UseFeedPropertiesState {
  const { coords } = useLocation();
  const [data, set_data] = useState<FeedItem[]>([]);
  // ponytail: arranca en true — FeedScreen siempre llama loadInitial en mount;
  // esto evita un frame de "empty state" antes de que useEffect dispare.
  const [isLoading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [nextCursor, set_next_cursor] = useState<string | null>(null);
  // Anuncios mostrados en ESTA sesión (vida del hook): acumula entre
  // loadInitial/loadMore/refetch, nunca se resetea (170.4, decisión 5).
  const already_shown_ref = useRef(0);

  // ponytail: deps solo se arma cuando ya hay coords reales; sin ellas se pasa
  // undefined y fetchFeedProperties usa su propio lazy-require del singleton
  // + fallback GDL (evita importar '@/lib/supabase/client' en top-level aquí,
  // que lanza sin env vars — mismo motivo que en feedProperties.ts).
  const build_deps = useCallback((): FeedPropertiesDeps | undefined => {
    if (!coords) return undefined;
    const { supabase } = require('@/lib/supabase/client') as { supabase: unknown };
    return { supabase, coords };
  }, [coords]);

  const load_initial = useCallback(async () => {
    // #59: no cargar hasta que haya coords reales. Sin este guard, el primer
    // loadInitial (coords null en cold start) traía el orden centrado en GDL
    // (fallback del lib) y luego saltaba al orden por proximidad al llegar la
    // coord real → "flash".
    if (!coords) return;
    set_is_loading(true);
    set_error(null);
    try {
      const deps = build_deps();
      const result = await fetchFeedProperties(undefined, deps, filters);
      const items = await compose_feed_items(deps?.supabase, coords, result.data, already_shown_ref, true);
      set_data(items);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar el feed');
    } finally {
      set_is_loading(false);
    }
  }, [coords, filters, build_deps]);

  const load_more = useCallback(async () => {
    if (!nextCursor || isLoading || !coords) return;
    set_is_loading(true);
    set_error(null);
    try {
      const deps = build_deps();
      const result = await fetchFeedProperties(nextCursor, deps, filters);
      const items = await compose_feed_items(deps?.supabase, coords, result.data, already_shown_ref, false);
      set_data((prev) => [...prev, ...items]);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar más');
    } finally {
      set_is_loading(false);
    }
  }, [nextCursor, isLoading, coords, filters, build_deps]);

  useEffect(
    () =>
      onPropertyDeleted((id) =>
        set_data((prev) => prev.filter((item) => item.kind !== 'property' || item.property.id !== id)),
      ),
    [],
  );

  return {
    data,
    isLoading,
    error,
    nextCursor,
    loadInitial: load_initial,
    refetch: load_initial,
    loadMore: load_more,
  };
}
