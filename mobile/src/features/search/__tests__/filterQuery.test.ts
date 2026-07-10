/**
 * Tests fase RED — build_filter_query / get_active_filter_count / EMPTY_FILTERS
 * Archivo SUT: mobile/src/features/search/lib/filterQuery.ts
 * Tipo SUT: mobile/src/features/search/types.ts (FilterState)
 * Subtarea Taskmaster: 12.6 — Filter state management (Context) + WHERE clause builder
 *
 * SUT: build_filter_query<Q>(query: Q, filters: FilterState): Q
 *   - Aplica SOLO los filtros activos al query builder de supabase-js y lo devuelve.
 *   - NO reaplica status='active' / deleted_at IS NULL (ya en las queries base).
 *
 * SUT: get_active_filter_count(filters: FilterState): number
 *   - Cuenta "grupos" de filtro activos para el badge del FilterSheet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POLÍTICAS DECIDIDAS (documentadas aquí porque el guardian las verifica):
 *
 * 1) operation_types + valor 'both' del enum:
 *    Una propiedad con operation_type='both' acepta ambas modalidades, así que
 *    matchea CUALQUIER selección de operación. Por tanto, si el usuario elige
 *    un subconjunto S no vacío de {'rent','sale'}, el filtro real es
 *    `.in('operation_type', [...S, 'both'])` — 'both' se agrega SIEMPRE que
 *    haya al menos una selección. S=[] → sin filtro de operación.
 *
 * 2) Booleanos (pet_friendly, allows_no_guarantor, student_friendly):
 *    true = "exigir" → `.eq(col, true)`. false = "no me importa" → SIN filtro
 *    (nunca se traduce a `.eq(col, false)`).
 *
 * 3) zone usa match EXACTO (`.eq('zone', zone)`), NUNCA `.ilike`.
 *
 * 4) get_active_filter_count cuenta por GRUPO, no por campo individual:
 *    operation_types no vacío = 1; property_types no vacío = 1;
 *    rango de precio (price_min y/o price_max no null) = 1 (aunque ambos estén
 *    set, sigue siendo 1 — es un solo control de UI); zone no null = 1;
 *    bedrooms_min no null = 1; cada booleano true = 1 (independientes entre sí).
 *    EMPTY_FILTERS → 0.
 *
 * EDGE CASES CUBIERTOS (24 casos):
 *
 * ### build_filter_query — happy path / EMPTY_FILTERS
 * - (EC-1) empty_filters_no_aplica_ninguna_llamada_al_query_builder
 *
 * ### build_filter_query — operation_types (sutileza 'both')
 * - (EC-2) operation_types_rent_agrega_both_al_in
 * - (EC-3) operation_types_sale_agrega_both_al_in
 * - (EC-4) operation_types_rent_y_sale_incluye_los_tres_valores_del_enum
 * - (EC-5) operation_types_vacio_no_aplica_filtro_de_operacion
 *
 * ### build_filter_query — property_types
 * - (EC-6) property_types_no_vacio_aplica_in_property_type
 * - (EC-7) property_types_vacio_no_aplica_filtro
 *
 * ### build_filter_query — rango de precio
 * - (EC-8) price_min_solo_aplica_gte_price
 * - (EC-9) price_max_solo_aplica_lte_price
 * - (EC-10) price_min_y_price_max_aplica_gte_y_lte
 * - (EC-11) price_min_y_max_null_no_aplica_filtro_de_precio
 *
 * ### build_filter_query — zone (match exacto)
 * - (EC-12) zone_no_null_aplica_eq_zone_match_exacto
 * - (EC-13) zone_null_no_aplica_filtro
 *
 * ### build_filter_query — bedrooms_min
 * - (EC-14) bedrooms_min_no_null_aplica_gte_bedrooms
 * - (EC-15) bedrooms_min_null_no_aplica_filtro
 *
 * ### build_filter_query — booleanos (true exige, false no filtra)
 * - (EC-16) pet_friendly_true_aplica_eq_pet_friendly_true
 * - (EC-17) pet_friendly_false_no_aplica_filtro
 * - (EC-18) allows_no_guarantor_true_aplica_eq
 * - (EC-19) student_friendly_true_aplica_eq
 *
 * ### build_filter_query — combinación / no re-aplica status
 * - (EC-20) combinacion_multiple_filtros_todas_las_llamadas_presentes
 * - (EC-21) nunca_aplica_status_ni_deleted_at
 *
 * ### build_filter_query — devuelve el builder encadenado
 * - (EC-22) devuelve_el_mismo_builder_encadenable
 *
 * ### get_active_filter_count
 * - (EC-23) empty_filters_cuenta_cero
 * - (EC-24) conteo_multiple_precio_cuenta_uno_aunque_min_y_max_esten_set
 *
 * ### radius_m (#42.1 — footprint tarea #42, approach A1 lean)
 * - (EC-25) empty_filters_radius_m_default_5000_metros
 * - (EC-26) radius_m_nunca_viaja_a_build_filter_query_invariante_a1
 *
 * Nota sobre EC-26 (regresión, no "RED puro"): protege el invariante A1 de que
 * `radius_m` es SOLO parámetro de la futura RPC `properties_within_radius` y
 * NUNCA debe traducirse a una llamada del query builder (el GREEN de #42.1 no
 * toca `build_filter_query`). Por diseño esta aserción ya es verdadera hoy
 * (el builder ignora cualquier campo que no reconoce) — es un candado que debe
 * seguir en verde durante y después del GREEN; si alguna vez se pone en rojo,
 * significa que alguien agregó lógica de radio al builder, lo cual rompe A1.
 */

