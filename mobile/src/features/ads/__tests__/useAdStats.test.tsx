/**
 * Tests fase RED — useAdStats hook (dashboard por anuncio, tarea #212)
 * Archivo SUT: mobile/src/features/ads/hooks/useAdStats.ts
 * Subtarea Taskmaster: 212.3
 *
 * SEAMS BAJO TEST (firmas públicas, fijadas por el orquestador — no se
 * renegocian sin dejar rastro en la bitácora):
 *
 *   period_to_range(period: AdStatsPeriod, now: Date):
 *     { p_from: string | null; p_to: string | null }
 *
 *   useAdStats(ad_id: string | null, period: AdStatsPeriod, deps?: UseAdStatsDeps): {
 *     totals: AdStatsTotals | null;
 *     daily: AdStatsDailyPoint[];
 *     zones: AdStatsZoneRow[];
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 *
 *   UseAdStatsDeps = { client?: { rpc(fn, params): Promise<{data, error}> } }
 *
 * 🔴 Nota de nombrado (decisión de este RED, documentada porque el prompt del
 * orquestador escribió `use_ad_stats` en snake_case): el 100% de los hooks
 * exportados del repo son camelCase (useAdMetrics, useLeadStats,
 * useSetOrgAdvertising, usePropertyDetail...) y el archivo SUT ya se llama
 * `useAdStats.ts` — se fija el nombre exportado como `useAdStats`
 * (camelCase), preservando SÍ el snake_case pedido explícitamente para los
 * campos del estado (`is_loading`, `error_message`), que YA es un patrón
 * real y repetido en el repo (usePropertyDetail usa `isLoading` pero
 * useUpdateLeadStatus/useSuspendAgency/useSetOrgAdvertising/usePublish/
 * useFeedProperties usan snake_case en sus campos de estado).
 *
 * Llama las 3 RPCs de supabase/migrations/20260824000001_ad_stats_per_ad.sql
 * EN PARALELO, cada una con { p_ad_id, p_from, p_to }:
 *   - ad_stats_totals → 1 fila {impressions, views, cta_taps} (0 filas si la
 *     autorización server-side no pasa — anti-IDOR fail-closed, igual que
 *     ad_metrics_for_agency: 0 filas, NUNCA una excepción).
 *   - ad_stats_daily  → N filas {day, impressions, views, cta_taps}, orden
 *     ascendente YA garantizado por la RPC — el hook NUNCA reordena.
 *   - ad_stats_zones  → N filas {municipality_id, neighborhood_id, ...} +
 *     el bucket "otras zonas" (NULL,NULL) tal cual, sin separarlo (a
 *     diferencia de useAdMetrics/171.2, aquí NO hay campo `other_zones` —
 *     el bucket vive DENTRO de `zones`, identificable por sus dos nulls).
 *
 * INVARIANTES QUE ESTE ARCHIVO DEBE CLAVAR:
 *   1. `totals` es `null` mientras carga y ante error — JAMÁS ceros
 *      fabricados (EC-1, EC-11, EC-12, EC-24). Un 0 fabricado le miente al
 *      anunciante que pagó el slot.
 *   2. Todo-o-nada: si UNA de las 3 RPCs falla, error_message se llena Y
 *      totals/daily/zones se resetean los TRES — nunca datos parciales de
 *      las que sí tuvieron éxito (EC-11, EC-12).
 *   3. `daily` preserva el orden que entrega la RPC — el hook no re-ordena
 *      del lado cliente (EC-7).
 *   4. El bucket (NULL,NULL) de `zones` se incluye tal cual, sin filtrarlo
 *      ni moverlo (EC-8).
 *   5. NUNCA se desprende `client.rpc` — se llama `deps.client.rpc(...)`
 *      directo, preservando `this` (#205, EC-23).
 *   6. Mensajes de error SIEMPRE del mapa neutro, jamás `error.message`
 *      crudo (#200) (EC-13).
 *   7. Cambio de `ad_id` o `period` → refetch automático; una respuesta
 *      tardía de la llamada vieja NUNCA pisa a la nueva (EC-17, EC-18), sea
 *      que RESUELVA tarde (EC-18) o RECHACE tarde (EC-28).
 *   8. Sin `ad_id` no se dispara ninguna RPC (EC-15, EC-16).
 *   9. Un éxito que llega DESPUÉS de que otra RPC ya marcó error no debe
 *      repoblar su campo (EC-26) — todo-o-nada es simétrico al ORDEN de
 *      llegada, no solo al resultado final.
 *  10. `is_loading` no se apaga hasta que las 3 RPCs se asienten, aunque
 *      solo falte una (EC-27) — un spinner apagado con 2/3 en vuelo muestra
 *      datos incompletos como si fueran completos.
 *
 * PATRÓN DE MOCK: `deps.client` inyectado por parámetro (DI explícita, NO
 * jest.mock del módulo — el seam es el parámetro `deps`, calca
 * useModerateAd/useSetOrgAdvertising). El objeto plano `{ rpc: jest.fn() }`
 * sirve para la mayoría de casos; EC-23 usa una clase real con método de
 * PROTOTIPO que depende de `this` — un mock de objeto plano con `jest.fn()`
 * NO detecta una desestructuración de `rpc` (memoria
 * supabase_js_metodo_desprendido), así que ese caso necesita su propio mock.
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act`; sin `await` el
 * `result` es `undefined` (rntl14_renderhook_async). `unmount()` SIEMPRE
 * dentro de `act` (rntl_unmount_fuera_de_act) — si no, los efectos de
 * limpieza de hooks posteriores no corren y solo los casos positivos lo
 * notan.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### period_to_range — pura, sin fake timers (recibe `now` explícito)
 * - (EC-1) period_today_p_from_medianoche_local_del_now_dado_p_to_null
 * - (EC-2) period_last30_p_from_exactamente_30_dias_atras_p_to_null
 * - (EC-3) period_max_p_from_y_p_to_ambos_null_sin_rango
 * - (EC-4) period_today_con_now_ya_en_medianoche_no_retrocede_un_dia_de_mas
 *
 * ### Happy path
 * - (EC-5) carga_inicial_es_loading_true_totals_null_daily_y_zones_vacios_sincrono
 * - (EC-6) llama_las_tres_rpcs_en_paralelo_con_p_ad_id_y_rango_correcto
 * - (EC-7) exito_totals_daily_zones_se_pueblan_tal_cual_desde_las_tres_respuestas
 *
 * ### Ramas de reglas no obvias (diseño 212-dashboard-anuncios.html)
 * - (EC-8) orden_de_daily_se_preserva_tal_cual_la_rpc_sin_reordenar_del_lado_cliente
 * - (EC-9) bucket_null_null_de_zones_se_incluye_en_zones_identificable_sin_filtrarlo
 * - (EC-10) exito_con_daily_y_zones_vacios_son_arrays_vacios_sin_error_totals_si_presente
 * - (EC-11) sin_autorizacion_las_tres_rpcs_responden_0_filas_sin_error_totals_null_sin_banner
 *
 * ### Error / todo-o-nada
 * - (EC-12) error_de_una_sola_rpc_limpia_totals_daily_y_zones_las_tres_a_la_vez
 * - (EC-13) error_de_las_tres_rpcs_un_solo_mensaje_neutro
 * - (EC-14) mensaje_de_error_neutro_nunca_el_texto_crudo_de_postgres
 * - (EC-15) rpc_rechazada_promise_reject_tambien_cae_en_mensaje_neutro_sin_lanzar
 *
 * ### Boundary — ad_id
 * - (EC-16) ad_id_null_no_dispara_las_rpcs_resuelve_de_inmediato
 * - (EC-17) ad_id_vacio_no_dispara_las_rpcs
 *
 * ### Race / dependencias del efecto
 * - (EC-18) cambio_de_ad_id_con_llamada_en_vuelo_descarta_la_respuesta_vieja
 * - (EC-19) cambio_de_period_con_llamada_en_vuelo_descarta_la_respuesta_vieja
 * - (EC-20) rerender_con_mismo_ad_id_y_period_no_redispara_las_rpcs
 *
 * ### Unmount
 * - 🔴 EC-21 se ELIMINÓ (2026-08-24, hallazgo del guardian): el mutation
 *   testing demostró que "unmount + luego resolver + assert
 *   console.error no llamado" es VACUO en este entorno -- React 18 dejó de
 *   emitir el warning "Can't perform a React state update on an unmounted
 *   component", así que la aserción pasaba IGUAL con el guard `if (ignore)
 *   return` puesto o quitado (el guardian lo probó quitándolo a mano). No
 *   hay una señal observable en RNTL/react-test-renderer que distinga
 *   "ignore respetado tras unmount" de "ignore violado tras unmount" -- la
 *   garantía sigue siendo correcta por revisión de código (mismo patrón
 *   `ignore` que useAdMetrics/usePendingAds/useLeadStats), pero no es
 *   mecánicamente mordible aquí. EC-18 y EC-28 SÍ ejercitan (y sí muerden)
 *   las mismas ramas `if (ignore) return` de los handlers de éxito/error --
 *   solo que disparadas por un cambio de `ad_id` en vuelo, no por un
 *   `unmount()`, que es la única forma de que la aserción tenga mordida real.
 *
 * ### Refetch
 * - (EC-22) refetch_vuelve_a_llamar_las_tres_rpcs_con_el_mismo_ad_id_y_period
 * - (EC-23) error_previo_se_limpia_tras_un_refetch_exitoso
 *
 * ### DI / gotcha #205
 * - (EC-24) deps_client_rpc_se_llama_directo_sin_desprender_preserva_this
 *
 * ### Boundary — loading
 * - (EC-25) is_loading_true_mientras_las_tres_rpcs_estan_pendientes_totals_nunca_no_null
 *
 * ### Mutation hardening (guardian, 2026-08-24 — mata M2/M15/M17 sobrevivientes)
 * - (EC-26) mata_m2_exito_tardio_tras_error_no_repuebla_el_campo: falla
 *   PRIMERO (totals), éxitos con datos reales llegan DESPUÉS (daily/zones) --
 *   a diferencia de EC-12/EC-13 (donde el error llega AL FINAL y el reset
 *   post-hoc tapa el guard), aquí el orden invertido SÍ exige el guard
 *   `if (!errored)` en los 3 handlers de éxito.
 * - (EC-27) mata_m15_is_loading_no_se_apaga_con_1_de_3_asentadas: totals
 *   resuelve, daily/zones quedan pendientes para siempre -- is_loading debe
 *   seguir true (EC-19 ya fija que totals se puebla antes; esta aserción es
 *   sobre is_loading, no cubierta ahí).
 * - (EC-28) mata_m17_rechazo_tardio_de_ad_id_viejo_no_pisa_nada: como EC-18
 *   pero la respuesta tardía RECHAZA (promise reject) en vez de resolver --
 *   ejercita el guard `if (ignore) return` de `handle_error`, que EC-18 no
 *   toca (ahí la vieja siempre resuelve con éxito).
 */

