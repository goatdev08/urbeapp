/**
 * useReassignMemberProperties — el owner/admin de una agencia reasigna el
 * inventario de un miembro (suspendido, removido, o cualquier otro) a un
 * miembro ACTIVO distinto (subtarea #203.2). Contrato completo en
 * __tests__/useReassignMemberProperties.test.ts.
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, subtarea 203.1, otra rama):
 *   client.rpc('reassign_member_properties_atomic', {
 *     p_agency_id, p_from_user_id, p_to_user_id,
 *   }) → returns integer (conteo de propiedades reasignadas; 0 NO es error).
 *   Errores P0001 con el código EMBEBIDO en `error.message`:
 *     NOT_AUTHENTICATED | NOT_AUTHORIZED | SAME_USER | TARGET_NOT_ACTIVE_MEMBER
 *   Mismo criterio de parseo que usePromoteProperty / create_ad_campaign_atomic:
 *   `error.message.includes(code)`.
 *
 * Calca usePromoteProperty: force_update síncrono ANTES del primer await, DI
 * del cliente vía `deps.supabase`, getters en el objeto retornado.
 * `client.rpc(...)` se llama DIRECTO, nunca desprendido (#205).
 *
 * `is_working_ref` además GATEA la llamada (no solo refleja el estado) — un
 * segundo `submit()` mientras el primero está en vuelo es un no-op: reasignar
 * es una acción de un solo botón (el picker de destino) sin doble
 * confirmación aguas arriba que ya lo evite.
 */
import { useCallback, useMemo, useReducer, useRef } from 'react';

export interface ReassignMemberPropertiesResult {
  ok: boolean;
  /** Propiedades reasignadas. null solo si ok=false. 0 es un resultado válido. */
  count: number | null;
  error: string | null;
}

export interface UseReassignMemberPropertiesDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — recibe el conteo para el Alert de confirmación. */
  onSuccess?: (count: number) => void;
}

export interface UseReassignMemberPropertiesReturn {
  submit(
    p_agency_id: string,
    p_from_user_id: string,
    p_to_user_id: string,
  ): Promise<ReassignMemberPropertiesResult>;
  submitting: boolean;
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED: 'No tienes permiso para reasignar en esta inmobiliaria',
  TARGET_NOT_ACTIVE_MEMBER: 'Ese miembro no está activo en la inmobiliaria',
  SAME_USER: 'Elige un miembro distinto',
};
const GENERIC_ERROR = 'No se pudo reasignar';

function message_for(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return ERROR_MESSAGES[code] as string;
  }
  return GENERIC_ERROR;
}

export function useReassignMemberProperties(
  deps?: UseReassignMemberPropertiesDeps,
): UseReassignMemberPropertiesReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte.
  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  const submit = useCallback(
    (
      p_agency_id: string,
      p_from_user_id: string,
      p_to_user_id: string,
    ): Promise<ReassignMemberPropertiesResult> => {
      // Anti doble-submit: un segundo submit mientras el primero sigue en
      // vuelo es un no-op, no una segunda RPC.
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, count: null, error: null });
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const client = get_client();
      return client
        .rpc('reassign_member_properties_atomic', {
          p_agency_id,
          p_from_user_id,
          p_to_user_id,
        })
        .then(
          ({ data, error }: { data: unknown; error: unknown }) => {
            is_working_ref.current = false;
            if (error) {
              const msg = message_for(error);
              error_ref.current = msg;
              force_update();
              return { ok: false as const, count: null, error: msg };
            }
            error_ref.current = null;
            force_update();
            // 0 NO es error — un typeof estricto evita que un `data` falsy
            // (0) se pierda por un `data ?? 0` con nullish-solo (esto es más
            // explícito sobre qué forma se espera del RPC).
            const count = typeof data === 'number' ? data : 0;
            if (deps?.onSuccess) deps.onSuccess(count);
            return { ok: true as const, count, error: null };
          },
          (err: unknown) => {
            const msg = message_for(err);
            is_working_ref.current = false;
            error_ref.current = msg;
            force_update();
            return { ok: false as const, count: null, error: msg };
          },
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  return useMemo(() => {
    const r: UseReassignMemberPropertiesReturn = {
      submit,
      get submitting() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
  }, [submit]);
}
