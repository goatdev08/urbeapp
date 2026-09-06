/**
 * useAdStats — datos por anuncio para el dashboard del anunciante (tarea
 * #212, subtarea 212.3; caché por periodo + prefetch: tarea #262, origen
 * polish(261) — la app corre contra us-west-2 mientras el anunciante suele
 * estar en México: la ida y vuelta de red domina el costo de cambiar de tab
 * (today/last30/max), no el SQL (2-3 ms). Fase GREEN. El contrato base
 * (firma, 25 edge cases del hook + los 4 de `period_to_range`) vive en
 * mobile/src/features/ads/__tests__/useAdStats.test.tsx; el contrato de
 * caché+prefetch (7 edge cases) vive en useAdStats.cache.test.tsx — son los
 * archivos que fijan el comportamiento; este archivo los implementa sin
 * renegociarlos.
 *
 * Llama EN PARALELO las 3 RPCs de supabase/migrations/20260824000001_ad_stats_per_ad.sql
 * (ad_stats_totals / ad_stats_daily / ad_stats_zones), las 3 con
 * { p_ad_id, p_from, p_to } — p_from/p_to los calcula `period_to_range`.
 *
 * Patrón: calca useAdMetrics (171.2) en la forma general (totals=null en
 * carga/error, `ignore` de closure en el cleanup del efecto para descartar
 * respuestas tardías de un ad_id/period viejo — EC-18/EC-19) pero con DI
 * explícita del cliente vía `deps.client` (useModerateAd/useSetOrgAdvertising)
 * en vez de importar el singleton real, y con 3 RPCs en paralelo en lugar de
 * una. Todo-o-nada: cualquier error (o rechazo) de las 3 limpia los 3 campos
 * de datos y deja un único mensaje neutro (#200) — nunca datos parciales.
 *
 * Caché por `(ad_id, period)` (#262): un `Map` en un `useRef`, acotado a la
 * instancia del hook (no sobrevive un unmount, no se comparte entre
 * anuncios). Entrada FRESCA (< `AD_STATS_STALE_MS`) → se publica en el mismo
 * tick, cero RPCs. Entrada STALE → se publica de inmediato (stale-while-
 * revalidate) y se revalida en segundo plano. Sin entrada → el flujo de
 * siempre (reset + loading + 3 RPCs). Cuando el period VISIBLE asienta con
 * éxito, se prefetchea en segundo plano cada uno de los otros dos periods
 * (si su entrada de caché no existe o ya está stale) para que cambiar de tab
 * sea instantáneo la próxima vez; un error de prefetch se descarta en
 * silencio (ese period simplemente no queda cacheado) y nunca toca el
 * estado visible. Cambiar de `ad_id` limpia toda la caché.
 *
 * 🔴 `client.rpc(...)` se llama DIRECTO, nunca desprendido (#205, EC-24) —
 * desestructurar `rpc` de `client` pierde `this` si el cliente real usa un
 * método de prototipo (memoria supabase_js_metodo_desprendido).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type AdStatsPeriod = 'today' | 'last30' | 'max';

export interface AdStatsTotals {
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdStatsDailyPoint {
  /** 'YYYY-MM-DD', tal cual lo devuelve la RPC (columna `day`). */
  day: string;
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdStatsZoneRow {
  /** El bucket "otras zonas" es la fila con AMBOS campos null. */
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
}

/** Forma mínima del cliente que el hook necesita — nunca se desprende (#205). */
export type AdStatsSupabaseClient = {
  rpc: (
    fn: 'ad_stats_totals' | 'ad_stats_daily' | 'ad_stats_zones',
    params: { p_ad_id: string; p_from: string | null; p_to: string | null },
  ) => Promise<{ data: unknown[] | null; error: { code?: string; message: string } | null }>;
};

export interface UseAdStatsDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  client?: AdStatsSupabaseClient;
}

