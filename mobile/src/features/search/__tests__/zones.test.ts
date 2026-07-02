/**
 * Tests fase RED — fetch_distinct_zones / filter_zones
 * Archivo SUT: mobile/src/features/search/lib/zones.ts
 * Subtarea Taskmaster: 12.4 — Input de zona/colonia con autocomplete
 *
 * SUT:
 *   - fetch_distinct_zones(deps?) → Promise<string[]>
 *   - filter_zones(zones, query) → string[]  (función PURA)
 *
 * DECISIÓN DE DISEÑO (vault 🔒 — no ILIKE '%texto%' sin índice; properties.zone
 * no tiene índice y no se creará migración):
 *   1. fetch_distinct_zones() trae UNA vez, desde la DB, las zonas distintas de
 *      propiedades activas (status='active', deleted_at IS NULL). SIN filtro de
 *      texto en la query — solo select('zone') + los dos filtros de visibilidad.
 *      Dedup/orden/limpieza (null, vacío, whitespace) se hacen client-side.
 *   2. filter_zones() es PURA y filtra esa lista ya cargada según lo que el
 *      usuario teclea. Nunca toca la DB, nunca lanza.
 *   3. El valor final seleccionado es una zona EXACTA de la lista (12.6 usará
 *      match exacto .in()/.eq('zone', …), fuera de alcance de esta subtarea).
 *
 * Política filter_zones (documentada aquí; el guardian verifica estos casos):
 *   - Substring case-insensitive (NO solo prefijo): "santa" matchea
 *     "Nueva Santa María".
 *   - query vacío o solo espacios → devuelve la lista completa.
 *   - El query se trimea antes de comparar.
 *   - Acentos: SE NORMALIZAN (se remueven diacríticos) antes de comparar →
 *     "alvaro" matchea "Álvaro Obregón".
 *
 * EDGE CASES CUBIERTOS (15 casos):
 *
 * ### fetch_distinct_zones — happy path / dedup / limpieza
 * - (EC-1) happy_path_lista_zonas_unicas_ordenadas_alfabeticamente
 * - (EC-2) dedup_zonas_repetidas_en_filas_distintas_deduplicadas
 * - (EC-3) descarta_zone_null_no_aparece_en_resultado
 * - (EC-4) descarta_zone_string_vacio_o_solo_espacios_no_aparece_en_resultado
 * - (EC-5) lista_vacia_data_vacio_devuelve_array_vacio
 *
 * ### fetch_distinct_zones — filtros de query / error
 * - (EC-6) query_filtra_status_active_y_deleted_at_null_select_zone
 * - (EC-7) error_query_supabase_lanza_error_con_message_y_from_fue_llamado
 *
 * ### filter_zones — matching
 * - (EC-8) match_case_insensitive_query_minusculas_matchea_zona_con_mayusculas
 * - (EC-9) match_substring_no_solo_prefijo_matchea_en_medio_del_nombre
 * - (EC-10) query_vacio_devuelve_lista_completa
 * - (EC-11) query_solo_espacios_devuelve_lista_completa
 * - (EC-12) trim_espacios_alrededor_del_query_antes_de_comparar
 * - (EC-13) sin_coincidencias_devuelve_array_vacio
 * - (EC-14) no_muta_array_de_entrada
 * - (EC-15) acentos_se_normalizan_query_sin_acento_matchea_zona_con_acento
 */

import { fetch_distinct_zones, filter_zones } from '../lib/zones';

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable) — mismo patrón que
// map/lib/__tests__/mapProperties.test.ts
// ---------------------------------------------------------------------------

type QueryRow = { zone: string | null };
type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    then: (
      onFulfilled: (v: QueryResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: { query_result?: QueryResult } = {}) {
  const { query_result = { data: [], error: null } } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);

  return {
    from: mock_from,
    _mock_from: mock_from,
    _query_builder: query_builder,
  };
}

