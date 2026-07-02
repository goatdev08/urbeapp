/**
 * Tests fase RED — integración de FilterState en fetchFeedProperties (#12.7)
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 12.7 — query integration + AsyncStorage persistence
 *
 * Aislado de feedProperties.test.ts (25 tests existentes de #9.5/#11.2 que
 * DEBEN seguir verdes) para no tocar ese archivo — ver decisión en subtarea 12.7.
 *
 * FIRMA NUEVA (backward-compatible, decidida para el GREEN):
 *   fetchFeedProperties(cursor?: string, deps?: FeedPropertiesDeps, filters?: FilterState)
 *   `filters` es el ÚLTIMO parámetro opcional; default EMPTY_FILTERS cuando se omite.
 *   Los 25 tests existentes llaman con 1–2 args y no se ven afectados.
 *
 * Contrato de integración (a implementar en GREEN):
 *   - build_filter_query(query, filters) se aplica ADEMÁS de los filtros base
 *     (.eq('status','active'), .is('deleted_at', null)) — nunca en su lugar.
 *   - Sin filters (u omitido) o EMPTY_FILTERS → NINGUNA llamada extra al
 *     builder (.in/.gte/.lte nunca se invocan; único .eq es el de status).
 *   - cursor y filters conviven: ambos aplican sus filtros sin pisarse.
 *
 * PATRÓN DE MOCK: mismo query builder encadenable thenable de
 * feedProperties.test.ts, extendido con .in()/.gte()/.lte() (los métodos que
 * usa build_filter_query, ver filterQuery.ts). El mint-video-url EF no se
 * invoca en estos tests: la query base resuelve con data:[] (early return),
 * así solo importan las llamadas hechas al builder ANTES del return.
 *
 * EDGE CASES CUBIERTOS (13 casos):
 *
 * ### Cada filtro individual llega al builder correcto
 * - (EC-F1) operation_types_rent_agrega_in_operation_type_con_both
 * - (EC-F2) property_types_agrega_in_property_type
 * - (EC-F3) price_min_agrega_gte_price
 * - (EC-F4) price_max_agrega_lte_price
 * - (EC-F5) zone_agrega_eq_zone_exacto
 * - (EC-F6) bedrooms_min_agrega_gte_bedrooms
 * - (EC-F7) pet_friendly_true_agrega_eq_pet_friendly_true
 * - (EC-F8) allows_no_guarantor_true_agrega_eq_allows_no_guarantor_true
 * - (EC-F9) student_friendly_true_agrega_eq_student_friendly_true
 *
 * ### Filtros ADEMÁS de, no en lugar de, los filtros base
 * - (EC-F10) filtros_se_aplican_ademas_de_filtros_base_status_y_deleted_at
 *
 * ### Backward-compat (restricción dura de la subtarea)
 * - (EC-F11) backward_compat_sin_filters_no_agrega_llamadas_extra_al_builder
 * - (EC-F12) backward_compat_empty_filters_explicito_no_agrega_llamadas_extra
 *
 * ### Interacción cursor + filtros
 * - (EC-F13) cursor_y_filtros_combinados_no_se_pisan_entre_si
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchFeedProperties } from '../lib/feedProperties';

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
  lt: jest.Mock;
  in: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  then: (
    onFulfilled: (v: QueryResult) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

const CHAINABLE_METHODS = ['select', 'eq', 'is', 'order', 'limit', 'lt', 'in', 'gte', 'lte'] as const;

function make_query_builder(result: QueryResult): MockBuilder {
  const builder = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    lt: jest.fn(),
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

function make_mock_supabase(query_result: QueryResult = { data: [], error: null }) {
  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_invoke = jest.fn().mockResolvedValue({ data: { videos: [] }, error: null });

  return {
    from: mock_from,
    functions: { invoke: mock_invoke },
    _mock_from: mock_from,
    _mock_invoke: mock_invoke,
    _query_builder: query_builder,
  };
}

function make_filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchFeedProperties — integración de FilterState (12.7)', () => {
  // ── (EC-F1) operation_types ────────────────────────────────────────────

  it('(EC-F1) operation_types_rent_agrega_in_operation_type_con_both: filters.operation_types=["rent"] → query builder recibe .in("operation_type", ["rent","both"])', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ operation_types: ['rent'] });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
  });

  // ── (EC-F2) property_types ─────────────────────────────────────────────

  it('(EC-F2) property_types_agrega_in_property_type: filters.property_types=["house","apartment"] → .in("property_type", ["house","apartment"])', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ property_types: ['house', 'apartment'] });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('property_type', ['house', 'apartment']);
  });

  // ── (EC-F3) price_min ───────────────────────────────────────────────────

  it('(EC-F3) price_min_agrega_gte_price: filters.price_min=5000 → .gte("price", 5000)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ price_min: 5000 });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 5000);
  });

  // ── (EC-F4) price_max ───────────────────────────────────────────────────

  it('(EC-F4) price_max_agrega_lte_price: filters.price_max=15000 → .lte("price", 15000)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ price_max: 15000 });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.lte).toHaveBeenCalledWith('price', 15000);
  });

  // ── (EC-F5) zone ────────────────────────────────────────────────────────

  it('(EC-F5) zone_agrega_eq_zone_exacto: filters.zone="Polanco" → .eq("zone", "Polanco")', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ zone: 'Polanco' });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Polanco');
  });

  // ── (EC-F6) bedrooms_min ────────────────────────────────────────────────

  it('(EC-F6) bedrooms_min_agrega_gte_bedrooms: filters.bedrooms_min=2 → .gte("bedrooms", 2)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ bedrooms_min: 2 });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('bedrooms', 2);
  });

  // ── (EC-F7) pet_friendly ────────────────────────────────────────────────

  it('(EC-F7) pet_friendly_true_agrega_eq_pet_friendly_true: filters.pet_friendly=true → .eq("pet_friendly", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ pet_friendly: true });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('pet_friendly', true);
  });

  // ── (EC-F8) allows_no_guarantor ─────────────────────────────────────────

  it('(EC-F8) allows_no_guarantor_true_agrega_eq_allows_no_guarantor_true: filters.allows_no_guarantor=true → .eq("allows_no_guarantor", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ allows_no_guarantor: true });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('allows_no_guarantor', true);
  });

  // ── (EC-F9) student_friendly ────────────────────────────────────────────

  it('(EC-F9) student_friendly_true_agrega_eq_student_friendly_true: filters.student_friendly=true → .eq("student_friendly", true)', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ student_friendly: true });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('student_friendly', true);
  });

  // ── (EC-F10) Filtros además de, no en lugar de, los filtros base ─────────

  it('(EC-F10) filtros_se_aplican_ademas_de_filtros_base_status_y_deleted_at: filters.zone="Polanco" → .eq("status","active") Y .is("deleted_at", null) SIGUEN llamándose junto con .eq("zone", "Polanco")', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ zone: 'Polanco' });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(mock_supabase._query_builder.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Polanco');
  });

  // ── (EC-F11) Backward-compat: sin filters, sin llamadas extra ────────────

  it('(EC-F11) backward_compat_sin_filters_no_agrega_llamadas_extra_al_builder: fetchFeedProperties(cursor, deps) SIN 3er arg → .in/.gte/.lte nunca llamados; único .eq es status/active', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._query_builder.in).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-F12) Backward-compat: EMPTY_FILTERS explícito ────────────────────

  it('(EC-F12) backward_compat_empty_filters_explicito_no_agrega_llamadas_extra: fetchFeedProperties(cursor, deps, EMPTY_FILTERS) → mismo comportamiento que sin filtros (0 llamadas extra)', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(mock_supabase._query_builder.in).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-F13) cursor + filtros combinados no se pisan ─────────────────────

  it('(EC-F13) cursor_y_filtros_combinados_no_se_pisan_entre_si: cursor presente Y filters.price_min=5000 → .lt("created_at", cursor) Y .gte("price", 5000) AMBOS llamados', async () => {
    const mock_supabase = make_mock_supabase();
    const cursor = '2026-06-20T10:00:00Z';
    const filters = make_filters({ price_min: 5000 });

    await fetchFeedProperties(cursor, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.lt).toHaveBeenCalledWith('created_at', cursor);
    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 5000);
  });
});
