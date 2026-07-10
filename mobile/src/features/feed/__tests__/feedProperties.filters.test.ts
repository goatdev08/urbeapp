/**
 * Tests fase RED — integración de FilterState en fetchFeedProperties (#12.7)
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 12.7 — query integration + AsyncStorage persistence
 * REDISEÑO (#42.2 — RPC de proximidad, approach A1 lean).
 *
 * Aislado de feedProperties.test.ts (tests de #9.5/#11.2/#42.2 que
 * DEBEN seguir verdes) para no tocar ese archivo — ver decisión en subtarea 12.7.
 *
 * FIRMA (backward-compatible):
 *   fetchFeedProperties(cursor?: string, deps?: FeedPropertiesDeps, filters?: FilterState)
 *   `filters` es el ÚLTIMO parámetro opcional; default EMPTY_FILTERS cuando se omite.
 *
 * Contrato de integración (a implementar en GREEN):
 *   - Con #42.2: SIEMPRE se llama primero `client.rpc('properties_within_radius', ...)`.
 *     La paginación aplica `.in('id', page_ids)` de forma INCONDICIONAL (no depende
 *     de filtros) — por eso EC-F11/EC-F12 se REESCRIBEN (ver NOTA abajo) para verificar
 *     que el ÚNICO `.in(...)` es el de paginación por id, y no uno de filtro.
 *   - build_filter_query(query, filters) se aplica ADEMÁS de los filtros base
 *     (.eq('status','active'), .is('deleted_at', null)) y ADEMÁS de `.in('id', page_ids)`
 *     — nunca en su lugar.
 *   - Sin filters (u omitido) o EMPTY_FILTERS → NINGUNA llamada extra de FILTRO al
 *     builder (.gte/.lte nunca se invocan; único .eq es el de status; único .in
 *     es el de paginación por id, exactamente 1 vez).
 *   - `radius_m` es SOLO parámetro de la RPC — NUNCA genera una llamada al builder
 *     de PostgREST (invariante A1, #42.1).
 *   - cursor y filters conviven: ambos aplican sus filtros sin pisarse.
 *
 * NOTA — por qué EC-F11/EC-F12 cambian su aserción sobre `.in` (no es debilitamiento):
 * Antes de #42.2, `.in` solo lo activaba build_filter_query (operation_types/
 * property_types) → "nunca llamado" tenía sentido sin filtros. Con #42.2 la
 * paginación por ids de la RPC llama `.in('id', page_ids)` SIEMPRE (independiente
 * de filtros) — la aserción "nunca llamado" es imposible de cumplir bajo el nuevo
 * contrato. Se REEMPLAZA por una aserción MÁS ESPECÍFICA y estricta: exactamente
 * 1 llamada a `.in`, con los argumentos exactos `('id', <array>)` — cualquier
 * llamada de filtro adicional (`operation_type`/`property_type`) haría fallar el
 * conteo. `.gte`/`.lte`/`.eq` (más allá de `status`) siguen intactos sin cambio.
 *
 * PATRÓN DE MOCK: mismo query builder encadenable thenable de
 * feedProperties.test.ts, extendido con .in()/.gte()/.lte() (los métodos que
 * usa build_filter_query, ver filterQuery.ts) + `.rpc()` a nivel de cliente
 * (properties_within_radius). El mock de `.rpc` por default devuelve UN id
 * placeholder no-vacío para que el flujo SIEMPRE llegue a construir la query
 * de PostgREST (si la RPC devolviera vacío, la impl regresa temprano SIN tocar
 * PostgREST — ver EC-17b en feedProperties.test.ts — lo que rompería estos
 * tests, que verifican llamadas al builder). El mint-video-url EF no se
 * invoca en estos tests: la query base resuelve con data:[] (early return
 * por 0 filas), así solo importan las llamadas hechas al builder ANTES del
 * return.
 *
 * EDGE CASES CUBIERTOS (15 casos):
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
 * ### Backward-compat (restricción dura de la subtarea) — REESCRITOS (#42.2, ver NOTA)
 * - (EC-F11) backward_compat_sin_filters_solo_in_de_paginacion_no_agrega_gte_lte
 * - (EC-F12) backward_compat_empty_filters_explicito_solo_in_de_paginacion
 *
 * ### Interacción cursor + filtros — REDISEÑADO a offset (#42.2)
 * - (EC-F13) cursor_offset_y_filtros_combinados_no_se_pisan_entre_si
 *
 * ### RPC de proximidad — radius_m nunca viaja al builder (#42.2 — NUEVOS)
 * - (EC-F14) radius_m_no_genera_llamadas_extra_al_builder_solo_va_a_la_rpc
 * - (EC-F15) rpc_recibe_filters_radius_m_como_p_radius_m
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
  // #58.3: EMPTY_FILTERS.radius_m es null por default (#58.1) → algunos tests
  // de este archivo ahora ejercitan el path plano, que pagina con .range().
  range: jest.Mock;
  then: (
    onFulfilled: (v: QueryResult) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

const CHAINABLE_METHODS = ['select', 'eq', 'is', 'order', 'limit', 'lt', 'in', 'gte', 'lte', 'range'] as const;

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
    range: jest.fn(),
    then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  } as MockBuilder;

  for (const method of CHAINABLE_METHODS) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

/** Fila cruda que devuelve la RPC properties_within_radius (#42.2). */
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