import { renderHook, act } from '@testing-library/react-native';

import {
  useAdStats,
  period_to_range,
  type AdStatsPeriod,
  type UseAdStatsDeps,
} from '../hooks/useAdStats';

// ---------------------------------------------------------------------------
// Constantes y datos de test
// ---------------------------------------------------------------------------

const AD_ID = 'anuncio-uuid-212-3-stats';
const AD_ID_B = 'anuncio-uuid-212-3-OTRO-stats';

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las estadísticas del anuncio. Intenta de nuevo.';

type TotalsRow = { impressions: number; views: number; cta_taps: number };
type DailyRow = { day: string; impressions: number; views: number; cta_taps: number };
type ZoneRow = {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
};

const TOTALS_ROW: TotalsRow = { impressions: 500, views: 320, cta_taps: 40 };

const DAY_1: DailyRow = { day: '2026-08-20', impressions: 100, views: 60, cta_taps: 5 };
const DAY_2: DailyRow = { day: '2026-08-21', impressions: 150, views: 90, cta_taps: 8 };
const DAY_3: DailyRow = { day: '2026-08-22', impressions: 90, views: 70, cta_taps: 3 };

const ZONE_REAL: ZoneRow = {
  municipality_id: 'municipio-x',
  neighborhood_id: 12,
  impressions: 300,
  views: 200,
  cta_taps: 25,
};
const ZONE_BUCKET: ZoneRow = {
  municipality_id: null,
  neighborhood_id: null,
  impressions: 200,
  views: 120,
  cta_taps: 15,
};

type RpcResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };
type RpcName = 'ad_stats_totals' | 'ad_stats_daily' | 'ad_stats_zones';

// ---------------------------------------------------------------------------
// Factory del mock de cliente — DI vía `deps.client` (NO jest.mock de módulo).
// ---------------------------------------------------------------------------

function make_client(
  overrides: {
    totals?: RpcResult<TotalsRow>;
    daily?: RpcResult<DailyRow>;
    zones?: RpcResult<ZoneRow>;
  } = {},
): { rpc: jest.Mock } {
  const {
    totals = { data: [TOTALS_ROW], error: null },
    daily = { data: [DAY_1, DAY_2, DAY_3], error: null },
    zones = { data: [ZONE_REAL, ZONE_BUCKET], error: null },
  } = overrides;

  const by_name: Record<RpcName, RpcResult<unknown>> = {
    ad_stats_totals: totals,
    ad_stats_daily: daily,
    ad_stats_zones: zones,
  };

  return {
    rpc: jest.fn((name: RpcName) => Promise.resolve(by_name[name])),
  };
}

function make_pending_client(): { rpc: jest.Mock } {
  return { rpc: jest.fn(() => new Promise(() => {})) };
}

function render_stats(
  ad_id: string | null,
  period: AdStatsPeriod,
  client: NonNullable<UseAdStatsDeps['client']>,
) {
  return renderHook(
    ({ id, p }: { id: string | null; p: AdStatsPeriod }) => useAdStats(id, p, { client }),
    { initialProps: { id: ad_id, p: period } },
  );
}

