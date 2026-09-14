/**
 * feedSources.ts — resolutor de fuente por tab del feed (#296.4).
 *
 * STUB fase RED — sin lógica de negocio. Todas las funciones lanzan
 * `not_implemented` para que los tests fallen por aserción/excepción, no por
 * import. Contrato completo (a implementar en GREEN): ver
 * mobile/src/features/feed/__tests__/feedSources.test.ts y
 * mobile/src/features/feed/__tests__/useFeedProperties.tabs.test.tsx.
 */

import type { FeedTab } from '@/features/search/lib/feedSection';
import type { FilterState } from '@/features/search/types';

import type { FeedPropertiesDeps } from './feedProperties';
import type { FeedPropertyWithUrl } from '../types';

/** Fuente de datos del feed: de qué universo de propiedades se sirve la página. */
export type FeedSource = 'proximidad' | 'por_owner' | 'ordenada';

/** tab → fuente. Para ti/Venta/Renta = proximidad; Siguiendo = por_owner; Nuevos = ordenada. */
export function source_for_tab(_tab: FeedTab): FeedSource {
  throw new Error('not_implemented');
}

/** Ids de los usuarios que `user_id` sigue (tabla `follows`). */
export async function fetch_followed_owner_ids(
  _client: unknown,
  _user_id: string,
): Promise<string[]> {
  throw new Error('not_implemented');
}

/**
 * Página de propiedades ordenadas por `published_at` desc, sin radio (tab
 * "Nuevos"), o filtradas por `owner_user_id` cuando llegan `owner_ids` (tab
 * "Siguiendo").
 */
export async function fetch_ordered_properties(
  _cursor: string | undefined,
  _deps: FeedPropertiesDeps | undefined,
  _filters: FilterState,
  _owner_ids?: string[],
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  throw new Error('not_implemented');
}

/** Despacha la carga de una página del feed según el tab activo. */
export async function fetch_feed_page(
  _cursor: string | undefined,
  _deps: FeedPropertiesDeps | undefined,
  _filters: FilterState,
  _ctx: { tab: FeedTab; user_id: string | null },
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  throw new Error('not_implemented');
}
