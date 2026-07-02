/**
 * Tests fase RED — persistencia de filtros (save_filters / load_filters)
 * Archivo SUT: mobile/src/features/search/lib/filterStorage.ts
 * Subtarea Taskmaster: 12.7 — query integration + AsyncStorage persistence
 *
 * SUT:
 *   save_filters(filters: FilterState, deps?: FilterStorageDeps): Promise<void>
 *   load_filters(deps?: FilterStorageDeps): Promise<FilterState>
 *
 * Contrato:
 *   - save_filters serializa `filters` con JSON.stringify y lo guarda bajo la
 *     key estable FILTERS_STORAGE_KEY = 'urbea_filters' (subtarea 12.7).
 *   - load_filters lee esa key y deserializa. Fail-safe: si no hay valor
 *     guardado, el JSON es inválido, o el valor deserializado no es un objeto
 *     plano (p.ej. array) → devuelve EMPTY_FILTERS SIN lanzar.
 *   - `deps.storage` es DI (getItem/setItem) — nunca se toca el módulo nativo
 *     @react-native-async-storage/async-storage en los tests.
 *
 * PATRÓN DE MOCK: storage falso en memoria con jest.fn() para getItem/setItem
 * (mismo espíritu DI que feedProperties.test.ts / mapProperties.test.ts).
 *
 * EDGE CASES CUBIERTOS (7 casos):
 *
 * ### Happy path
 * - (EC-S1) round_trip_guardar_y_leer_devuelve_mismo_filter_state
 * - (EC-S2) save_serializa_bajo_key_urbea_filters_con_json_correcto
 *
 * ### Fail-safe (nunca lanza)
 * - (EC-S3) load_sin_valor_guardado_devuelve_empty_filters
 * - (EC-S4) load_con_json_corrupto_devuelve_empty_filters_sin_lanzar
 * - (EC-S5) load_con_json_valido_pero_shape_invalida_array_devuelve_empty_filters
 *
 * ### Boundary / contrato
 * - (EC-S6) save_serializa_correctamente_filtros_con_todos_los_campos_activos
 * - (EC-S7) load_usa_key_urbea_filters_exacta_para_leer
 */

import { EMPTY_FILTERS } from '../lib/filterQuery';
import { FILTERS_STORAGE_KEY, load_filters, save_filters } from '../lib/filterStorage';
import type { FilterState } from '../types';

// ---------------------------------------------------------------------------
// Mock de storage clave/valor en memoria
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

function make_filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('filterStorage — persistencia del FilterState (12.7)', () => {
  // ── (EC-S1) Round-trip: guardar → leer devuelve el mismo estado ──────────

  it('(EC-S1) round_trip_guardar_y_leer_devuelve_mismo_filter_state: save_filters(filters) seguido de load_filters() devuelve un FilterState igual al guardado', async () => {
    const storage = make_mock_storage();
    const filters = make_filters({ operation_types: ['rent'], price_min: 5000, zone: 'Polanco' });

    await save_filters(filters, { storage });
    const loaded = await load_filters({ storage });

    expect(loaded).toEqual(filters);
  });

  // ── (EC-S2) save serializa bajo la key correcta con JSON correcto ─────────

  it('(EC-S2) save_serializa_bajo_key_urbea_filters_con_json_correcto: save_filters llama storage.setItem("urbea_filters", JSON.stringify(filters)) exactamente', async () => {
    const storage = make_mock_storage();
    const filters = make_filters({ pet_friendly: true });

    await save_filters(filters, { storage });

    expect(storage.setItem).toHaveBeenCalledWith(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  });

  // ── (EC-S3) Sin valor guardado → EMPTY_FILTERS ────────────────────────────

  it('(EC-S3) load_sin_valor_guardado_devuelve_empty_filters: storage.getItem devuelve null → load_filters devuelve EMPTY_FILTERS', async () => {
    const storage = make_mock_storage();

    const loaded = await load_filters({ storage });

    expect(loaded).toEqual(EMPTY_FILTERS);
  });

  // ── (EC-S4) JSON corrupto → EMPTY_FILTERS, sin lanzar ─────────────────────

  it('(EC-S4) load_con_json_corrupto_devuelve_empty_filters_sin_lanzar: storage.getItem devuelve "{corrupto" → load_filters resuelve a EMPTY_FILTERS sin rechazar la promesa', async () => {
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: '{corrupto' });

    await expect(load_filters({ storage })).resolves.toEqual(EMPTY_FILTERS);
  });

  // ── (EC-S5) JSON válido pero shape inválida (array) → EMPTY_FILTERS ───────

  it('(EC-S5) load_con_json_valido_pero_shape_invalida_array_devuelve_empty_filters: storage.getItem devuelve "[1,2,3]" (JSON válido, no es un FilterState) → load_filters devuelve EMPTY_FILTERS', async () => {
    const storage = make_mock_storage({ [FILTERS_STORAGE_KEY]: '[1,2,3]' });

    const loaded = await load_filters({ storage });

    expect(loaded).toEqual(EMPTY_FILTERS);
  });

  // ── (EC-S6) save serializa correctamente filtros con TODOS los campos activos

  it('(EC-S6) save_serializa_correctamente_filtros_con_todos_los_campos_activos: FilterState con todos los campos no-default → JSON.stringify exacto pasado a setItem', async () => {
    const storage = make_mock_storage();
    const filters: FilterState = {
      operation_types: ['rent', 'sale'],
      property_types: ['house', 'apartment'],
      price_min: 3000,
      price_max: 25000,
      zone: 'Roma Norte',
      bedrooms_min: 2,
      pet_friendly: true,
      allows_no_guarantor: true,
      student_friendly: true,
    };

    await save_filters(filters, { storage });

    const [[, raw_value]] = storage.setItem.mock.calls as [[string, string]];
    expect(JSON.parse(raw_value)).toEqual(filters);
  });

  // ── (EC-S7) load usa la key exacta 'urbea_filters' para leer ──────────────

  it('(EC-S7) load_usa_key_urbea_filters_exacta_para_leer: load_filters llama storage.getItem("urbea_filters") exactamente una vez', async () => {
    const storage = make_mock_storage();

    await load_filters({ storage });

    expect(storage.getItem).toHaveBeenCalledWith(FILTERS_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });
});
