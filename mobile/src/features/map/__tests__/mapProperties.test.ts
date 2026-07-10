/**
 * Tests fase RED — fetchMapProperties
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 * Subtarea Taskmaster: 11.2 — Fetch active properties and convert PostGIS geography to lat/lng
 * REDISEÑO (#42.3 — RPC de proximidad, approach A1 lean, espejo de #42.2 en el feed):
 *
 * SUT: fetchMapProperties(deps?, filters?) → Promise<MapProperty[]>
 *
 * Contrato:
 *   - `radius = filters.radius_m ?? 5000`. Llama SIEMPRE
 *     `client.rpc('properties_within_radius', { p_lat, p_lng, p_radius_m: radius })`
 *     ANTES de tocar PostgREST. `p_lat/p_lng` vienen de `deps.coords` (fallback
 *     GDL si se omite — no cubierto aquí, es responsabilidad de la impl GREEN).
 *   - Expansión de radio: si la RPC devuelve `[]`, reintenta ×2 hasta
 *     MAX_ATTEMPTS=3 (radios 5000→10000→20000→40000). Si los 4 intentos
 *     devuelven vacío → `[]` SIN tocar PostgREST.
 *   - RPC con error → lanza inmediatamente (sin reintentar).
 *   - Query: `.in('id', ids)` con TODOS los ids de la RPC (SIN slice — el mapa
 *     NO pagina) + `.eq('status','active')` + `.is('deleted_at', null)` +
 *     `build_filter_query(query, filters)` intacto (`radius_m` jamás al builder).
 *   - Por cada row, convierte location (geography PostGIS) a {lat,lng} via parse_location
 *     importado de @/features/property-detail/utils/parseLocation (NO reimplementado).
 *   - INVARIANTE CRÍTICA fail-closed: filas con location null o no parseable se OMITEN.
 *     Nunca se renderiza un marcador en coords inválidas o (0,0).
 *   - Orden correcto: lng=X (primer número del POINT), lat=Y (segundo número).
 *     POINT(lng lat) — una inversión es un bug silencioso que pone el marcador en lugar erróneo.
 *   - operation_type es passthrough exacto: 'rent' | 'sale' | 'both'.
 *   - SIN re-sort: los markers no tienen orden (a diferencia del feed).
 *   - Query error → lanza Error(message). Data vacío → devuelve [].
 *
 * PATRÓN DE MOCK (espejo de feedProperties.test.ts #42.2):
 *   - `supabase.rpc('properties_within_radius', {...})` → resuelve a
 *     `{ data: {id,distance_m}[] | null, error }`. Por default, `make_mock_supabase`
 *     DERIVA los ids de la RPC a partir de `query_result.data` (o un id placeholder
 *     si `query_result.data` es null) para que los 10 tests EC-1..EC-10 heredados
 *     no necesiten tocar su cuerpo — solo el arnés cambió.
 *
 * EDGE CASES CUBIERTOS (14 casos):
 *
 * ### Happy path
 * - (EC-1) happy_path_dos_rows_validas_devuelve_dos_map_properties
 * - (EC-10) ewkb_hex_parseado_correctamente_lat_lng_precisos
 *
 * ### Orden lng/lat (invariante crítica PostGIS)
 * - (EC-2) orden_lnglat_wkt_point_lat_correcto_lng_correcto
 *
 * ### Fail-closed: filas inválidas se omiten
 * - (EC-3) location_null_fila_omitida_fail_closed
 * - (EC-4) location_no_parseable_fila_omitida_fail_closed
 * - (EC-5) mezcla_tres_rows_una_null_devuelve_dos
 *
 * ### Passthrough de campos
 * - (EC-6) passthrough_operation_type_both_y_campos_null_preservados
 *
 * ### Error / boundary
 * - (EC-7) error_query_supabase_lanza_error_y_from_fue_llamado
 * - (EC-8) data_vacio_devuelve_array_vacio
 *
 * ### Filtros de query
 * - (EC-9) query_filtra_status_active_y_deleted_at_null
 *
 * ### RPC de proximidad, expansión de radio, sin slice/paginación (#42.3 — NUEVOS)
 * - (EC-MAP-1) rpc_recibe_coords_de_deps_y_radius_m_de_filters_query_recibe_in_con_todos_los_ids_sin_slice
 * - (EC-MAP-2) expansion_de_radio_5000_a_10000_cuando_rpc_devuelve_vacio_en_primer_intento
 * - (EC-MAP-2b) expansion_agotada_4_intentos_devuelve_vacio_sin_tocar_postgrest
 * - (EC-MAP-3) rpc_devuelve_error_lanza_excepcion_sin_reintentar
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties } from '../lib/mapProperties';
import type { MapProperty } from '../types';

// ---------------------------------------------------------------------------
// Coordenadas de prueba verificadas
// Origen: node -e "buf.writeDoubleLE(lng,9); ..." → valores pasados a parse_ewkb_point
//
// WKT "POINT(lng lat)" — formato texto de PostgREST cuando se castea ::text
// EWKB hex — formato por defecto que PostgREST emite para geography(Point,4326)
// ---------------------------------------------------------------------------

/** WKT de Guadalajara: lng=-103.35, lat=20.67 */
const WKT_GDL = 'POINT(-103.35 20.67)';

