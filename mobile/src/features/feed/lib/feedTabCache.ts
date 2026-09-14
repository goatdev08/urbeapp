/**
 * feedTabCache.ts — caché en memoria de módulo, por FeedTab (#296.5).
 *
 * Contrato (decisión I1, exploración 050 + /tm-plan 296, orquestador
 * 2026-09-14): cambiar de tab en la fila del feed NO debe re-fetchear ni
 * mostrar skeleton si ya se cargó antes en esta sesión de la app — un Map en
 * memoria por tab, TTL 3h (margen bajo el ~4h de vida de la URL firmada de
 * Stream). Puro: sin AsyncStorage, sin librería — sobrevive solo mientras
 * vive el proceso JS (se pierde en cold start, y eso es intencional: las
 * URLs firmadas no sobreviven un restart de todos modos).
 *
 * STALE = MISS (no re-mint parcial): una entrada vieja se DESCARTA entera
 * (se borra del Map) y el hook vuelve a pedir fetch_feed_page — más simple
 * que intentar refirmar solo lo vencido, y evita servir una mezcla de URLs
 * firmadas con TTLs distintos.
 *
 * FASE GREEN (296.5): Map de módulo, una entrada por FeedTab.
 *
 * ponytail: `get_feed_tab_entry` con stale = MISS que BORRA la entrada (no
 * re-mint parcial de solo las URLs vencidas) — un refetch completo es una
 * sola rama de código y deja datos/URLs siempre consistentes entre sí; techo
 * conocido: se pierde la posición de scroll guardada si pasan las 3h de TTL
 * (raro — implica dejar la app abierta o en background ese tiempo).
 */

import type { FeedTab } from '@/features/search/lib/feedSection';
import { FEED_TABS } from '@/features/search/lib/feedSection';
import type { FilterState } from '@/features/search/types';

import type { LappedFeedItem } from './feedKeyExtractor';

/** 3 horas en ms — margen bajo el TTL (~4h) de la URL firmada de Stream. */
export const FEED_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

export interface FeedTabCacheEntry {
  items: LappedFeedItem[];
  next_cursor: string | null;
  lap: number;
  scroll_index: number;
  fetched_at: number;
  filters_key: string;
}

const cache = new Map<FeedTab, FeedTabCacheEntry>();

/**
 * Key determinista de `(filters, user_id)` para invalidar el hit si cambia
 * cualquier filtro que afecte el dataset. IGNORA `operation_types` (lo fija
 * el propio tab, no el usuario) — el resto de FilterState SÍ entra,
 * incluyendo `area`/`radius_m` (cambiar de zona cambia el dataset) y
 * `user_id` (dos usuarios nunca comparten entrada).
 */
export function feed_cache_key(filters: FilterState, user_id: string | null): string {
  return JSON.stringify({
    user_id,
    property_types: filters.property_types,
    price_min: filters.price_min,
    price_max: filters.price_max,
    zone: filters.zone,
    bedrooms_min: filters.bedrooms_min,
    pet_friendly: filters.pet_friendly,
    allows_no_guarantor: filters.allows_no_guarantor,
    student_friendly: filters.student_friendly,
    radius_m: filters.radius_m,
    area: filters.area,
  });
}

/**
 * Entrada vigente para `(tab, filters_key)`, o `undefined` en miss: sin
 * entrada, `filters_key` distinto, o entrada STALE (`now - fetched_at >
 * FEED_CACHE_TTL_MS`) — en ese último caso la entrada se ELIMINA del Map
 * antes de devolver `undefined` (stale = miss, nunca se re-sirve vencida).
 */
export function get_feed_tab_entry(
  tab: FeedTab,
  filters_key: string,
  now: number,
): FeedTabCacheEntry | undefined {
  const entry = cache.get(tab);
  if (!entry || entry.filters_key !== filters_key) return undefined;
  if (now - entry.fetched_at > FEED_CACHE_TTL_MS) {
    cache.delete(tab);
    return undefined;
  }
  return entry;
}

/** Escribe/reemplaza la entrada de `tab` (independiente del resto de tabs). */
export function set_feed_tab_entry(tab: FeedTab, entry: FeedTabCacheEntry): void {
  cache.set(tab, entry);
}

/** Actualiza `scroll_index` de la entrada de `tab` SI existe; sin entrada, no-op (no crea). */
export function update_feed_tab_scroll(tab: FeedTab, scroll_index: number): void {
  const entry = cache.get(tab);
  if (!entry) return;
  cache.set(tab, { ...entry, scroll_index });
}

/** Tabs adyacentes a `tab` en el orden de FEED_TABS (para el prefetch de vecinos). */
export function neighbor_tabs(tab: FeedTab): FeedTab[] {
  const values = FEED_TABS.map((t) => t.value);
  const index = values.indexOf(tab);
  const neighbors: FeedTab[] = [];
  if (index > 0) neighbors.push(values[index - 1]!);
  if (index >= 0 && index < values.length - 1) neighbors.push(values[index + 1]!);
  return neighbors;
}

/** Vacía TODAS las entradas de todos los tabs (tests / logout). */
export function reset_feed_tab_cache(): void {
  cache.clear();
}
