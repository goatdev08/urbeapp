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
 * FASE RED (296.5) — stub sin lógica: todas las funciones lanzan
 * `not_implemented`. GREEN las implementa.
 */

import type { FeedTab } from '@/features/search/lib/feedSection';
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

/**
 * Key determinista de `(filters, user_id)` para invalidar el hit si cambia
 * cualquier filtro que afecte el dataset. IGNORA `operation_types` (lo fija
 * el propio tab, no el usuario) — el resto de FilterState SÍ entra,
 * incluyendo `area`/`radius_m` (cambiar de zona cambia el dataset) y
 * `user_id` (dos usuarios nunca comparten entrada).
 */
export function feed_cache_key(_filters: FilterState, _user_id: string | null): string {
  throw new Error('not_implemented');
}

/**
 * Entrada vigente para `(tab, filters_key)`, o `undefined` en miss: sin
 * entrada, `filters_key` distinto, o entrada STALE (`now - fetched_at >
 * FEED_CACHE_TTL_MS`) — en ese último caso la entrada se ELIMINA del Map
 * antes de devolver `undefined` (stale = miss, nunca se re-sirve vencida).
 */
export function get_feed_tab_entry(
  _tab: FeedTab,
  _filters_key: string,
  _now: number,
): FeedTabCacheEntry | undefined {
  throw new Error('not_implemented');
}

/** Escribe/reemplaza la entrada de `tab` (independiente del resto de tabs). */
export function set_feed_tab_entry(_tab: FeedTab, _entry: FeedTabCacheEntry): void {
  throw new Error('not_implemented');
}

/** Actualiza `scroll_index` de la entrada de `tab` SI existe; sin entrada, no-op (no crea). */
export function update_feed_tab_scroll(_tab: FeedTab, _scroll_index: number): void {
  throw new Error('not_implemented');
}

/** Tabs adyacentes a `tab` en el orden de FEED_TABS (para el prefetch de vecinos). */
export function neighbor_tabs(_tab: FeedTab): FeedTab[] {
  throw new Error('not_implemented');
}

/** Vacía TODAS las entradas de todos los tabs (tests / logout). */
export function reset_feed_tab_cache(): void {
  throw new Error('not_implemented');
}
