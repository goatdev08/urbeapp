// _shared/redeem.ts
// Dependencia inyectable para el canje atómico (RPC redeem_invitation_atomic, migración 0013).
// La lógica transaccional vive en la BD (PL/pgSQL); aquí solo se define el contrato que la
// Edge Function consume y un adaptador real construible a partir del cliente supabase-js
// (service_role). Los errores de negocio llegan como error_code (P0001 mapeado).

export interface RedeemParams {
  token_id: string;
  user_id: string;
  ip?: string | null;
}

export type RedeemResult =
  | { ok: true; agency_member_id: string }
  | { ok: false; error_code: string; message?: string };

/** Contrato del canje atómico. En producción lo implementa un adaptador supabase-js .rpc(). */
export interface InvitationRedeemer {
  redeem_atomic(params: RedeemParams): Promise<RedeemResult>;
}

// Mapeo de los errores de negocio de la RPC (SQLSTATE P0001) a HTTP status.
export const REDEEM_ERROR_STATUS: Record<string, number> = {
  TOKEN_MAX_USES_REACHED: 422,
  ALREADY_ACTIVE_MEMBER: 409,
  USER_NOT_FOUND: 500,
  NO_ACTIVE_TERMS: 500,
  NO_ACTIVE_PRIVACY: 500,
};

// Mensajes legibles (ES). Los errores de servidor no filtran detalle interno.
export const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_MAX_USES_REACHED: "El código de invitación ya no está disponible",
  ALREADY_ACTIVE_MEMBER: "Este usuario ya pertenece a una agencia activa",
  USER_NOT_FOUND: "No se pudo completar el registro",
  NO_ACTIVE_TERMS: "No se pudo completar el registro",
  NO_ACTIVE_PRIVACY: "No se pudo completar el registro",
};