import { build_filter_query, get_active_filter_count, EMPTY_FILTERS } from '../lib/filterQuery';
import type { FilterState } from '../types';

// ---------------------------------------------------------------------------
// Fake query builder encadenable — registra las llamadas en `calls`.
// Estilo: map/lib/__tests__/mapProperties.test.ts (mock builder de supabase-js).
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] };

function make_fake_query_builder() {
  const calls: Call[] = [];
  const builder: {
    calls: Call[];
    in: jest.Mock;
    gte: jest.Mock;
    lte: jest.Mock;
    eq: jest.Mock;
  } = {
    calls,
    in: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'in', args });
      return builder;
    }),
    gte: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'gte', args });
      return builder;
    }),
    lte: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'lte', args });
      return builder;
    }),
    eq: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return builder;
    }),
  };
  return builder;
}

/** Construye un FilterState completo a partir de overrides sobre EMPTY_FILTERS. */
function make_filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

// ---------------------------------------------------------------------------
// build_filter_query
// ---------------------------------------------------------------------------

describe('build_filter_query', () => {
  it('(EC-1) empty_filters_no_aplica_ninguna_llamada_al_query_builder: con EMPTY_FILTERS, calls queda vacío (ningún método invocado)', () => {
    const builder = make_fake_query_builder();

    build_filter_query(builder, EMPTY_FILTERS);

    expect(builder.calls).toEqual([]);
  });

  it('(EC-2) operation_types_rent_agrega_both_al_in: operation_types=["rent"] → .in("operation_type", ["rent","both"])', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ operation_types: ['rent'] });

    build_filter_query(builder, filters);

    expect(builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
  });

  it('(EC-3) operation_types_sale_agrega_both_al_in: operation_types=["sale"] → .in("operation_type", ["sale","both"])', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ operation_types: ['sale'] });

    build_filter_query(builder, filters);

    expect(builder.in).toHaveBeenCalledWith('operation_type', ['sale', 'both']);
  });

  it('(EC-4) operation_types_rent_y_sale_incluye_los_tres_valores_del_enum: operation_types=["rent","sale"] → .in("operation_type", ["rent","sale","both"])', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ operation_types: ['rent', 'sale'] });

    build_filter_query(builder, filters);

    expect(builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'sale', 'both']);
  });

  it('(EC-5) operation_types_vacio_no_aplica_filtro_de_operacion: operation_types=[] → .in nunca se llama con "operation_type"', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ operation_types: [] });

    build_filter_query(builder, filters);

    const operation_calls = builder.calls.filter(
      (c) => c.method === 'in' && c.args[0] === 'operation_type',
    );
    expect(operation_calls).toEqual([]);
  });

  it('(EC-6) property_types_no_vacio_aplica_in_property_type: property_types=["house","apartment"] → .in("property_type", ["house","apartment"])', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ property_types: ['house', 'apartment'] });

    build_filter_query(builder, filters);

    expect(builder.in).toHaveBeenCalledWith('property_type', ['house', 'apartment']);
  });

  it('(EC-7) property_types_vacio_no_aplica_filtro: property_types=[] → .in nunca se llama con "property_type"', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ property_types: [] });

    build_filter_query(builder, filters);

    const property_calls = builder.calls.filter(
      (c) => c.method === 'in' && c.args[0] === 'property_type',
    );
    expect(property_calls).toEqual([]);
  });

  it('(EC-8) price_min_solo_aplica_gte_price: price_min=5000, price_max=null → .gte("price", 5000) y NO .lte', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ price_min: 5000, price_max: null });

    build_filter_query(builder, filters);

    expect(builder.gte).toHaveBeenCalledWith('price', 5000);
    expect(builder.lte).not.toHaveBeenCalled();
  });

  it('(EC-9) price_max_solo_aplica_lte_price: price_min=null, price_max=20000 → .lte("price", 20000) y NO .gte', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ price_min: null, price_max: 20000 });

    build_filter_query(builder, filters);

    expect(builder.lte).toHaveBeenCalledWith('price', 20000);
    expect(builder.gte).not.toHaveBeenCalled();
  });

  it('(EC-10) price_min_y_price_max_aplica_gte_y_lte: price_min=5000, price_max=20000 → .gte("price",5000) y .lte("price",20000)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ price_min: 5000, price_max: 20000 });

    build_filter_query(builder, filters);

    expect(builder.gte).toHaveBeenCalledWith('price', 5000);
    expect(builder.lte).toHaveBeenCalledWith('price', 20000);
  });

  it('(EC-11) price_min_y_max_null_no_aplica_filtro_de_precio: price_min=null, price_max=null → ni .gte("price",..) ni .lte("price",..)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ price_min: null, price_max: null });

    build_filter_query(builder, filters);

    const price_calls = builder.calls.filter((c) => c.args[0] === 'price');
    expect(price_calls).toEqual([]);
  });

  it('(EC-12) zone_no_null_aplica_eq_zone_match_exacto: zone="Polanco" → .eq("zone", "Polanco") (nunca .ilike)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ zone: 'Polanco' });

    build_filter_query(builder, filters);

    expect(builder.eq).toHaveBeenCalledWith('zone', 'Polanco');
  });

  it('(EC-13) zone_null_no_aplica_filtro: zone=null → .eq nunca se llama con "zone"', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ zone: null });

    build_filter_query(builder, filters);

    const zone_calls = builder.calls.filter((c) => c.method === 'eq' && c.args[0] === 'zone');
    expect(zone_calls).toEqual([]);
  });

  it('(EC-14) bedrooms_min_no_null_aplica_gte_bedrooms: bedrooms_min=2 → .gte("bedrooms", 2)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ bedrooms_min: 2 });

    build_filter_query(builder, filters);

    expect(builder.gte).toHaveBeenCalledWith('bedrooms', 2);
  });

  it('(EC-15) bedrooms_min_null_no_aplica_filtro: bedrooms_min=null → .gte nunca se llama con "bedrooms"', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ bedrooms_min: null });

    build_filter_query(builder, filters);

    const bedrooms_calls = builder.calls.filter(
      (c) => c.method === 'gte' && c.args[0] === 'bedrooms',
    );
    expect(bedrooms_calls).toEqual([]);
  });

  it('(EC-16) pet_friendly_true_aplica_eq_pet_friendly_true: pet_friendly=true → .eq("pet_friendly", true)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ pet_friendly: true });

    build_filter_query(builder, filters);

    expect(builder.eq).toHaveBeenCalledWith('pet_friendly', true);
  });

  it('(EC-17) pet_friendly_false_no_aplica_filtro: pet_friendly=false → .eq nunca se llama con "pet_friendly" (false = no filtrar, no ".eq(col,false)")', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ pet_friendly: false });

    build_filter_query(builder, filters);

    const pet_calls = builder.calls.filter((c) => c.args[0] === 'pet_friendly');
    expect(pet_calls).toEqual([]);
  });

  it('(EC-18) allows_no_guarantor_true_aplica_eq: allows_no_guarantor=true → .eq("allows_no_guarantor", true)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ allows_no_guarantor: true });

    build_filter_query(builder, filters);

    expect(builder.eq).toHaveBeenCalledWith('allows_no_guarantor', true);
  });

  it('(EC-19) student_friendly_true_aplica_eq: student_friendly=true → .eq("student_friendly", true)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ student_friendly: true });

    build_filter_query(builder, filters);

    expect(builder.eq).toHaveBeenCalledWith('student_friendly', true);
  });

  it('(EC-20) combinacion_multiple_filtros_todas_las_llamadas_presentes: operation_types+property_types+precio+zone+bedrooms+booleanos → las 7 llamadas esperadas están presentes', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({
      operation_types: ['rent'],
      property_types: ['apartment'],
      price_min: 5000,
      price_max: 20000,
      zone: 'Roma Norte',
      bedrooms_min: 1,
      pet_friendly: true,
      allows_no_guarantor: false,
      student_friendly: true,
    });

    build_filter_query(builder, filters);

    expect(builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
    expect(builder.in).toHaveBeenCalledWith('property_type', ['apartment']);
    expect(builder.gte).toHaveBeenCalledWith('price', 5000);
    expect(builder.lte).toHaveBeenCalledWith('price', 20000);
    expect(builder.eq).toHaveBeenCalledWith('zone', 'Roma Norte');
    expect(builder.gte).toHaveBeenCalledWith('bedrooms', 1);
    expect(builder.eq).toHaveBeenCalledWith('pet_friendly', true);
    expect(builder.eq).toHaveBeenCalledWith('student_friendly', true);
    // allows_no_guarantor=false → sin llamada
    const guarantor_calls = builder.calls.filter((c) => c.args[0] === 'allows_no_guarantor');
    expect(guarantor_calls).toEqual([]);
  });

  it('(EC-21) nunca_aplica_status_ni_deleted_at: con cualquier combinación de filtros, .eq nunca se llama con "status" ni "deleted_at" (queries base ya lo aplican)', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({
      operation_types: ['rent', 'sale'],
      property_types: ['house'],
      price_min: 1000,
      price_max: 5000,
      zone: 'Centro',
      bedrooms_min: 3,
      pet_friendly: true,
      allows_no_guarantor: true,
      student_friendly: true,
    });

    build_filter_query(builder, filters);

    const status_calls = builder.calls.filter(
      (c) => c.args[0] === 'status' || c.args[0] === 'deleted_at',
    );
    expect(status_calls).toEqual([]);
  });

  it('(EC-22) devuelve_el_mismo_builder_encadenable: build_filter_query devuelve la MISMA referencia del builder recibido', () => {
    const builder = make_fake_query_builder();
    const filters = make_filters({ zone: 'Condesa' });

    const result = build_filter_query(builder, filters);

    expect(result).toBe(builder);
  });
});

