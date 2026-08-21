/**
 * useAdMetrics — métricas agregadas por zona para el panel del anunciante
 * (subtarea 171.2, fase GREEN). Contrato completo y los 18 edge cases están
 * documentados en el docblock de
 * mobile/src/features/ads/__tests__/useAdMetrics.test.tsx — léelo antes de
 * tocar este archivo.
 *
 * Llama supabase.rpc('ad_metrics_for_agency', { p_agency_id: agencyId }) UNA
 * SOLA VEZ por cambio de `agencyId` — SIN p_from/p_to (171.3/R23 no tiene
 * selector de fechas todavía, YAGNI). La RPC
 * (supabase/migrations/20260821000001_ad_metrics_for_agency.sql) hace
 * k-anonimato server-side: zonas con <5 usuarios distintos (y las
 * impresiones que nunca resolvieron zona) se funden en UNA fila
 * (municipality_id=NULL, neighborhood_id=NULL) — el bucket "otras zonas".
 *
 * 🔴 GOTCHA: supabase/types/database.types.ts (regenerado 2026-08-20) tipa
 * el retorno de esta RPC como `{ municipality_id: string; neighborhood_id:
 * number; ... }` SIN nullability, porque el generador no la deriva de un
 * `RETURNS TABLE`. El tipo MIENTE — en runtime el bucket llega con AMBOS
 * campos en `null`. Por eso el cast de abajo (`as AdMetricsRpcRow[]`) no es
 * pereza: es corregir un tipo generado incorrecto para poder distinguir el
 * bucket con `=== null` en vez de confiar en un tipo que dice que nunca pasa.
 *
 * 🔒 Anti-reconstrucción: el hook NUNCA reparte, estima ni prorratea el
 * bucket entre las zonas visibles — `zones` son las filas reales tal cual,
 * `other_zones` se expone tal cual. Repartirlo del lado del cliente
 * desharía la garantía de k-anonimato que la RPC construyó server-side.
 *
 * `totals` es `null` mientras carga y ante error — JAMÁS ceros: para quien
 * pagó el slot, "0 impresiones" y "no pudimos cargar" son mensajes
 * opuestos. Un estado vacío LEGÍTIMO (RPC → [] sin error, agencia real
 * todavía sin impresiones) sí produce `totals = {0,0,0}` con `error = null`
 * — indistinguible, por diseño anti-IDOR de la RPC, de "0 filas por falta
 * de autorización" (la RPC nunca lanza, solo no matchea nada).
 *
 * Error de RPC (incluido `42883 function ... does not exist` — 168-172 se
 * mergea a main sin desplegar el schema, un OTA en esa ventana pega contra
 * un backend sin la RPC) ⇒ mensaje neutro en español, nunca el texto crudo
 * de PostgREST/Postgres, mismo criterio fail-closed que useCanAdvertise.
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface AdZoneMetrics {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdZoneTotals {
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface UseAdMetricsState {
  /** Zonas REALES desglosadas, tal cual las devolvió la RPC. NUNCA incluye el bucket (NULL,NULL). */
  zones: AdZoneMetrics[];
  /** El bucket "otras zonas" (NULL,NULL) tal cual, o null si la RPC no lo devolvió. */
  other_zones: AdZoneTotals | null;
  /** Suma de zones + other_zones. null = desconocido (cargando o error) — NUNCA ceros por defecto. */
  totals: AdZoneTotals | null;
  loading: boolean;
  error: string | null;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las métricas del anuncio. Intenta de nuevo.';

/**
 * Shape REAL en runtime — deliberadamente nullable en municipality_id/
 * neighborhood_id, a diferencia del tipo generado (ver gotcha en el
 * docblock de arriba).
 */
type AdMetricsRpcRow = {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
};

function sum_totals(rows: readonly AdMetricsRpcRow[]): AdZoneTotals {
  return rows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      views: acc.views + row.views,
      cta_taps: acc.cta_taps + row.cta_taps,
    }),
    { impressions: 0, views: 0, cta_taps: 0 },
  );
}

export function useAdMetrics(agencyId: string | null): UseAdMetricsState {
  const [zones, set_zones] = useState<AdZoneMetrics[]>([]);
  const [other_zones, set_other_zones] = useState<AdZoneTotals | null>(null);
  const [totals, set_totals] = useState<AdZoneTotals | null>(null);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function fetch_metrics(): Promise<void> {
      // Nada que consultar — evita una RPC sin agencyId.
      if (!agencyId) {
        set_zones([]);
        set_other_zones(null);
        set_totals(null);
        set_error(null);
        set_loading(false);
        return;
      }

      set_loading(true);

      const rpc_result = (await supabase.rpc('ad_metrics_for_agency', {
        p_agency_id: agencyId,
      })) as { data: AdMetricsRpcRow[] | null; error: { code?: string; message: string } | null };

      if (ignore) return;

      if (rpc_result.error) {
        set_zones([]);
        set_other_zones(null);
        set_totals(null);
        set_error(NEUTRAL_ERROR_MESSAGE);
        set_loading(false);
        return;
      }

      const rows = rpc_result.data ?? [];
      const real_zones: AdZoneMetrics[] = [];
      let bucket: AdZoneTotals | null = null;

      for (const row of rows) {
        if (row.municipality_id === null && row.neighborhood_id === null) {
          bucket = { impressions: row.impressions, views: row.views, cta_taps: row.cta_taps };
        } else {
          real_zones.push(row);
        }
      }

      set_zones(real_zones);
      set_other_zones(bucket);
      set_totals(sum_totals(rows));
      set_error(null);
      set_loading(false);
    }

    void fetch_metrics();

    return () => {
      ignore = true;
    };
  }, [agencyId]);

  return { zones, other_zones, totals, loading, error };
}
