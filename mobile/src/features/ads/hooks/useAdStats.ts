/**
 * useAdStats — datos por anuncio para el dashboard del anunciante (tarea
 * #212, subtarea 212.3). Fase GREEN. El contrato completo (firma, 25 edge
 * cases del hook + los 4 de `period_to_range`) vive en
 * mobile/src/features/ads/__tests__/useAdStats.test.tsx — es el archivo que
 * fija el comportamiento; este archivo lo implementa sin renegociarlo.
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
 * 🔴 `client.rpc(...)` se llama DIRECTO, nunca desprendido (#205, EC-24) —
 * desestructurar `rpc` de `client` pierde `this` si el cliente real usa un
 * método de prototipo (memoria supabase_js_metodo_desprendido).
 */

import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    let ignore = false;

    // Envuelto en una función nombrada (invocada síncronamente abajo) en
    // vez de setState directo en el cuerpo del efecto — mismo patrón que
    // useAdMetrics/fetch_metrics, evita el lint react-hooks/set-state-in-effect
    // sin cambiar el timing: sigue siendo síncrono, sin ningún `await` antes
    // de disparar las 3 RPCs (EC-5/EC-25 necesitan is_loading=true observable
    // en el mismo tick).
    function run_fetch(current_ad_id: string): void {
      const { p_from, p_to } = period_to_range(period, new Date());
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

      function mark_settled(): void {
        settled_count += 1;
        if (!ignore && settled_count >= total_rpcs) set_is_loading(false);
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
        if (!errored) {
          const rows = (res.data ?? []) as AdStatsTotals[];
          // 0 filas sin error = no autorizado / ad_id inexistente (garantía
          // de la migración: 1 fila siempre que la autorización pase) —
          // totals=null SIN fabricar un error_message (EC-11).
          set_totals(rows[0] ?? null);
        }
        mark_settled();
      }, handle_error);

      client.rpc('ad_stats_daily', params).then((res) => {
        if (ignore) return;
        if (res.error) return handle_error();
        if (!errored) set_daily((res.data ?? []) as AdStatsDailyPoint[]);
        mark_settled();
      }, handle_error);

      client.rpc('ad_stats_zones', params).then((res) => {
        if (ignore) return;
        if (res.error) return handle_error();
        if (!errored) set_zones((res.data ?? []) as AdStatsZoneRow[]);
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

      // Síncrono, ANTES de disparar ninguna RPC, para que is_loading=true sea
      // observable en el mismo tick (EC-5/EC-25) — también resetea los 3
      // campos de datos: ningún dato viejo debe verse mientras carga.
      set_totals(null);
      set_daily([]);
      set_zones([]);
      set_error_message(null);
      set_is_loading(true);

      run_fetch(ad_id);
    }

    start();

    return () => {
      ignore = true;
    };
  }, [ad_id, period, client, refetch_tick]);

  const refetch = useCallback(() => {
    set_refetch_tick((n) => n + 1);
  }, []);

  return { totals, daily, zones, is_loading, error_message, refetch };
}
