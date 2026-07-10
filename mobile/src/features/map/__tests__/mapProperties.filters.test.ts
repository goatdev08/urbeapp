/**
 * Tests fase RED — integración de FilterState en fetchMapProperties (#12.7)
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 * Subtarea Taskmaster: 12.7 — query integration + AsyncStorage persistence
 * REDISEÑO (#42.3 — RPC de proximidad, approach A1 lean, espejo de #42.2 en el feed).
 *
 * Aislado de mapProperties.test.ts (14 tests de #11.2/#42.3 que DEBEN
 * seguir verdes) para no tocar ese archivo — ver decisión en subtarea 12.7.
 *
 * FIRMA (backward-compatible):
 *   fetchMapProperties(deps?: MapPropertiesDeps, filters?: FilterState)
 *   `filters` es el ÚLTIMO parámetro opcional; default EMPTY_FILTERS cuando
 *   se omite.
 *
 * Contrato de integración (a implementar en GREEN):
 *   - Con #42.3: SIEMPRE se llama primero `client.rpc('properties_within_radius', ...)`.
 *     `.in('id', ids)` se aplica de forma INCONDICIONAL con TODOS los ids de la
 *     RPC (el mapa no pagina, no depende de filtros) — por eso EC-M11/EC-M12 se
 *     REESCRIBEN (ver NOTA abajo) para verificar que el ÚNICO `.in(...)` es el
 *     de ids de la RPC, y no uno de filtro.
 *   - build_filter_query(query, filters) se aplica ADEMÁS de los filtros base
 *     (.eq('status','active'), .is('deleted_at', null)) y ADEMÁS de `.in('id', ids)`
 *     — nunca en su lugar.
 *   - Sin filters (u omitido) o EMPTY_FILTERS → NINGUNA llamada extra de FILTRO
 *     al builder (.gte/.lte nunca se invocan; único .eq es el de status; único
 *     .in es el de ids de la RPC, exactamente 1 vez).
 *   - `radius_m` es SOLO parámetro de la RPC — NUNCA genera una llamada al builder
 *     de PostgREST (invariante A1, #42.1).
 *
 * NOTA — por qué EC-M11/EC-M12 cambian su aserción sobre `.in` (no es debilitamiento):
 * Antes de #42.3, `.in` solo lo activaba build_filter_query (operation_types/
 * property_types) → "nunca llamado" tenía sentido sin filtros. Con #42.3 la
 * query de ids llama `.in('id', ids)` SIEMPRE (independiente de filtros) — la
 * aserción "nunca llamado" es imposible de cumplir bajo el nuevo contrato. Se
 * REEMPLAZA por una aserción MÁS ESPECÍFICA y estricta: exactamente 1 llamada
 * a `.in`, con los argumentos exactos `('id', <array>)` — cualquier llamada de
 * filtro adicional (`operation_type`/`property_type`) haría fallar el conteo.
 * `.gte`/`.lte`/`.eq` (más allá de `status`) siguen intactos sin cambio.
 * Espejo exacto de EC-F11/EC-F12 en feedProperties.filters.test.ts (#42.2).
 *
 * PATRÓN DE MOCK: mismo query builder encadenable thenable de
 * mapProperties.test.ts, extendido con .in()/.gte()/.lte() (los métodos que
 * usa build_filter_query, ver filterQuery.ts) + `.rpc()` a nivel de cliente
 * (properties_within_radius). El mock de `.rpc` por default devuelve UN id
 * placeholder no-vacío para que el flujo SIEMPRE llegue a construir la query
 * de PostgREST (si la RPC devolviera vacío, la impl regresa temprano SIN tocar
 * PostgREST — ver EC-MAP-2b en mapProperties.test.ts — lo que rompería estos
 * tests, que verifican llamadas al builder).
 *
 * EDGE CASES CUBIERTOS (14 casos):
 *
 * ### Cada filtro individual llega al builder correcto
 * - (EC-M1) operation_types_rent_agrega_in_operation_type_con_both
 * - (EC-M2) property_types_agrega_in_property_type
 * - (EC-M3) price_min_agrega_gte_price
 * - (EC-M4) price_max_agrega_lte_price
 * - (EC-M5) zone_agrega_eq_zone_exacto
 * - (EC-M6) bedrooms_min_agrega_gte_bedrooms
 * - (EC-M7) pet_friendly_true_agrega_eq_pet_friendly_true
 * - (EC-M8) allows_no_guarantor_true_agrega_eq_allows_no_guarantor_true
 * - (EC-M9) student_friendly_true_agrega_eq_student_friendly_true
 *
 * ### Filtros ADEMÁS de, no en lugar de, los filtros base
 * - (EC-M10) filtros_se_aplican_ademas_de_filtros_base_status_y_deleted_at
 *
 * ### Backward-compat (restricción dura de la subtarea) — REESCRITOS (#42.3, ver NOTA)
 * - (EC-M11) backward_compat_sin_filters_solo_in_de_ids_de_rpc_no_agrega_gte_lte
 * - (EC-M12) backward_compat_empty_filters_explicito_solo_in_de_ids_de_rpc
 *
 * ### RPC de proximidad — radius_m nunca viaja al builder (#42.3 — NUEVOS)
 * - (EC-M13) radius_m_no_genera_llamadas_extra_al_builder_solo_va_a_la_rpc
 * - (EC-M14) rpc_recibe_filters_radius_m_como_p_radius_m
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties } from '../lib/mapProperties';

// ---------------------------------------------------------------------------
// Mock del query builder encadenable, extendido con in/gte/lte (build_filter_query)
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

type MockBuilder = {
  select: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  in: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  then: (
    onFulfilled: (v: QueryResult) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

const CHAINABLE_METHODS = ['select', 'eq', 'is', 'order', 'limit', 'in', 'gte', 'lte'] as const;

function make_query_builder(result: QueryResult): MockBuilder {
  const builder = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    in: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
    then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  } as MockBuilder;

  for (const method of CHAINABLE_METHODS) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

/** Fila cruda que devuelve la RPC properties_within_radius (#42.3). */
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

