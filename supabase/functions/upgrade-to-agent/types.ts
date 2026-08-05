// supabase/functions/upgrade-to-agent/types.ts
// Contrato público (DI) del handler `upgrade-to-agent` — Camino A del wizard de
// upgrade a agente (§4.2, subtarea 71.3). Mirror de redeem-invitation/handler.ts
// y create-invitation/types.ts, pero para un usuario YA AUTENTICADO (no crea
// auth.user; solo canjea el código contra su propia cuenta).
//
// Separación de responsabilidades:
//   - Handler: parse input (invitationCode), verificación de caller (JWT).
//   - UpgradeRunner: envuelve la RPC upgrade_to_agent_atomic (migración
//     20260805000004) — service_role, mapea P0001 a error_code de negocio.
//
// ⭐ user_id SIEMPRE del JWT (nunca del payload): el caller solo puede subirse
// a SÍ MISMO. No hay superficie de IDOR — la RPC ni siquiera acepta operar
// sobre otro usuario porque p_user_id viaja fijo desde el token verificado.

// ── Input validado ────────────────────────────────────────────────────────────

export interface UpgradeToAgentInput {
  invitationCode: string;
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Contrato idéntico al de create-invitation/update-lead-status.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── UpgradeRunner ─────────────────────────────────────────────────────────────
// Envuelve la RPC upgrade_to_agent_atomic (migración 20260805000004).
// Errores P0001 posibles: TOKEN_NOT_FOUND, TOKEN_REVOKED, TOKEN_EXPIRED,
// TOKEN_MAX_USES_REACHED, AGENCY_INACTIVE, ALREADY_AGENT, ALREADY_ACTIVE_MEMBER,
// USER_NOT_FOUND.

export interface UpgradeAtomicParams {
  user_id: string;
  token: string; // código en claro
}

export type UpgradeAtomicResult =
  | { ok: true; agency_id: string; agency_member_id: string }
  | { ok: false; error_code: string; message?: string };

export interface UpgradeRunner {
  upgrade_atomic(params: UpgradeAtomicParams): Promise<UpgradeAtomicResult>;
}

// ── Deps del handler ──────────────────────────────────────────────────────────

export interface UpgradeToAgentDeps {
  callerVerifier: CallerVerifier;
  upgradeRunner: UpgradeRunner;
}
