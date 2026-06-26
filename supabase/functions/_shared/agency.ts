// _shared/agency.ts
// Interfaz DI para la creación atómica de agencias.
// GREEN implementará el adaptador real sobre la RPC admin_create_agency_atomic (migración 0016).
//
// Contrato:
//   AgencyCreator.create_atomic(params) → ok: true + agency_id | ok: false + error_code
//   error_codes: SLUG_DUPLICATE (409), NAME_DUPLICATE (409), CREATED_BY_REQUIRED (400), otros → 500

export interface AgencyCreateParams {
  name: string;
  slug: string;
  contact_name?: string | undefined;
  contact_phone?: string | undefined;
  contact_email?: string | undefined;
  created_by_user_id: string;
  /** owner_user_id: requerido en GREEN 7.5; opcional aquí para backward-compat en stub RED */
  owner_user_id?: string | undefined;
  /**
   * token_hash (7.6): sha256_hex del código plano generado por generate_invitation_code.
   * Se persiste en agency_invitation_tokens.token; el plano NUNCA se persiste.
   * STUB fase RED 7.6 — pasado a la RPC en la fase GREEN.
   */
  token_hash?: string | undefined;
  /** token_max_uses (7.6): límite de usos del token inicial; null = ilimitado */
  token_max_uses?: number | undefined;
}

export type AgencyCreateResult =
  | {
    ok: true;
    agency_id: string;
    /**
     * token_id (7.6): UUID de la fila en agency_invitation_tokens creada por la RPC.
     * Devuelto en la respuesta 201 junto con plain_token.
     * STUB fase RED 7.6 — poblado por la RPC extendida en fase GREEN.
     */
    token_id?: string | undefined;
    /** agency_member_id (7.6): UUID del agency_member del owner creado en la misma tx. */
    agency_member_id?: string | undefined;
  }
  | { ok: false; error_code: string; message?: string };

/**
 * Contrato de la creación atómica de agencia. Inyectable vía DI.
 * En producción lo implementa un adaptador sobre client.rpc('admin_create_agency_atomic', {...}).
 * En tests se inyecta un fake controlado que graba las llamadas.
 */
export interface AgencyCreator {
  create_atomic(params: AgencyCreateParams): Promise<AgencyCreateResult>;
}

// Mapeo de error_code → HTTP status para el handler.
export const AGENCY_CREATE_ERROR_STATUS: Record<string, number> = {
  SLUG_DUPLICATE: 409,
  NAME_DUPLICATE: 409,
  CREATED_BY_REQUIRED: 400,
  ALREADY_ACTIVE_MEMBER: 409,
};

// Mensajes legibles (ES). Los errores de servidor no filtran detalle interno.
export const AGENCY_CREATE_ERROR_MESSAGES: Record<string, string> = {
  SLUG_DUPLICATE: "Ya existe una agencia activa con ese slug",
  NAME_DUPLICATE: "Ya existe una agencia activa con ese nombre",
  CREATED_BY_REQUIRED: "created_by_user_id es requerido",
  ALREADY_ACTIVE_MEMBER: "El owner ya tiene una membresía activa en otra agencia",
};
