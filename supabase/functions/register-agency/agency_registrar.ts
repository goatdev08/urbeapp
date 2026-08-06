// supabase/functions/register-agency/agency_registrar.ts
// Fábrica del AgencyRegistrar real. Separado de index.ts para ser testeable.
// Patrón espejo de upgrade-to-agent/upgrade_runner.ts.
//
// Envuelve la RPC register_agency_atomic (migración 20260805000006,
// subtarea 71.4) con service_role — la RPC misma valida completitud+duplicados
// y levanta P0001 con el error_code exacto (mensaje = código, mismo patrón que
// upgrade_to_agent_atomic / register_user_atomic).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgencyRegistrar,
  RegisterAgencyAtomicParams,
  RegisterAgencyAtomicResult,
} from "./types.ts";

// Códigos de negocio que la RPC levanta con SQLSTATE P0001 (mensaje = código).
const REGISTER_AGENCY_ERROR_CODES = [
  "CREATED_BY_REQUIRED",
  "FIELDS_INCOMPLETE",
  "SLUG_DUPLICATE",
  "NAME_DUPLICATE",
  "USER_NOT_FOUND",
];

function extract_register_agency_code(message: string): string {
  return REGISTER_AGENCY_ERROR_CODES.find((c) => message.includes(c)) ??
    "REGISTER_AGENCY_FAILED";
}

/**
 * Construye el AgencyRegistrar real contra un cliente supabase-js
 * (service_role — la RPC es SECURITY DEFINER y solo service_role tiene EXECUTE).
 */
export function make_agency_registrar(client: SupabaseClient): AgencyRegistrar {
  return {
    async register_atomic(
      params: RegisterAgencyAtomicParams,
    ): Promise<RegisterAgencyAtomicResult> {
      const { data, error } = await client.rpc("register_agency_atomic", {
        p_name: params.name,
        p_slug: params.slug,
        p_contact_name: params.contact_name,
        p_contact_phone: params.contact_phone,
        p_contact_email: params.contact_email,
        p_created_by_user_id: params.created_by_user_id,
        p_logo_url: params.logo_url,
      });

      if (error) {
        return {
          ok: false,
          error_code: extract_register_agency_code(error.message),
          message: error.message,
        };
      }

      // register_agency_atomic RETURNS uuid (solo agency_id) — no hay
      // agency_member_id/token_id que devolver (ver SEAM 1/2, RED).
      return {
        ok: true,
        agency: {
          agency_id: data as string,
          name: params.name,
          slug: params.slug,
          status: "pending_approval",
          logo_url: params.logo_url,
        },
      };
    },
  };
}
