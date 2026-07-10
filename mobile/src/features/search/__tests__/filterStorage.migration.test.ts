/**
 * Tests fase RED — migración de esquema persistido (radius_m null hydration)
 * Archivo SUT: mobile/src/features/search/lib/filterStorage.ts
 * Subtarea Taskmaster: 58.4 — Filter storage migration: Handle radius_m null hydration
 *
 * Contexto:
 *   - Esquema viejo (#42): FilterState.radius_m: number (siempre presente, p.ej. 5000).
 *   - Esquema nuevo (#58.1): FilterState.radius_m: number | null
 *     (EMPTY_FILTERS.radius_m === null, "sin límite" es un estado explícito).
 *   - Hipótesis de la subtarea: el merge fail-safe existente en load_filters
 *     (`{ ...EMPTY_FILTERS, ...parsed }`, filterStorage.ts:59) YA hidrata
 *     correctamente los tres casos (viejo/parcial/nuevo) sin cambio de código.
 *     Estos tests PRUEBAN esa hipótesis — si pasan de entrada, el veredicto es
 *     "no code change needed" y queda documentado aquí.
 *
 * PATRÓN DE MOCK: mismo storage falso en memoria que filterStorage.test.ts.
 *
 * EDGE CASES (RED):
 *
 * ### Migración de esquema — happy path
 * - (EC-STORAGE-1) esquema_viejo_con_radius_m_numero_preserva_el_numero_al_hidratar
 * - (EC-STORAGE-4) esquema_nuevo_con_radius_m_numero_preserva_el_numero_al_hidratar
 *
 * ### Migración de esquema — edge cases del PRD / invariante A1 (58.1)
 * - (EC-STORAGE-2) esquema_parcial_sin_radius_m_hidrata_default_null_de_empty_filters
 * - (EC-STORAGE-3) esquema_nuevo_con_radius_m_null_preserva_null_sin_pisarlo_con_default
 *
 * ### Fail-safe (no debe regresar por la migración)
 * - (EC-STORAGE-5) load_con_json_invalido_devuelve_empty_filters_completo_sin_lanzar
 *
 * ### Roundtrip end-to-end
 * - (EC-STORAGE-6) roundtrip_guardar_radius_m_null_y_leer_preserva_null
 *
 * ### Boundary / valores inválidos persistidos (si el merge NO cumple, es trabajo de GREEN)
 * - (EC-STORAGE-7) esquema_corrupto_con_radius_m_string_no_se_normaliza_a_number_ni_null
 */

import { EMPTY_FILTERS } from '../lib/filterQuery';
import { FILTERS_STORAGE_KEY, load_filters, save_filters } from '../lib/filterStorage';
import type { FilterState } from '../types';

// ---------------------------------------------------------------------------
// Mock de storage clave/valor en memoria (mismo patrón que filterStorage.test.ts)
// ---------------------------------------------------------------------------

