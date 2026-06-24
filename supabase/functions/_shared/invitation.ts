// _shared/invitation.ts
// Stub mínimo — lógica de negocio NO implementada (fase RED).
// El agente supabase implementará la lógica real en la fase GREEN de 5.2.

import { sha256_hex } from "./crypto.ts";

// ── Tipos públicos ────────────────────────────────────────────────────────────

/**
 * Fila de agency_invitation_tokens tal como la devuelve la BD (JOIN con agencies).
 * El campo `token` contiene el hash SHA-256, nunca el texto plano.
 */
export interface InvitationTokenRow {
  id: string;
  agency_id: string;
  token: string; // hash sha256 hex
  max_uses: number | null; // null = ilimitado
  current_uses: number;
  expires_at: string | null; // ISO 8601 o null
  revoked_at: string | null; // null = no revocado
  // JOIN con agencies
  agency_name: string;
  agency_status: string; // enum: 'pending_approval'|'approved'|'active'|'suspended'|'rejected'
}

/**
 * Contrato del fake/cliente inyectable para acceso a datos.
 * La implementación real usará el cliente de Supabase; en tests se inyecta
 * un objeto controlado que devuelve filas fijas.
 *
 * Por qué DI: mockear una DEPENDENCIA (acceso a BD) NO el SUT (la lógica).
 * Así los tests verifican la lógica sin necesitar una BD viva.
 */
export interface InvitationDb {
  /**
   * Busca en agency_invitation_tokens por hash del token.
   * Devuelve la fila (con JOIN a agencies.name y agencies.status) o null si no existe.
   */
  find_by_hash(hash: string): Promise<InvitationTokenRow | null>;
}

// ── Tipos de resultado ────────────────────────────────────────────────────────

export type ValidateInvitationOk = {
  ok: true;
  token_id: string;
  agency_id: string;
  agency_name: string;
};

export type ValidateInvitationError = {
  ok: false;
  error_code:
    | "TOKEN_NOT_FOUND"
    | "TOKEN_EXPIRED"
    | "TOKEN_REVOKED"
    | "TOKEN_MAX_USES_REACHED"
    | "AGENCY_INACTIVE";
};

export type ValidateInvitationResult =
  | ValidateInvitationOk
  | ValidateInvitationError;

// ── SUT — stub que lanza (fase RED) ──────────────────────────────────────────

/**
 * Valida un código de invitación en claro contra la BD.
 *
 * Pasos (a implementar en GREEN):
 *   1. sha256_hex(plain_code) → busca en agency_invitation_tokens por hash.
 *   2. Si no existe → TOKEN_NOT_FOUND.
 *   3. Si revoked_at IS NOT NULL → TOKEN_REVOKED.
 *   4. Si expires_at < now() → TOKEN_EXPIRED.
 *   5. Si max_uses IS NOT NULL y current_uses >= max_uses → TOKEN_MAX_USES_REACHED.
 *   6. Si agencies.status !== 'active' → AGENCY_INACTIVE.
 *   7. → ok: true con token_id, agency_id, agency_name.
 *
 * @param db   Cliente/fake inyectable — mockea la dependencia, NO el SUT.
 * @param plain_code  Código en claro tal como llega del usuario.
 */
export async function validate_invitation_token(
  db: InvitationDb,
  plain_code: string,
): Promise<ValidateInvitationResult> {
  // Usamos sha256_hex para que el compilador TS no marque la importación como no usada.
  // La implementación real lo necesita aquí.
  void sha256_hex;
  throw new Error("not_implemented");
}
