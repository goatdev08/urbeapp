/**
 * useCreateAdvertisingRequest — el owner solicita cuenta comercial proponiendo
 * una categoría (subtarea 221.3). Contrato completo en
 * __tests__/useCreateAdvertisingRequest.test.ts.
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, tarea 221.1, otra rama):
 *   client.rpc('create_advertising_request', { p_proposed_category })
 *   Errores P0001 con el código EMBEBIDO en `error.message`:
 *     NOT_OWNER | ALREADY_PENDING | ALREADY_ADVERTISER
 *   Mismo criterio de parseo que create_ad_campaign_atomic
 *   (app/(protected)/ads/new/step5.tsx `message_for`): `error.message.includes(code)`.
 *
 * Calca useSetOrgAdvertising: is_working_ref + force_update síncrono ANTES
 * del primer await, DI del cliente vía `deps.supabase`, getters en el
 * objeto retornado. `client.rpc(...)` se llama DIRECTO, nunca desprendido
 * (#205).
 */
import { useCallback, useMemo, useReducer, useRef } from 'react';

import type { AdvertiserCategory } from '@/features/admin/components/advertiser-category-select';

export interface CreateAdvertisingRequestResult {
  ok: boolean;
  error: string | null;
}

export interface UseCreateAdvertisingRequestDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — la pantalla refresca el estado de la solicitud. */
  onSuccess?: () => void;
}

export interface UseCreateAdvertisingRequestReturn {
  submit(category: AdvertiserCategory): Promise<CreateAdvertisingRequestResult>;
  submitting: boolean;
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  NOT_OWNER: 'Solo el dueño de la inmobiliaria puede solicitar la cuenta comercial.',
  ALREADY_PENDING: 'Ya tienes una solicitud en revisión. Espera la respuesta del administrador.',
  ALREADY_ADVERTISER: 'Tu inmobiliaria ya tiene la cuenta comercial activa.',
};
const GENERIC_ERROR =
  'No se pudo enviar la solicitud. Revisa tu conexión e intenta de nuevo.';

function message_for(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return ERROR_MESSAGES[code] as string;
  }
  return GENERIC_ERROR;
}

export function useCreateAdvertisingRequest(
  deps?: UseCreateAdvertisingRequestDeps,
): UseCreateAdvertisingRequestReturn {
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
    (category: AdvertiserCategory): Promise<CreateAdvertisingRequestResult> => {
      // Candado #233.4: early-return síncrono si ya hay una petición en
      // vuelo — antes solo la UI (disabled del botón) protegía el
      // doble-submit; backstop = ALREADY_PENDING del servidor. Mismo patrón
      // que useResolveRequest.ts (EC-7 de esa suite).
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, error: null });
      }
      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const client = get_client();
      return client
        .rpc('create_advertising_request', { p_proposed_category: category })
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
    const r: UseCreateAdvertisingRequestReturn = {
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
