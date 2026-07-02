/**
 * feedProperties.ts — capa de datos del feed vertical.
 *
 * fetchFeedProperties(cursor?, deps?, filters?):
 *   - Consulta properties activas con video ready.
 *   - Aplica FilterState (#12.7) ADEMÁS de los filtros base (status/deleted_at).
 *   - Invoca mint-video-url EF para obtener signed URLs.
 *   - Merge fail-closed: propiedades sin URL se omiten.
 *   - Paginación por cursor (created_at), LIMIT 10.
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 * `filters` es el ÚLTIMO parámetro opcional (default EMPTY_FILTERS) para no
 * romper las 15 llamadas existentes con 0-2 args.
 */

import { build_filter_query, EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { localizeSignedUrl } from '@/lib/supabase/localizeSignedUrl';

import type { FeedPropertyWithUrl } from '../types';

// ponytail: sin explicit any en la interfaz pública — solo en los internos inevitables
export interface FeedPropertiesDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

const PAGE_SIZE = 10;

type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  property_videos: Array<{ id: string; storage_path: string; position: number }>;
};

export async function fetchFeedProperties(
  cursor?: string,
  deps?: FeedPropertiesDeps,
  filters?: FilterState,
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  // Construye la query base
  let query = client
    .from('properties')
    .select(
      `id, price, address, bedrooms, bathrooms, owner_user_id, agency_id, created_at,
       property_videos(id, storage_path, position)`,
    )
    .eq('status', 'active')
    .is('deleted_at', null);

  // Filtros de usuario (#12.7) — ADEMÁS de los filtros base, nunca en su lugar.
  query = build_filter_query(query, filters ?? EMPTY_FILTERS);

  query = query.order('created_at', { ascending: false }).limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data: rows, error } = (await query) as {
    data: QueryRow[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);

  if (!rows || rows.length === 0) {
    return { data: [], nextCursor: null };
  }

  // Extrae ids para la EF
  const property_ids = rows.map((r) => r.id);

  const { data: ef_data, error: ef_error } = (await client.functions.invoke('mint-video-url', {
    body: { property_ids },
  })) as { data: { videos: MintedVideo[] } | null; error: { message: string } | null };

  if (ef_error) throw new Error(ef_error.message);

  // Índice por property_id para merge O(1)
  const videos_map = new Map<string, MintedVideo>();
  for (const v of ef_data?.videos ?? []) {
    videos_map.set(v.property_id, v);
  }

  // Merge fail-closed: omite propiedades sin signed_url o sin video embebido que corresponda
  const data: FeedPropertyWithUrl[] = [];
  for (const row of rows) {
    const minted = videos_map.get(row.id);
    if (!minted) continue;

    // ponytail: reconciliar por video_id de la EF, no por índice — la EF elige el video
    // READY; tomar [0] sería incorrecto si hay varios videos y el ready no está primero.
    const video_entry = row.property_videos.find((v) => v.id === minted.video_id);
    // ponytail: fail-closed — si el video_id de la EF no matchea ningún embebido, omitir
    if (!video_entry) continue;

    data.push({
      id: row.id,
      price: row.price,
      address: row.address,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      owner_user_id: row.owner_user_id,
      agency_id: row.agency_id,
      created_at: row.created_at,
      video: {
        id: video_entry.id,
        storage_path: video_entry.storage_path,
        position: video_entry.position,
      },
      signed_url: localizeSignedUrl(minted.signed_url),
      video_id: minted.video_id,
    });
  }

  // nextCursor: created_at del último item de la QUERY (no del merge), null si <PAGE_SIZE
  const nextCursor = rows.length === PAGE_SIZE ? (rows[rows.length - 1]!.created_at) : null;

  return { data, nextCursor };
}
