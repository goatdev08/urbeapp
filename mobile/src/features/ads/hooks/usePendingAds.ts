/**
 * usePendingAds — cola de moderación del admin (tarea #208, subtarea 208.2).
 * Contrato completo y los 18 edge cases están en el docblock de
 * mobile/src/features/ads/__tests__/usePendingAds.test.tsx — léelo antes de
 * tocar este archivo.
 *
 * UNA consulta:
 *   supabase.from('ads').select(<columnas + agencies(name)>)
 *     .eq('status', 'pending_review').order('created_at', {ascending: true})
 *
 * 🔴 EL `.eq('status', 'pending_review')` NO ES REDUNDANTE CON RLS, Y AQUÍ EL
 * RIESGO ES MAYOR QUE EN useMyAds (171.3). La policy `ads_select`
 * (20260816000005_ads_schema.sql:205-210) incluye `or private.is_admin()`, y el
 * caller de este hook es SIEMPRE un admin: esa cláusula evalúa `true` para toda
 * fila de la tabla. Sin el filtro explícito, la "cola de pendientes" traería el
 * inventario COMPLETO de la plataforma —activos, pausados, expirados,
 * rechazados y borradores de todas las organizaciones— y el admin podría pulsar
 * "aprobar" sobre un anuncio `expired` y comerse un 409 sin entender por qué.
 * En useMyAds el mismo descuido filtraba a la competencia; aquí filtra TODO.
 * Precedente #155 (Guardados) y la nota `flatlist_numcolumns_row_keys`.
 *
 * 🔴 ORDEN ASCENDENTE — al revés que useMyAds. Una cola de moderación es FIFO:
 * el anuncio que lleva más tiempo esperando se atiende primero. Con `descending`
 * un anuncio que llegó temprano se hunde conforme entran otros y nunca se
 * modera, mientras su vigencia pagada se consume en la cola.
 *
 * Fallar cerrado: cualquier error de la query ⇒ mensaje NEUTRO en español,
 * `ads=[]`, sin lanzar. Incluye 42P01 (tabla ausente): la épica 168-172 se
 * mergea a main progresivamente y un OTA en esa ventana pega contra un backend
 * sin `ads`.
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface PendingAd {
  id: string;
  title: string;
  description: string | null;
  agency_id: string;
  /** 213: null en una promo — el video sale de property_videos vía property_id. */
  creative_id: string | null;
  cta_type: string | null;
  cta_value: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  /** Embed PostgREST muchos-a-uno: moderar sin saber quién lo subió es moderar a ciegas. */
  agencies: { name: string } | null;
  /**
   * 213: no nulo ⟺ es una PROMO (RPC promote_property_atomic) en vez de un
   * anuncio display. `title` en una promo es la DIRECCIÓN de la propiedad
   * (ads.title = properties.address — properties no tiene columna title).
   */
  property_id: string | null;
}

export interface UsePendingAdsResult {
  ads: PendingAd[];
  loading: boolean;
  error: string | null;
  /** 208.3 la llama tras aprobar/rechazar para refrescar sin desmontar. */
  refetch: () => Promise<void>;
}

const NEUTRAL_ERROR_MESSAGE = 'No se pudo cargar la cola de anuncios. Intenta de nuevo.';

// Sin `*`: select('*') rompe en cuanto la tabla gana una columna que el build
// instalado no espera (§0.5, compatibilidad hacia atrás).
const PENDING_AD_COLUMNS =
  'id, title, description, agency_id, creative_id, cta_type, cta_value, ' +
  'starts_at, ends_at, created_at, agencies(name), property_id';

export function usePendingAds(): UsePendingAdsResult {
  const [ads, set_ads] = useState<PendingAd[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  // Token de recarga: refetch lo incrementa y el efecto vuelve a correr. Es el
  // patrón idiomático de React y el que deja el efecto libre de setState
  // síncrono (react-hooks/set-state-in-effect). La consulta vive DENTRO del
  // efecto, misma forma que useMyAds (171.3).
  const [reload_token, set_reload_token] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function fetch_pending(): Promise<void> {
      // En el montaje `loading` ya arranca en true; esto cubre las recargas.
      if (!ignore) set_loading(true);

      const { data, error: query_error } = await supabase
        .from('ads')
        .select(PENDING_AD_COLUMNS)
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });

      // Una respuesta tardía de una recarga anterior no pisa a la vigente.
      if (ignore) return;

      if (query_error) {
        set_ads([]);
        set_error(NEUTRAL_ERROR_MESSAGE);
        set_loading(false);
        return;
      }

      set_ads((data ?? []) as unknown as PendingAd[]);
      set_error(null);
      set_loading(false);
    }

    void fetch_pending();

    return () => {
      ignore = true;
    };
  }, [reload_token]);

  /**
   * Dispara una recarga. NO espera a que los datos lleguen — la promesa resuelve
   * en cuanto la recarga queda encolada; el consumidor observa `loading` y `ads`
   * como en la carga inicial. Es `async` para que 208.3 pueda encadenarla desde
   * el onSuccess de useModerateAd sin un envoltorio.
   */
  const refetch = useCallback(async (): Promise<void> => {
    set_reload_token((n) => n + 1);
  }, []);

  return { ads, loading, error, refetch };
}