/** EWKB hex de CDMX: lng=-99.1332, lat=19.4326 (little-endian, SRID=4326) */
const EWKB_CDMX = '0101000020E6100000F1F44A5986C858C0E63FA4DFBE6E3340';

/** WKT de un segundo punto válido para tests de mezcla */
const WKT_MONTERREY = 'POINT(-100.3161 25.6866)';

// ---------------------------------------------------------------------------
// Tipo auxiliar para rows de query (lo que devuelve Supabase antes del parseo)
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

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Crea una fila de query con valores predecibles. */
function make_row(overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id: 'prop-uuid-1',
    price: 1650000,
    address: 'Av. Vallarta 100, Guadalajara, Jalisco',
    property_type: 'house',
    operation_type: 'sale',
    bedrooms: 3,
    bathrooms: 2,
    location: WKT_GDL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable)
//
// PostgREST client de Supabase devuelve un PostgrestFilterBuilder thenable:
// cada método de filtro devuelve el mismo objeto; al `await`ar se llama `.then()`.
// Para mapProperties no hay cursor ni paginación → no se mockea .limit() ni .lt().
// ---------------------------------------------------------------------------

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };

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

  // Cada método encadenable devuelve el propio builder.
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

// ---------------------------------------------------------------------------
// Mock del cliente Supabase completo
// ---------------------------------------------------------------------------

/** Fila cruda que devuelve la RPC properties_within_radius (#42.3). */
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

