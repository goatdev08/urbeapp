// supabase/functions/upgrade-to-agent/upgrade_runner.ts
// Fábrica del UpgradeRunner real. Separado de index.ts para ser testeable.
// Patrón espejo de create-invitation/invitation_creator.ts.
//
// Envuelve la RPC upgrade_to_agent_atomic (migración 20260805000004,
// subtarea 71.3) con service_role — la RPC misma valida token+usuario y
// levanta P0001 con el error_code exacto (mensaje = código, mismo patrón que
// redeem_invitation_atomic / register_user_atomic).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UpgradeAtomicParams,
  UpgradeAtomicResult,
  UpgradeRunner,
} from "./types.ts";

// Códigos de negocio que la RPC levanta con SQLSTATE P0001 (mensaje = código).
const UPGRADE_ERROR_CODES = [
  "TOKEN_NOT_FOUND",
  "TOKEN_REVOKED",
  "TOKEN_EXPIRED",
  "TOKEN_MAX_USES_REACHED",
  "AGENCY_INACTIVE",
  "ALREADY_AGENT",
  "ALREADY_ACTIVE_MEMBER",
  "USER_NOT_FOUND",
];

function extract_upgrade_code(message: string): string {
  return UPGRADE_ERROR_CODES.find((c) => message.includes(c)) ??
    "UPGRADE_FAILED";
}

/**
 * Construye el UpgradeRunner real contra un cliente supabase-js (service_role
 * — la RPC es SECURITY DEFINER y solo service_role tiene EXECUTE).
 */
export function make_upgrade_runner(client: SupabaseClient): UpgradeRunner {
  return {
    async upgrade_atomic(
      params: UpgradeAtomicParams,
    ): Promise<UpgradeAtomicResult> {
      const { data, error } = await client.rpc("upgrade_to_agent_atomic", {
        p_user_id: params.user_id,
        p_token: params.token,
      });

      if (error) {
        return {
          ok: false,
          error_code: extract_upgrade_code(error.message),
          message: error.message,
        };
      }

      const row = Array.isArray(data) ? data[0] : data;
      return {
        ok: true,
        agency_id: row.agency_id,
        agency_member_id: row.agency_member_id,
      };
    },
  };
}
