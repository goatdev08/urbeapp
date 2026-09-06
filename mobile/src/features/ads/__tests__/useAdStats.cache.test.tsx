/**
 * Tests fase RED — caché por (ad_id, period) + prefetch en useAdStats (tarea
 * #262, origen: polish(261) — cambiar de tab en el dashboard del anuncio se
 * sentía lento por la ida y vuelta de red a us-west-2, no por el SQL).
 * Archivo SUT: mobile/src/features/ads/hooks/useAdStats.ts
 * Suite hermana (NO se toca, NO se renegocia): useAdStats.test.tsx (27 EC).
 *
 * SEAM QUE SE FIJA (verbatim del briefing del orquestador):
 * - La firma pública NO cambia: `useAdStats(ad_id, period, deps?) → {
 *   totals, daily, zones, is_loading, error_message, refetch }`.
 * - Caché por (ad_id, period) acotada a la instancia del hook; constante
 *   exportada `AD_STATS_STALE_MS = 60_000`.
 * - Cambio a un period con entrada FRESCA (< STALE_MS): datos publicados en
 *   el mismo tick (sin pasar por totals=null/[]), `is_loading` false, CERO
 *   llamadas rpc nuevas.
 * - Cambio a un period con entrada STALE (≥ STALE_MS): datos de caché
 *   publicados de inmediato + `is_loading=true` + las 3 rpc del period; al
 *   resolver, datos nuevos y `is_loading=false`.
 * - Prefetch: cuando las 3 rpc del period visible asientan con éxito, se
 *   disparan las 3 rpc de CADA uno de los otros dos periods (total 6
 *   llamadas más, con los `p_from/p_to` que `period_to_range` da para esos
 *   periods) y sus resultados entran a la caché SIN tocar totals/daily/zones
 *   ni is_loading del period visible.
 * - Error o rechazo en una rpc de prefetch: no toca los datos visibles, no
 *   fabrica `error_message`, y ese period simplemente no queda cacheado.
 * - Cambio de `ad_id`: caché descartada; respuestas tardías (visibles o de
 *   prefetch) del ad_id viejo se ignoran (EC-18 extendido).
 * - `refetch()`: invalida la entrada del period actual y vuelve a pedir sus
 *   3 rpc (EC-22/EC-23 intactos).
 *
 * GOTCHAS ya pagados en el repo (memorias del vault):
 * - rntl14_renderhook_async: `renderHook`/`act` SIEMPRE con `await`, si no
 *   `result` es `undefined`.
 * - rntl_unmount_fuera_de_act: no aplica aquí (no hay unmount en este
 *   archivo), pero se respeta el patrón `act` para toda mutación de estado.
 * - fake timers modernos (`jest.useFakeTimers()` sin config = modern) también
 *   mockean `Date`/`Date.now()`, así que `jest.advanceTimersByTime` mueve el
 *   reloj que lee `new Date()` dentro de `period_to_range` y de la lógica de
 *   frescura de la caché -- sin necesidad de que el SUT programe ningún
 *   `setTimeout`.
 *
 * `AD_STATS_STALE_MS` HOY no existe en el módulo (fase RED, GREEN aún no
 * escrito): el import se resuelve a `undefined` en runtime (Babel no
 * type-checa) y `tsc --noEmit` SÍ debe fallar por el export faltante -- es un
 * modo de fallo aceptado explícitamente por el briefing. Para que la suite
 * corra igual (y falle por ASERCIÓN, no por un throw de
 * `jest.advanceTimersByTime(NaN)`), se usa `AD_STATS_STALE_MS ?? 60_000`
 * como respaldo local.
 *
 * EDGE CASES (RED):
 * - (EC-C1) primera_carga_dispara_las_3_del_period_visible_y_al_asentar_prefetchea_los_otros_dos_periods_con_los_params_correctos
 * - (EC-C2) cambio_a_period_prefetcheado_y_fresco_publica_datos_en_el_mismo_tick_sin_rpc_nuevas
 * - (EC-C3) cambio_a_period_fresco_nunca_pasa_por_totals_null_en_ningun_render_intermedio
 * - (EC-C4) entrada_stale_revalida_en_segundo_plano_manteniendo_los_datos_de_cache_visibles_hasta_que_llega_lo_nuevo
 * - (EC-C5) error_en_una_rpc_de_prefetch_no_toca_los_datos_visibles_ni_fabrica_error_y_el_period_fallido_no_queda_cacheado
 * - (EC-C6) cambio_de_ad_id_con_prefetch_en_vuelo_ignora_las_respuestas_tardias_del_ad_id_viejo
 * - (EC-C7) refetch_con_cache_fresca_igual_vuelve_a_pedir_las_3_del_period_actual
 * - (EC-C8) NO es un test de este archivo: `useAdStats.test.tsx` (27 EC) debe
 *   seguir en verde corriendo junto a este archivo
 *   (`jest src/features/ads/__tests__/useAdStats`) -- el prefetch no debe
 *   alterar los conteos de llamadas que esos tests ya fijan.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useAdStats, period_to_range, AD_STATS_STALE_MS, type AdStatsPeriod } from '../hooks/useAdStats';

// ---------------------------------------------------------------------------
// Fixtures (copiadas del patrón de la suite hermana -- este archivo es
// independiente, no importa de un .test.tsx sibling).
// ---------------------------------------------------------------------------

const AD_ID = 'anuncio-uuid-262-cache';
const AD_ID_B = 'anuncio-uuid-262-cache-OTRO';

type TotalsRow = { impressions: number; views: number; cta_taps: number };
type DailyRow = { day: string; impressions: number; views: number; cta_taps: number };
type ZoneRow = {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
};

type RpcResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };
type RpcName = 'ad_stats_totals' | 'ad_stats_daily' | 'ad_stats_zones';
type RpcParams = { p_ad_id: string; p_from: string | null; p_to: string | null };

const DAY_1: DailyRow = { day: '2026-09-01', impressions: 100, views: 60, cta_taps: 5 };
const DAY_2: DailyRow = { day: '2026-09-02', impressions: 150, views: 90, cta_taps: 8 };

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

// Un juego de datos DISTINTO por period -- así una aserción sobre "los datos
// del period visible son los de X" no puede confundirse con los de otro.
const TOTALS_TODAY: TotalsRow = { impressions: 10, views: 5, cta_taps: 1 };
const DAILY_TODAY: DailyRow[] = [DAY_1];
const ZONES_TODAY: ZoneRow[] = [ZONE_REAL];

const TOTALS_LAST30: TotalsRow = { impressions: 20, views: 10, cta_taps: 2 };
const DAILY_LAST30: DailyRow[] = [DAY_1, DAY_2];
const ZONES_LAST30: ZoneRow[] = [ZONE_REAL, ZONE_BUCKET];

const TOTALS_MAX: TotalsRow = { impressions: 500, views: 320, cta_taps: 40 };
const DAILY_MAX: DailyRow[] = [DAY_1, DAY_2];
const ZONES_MAX: ZoneRow[] = [ZONE_REAL, ZONE_BUCKET];

const BASE_DATA_BY_PERIOD: Record<
  AdStatsPeriod,
  { totals: TotalsRow; daily: DailyRow[]; zones: ZoneRow[] }
> = {
  today: { totals: TOTALS_TODAY, daily: DAILY_TODAY, zones: ZONES_TODAY },
  last30: { totals: TOTALS_LAST30, daily: DAILY_LAST30, zones: ZONES_LAST30 },
  max: { totals: TOTALS_MAX, daily: DAILY_MAX, zones: ZONES_MAX },
};

const ALL_PERIODS: AdStatsPeriod[] = ['today', 'last30', 'max'];

function range_key(range: { p_from: string | null; p_to: string | null }): string {
  return `${range.p_from ?? 'null'}|${range.p_to ?? 'null'}`;
}

/**
 * Cliente que responde de forma DISTINGUIBLE por period (usando p_from/p_to,
 * que `period_to_range` ya hace únicos para un `now` fijo) -- útil para
 * clavar QUÉ period respondió qué, sin depender de `p_ad_id`.
 * `overrides[period][field]` reemplaza la respuesta default de esa
 * combinación period/campo por una función que la produce (permite
 * promesas pendientes, rechazos, o respuestas dependientes del # de llamada).
 */
