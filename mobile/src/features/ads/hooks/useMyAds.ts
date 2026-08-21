/**
 * useMyAds — lista de los anuncios de la agencia del anunciante logueado
 * (panel del anunciante, subtarea 171.3, fase GREEN). Contrato completo y
 * los 18 edge cases están documentados en el docblock de
 * mobile/src/features/ads/__tests__/useMyAds.test.tsx — léelo antes de tocar
 * este archivo.
 *
 * Dos consultas en serie, mismo patrón que useCanAdvertise (169.8):
 *   1. fetch_own_membership(user.id) de '@/features/agency/api' — resuelve
 *      { agency_id, member_role } | null. Ya falla cerrado por su cuenta
 *      (cualquier error de su query interna → null), así que aquí basta
 *      tratar null como "sin agencia". Sin sesión o sin membresía activa ⇒
 *      la query 2 NUNCA se dispara (fail-fast).
 *   2. supabase.from('ads').select(<columnas>).eq('agency_id', agency_id)
 *      .order('created_at', { ascending: false }).
 *
 * 🔴 El `.eq('agency_id', …)` de la query 2 NO es opcional ni redundante con
 * RLS. La policy `ads_select` (supabase/migrations/20260816000005_ads_schema
 * .sql:205-210) es:
 *
 *   private.agency_role_of(agency_id) is not null
 *     or private.is_admin()
 *     or (status = 'active' and now() between starts_at and ends_at)
 *
 * La tercera cláusula existe A PROPÓSITO para que el feed vea inventario
 * cross-org. Un `select` a `ads` sin el `.eq` explícito devolvería TAMBIÉN
 * los anuncios activos de la competencia — el mismo bug de fondo que el
 * precedente #155 (Guardados) y la nota `flatlist_numcolumns_row_keys`:
 * "mis X" siempre filtra por el id propio en el cliente, aunque RLS "ya
 * filtre".
 *
 * 🔴 FALLAR CERRADO ante backend sin schema desplegado (168-172 se mergea a
 * main progresivamente sin desplegar el schema completo — un OTA urgente en
 * esa ventana pega contra un backend sin la tabla `ads`, p.ej. 42P01):
 * cualquier error de la query 2 ⇒ mensaje NEUTRO en español, nunca el texto
 * crudo de PostgREST/Postgres, `ads=[]`, sin lanzar.
 *
 * `agency_id` se expone AUNQUE la lista venga vacía o la query falle — este
 * hook alimenta a useAdMetrics (171.2), que hace su propia consulta
 * independiente con ese id. Solo es `null` cuando la membresía no resolvió.
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import { fetch_own_membership } from '@/features/agency/api';

export interface MyAd {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  paused_at: string | null;
  paused_by_suspension: boolean;
  rejection_reason: string | null;
}

export interface UseMyAdsResult {
  ads: MyAd[];
  agency_id: string | null;
  loading: boolean;
  error: string | null;
}

const NEUTRAL_ERROR_MESSAGE = 'No se pudieron cargar tus anuncios. Intenta de nuevo.';

const MY_AD_COLUMNS =
  'id, title, status, starts_at, ends_at, paused_at, paused_by_suspension, rejection_reason';

export function useMyAds(): UseMyAdsResult {
  const { user } = useAuth();
  const [ads, set_ads] = useState<MyAd[]>([]);
  const [agency_id, set_agency_id] = useState<string | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function fetch_my_ads(): Promise<void> {
      // Reinicia el estado completo al arrancar cada resolución: un cambio
      // de user?.id no debe dejar visibles los anuncios/agency_id del
      // usuario anterior mientras la nueva consulta está pendiente (EC-18).
      if (!ignore) {
        set_loading(true);
        set_ads([]);
        set_agency_id(null);
        set_error(null);
      }

      // Sin sesión — estado seguro, ninguna query se dispara.
      if (!user?.id) {
        if (!ignore) {
          set_loading(false);
        }
        return;
      }

      const membership = await fetch_own_membership(user.id);

      if (ignore) return;

      // Fail-fast: sin membresía activa ⇒ ads=[] sin consultar `ads`.
      if (!membership) {
        set_loading(false);
        return;
      }

      set_agency_id(membership.agency_id);

      const { data, error: ads_error } = await supabase
        .from('ads')
        .select(MY_AD_COLUMNS)
        .eq('agency_id', membership.agency_id)
        .order('created_at', { ascending: false });

      if (ignore) return;

      if (ads_error) {
        set_ads([]);
        set_error(NEUTRAL_ERROR_MESSAGE);
        set_loading(false);
        return;
      }

      set_ads((data ?? []) as unknown as MyAd[]);
      set_error(null);
      set_loading(false);
    }

    void fetch_my_ads();

    return () => {
      ignore = true;
    };
  }, [user?.id]);

  return { ads, agency_id, loading, error };
}