function make_mock_supabase(opts: { query_result?: QueryResult; rpc_result?: RpcResult } = {}) {
  const { query_result = { data: [], error: null } } = opts;
  const {
    // ponytail: default DERIVADO — si no se pasa rpc_result explícito, la RPC
    // "encuentra" exactamente los ids de query_result.data (o un id placeholder
    // si query_result.data es null, para que el flujo SIGA llegando a PostgREST
    // y el error de la query pueda observarse — ver EC-7). Esto evita tocar el
    // cuerpo de los 10 tests EC-1..EC-10 preexistentes (espejo de feed #42.2).
    // ponytail: la derivación cubre null Y [] — un query_result.data vacío
    // (EC-8/EC-9, ambos data:[]) NO debe traducirse en una RPC vacía: eso
    // dispararía la expansión de radio (ver EC-MAP-2b) y el SUT regresaría
    // SIN tocar PostgREST, rompiendo EC-9 (que exige from() llamado). Solo
    // un array NO vacío de query_result.data produce ids reales derivados;
    // en cualquier otro caso (null o []) se usa el placeholder para que el
    // flujo SIEMPRE llegue a construir + await la query de PostgREST.
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
    // Expuestos para aserciones directas
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

describe('fetchMapProperties', () => {

  // ── (EC-1) Happy path: 2 rows válidas (WKT + EWKB) → 2 MapProperty ────────

  it('(EC-1) happy_path_dos_rows_validas_devuelve_dos_map_properties: 2 rows con location válida (WKT GDL + EWKB CDMX) → array de 2 MapProperty con id, lat, lng, price, address, operation_type, property_type', async () => {
    const rows: QueryRow[] = [
      make_row({ id: 'prop-gdl', location: WKT_GDL, price: 1650000 }),
      make_row({ id: 'prop-cdmx', location: EWKB_CDMX, price: 2800000, address: 'Roma Norte, CDMX' }),
    ];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(2);

    const gdl = result.find((p: MapProperty) => p.id === 'prop-gdl');
    const cdmx = result.find((p: MapProperty) => p.id === 'prop-cdmx');

    expect(gdl).toBeDefined();
    expect(cdmx).toBeDefined();

    // Verificar campos obligatorios en cada MapProperty
    for (const item of result) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.price).toBe('number');
      expect(typeof item.lat).toBe('number');
      expect(typeof item.lng).toBe('number');
      expect(typeof item.address).toBe('string');
      expect(typeof item.operation_type).toBe('string');
      expect(typeof item.property_type).toBe('string');
    }
  });

  // ── (EC-2) Orden lng/lat: POINT(lng lat) — atrapa inversión silenciosa ──────

  it('(EC-2) orden_lnglat_wkt_point_lat_correcto_lng_correcto: POINT(-103.35 20.67) → lat=20.67, lng=-103.35; verifica que lat NO es -103.35 ni lng es 20.67', async () => {
    const rows: QueryRow[] = [make_row({ id: 'prop-gdl', location: 'POINT(-103.35 20.67)' })];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(1);
    const item = result[0]!;

    // El segundo número del POINT es la latitud (Y), el primero es la longitud (X)
    expect(item.lat).toBe(20.67);
    expect(item.lng).toBe(-103.35);

    // Aserción negativa: atrapa la inversión clásica de coordenadas
    expect(item.lat).not.toBe(-103.35);
    expect(item.lng).not.toBe(20.67);
  });

  // ── (EC-3) location null → fila omitida (fail-closed) ─────────────────────

  it('(EC-3) location_null_fila_omitida_fail_closed: row con location=null → no aparece en resultado; nunca se crea MapProperty sin coordenadas', async () => {
    const rows: QueryRow[] = [make_row({ id: 'prop-sin-coords', location: null })];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(0);
    expect(result.find((p: MapProperty) => p.id === 'prop-sin-coords')).toBeUndefined();
  });

  // ── (EC-4) location basura/no parseable → fila omitida (fail-closed) ───────

  it('(EC-4) location_no_parseable_fila_omitida_fail_closed: row con location="INVALID POINT DATA" → no aparece en resultado (parse_location devuelve null)', async () => {
    const rows: QueryRow[] = [make_row({ id: 'prop-basura', location: 'INVALID POINT DATA' })];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(0);
    expect(result.find((p: MapProperty) => p.id === 'prop-basura')).toBeUndefined();
  });

  // ── (EC-5) Mezcla: 3 rows (2 válidas, 1 null) → resultado length 2 ─────────

  it('(EC-5) mezcla_tres_rows_una_null_devuelve_dos: 3 rows con location=[WKT válida, null, WKT válida] → resultado tiene exactamente 2 MapProperty', async () => {
    const rows: QueryRow[] = [
      make_row({ id: 'prop-1', location: WKT_GDL }),
      make_row({ id: 'prop-sin-coords', location: null }),
      make_row({ id: 'prop-3', location: WKT_MONTERREY }),
    ];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(2);

    const ids = result.map((p: MapProperty) => p.id);
    expect(ids).toContain('prop-1');
    expect(ids).toContain('prop-3');
    expect(ids).not.toContain('prop-sin-coords');
  });

  // ── (EC-6) Passthrough: operation_type='both', bedrooms/bathrooms null ───────

  it('(EC-6) passthrough_operation_type_both_y_campos_null_preservados: row con operation_type="both", bedrooms=null, bathrooms=null → MapProperty preserva estos valores sin coerción a defaults', async () => {
    const rows: QueryRow[] = [
      make_row({
        id: 'prop-lote',
        operation_type: 'both',
        bedrooms: null,
        bathrooms: null,
        location: WKT_GDL,
      }),
    ];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(1);
    const item = result[0]!;

    // operation_type debe ser el string exacto 'both'
    expect(item.operation_type).toBe('both');
    // bedrooms y bathrooms null se preservan (no se fuerzan a 0)
    expect(item.bedrooms).toBeNull();
    expect(item.bathrooms).toBeNull();
  });

  // ── (EC-7) Error de query → lanza Error; from('properties') fue llamado ─────

  it('(EC-7) error_query_supabase_lanza_error_y_from_fue_llamado: query retorna {data:null, error:{message:"db error"}} → fetchMapProperties lanza Error y from("properties") fue intentado', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: null, error: { message: 'db error' } },
    });

    await expect(
      fetchMapProperties({ supabase: mock_supabase }),
    ).rejects.toThrow();

    // La query debe haberse intentado (stub lanza ANTES de llamar from,
    // por eso esta aserción falla en RED y pasa en GREEN cuando la impl real
    // intenta la query antes de propagar el error).
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
  });

  // ── (EC-8) Data vacío → devuelve [] sin lanzar ──────────────────────────────

  it('(EC-8) data_vacio_devuelve_array_vacio: query retorna {data:[], error:null} → fetchMapProperties devuelve [] sin lanzar excepción', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
    });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toEqual([]);
  });

  // ── (EC-9) Filtros: .eq('status','active') e .is('deleted_at',null) ─────────

  it('(EC-9) query_filtra_status_active_y_deleted_at_null: .eq("status","active") y .is("deleted_at",null) fueron llamados en el query builder; sin .limit() (no hay paginación en mapa)', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
    });

    // Ignoramos el resultado; nos interesa solo si se llamaron los filtros
    try {
      await fetchMapProperties({ supabase: mock_supabase });
    } catch {
      // stub lanza — ignorado; verificamos las llamadas al builder
    }

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(mock_supabase._query_builder.is).toHaveBeenCalledWith('deleted_at', null);
    // El mapa no pagina: .limit() nunca debe llamarse
    expect(mock_supabase._query_builder.limit).not.toHaveBeenCalled();
  });

  // ── (EC-10) EWKB hex de CDMX → lat/lng correctos con tolerancia ─────────────

  it('(EC-10) ewkb_hex_parseado_correctamente_lat_lng_precisos: row con EWKB CDMX (0101000020E6100000...) → lat≈19.4326, lng≈-99.1332 dentro de tolerancia 1e-4', async () => {
    const rows: QueryRow[] = [make_row({ id: 'prop-cdmx', location: EWKB_CDMX })];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toHaveLength(1);
    const item = result[0]!;

    // Tolerancia 1e-4 para doubles derivados de EWKB
    expect(Math.abs(item.lat - 19.4326)).toBeLessThan(1e-4);
    expect(Math.abs(item.lng - (-99.1332))).toBeLessThan(1e-4);
  });

  // ── (EC-MAP-1) RPC recibe coords/radius; query recibe .in con TODOS los ids sin slice ──

  it('(EC-MAP-1) rpc_recibe_coords_de_deps_y_radius_m_de_filters_query_recibe_in_con_todos_los_ids_sin_slice: deps.coords + filters.radius_m=20000 → RPC recibe p_lat/p_lng/p_radius_m exactos; query builder recibe .in("id", TODOS los ids de la RPC, sin slice)', async () => {
    const coords = { latitude: 20.6597, longitude: -103.3496 };
    const rows: QueryRow[] = [
      make_row({ id: 'prop-1' }),
      make_row({ id: 'prop-2' }),
      make_row({ id: 'prop-3' }),
    ];
    const rpc_ids = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: 20000 };
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });

    await fetchMapProperties({ supabase: mock_supabase, coords }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: 20000,
    });
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith(
      'id',
      rpc_ids.map((r) => r.id),
    );
  });

  // ── (EC-MAP-2) Expansión de radio: 5000 vacío → 10000 encuentra props ───────

  it('(EC-MAP-2) expansion_de_radio_5000_a_10000_cuando_rpc_devuelve_vacio_en_primer_intento: RPC vacía a 5000m → segundo intento con p_radius_m=10000 encuentra 2 props → resultado no vacío; ambas llamadas a la RPC reciben los argumentos correctos', async () => {
    const rows: QueryRow[] = [make_row({ id: 'prop-a' }), make_row({ id: 'prop-b' })];
    const rpc_ids = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const coords = { latitude: 20.6597, longitude: -103.3496 };
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });
    mock_supabase._mock_rpc
      .mockReset()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: rpc_ids, error: null });

    const result = await fetchMapProperties({ supabase: mock_supabase, coords });

    expect(result.length).toBeGreaterThan(0);
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(1, 'properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: 5000,
    });
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(2, 'properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: 10000,
    });
  });

  // ── (EC-MAP-2b) Expansión agotada (4 intentos) → vacío, sin tocar PostgREST ──

  it('(EC-MAP-2b) expansion_agotada_4_intentos_devuelve_vacio_sin_tocar_postgrest: RPC vacía en los 4 intentos (5000/10000/20000/40000) → [] y PostgREST NUNCA consultado', async () => {
    const mock_supabase = make_mock_supabase({ query_result: { data: [], error: null } });
    mock_supabase._mock_rpc.mockReset().mockResolvedValue({ data: [], error: null });

    const result = await fetchMapProperties({ supabase: mock_supabase });

    expect(result).toEqual([]);
    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(4);
    const radii = mock_supabase._mock_rpc.mock.calls.map(
      (call: unknown[]) => (call[1] as { p_radius_m: number }).p_radius_m,
    );
    expect(radii).toEqual([5000, 10000, 20000, 40000]);
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-MAP-3) Error de RPC → lanza, sin reintentar ──────────────────────

  it('(EC-MAP-3) rpc_devuelve_error_lanza_excepcion_sin_reintentar: RPC responde {data:null, error:{message}} → fetchMapProperties lanza y la RPC se llamó exactamente 1 vez (solo data vacía dispara expansión, no el error)', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: null, error: { message: 'PostGIS function timeout' } },
    });

    await expect(fetchMapProperties({ supabase: mock_supabase })).rejects.toThrow();

    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(1);
  });

});
