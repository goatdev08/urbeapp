/**
 * Tests fase RED — fetchMapProperties, modo ZONA ("buscar en esta zona", #56)
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 * Subtarea Taskmaster: 56.3 — integrar modo zona en feedProperties/mapProperties
 * (exploración .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md)
 *
 * ⚠️ RESTRICCIÓN DURA: modo zona PURAMENTE ADITIVO. Este archivo es NUEVO — NO
 * modifica mapProperties.test.ts / mapProperties.radius-null.test.ts /
 * mapProperties.filters.test.ts (que deben seguir en verde sin cambios).
 *
 * Contrato NUEVO exigido por esta subtarea (rama de zona, evaluada ANTES del
 * check `radius_m === null` — decisión 7 de la exploración: la zona también
 * acota los MARCADORES del mapa, no solo el feed):
 *   - `filters.area = {center:{lat,lng}, radius_m}` (no null) → la RPC
 *     `properties_within_radius` se llama con `p_lat/p_lng/p_radius_m` de
 *     `area`, SIN expansión de radio (una sola llamada).
 *   - Query: `.in('id', rpc_ids)` con TODOS los ids de la RPC (el mapa no
 *     pagina) + base (`status`/`deleted_at`) + `build_filter_query` (area
 *     NUNCA viaja al builder, invariante A1) + `build_map_result` (fail-closed
 *     sobre parse_location, reusado tal cual).
 *   - Zona GANA sobre `radius_m === null`: con `area` set, NO se va por la
 *     query plana de #58.3 — se va por la RPC de zona con `.in('id', ...)`.
 *   - `filters.area === null` → las ramas actuales (#58.3 plana + #42.3
 *     proximidad) corren SIN cambios (candado de no-regresión explícito).
 *
 * PATRÓN DE MOCK: idéntico a mapProperties.test.ts (query builder thenable +
 * mock de supabase.rpc), agregando `area` a FilterState.
 *
 * EDGE CASES CUBIERTOS (5 casos):
 * - (EC-ZM1) zona_con_marcadores_rpc_recibe_center_y_radius_de_area_tres_ids
 * - (EC-ZM2) zona_mas_filtro_tipo_propiedad_combinados_area_no_viaja_al_builder
 * - (EC-ZM3) zona_con_parse_location_fallido_fail_closed_reusado
 * - (EC-ZM4) zona_gana_sobre_radius_m_null_no_va_por_query_plana
 * - (EC-ZM5) area_null_no_activa_zona_ramas_actuales_intactas
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties } from '../lib/mapProperties';
import type { MapProperty } from '../types';

/** WKT de Guadalajara: lng=-103.35, lat=20.67 */
const WKT_GDL = 'POINT(-103.35 20.67)';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type QueryRow = {
  id: string;
  price: number;
  address: string;
  property_type: string;
  operation_type: 'rent' | 'sale' | 'both';
  bedrooms: number | null;
  bathrooms: number | null;
  location: string | null;
};

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    address: `Av. Vallarta ${id}, Guadalajara, Jalisco`,
    property_type: 'house',
    operation_type: 'sale',
    bedrooms: 3,
    bathrooms: 2,
    location: WKT_GDL,
    ...overrides,
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
// Mock del query builder encadenable (thenable) — espejo de mapProperties.test.ts
// ---------------------------------------------------------------------------

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    in: jest.Mock;
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
    in: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: { query_result?: QueryResult; rpc_result?: RpcResult } = {}) {
  const { query_result = { data: [], error: null } } = opts;
  const {
    rpc_result = {
      data:
        query_result.data === null || query_result.data.length === 0
          ? [{ id: 'rpc-placeholder-id', distance_m: 1 }]
          : query_result.data.map((r) => ({ id: r.id, distance_m: 1 })),
      error: null,
    },
  } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_rpc = jest.fn().mockResolvedValue(rpc_result);

  return {
    from: mock_from,
    rpc: mock_rpc,
    _mock_from: mock_from,
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

describe('fetchMapProperties — modo zona "buscar en esta zona" (#56, aditivo)', () => {

  // ── (EC-ZM1) Zona con marcadores: RPC recibe center/radius de area ────────

  it('(EC-ZM1) zona_con_marcadores_rpc_recibe_center_y_radius_de_area_tres_ids: filters.area={center,radius_m:1000} + deps.coords distinto de area.center → client.rpc recibe EXACTAMENTE p_lat/p_lng/p_radius_m de area → 3 ids → resultado con 3 markers y .in("id", ids) aplicado', async () => {
    const rows = [make_row('prop-zm1'), make_row('prop-zm2'), make_row('prop-zm3')];
    const rpc_ids: RpcRow[] = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area };
    const coords_gps_distintas = { latitude: 19.4326, longitude: -99.1332 };

    const result = await fetchMapProperties({ supabase: mock_supabase, coords: coords_gps_distintas }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(result).toHaveLength(3);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith(
      'id',
      rows.map((r) => r.id),
    );
  });

  // ── (EC-ZM2) Zona + filtros: area no viaja al builder ──────────────────────

  it('(EC-ZM2) zona_mas_filtro_tipo_propiedad_combinados_area_no_viaja_al_builder: filters.area set + property_types=["house"] → RPC recibe params de zona; query builder recibe .in("property_type",["house"]) vía build_filter_query; ninguna llamada del builder incluye "area"/"center" como columna', async () => {
    const rows = [make_row('prop-zm4', { property_type: 'house' })];
    const rpc_ids: RpcRow[] = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area, property_types: ['house'] };

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('property_type', ['house']);

    const area_calls = (mock_supabase._query_builder.eq.mock.calls as unknown[][]).filter(
      (call) => typeof call[0] === 'string' && (call[0].includes('area') || call[0].includes('center')),
    );
    expect(area_calls).toEqual([]);
  });

  // ── (EC-ZM3) Zona con parse_location fallido → fail-closed reusado ────────

  it('(EC-ZM3) zona_con_parse_location_fallido_fail_closed_reusado: filters.area set + RPC devuelve 3 ids + 1 fila con location:null → resultado tiene exactamente 2 markers (la fila sin location se omite, mismo fail-closed que #42.3)', async () => {
    const rows = [
      make_row('prop-zm-ok-1'),
      make_row('prop-zm-null', { location: null }),
      make_row('prop-zm-ok-2'),
    ];
    const rpc_ids: RpcRow[] = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area();
    const filters: FilterState = { ...EMPTY_FILTERS, area };

    const result = await fetchMapProperties({ supabase: mock_supabase }, filters);

    // Ancla: la RPC debe haberse llamado con los params de la zona (no el
    // fallback GDL/proximidad por defecto) — fuerza a leer `filters.area`.
    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(result).toHaveLength(2);
    const ids = result.map((p: MapProperty) => p.id);
    expect(ids).toContain('prop-zm-ok-1');
    expect(ids).toContain('prop-zm-ok-2');
    expect(ids).not.toContain('prop-zm-null');
  });

  // ── (EC-ZM4) Zona GANA sobre radius_m===null: NO va por la query plana ───

  it('(EC-ZM4) zona_gana_sobre_radius_m_null_no_va_por_query_plana: filters.area set + radius_m:null (que sin zona iría por la query plana de #58.3) → SÍ llama la RPC de zona y aplica .in("id", rpc_ids); NO se comporta como el path plano', async () => {
    const rows = [make_row('prop-zm5')];
    const rpc_ids: RpcRow[] = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const area = make_area({ radius_m: 2500 });
    const filters: FilterState = { ...EMPTY_FILTERS, area, radius_m: null };

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: area.center.lat,
      p_lng: area.center.lng,
      p_radius_m: area.radius_m,
    });
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', ['prop-zm5']);
  });

  // ── (EC-ZM5) area null → ramas actuales intactas (plana y proximidad) ────

  it('(EC-ZM5) area_null_no_activa_zona_ramas_actuales_intactas: filters.area=null + radius_m=null → query PLANA sin RPC (no-regresión #58.3); filters.area=null + radius_m=5000 → RPC de proximidad GPS actual con .in("id", rpc_ids) (no-regresión #42.3)', async () => {
    // Sub-caso A: area:null + radius_m:null → path plano, sin RPC.
    const rows_plano = [make_row('prop-plano-1')];
    const mock_supabase_plano = make_mock_supabase({ query_result: { data: rows_plano, error: null } });
    const filters_plano: FilterState = { ...EMPTY_FILTERS, area: null, radius_m: null };

    const result_plano = await fetchMapProperties({ supabase: mock_supabase_plano }, filters_plano);

    expect(mock_supabase_plano._mock_rpc).not.toHaveBeenCalled();
    expect(result_plano).toHaveLength(1);

    // Sub-caso B: area:null + radius_m:5000 → path de proximidad GPS actual.
    const rows_prox = [make_row('prop-prox-1')];
    const rpc_ids_prox: RpcRow[] = rows_prox.map((r) => ({ id: r.id, distance_m: 1 }));
    const coords_gps = { latitude: 20.6597, longitude: -103.3496 };
    const mock_supabase_prox = make_mock_supabase({
      query_result: { data: rows_prox, error: null },
      rpc_result: { data: rpc_ids_prox, error: null },
    });
    const filters_prox: FilterState = { ...EMPTY_FILTERS, area: null, radius_m: 5000 };

    await fetchMapProperties({ supabase: mock_supabase_prox, coords: coords_gps }, filters_prox);

    expect(mock_supabase_prox._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: coords_gps.latitude,
      p_lng: coords_gps.longitude,
      p_radius_m: 5000,
    });
    expect(mock_supabase_prox._query_builder.in).toHaveBeenCalledWith('id', ['prop-prox-1']);
  });

});