export interface UseAdStatsState {
  /** null mientras carga y ante error — JAMÁS ceros fabricados. */
  totals: AdStatsTotals | null;
  /** [] en carga, error, o éxito sin desglose diario. Orden: el que entregó la RPC. */
  daily: AdStatsDailyPoint[];
  /** [] en carga, error, o éxito sin desglose de zona. Incluye el bucket (NULL,NULL) tal cual. */
  zones: AdStatsZoneRow[];
  is_loading: boolean;
  /** Mensaje neutro en español, nunca error.message crudo (#200). null si no hay error. */
  error_message: string | null;
  refetch: () => void;
}

/**
 * period → { p_from, p_to } para las 3 RPCs. Pura (recibe `now` explícito,
 * nunca lee Date.now() internamente) para que sea testable sin fake timers.
 *
 *   'today'  → p_from = medianoche local del día de `now`, p_to = null.
 *   'last30' → p_from = now - 30 días exactos,             p_to = null.
 *   'max'    → p_from = null, p_to = null (sin rango).
 */
export function period_to_range(
  period: AdStatsPeriod,
  now: Date,
): { p_from: string | null; p_to: string | null } {
  if (period === 'max') return { p_from: null, p_to: null };

  if (period === 'today') {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return { p_from: midnight.toISOString(), p_to: null };
  }

  // 'last30' — 30*24h exactas, no un mes calendario.
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { p_from: from.toISOString(), p_to: null };
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las estadísticas del anuncio. Intenta de nuevo.';

/** Lazy para no forzar el singleton real cuando el caller inyecta `deps.client` (calca useModerateAd). */
function get_default_client(): AdStatsSupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: AdStatsSupabaseClient }).supabase;
}

/** Una entrada fresca (< esto) se publica sin volver a pedir nada (#262). */
export const AD_STATS_STALE_MS = 60_000;

const ALL_PERIODS: AdStatsPeriod[] = ['today', 'last30', 'max'];

interface AdStatsCacheEntry {
  totals: AdStatsTotals | null;
  daily: AdStatsDailyPoint[];
  zones: AdStatsZoneRow[];
  fetched_at_ms: number;
}

function cache_key(ad_id: string, period: AdStatsPeriod): string {
  return `${ad_id}|${period}`;
}

