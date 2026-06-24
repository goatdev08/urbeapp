// _shared/validation.ts — stub mínimo (not_implemented)
// El agente supabase implementará el schema Zod real en la fase GREEN.

export interface RedeemInvitationInput {
  invitationCode: string;
  email: string;
  password: string;
  fullName: string;
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

/**
 * Valida y parsea el payload de redeem-invitation.
 * Reglas canónicas (§7.1 lineamientos):
 *   - invitationCode: string, min 6 caracteres
 *   - email: string, formato email válido (RFC)
 *   - password: string, min 8 caracteres
 *   - fullName: string, min 1 carácter (no vacío)
 * STUB: lanza para que los tests fallen en rojo.
 */
export function parse_redeem_invitation_input(
  _raw: unknown,
): ParseResult<RedeemInvitationInput> {
  throw new Error("not_implemented");
}
