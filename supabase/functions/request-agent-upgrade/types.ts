// supabase/functions/request-agent-upgrade/types.ts
// Contrato público (DI) del handler `request-agent-upgrade` — Camino B del
// wizard de upgrade a agente (§4.2, subtarea 71.3): solicitud independiente
// que un admin revisa después (71.5). La cuenta sigue user/premium hasta
// aprobación — esta EF solo crea la solicitud.
//
// Separación de responsabilidades:
//   - Handler: parse input (reason opcional), verificación de caller (JWT).
//   - ApplicationCreator: INSERT en public.agent_applications con el CLIENTE
//     DEL USUARIO (anon key + JWT, ver _shared/clients.ts:user_client) — NO
//     service_role — para que la política RLS agent_app_insert (migración
//     20260604000008/20260604000010) sea la que autoriza, en vez de
//     reimplementar "solo tu propio user_id" en JS.
//
// ⭐ user_id SIEMPRE del JWT (nunca del payload) — mismo principio que
// upgrade-to-agent. El índice único parcial agent_app_one_pending_per_user
// (migración 20260604000003) es la barrera anti-duplicados; su violación
// (SQLSTATE 23505) se mapea a DUPLICATE_PENDING_APPLICATION.

// ── Input validado ────────────────────────────────────────────────────────────

export interface RequestAgentUpgradeInput {
  reason: string | null; // motivo del solicitante — nullable, no obligatorio en beta
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Contrato idéntico al de create-invitation/upgrade-to-agent.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── ApplicationCreator ────────────────────────────────────────────────────────

export interface CreateApplicationParams {
  user_id: string;
  reason: string | null;
}

export type CreateApplicationResult =
  | { ok: true; application_id: string }
  | {
    ok: false;
    error_code: "DUPLICATE_PENDING_APPLICATION" | "DB_ERROR";
    message?: string;
  };

export interface ApplicationCreator {
  create(params: CreateApplicationParams): Promise<CreateApplicationResult>;
}

// ── Deps del handler ──────────────────────────────────────────────────────────

export interface RequestAgentUpgradeDeps {
  callerVerifier: CallerVerifier;
  applicationCreator: ApplicationCreator;
}
