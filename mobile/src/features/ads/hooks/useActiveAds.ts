/**
 * useActiveAds — lista de anuncios ACTIVOS para el takedown de emergencia del
 * admin (tarea #210, subtarea 210.3). Contrato completo y los 18 edge cases
 * están en el docblock de
 * mobile/src/features/ads/__tests__/useActiveAds.test.tsx — léelo antes de
 * tocar este archivo.
 *
 * UNA consulta:
 *   supabase.from('ads').select(<columnas + agencies(name)>)
 *     .eq('status', 'active').order('ends_at', {ascending: true})
 *
 * Mismo patrón que usePendingAds (208.2): efecto + reload_token para refetch,
 * fallar cerrado (mensaje neutro, ads=[], sin lanzar). Difiere en filtro
 * (status='active'), orden (ends_at ASC — lo que expira antes, primero: lista
 * de emergencia, no cola FIFO) y columnas (ver docblock del test).
 *
 * 🔴 EL `.eq('status', 'active')` NO ES REDUNDANTE CON RLS — mismo gotcha que
 * usePendingAds. La policy `ads_select` incluye `or private.is_admin()`, y el
 * caller de este hook es SIEMPRE un admin: esa cláusula evalúa `true` para
 * toda fila de la tabla. Sin el filtro explícito, la "vista de activos"
 * traería el inventario COMPLETO de la plataforma.
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface ActiveAd {
  id: string;
  title: string;
  description: string | null;
  agency_id: string;
  starts_at: string;
  ends_at: string;
  /**
   * EXTENSIÓN 210.3 (orquestador, post-GREEN): la lista ahora incluye también
   * `status='paused'` (ver `.in` en la query) para poder reanudarlos. No-nulo
   * ⟺ status='paused' (garantía del trigger `handle_ad_status_change`, no
   * convención del cliente) — discriminador barato sin duplicar `status`.
   */
  paused_at: string | null;
  /**
   * true cuando la CASCADA de suspensión de organización (#211) pausó el
   * anuncio, no un click de admin — la EF `moderate-ad` responde 409
   * `AD_PAUSED_BY_SUSPENSION` si se intenta `resume` sobre este caso.
   */
  paused_by_suspension: boolean;
  /** Embed PostgREST muchos-a-uno: bajar un anuncio sin saber de quién es, no. */
  agencies: { name: string } | null;
}

export interface UseActiveAdsResult {
  ads: ActiveAd[];
  loading: boolean;
  error: string | null;
  /** La pantalla la llama tras pausar/bajar un anuncio para refrescar sin desmontar. */
  refetch: () => Promise<void>;
}

const NEUTRAL_ERROR_MESSAGE = 'No se pudo cargar la lista de anuncios activos. Intenta de nuevo.';

// Sin `*`: select('*') rompe en cuanto la tabla gana una columna que el build
// instalado no espera (§0.5, compatibilidad hacia atrás).
const ACTIVE_AD_COLUMNS = 'id, title, description, agency_id, starts_at, ends_at, agencies(name)';

export function useActiveAds(): UseActiveAdsResult {
  const [ads, set_ads] = useState<ActiveAd[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  // Token de recarga: refetch lo incrementa y el efecto vuelve a correr (mismo
  // patrón que usePendingAds/useMyAds).
  const [reload_token, set_reload_token] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function fetch_active(): Promise<void> {
      if (!ignore) set_loading(true);

      const { data, error: query_error } = await supabase
        .from('ads')
        .select(ACTIVE_AD_COLUMNS)
        .eq('status', 'active')
        .order('ends_at', { ascending: true });

      // Una respuesta tardía de una recarga anterior no pisa a la vigente.
      if (ignore) return;

      if (query_error) {
        set_ads([]);
        set_error(NEUTRAL_ERROR_MESSAGE);
        set_loading(false);
        return;
      }

      set_ads((data ?? []) as unknown as ActiveAd[]);
      set_error(null);
      set_loading(false);
    }

    void fetch_active();

    return () => {
      ignore = true;
    };
  }, [reload_token]);

  /**
   * Dispara una recarga. NO espera a que los datos lleguen — la promesa resuelve
   * en cuanto la recarga queda encolada; el consumidor observa `loading` y `ads`
   * como en la carga inicial.
   */
  const refetch = useCallback(async (): Promise<void> => {
    set_reload_token((n) => n + 1);
  }, []);

  return { ads, loading, error, refetch };
}
