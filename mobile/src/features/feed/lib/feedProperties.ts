/**
 * feedProperties.ts — capa de datos del feed vertical.
 *
 * fetchFeedProperties(cursor?, deps?, filters?):
 *   - `filters.radius_m === null` (#58.3) → SALTA la RPC por completo: query
 *     plana a PostgREST (status/deleted_at + build_filter_query) con
 *     paginación OFFSET vía `.range()`. Sin distance_m, sin re-sort — el
 *     orden es el que devuelve PostgREST.
 *   - `filters.radius_m` numérico (o filters ausente) → path de proximidad
 *     #42.2 (approach A1), INALTERADO: llama SIEMPRE la RPC
 *     properties_within_radius ANTES de PostgREST, devuelve {id, distance_m}[]
 *     ordenado por distancia ASC. Radio = filters.radius_m ?? 5000; si la RPC
 *     devuelve vacío, expande ×2 hasta 3 reintentos (5000→10000→20000→40000);
 *     agotado → data:[] sin tocar PostgREST. Paginación OFFSET sobre los ids
 *     de la RPC (no created_at cursor): page_ids = ids.slice(offset, offset+10)
 *     → .in('id', page_ids). Re-sort cliente por distance_m ASC tras el merge
 *     (PostgREST no garantiza el orden de .in()).
 *   - Ambos paths: aplica FilterState (#12.7) además de los filtros base,
 *     invoca mint-video-url EF para signed URLs, merge fail-closed (propiedades
 *     sin URL se omiten).
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 * `filters` es el ÚLTIMO parámetro opcional (default EMPTY_FILTERS) para no
 * romper las 15 llamadas existentes con 0-2 args.
 */

import { GDL_REGION } from '@/features/map/constants';
import { build_filter_query, EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { localizeSignedUrl } from '@/lib/supabase/localizeSignedUrl';

import type { FeedPropertyWithUrl } from '../types';

// ponytail: sin explicit any en la interfaz pública — solo en los internos inevitables
export interface FeedPropertiesDeps {

  supabase: any;
  /**
   * Coords del usuario para la RPC de proximidad (#42.2). Si se omite, la
   * implementación GREEN usa el centro de Guadalajara como fallback.
   * RED: solo tipo — sin lógica todavía.
   */
  coords?: { latitude: number; longitude: number };
}

const PAGE_SIZE = 10;
const DEFAULT_RADIUS_M = 5000;
const MAX_EXPANSION_ATTEMPTS = 3;
const RADIUS_MULTIPLIER = 2;

type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

/** Fila cruda que devuelve la RPC properties_within_radius (#42.2). */
type RpcRow = { id: string; distance_m: number };

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  // Embed to-one del dueño para el teléfono. PostgREST puede devolver objeto o
  // array de un elemento según la relación; se normaliza al leer.
  users?: { phone: string | null } | { phone: string | null }[] | null;
  property_videos: { id: string; storage_path: string; position: number; thumbnail_url: string | null }[];
};

const FEED_SELECT = `id, price, address, bedrooms, bathrooms, owner_user_id, agency_id, created_at,
       users!properties_owner_user_id_fkey(phone),
       property_videos(id, storage_path, position, thumbnail_url)`;

/**
 * Invoca mint-video-url y hace el merge fail-closed fila↔signed_url.
 * Compartido por el path plano (radius_m=null) y el path de proximidad —
 * ambos necesitan exactamente la misma resolución de URLs (#58.3, ponytail:
 * reusa en vez de duplicar el bloque de merge).
 */
async function mint_and_build_feed_data(client: any, rows: QueryRow[]): Promise<FeedPropertyWithUrl[]> {
  if (rows.length === 0) return [];

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

    // Normaliza el embed to-one (objeto o array de 1) → teléfono del agente o null.
    const owner = Array.isArray(row.users) ? row.users[0] : row.users;
    const agent_phone = owner?.phone ?? null;

    data.push({
      id: row.id,
      price: row.price,
      address: row.address,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      owner_user_id: row.owner_user_id,
      agency_id: row.agency_id,
      created_at: row.created_at,
      agent_phone,
      video: {
        id: video_entry.id,
        storage_path: video_entry.storage_path,
        position: video_entry.position,
        thumbnail_url: video_entry.thumbnail_url ?? null,
      },
      signed_url: localizeSignedUrl(minted.signed_url),
      video_id: minted.video_id,
    });
  }

  return data;
}

