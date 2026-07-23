/**
 * Tests fase RED — fetch_grid_posters (gridPosters.ts)
 * Subtarea Taskmaster: 89.2 — helper compartido, pieza 1 (CRÍTICA)
 *
 * SUT: fetch_grid_posters(supabase, property_ids: string[]): Promise<Map<string,string>>
 *
 * Contrato (EF mint-poster-urls, 89.1, ya en GREEN — supabase/functions/mint-poster-urls):
 *   - Invoca supabase.functions.invoke('mint-poster-urls', { body: { property_ids } }).
 *   - 200 { posters: [{ property_id, posterUrl }] } — SOLO los ids autorizados
 *     (dueño-o-activo) con video Stream listo. Fail-closed POR ITEM: el resto
 *     de los ids pedidos simplemente NO aparece en `posters` (no llega como
 *     null, se OMITE).
 *   - property_ids=[] es válido para la EF, pero el helper NUNCA debe tocar
 *     la red en ese caso (ahorra un round-trip inútil).
 *   - Fail-soft (frontera del sistema — la EF puede fallar): CUALQUIER error
 *     (de negocio, malformado, o excepción de red) → Map vacío, el helper
 *     JAMÁS lanza — la lista de propiedades no debe romperse por falta de
 *     portada.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (H1) un_id_devuelve_map_con_una_entrada
 * - (H2) varios_ids_devuelve_map_con_todas_las_entradas
 *
 * ### Ramas no obvias — fail-closed por-item de la EF
 * - (R1) ef_omite_id_no_autorizado_map_no_incluye_esa_key
 *
 * ### Boundary / error — fail-soft, nunca lanza
 * - (B1) ids_vacio_no_invoca_la_ef
 * - (B2) ef_devuelve_error_map_vacio_sin_lanzar
 * - (B3) data_ausente_sin_error_map_vacio_sin_lanzar
 * - (B4) posters_ausente_en_data_map_vacio_sin_lanzar
 * - (B5) invoke_rechaza_excepcion_de_red_map_vacio_sin_lanzar
 */

import { fetch_grid_posters } from '../gridPosters';

// ---------------------------------------------------------------------------
// Constantes de test — valores independientes del SUT
// ---------------------------------------------------------------------------

const PROPERTY_ID_A = 'grid-poster-uuid-aaa';
const PROPERTY_ID_B = 'grid-poster-uuid-bbb';
const PROPERTY_ID_C = 'grid-poster-uuid-ccc';

const POSTER_URL_A = 'https://videodelivery.net/stream-uid-aaa/thumbnails/thumbnail.jpg?token=sig-a';
const POSTER_URL_B = 'https://videodelivery.net/stream-uid-bbb/thumbnails/thumbnail.jpg?token=sig-b';

// ---------------------------------------------------------------------------
// Factory del mock de Supabase — solo functions.invoke (único método usado)
// ---------------------------------------------------------------------------

function make_mock_supabase(invoke_impl: jest.Mock) {
  return { functions: { invoke: invoke_impl } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetch_grid_posters', () => {
  // ── Happy path ────────────────────────────────────────────────────────

  it('(H1) un_id_devuelve_map_con_una_entrada: 1 property_id → invoke 1 vez con {property_ids} exacto, Map con 1 par', async () => {
    const mock_invoke = jest.fn().mockResolvedValue({
      data: { posters: [{ property_id: PROPERTY_ID_A, posterUrl: POSTER_URL_A }] },
      error: null,
    });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A]);

    expect(mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_invoke).toHaveBeenCalledWith('mint-poster-urls', {
      body: { property_ids: [PROPERTY_ID_A] },
    });
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(1);
    expect(result.get(PROPERTY_ID_A)).toBe(POSTER_URL_A);
  });

  it('(H2) varios_ids_devuelve_map_con_todas_las_entradas: N ids → Map con N pares, valores correctos por id', async () => {
    const mock_invoke = jest.fn().mockResolvedValue({
      data: {
        posters: [
          { property_id: PROPERTY_ID_A, posterUrl: POSTER_URL_A },
          { property_id: PROPERTY_ID_B, posterUrl: POSTER_URL_B },
        ],
      },
      error: null,
    });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A, PROPERTY_ID_B]);

    expect(result.size).toBe(2);
    expect(result.get(PROPERTY_ID_A)).toBe(POSTER_URL_A);
    expect(result.get(PROPERTY_ID_B)).toBe(POSTER_URL_B);
  });

  // ── Ramas no obvias — fail-closed por-item de la EF ─────────────────────

  it('(R1) ef_omite_id_no_autorizado_map_no_incluye_esa_key: la EF omite un id (no autorizado/sin video) → el Map no trae esa key, sí las autorizadas', async () => {
    // Se piden 3 ids; la EF solo devuelve 2 (omitió PROPERTY_ID_C).
    const mock_invoke = jest.fn().mockResolvedValue({
      data: {
        posters: [
          { property_id: PROPERTY_ID_A, posterUrl: POSTER_URL_A },
          { property_id: PROPERTY_ID_B, posterUrl: POSTER_URL_B },
        ],
      },
      error: null,
    });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A, PROPERTY_ID_B, PROPERTY_ID_C]);

    expect(result.size).toBe(2);
    expect(result.has(PROPERTY_ID_C)).toBe(false);
    expect(result.has(PROPERTY_ID_A)).toBe(true);
    expect(result.has(PROPERTY_ID_B)).toBe(true);
  });

  // ── Boundary / error — fail-soft, nunca lanza ───────────────────────────

  it('(B1) ids_vacio_no_invoca_la_ef: property_ids=[] → Map vacío, SIN invocar la EF', async () => {
    const mock_invoke = jest.fn();
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, []);

    expect(mock_invoke).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('(B2) ef_devuelve_error_map_vacio_sin_lanzar: invoke resuelve {data:null,error:{...}} → Map vacío, no lanza', async () => {
    const mock_invoke = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'UNAUTHENTICATED' },
    });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A]);

    expect(result.size).toBe(0);
  });

  it('(B3) data_ausente_sin_error_map_vacio_sin_lanzar: invoke resuelve {data:null,error:null} (defensivo) → Map vacío, no lanza', async () => {
    const mock_invoke = jest.fn().mockResolvedValue({ data: null, error: null });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A]);

    expect(result.size).toBe(0);
  });

  it('(B4) posters_ausente_en_data_map_vacio_sin_lanzar: invoke resuelve {data:{},error:null} (malformado) → Map vacío, no lanza', async () => {
    const mock_invoke = jest.fn().mockResolvedValue({ data: {}, error: null });
    const supabase = make_mock_supabase(mock_invoke);

    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A]);

    expect(result.size).toBe(0);
  });

  it('(B5) invoke_rechaza_excepcion_de_red_map_vacio_sin_lanzar: invoke RECHAZA (red caída) → Map vacío, no propaga la excepción', async () => {
    const mock_invoke = jest.fn().mockRejectedValue(new Error('network fail'));
    const supabase = make_mock_supabase(mock_invoke);

    await expect(fetch_grid_posters(supabase, [PROPERTY_ID_A])).resolves.toBeInstanceOf(Map);
    const result = await fetch_grid_posters(supabase, [PROPERTY_ID_A]);
    expect(result.size).toBe(0);
  });
});