export function useAdStats(
  ad_id: string | null,
  period: AdStatsPeriod,
  deps?: UseAdStatsDeps,
): UseAdStatsState {
  const [totals, set_totals] = useState<AdStatsTotals | null>(null);
  const [daily, set_daily] = useState<AdStatsDailyPoint[]>([]);
  const [zones, set_zones] = useState<AdStatsZoneRow[]>([]);
  const [is_loading, set_is_loading] = useState(false);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  const client = deps?.client ?? get_default_client();

  // Caché por instancia del hook — un anuncio (pantalla) por hook, nunca se
  // comparte entre anuncios ni sobrevive un unmount (#262).
  const cache_ref = useRef<Map<string, AdStatsCacheEntry>>(new Map());
  // `undefined` de arranque para que la 1ª corrida del efecto "limpie" (un
  // Map ya vacío, sin costo) en vez de necesitar un caso especial de mount.
  const cache_ad_id_ref = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let ignore = false;

    // Un ad_id nuevo invalida TODA la caché (incluye los prefetch en vuelo
    // del ad_id viejo — ver el guard `ignore` de `prefetch_other_periods`).
    if (ad_id !== cache_ad_id_ref.current) {
      cache_ref.current.clear();
      cache_ad_id_ref.current = ad_id;
    }

    // Prefetch en segundo plano de los otros dos periods una vez que el
    // period VISIBLE asentó con éxito — nunca toca totals/daily/zones/
    // is_loading/error_message (EC-C5), y respeta el mismo `ignore` de esta
    // corrida del efecto (EC-C6: un cambio de ad_id/period antes de que
    // resuelva descarta la respuesta tardía sin pisar nada).
    function prefetch_other_periods(
      current_ad_id: string,
      visible_period: AdStatsPeriod,
      now: Date,
    ): void {
      const now_ms = now.getTime();

      for (const other_period of ALL_PERIODS) {
        if (other_period === visible_period) continue;

        const key = cache_key(current_ad_id, other_period);
        const cached = cache_ref.current.get(key);
        // Ya fresco -- no hay nada que ganar re-pidiéndolo.
        if (cached && now_ms - cached.fetched_at_ms < AD_STATS_STALE_MS) continue;

        const { p_from, p_to } = period_to_range(other_period, now);
        const params = { p_ad_id: current_ad_id, p_from, p_to };

        Promise.all([
          client.rpc('ad_stats_totals', params),
          client.rpc('ad_stats_daily', params),
          client.rpc('ad_stats_zones', params),
        ]).then(
          ([totals_res, daily_res, zones_res]) => {
            if (ignore) return;
            // Un error (o rechazo, ver el 2º argumento de `.then` abajo) en
            // cualquiera de las 3 deja ese period simplemente sin cachear —
            // nunca fabrica error_message ni toca el period visible. El guard
            // de falsy adicional es defensivo (frontera de confianza: un
            // cliente que no cumpliera su contrato jamás debe tirar el efecto).
            if (!totals_res || !daily_res || !zones_res) return;
            if (totals_res.error || daily_res.error || zones_res.error) return;
            const rows = (totals_res.data ?? []) as AdStatsTotals[];
            cache_ref.current.set(key, {
              totals: rows[0] ?? null,
              daily: (daily_res.data ?? []) as AdStatsDailyPoint[],
              zones: (zones_res.data ?? []) as AdStatsZoneRow[],
              fetched_at_ms: Date.now(),
            });
          },
          () => {
            // Rechazo de red en el prefetch -- se descarta en silencio.
          },
        );
      }
    }

    // Envuelto en una función nombrada (invocada síncronamente abajo) en
    // vez de setState directo en el cuerpo del efecto — mismo patrón que
    // useAdMetrics/fetch_metrics, evita el lint react-hooks/set-state-in-effect
    // sin cambiar el timing: sigue siendo síncrono, sin ningún `await` antes
    // de disparar las 3 RPCs (EC-5/EC-25 necesitan is_loading=true observable
    // en el mismo tick).
    function run_fetch(current_ad_id: string, current_period: AdStatsPeriod): void {
      // Un solo `now` para TODO el ciclo de asentado (period visible +
      // prefetch de los otros dos) -- evita que un prefetch calculado unos
      // ms después con `new Date()` fresco caiga en un rango distinto al que
      // acaba de usar el fetch visible (#262).
      const now = new Date();
      const { p_from, p_to } = period_to_range(current_period, now);
      const params = { p_ad_id: current_ad_id, p_from, p_to };

      // 🔴 Deliberadamente NO Promise.all: cada RPC puebla su propio campo en
      // cuanto SU promesa resuelve, sin esperar a las otras dos (EC-19 —
      // `totals` de un `period` nuevo debe reflejarse aunque `daily`/`zones`
      // sigan pendientes). El todo-o-nada solo aplica al ERROR: la bandera
      // `errored` (closure de esta corrida del efecto) hace que la PRIMERA
      // RPC en fallar (o rechazar) resetee los 3 campos una vez, y que
      // cualquier éxito que llegue después de eso (mismo u otro RPC) NO
      // repueble su campo — así una de las 3 en error nunca deja datos
      // parciales de las que sí tuvieron éxito (EC-12, EC-13, EC-15).
      let errored = false;
      let settled_count = 0;
      const total_rpcs = 3;
      let latest_totals: AdStatsTotals | null = null;
      let latest_daily: AdStatsDailyPoint[] = [];
      let latest_zones: AdStatsZoneRow[] = [];

      function mark_settled(): void {
        settled_count += 1;
        if (ignore || settled_count < total_rpcs) return;
        set_is_loading(false);
        if (errored) return;
        // Las 3 asentaron con éxito -- entra a la caché y dispara el
        // prefetch de los otros dos periods (#262).
        cache_ref.current.set(cache_key(current_ad_id, current_period), {
          totals: latest_totals,
          daily: latest_daily,
          zones: latest_zones,
          fetched_at_ms: Date.now(),
        });
        prefetch_other_periods(current_ad_id, current_period, now);
      }

      function handle_error(): void {
        if (ignore) return;
        if (!errored) {
          errored = true;
          set_totals(null);
          set_daily([]);
          set_zones([]);
          set_error_message(NEUTRAL_ERROR_MESSAGE);
        }
        mark_settled();
      }

      client.rpc('ad_stats_totals', params).then((res) => {
        if (ignore) return;
        if (res.error) return handle_error();
        // 0 filas sin error = no autorizado / ad_id inexistente (garantía
        // de la migración: 1 fila siempre que la autorización pase) —
        // totals=null SIN fabricar un error_message (EC-11).
        latest_totals = ((res.data ?? []) as AdStatsTotals[])[0] ?? null;
        if (!errored) set_totals(latest_totals);
        mark_settled();
      }, handle_error);

      client.rpc('ad_stats_daily', params).then((res) => {
        if (ignore) return;
        if (res.error) return handle_error();
        latest_daily = (res.data ?? []) as AdStatsDailyPoint[];
        if (!errored) set_daily(latest_daily);
        mark_settled();
      }, handle_error);

      client.rpc('ad_stats_zones', params).then((res) => {
        if (ignore) return;
        if (res.error) return handle_error();
        latest_zones = (res.data ?? []) as AdStatsZoneRow[];
        if (!errored) set_zones(latest_zones);
        mark_settled();
      }, handle_error);
    }

    // Envuelto en una función nombrada (invocada síncronamente abajo) en vez
    // de setState directo en el cuerpo del efecto — mismo patrón que
    // useAdMetrics/fetch_metrics, evita el lint
    // react-hooks/set-state-in-effect sin cambiar el timing: sigue siendo
    // síncrono, sin ningún `await` antes de disparar las 3 RPCs (EC-5/EC-25
    // necesitan is_loading=true observable en el mismo tick).
    function start(): void {
      // Nada que consultar — string vacío se trata igual que null (EC-16/17).
      if (!ad_id) {
        set_totals(null);
        set_daily([]);
        set_zones([]);
        set_error_message(null);
        set_is_loading(false);
        return;
      }

      const cached = cache_ref.current.get(cache_key(ad_id, period));
      if (cached) {
        // Publica los 3 campos de caché EN EL MISMO batch de setState, sin
        // pasar por null/[] intermedio (EC-C2/EC-C3).
        set_totals(cached.totals);
        set_daily(cached.daily);
        set_zones(cached.zones);
        set_error_message(null);

        if (Date.now() - cached.fetched_at_ms < AD_STATS_STALE_MS) {
          // Fresca -- se publica tal cual, CERO rpc nuevas (EC-C2).
          set_is_loading(false);
          return;
        }

        // Stale-while-revalidate: se ven los datos viejos mientras se
        // revalida en segundo plano (EC-C4).
        set_is_loading(true);
        run_fetch(ad_id, period);
        return;
      }

      // Sin caché -- comportamiento original: reset síncrono, ANTES de
      // disparar ninguna RPC, para que is_loading=true sea observable en el
      // mismo tick (EC-5/EC-25) — también resetea los 3 campos de datos:
      // ningún dato viejo debe verse mientras carga.
      set_totals(null);
      set_daily([]);
      set_zones([]);
      set_error_message(null);
      set_is_loading(true);

      run_fetch(ad_id, period);
    }

    start();

    return () => {
      ignore = true;
    };
  }, [ad_id, period, client, refetch_tick]);

  const refetch = useCallback(() => {
    // Invalida la entrada del period actual ANTES de refetchear -- refetch()
    // ignora deliberadamente la frescura (EC-C7): es un pedido explícito del
    // usuario, no una revalidación oportunista.
    if (ad_id) cache_ref.current.delete(cache_key(ad_id, period));
    set_refetch_tick((n) => n + 1);
  }, [ad_id, period]);

  return { totals, daily, zones, is_loading, error_message, refetch };
}