// ---------------------------------------------------------------------------
// get_active_filter_count
// ---------------------------------------------------------------------------

describe('get_active_filter_count', () => {
  it('(EC-23) empty_filters_cuenta_cero: EMPTY_FILTERS → 0', () => {
    expect(get_active_filter_count(EMPTY_FILTERS)).toBe(0);
  });

  it('(EC-24) conteo_multiple_precio_cuenta_uno_aunque_min_y_max_esten_set: operation_types + property_types + precio(min y max) + zone + bedrooms_min + 2 booleanos true → cuenta 6 (precio cuenta 1 aunque ambos estén set)', () => {
    const filters = make_filters({
      operation_types: ['rent'],
      property_types: ['house'],
      price_min: 5000,
      price_max: 20000,
      zone: 'Polanco',
      bedrooms_min: null,
      pet_friendly: true,
      allows_no_guarantor: true,
      student_friendly: false,
    });

    // operation_types(1) + property_types(1) + precio(1) + zone(1) + pet_friendly(1) + allows_no_guarantor(1) = 6
    expect(get_active_filter_count(filters)).toBe(6);
  });

  it('(EC-24b) conteo_solo_un_booleano_true_cuenta_uno: solo student_friendly=true, resto EMPTY → cuenta 1', () => {
    const filters = make_filters({ student_friendly: true });

    expect(get_active_filter_count(filters)).toBe(1);
  });

  it('(EC-24c) conteo_solo_price_max_cuenta_uno: solo price_max=10000 (price_min=null), resto EMPTY → cuenta 1 (rango de precio es un solo grupo)', () => {
    const filters = make_filters({ price_max: 10000 });

    expect(get_active_filter_count(filters)).toBe(1);
  });

  it('(24d) conteo_todos_los_filtros_activos_cuenta_ocho: operation_types + property_types + precio + zone + bedrooms_min + 3 booleanos true → cuenta 8 (todos los grupos activos)', () => {
    const filters: FilterState = {
      operation_types: ['rent', 'sale'],
      property_types: ['house', 'apartment'],
      price_min: 1000,
      price_max: 5000,
      zone: 'Centro',
      bedrooms_min: 2,
      pet_friendly: true,
      allows_no_guarantor: true,
      student_friendly: true,
    };

    expect(get_active_filter_count(filters)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// radius_m (#42.1) — EMPTY_FILTERS default + invariante A1
// ---------------------------------------------------------------------------

describe('EMPTY_FILTERS — radius_m (42.1)', () => {
  it('(EC-25) empty_filters_radius_m_default_5000_metros: EMPTY_FILTERS.radius_m === 5000 (default 5 km, #42 approach A1)', () => {
    expect(EMPTY_FILTERS.radius_m).toBe(5000);
  });
});

describe('build_filter_query — invariante A1: radius_m nunca viaja al builder (42.1)', () => {
  it('(EC-26) radius_m_nunca_viaja_a_build_filter_query_invariante_a1: un FilterState con radius_m=20000 produce EXACTAMENTE las mismas llamadas al builder que el mismo FilterState sin radius_m (radius_m es SOLO parámetro de properties_within_radius, jamás del builder)', () => {
    const builder_sin_radius = make_fake_query_builder();
    const builder_con_radius = make_fake_query_builder();

    const filtros_base = make_filters({
      operation_types: ['rent'],
      property_types: ['house'],
      price_min: 5000,
      price_max: 20000,
      zone: 'Roma Norte',
      bedrooms_min: 1,
      pet_friendly: true,
    });

    build_filter_query(builder_sin_radius, filtros_base);
    build_filter_query(builder_con_radius, { ...filtros_base, radius_m: 20000 });

    expect(builder_con_radius.calls).toEqual(builder_sin_radius.calls);
    // Ninguna llamada del builder debe referirse a radio/distancia.
    const radius_calls = builder_con_radius.calls.filter(
      (c) =>
        typeof c.args[0] === 'string' &&
        (c.args[0].includes('radius') || c.args[0].includes('distance')),
    );
    expect(radius_calls).toEqual([]);
  });
});