function make_row(zone: string | null): QueryRow {
  return { zone };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetch_distinct_zones
// ---------------------------------------------------------------------------

describe('fetch_distinct_zones', () => {

  // ── (EC-1) Happy path: zonas únicas, orden de entrada mezclado → salida ordenada ──

  it('(EC-1) happy_path_lista_zonas_unicas_ordenadas_alfabeticamente: rows con zonas distintas en orden mezclado → array ordenado alfabéticamente', async () => {
    const rows: QueryRow[] = [
      make_row('Roma Norte'),
      make_row('Polanco'),
      make_row('Condesa'),
    ];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetch_distinct_zones({ supabase: mock_supabase });

    expect(result).toEqual(['Condesa', 'Polanco', 'Roma Norte']);
  });

  // ── (EC-2) Dedup: zonas repetidas en filas distintas → lista única ──────────

  it('(EC-2) dedup_zonas_repetidas_en_filas_distintas_deduplicadas: 4 rows, "Polanco" aparece 3 veces → resultado contiene "Polanco" una sola vez', async () => {
    const rows: QueryRow[] = [
      make_row('Polanco'),
      make_row('Polanco'),
      make_row('Roma Norte'),
      make_row('Polanco'),
    ];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetch_distinct_zones({ supabase: mock_supabase });

    expect(result).toEqual(['Polanco', 'Roma Norte']);
    expect(result.filter((z) => z === 'Polanco')).toHaveLength(1);
  });

  // ── (EC-3) zone null → descartada ────────────────────────────────────────────

  it('(EC-3) descarta_zone_null_no_aparece_en_resultado: row con zone=null mezclada con válidas → null no aparece en el resultado', async () => {
    const rows: QueryRow[] = [make_row('Polanco'), make_row(null), make_row('Roma Norte')];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetch_distinct_zones({ supabase: mock_supabase });

    expect(result).toEqual(['Polanco', 'Roma Norte']);
    expect(result).not.toContain(null);
  });

  // ── (EC-4) zone vacío / solo espacios → descartada ───────────────────────────

  it('(EC-4) descarta_zone_string_vacio_o_solo_espacios_no_aparece_en_resultado: rows con zone="" y zone="   " → ninguna aparece en el resultado', async () => {
    const rows: QueryRow[] = [make_row('Polanco'), make_row(''), make_row('   ')];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });

    const result = await fetch_distinct_zones({ supabase: mock_supabase });

    expect(result).toEqual(['Polanco']);
  });

  // ── (EC-5) data vacío → [] sin lanzar ────────────────────────────────────────

  it('(EC-5) lista_vacia_data_vacio_devuelve_array_vacio: query retorna {data:[], error:null} → fetch_distinct_zones devuelve [] sin lanzar', async () => {
    const mock_supabase = make_mock_supabase({ query_result: { data: [], error: null } });

    const result = await fetch_distinct_zones({ supabase: mock_supabase });

    expect(result).toEqual([]);
  });

  // ── (EC-6) Filtros de query: select('zone'), eq('status','active'), is('deleted_at', null) ──

  it('(EC-6) query_filtra_status_active_y_deleted_at_null_select_zone: from("properties"), select("zone"), .eq("status","active") y .is("deleted_at", null) fueron llamados', async () => {
    const mock_supabase = make_mock_supabase({ query_result: { data: [], error: null } });

    try {
      await fetch_distinct_zones({ supabase: mock_supabase });
    } catch {
      // el stub lanza — ignorado; nos interesan las llamadas al builder
    }

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
    expect(mock_supabase._query_builder.select).toHaveBeenCalledWith('zone');
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(mock_supabase._query_builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  // ── (EC-7) Error de query → lanza Error con el message ───────────────────────

  it('(EC-7) error_query_supabase_lanza_error_con_message_y_from_fue_llamado: query retorna {data:null, error:{message:"db error"}} → fetch_distinct_zones lanza y from("properties") fue intentado', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: null, error: { message: 'db error' } },
    });

    await expect(fetch_distinct_zones({ supabase: mock_supabase })).rejects.toThrow('db error');

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
  });

});

// ---------------------------------------------------------------------------
// filter_zones (función pura)
// ---------------------------------------------------------------------------

describe('filter_zones', () => {

  const ZONAS = ['Polanco', 'Roma Norte', 'Nueva Santa María', 'Condesa', 'Álvaro Obregón'];

  // ── (EC-8) case-insensitive: query en minúsculas matchea zona con mayúsculas ──

  it('(EC-8) match_case_insensitive_query_minusculas_matchea_zona_con_mayusculas: filter_zones(ZONAS, "pol") → incluye "Polanco"', () => {
    const result = filter_zones(ZONAS, 'pol');
    expect(result).toEqual(['Polanco']);
  });

  // ── (EC-9) substring, no solo prefijo ────────────────────────────────────────

  it('(EC-9) match_substring_no_solo_prefijo_matchea_en_medio_del_nombre: filter_zones(ZONAS, "santa") → incluye "Nueva Santa María" aunque "santa" no es prefijo', () => {
    const result = filter_zones(ZONAS, 'santa');
    expect(result).toEqual(['Nueva Santa María']);
  });

  // ── (EC-10) query vacío → lista completa ─────────────────────────────────────

  it('(EC-10) query_vacio_devuelve_lista_completa: filter_zones(ZONAS, "") → devuelve las 5 zonas sin filtrar', () => {
    const result = filter_zones(ZONAS, '');
    expect(result).toEqual(ZONAS);
  });

  // ── (EC-11) query solo espacios → lista completa ─────────────────────────────

  it('(EC-11) query_solo_espacios_devuelve_lista_completa: filter_zones(ZONAS, "   ") → devuelve las 5 zonas sin filtrar', () => {
    const result = filter_zones(ZONAS, '   ');
    expect(result).toEqual(ZONAS);
  });

  // ── (EC-12) trim del query antes de comparar ─────────────────────────────────

  it('(EC-12) trim_espacios_alrededor_del_query_antes_de_comparar: filter_zones(ZONAS, "  pol  ") → matchea igual que "pol" sin espacios', () => {
    const result = filter_zones(ZONAS, '  pol  ');
    expect(result).toEqual(['Polanco']);
  });

  // ── (EC-13) sin coincidencias → [] ───────────────────────────────────────────

  it('(EC-13) sin_coincidencias_devuelve_array_vacio: filter_zones(ZONAS, "xyz-no-existe") → []', () => {
    const result = filter_zones(ZONAS, 'xyz-no-existe');
    expect(result).toEqual([]);
  });

  // ── (EC-14) no muta el array de entrada ──────────────────────────────────────

  it('(EC-14) no_muta_array_de_entrada: filter_zones no modifica el array `zones` original (misma referencia, mismo contenido tras filtrar)', () => {
    const original = [...ZONAS];
    filter_zones(ZONAS, 'pol');
    expect(ZONAS).toEqual(original);
  });

  // ── (EC-15) acentos normalizados: query sin acento matchea zona con acento ──

  it('(EC-15) acentos_se_normalizan_query_sin_acento_matchea_zona_con_acento: filter_zones(ZONAS, "alvaro") → incluye "Álvaro Obregón" pese a no llevar acento', () => {
    const result = filter_zones(ZONAS, 'alvaro');
    expect(result).toEqual(['Álvaro Obregón']);
  });

});