function make_multi_period_client(
  now: Date,
  overrides: Partial<
    Record<
      AdStatsPeriod,
      Partial<Record<'totals' | 'daily' | 'zones', () => Promise<RpcResult<unknown>>>>
    >
  > = {},
): { rpc: jest.Mock } {
  const period_by_range_key = new Map<string, AdStatsPeriod>(
    ALL_PERIODS.map((p) => [range_key(period_to_range(p, now)), p]),
  );

  const rpc = jest.fn((name: RpcName, params: RpcParams) => {
    const period = period_by_range_key.get(range_key(params));
    const field: 'totals' | 'daily' | 'zones' =
      name === 'ad_stats_totals' ? 'totals' : name === 'ad_stats_daily' ? 'daily' : 'zones';

    if (!period) return Promise.resolve({ data: [], error: null });

    const override = overrides[period]?.[field];
    if (override) return override();

    const value = BASE_DATA_BY_PERIOD[period][field];
    return Promise.resolve({ data: field === 'totals' ? [value] : value, error: null });
  });

  return { rpc };
}

function render_stats(ad_id: string, period: AdStatsPeriod, client: { rpc: jest.Mock }) {
  return renderHook(
    ({ id, p }: { id: string; p: AdStatsPeriod }) => useAdStats(id, p, { client }),
    { initialProps: { id: ad_id, p: period } },
  );
}

