/**
 * useResolveRequest — resolver (aprobar/rechazar con motivo) las TRES colas
 * mutables de /admin/requests (módulo 041-M4, subtarea 221.4): solicitudes
 * de agente, registros de inmobiliaria pending_approval, y solicitudes de
 * cuenta comercial. Contrato completo en __tests__/useResolveRequest.test.ts.
 *
 * 🔴 CONTRATOS DEFINITIVOS del backend (221.1/221.2, ya expuestos — RPCs, no
 * Edge Functions):
 *   client.rpc('resolve_agent_application', { p_application_id, p_approve, p_reason? })
 *     códigos P0001: APPLICATION_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED
 *       | STATUS_CHANGE_REQUIRES_ADMIN
 *   client.rpc('resolve_advertising_request', { p_request_id, p_approve, p_reason? })
 *     códigos P0001: REQUEST_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED
 *       | STATUS_CHANGE_REQUIRES_ADMIN
 *   client.rpc('resolve_agency_registration', { p_agency_id, p_approve, p_reason? })
 *     códigos P0001: AGENCY_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED
 *       | STATUS_CHANGE_REQUIRES_ADMIN
 * Los tres carriles comparten el SUFIJO `_NOT_FOUND` con un PREFIJO propio
 * por tabla — de ahí que cada hook tenga su propio mapa de mensajes (no uno
 * compartido: un mapa único habría necesitado los 3 prefijos igual, sin
 * ahorrar nada). Mismo criterio de parseo que create_ad_campaign_atomic
 * (`error.message.includes(code)`).
 *
 * Tres hooks SIBLING (no una fábrica genérica por RPC name): misma FORMA de
 * estado (is_working_ref/error_ref/force_update) pero cada uno con su propio
 * nombre de RPC, forma de params y vocabulario de error — mismo criterio que
 * useReportUser/useReportProperty (ponytail: 3 call sites con nombres de
 * parámetro y códigos DISTINTOS; una indirección genérica no ahorra nada
 * legible hoy).
 *
 * Calca useSetOrgAdvertising: is_working_ref + force_update síncrono ANTES
 * del primer await, DI del cliente vía `deps.supabase`, getters en el
 * objeto retornado. `client.rpc(...)` se llama DIRECTO, nunca desprendido
 * (#205). NO valida `reason` — solo lo reenvía si vino (la UI decide cuándo
 * es obligatorio, mismo criterio que useResolveReport). NO doble-submit,
 * semántica IGNORAR mientras la primera sigue en vuelo.
 */
import { useCallback, useMemo, useReducer, useRef } from 'react';

export interface ResolveRequestResult {
  ok: boolean;
  error: string | null;
}

export interface UseResolveRequestDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — refresca la lista correspondiente. */
  onSuccess?: () => void;
}

const STATUS_CHANGE_REQUIRES_ADMIN_MESSAGE =
  'Solo un administrador puede resolver esta solicitud.';
const GENERIC_ERROR = 'No se pudo resolver la solicitud. Intenta de nuevo.';

/** Busca el PRIMER código conocido embebido en `error.message` (P0001). */
function message_for(error: unknown, messages: Record<string, string>): string {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const code of Object.keys(messages)) {
    if (raw.includes(code)) return messages[code] as string;
  }
  return GENERIC_ERROR;
}

function get_client(deps: UseResolveRequestDeps | undefined): any {
  if (deps?.supabase) return deps.supabase;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
}

// ---------------------------------------------------------------------------
// Solicitudes de agente
// ---------------------------------------------------------------------------

const AGENT_APPLICATION_ERROR_MESSAGES: Record<string, string> = {
  APPLICATION_NOT_FOUND: 'La solicitud ya no existe.',
  ALREADY_RESOLVED: 'Esta solicitud ya fue resuelta por otro administrador.',
  REASON_REQUIRED: 'Escribe un motivo para rechazar la solicitud.',
  STATUS_CHANGE_REQUIRES_ADMIN: STATUS_CHANGE_REQUIRES_ADMIN_MESSAGE,
};

export interface ResolveAgentApplicationParams {
  application_id: string;
  approve: boolean;
  reason?: string;
}

export interface UseResolveAgentApplicationReturn {
  resolve(params: ResolveAgentApplicationParams): Promise<ResolveRequestResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useResolveAgentApplication(
  deps?: UseResolveRequestDeps,
): UseResolveAgentApplicationReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const resolve = useCallback(
    ({ application_id, approve, reason }: ResolveAgentApplicationParams): Promise<ResolveRequestResult> => {
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, error: null });
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const body: Record<string, unknown> = { p_application_id: application_id, p_approve: approve };
      if (reason !== undefined) body.p_reason = reason;

