/**
 * Tests fase RED — search_places (autocomplete server-side de lugares, #157.5)
 * Archivo SUT: mobile/src/features/map/lib/placeSearch.ts
 *
 * Contrato (RPC public.search_places de la migración 20260813000002):
 *   - search_places(query, deps) llama client.rpc('search_places',
 *     { p_query: query.trim(), p_limit: 10 }) y mapea filas → PlaceSuggestion.
 *   - Guard: query con < 2 caracteres útiles (tras trim) → [] SIN llamar la RPC
 *     (cada keystroke pasa por aquí; el guard del server existe pero evitamos
 *     el round-trip — mismo espíritu que EC-9 de useSavedProperties).
 *   - bbox: {min_lat, min_lng, max_lat, max_lng} de la fila; si CUALQUIERA es
 *     null (municipio sin colonias cargadas, decisión D4) → bbox: null
 *     (fail-closed, mismo espíritu que parse_location).
 *   - error de la RPC → throw Error(message) (el hook decide qué mostrar).
 *   - data null → [].
 *
 * EDGE CASES:
 * - (EC-PS1) query_vacia_no_llama_rpc
 * - (EC-PS2) query_un_caracter_no_llama_rpc
 * - (EC-PS3) query_valida_llama_rpc_con_trim_y_limit
 * - (EC-PS4) filas_se_mapean_a_suggestions_con_bbox
 * - (EC-PS5) bbox_parcialmente_null_cae_a_null
 * - (EC-PS6) error_de_rpc_lanza
 * - (EC-PS7) data_null_devuelve_lista_vacia
 */

import { search_places } from '../lib/placeSearch';
import type { PlaceSuggestion } from '../lib/placeSearch';

type RpcRow = {
  kind: 'neighborhood' | 'municipality';
  id: string;
  name: string;
  context: string;
  min_lat: number | null;
  min_lng: number | null;
  max_lat: number | null;
  max_lng: number | null;
};

function make_mock_supabase(result: { data: RpcRow[] | null; error: { message: string } | null }) {
  const mock_rpc = jest.fn().mockResolvedValue(result);
  return { rpc: mock_rpc, _mock_rpc: mock_rpc };
}

const ROW_COLONIA: RpcRow = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  min_lat: 20.69,
  min_lng: -103.38,
  max_lat: 20.71,
  max_lng: -103.36,
};

const ROW_MUNI_SIN_BBOX: RpcRow = {
  kind: 'municipality',
  id: '14039',
  name: 'Guadalajara',
  context: 'Jalisco',
  min_lat: null,
  min_lng: null,
  max_lat: null,
  max_lng: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('search_places — autocomplete de lugares (#157)', () => {
  it('(EC-PS1) query_vacia_no_llama_rpc: query "" (y solo espacios) → [] sin round-trip', async () => {
    const mock = make_mock_supabase({ data: [ROW_COLONIA], error: null });

    expect(await search_places('', { supabase: mock })).toEqual([]);
    expect(await search_places('   ', { supabase: mock })).toEqual([]);
    expect(mock._mock_rpc).not.toHaveBeenCalled();
  });

  it('(EC-PS2) query_un_caracter_no_llama_rpc: "p" → [] sin round-trip', async () => {
    const mock = make_mock_supabase({ data: [ROW_COLONIA], error: null });

    expect(await search_places('p', { supabase: mock })).toEqual([]);
    expect(mock._mock_rpc).not.toHaveBeenCalled();
  });

  it('(EC-PS3) query_valida_llama_rpc_con_trim_y_limit: " provi " → rpc("search_places", {p_query:"provi", p_limit:10})', async () => {
    const mock = make_mock_supabase({ data: [], error: null });

    await search_places('  provi  ', { supabase: mock });

    expect(mock._mock_rpc).toHaveBeenCalledWith('search_places', {
      p_query: 'provi',
      p_limit: 10,
    });
  });

  it('(EC-PS4) filas_se_mapean_a_suggestions_con_bbox: fila completa → PlaceSuggestion con bbox poblado', async () => {
    const mock = make_mock_supabase({ data: [ROW_COLONIA], error: null });

    const result = await search_places('provi', { supabase: mock });

    const expected: PlaceSuggestion = {
      kind: 'neighborhood',
      id: '42',
      name: 'Providencia',
      context: 'Guadalajara, Jal.',
      bbox: { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
    };
    expect(result).toEqual([expected]);
  });

  it('(EC-PS5) bbox_parcialmente_null_cae_a_null: municipio sin bbox (D4) → bbox: null, el resto de la fila intacto', async () => {
    const mock = make_mock_supabase({
      data: [ROW_MUNI_SIN_BBOX, { ...ROW_COLONIA, max_lng: null }],
      error: null,
    });

    const result = await search_places('guadal', { supabase: mock });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      kind: 'municipality',
      id: '14039',
      name: 'Guadalajara',
      context: 'Jalisco',
      bbox: null,
    });
    // Bbox con UN campo null → null completo (fail-closed, nada de NaN en el mapa).
    expect(result[1]?.bbox).toBeNull();
  });

  it('(EC-PS6) error_de_rpc_lanza: error {message} → throw con ese message', async () => {
    const mock = make_mock_supabase({ data: null, error: { message: 'se cayó la RPC' } });

    await expect(search_places('provi', { supabase: mock })).rejects.toThrow('se cayó la RPC');
  });

  it('(EC-PS7) data_null_devuelve_lista_vacia: data null sin error → []', async () => {
    const mock = make_mock_supabase({ data: null, error: null });

    expect(await search_places('provi', { supabase: mock })).toEqual([]);
  });
});
