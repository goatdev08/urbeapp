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
}

export type AgencyCreateResult =
  | { ok: true; agency_id: string }
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
};

// Mensajes legibles (ES). Los errores de servidor no filtran detalle interno.
export const AGENCY_CREATE_ERROR_MESSAGES: Record<string, string> = {
  SLUG_DUPLICATE: "Ya existe una agencia activa con ese slug",
  NAME_DUPLICATE: "Ya existe una agencia activa con ese nombre",
  CREATED_BY_REQUIRED: "created_by_user_id es requerido",
};
