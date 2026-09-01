/**
 * usePromoteProperty — el miembro publicador de una organización promociona
 * una propiedad YA publicada (subtarea 213.4). Contrato completo en
 * __tests__/usePromoteProperty.test.ts.
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, tareas 213.1/213.2, otra rama):
 *   client.rpc('promote_property_atomic', { p_property_id })
 *   Errores P0001 con el código EMBEBIDO en `error.message`:
 *     PROPERTY_NOT_PUBLISHED | ALREADY_PROMOTED | AGENCY_CANNOT_PUBLISH |
 *     ZONE_UNRESOLVED | PROPERTY_NOT_FOUND
 *   Mismo criterio de parseo que create_ad_campaign_atomic /
 *   create_advertising_request: `error.message.includes(code)`.
 *
 * Calca useCreateAdvertisingRequest: force_update síncrono ANTES del primer
 * await, DI del cliente vía `deps.supabase`, getters en el objeto retornado.
 * `client.rpc(...)` se llama DIRECTO, nunca desprendido (#205).
 *
 * DIFERENCIA vs useCreateAdvertisingRequest: `is_working_ref` además GATEA
 * la llamada (no solo refleja el estado) — un segundo `submit()` mientras el
 * primero está en vuelo es un no-op (EC-13), porque promocionar es una acción
 * de un solo botón sin doble confirmación aguas arriba que ya lo evite.
 */
import { useCallback, useMemo, useReducer, useRef } from 'react';

export interface PromotePropertyResult {
  ok: boolean;
  error: string | null;
}

export interface UsePromotePropertyDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — la pantalla refresca la lista / cierra el diálogo. */
  onSuccess?: () => void;
}

export interface UsePromotePropertyReturn {
  submit(property_id: string): Promise<PromotePropertyResult>;
  submitting: boolean;
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  PROPERTY_NOT_PUBLISHED: 'Solo puedes promocionar publicaciones activas',
  ALREADY_PROMOTED: 'Esta publicación ya tiene una promoción en curso',
  AGENCY_CANNOT_PUBLISH: 'Tu organización no puede publicar por ahora',
  ZONE_UNRESOLVED: 'No pudimos ubicar el municipio de esta publicación',
  PROPERTY_NOT_FOUND: 'No encontramos la publicación',
};
const GENERIC_ERROR = 'No se pudo enviar la promoción.';

function message_for(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return ERROR_MESSAGES[code] as string;
  }
  return GENERIC_ERROR;
}

export function usePromoteProperty(deps?: UsePromotePropertyDeps): UsePromotePropertyReturn {
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
    (property_id: string): Promise<PromotePropertyResult> => {
      // EC-13: anti doble-submit — un segundo submit mientras el primero
      // sigue en vuelo es un no-op, no una segunda RPC.
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, error: null });
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const client = get_client();
      return client
        .rpc('promote_property_atomic', { p_property_id: property_id })
        .then(
          ({ error }: { error: unknown }) => {
            is_working_ref.current = false;
            if (error) {
              const msg = message_for(error);
              error_ref.current = msg;
              force_update();
              return { ok: false as const, error: msg };
            }
            error_ref.current = null;
            force_update();
            if (deps?.onSuccess) deps.onSuccess();
            return { ok: true as const, error: null };
          },
          (err: unknown) => {
            const msg = message_for(err);
            is_working_ref.current = false;
            error_ref.current = msg;
            force_update();
            return { ok: false as const, error: msg };
          },
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  return useMemo(() => {
    const r: UsePromotePropertyReturn = {
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