      const client = get_client(deps);
      return client.rpc('resolve_agent_application', body).then(
        ({ error }: { error: unknown }) => {
          is_working_ref.current = false;
          if (error) {
            const msg = message_for(error, AGENT_APPLICATION_ERROR_MESSAGES);
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
          const msg = message_for(err, AGENT_APPLICATION_ERROR_MESSAGES);
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
    const r: UseResolveAgentApplicationReturn = {
      resolve,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;
  }, [resolve]);
}

// ---------------------------------------------------------------------------
// Solicitudes de cuenta comercial
// ---------------------------------------------------------------------------

const ADVERTISING_REQUEST_ERROR_MESSAGES: Record<string, string> = {
  REQUEST_NOT_FOUND: 'La solicitud ya no existe.',
  ALREADY_RESOLVED: 'Esta solicitud ya fue resuelta por otro administrador.',
  REASON_REQUIRED: 'Escribe un motivo para rechazar la solicitud.',
  STATUS_CHANGE_REQUIRES_ADMIN: STATUS_CHANGE_REQUIRES_ADMIN_MESSAGE,
};

export interface ResolveAdvertisingRequestParams {
  request_id: string;
  approve: boolean;
  reason?: string;
}

export interface UseResolveAdvertisingRequestReturn {
  resolve(params: ResolveAdvertisingRequestParams): Promise<ResolveRequestResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useResolveAdvertisingRequest(
  deps?: UseResolveRequestDeps,
): UseResolveAdvertisingRequestReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const resolve = useCallback(
    ({ request_id, approve, reason }: ResolveAdvertisingRequestParams): Promise<ResolveRequestResult> => {
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, error: null });
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const body: Record<string, unknown> = { p_request_id: request_id, p_approve: approve };
      if (reason !== undefined) body.p_reason = reason;

      const client = get_client(deps);
      return client.rpc('resolve_advertising_request', body).then(
        ({ error }: { error: unknown }) => {
          is_working_ref.current = false;
          if (error) {
            const msg = message_for(error, ADVERTISING_REQUEST_ERROR_MESSAGES);
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
          const msg = message_for(err, ADVERTISING_REQUEST_ERROR_MESSAGES);
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
    const r: UseResolveAdvertisingRequestReturn = {
      resolve,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;
  }, [resolve]);
}

// ---------------------------------------------------------------------------
// Registros de inmobiliaria (pending_approval) — NUEVO, follow-up del
// coordinador: antes solo existía por Studio; el backend acaba de exponer
// la puerta client-side.
// ---------------------------------------------------------------------------

const AGENCY_REGISTRATION_ERROR_MESSAGES: Record<string, string> = {
  AGENCY_NOT_FOUND: 'La inmobiliaria ya no existe.',
  ALREADY_RESOLVED: 'Esta inmobiliaria ya fue resuelta por otro administrador.',
  REASON_REQUIRED: 'Escribe un motivo para rechazar el registro.',
  STATUS_CHANGE_REQUIRES_ADMIN: STATUS_CHANGE_REQUIRES_ADMIN_MESSAGE,
};

export interface ResolveAgencyRegistrationParams {
  agency_id: string;
  approve: boolean;
  reason?: string;
}

export interface UseResolveAgencyRegistrationReturn {
  resolve(params: ResolveAgencyRegistrationParams): Promise<ResolveRequestResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useResolveAgencyRegistration(
  deps?: UseResolveRequestDeps,
): UseResolveAgencyRegistrationReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const resolve = useCallback(
    ({ agency_id, approve, reason }: ResolveAgencyRegistrationParams): Promise<ResolveRequestResult> => {
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, error: null });
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const body: Record<string, unknown> = { p_agency_id: agency_id, p_approve: approve };
      if (reason !== undefined) body.p_reason = reason;

      const client = get_client(deps);
      return client.rpc('resolve_agency_registration', body).then(
        ({ error }: { error: unknown }) => {
          is_working_ref.current = false;
          if (error) {
            const msg = message_for(error, AGENCY_REGISTRATION_ERROR_MESSAGES);
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
          const msg = message_for(err, AGENCY_REGISTRATION_ERROR_MESSAGES);
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
    const r: UseResolveAgencyRegistrationReturn = {
      resolve,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;
  }, [resolve]);
}