// ---------------------------------------------------------------------------
// period_to_range — pura, sin renderHook ni fake timers
// ---------------------------------------------------------------------------

describe('period_to_range', () => {
  // now fijo: 24 ago 2026, 15:30:45.500 hora local — deliberadamente NO a
  // medianoche, para que un bug que ignore la hora/min/seg no se disimule.
  const NOW = new Date(2026, 7, 24, 15, 30, 45, 500);

  it("(EC-1) period_today_p_from_medianoche_local_del_now_dado_p_to_null: 'today' produce p_from = medianoche local del MISMO día que now, p_to = null", () => {
    const range = period_to_range('today', NOW);

    const expected_midnight = new Date(2026, 7, 24, 0, 0, 0, 0);
    expect(range.p_from).toBe(expected_midnight.toISOString());
    expect(range.p_to).toBeNull();
  });

  it("(EC-2) period_last30_p_from_exactamente_30_dias_atras_p_to_null: 'last30' resta EXACTAMENTE 30*24*60*60*1000 ms a now (no un mes calendario), p_to = null", () => {
    const range = period_to_range('last30', NOW);

    const expected_from = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(range.p_from).toBe(expected_from.toISOString());
    expect(range.p_to).toBeNull();
  });

  it("(EC-3) period_max_p_from_y_p_to_ambos_null_sin_rango: 'max' no manda ningún límite -- ambos null", () => {
    const range = period_to_range('max', NOW);

    expect(range.p_from).toBeNull();
    expect(range.p_to).toBeNull();
  });

  it('(EC-4) period_today_con_now_ya_en_medianoche_no_retrocede_un_dia_de_mas: si now YA es medianoche local, p_from es la MISMA fecha, no el día anterior (guarda contra un off-by-one de "un ms antes")', () => {
    const now_at_midnight = new Date(2026, 7, 24, 0, 0, 0, 0);

    const range = period_to_range('today', now_at_midnight);

    expect(range.p_from).toBe(now_at_midnight.toISOString());
  });
});

// ---------------------------------------------------------------------------
// useAdStats
// ---------------------------------------------------------------------------