function make_mock_supabase(
  query_result: QueryResult = { data: [], error: null },
  // ponytail: default NO vacío — si la RPC devolviera [], la impl regresa
  // temprano SIN construir la query de PostgREST, lo que rompería estos tests
  // (verifican llamadas al builder). Un id placeholder asegura que el flujo
  // SIEMPRE llegue a construir + await la query (espejo de feed #42.2).
  rpc_result: RpcResult = { data: [{ id: 'rpc-placeholder-id', distance_m: 1 }], error: null },
) {
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

function make_filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchMapProperties — integración de FilterState (12.7)', () => {
  // ── (EC-M1) operation_types ────────────────────────────────────────────

  it('(EC-M1) operation_types_rent_agrega_in_operation_type_con_both: filters.operation_types=["rent"] → query builder recibe .in("operation_type", ["rent","both"])', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ operation_types: ['rent'] });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
  });

  // ── (EC-M2) property_types ─────────────────────────────────────────────

  it('(EC-M2) property_types_agrega_in_property_type: filters.property_types=["house","apartment"] → .in("property_type", ["house","apartment"])', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ property_types: ['house', 'apartment'] });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('property_type', ['house', 'apartment']);
  });

  // ── (EC-M3) price_min ───────────────────────────────────────────────────

  it('(EC-M3) price_min_agrega_gte_price: filters.price_min=5000 → .gte("price", 5000)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ price_min: 5000 });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 5000);
  });

  // ── (EC-M4) price_max ───────────────────────────────────────────────────

  it('(EC-M4) price_max_agrega_lte_price: filters.price_max=15000 → .lte("price", 15000)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ price_max: 15000 });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.lte).toHaveBeenCalledWith('price', 15000);
  });

  // ── (EC-M5) zone ────────────────────────────────────────────────────────

  it('(EC-M5) zone_agrega_eq_zone_exacto: filters.zone="Polanco" → .eq("zone", "Polanco")', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ zone: 'Polanco' });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Polanco');
  });

  // ── (EC-M6) bedrooms_min ────────────────────────────────────────────────

  it('(EC-M6) bedrooms_min_agrega_gte_bedrooms: filters.bedrooms_min=2 → .gte("bedrooms", 2)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ bedrooms_min: 2 });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('bedrooms', 2);
  });

  // ── (EC-M7) pet_friendly ────────────────────────────────────────────────

  it('(EC-M7) pet_friendly_true_agrega_eq_pet_friendly_true: filters.pet_friendly=true → .eq("pet_friendly", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ pet_friendly: true });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('pet_friendly', true);
  });

  // ── (EC-M8) allows_no_guarantor ─────────────────────────────────────────

  it('(EC-M8) allows_no_guarantor_true_agrega_eq_allows_no_guarantor_true: filters.allows_no_guarantor=true → .eq("allows_no_guarantor", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ allows_no_guarantor: true });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('allows_no_guarantor', true);
  });

  // ── (EC-M9) student_friendly ────────────────────────────────────────────

  it('(EC-M9) student_friendly_true_agrega_eq_student_friendly_true: filters.student_friendly=true → .eq("student_friendly", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ student_friendly: true });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('student_friendly', true);
  });

  // ── (EC-M10) Filtros además de, no en lugar de, los filtros base ─────────

  it('(EC-M10) filtros_se_aplican_ademas_de_filtros_base_status_y_deleted_at: filters.zone="Polanco" → .eq("status","active") Y .is("deleted_at", null) SIGUEN llamándose junto con .eq("zone", "Polanco")', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ zone: 'Polanco' });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(mock_supabase._query_builder.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Polanco');
  });

  // ── (EC-M11) Backward-compat: sin filters, único .in es el de ids de la RPC ──
  // REESCRITO (#42.3, ver NOTA del header): `.in('id', ids)` es incondicional
  // (todos los ids de la RPC, sin slice), por eso ya no se puede afirmar
  // "nunca llamado" — se afirma, más estricto, que hay EXACTAMENTE una
  // llamada y que es la de ids (ninguna de filtro).

  it('(EC-M11) backward_compat_sin_filters_solo_in_de_ids_de_rpc_no_agrega_gte_lte: fetchMapProperties(deps) SIN 2º arg → único .in es el de ids de la RPC (1 llamada); .gte/.lte nunca llamados; único .eq es status/active', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchMapProperties({ supabase: mock_supabase });

    expect(mock_supabase._query_builder.in).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', expect.any(Array));
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-M12) Backward-compat: EMPTY_FILTERS explícito ────────────────────

  it('(EC-M12) backward_compat_empty_filters_explicito_solo_in_de_ids_de_rpc: fetchMapProperties(deps, EMPTY_FILTERS) → mismo comportamiento que sin filtros: único .in es el de ids de la RPC (1 llamada); 0 llamadas de filtro', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchMapProperties({ supabase: mock_supabase }, EMPTY_FILTERS);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', expect.any(Array));
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-M13) radius_m NUNCA genera llamadas al builder (solo va a la RPC) ─

  it('(EC-M13) radius_m_no_genera_llamadas_extra_al_builder_solo_va_a_la_rpc: filters.radius_m=20000 (resto vacío) → único .in es el de ids de la RPC (1 llamada); .gte/.lte no llamados; único .eq es status/active', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ radius_m: 20000 });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', expect.any(Array));
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-M14) la RPC recibe filters.radius_m como p_radius_m ──────────────

  it('(EC-M14) rpc_recibe_filters_radius_m_como_p_radius_m: filters.radius_m=15000 → RPC properties_within_radius recibe p_radius_m:15000', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ radius_m: 15000 });

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: 15000 }),
    );
  });
});