function make_mock_supabase(
  query_result: QueryResult = { data: [], error: null },
  // ponytail: default NO vacío — si la RPC devolviera [], la impl regresa
  // temprano SIN construir la query de PostgREST (ver EC-17b), lo que
  // rompería estos tests (verifican llamadas al builder). Un id placeholder
  // asegura que el flujo SIEMPRE llegue a construir + await la query.
  rpc_result: RpcResult = { data: [{ id: 'rpc-placeholder-id', distance_m: 1 }], error: null },
) {
  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_invoke = jest.fn().mockResolvedValue({ data: { videos: [] }, error: null });
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

  // ── (EC-F11) Backward-compat: sin filters, único .in es el de paginación ──
  // REESCRITO (#42.2, ver NOTA del header): `.in('id', page_ids)` es
  // incondicional (paginación por ids de la RPC), por eso ya no se puede
  // afirmar "nunca llamado" — se afirma, más estricto, que hay EXACTAMENTE
  // una llamada y que es la de paginación por id (ninguna de filtro).

  it('(EC-F11) backward_compat_sin_filters_solo_in_de_paginacion_no_agrega_gte_lte: fetchFeedProperties(cursor, deps) SIN 3er arg → único .in es el de paginación por id (1 llamada); .gte/.lte nunca llamados; único .eq es status/active', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._query_builder.in).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', expect.any(Array));
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-F12) Backward-compat: EMPTY_FILTERS explícito ────────────────────
  // ACTUALIZADO (#58.1 + #58.3): EMPTY_FILTERS.radius_m ahora es `null` por
  // default (#58.1, radio sin límite) — pasar EMPTY_FILTERS explícito YA NO
  // es equivalente a omitir `filters` (ese caso sigue en EC-F11, `filters`
  // undefined → DEFAULT_RADIUS_M). EMPTY_FILTERS explícito ejercita a propósito
  // el path plano (#58.3): sin RPC, sin `.in('id', ...)` de paginación, pagina
  // con `.range()`.

  it('(EC-F12) empty_filters_explicito_radius_null_activa_path_plano_sin_rpc: fetchFeedProperties(cursor, deps, EMPTY_FILTERS) → radius_m=null (default) → NO invoca client.rpc; pagina con .range(0,9); 0 llamadas de filtro', async () => {
    const mock_supabase = make_mock_supabase();

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.range).toHaveBeenCalledWith(0, 9);
    expect(mock_supabase._query_builder.in).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-F13) cursor (offset) + filtros combinados no se pisan ────────────
  // REDISEÑADO (#42.2): cursor ya NO es created_at, es offset numérico sobre
  // los ids de la RPC. cursor="10" + filters.price_min=5000 → .in('id',
  // ids.slice(10,20)) Y .gte('price', 5000) AMBOS aplicados.
  // radius_m EXPLÍCITO no-null (#58.3): este test verifica la interacción
  // cursor+filtro dentro del path de proximidad — el path plano (radius_m
  // null) ya tiene su propia cobertura de paginación en
  // feedProperties.radius-null.test.ts (EC-FEED-NULL-2a/2b).

  it('(EC-F13) cursor_offset_y_filtros_combinados_no_se_pisan_entre_si: cursor="10" (offset) Y filters.price_min=5000 → .in("id", ids.slice(10,20)) Y .gte("price", 5000) AMBOS llamados', async () => {
    const rpc_ids = Array.from({ length: 20 }, (_, i) => ({
      id: `prop-id-${i + 1}`,
      distance_m: i,
    }));
    const page_ids = rpc_ids.slice(10, 20).map((r) => r.id);
    const mock_supabase = make_mock_supabase(
      { data: [], error: null },
      { data: rpc_ids, error: null },
    );
    const cursor = '10';
    const filters = make_filters({ price_min: 5000, radius_m: 5000 });

    await fetchFeedProperties(cursor, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', page_ids);
    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 5000);
  });

  // ── (EC-F14) radius_m NUNCA genera llamadas al builder (solo va a la RPC) ─

  it('(EC-F14) radius_m_no_genera_llamadas_extra_al_builder_solo_va_a_la_rpc: filters.radius_m=20000 (resto vacío) → único .in es el de paginación por id (1 llamada); .gte/.lte no llamados; único .eq es status/active', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ radius_m: 20000 });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', expect.any(Array));
    expect(mock_supabase._query_builder.gte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.lte).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledTimes(1);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  // ── (EC-F15) la RPC recibe filters.radius_m como p_radius_m ──────────────

  it('(EC-F15) rpc_recibe_filters_radius_m_como_p_radius_m: filters.radius_m=15000 → RPC properties_within_radius recibe p_radius_m:15000', async () => {
    const mock_supabase = make_mock_supabase();
    const filters = make_filters({ radius_m: 15000 });

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: 15000 }),
    );
  });
});