describe('useAdStats', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('(EC-5) carga_inicial_es_loading_true_totals_null_daily_y_zones_vacios_sincrono: mientras las 3 RPCs (no vacías) están pendientes, is_loading=true, totals=null, daily=[], zones=[]', async () => {
    const client = make_pending_client();

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.is_loading).toBe(true);
    expect(result.current.totals).toBeNull();
    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.error_message).toBeNull();
  });

  it("(EC-6) llama_las_tres_rpcs_en_paralelo_con_p_ad_id_y_rango_correcto: exactamente 3 llamadas -- ad_stats_totals/ad_stats_daily/ad_stats_zones -- cada una con {p_ad_id, p_from, p_to} ('max' => ambos null)", async () => {
    const client = make_client();

    await render_stats(AD_ID, 'max', client);

    expect(client.rpc).toHaveBeenCalledTimes(3);
    expect(client.rpc).toHaveBeenCalledWith('ad_stats_totals', {
      p_ad_id: AD_ID,
      p_from: null,
      p_to: null,
    });
    expect(client.rpc).toHaveBeenCalledWith('ad_stats_daily', {
      p_ad_id: AD_ID,
      p_from: null,
      p_to: null,
    });
    expect(client.rpc).toHaveBeenCalledWith('ad_stats_zones', {
      p_ad_id: AD_ID,
      p_from: null,
      p_to: null,
    });
  });

  it('(EC-7) exito_totals_daily_zones_se_pueblan_tal_cual_desde_las_tres_respuestas: las 3 respuestas se exponen SIN transformar (mismos valores, misma forma)', async () => {
    const client = make_client();

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.totals).toEqual(TOTALS_ROW);
    expect(result.current.daily).toEqual([DAY_1, DAY_2, DAY_3]);
    expect(result.current.zones).toEqual([ZONE_REAL, ZONE_BUCKET]);
    expect(result.current.error_message).toBeNull();
    expect(result.current.is_loading).toBe(false);
  });

  // ── Ramas de reglas no obvias ────────────────────────────────────────────

  it('(EC-8) orden_de_daily_se_preserva_tal_cual_la_rpc_sin_reordenar_del_lado_cliente: la RPC ya entrega orden ascendente garantizado -- el mock lo entrega DESCENDENTE a propósito para clavar que el hook NO re-ordena por su cuenta (confía en el servidor, no reimplementa el sort)', async () => {
    const client = make_client({
      daily: { data: [DAY_3, DAY_2, DAY_1], error: null },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.daily).toEqual([DAY_3, DAY_2, DAY_1]);
  });

  it('(EC-9) bucket_null_null_de_zones_se_incluye_en_zones_identificable_sin_filtrarlo: a diferencia de useAdMetrics, aquí NO hay other_zones separado -- el bucket vive DENTRO de `zones`, tal cual, identificable por sus dos nulls', async () => {
    const client = make_client({
      zones: { data: [ZONE_REAL, ZONE_BUCKET], error: null },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.zones).toHaveLength(2);
    expect(result.current.zones).toContainEqual(ZONE_BUCKET);
    const bucket_in_zones = result.current.zones.find(
      (z) => z.municipality_id === null && z.neighborhood_id === null,
    );
    expect(bucket_in_zones).toEqual(ZONE_BUCKET);
  });

  it('(EC-10) exito_con_daily_y_zones_vacios_son_arrays_vacios_sin_error_totals_si_presente: totals con datos reales, pero daily/zones responden [] (sin desglose todavía) -- arrays vacíos LEGÍTIMOS, no error', async () => {
    const client = make_client({
      daily: { data: [], error: null },
      zones: { data: [], error: null },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.totals).toEqual(TOTALS_ROW);
    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.error_message).toBeNull();
  });

  it('(EC-11) sin_autorizacion_las_tres_rpcs_responden_0_filas_sin_error_totals_null_sin_banner: el diseño anti-IDOR (idéntico a ad_metrics_for_agency) hace que "no autorizado" y "ad_id inexistente" devuelvan 0 filas SIN excepción en las 3 -- ad_stats_totals garantiza 1 fila SOLO si la autorización pasó, así que 0 filas ahí es la señal; el hook no debe fabricar un error', async () => {
    const client = make_client({
      totals: { data: [], error: null },
      daily: { data: [], error: null },
      zones: { data: [], error: null },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.totals).toBeNull();
    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.error_message).toBeNull();
  });

  // ── Error / todo-o-nada ──────────────────────────────────────────────────

  it('(EC-12) error_de_una_sola_rpc_limpia_totals_daily_y_zones_las_tres_a_la_vez: ad_stats_zones falla aunque totals y daily hayan respondido bien -- el contrato es TODO o NADA, nunca datos parciales mezclados a medias', async () => {
    const client = make_client({
      zones: { data: null, error: { code: '42501', message: 'permission denied' } },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.totals).toBeNull();
    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.is_loading).toBe(false);
  });

  it('(EC-13) error_de_las_tres_rpcs_un_solo_mensaje_neutro: las 3 RPCs fallan -- UN solo mensaje neutro, no 3 mensajes ni un mensaje concatenado', async () => {
    const failure = { data: null, error: { message: 'permission denied' } };
    const client = make_client({ totals: failure, daily: failure, zones: failure });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  it('(EC-14) mensaje_de_error_neutro_nunca_el_texto_crudo_de_postgres: el texto crudo de Postgres/PostgREST NUNCA llega al estado (#200)', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function ad_stats_totals';
    const client = make_client({
      totals: { data: null, error: { message: RAW_PG_MESSAGE } },
    });

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.error_message).not.toBe(RAW_PG_MESSAGE);
  });

  it('(EC-15) rpc_rechazada_promise_reject_tambien_cae_en_mensaje_neutro_sin_lanzar: una falla de RED (promesa RECHAZADA, no {error} resuelto) tampoco debe crashear el render -- mismo mensaje neutro, fail-closed', async () => {
    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName) => {
        if (name === 'ad_stats_daily') return Promise.reject(new Error('network down'));
        return Promise.resolve({ data: name === 'ad_stats_totals' ? [TOTALS_ROW] : [], error: null });
      }),
    };

    let threw = false;
    let render_result: Awaited<ReturnType<typeof render_stats>> | undefined;
    try {
      render_result = await render_stats(AD_ID, 'max', client);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(render_result?.result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(render_result?.result.current.totals).toBeNull();
  });

  // ── Boundary — ad_id ─────────────────────────────────────────────────────

  it('(EC-16) ad_id_null_no_dispara_las_rpcs_resuelve_de_inmediato: sin ad_id no hay nada que consultar', async () => {
    const client = make_client();

    const { result } = await render_stats(null, 'max', client);

    expect(client.rpc).not.toHaveBeenCalled();
    expect(result.current.is_loading).toBe(false);
    expect(result.current.totals).toBeNull();
    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.error_message).toBeNull();
  });

  it('(EC-17) ad_id_vacio_no_dispara_las_rpcs: string vacío se trata igual que null, no como un id real', async () => {
    const client = make_client();

    const { result } = await render_stats('', 'max', client);

    expect(client.rpc).not.toHaveBeenCalled();
    expect(result.current.is_loading).toBe(false);
  });

  // ── Race / dependencias del efecto ──────────────────────────────────────

  it('(EC-18) cambio_de_ad_id_con_llamada_en_vuelo_descarta_la_respuesta_vieja: AD_ID queda pendiente; se cambia a AD_ID_B que resuelve rápido; cuando AD_ID finalmente resuelve, NO debe pisar el estado ya asentado de AD_ID_B', async () => {
    let resolve_stale_totals: ((v: RpcResult<TotalsRow>) => void) | undefined;
    const stale_totals = new Promise<RpcResult<TotalsRow>>((resolve) => {
      resolve_stale_totals = resolve;
    });

    const OTHER_TOTALS: TotalsRow = { impressions: 9, views: 3, cta_taps: 1 };

    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName, params: { p_ad_id: string }) => {
        if (params.p_ad_id === AD_ID) {
          if (name === 'ad_stats_totals') return stale_totals;
          return new Promise(() => {}); // daily/zones de AD_ID nunca resuelven en este test
        }
        // AD_ID_B resuelve rápido en las 3
        if (name === 'ad_stats_totals') return Promise.resolve({ data: [OTHER_TOTALS], error: null });
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useAdStats(id, 'max', { client }),
      { initialProps: { id: AD_ID } },
    );

    expect(result.current.is_loading).toBe(true);

    await act(async () => {
      rerender({ id: AD_ID_B });
    });

    expect(result.current.totals).toEqual(OTHER_TOTALS);
    expect(result.current.is_loading).toBe(false);

    // La respuesta vieja (de AD_ID) llega tarde -- debe ser descartada.
    await act(async () => {
      resolve_stale_totals?.({ data: [TOTALS_ROW], error: null });
    });

    expect(result.current.totals).toEqual(OTHER_TOTALS);
  });

  it('(EC-19) cambio_de_period_con_llamada_en_vuelo_descarta_la_respuesta_vieja: mismo ad_id, cambia SOLO el period con una llamada en vuelo -- la respuesta tardía del period anterior no debe pisar al nuevo', async () => {
    let resolve_stale_totals: ((v: RpcResult<TotalsRow>) => void) | undefined;
    const stale_totals = new Promise<RpcResult<TotalsRow>>((resolve) => {
      resolve_stale_totals = resolve;
    });

    const NEW_PERIOD_TOTALS: TotalsRow = { impressions: 77, views: 22, cta_taps: 2 };
    let call_index = 0;

    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName) => {
        if (name !== 'ad_stats_totals') return new Promise(() => {});
        call_index += 1;
        // 1ª llamada (period inicial 'today') queda pendiente; 2ª ('last30') resuelve rápido.
        return call_index === 1
          ? stale_totals
          : Promise.resolve({ data: [NEW_PERIOD_TOTALS], error: null });
      }),
    };

    const { result, rerender } = await renderHook(
      ({ p }: { p: AdStatsPeriod }) => useAdStats(AD_ID, p, { client }),
      { initialProps: { p: 'today' as AdStatsPeriod } },
    );

    await act(async () => {
      rerender({ p: 'last30' });
    });

    expect(result.current.totals).toEqual(NEW_PERIOD_TOTALS);

    await act(async () => {
      resolve_stale_totals?.({ data: [TOTALS_ROW], error: null });
    });

    expect(result.current.totals).toEqual(NEW_PERIOD_TOTALS);
  });

  it('(EC-20) rerender_con_mismo_ad_id_y_period_no_redispara_las_rpcs: un re-render con los MISMOS ad_id/period (nueva evaluación, mismo valor) no debe generar una segunda tanda de llamadas', async () => {
    const client = make_client();

    const { rerender } = await renderHook(
      ({ id, p }: { id: string; p: AdStatsPeriod }) => useAdStats(id, p, { client }),
      { initialProps: { id: AD_ID, p: 'max' as AdStatsPeriod } },
    );

    expect(client.rpc).toHaveBeenCalledTimes(3);

    await act(async () => {
      rerender({ id: AD_ID, p: 'max' });
    });

    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  // ── Unmount ──────────────────────────────────────────────────────────────
  //
  // 🔴 EC-21 se ELIMINÓ (2026-08-24, hallazgo del guardian, mutation
  // testing): la versión anterior desmontaba, resolvía las RPCs pendientes
  // después, y aserteaba que console.error NO se llamó con el texto del
  // warning de "setState en componente desmontado". El guardian demostró
  // que esa aserción es VACUA en este entorno: quitando a mano el guard
  // `if (ignore) return` del efecto, la suite seguía en VERDE, porque React
  // 18 ya no emite ese warning (lo retiró desde 18.0 -- el update en un
  // fiber desmontado es tolerado en silencio por el test renderer). No hay
  // ninguna señal observable vía RNTL/react-test-renderer que distinga
  // "ignore respetado tras un unmount real" de "ignore violado tras un
  // unmount real" -- la garantía del closure `ignore` sigue siendo correcta
  // por diseño (mismo patrón que useAdMetrics/usePendingAds/useLeadStats) y
  // por revisión de código, pero no es mecánicamente mordible en un test de
  // caja negra sobre unmount. Las MISMAS ramas `if (ignore) return` de los
  // handlers de éxito y de error SÍ quedan mordidas -- por EC-18 (éxito
  // tardío tras cambio de ad_id) y EC-28 (rechazo tardío tras cambio de
  // ad_id), que disparan exactamente ese guard por una vía que SÍ es
  // observable (el estado final no debe cambiar).

  // ── Refetch ──────────────────────────────────────────────────────────────

  it('(EC-22) refetch_vuelve_a_llamar_las_tres_rpcs_con_el_mismo_ad_id_y_period: refetch() dispara OTRA tanda de 3 llamadas, mismos p_ad_id/p_from/p_to', async () => {
    const client = make_client();

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(client.rpc).toHaveBeenCalledTimes(3);

    await act(async () => {
      result.current.refetch();
    });

    expect(client.rpc).toHaveBeenCalledTimes(6);
  });

  it('(EC-23) error_previo_se_limpia_tras_un_refetch_exitoso: 1ª tanda falla, refetch() con datos buenos limpia error_message y puebla totals/daily/zones', async () => {
    const failing = { data: null, error: { code: '42501', message: 'permission denied' } };
    const client: { rpc: jest.Mock } = {
      rpc: jest
        .fn()
        .mockResolvedValueOnce(failing) // totals #1
        .mockResolvedValueOnce(failing) // daily #1
        .mockResolvedValueOnce(failing) // zones #1
        .mockResolvedValueOnce({ data: [TOTALS_ROW], error: null }) // totals #2
        .mockResolvedValueOnce({ data: [DAY_1], error: null }) // daily #2
        .mockResolvedValueOnce({ data: [ZONE_REAL], error: null }), // zones #2
    };

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.totals).toBeNull();

    await act(async () => {
      result.current.refetch();
    });

    expect(result.current.error_message).toBeNull();
    expect(result.current.totals).toEqual(TOTALS_ROW);
    expect(result.current.daily).toEqual([DAY_1]);
    expect(result.current.zones).toEqual([ZONE_REAL]);
  });

  // ── DI / gotcha #205 ─────────────────────────────────────────────────────

  it('(EC-24) deps_client_rpc_se_llama_directo_sin_desprender_preserva_this: un cliente con método de PROTOTIPO real (no jest.fn de objeto plano) SOLO funciona si el hook llama `deps.client.rpc(...)` directo -- desestructurar (`const {rpc} = deps.client`) pierde `this` y este mock lo detecta', async () => {
    class TrackingClient {
      calls: RpcName[] = [];
      // Método normal (no arrow): `this` depende de CÓMO se invoque.
      rpc(name: RpcName): Promise<RpcResult<unknown>> {
        this.calls.push(name);
        if (name === 'ad_stats_totals') return Promise.resolve({ data: [TOTALS_ROW], error: null });
        return Promise.resolve({ data: [], error: null });
      }
    }
    const client = new TrackingClient();

    const { result } = await render_stats(
      AD_ID,
      'max',
      client as unknown as NonNullable<UseAdStatsDeps['client']>,
    );

    // Si el hook desprendiera `rpc` de `client`, `this` sería undefined y
    // `this.calls.push` lanzaría un TypeError -- nunca llegaríamos aquí con
    // las 3 llamadas registradas.
    expect(client.calls.sort()).toEqual(['ad_stats_daily', 'ad_stats_totals', 'ad_stats_zones']);
    expect(result.current.totals).toEqual(TOTALS_ROW);
  });

  // ── Boundary — loading ───────────────────────────────────────────────────

  it('(EC-25) is_loading_true_mientras_las_tres_rpcs_estan_pendientes_totals_nunca_no_null: is_loading=true de inmediato y JAMÁS hay totals no-null mientras is_loading=true', async () => {
    const client = make_pending_client();

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.is_loading).toBe(true);
    expect(result.current.totals).toBeNull();
  });

  // ── Mutation hardening (guardian, 2026-08-24) ───────────────────────────

  it('(EC-26) mata_m2_exito_tardio_tras_error_no_repuebla_el_campo: ad_stats_totals falla YA (resuelve en el mismo tick del render); daily y zones llegan DESPUÉS con filas reales -- el guard `if (!errored)` de los 3 handlers de éxito debe impedir que ese éxito tardío repueble el campo junto al banner de error', async () => {
    let resolve_daily: ((v: RpcResult<DailyRow>) => void) | undefined;
    let resolve_zones: ((v: RpcResult<ZoneRow>) => void) | undefined;
    const pending_daily = new Promise<RpcResult<DailyRow>>((resolve) => {
      resolve_daily = resolve;
    });
    const pending_zones = new Promise<RpcResult<ZoneRow>>((resolve) => {
      resolve_zones = resolve;
    });

    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName) => {
        if (name === 'ad_stats_totals') {
          // Ya resuelta -- se asienta en el mismo microtask-flush del render,
          // ANTES de que daily/zones (deferred) tengan oportunidad de correr.
          return Promise.resolve({
            data: null,
            error: { code: '42501', message: 'permission denied' },
          });
        }
        if (name === 'ad_stats_daily') return pending_daily;
        return pending_zones;
      }),
    };

    const { result } = await render_stats(AD_ID, 'max', client);

    // El error de totals ya debió asentarse -- resolvió antes que daily/zones.
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.totals).toBeNull();

    // daily/zones "ganan la carrera" DESPUÉS, con filas reales -- sin el
    // guard `if (!errored)` esto repoblaría los campos junto al error.
    await act(async () => {
      resolve_daily?.({ data: [DAY_1, DAY_2], error: null });
      resolve_zones?.({ data: [ZONE_REAL], error: null });
    });

    expect(result.current.daily).toEqual([]);
    expect(result.current.zones).toEqual([]);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.totals).toBeNull();
  });

  it('(EC-27) mata_m15_is_loading_no_se_apaga_con_1_de_3_rpcs_asentadas: totals resuelve con datos reales; daily y zones quedan pendientes para siempre -- is_loading debe seguir TRUE (un spinner apagado con la gráfica/mapa aún en vuelo le mostraría al anunciante datos incompletos como si fueran el resultado final)', async () => {
    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName) => {
        if (name === 'ad_stats_totals') {
          return Promise.resolve({ data: [TOTALS_ROW], error: null });
        }
        return new Promise(() => {}); // daily/zones nunca resuelven en este test
      }),
    };

    const { result } = await render_stats(AD_ID, 'max', client);

    expect(result.current.totals).toEqual(TOTALS_ROW);
    expect(result.current.is_loading).toBe(true);
  });

  it('(EC-28) mata_m17_rechazo_tardio_de_ad_id_viejo_no_pisa_nada: como EC-18 pero la respuesta tardía de AD_ID (el ad_id VIEJO) RECHAZA en vez de resolver -- el guard `if (ignore) return` de `handle_error` debe descartarla sin tocar el error_message ni los datos frescos de AD_ID_B', async () => {
    let reject_stale_totals: ((e: unknown) => void) | undefined;
    const stale_totals = new Promise<RpcResult<TotalsRow>>((_resolve, reject) => {
      reject_stale_totals = reject;
    });

    const OTHER_TOTALS: TotalsRow = { impressions: 41, views: 15, cta_taps: 4 };

    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName, params: { p_ad_id: string }) => {
        if (params.p_ad_id === AD_ID) {
          if (name === 'ad_stats_totals') return stale_totals;
          return new Promise(() => {}); // daily/zones de AD_ID nunca resuelven en este test
        }
        // AD_ID_B resuelve rápido en las 3
        if (name === 'ad_stats_totals') {
          return Promise.resolve({ data: [OTHER_TOTALS], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useAdStats(id, 'max', { client }),
      { initialProps: { id: AD_ID } },
    );

    await act(async () => {
      rerender({ id: AD_ID_B });
    });

    expect(result.current.totals).toEqual(OTHER_TOTALS);
    expect(result.current.error_message).toBeNull();

    // La petición vieja (de AD_ID) RECHAZA tarde -- debe descartarse por
    // completo, sin pisar el error_message ni los datos ya asentados.
    await act(async () => {
      reject_stale_totals?.(new Error('network down (stale)'));
    });

    expect(result.current.error_message).toBeNull();
    expect(result.current.totals).toEqual(OTHER_TOTALS);
  });
});
