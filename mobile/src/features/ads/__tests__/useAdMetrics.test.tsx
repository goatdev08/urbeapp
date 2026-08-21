/**
 * Tests fase RED — useAdMetrics hook (panel del anunciante, tarea 171)
 * Archivo SUT: mobile/src/features/ads/hooks/useAdMetrics.ts
 * Subtarea Taskmaster: 171.2
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se renegocia):
 *
 *   useAdMetrics(agencyId: string | null): {
 *     zones: AdZoneMetrics[];
 *     other_zones: AdZoneTotals | null;
 *     totals: AdZoneTotals | null;
 *     loading: boolean;
 *     error: string | null;
 *   }
 *
 * Llamada: UNA sola `supabase.rpc('ad_metrics_for_agency', { p_agency_id: agencyId })`
 * por cambio de `agencyId`. NUNCA se pasan p_from/p_to (171.3/R23 no tiene
 * selector de fechas todavía — YAGNI).
 *
 * La RPC real (supabase/migrations/20260821000001_ad_metrics_for_agency.sql,
 * ya en GREEN) devuelve filas `{ municipality_id, neighborhood_id, impressions,
 * views, cta_taps }`. Zonas reales con >=5 usuarios distintos se desglosan tal
 * cual; todo lo demás (zonas reales colapsadas por privacidad + impresiones
 * sin zona resuelta) se funde en UNA fila `(municipality_id=NULL,
 * neighborhood_id=NULL)` — el bucket "otras zonas", que solo aparece si hay
 * algo que colapsar. Sin autorización → 0 filas, nunca excepción (anti-IDOR).
 *
 * 🔴 GOTCHA REAL (no hipotético): supabase/types/database.types.ts (regenerado
 * 2026-08-20) tipa el retorno de esta RPC como
 * `{ municipality_id: string; neighborhood_id: number; ... }` — SIN
 * nullability, porque el generador no la deriva de un `RETURNS TABLE`. El
 * tipo MIENTE: en runtime esos dos campos llegan `null` para el bucket. Un
 * hook que confíe ciegamente en ese tipo (p.ej. compare `row.municipality_id`
 * sin considerar `null`, o asuma "el bucket siempre es la última fila") mete
 * el bucket como si fuera una zona real más — EC-4 clava justo eso, con el
 * bucket a la mitad del array, no al final, para que un heurístico de
 * posición tampoco disimule el bug.
 *
 * INVARIANTES QUE ESTE ARCHIVO DEBE CLAVAR:
 *   1. El bucket NUNCA entra en `zones` (EC-2, EC-4).
 *   2. Anti-reconstrucción: el hook no reparte/estima/prorratea el bucket
 *      entre las zonas visibles — `zones` son las filas reales tal cual,
 *      `other_zones` se expone tal cual (EC-6, EC-7).
 *   3. `totals` es `null` mientras carga y ante error — JAMÁS ceros. Un
 *      anunciante SIN datos todavía (RPC → [] sin error) SÍ recibe
 *      `totals = {0,0,0}` con `error === null` — los dos casos deben ser
 *      distinguibles (EC-8, EC-9, EC-10, EC-11).
 *   4. `totals` cuadra: suma de `zones` + `other_zones` == `totals` (EC-3).
 *   5. `agencyId === null` / `''` → no dispara la RPC, resuelve de inmediato
 *      en el estado vacío seguro (EC-12, EC-13).
 *   6. 0 filas por falta de autorización se ve IGUAL que "sin datos" — nadie
 *      debe "arreglar" eso después metiendo un error (EC-11).
 *   7. Error de RPC → mensaje NEUTRO en español, nunca el texto crudo de
 *      PostgREST/Postgres, incluyendo el caso `42883 function ... does not
 *      exist` (ventana de deploy sin schema, mismo criterio fail-closed que
 *      useCanAdvertise) (EC-14, EC-15).
 *   8. Race: `agencyId` cambia con una llamada en vuelo → se descarta la
 *      respuesta vieja (EC-16).
 *   9. Re-render con el MISMO `agencyId` no redispara la RPC (EC-17).
 *  10. `loading` es `true` de forma síncrona mientras la RPC (no vacía) está
 *      pendiente, y nunca hay `totals` no-null con `loading=true` (EC-18).
 *
 * PATRÓN DE MOCK: mock_supabase_holder + getter sobre
 * `@/lib/supabase/client`, objeto plano `{ rpc: jest.fn() }` — calca
 * useLeadStats.test.ts (RPC batched, error neutro en español).
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act`; sin `await` el
 * `result` es `undefined`. `expect(act(...)).resolves.not.toThrow()` está
 * PROHIBIDO (vacuo) — el caso "no lanza" (EC-15) se captura con try/catch
 * sobre una variable, nunca con ese patrón.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) llama_rpc_una_sola_vez_con_p_agency_id_sin_p_from_ni_p_to
 * - (EC-2) zonas_reales_llegan_intactas_a_zones_bucket_queda_fuera
 * - (EC-3) totals_cuadra_con_la_suma_de_zonas_mas_el_bucket
 *
 * ### El gotcha de nullability mentida por el tipo generado
 * - (EC-4) bucket_null_null_nunca_entra_a_zones_pese_al_tipo_generado_no_nullable
 * - (EC-5) sin_fila_bucket_en_la_respuesta_other_zones_es_null
 *
 * ### Anti-reconstrucción (garantía de privacidad del lado cliente)
 * - (EC-6) no_reparte_el_bucket_entre_las_zonas_visibles
 * - (EC-7) solo_bucket_sin_zonas_reales_zones_queda_vacio_no_se_sintetiza_una_zona
 *
 * ### totals: null vs ceros (la garantía central para quien pagó el slot)
 * - (EC-8) totals_null_mientras_carga
 * - (EC-9) totals_null_ante_error_nunca_ceros
 * - (EC-10) estado_vacio_legitimo_sin_datos_todavia_totals_en_cero_y_error_null
 * - (EC-11) cero_filas_por_falta_de_autorizacion_indistinguible_del_estado_vacio
 *
 * ### Boundary — agencyId
 * - (EC-12) agencyId_null_no_dispara_rpc_resuelve_de_inmediato
 * - (EC-13) agencyId_vacio_no_dispara_rpc
 *
 * ### Error
 * - (EC-14) error_de_rpc_mensaje_neutro_en_espanol_no_el_texto_crudo
 * - (EC-15) funcion_no_existe_42883_falla_cerrado_sin_lanzar
 *
 * ### Race / dependencia del efecto
 * - (EC-16) agencyId_cambia_con_llamada_en_vuelo_descarta_la_respuesta_vieja
 * - (EC-17) rerender_con_el_mismo_agencyId_no_redispara_la_rpc
 *
 * ### Boundary — loading
 * - (EC-18) loading_true_sincrono_mientras_la_rpc_no_vacia_esta_pendiente
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter
// (idéntico a useLeadStats.test.ts). El SUT llama `supabase.rpc(...)`
// directo — el mock es un objeto plano `{ rpc: jest.fn() }`.
// ---------------------------------------------------------------------------

type MockSupabaseClient = { rpc: jest.Mock };

const mock_supabase_holder: { client: MockSupabaseClient } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar el mock
// ---------------------------------------------------------------------------

import { useAdMetrics } from '../hooks/useAdMetrics';

// ---------------------------------------------------------------------------
// Constantes y datos de test
// ---------------------------------------------------------------------------

const AGENCY_ID = 'agencia-uuid-171-2-metricas';
const AGENCY_ID_B = 'agencia-uuid-171-2-OTRA-metricas';

/**
 * Shape REAL en runtime — deliberadamente nullable en municipality_id/
 * neighborhood_id, a diferencia del tipo generado que MIENTE (ver docblock).
 */
