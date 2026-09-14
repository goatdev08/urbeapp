/**
 * feedSources.ts — resolutor de fuente por tab del feed (#296.4, decisión
 * 2026-09-14 exploración 050 + /tm-plan 296).
 *
 * Para ti/Venta/Renta = "proximidad": fetchFeedProperties INTACTA
 * (properties_within_radius, contrato publicado §0.5.2 — no se toca).
 * Siguiendo = "por_owner": follows del usuario (RLS follows_select solo abre
 * mis filas, #78) → .in('owner_user_id', ids) sobre la página del feed.
 * Nuevos = "ordenada": PostgREST directo por published_at desc, SIN radio ni
 * RPC (invariante A1, #42.1: radius_m/area nunca llegan aquí).
 *
 * Nota: properties_feed_idx indexa (status, created_at desc), no
 * published_at — irrelevante con ~8 propiedades activas en producción; esta
 * subtarea no abre migraciones (derivada hardening(296) para el índice).
 *
 * ponytail: deuda — "ordenada"/"por_owner" NUNCA tienen páginas cortas
 * (filtros dentro de la query, a diferencia de fetchFeedProperties, que
 * filtra DESPUÉS del slice de ids de la RPC, #42.2); esa deuda queda descrita
 * solo ahí, no se duplica aquí.
 */

import { build_filter_query, EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FeedTab } from '@/features/search/lib/feedSection';
import type { FilterState } from '@/features/search/types';

import {
  FEED_SELECT,
  PAGE_SIZE,
  build_feed_data,
  fetch_agent_profiles,
  fetchFeedProperties,
  mint_videos,
  type FeedPropertiesDeps,
  type QueryRow,
} from './feedProperties';
import type { FeedPropertyWithUrl } from '../types';

/** Fuente de datos del feed: de qué universo de propiedades se sirve la página. */
export type FeedSource = 'proximidad' | 'por_owner' | 'ordenada';

/** tab → fuente. Para ti/Venta/Renta = proximidad; Siguiendo = por_owner; Nuevos = ordenada. */
export function source_for_tab(tab: FeedTab): FeedSource {
  if (tab === 'siguiendo') return 'por_owner';
  if (tab === 'nuevos') return 'ordenada';
  return 'proximidad';
}

/** Ids de los usuarios que `user_id` sigue (tabla `follows`). */
export async function fetch_followed_owner_ids(
  client: any,
  user_id: string,
): Promise<string[]> {
  const { data, error } = (await client
    .from('follows')
    .select('followed_user_id')
    .eq('follower_user_id', user_id)) as {
    data: { followed_user_id: string }[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.followed_user_id);
}

/**
 * Página de propiedades ordenadas por `published_at` desc, sin radio (tab
 * "Nuevos"), o filtradas por `owner_user_id` cuando llegan `owner_ids` (tab
 * "Siguiendo"). Orden de salida = orden de las filas (sin re-sort, a
 * diferencia de fetchFeedProperties que re-ordena por distancia).
 */
export async function fetch_ordered_properties(
  cursor: string | undefined,
  deps: FeedPropertiesDeps | undefined,
  filters: FilterState,
  owner_ids?: string[],
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)
  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;
  const offset = cursor ? parseInt(cursor, 10) : 0;

  let query = client.from('properties').select(FEED_SELECT).eq('status', 'active').is('deleted_at', null);

  if (owner_ids && owner_ids.length > 0) {
    query = query.in('owner_user_id', owner_ids);
  }

  // Filtros de usuario (#12.7) — ADEMÁS de status/deleted_at/owner_user_id.
  // radius_m/area NUNCA llegan aquí: build_filter_query no los conoce
  // (invariante A1, #42.1) — "Nuevos"/"Siguiendo" no tienen radio.
  query = build_filter_query(query, filters);

  query = query
    .order('published_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data: rows, error } = (await query) as {
    data: QueryRow[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);

  if (!rows || rows.length === 0) {
    return { data: [], nextCursor: null };
  }

  const minted_videos = await mint_videos(
    client,
    rows.map((r) => r.id),
  );
  const profiles = await fetch_agent_profiles(
    client,
    rows.map((r) => r.owner_user_id),
  );

  const data = build_feed_data(rows, minted_videos, profiles);
  const nextCursor = rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : null;

  return { data, nextCursor };
}

/** Despacha la carga de una página del feed según el tab activo. */
export async function fetch_feed_page(
  cursor: string | undefined,
  deps: FeedPropertiesDeps | undefined,
  // ponytail: opcional — proximidad reenvía tal cual a fetchFeedProperties
  // (que ya tolera undefined); ordenada/por_owner solo la necesitan definida
  // para build_filter_query, de ahí el fallback puntual abajo.
  filters: FilterState | undefined,
  ctx: { tab: FeedTab; user_id: string | null },
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  const source = source_for_tab(ctx.tab);

  if (source === 'proximidad') {
    return fetchFeedProperties(cursor, deps, filters);
  }

  if (source === 'ordenada') {
    return fetch_ordered_properties(cursor, deps, filters ?? EMPTY_FILTERS);
  }

  // por_owner ("Siguiendo"): sin usuario o sin follows → vacío, SIN tocar
  // `properties` ni mintear (CTA "Explorar el feed" es responsabilidad de FeedScreen).
  if (!ctx.user_id) {
    return { data: [], nextCursor: null };
  }

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;
  const owner_ids = await fetch_followed_owner_ids(client, ctx.user_id);
  if (owner_ids.length === 0) {
    return { data: [], nextCursor: null };
  }

  return fetch_ordered_properties(cursor, deps, filters ?? EMPTY_FILTERS, owner_ids);
}
