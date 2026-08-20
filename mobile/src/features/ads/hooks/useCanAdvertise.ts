/**
 * useCanAdvertise — gate de CAPACIDAD (no de botón, de RUTA) para el wizard
 * de anuncios. Subtarea 169.8 — fase GREEN.
 *
 * Contrato (fijado por
 * mobile/src/features/ads/__tests__/useCanAdvertise.test.tsx — ver el
 * docblock de ese archivo para la enumeración completa de casos y el
 * contrato exacto de queries):
 *
 *   useCanAdvertise(): { can_advertise: boolean; loading: boolean }
 *
 * Dos queries en serie (fail-fast: la 2ª nunca se dispara si la 1ª no deja
 * pasar un owner/admin activo):
 *   1. agency_members — resuelve agency_id + member_role del usuario.
 *   2. agencies — trae can_advertise, deleted_at, status. Las MISMAS 4
 *      causas que `private.org_can_advertise`
 *      (supabase/migrations/20260815000001_org_advertising_capability.sql:57-67):
 *      id inexistente | deleted_at no nulo | status <> 'active' |
 *      can_advertise = false.
 *
 * 🔴 El filtrado de deleted_at/status es responsabilidad de ESTE hook, NO de
 * RLS: la policy `agencies_select` (20260604000010:180-186) deja ver la fila
 * al manager vía `manages_agency(id)` AUNQUE la agencia esté suspendida o
 * soft-deleted. No RPC desde el cliente — `public.org_can_advertise` está
 * `revoke`d a `authenticated` (20260816000008), a propósito.
 *
 * 🔴 FALLAR CERRADO: cualquier error de query (42703 columna inexistente,
 * 42P01 relación inexistente, error de red genérico) ⇒ can_advertise=false,
 * nunca lanza. Necesario porque 168–172 se mergean progresivamente a main
 * sin desplegar el schema — un OTA urgente en ese intervalo llevaría este JS
 * contra un backend que aún no tiene las columnas/tablas.
 *
 * Los `select` de este hook se tipan solos contra los tipos generados
 * (supabase/types/database.types.ts, regenerados en #190). Hubo un cast
 * `as unknown as` sobre la fila de `agencies` mientras esos tipos llevaban 10
 * migraciones de retraso y `can_advertise` no existía para el compilador; el
 * cast nunca aportó nada a la tolerancia en runtime — esa la da y la ha dado
 * siempre el chequeo de `agency_error` de abajo (testeado por EC-3/4/5).
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';

export interface UseCanAdvertiseResult {
  /**
   * true SOLO cuando el caller es owner/admin ACTIVO de una organización con
   * `agencies.can_advertise = true`, `deleted_at is null` y
   * `status = 'active'` — las MISMAS 4 causas que
   * `private.org_can_advertise` (20260815000001), porque RLS NO esconde una
   * agencia suspendida/soft-deleted de su propio manager (policy
   * `agencies_select`, cláusula `manages_agency`): el filtro es
   * responsabilidad de este hook. Fail-closed en cualquier otra condición —
   * incluida la ausencia de schema en el backend (columna o tabla que
   * todavía no existe porque 168–172 no se ha desplegado aún, ver
   * CLAUDE.md §0.5 y la subtarea 169.8).
   */
  can_advertise: boolean;
  /** true mientras se resuelve la capacidad. Nunca deja can_advertise=true mientras loading=true. */
  loading: boolean;
}

export function useCanAdvertise(): UseCanAdvertiseResult {
  const { user } = useAuth();
  const [can_advertise, set_can_advertise] = useState(false);
  const [loading, set_loading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function fetch_capability(): Promise<void> {
      // Reinicia AMBOS al arrancar cada resolución (no solo loading): un
      // cambio de user?.id no debe dejar el can_advertise=true del usuario
      // anterior visible mientras la nueva consulta está pendiente (EC-21) —
      // la promesa del docblock ("can_advertise=false SIEMPRE que
      // loading=true") debe cumplirse también a mitad de una transición de
      // sesión, no solo en el montaje inicial.
      if (!ignore) {
        set_loading(true);
        set_can_advertise(false);
      }

      // Sin sesión — estado seguro, ninguna query se dispara.
      if (!user?.id) {
        if (!ignore) {
          set_can_advertise(false);
          set_loading(false);
        }
        return;
      }

      const { data: member, error: member_error } = await supabase
        .from('agency_members')
        .select('agency_id, member_role')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (ignore) return;

      // Fail-fast: error, sin membresía activa, o rol fuera de owner/admin
      // ⇒ can_advertise=false SIN consultar agencies.
      if (
        member_error ||
        !member ||
        (member.member_role !== 'owner' && member.member_role !== 'admin')
      ) {
        set_can_advertise(false);
        set_loading(false);
        return;
      }

      const { data: agency, error: agency_error } = await supabase
        .from('agencies')
        .select('can_advertise, deleted_at, status')
        .eq('id', member.agency_id)
        .maybeSingle();

      if (ignore) return;

      // Fail cerrado ante CUALQUIER error (42703/42P01/red) o combinación
      // que no sea exactamente activa + no borrada + can_advertise=true.
      const enabled =
        !agency_error &&
        agency !== null &&
        agency.deleted_at === null &&
        agency.status === 'active' &&
        agency.can_advertise === true;

      set_can_advertise(enabled);
      set_loading(false);
    }

    void fetch_capability();

    return () => {
      ignore = true;
    };
  }, [user?.id]);

  return { can_advertise, loading };
}