type AdMetricsRpcRow = {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
};

const ZONE_A: AdMetricsRpcRow = {
  municipality_id: 'municipio-a',
  neighborhood_id: null,
  impressions: 120,
  views: 80,
  cta_taps: 10,
};

const ZONE_B: AdMetricsRpcRow = {
  municipality_id: 'municipio-a',
  neighborhood_id: 501,
  impressions: 40,
  views: 25,
  cta_taps: 3,
};

const OTHER_ZONE_B: AdMetricsRpcRow = {
  municipality_id: 'municipio-b',
  neighborhood_id: 900,
  impressions: 7,
  views: 4,
  cta_taps: 0,
};

/** El bucket "otras zonas" — la llave (NULL, NULL) que jamás debe caer en `zones`. */
const BUCKET: AdMetricsRpcRow = {
  municipality_id: null,
  neighborhood_id: null,
  impressions: 15,
  views: 6,
  cta_taps: 1,
};

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las métricas del anuncio. Intenta de nuevo.';

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
// ---------------------------------------------------------------------------

function make_supabase_mock(
  opts: {
    rpc_result?: { data: AdMetricsRpcRow[] | null; error: { code?: string; message: string } | null };
  } = {},
): MockSupabaseClient {
  const { rpc_result = { data: [ZONE_A, ZONE_B, BUCKET], error: null } } = opts;
  return {
    rpc: jest.fn().mockResolvedValue(rpc_result),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAdMetrics', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('(EC-1) llama_rpc_una_sola_vez_con_p_agency_id_sin_p_from_ni_p_to: UNA sola llamada a ad_metrics_for_agency, con SOLO p_agency_id (171.3/R23 no tiene selector de fechas — YAGNI)', async () => {
    await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('ad_metrics_for_agency', {
      p_agency_id: AGENCY_ID,
    });
  });

  it('(EC-2) zonas_reales_llegan_intactas_a_zones_bucket_queda_fuera: las filas reales se exponen tal cual en `zones`, el bucket (NULL,NULL) NUNCA aparece ahí', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ZONE_A, ZONE_B, BUCKET], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.zones).toEqual([ZONE_A, ZONE_B]);
    expect(
      result.current.zones.some(
        (z) => z.municipality_id === null && z.neighborhood_id === null,
      ),
    ).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-3) totals_cuadra_con_la_suma_de_zonas_mas_el_bucket: totals == suma componente-por-componente de zones + other_zones (es dinero, base de #172)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ZONE_A, ZONE_B, BUCKET], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    // Fuente independiente: sumado a mano, no recomputado con la misma
    // fórmula que usará la implementación.
    expect(result.current.totals).toEqual({
      impressions: 120 + 40 + 15, // 175
      views: 80 + 25 + 6, // 111
      cta_taps: 10 + 3 + 1, // 14
    });
  });

  // ── El gotcha de nullability mentida por el tipo generado ──────────────────

  it('(EC-4) bucket_null_null_nunca_entra_a_zones_pese_al_tipo_generado_no_nullable: el bucket llega a la MITAD del array (no al final) — un heurístico de posición tampoco puede disimular que se coló como zona', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ZONE_A, BUCKET, ZONE_B, OTHER_ZONE_B], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.zones).toEqual([ZONE_A, ZONE_B, OTHER_ZONE_B]);
    expect(result.current.zones).toHaveLength(3);
    expect(result.current.other_zones).toEqual({ impressions: 15, views: 6, cta_taps: 1 });
  });

  it('(EC-5) sin_fila_bucket_en_la_respuesta_other_zones_es_null: si la RPC no colapsó nada (todas las zonas tienen >=5 usuarios distintos), no viene fila (NULL,NULL) y other_zones debe quedar null, NO un objeto en ceros', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ZONE_A, ZONE_B], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.other_zones).toBeNull();
    expect(result.current.zones).toEqual([ZONE_A, ZONE_B]);
    expect(result.current.totals).toEqual({
      impressions: 120 + 40,
      views: 80 + 25,
      cta_taps: 10 + 3,
    });
  });

  // ── Anti-reconstrucción (garantía de privacidad del lado cliente) ──────────

  it('(EC-6) no_reparte_el_bucket_entre_las_zonas_visibles: con 2 zonas visibles y un bucket de 15/6/1, ninguna zona debe llevar +7.5/+3/+0.5 (mitad del bucket) — cada zona conserva EXACTAMENTE el valor que vino de la RPC', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ZONE_A, ZONE_B, BUCKET], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    const zone_a_result = result.current.zones.find((z) => z.municipality_id === 'municipio-a' && z.neighborhood_id === null);
    const zone_b_result = result.current.zones.find((z) => z.neighborhood_id === 501);

    // Valores crudos de la RPC, sin ninguna fracción del bucket sumada encima.
    expect(zone_a_result?.impressions).toBe(120);
    expect(zone_b_result?.impressions).toBe(40);
    // El bucket se expone tal cual, no prorrateado ni reducido.
    expect(result.current.other_zones).toEqual({ impressions: 15, views: 6, cta_taps: 1 });
  });

  it('(EC-7) solo_bucket_sin_zonas_reales_zones_queda_vacio_no_se_sintetiza_una_zona: una agencia con TODO su tráfico colapsado por privacidad → zones=[], NUNCA una zona sintética "otras" metida ahí', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [BUCKET], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.zones).toEqual([]);
    expect(result.current.other_zones).toEqual({ impressions: 15, views: 6, cta_taps: 1 });
    expect(result.current.totals).toEqual({ impressions: 15, views: 6, cta_taps: 1 });
  });

  // ── totals: null vs ceros ────────────────────────────────────────────────

  it('(EC-8) totals_null_mientras_carga: mientras la RPC (no vacía) está pendiente, totals debe ser null — nunca ceros optimistas', async () => {
    const pending_rpc = new Promise<never>(() => {});
    mock_supabase_holder.client = { rpc: jest.fn().mockReturnValue(pending_rpc) };

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.loading).toBe(true);
    expect(result.current.totals).toBeNull();
    expect(result.current.zones).toEqual([]);
    expect(result.current.other_zones).toBeNull();
  });

  it('(EC-9) totals_null_ante_error_nunca_ceros: la RPC falla → totals debe seguir null, NO {impressions:0,views:0,cta_taps:0} — "0 impresiones" y "no pudimos cargar" son mensajes opuestos para quien pagó el slot', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: null, error: { message: 'permission denied for function ad_metrics_for_agency' } },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.totals).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.zones).toEqual([]);
    expect(result.current.other_zones).toBeNull();
  });

  it('(EC-10) estado_vacio_legitimo_sin_datos_todavia_totals_en_cero_y_error_null: la RPC responde [] SIN error (agencia real, todavía sin impresiones) → totals={0,0,0} con error=null — el estado que 171.3 pinta como "aún no hay datos"', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.error).toBeNull();
    expect(result.current.totals).toEqual({ impressions: 0, views: 0, cta_taps: 0 });
    expect(result.current.zones).toEqual([]);
    expect(result.current.other_zones).toBeNull();
  });

  it('(EC-11) cero_filas_por_falta_de_autorizacion_indistinguible_del_estado_vacio: el diseño anti-IDOR de la RPC hace que "no autorizado" y "sin datos" devuelvan EXACTAMENTE lo mismo (0 filas, sin error) — el hook NO puede ni debe distinguirlos, así que produce el mismo resultado que EC-10', async () => {
    // Desde el punto de vista del cliente esto es indistinguible de EC-10:
    // la RPC hace su propio chequeo de autorización server-side y responde
    // 0 filas sin excepción en ambos casos (anti-IDOR, ver migración).
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.error).toBeNull();
    expect(result.current.totals).toEqual({ impressions: 0, views: 0, cta_taps: 0 });
  });

  // ── Boundary — agencyId ─────────────────────────────────────────────────

  it('(EC-12) agencyId_null_no_dispara_rpc_resuelve_de_inmediato: sin agencyId no hay nada que consultar', async () => {
    const { result } = await renderHook(() => useAdMetrics(null));

    expect(mock_supabase_holder.client.rpc).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.zones).toEqual([]);
    expect(result.current.other_zones).toBeNull();
    expect(result.current.totals).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('(EC-13) agencyId_vacio_no_dispara_rpc: string vacío se trata igual que null, no como un id real', async () => {
    const { result } = await renderHook(() => useAdMetrics(''));

    expect(mock_supabase_holder.client.rpc).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.totals).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── Error ────────────────────────────────────────────────────────────────

  it('(EC-14) error_de_rpc_mensaje_neutro_en_espanol_no_el_texto_crudo: mensaje NEUTRO en español, nunca el texto crudo de PostgREST/Postgres', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function ad_metrics_for_agency';
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: null, error: { message: RAW_PG_MESSAGE } },
    });

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
  });

  it('(EC-15) funcion_no_existe_42883_falla_cerrado_sin_lanzar: 168-172 se mergea a main sin desplegar el schema — un OTA en esa ventana lleva este JS contra un backend sin la RPC. NO debe crashear (mismo criterio fail-closed que useCanAdvertise)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: {
        data: null,
        error: { code: '42883', message: 'function public.ad_metrics_for_agency(uuid) does not exist' },
      },
    });

    let threw = false;
    let render_result: Awaited<ReturnType<typeof renderHook<ReturnType<typeof useAdMetrics>, { id: string }>>> | undefined;
    try {
      render_result = await renderHook(() => useAdMetrics(AGENCY_ID));
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(render_result?.result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(render_result?.result.current.zones).toEqual([]);
    expect(render_result?.result.current.totals).toBeNull();
  });

  // ── Race / dependencia del efecto ───────────────────────────────────────

  it('(EC-16) agencyId_cambia_con_llamada_en_vuelo_descarta_la_respuesta_vieja: la llamada de AGENCY_ID queda pendiente; se cambia a AGENCY_ID_B que resuelve rápido; cuando la vieja finalmente resuelve, NO debe pisar el estado de la nueva', async () => {
    let resolve_stale: ((v: { data: AdMetricsRpcRow[]; error: null }) => void) | undefined;
    const stale_promise = new Promise<{ data: AdMetricsRpcRow[]; error: null }>((resolve) => {
      resolve_stale = resolve;
    });

    const rpc_mock = jest
      .fn()
      .mockImplementationOnce(() => stale_promise)
      .mockImplementationOnce(() => Promise.resolve({ data: [ZONE_B], error: null }));
    mock_supabase_holder.client = { rpc: rpc_mock };

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useAdMetrics(id),
      { initialProps: { id: AGENCY_ID } },
    );

    expect(result.current.loading).toBe(true);

    await act(async () => {
      rerender({ id: AGENCY_ID_B });
    });

    expect(result.current.zones).toEqual([ZONE_B]);
    expect(result.current.loading).toBe(false);

    // La respuesta vieja (de AGENCY_ID) llega tarde — debe ser descartada.
    await act(async () => {
      resolve_stale?.({ data: [ZONE_A], error: null });
    });

    expect(result.current.zones).toEqual([ZONE_B]);
  });

  it('(EC-17) rerender_con_el_mismo_agencyId_no_redispara_la_rpc: un re-render con el MISMO agencyId (mismo valor, aunque sea una nueva evaluación) no debe generar una segunda llamada', async () => {
    const { rerender } = await renderHook(({ id }: { id: string }) => useAdMetrics(id), {
      initialProps: { id: AGENCY_ID },
    });

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ id: AGENCY_ID });
    });

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
  });

  // ── Boundary — loading ───────────────────────────────────────────────────

  it('(EC-18) loading_true_sincrono_mientras_la_rpc_no_vacia_esta_pendiente: loading=true de inmediato, y JAMÁS hay totals no-null mientras loading=true', async () => {
    const pending_rpc = new Promise<never>(() => {});
    mock_supabase_holder.client = { rpc: jest.fn().mockReturnValue(pending_rpc) };

    const { result } = await renderHook(() => useAdMetrics(AGENCY_ID));

    expect(result.current.loading).toBe(true);
    if (result.current.loading) {
      expect(result.current.totals).toBeNull();
    }
  });
});