export async function fetchFeedProperties(
  cursor?: string,
  deps?: FeedPropertiesDeps,
  filters?: FilterState,
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const offset = cursor ? parseInt(cursor, 10) : 0;

  // #58.3: radius_m===null explícito → path plano PRE-#42, sin RPC ni
  // proximidad. `undefined` (sin filtro) sigue cayendo al path de proximidad
  // con DEFAULT_RADIUS_M (comportamiento previo para llamadas sin filtros).
  if (filters?.radius_m === null) {
    let query = client
      .from('properties')
      .select(FEED_SELECT)
      .eq('status', 'active')
      .is('deleted_at', null);

    // Filtros de usuario (#12.7) — ADEMÁS de los filtros base, nunca en su lugar.
    query = build_filter_query(query, filters ?? EMPTY_FILTERS);
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data: rows, error } = (await query) as {
      data: QueryRow[] | null;
      error: { message: string } | null;
    };

    if (error) throw new Error(error.message);

    const page_rows = rows ?? [];
    const data = await mint_and_build_feed_data(client, page_rows);

    // Página llena (PAGE_SIZE filas) → asume más adelante; corta/vacía → última
    // página. ponytail: sin .count(), se pagina hasta topar página no llena
    // (demo scale, igual criterio que #56).
    const nextCursor = page_rows.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : null;

    return { data, nextCursor };
  }

  // ponytail: fallback centro de Guadalajara (demo cerrada opera ahí, #11)
  // cuando aún no hay coords reales del usuario — reusa GDL_REGION del mapa
  // en vez de redefinir la constante.
  const coords = deps?.coords ?? { latitude: GDL_REGION.latitude, longitude: GDL_REGION.longitude };

  const base_radius = filters?.radius_m ?? DEFAULT_RADIUS_M;

  // RPC de proximidad SIEMPRE antes de PostgREST (#42.2, approach A1). Si
  // devuelve vacío, expande el radio ×2 hasta MAX_EXPANSION_ATTEMPTS
  // reintentos (5000→10000→20000→40000). Error de la RPC → lanza sin reintentar.
  let radius = base_radius;
  let rpc_rows: RpcRow[] = [];
  let attempts = 0;

  while (true) {
    const rpc_result = (await client.rpc('properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: radius,
    })) as { data: RpcRow[] | null; error: { message: string } | null };

    if (rpc_result.error) throw new Error(rpc_result.error.message);

    rpc_rows = rpc_result.data ?? [];

    if (rpc_rows.length > 0 || attempts >= MAX_EXPANSION_ATTEMPTS) break;

    attempts++;
    radius *= RADIUS_MULTIPLIER;
  }

  if (rpc_rows.length === 0) {
    return { data: [], nextCursor: null };
  }

  const rpc_ids = rpc_rows.map((r) => r.id);
  const distance_map = new Map(rpc_rows.map((r) => [r.id, r.distance_m]));

  // Paginación OFFSET sobre los ids de la RPC (no created_at cursor).
  const page_ids = rpc_ids.slice(offset, offset + PAGE_SIZE);

  // Construye la query base
  let query = client
    .from('properties')
    .select(FEED_SELECT)
    .in('id', page_ids)
    .eq('status', 'active')
    .is('deleted_at', null);

  // Filtros de usuario (#12.7) — ADEMÁS de los filtros base, nunca en su lugar.
  // radius_m NUNCA llega aquí: es solo parámetro de la RPC (invariante A1).
  query = build_filter_query(query, filters ?? EMPTY_FILTERS);

  const { data: rows, error } = (await query) as {
    data: QueryRow[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);

  if (!rows || rows.length === 0) {
    return { data: [], nextCursor: null };
  }

  const data = await mint_and_build_feed_data(client, rows);

  // Re-sort cliente por distancia ASC (de la RPC) — PostgREST no garantiza
  // el orden de .in(); Infinity para cualquier id sin distancia conocida.
  data.sort((a, b) => (distance_map.get(a.id) ?? Infinity) - (distance_map.get(b.id) ?? Infinity));

  // nextCursor: sobre el universo de ids de la RPC (no las filas devueltas
  // tras filtros/fail-closed) — páginas cortas post-filtro son aceptables en
  // la demo (#42.2). ponytail: techo conocido, no paginación exhaustiva.
  const nextCursor = offset + PAGE_SIZE < rpc_ids.length ? String(offset + PAGE_SIZE) : null;

  return { data, nextCursor };
}
