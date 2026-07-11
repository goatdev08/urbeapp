/**
 * Tests fase RED — fetchFeedProperties, modo ZONA ("buscar en esta zona", #56)
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 56.3 — integrar modo zona en feedProperties/mapProperties
 * (exploración .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md)
 *
 * ⚠️ RESTRICCIÓN DURA: modo zona PURAMENTE ADITIVO. Este archivo es NUEVO — NO
 * modifica feedProperties.test.ts / feedProperties.radius-null.test.ts /
 * feedProperties.filters.test.ts (que deben seguir en verde sin cambios).
 *
 * Contrato NUEVO exigido por esta subtarea (rama de zona, evaluada ANTES del
 * flujo GPS #42/#58/#62):
 *   - `filters.area = {center:{lat,lng}, radius_m}` (no null) → la RPC
 *     `properties_within_radius` se llama con `p_lat/p_lng/p_radius_m` de
 *     `area` (NUNCA `deps.coords` ni `filters.radius_m`).
 *   - SIN expansión de radio en modo zona: una sola llamada a la RPC aunque
 *     devuelva vacío (0 resultados → empty state, decisión 2 de la exploración).
 *   - El resto del pipeline igual: `.in('id', page_ids)` + `.eq('status','active')`
 *     + `.is('deleted_at', null)` + `build_filter_query(filters)` (área NUNCA
 *     viaja al builder, invariante A1) + mint-video-url + merge fail-closed +
 *     re-sort por distancia + paginación offset sobre los ids de la RPC.
 *   - Zona GANA sobre `radius_m`: si `area` Y `radius_m` (null o numérico)
 *     coexisten, manda `area` — NUNCA `UNLIMITED_RADIUS_M` ni las coords GPS.
 *   - `filters.area === null` (o `filters` sin `area`) → el flujo GPS actual de
 *     #42/#58/#62 corre SIN cambios (candado de no-regresión explícito).
 *
 * PATRÓN DE MOCK: idéntico a feedProperties.test.ts (query builder thenable +
 * mock de supabase.rpc/functions.invoke), agregando `area` a FilterState.
 *
 * EDGE CASES CUBIERTOS (7 casos):
 * - (EC-Z1) zona_con_resultados_rpc_recibe_center_y_radius_de_area_no_coords_gps
 * - (EC-Z2) zona_con_cero_resultados_sin_expansion_rpc_llamada_una_sola_vez
 * - (EC-Z3) zona_mas_filtro_precio_combinados_area_no_viaja_al_builder
 * - (EC-Z4) zona_gana_sobre_radius_m_null_y_numerico_nunca_unlimited_ni_gps
 * - (EC-Z5) rpc_error_en_zona_lanza_con_mensaje_de_postgis
 * - (EC-Z6) area_null_no_activa_rama_de_zona_usa_coords_gps_actuales
 * - (EC-Z7) zona_pagina_offset_sobre_ids_de_la_rpc_igual_que_hoy
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchFeedProperties, UNLIMITED_RADIUS_M } from '../lib/feedProperties';

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  property_videos: { id: string; storage_path: string; position: number; thumbnail_url: string | null }[];
};

type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };
type InvokeResult = { data: { videos: MintedVideo[] } | null; error: { message: string } | null };
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    address: `Calle ${id} #100, Guadalajara`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${id}`,
    agency_id: null,
    created_at: '2026-07-01T10:00:00Z',
    property_videos: [{ id: `vid-${id}`, storage_path: `agent-uuid-${id}/vid-${id}.mp4`, position: 0, thumbnail_url: null }],
    ...overrides,
  };
}

function make_minted(id: string): MintedVideo {
  return {
    property_id: id,
    video_id: `vid-${id}`,
    signed_url: `https://storage.supabase.co/signed/${id}?token=tok`,
  };
}

const ZONA_CENTRO_TLAQUEPAQUE = { lat: 20.66, lng: -103.35 };

function make_area(overrides: Partial<{ center: { lat: number; lng: number }; radius_m: number }> = {}) {
  return {
    center: ZONA_CENTRO_TLAQUEPAQUE,
    radius_m: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable) — espejo de feedProperties.test.ts
// ---------------------------------------------------------------------------

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    lt: jest.Mock;
    in: jest.Mock;
    gte: jest.Mock;
    then: (
      onFulfilled: (v: QueryResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    lt: jest.fn(),
    in: jest.fn(),
    gte: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'lt', 'in', 'gte'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: {
  query_result?: QueryResult;
  invoke_result?: InvokeResult;
  rpc_result?: RpcResult;
} = {}) {
  const {
    query_result = { data: [], error: null },
    invoke_result = { data: { videos: [] }, error: null },
    rpc_result = {
      data:
        query_result.data === null
          ? [{ id: 'rpc-placeholder-id', distance_m: 1 }]
          : query_result.data.map((r, i) => ({ id: r.id, distance_m: i + 1 })),
      error: null,
    },
  } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);
  const mock_rpc = jest.fn().mockResolvedValue(rpc_result);

  return {
    from: mock_from,
    functions: { invoke: mock_invoke },
    rpc: mock_rpc,
    _mock_from: mock_from,
    _mock_invoke: mock_invoke,
    _mock_rpc: mock_rpc,
    _query_builder: query_builder,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchFeedProperties — modo zona "buscar en esta zona" (#56, aditivo)', () => {

  // ── (EC-Z1) Zona con resultados: RPC recibe center/radius de area ─────────

  it('(EC-Z1) zona_con_resultados_rpc_recibe_center_y_radius_de_area_no_coords_gps: filters.area={center,radius_m:1000} + deps.coords distinto de area.center → client.rpc recibe EXACTAMENTE p_lat/p_lng/p_radius_m de area (no de deps.coords) → 2 ids → resultado con 2 propiedades y .in("id", ids) aplicado', async () => {
    const rows = [make_row('prop-z1'), make_row('prop-z2')];
    const videos = rows.map((r) => make_minted(r.id));
    const rpc_ids: RpcRow[] = [
      { id: 'prop-z1', distance_m: 100 },
      { id: 'prop-z2', distance_m: 200 },
    ];
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area };
    // Coords GPS deliberadamente MUY distintas del centro de la zona — para
    // detectar si la implementación usa por error deps.coords.
    const coords_gps_distintas = { latitude: 19.4326, longitude: -99.1332 };

    const result = await fetchFeedProperties(
      undefined,
      { supabase: mock_supabase, coords: coords_gps_distintas },
      filters,
    );

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(result.data).toHaveLength(2);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', ['prop-z1', 'prop-z2']);
  });

  // ── (EC-Z2) Zona con 0 resultados → SIN expansión, una sola llamada ────────

  it('(EC-Z2) zona_con_cero_resultados_sin_expansion_rpc_llamada_una_sola_vez: filters.area set + RPC devuelve [] → client.rpc llamado EXACTAMENTE 1 vez (sin expansión ×2 aunque area.radius_m sea chico), retorna {data:[], nextCursor:null}, PostgREST NUNCA consultado', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [], error: null },
    });
    const area = make_area({ radius_m: 300 });
    const filters: FilterState = { ...EMPTY_FILTERS, area };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(1);
    // La ÚNICA llamada debe usar los params de la zona (no el fallback GDL ni
    // el radio ilimitado) — ancla que fuerza a leer `filters.area`, no solo a
    // no expandir por casualidad (radius_m se deja en su default null).
    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-Z3) Zona + filtro de precio combinados: area no viaja al builder ──

  it('(EC-Z3) zona_mas_filtro_precio_combinados_area_no_viaja_al_builder: filters.area set + price_min=5000 → RPC recibe params de zona; query builder recibe .gte("price",5000) vía build_filter_query; ninguna llamada del builder incluye "area" o "center" como columna', async () => {
    const rows = [make_row('prop-z3')];
    const videos = rows.map((r) => make_minted(r.id));
    const rpc_ids: RpcRow[] = [{ id: 'prop-z3', distance_m: 50 }];
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area, price_min: 5000 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 5000);

    // Invariante A1: ninguna llamada al builder debe referirse a 'area'/'center'.
    const all_calls = [
      ...mock_supabase._query_builder.eq.mock.calls,
      ...mock_supabase._query_builder.gte.mock.calls,
      ...mock_supabase._query_builder.in.mock.calls,
      ...mock_supabase._query_builder.is.mock.calls,
    ] as unknown[][];
    const area_calls = all_calls.filter(
      (call) => typeof call[0] === 'string' && (call[0].includes('area') || call[0].includes('center')),
    );
    expect(area_calls).toEqual([]);
  });

  // ── (EC-Z4) Zona GANA sobre radius_m (null Y numérico) ─────────────────────

  it('(EC-Z4) zona_gana_sobre_radius_m_null_y_numerico_nunca_unlimited_ni_gps: filters.area set + radius_m:null (Sin límite) simultáneos → RPC usa area.center/area.radius_m — NUNCA UNLIMITED_RADIUS_M ni las coords GPS de deps', async () => {
    const rpc_ids: RpcRow[] = [{ id: 'prop-z4', distance_m: 10 }];
    const mock_supabase = make_mock_supabase({
      query_result: { data: [make_row('prop-z4')], error: null },
      invoke_result: { data: { videos: [make_minted('prop-z4')] }, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area({ radius_m: 2000 });
    const filters_con_null: FilterState = { ...EMPTY_FILTERS, area, radius_m: null };
    const coords_gps = { latitude: 19.4326, longitude: -99.1332 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase, coords: coords_gps }, filters_con_null);

    const primer_llamado = mock_supabase._mock_rpc.mock.calls[0] as [string, { p_lat: number; p_lng: number; p_radius_m: number }];
    expect(primer_llamado[1]).toEqual({
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(primer_llamado[1].p_radius_m).not.toBe(UNLIMITED_RADIUS_M);
    expect(primer_llamado[1].p_lat).not.toBe(coords_gps.latitude);
    expect(primer_llamado[1].p_lng).not.toBe(coords_gps.longitude);

    // También gana con radius_m numérico simultáneo.
    mock_supabase._mock_rpc.mockClear();
    const filters_con_numerico: FilterState = { ...EMPTY_FILTERS, area, radius_m: 3000 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase, coords: coords_gps }, filters_con_numerico);

    const segundo_llamado = mock_supabase._mock_rpc.mock.calls[0] as [string, { p_lat: number; p_lng: number; p_radius_m: number }];
    expect(segundo_llamado[1]).toEqual({
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(segundo_llamado[1].p_radius_m).not.toBe(3000);
  });

  // ── (EC-Z5) Error de RPC en zona → lanza con el mensaje ────────────────────

  it('(EC-Z5) rpc_error_en_zona_lanza_con_mensaje_de_postgis: filters.area set + RPC devuelve {data:null, error:{message:"PostGIS x"}} → fetchFeedProperties lanza Error con ese mensaje exacto', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: null, error: { message: 'PostGIS x' } },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area };

    await expect(
      fetchFeedProperties(undefined, { supabase: mock_supabase }, filters),
    ).rejects.toThrow('PostGIS x');

    // La (única) llamada que produjo el error debe haber usado los params de
    // la zona — ancla que fuerza a leer `filters.area` antes de lanzar.
    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
  });

  // ── (EC-Z6) area null = NO activa la rama de zona; usa el flujo GPS actual ─

  it('(EC-Z6) area_null_no_activa_rama_de_zona_usa_coords_gps_actuales: filters.area=null → la RPC se llama con las coords GPS de deps.coords (o UNLIMITED si radius_m=null), NUNCA con parámetros de zona — candado de no-regresión #42/#58/#62', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [{ id: 'prop-gps', distance_m: 1 }], error: null },
    });
    const coords_gps = { latitude: 20.6597, longitude: -103.3496 };
    const filters: FilterState = { ...EMPTY_FILTERS, area: null, radius_m: 5000 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase, coords: coords_gps }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: coords_gps.latitude,
      p_lng: coords_gps.longitude,
      p_radius_m: 5000,
    });
  });

  // ── (EC-Z7) Paginación en zona: offset sobre ids de la RPC, igual que hoy ─

  it('(EC-Z7) zona_pagina_offset_sobre_ids_de_la_rpc_igual_que_hoy: filters.area set + RPC devuelve 15 ids + cursor="10" → page_ids = ids.slice(10,15) → .in("id", page_ids) con el slice exacto; nextCursor=null', async () => {
    const rpc_rows: RpcRow[] = Array.from({ length: 15 }, (_, i) => ({
      id: `prop-zp-${i + 1}`,
      distance_m: i,
    }));
    const page_ids = rpc_rows.slice(10, 15).map((r) => r.id);
    const page_rows = page_ids.map((id) => make_row(id));
    const videos = page_rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: page_rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_rows, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area };

    const result = await fetchFeedProperties('10', { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', page_ids);
    expect(result.nextCursor).toBeNull();
  });

});