/** Drena varias rondas de microtasks -- el prefetch se dispara dentro de los
 * `.then()` de las 3 rpc del period visible, un nivel más profundo que el
 * `await` de un `renderHook` simple. */
async function flush_microtasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// NOW fijo para que period_to_range('today'|'last30', NOW) sea determinista
// y distinto de 'max' (ambos null) en cada test.
const NOW = new Date(2026, 8, 5, 10, 0, 0, 0);

afterEach(() => {
  jest.useRealTimers();
});

describe('useAdStats — caché por period + prefetch (#262)', () => {
  it('(EC-C1) primera_carga_dispara_las_3_del_period_visible_y_al_asentar_prefetchea_los_otros_dos_periods_con_los_params_correctos', async () => {
    // 🔴 Desbloqueo del orquestador (#262): sin fijar el reloj, `new Date()`
    // dentro del hook usa la hora REAL de la corrida, que nunca coincide en
    // precisión de milisegundo con el `NOW` fijo que usan `today_range`/
    // `last30_range` abajo -- 'today' coincidía por casualidad (trunca a
    // medianoche del mismo día calendario) pero 'last30' (resta exacta de
    // 30*24h) fallaba siempre. `setSystemTime(NOW)` hace que `period_to_range`
    // del hook calcule con el MISMO `now` que el test usa para comparar.
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const { rpc } = make_multi_period_client(NOW);

    const { result } = await render_stats(AD_ID, 'max', { rpc });
    await flush_microtasks();

    // Datos del period VISIBLE ('max'), sin transformar.
    expect(result.current.totals).toEqual(TOTALS_MAX);
    expect(result.current.daily).toEqual(DAILY_MAX);
    expect(result.current.zones).toEqual(ZONES_MAX);
    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();

    // 3 del visible + 6 del prefetch (today + last30, 3 rpc cada uno).
    expect(rpc).toHaveBeenCalledTimes(9);

    const today_range = period_to_range('today', NOW);
    const last30_range = period_to_range('last30', NOW);
    const rpc_names: RpcName[] = ['ad_stats_totals', 'ad_stats_daily', 'ad_stats_zones'];

    for (const name of rpc_names) {
      expect(rpc).toHaveBeenCalledWith(name, { p_ad_id: AD_ID, ...today_range });
      expect(rpc).toHaveBeenCalledWith(name, { p_ad_id: AD_ID, ...last30_range });
    }
  });

  it('(EC-C2) cambio_a_period_prefetcheado_y_fresco_publica_datos_en_el_mismo_tick_sin_rpc_nuevas', async () => {
    const { rpc } = make_multi_period_client(NOW);
    // 🔴 `client` se estabiliza FUERA del render -- pasar `{ client: { rpc } }`
    // inline recrearía el objeto `client` en cada render y, como el efecto
    // del hook depende de `client` por referencia, dispararía un loop
    // infinito de refetch/rerender (memoria hook_array_prop_reference_loop).
    const client = { rpc };

    const { result, rerender } = await renderHook(
      ({ p }: { p: AdStatsPeriod }) => useAdStats(AD_ID, p, { client }),
      { initialProps: { p: 'max' as AdStatsPeriod } },
    );
    await flush_microtasks(); // asienta 'max' + prefetch de 'today'/'last30'

    const calls_before_switch = rpc.mock.calls.length; // 9

    await act(async () => {
      rerender({ p: 'today' });
    });

    // Datos de 'today' ya estaban prefetcheados y frescos (< STALE_MS desde
    // que se guardaron) -- se publican de inmediato, sin volver a pedir nada.
    expect(result.current.totals).toEqual(TOTALS_TODAY);
    expect(result.current.daily).toEqual(DAILY_TODAY);
    expect(result.current.zones).toEqual(ZONES_TODAY);
    expect(result.current.is_loading).toBe(false);
    expect(rpc.mock.calls.length).toBe(calls_before_switch);
  });

  it('(EC-C3) cambio_a_period_fresco_nunca_pasa_por_totals_null_en_ningun_render_intermedio', async () => {
    // 🔴 Desbloqueo del orquestador (#262): mismo fix que EC-C1 -- sin fijar
    // el reloj, el prefetch de 'last30' durante el mount nunca matchea el
    // mock (precisión de ms contra el `NOW` fijo) y esa entrada de caché
    // queda con `totals: null`, haciendo que ESTE test fallara por una causa
    // ajena a lo que en verdad prueba (el render intermedio del switch).
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const { rpc } = make_multi_period_client(NOW);
    const client = { rpc }; // estable -- ver nota EC-C2 (loop infinito si no)
    const totals_snapshots: (TotalsRow | null)[] = [];

    const { rerender } = await renderHook(
      ({ p }: { p: AdStatsPeriod }) => {
        const state = useAdStats(AD_ID, p, { client });
        totals_snapshots.push(state.totals);
        return state;
      },
      { initialProps: { p: 'max' as AdStatsPeriod } },
    );
    await flush_microtasks(); // asienta 'max' + prefetch

    // Solo interesan los renders DESDE el cambio de period en adelante.
    totals_snapshots.length = 0;

    await act(async () => {
      rerender({ p: 'last30' });
    });

    expect(totals_snapshots.length).toBeGreaterThan(0);
    expect(totals_snapshots.every((t) => t !== null)).toBe(true);
    expect(totals_snapshots[totals_snapshots.length - 1]).toEqual(TOTALS_LAST30);
  });

  it('(EC-C4) entrada_stale_revalida_en_segundo_plano_manteniendo_los_datos_de_cache_visibles_hasta_que_llega_lo_nuevo', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const TOTALS_TODAY_REVALIDATED: TotalsRow = { impressions: 111, views: 55, cta_taps: 11 };
    let today_totals_call_count = 0;
    let resolve_revalidation: ((v: RpcResult<TotalsRow>) => void) | undefined;

    const { rpc } = make_multi_period_client(NOW, {
      today: {
        totals: () => {
          today_totals_call_count += 1;
          if (today_totals_call_count === 1) {
            return Promise.resolve({ data: [TOTALS_TODAY], error: null });
          }
          return new Promise((resolve) => {
            resolve_revalidation = resolve;
          });
        },
      },
    });

    const client = { rpc }; // estable -- ver nota EC-C2 (loop infinito si no)

    const { result, rerender } = await renderHook(
      ({ p }: { p: AdStatsPeriod }) => useAdStats(AD_ID, p, { client }),
      { initialProps: { p: 'max' as AdStatsPeriod } },
    );
    await flush_microtasks(); // asienta 'max' + prefetch (today_totals_call_count === 1 aquí)

    expect(today_totals_call_count).toBe(1);

    // Avanza el reloj más allá de AD_STATS_STALE_MS -- la entrada de 'today'
    // (guardada durante el prefetch) queda STALE.
    //
    // 🔴 Desbloqueo del orquestador (#262), refinado con una prueba empírica
    // (probé 6 variantes con un test-probe standalone, ya descartado): NO
    // basta con volver async el `act` del `rerender` de abajo -- un
    // `act` SÍNCRONO alrededor de `jest.advanceTimersByTime` deja al
    // scheduler de efectos pasivos de React en un estado que bloquea el
    // flush del PRÓXIMO `act`, aunque ese próximo sea async (confirmado:
    // sin este fix, ni una ronda extra de `flush_microtasks` después del
    // `rerender` lo destraba). Envolver el propio avance del reloj en un
    // `act` async con un `await Promise.resolve()` lo asienta antes de que
    // el `rerender` siga (RNTL 14, memoria rntl14_renderhook_async: un act
    // síncrono no aplica el estado del efecto).
    await act(async () => {
      jest.advanceTimersByTime(AD_STATS_STALE_MS + 1_000);
      await Promise.resolve();
    });

    await act(async () => {
      rerender({ p: 'today' });
    });

    // Inmediato, en el MISMO tick del cambio: datos de caché (los del
    // prefetch) + is_loading=true (revalidando) + ya se disparó la 2ª
    // llamada de ad_stats_totals para 'today'.
    expect(result.current.totals).toEqual(TOTALS_TODAY);
    expect(result.current.is_loading).toBe(true);
    expect(today_totals_call_count).toBe(2);

    await act(async () => {
      resolve_revalidation?.({ data: [TOTALS_TODAY_REVALIDATED], error: null });
    });

    expect(result.current.totals).toEqual(TOTALS_TODAY_REVALIDATED);
    expect(result.current.is_loading).toBe(false);
  });

  it('(EC-C5) error_en_una_rpc_de_prefetch_no_toca_los_datos_visibles_ni_fabrica_error_y_el_period_fallido_no_queda_cacheado', async () => {
    let today_totals_call_count = 0;

    const { rpc } = make_multi_period_client(NOW, {
      today: {
        totals: () => {
          today_totals_call_count += 1;
          return Promise.resolve({
            data: null,
            error: { code: '42501', message: 'permission denied' },
          });
        },
      },
    });
    const client = { rpc }; // estable -- ver nota EC-C2 (loop infinito si no)

    const { result, rerender } = await renderHook(
      ({ p }: { p: AdStatsPeriod }) => useAdStats(AD_ID, p, { client }),
      { initialProps: { p: 'max' as AdStatsPeriod } },
    );
    await flush_microtasks(); // asienta 'max'; el prefetch de 'today' falla

    // El prefetch fallido de 'today' NO debe tocar los datos visibles de
    // 'max' ni fabricar un banner de error.
    expect(result.current.totals).toEqual(TOTALS_MAX);
    expect(result.current.daily).toEqual(DAILY_MAX);
    expect(result.current.zones).toEqual(ZONES_MAX);
    expect(result.current.error_message).toBeNull();
    expect(today_totals_call_count).toBe(1);

    await act(async () => {
      rerender({ p: 'today' });
    });

    // 'today' NO quedó cacheado (su prefetch falló) -- tocarlo dispara sus
    // propias 3 rpc de nuevo (2ª llamada a ad_stats_totals).
    expect(today_totals_call_count).toBe(2);
  });

  it('(EC-C6) cambio_de_ad_id_con_prefetch_en_vuelo_ignora_las_respuestas_tardias_del_ad_id_viejo', async () => {
    const today_range = period_to_range('today', NOW);

    const STALE_PREFETCH_TOTALS: TotalsRow = { impressions: 999, views: 999, cta_taps: 999 };
    let resolve_stale_prefetch: ((v: RpcResult<TotalsRow>) => void) | undefined;

    const client: { rpc: jest.Mock } = {
      rpc: jest.fn((name: RpcName, params: RpcParams) => {
        const is_today = params.p_from === today_range.p_from && params.p_to === today_range.p_to;

        // El prefetch de 'today' del ad_id VIEJO (AD_ID) se queda pendiente
        // a propósito -- se resuelve tarde, DESPUÉS de cambiar a AD_ID_B.
        if (params.p_ad_id === AD_ID && is_today && name === 'ad_stats_totals') {
          return new Promise<RpcResult<TotalsRow>>((resolve) => {
            resolve_stale_prefetch = resolve;
          });
        }

        if (name === 'ad_stats_totals') return Promise.resolve({ data: [TOTALS_MAX], error: null });
        if (name === 'ad_stats_daily') return Promise.resolve({ data: DAILY_MAX, error: null });
        return Promise.resolve({ data: ZONES_MAX, error: null });
      }),
    };

    const { result, rerender } = await renderHook(
      ({ id, p }: { id: string; p: AdStatsPeriod }) => useAdStats(id, p, { client }),
      { initialProps: { id: AD_ID, p: 'max' as AdStatsPeriod } },
    );
    await flush_microtasks(); // asienta 'max' de AD_ID; el prefetch de 'today' de AD_ID queda pendiente

    // Precondición del caso: el prefetch de 'today' para AD_ID SÍ debe
    // haberse disparado (si no, esta prueba sería vacua -- pasaría igual sin
    // prefetch implementado, porque nunca habría nada "tardío" que llegara).
    expect(resolve_stale_prefetch).toBeDefined();

    await act(async () => {
      rerender({ id: AD_ID_B, p: 'max' });
    });
    await flush_microtasks();

    expect(result.current.totals).toEqual(TOTALS_MAX);

    const calls_before_stale_resolves = client.rpc.mock.calls.length;

    // La respuesta tardía del prefetch del ad_id VIEJO llega después del
    // cambio de ad_id -- debe descartarse sin generar llamadas nuevas ni
    // tocar los datos ya asentados del ad_id nuevo.
    await act(async () => {
      resolve_stale_prefetch?.({ data: [STALE_PREFETCH_TOTALS], error: null });
    });

    expect(client.rpc.mock.calls.length).toBe(calls_before_stale_resolves);
    expect(result.current.totals).toEqual(TOTALS_MAX);
    expect(result.current.daily).toEqual(DAILY_MAX);
    expect(result.current.zones).toEqual(ZONES_MAX);
    expect(result.current.error_message).toBeNull();
  });

  it('(EC-C7) refetch_con_cache_fresca_igual_vuelve_a_pedir_las_3_del_period_actual: refetch() ignora la frescura -- fuerza la revalidación del period visible aunque no haya pasado AD_STATS_STALE_MS', async () => {
    const { rpc } = make_multi_period_client(NOW);

    const { result } = await render_stats(AD_ID, 'max', { rpc });
    await flush_microtasks(); // 9 llamadas: 3 de 'max' + 6 de prefetch

    const calls_before_refetch = rpc.mock.calls.length;
    // Precondición: el prefetch de los otros dos periods SÍ debe haber
    // corrido (3 de 'max' + 6 de prefetch) -- si no, esta prueba sería
    // vacua, porque el hook de hoy YA refetchea sin caché de por medio.
    expect(calls_before_refetch).toBe(9);

    await act(async () => {
      result.current.refetch();
    });

    const max_range = period_to_range('max', NOW);
    const new_calls = rpc.mock.calls.slice(calls_before_refetch);
    const rpc_names: RpcName[] = ['ad_stats_totals', 'ad_stats_daily', 'ad_stats_zones'];

    for (const name of rpc_names) {
      const matching = new_calls.filter(
        ([called_name, params]: [RpcName, RpcParams]) =>
          called_name === name &&
          params.p_ad_id === AD_ID &&
          params.p_from === max_range.p_from &&
          params.p_to === max_range.p_to,
      );
      expect(matching.length).toBe(1);
    }
  });
});
