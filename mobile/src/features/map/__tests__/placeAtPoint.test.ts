/**
 * Tests fase RED — resolve_place_at_point (#232.1 cliente)
 * Archivo SUT: mobile/src/features/map/lib/placeAtPoint.ts
 *
 * Contrato (RPC public.place_at_point(p_lat, p_lng) — pinneada por el
 * backend en paralelo, mismo shape de fila que search_places):
 *   - rpc('place_at_point', { p_lat, p_lng }).
 *   - 0 filas → null (fuera de cobertura del catálogo — el cliente NUNCA
 *     inventa una zona).
 *   - 1 fila → PlaceSuggestion (mismo mapeo que search_places, reusado de
 *     lib/placeSearch.ts vía row_to_suggestion — sin duplicar el fail-closed
 *     de bbox parcialmente null).
 *   - data null (sin error) → null (mismo criterio que 0 filas).
 *   - error de RPC → throw Error(message) (el caller decide qué mostrar).
 *
 * EDGE CASES:
 * - (EC-PP1) llama_rpc_con_lat_lng_exactos
 * - (EC-PP2) cero_filas_devuelve_null
 * - (EC-PP3) una_fila_se_mapea_a_suggestion_con_bbox
 * - (EC-PP4) bbox_parcialmente_null_cae_a_null_reusa_row_to_bbox
 * - (EC-PP5) data_null_devuelve_null
 * - (EC-PP6) error_de_rpc_lanza
 */

import { resolve_place_at_point } from '../lib/placeAtPoint';
import type { PlaceRpcRow } from '../lib/placeSearch';
import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

function make_mock_supabase(result: { data: PlaceRpcRow[] | null; error: { message: string } | null }) {
  // Candado #233.3: `rpc` sensible al binding — el mutante
  // `const { rpc } = client; rpc(...)` (#205) muere si alguien lo
  // reintroduce en placeAtPoint.ts. Spread conserva la forma {rpc,_mock_rpc}.
  const { client, _mock_rpc } = make_binding_sensitive_supabase_mock({
    rpc: () => Promise.resolve(result),
  });
  return { ...client, _mock_rpc };
}

const ROW_COLONIA: PlaceRpcRow = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  min_lat: 20.69,
  min_lng: -103.38,
  max_lat: 20.71,
  max_lng: -103.36,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolve_place_at_point — geocode inverso a zona de catálogo (#232)', () => {
  it('(EC-PP1) llama_rpc_con_lat_lng_exactos: rpc("place_at_point", {p_lat, p_lng})', async () => {
    const mock = make_mock_supabase({ data: [], error: null });

    await resolve_place_at_point(20.6736, -103.344, { supabase: mock });

    expect(mock._mock_rpc).toHaveBeenCalledWith('place_at_point', {
      p_lat: 20.6736,
      p_lng: -103.344,
    });
  });

  it('(EC-PP2) cero_filas_devuelve_null: [] → null (fuera de cobertura)', async () => {
    const mock = make_mock_supabase({ data: [], error: null });

    expect(await resolve_place_at_point(0, 0, { supabase: mock })).toBeNull();
  });

  it('(EC-PP3) una_fila_se_mapea_a_suggestion_con_bbox', async () => {
    const mock = make_mock_supabase({ data: [ROW_COLONIA], error: null });

    const result = await resolve_place_at_point(20.7, -103.37, { supabase: mock });

    expect(result).toEqual({
      kind: 'neighborhood',
      id: '42',
      name: 'Providencia',
      context: 'Guadalajara, Jal.',
      bbox: { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
    });
  });

  it('(EC-PP4) bbox_parcialmente_null_cae_a_null_reusa_row_to_bbox: municipio sin bbox → bbox: null', async () => {
    const mock = make_mock_supabase({
      data: [{ ...ROW_COLONIA, kind: 'municipality', max_lng: null }],
      error: null,
    });

    const result = await resolve_place_at_point(20.7, -103.37, { supabase: mock });

    expect(result?.bbox).toBeNull();
  });

  it('(EC-PP5) data_null_devuelve_null: data null sin error → null', async () => {
    const mock = make_mock_supabase({ data: null, error: null });

    expect(await resolve_place_at_point(20.7, -103.37, { supabase: mock })).toBeNull();
  });

  it('(EC-PP6) error_de_rpc_lanza: error {message} → throw con ese message', async () => {
    const mock = make_mock_supabase({ data: null, error: { message: 'se cayó place_at_point' } });

    await expect(resolve_place_at_point(20.7, -103.37, { supabase: mock })).rejects.toThrow(
      'se cayó place_at_point',
    );
  });
});
