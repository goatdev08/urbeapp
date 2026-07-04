// supabase/functions/create-invitation/types.ts
// Tipos y contratos de DI para la Edge Function create-invitation.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Propósito: un OWNER de agencia genera códigos de invitación adicionales para
// SU agencia (la EF admin-create-agency solo genera el token inicial al crear
// la agencia). El código plano se devuelve UNA sola vez; en BD solo persiste
// sha256_hex(plano) en agency_invitation_tokens.token.
//
// Separación de responsabilidades:
//   - Handler: parse input, validación en-memoria (max_uses entero ≥1,
//     expires_at fecha futura), verificación de caller.
//   - InvitationCreator: membresía owner activa, agencia activa, generación
//     del código (crypto), INSERT del hash.
//
// ⭐ agency_id NO viaja en el payload: se deriva de la membresía owner activa
// del caller (constraint agency_members_one_active_per_user garantiza que es
// única). Cero superficie de IDOR.

// ── Input validado ────────────────────────────────────────────────────────────

export interface CreateInvitationInput {
  max_uses: number | null; // null = usos ilimitados (mismo semántico que la BD)
  expires_at: string | null; // ISO timestamptz futura; null = no expira
}

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Contrato idéntico al de update-lead-note/update-lead-status.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── InvitationCreator ─────────────────────────────────────────────────────────
//
// Responsabilidades:
//   1. Buscar membresía owner activa del caller (agency_members:
//      user_id + member_role='owner' + status='active') → NOT_AGENCY_OWNER si no hay.
//   2. Verificar agencies.status='active' → AGENCY_INACTIVE si no.
//   3. Generar plain = generate_invitation_code(); hash = sha256_hex(plain).
//   4. INSERT en agency_invitation_tokens (token=hash, created_by_user_id=caller).
//   5. Retornar el plano UNA sola vez junto con los metadatos.
//
// Error codes:
//   NOT_AGENCY_OWNER → handler devuelve 403
//   AGENCY_INACTIVE  → handler devuelve 422
//   DB_ERROR         → handler devuelve 500

export interface CreateInvitationParams {
  user_id: string;
  max_uses: number | null;
  expires_at: string | null;
}

export interface CreatedInvitation {
  token_id: string;
  plain_token: string; // ÚNICA vez que existe fuera de la RAM del cliente
  agency_id: string;
  max_uses: number | null;
  expires_at: string | null;
}

export type CreateInvitationResult =
  | { ok: true; invitation: CreatedInvitation }
  | {
    ok: false;
    error_code: "NOT_AGENCY_OWNER" | "AGENCY_INACTIVE" | "DB_ERROR";
    message?: string;
  };

export interface InvitationCreator {
  create(params: CreateInvitationParams): Promise<CreateInvitationResult>;
}

// ── Deps del handler ──────────────────────────────────────────────────────────

export interface CreateInvitationDeps {
  callerVerifier: CallerVerifier;
  invitationCreator: InvitationCreator;
}