function make_mock_storage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: jest.fn(async (key: string): Promise<string | null> =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null,
    ),
    setItem: jest.fn(async (key: string, value: string): Promise<void> => {
      store[key] = value;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('filterStorage — migración de esquema radius_m (58.4)', () => {
  // ── (EC-STORAGE-1) Esquema viejo (#42): radius_m número presente ──────────

  it('(EC-STORAGE-1) esquema_viejo_con_radius_m_numero_preserva_el_numero_al_hidratar: JSON persistido con radius_m: 5000 (esquema viejo) → load_filters devuelve radius_m: 5000', async () => {
    const old_schema_json = JSON.stringify({
      operation_types: ['rent'],
      property_types: [],
      price_min: null,
      price_max: null,
      zone: null,
      bedrooms_min: null,
      pet_friendly: false,
      allows_no_guarantor: false,
      student_friendly: false,
      radius_m: 5000,
    });
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: old_schema_json });

    const loaded = await load_filters({ storage });

    expect(loaded.radius_m).toBe(5000);
    expect(loaded.operation_types).toEqual(['rent']);
  });

  // ── (EC-STORAGE-2) Esquema parcial: falta radius_m por completo ───────────

  it('(EC-STORAGE-2) esquema_parcial_sin_radius_m_hidrata_default_null_de_empty_filters: JSON persistido SIN la key radius_m → load_filters devuelve radius_m: null (default de EMPTY_FILTERS)', async () => {
    const partial_schema_json = JSON.stringify({ zone: 'Condesa' });
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: partial_schema_json });

    const loaded = await load_filters({ storage });

    expect(loaded.radius_m).toBeNull();
    expect(loaded.zone).toBe('Condesa');
  });

  // ── (EC-STORAGE-3) Esquema nuevo: radius_m explícitamente null ────────────

  it('(EC-STORAGE-3) esquema_nuevo_con_radius_m_null_preserva_null_sin_pisarlo_con_default: JSON persistido con radius_m: null explícito → load_filters devuelve radius_m: null (el spread no lo pisa porque null es un valor definido en el objeto)', async () => {
    const new_schema_json = JSON.stringify({ ...EMPTY_FILTERS, radius_m: null, zone: 'Roma Norte' });
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: new_schema_json });

    const loaded = await load_filters({ storage });

    expect(loaded.radius_m).toBeNull();
    expect(loaded).toEqual({ ...EMPTY_FILTERS, radius_m: null, zone: 'Roma Norte' });
  });

  // ── (EC-STORAGE-4) Esquema nuevo: radius_m con número (usuario eligió radio) ─

  it('(EC-STORAGE-4) esquema_nuevo_con_radius_m_numero_preserva_el_numero_al_hidratar: JSON persistido con radius_m: 15000 (esquema nuevo, usuario seleccionó radio) → load_filters devuelve radius_m: 15000', async () => {
    const new_schema_json = JSON.stringify({ ...EMPTY_FILTERS, radius_m: 15000 });
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: new_schema_json });

    const loaded = await load_filters({ storage });

    expect(loaded.radius_m).toBe(15000);
  });

  // ── (EC-STORAGE-5) JSON inválido → EMPTY_FILTERS completo, fail-safe ──────

  it('(EC-STORAGE-5) load_con_json_invalido_devuelve_empty_filters_completo_sin_lanzar: storage.getItem devuelve JSON corrupto → load_filters resuelve a EMPTY_FILTERS completo (radius_m: null incluido) sin rechazar', async () => {
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: '{radius_m: 5000 corrupto' });

    await expect(load_filters({ storage })).resolves.toEqual(EMPTY_FILTERS);
    await expect(load_filters({ storage })).resolves.toHaveProperty('radius_m', null);
  });

  // ── (EC-STORAGE-6) Roundtrip: guardar null → leer preserva null ──────────

  it('(EC-STORAGE-6) roundtrip_guardar_radius_m_null_y_leer_preserva_null: save_filters con radius_m: null seguido de load_filters devuelve radius_m: null (JSON.stringify no omite null)', async () => {
    const storage = make_mock_storage();
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null, zone: 'Polanco' };

    await save_filters(filters, { storage });
    const [[, raw_value]] = storage.setItem.mock.calls as [[string, string]];
    // JSON.stringify NO omite propiedades con valor null (solo undefined) — lo
    // verificamos explícitamente porque es la trampa señalada en la subtarea.
    expect(JSON.parse(raw_value)).toHaveProperty('radius_m', null);

    const loaded = await load_filters({ storage });

    expect(loaded.radius_m).toBeNull();
    expect(loaded).toEqual(filters);
  });

  // ── (EC-STORAGE-7) Valor corrupto de tipo incorrecto persistido ───────────

  it('(EC-STORAGE-7) esquema_corrupto_con_radius_m_string_no_se_normaliza_a_number_ni_null: JSON persistido con radius_m: "5000" (string, dato corrupto/ajeno) → load_filters NO lo normaliza; expone el string tal cual (documenta que el merge no valida tipos, solo presencia de la key)', async () => {
    const corrupt_type_json = JSON.stringify({ ...EMPTY_FILTERS, radius_m: '5000' });
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: corrupt_type_json });

    const loaded = await load_filters({ storage });

    // El merge por spread preserva CUALQUIER valor presente en la key, sin
    // importar su tipo. Este test documenta el comportamiento actual: NO hay
    // type-narrowing a number | null. Si esto se considera un bug, es trabajo
    // de GREEN (agregar un type guard para radius_m).
    expect(loaded.radius_m).toBe('5000');
  });
});
